/**
 * The default path an algorithm runs on. Only `'wasm'` and `'js'` are
 * selectable defaults: one SIMD-enabled WASM binary is always built (so there
 * is no separate `'wasm-simd'` path). `detectCapabilities` still probes
 * WebGPU/SIMD/SharedArrayBuffer for reporting. The opt-in WebGPU compute path
 * (`@vizcrush/bin`'s bin2d, ADR 0004) is requested per call via that
 * package's own options and never appears here.
 */
export type Backend = "wasm" | "js";

export interface Capabilities {
  webgpu: boolean;
  wasmSimd: boolean;
  wasm: boolean;
  sharedArrayBuffer: boolean;
}

export interface VizcrushContext {
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
