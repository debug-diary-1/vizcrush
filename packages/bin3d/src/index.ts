import type { KernelCallOptions } from "@vizcrush/core";
import { defineKernel, createWasmLoader } from "@vizcrush/core";
import { bin3dCore, type Bin3dResult, type Bin3dOptions } from "./cores.js";

export { bin3dCore } from "./cores.js";
export type { Bin3dResult, Bin3dOptions } from "./cores.js";

/**
 * Single WASM loader for the bin3d crate. The dynamic import is authored here so
 * the `../wasm/...` specifier resolves against this package's `dist/`. The core
 * kernel/loader owns caching, init, and null-on-failure.
 */
const loader = createWasmLoader("vizcrush_bin3d", () =>
  new Function("p", "return import(p)")(["..", "wasm", "vizcrush_bin3d.js"].join("/")),
);

// Inputs cross the boundary as typed arrays directly (no Array.from boxing);
// the WASM binding returns a packed Float64Array [grid..., xEdges..., yEdges..., zEdges...].
type Args = [x: Float64Array, y: Float64Array, z: Float64Array, opts: Bin3dOptions | undefined];

const bin3dKernel = defineKernel<
  Args,
  Bin3dResult,
  [
    Float64Array,
    Float64Array,
    Float64Array,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ],
  Float64Array
>({
  wasmModuleName: "vizcrush_bin3d",
  loader,
  wasmFn: (mod, x, y, z, xBins, yBins, zBins, xMin, xMax, yMin, yMax, zMin, zMax) =>
    mod.bin3d(x, y, z, xBins, yBins, zBins, xMin, xMax, yMin, yMax, zMin, zMax) as Float64Array,
  jsFallback: bin3dCore,
  marshal: (x, y, z, opts) => {
    const xBins = opts?.xBins ?? 32;
    const yBins = opts?.yBins ?? 32;
    const zBins = opts?.zBins ?? 32;
    return [
      x,
      y,
      z,
      xBins,
      yBins,
      zBins,
      opts?.xRange ? opts.xRange[0] : NaN,
      opts?.xRange ? opts.xRange[1] : NaN,
      opts?.yRange ? opts.yRange[0] : NaN,
      opts?.yRange ? opts.yRange[1] : NaN,
      opts?.zRange ? opts.zRange[0] : NaN,
      opts?.zRange ? opts.zRange[1] : NaN,
    ];
  },
  unmarshal: (raw, x, y, z, opts) => {
    const xBins = opts?.xBins ?? 32;
    const yBins = opts?.yBins ?? 32;
    const zBins = opts?.zBins ?? 32;
    // WASM returns [] for empty/degenerate input; defer to the JS core's
    // well-formed result so the public shape is preserved.
    if (raw.length === 0) return bin3dCore(x, y, z, opts);
    const gridSize = xBins * yBins * zBins;
    const grid = new Uint32Array(gridSize);
    let maxCount = 0;
    for (let i = 0; i < gridSize; i++) {
      grid[i] = raw[i];
      if (grid[i] > maxCount) maxCount = grid[i];
    }
    const xEdges = new Float64Array(xBins + 1);
    const yEdges = new Float64Array(yBins + 1);
    const zEdges = new Float64Array(zBins + 1);
    for (let i = 0; i <= xBins; i++) xEdges[i] = raw[gridSize + i];
    for (let i = 0; i <= yBins; i++) yEdges[i] = raw[gridSize + xBins + 1 + i];
    for (let i = 0; i <= zBins; i++) zEdges[i] = raw[gridSize + xBins + 1 + yBins + 1 + i];
    return { grid, xEdges, yEdges, zEdges, maxCount };
  },
  sizeOf: (x) => x.length,
});

/**
 * 3D voxel binning: bin point data into a regular 3D grid.
 * Uses WASM when available, falls back to the pure-JS core.
 */
export function bin3d(
  x: Float64Array,
  y: Float64Array,
  z: Float64Array,
  opts?: Bin3dOptions,
  callOpts?: KernelCallOptions,
): Promise<Bin3dResult> {
  return bin3dKernel(x, y, z, opts, callOpts);
}

/** The kernels, exposed for the shared parity harness. */
export const bin3dKernels = {
  bin3d: bin3dKernel,
};
