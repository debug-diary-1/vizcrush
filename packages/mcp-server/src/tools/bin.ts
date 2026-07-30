import { bin1dCore, bin2dCore } from "@vizcrush/bin";
import type { HistogramInputType, Bin2dInputType } from "../schemas.js";

export function handleHistogram(input: HistogramInputType) {
  const start = performance.now();
  // Calls the shared bin1d core — the same implementation the package's async
  // shell dispatches to, so MCP and direct package use cannot drift.
  const data = new Float64Array(input.data);
  const result = bin1dCore(data, input.bins, input.range as [number, number] | undefined);
  const elapsed = performance.now() - start;

  return {
    counts: Array.from(result.counts),
    edges: Array.from(result.edges),
    elapsed_ms: Math.round(elapsed * 100) / 100,
  };
}

export function handleBin2d(input: Bin2dInputType) {
  const { x, y, x_bins, y_bins } = input;
  const start = performance.now();

  const xMin = input.x_range ? input.x_range[0] : NaN;
  const xMax = input.x_range ? input.x_range[1] : NaN;
  const yMin = input.y_range ? input.y_range[0] : NaN;
  const yMax = input.y_range ? input.y_range[1] : NaN;

  const result = bin2dCore(
    new Float64Array(x),
    new Float64Array(y),
    x_bins,
    y_bins,
    xMin,
    xMax,
    yMin,
    yMax,
  );

  // Reshape the flat row-major grid into the 2D array the MCP schema advertises.
  const grid: number[][] = Array.from({ length: y_bins }, (_, yi) =>
    Array.from({ length: x_bins }, (_, xi) => result.grid[yi * x_bins + xi]),
  );
  const elapsed = performance.now() - start;

  return {
    grid,
    x_edges: Array.from(result.xEdges),
    y_edges: Array.from(result.yEdges),
    max_count: result.maxCount,
    elapsed_ms: Math.round(elapsed * 100) / 100,
  };
}
