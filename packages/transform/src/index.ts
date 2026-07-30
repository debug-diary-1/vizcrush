import type { DownsampleResult, KernelCallOptions } from "@vizcrush/core";
import { defineKernel, createWasmLoader } from "@vizcrush/core";
import {
  normalizeCore,
  sortCore,
  sortByKeysCore,
  logTransformCore,
  powerTransformCore,
} from "./cores.js";

export {
  normalizeCore,
  sortCore,
  sortByKeysCore,
  logTransformCore,
  powerTransformCore,
} from "./cores.js";

/**
 * Single WASM loader for the transform crate. The dynamic import is authored
 * here so the `../wasm/...` specifier resolves against this package's `dist/`.
 * The core kernel/loader owns caching, init, and null-on-failure — replacing
 * the hand-rolled `loadWasm` trampoline and the `enableWasm` flag.
 */
const loader = createWasmLoader("vizcrush_transform", () =>
  new Function("p", "return import(p)")(["..", "wasm", "vizcrush_transform.js"].join("/")),
);

// ── normalize ──
// Crosses the boundary as a Float64Array directly (no Array.from boxing); the
// range bounds are passed as NaN when absent (the WASM binding treats a
// non-finite / degenerate range as "use the data's own min/max").
type NormalizeArgs = [data: Float64Array, rMin: number, rMax: number];

const normalizeKernel = defineKernel<
  NormalizeArgs,
  Float64Array,
  [Float64Array, number, number],
  Float64Array
>({
  wasmModuleName: "vizcrush_transform",
  loader,
  wasmFn: (mod, data, rMin, rMax) => mod.normalize(data, rMin, rMax) as Float64Array,
  jsFallback: normalizeCore,
  marshal: (data, rMin, rMax) => [data, rMin, rMax],
  unmarshal: (raw) => raw,
  sizeOf: (data) => data.length,
});

// ── sort (radix_sort) ──
type SortArgs = [data: Float64Array, descending: boolean];

const sortKernel = defineKernel<SortArgs, Float64Array, [Float64Array, boolean], Float64Array>({
  wasmModuleName: "vizcrush_transform",
  loader,
  wasmFn: (mod, data, descending) => mod.radix_sort(data, descending) as Float64Array,
  jsFallback: sortCore,
  marshal: (data, descending) => [data, descending],
  unmarshal: (raw) => raw,
  sizeOf: (data) => data.length,
});

// ── sort by keys ──
// The WASM `sort_by_keys` only sorts ascending; the descending case reverses
// the unmarshalled result (matching the prior public behaviour). The JS core
// folds `descending` into its comparator directly.
type SortByKeysArgs = [data: Float64Array, keys: Float64Array, descending: boolean];

const sortByKeysKernel = defineKernel<
  SortByKeysArgs,
  Float64Array,
  [Float64Array, Float64Array],
  Float64Array
>({
  wasmModuleName: "vizcrush_transform",
  loader,
  wasmFn: (mod, data, keys) => mod.sort_by_keys(data, keys) as Float64Array,
  jsFallback: sortByKeysCore,
  marshal: (data, keys) => [data, keys],
  unmarshal: (raw, _data, _keys, descending) => {
    if (descending) {
      const out = new Float64Array(raw);
      out.reverse();
      return out;
    }
    return raw;
  },
  sizeOf: (data) => data.length,
});

// ── log transform ──
type LogArgs = [data: Float64Array, base: number];

const logTransformKernel = defineKernel<
  LogArgs,
  Float64Array,
  [Float64Array, number],
  Float64Array
>({
  wasmModuleName: "vizcrush_transform",
  loader,
  wasmFn: (mod, data, base) => mod.log_transform(data, base) as Float64Array,
  jsFallback: logTransformCore,
  marshal: (data, base) => [data, base],
  unmarshal: (raw) => raw,
  sizeOf: (data) => data.length,
});

// ── power transform ──
type PowerArgs = [data: Float64Array, exponent: number];

const powerTransformKernel = defineKernel<
  PowerArgs,
  Float64Array,
  [Float64Array, number],
  Float64Array
>({
  wasmModuleName: "vizcrush_transform",
  loader,
  wasmFn: (mod, data, exponent) => mod.power_transform(data, exponent) as Float64Array,
  jsFallback: powerTransformCore,
  marshal: (data, exponent) => [data, exponent],
  unmarshal: (raw) => raw,
  sizeOf: (data) => data.length,
});

/**
 * Radix sort on Float64 arrays. O(n) time complexity. When `keys` is supplied,
 * `data` is reordered by the sorted order of `keys` instead.
 */
export async function sortBy(
  data: Float64Array,
  keys?: Float64Array,
  descending = false,
  opts?: KernelCallOptions,
): Promise<Float64Array> {
  if (keys) {
    return sortByKeysKernel(data, keys, descending, opts);
  }
  return sortKernel(data, descending, opts);
}

/**
 * Min-max normalization to [0, 1].
 */
export async function normalize(
  data: Float64Array,
  range?: [number, number],
  opts?: KernelCallOptions,
): Promise<Float64Array> {
  const rMin = range ? range[0] : NaN;
  const rMax = range ? range[1] : NaN;
  return normalizeKernel(data, rMin, rMax, opts);
}

/** The WASM-backed kernels, exposed for the shared parity harness. */
export const transformKernels = {
  normalize: normalizeKernel,
  sort: sortKernel,
  sortByKeys: sortByKeysKernel,
  logTransform: logTransformKernel,
  powerTransform: powerTransformKernel,
};

/**
 * Extract viewport slice of paired x/y data.
 */
export function filterRange(
  x: Float64Array,
  y: Float64Array,
  xMin: number,
  xMax: number,
): DownsampleResult {
  const outX: number[] = [];
  const outY: number[] = [];
  for (let i = 0; i < x.length; i++) {
    if (x[i] >= xMin && x[i] <= xMax) {
      outX.push(x[i]);
      outY.push(y[i]);
    }
  }
  return { x: new Float64Array(outX), y: new Float64Array(outY) };
}

/**
 * Log transform: output[i] = log_base(data[i]).
 * Non-positive values produce NaN.
 */
export async function logTransform(
  data: Float64Array,
  base = Math.E,
  opts?: KernelCallOptions,
): Promise<Float64Array> {
  return logTransformKernel(data, base, opts);
}

/**
 * Natural log transform (base e).
 */
export async function lnTransform(data: Float64Array): Promise<Float64Array> {
  return logTransform(data, Math.E);
}

/**
 * Log10 transform.
 */
export async function log10Transform(data: Float64Array): Promise<Float64Array> {
  return logTransform(data, 10);
}

/**
 * Power transform: output[i] = data[i] ^ exponent.
 */
export async function powerTransform(
  data: Float64Array,
  exponent: number,
  opts?: KernelCallOptions,
): Promise<Float64Array> {
  return powerTransformKernel(data, exponent, opts);
}

/**
 * Quantile normalization: align distributions across columns.
 * Each Float64Array in the input is one column (distribution).
 * Returns arrays of the same lengths, normalized to share the same distribution.
 */
export async function quantileNormalize(columns: Float64Array[]): Promise<Float64Array[]> {
  if (columns.length < 2) return columns.map((c) => new Float64Array(c));

  const nRows = columns[0].length;
  for (const col of columns) {
    if (col.length !== nRows) {
      throw new Error("All columns must have the same length");
    }
  }

  // 1. Sort each column, track original indices
  const sorted = columns.map((col) => {
    const indexed = Array.from(col).map((v, i) => ({ v, i }));
    indexed.sort((a, b) => a.v - b.v);
    return indexed;
  });

  // 2. Compute rank means
  const rankMeans = new Float64Array(nRows);
  for (let r = 0; r < nRows; r++) {
    let sum = 0;
    for (let c = 0; c < columns.length; c++) {
      sum += sorted[c][r].v;
    }
    rankMeans[r] = sum / columns.length;
  }

  // 3. Assign rank means back by original index
  return sorted.map((col) => {
    const result = new Float64Array(nRows);
    for (let r = 0; r < nRows; r++) {
      result[col[r].i] = rankMeans[r];
    }
    return result;
  });
}
