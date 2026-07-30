import { describe, test, expect } from "vitest";
import * as fc from "fast-check";
import { bin1d, bin2d, hexbin } from "./index.js";
import { bin1dCore, bin2dCore, hexbinCore } from "./cores.js";

describe("bin1d", () => {
  test("uniform distribution has roughly equal counts", async () => {
    const data = new Float64Array(1000);
    for (let i = 0; i < 1000; i++) data[i] = i;

    const result = await bin1d(data, 10);
    expect(result.counts.length).toBe(10);
    expect(result.edges.length).toBe(11);

    const total = Array.from(result.counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(1000);

    // Each bin should have ~100
    for (const c of result.counts) {
      expect(c).toBeGreaterThan(50);
      expect(c).toBeLessThan(150);
    }
  });

  test("respects custom range", async () => {
    const data = new Float64Array([5, 15, 25, 35, 45]);
    const result = await bin1d(data, 5, [0, 50]);
    expect(result.edges[0]).toBe(0);
    expect(result.edges[5]).toBe(50);
    expect(result.counts.length).toBe(5);
  });

  test("single value", async () => {
    const result = await bin1d(new Float64Array([42]), 5);
    const total = Array.from(result.counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(1);
  });

  test("empty array", async () => {
    const result = await bin1d(new Float64Array([]), 10);
    expect(result.counts.length).toBe(10);
    const total = Array.from(result.counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(0);
  });

  test("property: total counts equals input length", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.float64Array({
          minLength: 1,
          maxLength: 500,
          noNaN: true,
          noDefaultInfinity: true,
          min: -1e6,
          max: 1e6,
        }),
        fc.integer({ min: 1, max: 100 }),
        async (arr, bins) => {
          const data = new Float64Array(arr);
          const result = await bin1d(data, bins);
          const total = Array.from(result.counts).reduce((a, b) => a + b, 0);
          expect(total).toBe(data.length);
        },
      ),
      { numRuns: 30 },
    );
  });
});

describe("bin2d", () => {
  test("basic 2D binning", async () => {
    const x = new Float64Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const y = new Float64Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    const result = await bin2d(x, y, { xBins: 4, yBins: 4 });
    expect(result.grid.length).toBe(16);
    expect(result.xEdges.length).toBe(5);
    expect(result.yEdges.length).toBe(5);
    expect(result.maxCount).toBeGreaterThan(0);

    const total = Array.from(result.grid).reduce((a, b) => a + b, 0);
    expect(total).toBe(10);
  });

  test("custom range", async () => {
    const x = new Float64Array([1, 2, 3]);
    const y = new Float64Array([1, 2, 3]);
    const result = await bin2d(x, y, { xBins: 2, yBins: 2, xRange: [0, 4], yRange: [0, 4] });
    expect(result.xEdges[0]).toBe(0);
    expect(result.xEdges[2]).toBe(4);
  });

  test("single point", async () => {
    const result = await bin2d(new Float64Array([5]), new Float64Array([5]), {
      xBins: 2,
      yBins: 2,
    });
    const total = Array.from(result.grid).reduce((a, b) => a + b, 0);
    expect(total).toBe(1);
  });
});

describe("hexbin", () => {
  test("real JS core bins every point (total count preserved)", async () => {
    const x = new Float64Array([0, 1, 1.1, 5, 5.1]);
    const y = new Float64Array([0, 0.1, 0.2, 5, 5.1]);
    const result = await hexbin(x, y, 1.0);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    const totalCount = result.reduce((sum, e) => sum + e.count, 0);
    expect(totalCount).toBe(5);
  });

  test("each entry has correct shape", async () => {
    const x = new Float64Array([0, 10]);
    const y = new Float64Array([0, 10]);
    const result = await hexbin(x, y, 5);
    expect(result.length).toBeGreaterThan(0);
    for (const entry of result) {
      expect(typeof entry.cx).toBe("number");
      expect(typeof entry.cy).toBe("number");
      expect(entry.count).toBeGreaterThan(0);
    }
  });

  test("empty input yields empty result", () => {
    expect(hexbinCore(new Float64Array([]), new Float64Array([]), 1)).toEqual([]);
  });
});

describe("sync cores (the MCP server's shared implementation)", () => {
  test("bin1dCore matches the async bin1d shell", async () => {
    const data = new Float64Array([5, 15, 25, 35, 45]);
    const sync = bin1dCore(data, 5, [0, 50]);
    const asyncResult = await bin1d(data, 5, [0, 50]);
    expect(Array.from(sync.counts)).toEqual(Array.from(asyncResult.counts));
    expect(Array.from(sync.edges)).toEqual(Array.from(asyncResult.edges));
  });

  test("bin1dCore total count equals input length", () => {
    const data = new Float64Array(1000);
    for (let i = 0; i < 1000; i++) data[i] = i;
    const r = bin1dCore(data, 10);
    const total = Array.from(r.counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(1000);
  });

  test("bin2dCore total count equals input length", () => {
    const x = new Float64Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const y = new Float64Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const r = bin2dCore(x, y, 4, 4, NaN, NaN, NaN, NaN);
    const total = Array.from(r.grid).reduce((a, b) => a + b, 0);
    expect(total).toBe(10);
  });

  test("backend: 'js' forces the JS core", async () => {
    const data = new Float64Array([1, 2, 3, 4, 5]);
    const r = await bin1d(data, 5, undefined, { backend: "js" });
    const total = Array.from(r.counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(5);
  });
});
