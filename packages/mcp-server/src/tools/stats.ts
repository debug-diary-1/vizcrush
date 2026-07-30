import { statsCore, percentileCore } from "@vizcrush/aggregate";
import { normalizeCore, sortCore } from "@vizcrush/transform";
import type { StatsInputType, NormalizeInputType, SortInputType } from "../schemas.js";

export function handleStats(input: StatsInputType) {
  const start = performance.now();
  // Calls the shared aggregate cores — the same implementations the package's
  // async shells dispatch to, so MCP and direct package use cannot drift.
  const data = new Float64Array(input.data);
  const s = statsCore(data);
  const pcts = percentileCore(data, input.percentiles);

  const percentiles: Record<string, number> = {};
  input.percentiles.forEach((p, i) => {
    percentiles[`p${p}`] = pcts[i];
  });

  const elapsed = performance.now() - start;

  return {
    count: s.count,
    min: s.count > 0 ? s.min : null,
    max: s.count > 0 ? s.max : null,
    mean: s.count > 0 ? s.mean : null,
    std_dev: s.count > 0 ? s.stdDev : null,
    percentiles,
    elapsed_ms: Math.round(elapsed * 100) / 100,
  };
}

export function handleNormalize(input: NormalizeInputType) {
  const start = performance.now();
  // Calls the shared transform core — the same implementation the package's
  // async shell dispatches to, so MCP and direct package use cannot drift.
  const out = normalizeCore(new Float64Array(input.data), NaN, NaN);
  const data = Array.from(out, (v) => (Number.isFinite(v) ? v : null));
  const elapsed = performance.now() - start;
  return { data, elapsed_ms: Math.round(elapsed * 100) / 100 };
}

export function handleSort(input: SortInputType) {
  const start = performance.now();
  // Calls the shared transform core (radix-sort JS adapter).
  const out = sortCore(new Float64Array(input.data), input.descending);
  const elapsed = performance.now() - start;
  return { data: Array.from(out), elapsed_ms: Math.round(elapsed * 100) / 100 };
}
