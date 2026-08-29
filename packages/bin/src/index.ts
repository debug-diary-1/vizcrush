import type {
  BinResult,
  Bin2dResult,
  Bin2dOptions,
  HexBinEntry,
  KernelBackend,
  KernelCallOptions,
} from "@vizcrush/core";
import { defineKernel, createWasmLoader } from "@vizcrush/core";
import { bin1dCore, bin2dCore, hexbinCore } from "./cores.js";
import { bin2dGpu } from "./gpu.js";

export { bin1dCore, bin2dCore, bin2dBounds, hexbinCore } from "./cores.js";
export { bin2dGpu, rebaseToF32 } from "./gpu.js";

/**
 * Single WASM loader for the vizcrush_bin crate.
 *
 * The specifier is the package's own name rather than a relative path, and it
 * is a plain `import()` rather than a hidden one, because both properties are
 * load-bearing for bundled consumers. A relative `../wasm/...` resolves
 * correctly only while this file lives in the package's `dist/`; once a bundler
 * inlines it, the same path resolves against the application chunk and 404s,
 * and the loader's swallow-failures contract turns that into a silent drop to
 * the JS core. Keeping it statically analysable lets bundlers treat the
 * wasm-bindgen glue as a module, rewrite its internal
 * `new URL('..._bg.wasm', import.meta.url)`, and emit the binary as an asset.
 * It stays a dynamic `import()`, so it remains a lazily-fetched chunk.
 */
const loader = createWasmLoader("vizcrush_bin", () => import("@vizcrush/bin/wasm/vizcrush_bin.js"));

// ── bin1d ──
// Inputs cross the boundary as typed arrays directly (no Array.from boxing);
// the WASM binding returns a packed Float64Array [counts..., edges...].
type Bin1dArgs = [data: Float64Array, bins: number, range: [number, number] | undefined];

const bin1dKernel = defineKernel<
  Bin1dArgs,
  BinResult,
  [Float64Array, number, number, number],
  Float64Array
>({
  wasmModuleName: "vizcrush_bin",
  loader,
  wasmFn: (mod, data, bins, rMin, rMax) => mod.histogram(data, bins, rMin, rMax) as Float64Array,
  jsFallback: (data, bins, range) => bin1dCore(data, bins, range),
  marshal: (data, bins, range) => [data, bins, range ? range[0] : NaN, range ? range[1] : NaN],
  unmarshal: (raw, data, bins, range) => {
    // WASM returns [] for empty/degenerate input; fall back to the JS core's
    // well-formed (zero-filled) result so the public shape is preserved.
    if (raw.length === 0) return bin1dCore(data, bins, range);
    const counts = new Uint32Array(bins);
    const edges = new Float64Array(bins + 1);
    for (let i = 0; i < bins; i++) counts[i] = raw[i];
    for (let i = 0; i <= bins; i++) edges[i] = raw[bins + i];
    return { counts, edges };
  },
  sizeOf: (data) => data.length,
});

// ── bin2d ──
type Bin2dArgs = [
  x: Float64Array,
  y: Float64Array,
  xBins: number,
  yBins: number,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
];

const bin2dKernel = defineKernel<
  Bin2dArgs,
  Bin2dResult,
  [Float64Array, Float64Array, number, number, number, number, number, number],
  Float64Array
>({
  wasmModuleName: "vizcrush_bin",
  loader,
  wasmFn: (mod, x, y, xBins, yBins, xMin, xMax, yMin, yMax) =>
    mod.bin2d(x, y, xBins, yBins, xMin, xMax, yMin, yMax) as Float64Array,
  jsFallback: bin2dCore,
  marshal: (x, y, xBins, yBins, xMin, xMax, yMin, yMax) => [
    x,
    y,
    xBins,
    yBins,
    xMin,
    xMax,
    yMin,
    yMax,
  ],
  unmarshal: (raw, x, y, xBins, yBins, xMin, xMax, yMin, yMax) => {
    if (raw.length === 0) return bin2dCore(x, y, xBins, yBins, xMin, xMax, yMin, yMax);
    const gridSize = xBins * yBins;
    const grid = new Uint32Array(gridSize);
    let maxCount = 0;
    for (let i = 0; i < gridSize; i++) {
      grid[i] = raw[i];
      if (grid[i] > maxCount) maxCount = grid[i];
    }
    const xEdges = new Float64Array(xBins + 1);
    for (let i = 0; i <= xBins; i++) xEdges[i] = raw[gridSize + i];
    const yEdges = new Float64Array(yBins + 1);
    for (let i = 0; i <= yBins; i++) yEdges[i] = raw[gridSize + xBins + 1 + i];
    return { grid, xEdges, yEdges, maxCount };
  },
  sizeOf: (x) => x.length,
});

// ── hexbin ──
type HexbinArgs = [x: Float64Array, y: Float64Array, radius: number];

const hexbinKernel = defineKernel<
  HexbinArgs,
  HexBinEntry[],
  [Float64Array, Float64Array, number],
  Float64Array
>({
  wasmModuleName: "vizcrush_bin",
  loader,
  wasmFn: (mod, x, y, radius) => mod.hexbin(x, y, radius) as Float64Array,
  jsFallback: hexbinCore,
  marshal: (x, y, radius) => [x, y, radius],
  unmarshal: (raw) => {
    const entries: HexBinEntry[] = [];
    for (let i = 0; i + 2 < raw.length; i += 3) {
      entries.push({ cx: raw[i], cy: raw[i + 1], count: raw[i + 2] });
    }
    return entries;
  },
  sizeOf: (x) => x.length,
});

/**
 * 1D histogram binning.
 */
export function bin1d(
  data: Float64Array,
  bins: number = 50,
  range?: [number, number],
  opts?: KernelCallOptions,
): Promise<BinResult> {
  return bin1dKernel(data, bins, range, opts);
}

/**
 * Backends accepted by `bin2d`: the kernel's own plus the opt-in WebGPU
 * compute path. `"webgpu"` is a request, not a guarantee — when the GPU path
 * cannot run (no `navigator.gpu`, device denied/lost, degenerate or oversized
 * input) the call silently falls back to the wasm/js kernel.
 */
export interface Bin2dCallOptions {
  backend?: KernelBackend | "webgpu";
}

/**
 * Like `bin2d`, but also reports which backend actually ran — a `"webgpu"`
 * request that fell back reports the wasm/js path that produced the result,
 * so callers (and agents echoing `backend_used`) never mistake a request for
 * an outcome.
 */
export async function bin2dWithBackend(
  x: Float64Array,
  y: Float64Array,
  opts: Bin2dOptions = {},
  callOpts?: Bin2dCallOptions,
): Promise<{ result: Bin2dResult; backend: "webgpu" | "wasm" | "js" }> {
  const xBins = opts.xBins ?? 256;
  const yBins = opts.yBins ?? 256;
  const xMin = opts.xRange ? opts.xRange[0] : NaN;
  const xMax = opts.xRange ? opts.xRange[1] : NaN;
  const yMin = opts.yRange ? opts.yRange[0] : NaN;
  const yMax = opts.yRange ? opts.yRange[1] : NaN;
  if (callOpts?.backend === "webgpu") {
    const gpu = await bin2dGpu(x, y, xBins, yBins, xMin, xMax, yMin, yMax);
    if (gpu) return { result: gpu, backend: "webgpu" };
    return bin2dKernel.withBackend(x, y, xBins, yBins, xMin, xMax, yMin, yMax, {
      backend: "auto",
    });
  }
  return bin2dKernel.withBackend(
    x,
    y,
    xBins,
    yBins,
    xMin,
    xMax,
    yMin,
    yMax,
    callOpts as KernelCallOptions,
  );
}

/**
 * 2D density grid binning for heatmaps.
 */
export async function bin2d(
  x: Float64Array,
  y: Float64Array,
  opts: Bin2dOptions = {},
  callOpts?: Bin2dCallOptions,
): Promise<Bin2dResult> {
  return (await bin2dWithBackend(x, y, opts, callOpts)).result;
}

/**
 * Hexagonal binning.
 */
export function hexbin(
  x: Float64Array,
  y: Float64Array,
  radius: number,
  opts?: KernelCallOptions,
): Promise<HexBinEntry[]> {
  return hexbinKernel(x, y, radius, opts);
}

/** The kernels, exposed for the shared parity harness. */
export const binKernels = {
  bin1d: bin1dKernel,
  bin2d: bin2dKernel,
  hexbin: hexbinKernel,
};
