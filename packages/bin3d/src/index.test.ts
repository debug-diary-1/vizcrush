import { describe, it, expect } from "vitest";
import { bin3d } from "./index.js";
import { bin3dCore } from "./cores.js";

describe("bin3dCore (sync — shared with MCP server)", () => {
  it("matches the async bin3d shell", async () => {
    const x = new Float64Array([1, 2, 3, 4, 5]);
    const y = new Float64Array([10, 20, 30, 40, 50]);
    const z = new Float64Array([100, 200, 300, 400, 500]);
    const opts = { xBins: 2, yBins: 2, zBins: 2 };
    const sync = bin3dCore(x, y, z, opts);
    const asyncResult = await bin3d(x, y, z, opts);
    expect(Array.from(sync.grid)).toEqual(Array.from(asyncResult.grid));
    expect(Array.from(sync.xEdges)).toEqual(Array.from(asyncResult.xEdges));
  });

  it("backend: 'js' forces the JS core", async () => {
    const x = new Float64Array([1, 2, 3]);
    const y = new Float64Array([1, 2, 3]);
    const z = new Float64Array([1, 2, 3]);
    const r = await bin3d(x, y, z, { xBins: 2, yBins: 2, zBins: 2 }, { backend: "js" });
    let total = 0;
    for (let i = 0; i < r.grid.length; i++) total += r.grid[i];
    expect(total).toBe(3);
  });
});

describe("bin3d", () => {
  it("basic 3D binning with 100 points in 4x4x4 grid, total count matches", async () => {
    const n = 100;
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    const z = new Float64Array(n);

    for (let i = 0; i < n; i++) {
      x[i] = Math.random() * 10;
      y[i] = Math.random() * 10;
      z[i] = Math.random() * 10;
    }

    const result = await bin3d(x, y, z, { xBins: 4, yBins: 4, zBins: 4 });

    expect(result.grid.length).toBe(4 * 4 * 4);
    expect(result.xEdges.length).toBe(5);
    expect(result.yEdges.length).toBe(5);
    expect(result.zEdges.length).toBe(5);

    // Sum of all bins should equal point count
    let total = 0;
    for (let i = 0; i < result.grid.length; i++) {
      total += result.grid[i];
    }
    expect(total).toBe(n);
    expect(result.maxCount).toBeGreaterThan(0);
  });

  it("auto range detection", async () => {
    const x = new Float64Array([1, 2, 3, 4, 5]);
    const y = new Float64Array([10, 20, 30, 40, 50]);
    const z = new Float64Array([100, 200, 300, 400, 500]);

    const result = await bin3d(x, y, z, { xBins: 2, yBins: 2, zBins: 2 });

    expect(result.xEdges[0]).toBe(1);
    expect(result.xEdges[2]).toBe(5);
    expect(result.yEdges[0]).toBe(10);
    expect(result.yEdges[2]).toBe(50);
    expect(result.zEdges[0]).toBe(100);
    expect(result.zEdges[2]).toBe(500);

    let total = 0;
    for (let i = 0; i < result.grid.length; i++) total += result.grid[i];
    expect(total).toBe(5);
  });

  it("single point", async () => {
    const x = new Float64Array([5]);
    const y = new Float64Array([5]);
    const z = new Float64Array([5]);

    const result = await bin3d(x, y, z, { xBins: 2, yBins: 2, zBins: 2 });

    let total = 0;
    for (let i = 0; i < result.grid.length; i++) total += result.grid[i];
    expect(total).toBe(1);
    expect(result.maxCount).toBe(1);
  });

  it("custom range", async () => {
    const n = 50;
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    const z = new Float64Array(n);

    for (let i = 0; i < n; i++) {
      x[i] = Math.random() * 100;
      y[i] = Math.random() * 100;
      z[i] = Math.random() * 100;
    }

    const result = await bin3d(x, y, z, {
      xBins: 5,
      yBins: 5,
      zBins: 5,
      xRange: [0, 100],
      yRange: [0, 100],
      zRange: [0, 100],
    });

    expect(result.grid.length).toBe(125);
    expect(result.xEdges[0]).toBe(0);
    expect(result.xEdges[5]).toBe(100);
    expect(result.yEdges[0]).toBe(0);
    expect(result.yEdges[5]).toBe(100);
    expect(result.zEdges[0]).toBe(0);
    expect(result.zEdges[5]).toBe(100);

    let total = 0;
    for (let i = 0; i < result.grid.length; i++) total += result.grid[i];
    expect(total).toBe(n);
  });

  it("handles default bin count", async () => {
    const x = new Float64Array([1, 2, 3]);
    const y = new Float64Array([1, 2, 3]);
    const z = new Float64Array([1, 2, 3]);

    const result = await bin3d(x, y, z);

    expect(result.grid.length).toBe(32 * 32 * 32);
  });
});
