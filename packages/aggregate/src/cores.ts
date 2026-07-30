import type { StatsResult } from "@vizcrush/core";

/**
 * Pure, synchronous JS cores for the WASM-backed aggregate algorithms (stats,
 * percentile). These are the kernel's JS adapters: no WASM, no loading, no
 * async. They are imported directly by the async shells in `index.ts`, by the
 * parity harness, and by the MCP server — so there is exactly one
 * implementation of each algorithm in JS.
 *
 * Each core mirrors its Rust/WASM counterpart so the parity harness can assert
 * JS ≡ WASM on identical input. The streaming sketch classes (StreamingStats,
 * DDSketch, KllSketch, HyperLogLog, CountMinSketch) have no WASM path and live
 * in `index.ts` unchanged.
 */

/**
 * Single-pass summary statistics (Welford's online algorithm) with inline
 * min/max. Mirrors `vizcrush_aggregate::compute_stats`, including the empty /
 * all-non-finite handling.
 */
export function statsCore(data: Float64Array): StatsResult {
  if (data.length === 0) {
    return { count: 0, min: NaN, max: NaN, mean: NaN, stdDev: NaN, variance: NaN };
  }

  let count = 0;
  let min = Infinity;
  let max = -Infinity;
  let mean = 0;
  let m2 = 0;

  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (!isFinite(v)) continue;
    count++;
    if (v < min) min = v;
    if (v > max) max = v;
    const delta = v - mean;
    mean += delta / count;
    const delta2 = v - mean;
    m2 += delta * delta2;
  }

  if (count === 0) {
    return { count: 0, min: NaN, max: NaN, mean: NaN, stdDev: NaN, variance: NaN };
  }

  const variance = count > 1 ? m2 / (count - 1) : 0;
  return { count, min, max, mean, stdDev: Math.sqrt(variance), variance };
}

/**
 * Exact percentiles via sorting with linear interpolation between ranks.
 * Mirrors `vizcrush_aggregate::compute_percentiles`, including the
 * `lower === upper || upper >= n` guard and the empty/all-non-finite handling.
 */
export function percentileCore(data: Float64Array, p: number[]): Float64Array {
  if (data.length === 0 || p.length === 0) {
    return new Float64Array(p.map(() => NaN));
  }

  const sorted = Array.from(data)
    .filter(isFinite)
    .sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return new Float64Array(p.map(() => NaN));

  return new Float64Array(
    p.map((pct) => {
      const clamped = Math.max(0, Math.min(100, pct));
      const rank = (clamped / 100) * (n - 1);
      const lower = Math.floor(rank);
      const upper = Math.ceil(rank);
      if (lower === upper || upper >= n) {
        return sorted[Math.min(lower, n - 1)];
      }
      const frac = rank - lower;
      return sorted[lower] * (1 - frac) + sorted[upper] * frac;
    }),
  );
}
