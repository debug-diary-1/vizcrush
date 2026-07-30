import type { DownsampleResult, KernelCallOptions } from "@vizcrush/core";
import { defineKernel, createWasmLoader } from "@vizcrush/core";
import { lttbCore, minMaxLttbCore, m4Core, ltobCore, deinterleave } from "./cores.js";

export { lttbCore, minMaxLttbCore, m4Core, ltobCore } from "./cores.js";

/**
 * Single WASM loader for the downsample crate. The dynamic import is authored
 * here so the `../wasm/...` specifier resolves against this package's `dist/`.
 * The core kernel/loader owns caching, init, and null-on-failure.
 */
const loader = createWasmLoader("vizcrush_downsample", () =>
  new Function("p", "return import(p)")(["..", "wasm", "vizcrush_downsample.js"].join("/")),
);

// Inputs cross the boundary as typed arrays directly (no Array.from boxing);
// the WASM binding returns an interleaved Float64Array we deinterleave.
type Args = [x: Float64Array, y: Float64Array, threshold: number];

function makeDownsampleKernel(
  wasmFnName: "lttb" | "minmax_lttb" | "m4" | "ltob",
  core: (...a: Args) => DownsampleResult,
) {
  return defineKernel<Args, DownsampleResult, [Float64Array, Float64Array, number], Float64Array>({
    wasmModuleName: "vizcrush_downsample",
    loader,
    wasmFn: (mod, x, y, threshold) => mod[wasmFnName](x, y, threshold) as Float64Array,
    jsFallback: core,
    marshal: (x, y, threshold) => [x, y, threshold],
    unmarshal: (raw) => deinterleave(raw),
    sizeOf: (x) => x.length,
  });
}

const lttbKernel = makeDownsampleKernel("lttb", lttbCore);
const minMaxLttbKernel = makeDownsampleKernel("minmax_lttb", minMaxLttbCore);
const m4Kernel = makeDownsampleKernel("m4", m4Core);
const ltobKernel = makeDownsampleKernel("ltob", ltobCore);

/**
 * Largest-Triangle-Three-Buckets downsampling.
 * Preserves visual shape of time-series data.
 */
export function lttb(
  x: Float64Array,
  y: Float64Array,
  threshold: number,
  opts?: KernelCallOptions,
): Promise<DownsampleResult> {
  return lttbKernel(x, y, threshold, opts);
}

/** Synchronous LTTB — the pure JS core, no WASM loading. */
export function lttbSync(x: Float64Array, y: Float64Array, threshold: number): DownsampleResult {
  return lttbCore(x, y, threshold);
}

/**
 * MinMax pre-selection + LTTB. Better for spiky data (financial, IoT).
 */
export function minMaxLttb(
  x: Float64Array,
  y: Float64Array,
  threshold: number,
  opts?: KernelCallOptions,
): Promise<DownsampleResult> {
  return minMaxLttbKernel(x, y, threshold, opts);
}

/**
 * M4 downsampling: first, min, max, last per bucket.
 */
export function m4(
  x: Float64Array,
  y: Float64Array,
  threshold: number,
  opts?: KernelCallOptions,
): Promise<DownsampleResult> {
  return m4Kernel(x, y, threshold, opts);
}

/**
 * Largest-Triangle-One-Bucket downsampling.
 */
export function ltob(
  x: Float64Array,
  y: Float64Array,
  threshold: number,
  opts?: KernelCallOptions,
): Promise<DownsampleResult> {
  return ltobKernel(x, y, threshold, opts);
}

/** The kernels, exposed for the shared parity harness. */
export const downsampleKernels = {
  lttb: lttbKernel,
  minMaxLttb: minMaxLttbKernel,
  m4: m4Kernel,
  ltob: ltobKernel,
};
