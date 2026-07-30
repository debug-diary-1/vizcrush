/**
 * The path an algorithm actually runs on. Only `'wasm'` and `'js'` are real:
 * one SIMD-enabled WASM binary is always built (so there is no separate
 * `'wasm-simd'` path), and no WebGPU compute path is wired. `detectCapabilities`
 * still probes WebGPU/SIMD/SharedArrayBuffer for reporting, but the selected
 * backend reflects what will run.
 */
export type Backend = "wasm" | "js";

export interface Capabilities {
  webgpu: boolean;
  wasmSimd: boolean;
  wasm: boolean;
  sharedArrayBuffer: boolean;
}

export interface GpuComputeContext {
  backend: Backend;
  capabilities: Capabilities;
}

export interface DownsampleResult {
  x: Float64Array;
  y: Float64Array;
}

export interface BinResult {
  counts: Uint32Array;
  edges: Float64Array;
}

export interface Bin2dResult {
  grid: Uint32Array;
  xEdges: Float64Array;
  yEdges: Float64Array;
  maxCount: number;
}

export interface HexBinEntry {
  cx: number;
  cy: number;
  count: number;
}

export interface StatsResult {
  count: number;
  min: number;
  max: number;
  mean: number;
  stdDev: number;
  variance: number;
}

export interface Bin2dOptions {
  xBins?: number;
  yBins?: number;
  xRange?: [number, number];
  yRange?: [number, number];
}
