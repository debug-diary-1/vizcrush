import { describe, test, expect } from "vitest";
import * as fc from "fast-check";
import {
  buildQuadtree,
  queryRange,
  queryNearest,
  buildHashGrid,
  hashGridQueryRadius,
  hashGridQueryRange,
} from "./index.js";

describe("buildQuadtree", () => {
  test("empty data", async () => {
    const tree = await buildQuadtree(new Float64Array([]), new Float64Array([]));
    expect(tree.pointCount).toBe(0);
  });

  test("single point", async () => {
    const tree = await buildQuadtree(new Float64Array([5]), new Float64Array([10]));
    expect(tree.pointCount).toBe(1);
    expect(tree.bounds.xMin).toBeLessThanOrEqual(5);
    expect(tree.bounds.xMax).toBeGreaterThanOrEqual(5);
  });

  test("1000 points", async () => {
    const n = 1000;
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = i % 100;
      y[i] = Math.floor(i / 100);
    }

    const tree = await buildQuadtree(x, y);
    expect(tree.pointCount).toBe(n);
    expect(tree.id).toBeTruthy();
  });
});

describe("queryRange", () => {
  test("returns points within bounding box", async () => {
    const n = 1000;
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = i % 100;
      y[i] = Math.floor(i / 100);
    }

    const tree = await buildQuadtree(x, y);
    const result = queryRange(tree, { xMin: 10, xMax: 20, yMin: 2, yMax: 5 });

    expect(result.length).toBeGreaterThan(0);
    for (const idx of result) {
      expect(x[idx]).toBeGreaterThanOrEqual(10);
      expect(x[idx]).toBeLessThanOrEqual(20);
      expect(y[idx]).toBeGreaterThanOrEqual(2);
      expect(y[idx]).toBeLessThanOrEqual(5);
    }
  });

  test("full range returns all points", async () => {
    const x = new Float64Array([0, 50, 100]);
    const y = new Float64Array([0, 50, 100]);
    const tree = await buildQuadtree(x, y);
    const result = queryRange(tree, { xMin: -1, xMax: 101, yMin: -1, yMax: 101 });
    expect(result.length).toBe(3);
  });

  test("empty range returns no points", async () => {
    const x = new Float64Array([0, 1, 2]);
    const y = new Float64Array([0, 1, 2]);
    const tree = await buildQuadtree(x, y);
    const result = queryRange(tree, { xMin: 100, xMax: 200, yMin: 100, yMax: 200 });
    expect(result.length).toBe(0);
  });

  test("property: all returned indices are within bounds", async () => {
    const n = 500;
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = Math.random() * 1000;
      y[i] = Math.random() * 1000;
    }

    const tree = await buildQuadtree(x, y);

    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: 0, max: 500, noNaN: true }),
        fc.double({ min: 500, max: 1000, noNaN: true }),
        fc.double({ min: 0, max: 500, noNaN: true }),
        fc.double({ min: 500, max: 1000, noNaN: true }),
        async (xMin, xMax, yMin, yMax) => {
          const result = queryRange(tree, { xMin, xMax, yMin, yMax });
          for (const idx of result) {
            expect(x[idx]).toBeGreaterThanOrEqual(xMin);
            expect(x[idx]).toBeLessThanOrEqual(xMax);
            expect(y[idx]).toBeGreaterThanOrEqual(yMin);
            expect(y[idx]).toBeLessThanOrEqual(yMax);
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});

describe("queryNearest", () => {
  test("finds closest point", async () => {
    const x = new Float64Array([0, 10, 20, 30, 40]);
    const y = new Float64Array([0, 10, 20, 30, 40]);
    const tree = await buildQuadtree(x, y);

    const result = queryNearest(tree, 11, 11, 1);
    expect(result.length).toBe(1);
    expect(result[0]).toBe(1); // (10, 10) is closest to (11, 11)
  });

  test("finds k nearest", async () => {
    const x = new Float64Array([0, 10, 20, 30, 40]);
    const y = new Float64Array([0, 10, 20, 30, 40]);
    const tree = await buildQuadtree(x, y);

    const result = queryNearest(tree, 15, 15, 3);
    expect(result.length).toBe(3);
    // (10,10) and (20,20) should be in the top 3
    expect(Array.from(result)).toContain(1);
    expect(Array.from(result)).toContain(2);
  });

  test("k=0 returns empty", async () => {
    const tree = await buildQuadtree(new Float64Array([1]), new Float64Array([1]));
    expect(queryNearest(tree, 0, 0, 0).length).toBe(0);
  });

  test("empty tree returns empty", async () => {
    const tree = await buildQuadtree(new Float64Array([]), new Float64Array([]));
    expect(queryNearest(tree, 0, 0, 5).length).toBe(0);
  });
});

describe("buildHashGrid", () => {
  test("empty data", async () => {
    const grid = await buildHashGrid(new Float64Array([]), new Float64Array([]), 1);
    expect(grid.count).toBe(0);
    expect(grid.cellCount).toBe(0);
  });

  test("groups points into cells", async () => {
    const x = new Float64Array([0.1, 0.2, 5.0]);
    const y = new Float64Array([0.1, 0.2, 5.0]);
    const grid = await buildHashGrid(x, y, 1);
    expect(grid.count).toBe(3);
    expect(grid.cellCount).toBe(2); // (0,0)-cell holds two points, (5,5)-cell holds one
  });

  test("skips non-finite coordinates", async () => {
    const x = new Float64Array([1, NaN, 2, Infinity]);
    const y = new Float64Array([1, 1, NaN, 1]);
    const grid = await buildHashGrid(x, y, 1);
    expect(grid.count).toBe(1);
  });

  test("backend: 'js' forces the JS core", async () => {
    const x = new Float64Array([0, 1, 2]);
    const y = new Float64Array([0, 1, 2]);
    const grid = await buildHashGrid(x, y, 1, { backend: "js" });
    expect(grid.count).toBe(3);
    // Adapter identity is private — the handle exposes metadata only, and
    // queries work without callers knowing which adapter ran.
    expect(Object.keys(grid).sort()).toEqual(["cellCount", "cellSize", "count"]);
    expect(Array.from(hashGridQueryRadius(grid, 0, 0, 1.5)).sort()).toEqual([0, 1]);
  });

  test("a foreign object is rejected, not silently empty", () => {
    const fake = { cellSize: 1, count: 3, cellCount: 3 };
    expect(() => hashGridQueryRadius(fake, 0, 0, 1)).toThrow(/not a live hash-grid handle/i);
  });
});

describe("hashGridQueryRadius", () => {
  test("returns points within radius", async () => {
    const x = new Float64Array([0, 1, 2, 10]);
    const y = new Float64Array([0, 0, 0, 0]);
    const grid = await buildHashGrid(x, y, 1);
    const result = hashGridQueryRadius(grid, 0, 0, 1.5);
    expect(Array.from(result).sort()).toEqual([0, 1]);
  });

  test("property: all returned indices are within radius, JS and WASM agree", async () => {
    const n = 500;
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = Math.random() * 1000;
      y[i] = Math.random() * 1000;
    }
    const cellSize = 20;
    const jsGrid = await buildHashGrid(x, y, cellSize, { backend: "js" });
    const wasmGrid = await buildHashGrid(x, y, cellSize, { backend: "wasm" });

    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: 0, max: 1000, noNaN: true }),
        fc.double({ min: 0, max: 1000, noNaN: true }),
        fc.double({ min: 1, max: 50, noNaN: true }),
        async (px, py, radius) => {
          const jsResult = hashGridQueryRadius(jsGrid, px, py, radius);
          for (const idx of jsResult) {
            const dx = x[idx] - px;
            const dy = y[idx] - py;
            expect(dx * dx + dy * dy).toBeLessThanOrEqual(radius * radius + 1e-9);
          }

          // The WASM adapter only actually ran if a build was present in this
          // environment; when it wasn't, buildHashGrid silently fell back to
          // JS (same as the kernel does everywhere else), so both handles
          // would carry `_core` and comparing them is a JS-vs-JS no-op — still
          // correct, just not a real cross-adapter check in that case.
          const wasmResult = hashGridQueryRadius(wasmGrid, px, py, radius);
          expect(new Set(Array.from(wasmResult))).toEqual(new Set(Array.from(jsResult)));
        },
      ),
      { numRuns: 20 },
    );
  });
});

describe("hashGridQueryRange", () => {
  test("returns points within bounding box", async () => {
    const x = new Float64Array([0, 1, 2, 10]);
    const y = new Float64Array([0, 1, 2, 10]);
    const grid = await buildHashGrid(x, y, 1);
    const result = hashGridQueryRange(grid, 0, 1.5, 0, 1.5);
    expect(Array.from(result).sort()).toEqual([0, 1]);
  });

  test("empty range returns no points", async () => {
    const x = new Float64Array([0, 1, 2]);
    const y = new Float64Array([0, 1, 2]);
    const grid = await buildHashGrid(x, y, 1);
    const result = hashGridQueryRange(grid, 100, 200, 100, 200);
    expect(result.length).toBe(0);
  });
});
