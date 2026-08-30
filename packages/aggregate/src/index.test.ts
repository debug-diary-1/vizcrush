import { describe, test, expect } from "vitest";
import * as fc from "fast-check";
import { stats, percentile, streamingStats, StreamingStats, appendAndDownsample } from "./index.js";

describe("stats", () => {
  test("basic [1,2,3,4,5]", async () => {
    const data = new Float64Array([1, 2, 3, 4, 5]);
    const result = await stats(data);

    expect(result.count).toBe(5);
    expect(result.min).toBe(1);
    expect(result.max).toBe(5);
    expect(result.mean).toBe(3);
    // Sample variance with N-1 denominator: sum((xi-3)^2) / 4 = 10/4 = 2.5
    expect(result.variance).toBeCloseTo(2.5, 5);
    expect(result.stdDev).toBeCloseTo(Math.sqrt(2.5), 5);
  });

  test("empty array returns count=0 and NaN for min/max/mean", async () => {
    const data = new Float64Array([]);
    const result = await stats(data);

    expect(result.count).toBe(0);
    expect(result.min).toBeNaN();
    expect(result.max).toBeNaN();
    expect(result.mean).toBeNaN();
  });

  test("single value", async () => {
    const data = new Float64Array([42]);
    const result = await stats(data);

    expect(result.count).toBe(1);
    expect(result.min).toBe(42);
    expect(result.max).toBe(42);
    expect(result.mean).toBe(42);
    expect(result.variance).toBe(0);
    expect(result.stdDev).toBe(0);
  });

  test("large array of 10000 values has approximately correct mean", async () => {
    const size = 10_000;
    const data = new Float64Array(size);
    for (let i = 0; i < size; i++) {
      data[i] = i;
    }

    const result = await stats(data);

    expect(result.count).toBe(size);
    expect(result.min).toBe(0);
    expect(result.max).toBe(size - 1);
    expect(result.mean).toBeCloseTo((size - 1) / 2, 1);
  });
});

describe("percentile", () => {
  test("[0..100] with [25,50,75] returns approximately [25,50,75]", async () => {
    const data = new Float64Array(101);
    for (let i = 0; i <= 100; i++) {
      data[i] = i;
    }

    const result = await percentile(data, [25, 50, 75]);

    expect(result).toBeInstanceOf(Float64Array);
    expect(result.length).toBe(3);
    expect(result[0]).toBeCloseTo(25, 0);
    expect(result[1]).toBeCloseTo(50, 0);
    expect(result[2]).toBeCloseTo(75, 0);
  });

  test("empty array returns NaN values", async () => {
    const data = new Float64Array([]);
    const result = await percentile(data, [50]);

    expect(result.length).toBe(1);
    expect(result[0]).toBeNaN();
  });
});

describe("streamingStats", () => {
  test("push 5 values into window=5 gives correct mean/min/max", () => {
    const ss = streamingStats(5);

    ss.push(1);
    ss.push(2);
    ss.push(3);
    ss.push(4);
    ss.push(5);

    expect(ss.length).toBe(5);
    expect(ss.mean).toBe(3);
    expect(ss.min).toBe(1);
    expect(ss.max).toBe(5);
  });

  test("push 10 values into window=3 retains only last 3", () => {
    const ss = streamingStats(3);

    for (let i = 1; i <= 10; i++) {
      ss.push(i);
    }

    // Last 3 values: 8, 9, 10
    expect(ss.length).toBe(3);
    expect(ss.min).toBe(8);
    expect(ss.max).toBe(10);
    expect(ss.mean).toBeCloseTo(9, 5);
  });

  test("window=1 replaces its only value without corrupting statistics", () => {
    const ss = streamingStats(1);
    ss.push(10);
    ss.push(20);

    expect(ss.length).toBe(1);
    expect(ss.mean).toBe(20);
    expect(ss.min).toBe(20);
    expect(ss.max).toBe(20);
    expect(ss.variance).toBe(0);
  });

  test("pushBatch adds multiple values at once", () => {
    const ss = streamingStats(10);

    ss.pushBatch(new Float64Array([10, 20, 30, 40, 50]));

    expect(ss.length).toBe(5);
    expect(ss.min).toBe(10);
    expect(ss.max).toBe(50);
    expect(ss.mean).toBe(30);
  });

  test("variance and stdDev are computed correctly", () => {
    const ss = streamingStats(5);
    ss.push(2);
    ss.push(4);
    ss.push(4);
    ss.push(4);
    ss.push(5);

    // mean = 3.8, sample variance (N-1 denominator)
    expect(ss.mean).toBeCloseTo(3.8, 5);
    const sampleVariance = [2, 4, 4, 4, 5].reduce((sum, v) => sum + (v - 3.8) ** 2, 0) / 4;
    expect(ss.variance).toBeCloseTo(sampleVariance, 3);
    expect(ss.stdDev).toBeCloseTo(Math.sqrt(ss.variance), 5);
  });
});

describe("StreamingStats class", () => {
  test("can be instantiated directly", () => {
    const ss = new StreamingStats(5);
    expect(ss.length).toBe(0);
  });
});

describe("property-based tests", () => {
  test("for any non-empty Float64Array, min <= mean <= max", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.float64Array({
          minLength: 1,
          maxLength: 500,
          noNaN: true,
          noDefaultInfinity: true,
          min: -1e100,
          max: 1e100,
        }),
        async (arr) => {
          const data = new Float64Array(arr);
          const result = await stats(data);

          expect(result.count).toBe(data.length);
          if (isFinite(result.mean)) {
            expect(result.min).toBeLessThanOrEqual(result.mean);
            expect(result.mean).toBeLessThanOrEqual(result.max);
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe("appendAndDownsample", () => {
  test("throws instead of returning fabricated data", () => {
    // It used to return array indices for any input: 500 points of 42.0 with a
    // spike of 9999 came back as 0, 50, 100 ... 450. That charts as a clean
    // diagonal, so nobody could see it was wrong. Throwing is the fix.
    const acc = streamingStats(1000);
    const data = new Float64Array(500).fill(42);
    data[250] = 9999;
    expect(() => appendAndDownsample(acc, data, 10)).toThrow(/never implemented/i);
  });

  test("names the replacement in the error", () => {
    const acc = streamingStats(16);
    expect(() => appendAndDownsample(acc, new Float64Array([1, 2, 3]), 2)).toThrow(
      /@vizcrush\/downsample/,
    );
  });
});
