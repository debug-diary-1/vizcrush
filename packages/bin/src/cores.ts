import type { BinResult, Bin2dResult, HexBinEntry } from "@vizcrush/core";

/**
 * Pure, synchronous JS cores for every binning algorithm. These are the
 * kernel's JS adapters: no WASM, no loading, no async. They are imported
 * directly by the async shells in `index.ts`, by the parity harness, and by the
 * MCP server — so there is exactly one implementation of each algorithm in JS.
 *
 * Each core mirrors its Rust/WASM counterpart so the parity harness can assert
 * JS ≡ WASM on identical input.
 */

/** 1D histogram. Mirrors `vizcrush_bin::histogram`. */
export function bin1dCore(data: Float64Array, bins = 50, range?: [number, number]): BinResult {
  const rMin = range ? range[0] : NaN;
  const rMax = range ? range[1] : NaN;

  let minVal = isNaN(rMin) ? Infinity : rMin;
  let maxVal = isNaN(rMax) ? -Infinity : rMax;

  if (isNaN(rMin) || isNaN(rMax)) {
    for (let i = 0; i < data.length; i++) {
      if (isFinite(data[i])) {
        if (data[i] < minVal) minVal = data[i];
        if (data[i] > maxVal) maxVal = data[i];
      }
    }
  }

  // Handle edge case where range is zero or too small for meaningful binning.
  const range_ = maxVal - minVal;
  if (range_ <= 0 || !isFinite(range_) || range_ / bins === 0) {
    maxVal = minVal + 1;
  }

  const binWidth = (maxVal - minVal) / bins;
  const counts = new Uint32Array(bins);
  const edges = new Float64Array(bins + 1);

  for (let i = 0; i < data.length; i++) {
    if (!isFinite(data[i])) continue;
    let bin = Math.floor((data[i] - minVal) / binWidth);
    if (bin >= bins) bin = bins - 1;
    if (bin < 0) bin = 0;
    counts[bin]++;
  }

  for (let i = 0; i <= bins; i++) {
    edges[i] = minVal + i * binWidth;
  }

  return { counts, edges };
}

/**
 * Resolve the effective bin2d bounds: explicit (non-NaN) ranges win, NaN means
 * "scan the data". Shared by the JS core and the WebGPU path, which must
 * rebase inputs in f64 against these bounds before narrowing to f32.
 * Returns the raw bounds; degenerate-range adjustment stays with the callers.
 */
export function bin2dBounds(
  x: Float64Array,
  y: Float64Array,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
): { mnX: number; mxX: number; mnY: number; mxY: number } {
  let mnX = isNaN(xMin) ? Infinity : xMin;
  let mxX = isNaN(xMax) ? -Infinity : xMax;
  let mnY = isNaN(yMin) ? Infinity : yMin;
  let mxY = isNaN(yMax) ? -Infinity : yMax;

  if (isNaN(xMin) || isNaN(xMax) || isNaN(yMin) || isNaN(yMax)) {
    for (let i = 0; i < x.length; i++) {
      if (isFinite(x[i])) {
        if (x[i] < mnX) mnX = x[i];
        if (x[i] > mxX) mxX = x[i];
      }
      if (isFinite(y[i])) {
        if (y[i] < mnY) mnY = y[i];
        if (y[i] > mxY) mxY = y[i];
      }
    }
  }

  return { mnX, mxX, mnY, mxY };
}

/** 2D density grid. Mirrors `vizcrush_bin::bin2d`. */
export function bin2dCore(
  x: Float64Array,
  y: Float64Array,
  xBins: number,
  yBins: number,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
): Bin2dResult {
  const bounds = bin2dBounds(x, y, xMin, xMax, yMin, yMax);
  let { mnX, mxX, mnY, mxY } = bounds;

  if (mnX >= mxX) mxX = mnX + 1;
  if (mnY >= mxY) mxY = mnY + 1;

  const xWidth = (mxX - mnX) / xBins;
  const yWidth = (mxY - mnY) / yBins;
  const grid = new Uint32Array(xBins * yBins);
  let maxCount = 0;

  for (let i = 0; i < x.length; i++) {
    if (!isFinite(x[i]) || !isFinite(y[i])) continue;
    let xi = Math.floor((x[i] - mnX) / xWidth);
    let yi = Math.floor((y[i] - mnY) / yWidth);
    if (xi >= xBins) xi = xBins - 1;
    if (yi >= yBins) yi = yBins - 1;
    if (xi < 0) xi = 0;
    if (yi < 0) yi = 0;
    grid[yi * xBins + xi]++;
    if (grid[yi * xBins + xi] > maxCount) maxCount = grid[yi * xBins + xi];
  }

  const xEdges = new Float64Array(xBins + 1);
  const yEdges = new Float64Array(yBins + 1);
  for (let i = 0; i <= xBins; i++) xEdges[i] = mnX + i * xWidth;
  for (let i = 0; i <= yBins; i++) yEdges[i] = mnY + i * yWidth;

  return { grid, xEdges, yEdges, maxCount };
}

/**
 * Hexagonal binning using a sparse Map. Mirrors `vizcrush_bin::hexbin`:
 * a real implementation (no longer the empty-array stub). Only non-zero bins
 * are stored; hex centres are computed on output from (row, col) keys.
 */
export function hexbinCore(x: Float64Array, y: Float64Array, radius: number): HexBinEntry[] {
  const n = x.length;
  if (n === 0 || radius <= 0) return [];

  // Find data bounds for the coordinate origin.
  let mnX = Infinity;
  let mnY = Infinity;
  for (let i = 0; i < n; i++) {
    if (isFinite(x[i]) && isFinite(y[i])) {
      if (x[i] < mnX) mnX = x[i];
      if (y[i] < mnY) mnY = y[i];
    }
  }

  const dx = radius * 2.0;
  const dy = radius * Math.sqrt(3.0);

  // Sparse bin counts keyed by "row,col".
  const bins = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    if (!isFinite(x[i]) || !isFinite(y[i])) continue;
    const row = Math.round((y[i] - mnY) / dy);
    const offset = row % 2 !== 0 ? radius : 0.0;
    const col = Math.round((x[i] - mnX - offset) / dx);
    const key = `${row},${col}`;
    bins.set(key, (bins.get(key) ?? 0) + 1);
  }

  const entries: HexBinEntry[] = [];
  for (const [key, count] of bins) {
    const comma = key.indexOf(",");
    const row = Number(key.slice(0, comma));
    const col = Number(key.slice(comma + 1));
    const offset = row % 2 !== 0 ? radius : 0.0;
    const cx = mnX + col * dx + offset;
    const cy = mnY + row * dy;
    entries.push({ cx, cy, count });
  }
  return entries;
}
