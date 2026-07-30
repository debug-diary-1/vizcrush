import { describe, test, expect } from "vitest";
import * as fc from "fast-check";
import { sortBy, normalize, filterRange } from "./index.js";

describe("sortBy", () => {
  test("sorts ascending by default", async () => {
    const data = new Float64Array([5, 3, 1, 4, 2]);
    const result = await sortBy(data);
    expect(Array.from(result)).toEqual([1, 2, 3, 4, 5]);
  });

  test("sorts descending when flag is set", async () => {
    const data = new Float64Array([5, 3, 1, 4, 2]);
    const result = await sortBy(data, undefined, true);
    expect(Array.from(result)).toEqual([5, 4, 3, 2, 1]);
  });

  test("sorts negative numbers correctly", async () => {
    const data = new Float64Array([-3, 1, -1, 0, 2]);
    const result = await sortBy(data);
    expect(Array.from(result)).toEqual([-3, -1, 0, 1, 2]);
  });

  test("sorts data according to key order", async () => {
    const data = new Float64Array([10, 20, 30, 40, 50]);
    const keys = new Float64Array([3, 1, 4, 2, 5]);
    const result = await sortBy(data, keys);
    // keys sorted ascending: 1->20, 2->40, 3->10, 4->30, 5->50
    expect(Array.from(result)).toEqual([20, 40, 10, 30, 50]);
  });

  test("returns empty array for empty input", async () => {
    const data = new Float64Array([]);
    const result = await sortBy(data);
    expect(result.length).toBe(0);
  });

  test("returns same value for single element", async () => {
    const data = new Float64Array([42]);
    const result = await sortBy(data);
    expect(Array.from(result)).toEqual([42]);
  });
});

describe("normalize", () => {
  test("normalizes [0, 50, 100] to [0, 0.5, 1]", async () => {
    const data = new Float64Array([0, 50, 100]);
    const result = await normalize(data);
    expect(Array.from(result)).toEqual([0, 0.5, 1]);
  });

  test("normalizes with custom range", async () => {
    const data = new Float64Array([0, 50, 100]);
    const result = await normalize(data, [0, 200]);
    // (0-0)/200=0, (50-0)/200=0.25, (100-0)/200=0.5
    expect(Array.from(result)).toEqual([0, 0.25, 0.5]);
  });

  test("returns all zeros when all values are the same", async () => {
    const data = new Float64Array([7, 7, 7]);
    const result = await normalize(data);
    expect(Array.from(result)).toEqual([0, 0, 0]);
  });

  test("returns empty array for empty input", async () => {
    const data = new Float64Array([]);
    const result = await normalize(data);
    expect(result.length).toBe(0);
  });
});

describe("filterRange", () => {
  test("filters values within range", () => {
    const x = new Float64Array([1, 2, 3, 4, 5]);
    const y = new Float64Array([10, 20, 30, 40, 50]);
    const result = filterRange(x, y, 2, 4);
    expect(Array.from(result.x)).toEqual([2, 3, 4]);
    expect(Array.from(result.y)).toEqual([20, 30, 40]);
  });

  test("returns empty arrays when no values match", () => {
    const x = new Float64Array([1, 2, 3]);
    const y = new Float64Array([10, 20, 30]);
    const result = filterRange(x, y, 5, 10);
    expect(result.x.length).toBe(0);
    expect(result.y.length).toBe(0);
  });

  test("returns all values when all match", () => {
    const x = new Float64Array([2, 3, 4]);
    const y = new Float64Array([20, 30, 40]);
    const result = filterRange(x, y, 1, 5);
    expect(Array.from(result.x)).toEqual([2, 3, 4]);
    expect(Array.from(result.y)).toEqual([20, 30, 40]);
  });
});

describe("property-based tests", () => {
  test("sortBy ascending output is always non-decreasing", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.float64Array({ minLength: 0, maxLength: 200, noNaN: true, noDefaultInfinity: true }),
        async (arr) => {
          const result = await sortBy(new Float64Array(arr));
          for (let i = 1; i < result.length; i++) {
            expect(result[i]).toBeGreaterThanOrEqual(result[i - 1]);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  test("sortBy descending output is always non-increasing", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.float64Array({ minLength: 0, maxLength: 200, noNaN: true, noDefaultInfinity: true }),
        async (arr) => {
          const result = await sortBy(new Float64Array(arr), undefined, true);
          for (let i = 1; i < result.length; i++) {
            expect(result[i]).toBeLessThanOrEqual(result[i - 1]);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  test("normalize output is always in [0, 1]", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.float64Array({
          minLength: 2,
          maxLength: 200,
          noNaN: true,
          noDefaultInfinity: true,
          min: -1e100,
          max: 1e100,
        }),
        async (arr) => {
          const result = await normalize(new Float64Array(arr));
          for (let i = 0; i < result.length; i++) {
            if (!isNaN(result[i])) {
              expect(result[i]).toBeGreaterThanOrEqual(0);
              expect(result[i]).toBeLessThanOrEqual(1);
            }
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});
