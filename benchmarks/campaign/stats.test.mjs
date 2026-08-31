import { describe, expect, it } from "vitest";
import {
  bootstrapMedianCi,
  describe as describeSamples,
  mean,
  median,
  quantile,
  relativeStdDevPct,
  sorted,
} from "./stats.mjs";

describe("sorted", () => {
  it("sorts ascending without mutating the input", () => {
    const xs = [3, 1, 2];
    expect(sorted(xs)).toEqual([1, 2, 3]);
    expect(xs).toEqual([3, 1, 2]);
  });
});

describe("quantile / median / mean", () => {
  it("interpolates between order statistics", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3, 4], 0)).toBe(1);
    expect(quantile([1, 2, 3, 4], 1)).toBe(4);
    expect(quantile([4, 1, 3, 2], 0.25)).toBe(1.75);
  });

  it("computes the median for odd and even lengths", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("computes the mean", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
  });
});

describe("relativeStdDevPct", () => {
  it("is zero for constant samples", () => {
    expect(relativeStdDevPct([5, 5, 5])).toBe(0);
  });

  it("matches a hand-computed value", () => {
    // mean 3, population variance ((−2)² + 0² + 2²)/3 = 8/3.
    expect(relativeStdDevPct([1, 3, 5])).toBeCloseTo((Math.sqrt(8 / 3) / 3) * 100, 10);
  });
});

describe("bootstrapMedianCi", () => {
  const samples = [1.1, 1.2, 1.15, 1.3, 1.25, 1.18, 1.22, 1.19, 1.21, 1.24];

  it("is deterministic for a fixed seed", () => {
    expect(bootstrapMedianCi(samples)).toEqual(bootstrapMedianCi(samples));
  });

  it("brackets the sample median", () => {
    const [lo, hi] = bootstrapMedianCi(samples);
    expect(lo).toBeLessThanOrEqual(median(samples));
    expect(hi).toBeGreaterThanOrEqual(median(samples));
  });
});

describe("describe", () => {
  it("orders its summary statistics and counts the samples", () => {
    const stats = describeSamples([4, 2, 5, 1, 3]);
    expect(stats.n).toBe(5);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(5);
    expect(stats.median).toBe(3);
    expect(stats.min).toBeLessThanOrEqual(stats.q1);
    expect(stats.q1).toBeLessThanOrEqual(stats.median);
    expect(stats.median).toBeLessThanOrEqual(stats.q3);
    expect(stats.q3).toBeLessThanOrEqual(stats.max);
    expect(stats.ci95WithinSession).toHaveLength(2);
  });
});
