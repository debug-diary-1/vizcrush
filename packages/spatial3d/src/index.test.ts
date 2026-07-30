import { describe, it, expect } from "vitest";
import { buildOctree, queryRange3d, queryNearest3d, frustumCull } from "./index.js";

function randomPoints(n: number, lo = 0, hi = 100) {
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = lo + Math.random() * (hi - lo);
    y[i] = lo + Math.random() * (hi - lo);
    z[i] = lo + Math.random() * (hi - lo);
  }
  return { x, y, z };
}

describe("buildOctree", () => {
  it("builds an octree with 1000 random 3D points", async () => {
    const { x, y, z } = randomPoints(1000);
    const tree = await buildOctree(x, y, z);

    expect(tree.pointCount).toBe(1000);
    expect(tree.id).toMatch(/^ot_/);
    // Assert through the public interface: a populated tree returns points for
    // an all-encompassing range query.
    const all = queryRange3d(tree, {
      xMin: -1e9,
      xMax: 1e9,
      yMin: -1e9,
      yMax: 1e9,
      zMin: -1e9,
      zMax: 1e9,
    });
    expect(all.length).toBe(1000);
    expect(tree.bounds.xMin).toBeLessThan(tree.bounds.xMax);
    expect(tree.bounds.yMin).toBeLessThan(tree.bounds.yMax);
    expect(tree.bounds.zMin).toBeLessThan(tree.bounds.zMax);
  });

  it("handles empty input", async () => {
    const tree = await buildOctree(new Float64Array(0), new Float64Array(0), new Float64Array(0));
    expect(tree.pointCount).toBe(0);
    // An empty tree returns no points for any range query.
    const all = queryRange3d(tree, {
      xMin: -1e9,
      xMax: 1e9,
      yMin: -1e9,
      yMax: 1e9,
      zMin: -1e9,
      zMax: 1e9,
    });
    expect(all.length).toBe(0);
  });
});

describe("queryRange3d", () => {
  it("returns correct points within bounds", async () => {
    const n = 1000;
    const { x, y, z } = randomPoints(n);
    const tree = await buildOctree(x, y, z);

    const bbox = { xMin: 20, xMax: 40, yMin: 30, yMax: 60, zMin: 10, zMax: 50 };
    const result = queryRange3d(tree, bbox);

    // Verify all returned points are inside the bbox
    for (const idx of result) {
      expect(x[idx]).toBeGreaterThanOrEqual(bbox.xMin);
      expect(x[idx]).toBeLessThanOrEqual(bbox.xMax);
      expect(y[idx]).toBeGreaterThanOrEqual(bbox.yMin);
      expect(y[idx]).toBeLessThanOrEqual(bbox.yMax);
      expect(z[idx]).toBeGreaterThanOrEqual(bbox.zMin);
      expect(z[idx]).toBeLessThanOrEqual(bbox.zMax);
    }

    // Verify no points were missed by brute force
    let bruteCount = 0;
    for (let i = 0; i < n; i++) {
      if (
        x[i] >= bbox.xMin &&
        x[i] <= bbox.xMax &&
        y[i] >= bbox.yMin &&
        y[i] <= bbox.yMax &&
        z[i] >= bbox.zMin &&
        z[i] <= bbox.zMax
      ) {
        bruteCount++;
      }
    }
    expect(result.length).toBe(bruteCount);
  });

  it("empty box returns empty", async () => {
    const { x, y, z } = randomPoints(500, 0, 100);
    const tree = await buildOctree(x, y, z);

    // Query a box entirely outside the data range
    const result = queryRange3d(tree, {
      xMin: 200,
      xMax: 300,
      yMin: 200,
      yMax: 300,
      zMin: 200,
      zMax: 300,
    });
    expect(result.length).toBe(0);
  });

  it("full box returns all", async () => {
    const n = 200;
    const { x, y, z } = randomPoints(n, 10, 50);
    const tree = await buildOctree(x, y, z);

    const result = queryRange3d(tree, {
      xMin: -1000,
      xMax: 1000,
      yMin: -1000,
      yMax: 1000,
      zMin: -1000,
      zMax: 1000,
    });
    expect(result.length).toBe(n);
  });
});

describe("queryNearest3d", () => {
  it("finds closest point", async () => {
    // Place a known point at (50, 50, 50) among random data
    const n = 500;
    const { x, y, z } = randomPoints(n, 0, 100);

    // Overwrite first point to be at a known location
    x[0] = 50;
    y[0] = 50;
    z[0] = 50;

    const tree = await buildOctree(x, y, z);

    // Query nearest to (50, 50, 50) - should find index 0
    const result = queryNearest3d(tree, 50, 50, 50, 1);
    expect(result.length).toBe(1);
    expect(result[0]).toBe(0);
  });

  it("returns k nearest neighbors", async () => {
    const n = 100;
    const { x, y, z } = randomPoints(n, 0, 100);
    const tree = await buildOctree(x, y, z);

    const k = 5;
    const result = queryNearest3d(tree, 50, 50, 50, k);
    expect(result.length).toBe(k);

    // Verify returned points are the actual k nearest by brute force
    const dists = Array.from({ length: n }, (_, i) => ({
      idx: i,
      dist: (x[i] - 50) ** 2 + (y[i] - 50) ** 2 + (z[i] - 50) ** 2,
    }));
    dists.sort((a, b) => a.dist - b.dist);
    const bruteTopK = new Set(dists.slice(0, k).map((d) => d.idx));

    for (const idx of result) {
      expect(bruteTopK.has(idx)).toBe(true);
    }
  });
});

describe("frustumCull", () => {
  it("culls with a simple axis-aligned frustum (identity MVP)", async () => {
    // Identity matrix: frustum is the [-1,1]^3 cube in NDC
    const mvp = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

    // Points inside [-1,1]^3
    const x = new Float64Array([0, 0.5, -0.5, 2, -3]);
    const y = new Float64Array([0, 0.5, -0.5, 2, -3]);
    const z = new Float64Array([0, 0.5, -0.5, 2, -3]);

    const result = await frustumCull(x, y, z, mvp);

    // Points 0, 1, 2 are inside; 3, 4 are outside
    const resultSet = new Set(Array.from(result));
    expect(resultSet.has(0)).toBe(true);
    expect(resultSet.has(1)).toBe(true);
    expect(resultSet.has(2)).toBe(true);
    expect(resultSet.has(3)).toBe(false);
    expect(resultSet.has(4)).toBe(false);
  });

  it("returns empty for points all outside frustum", async () => {
    const mvp = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

    const x = new Float64Array([5, 10, -5]);
    const y = new Float64Array([5, 10, -5]);
    const z = new Float64Array([5, 10, -5]);

    const result = await frustumCull(x, y, z, mvp);
    expect(result.length).toBe(0);
  });

  it("handles empty input", async () => {
    const mvp = new Float64Array(16);
    mvp[0] = 1;
    mvp[5] = 1;
    mvp[10] = 1;
    mvp[15] = 1;

    const result = await frustumCull(
      new Float64Array(0),
      new Float64Array(0),
      new Float64Array(0),
      mvp,
    );
    expect(result.length).toBe(0);
  });
});
