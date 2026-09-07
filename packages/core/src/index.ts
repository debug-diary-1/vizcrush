export { detectCapabilities, selectBackend } from "./backend.js";
export { defineKernel, createWasmLoader, DEFAULT_AUTO_THRESHOLD } from "./kernel.js";
export type {
  Kernel,
  KernelSpec,
  KernelBackend,
  KernelBackendReason,
  KernelCallOptions,
  KernelExecution,
  WasmLoader,
} from "./kernel.js";
export type {
  Backend,
  Capabilities,
  VizcrushContext,
  DownsampleResult,
  BinResult,
  Bin2dResult,
  HexBinEntry,
  StatsResult,
  Bin2dOptions,
} from "./types.js";

import { detectCapabilities, selectBackend } from "./backend.js";
import type { VizcrushContext } from "./types.js";

/**
 * Initialize vizcrush. Probes capabilities and returns the preferred backend.
 * Per-call thresholds, overrides, and module loading still determine which
 * path executes; use a kernel's `withBackend()` for completed-call diagnostics.
 *
 * ```ts
 * const gpu = await init();
 * console.log(gpu.backend); // 'wasm' | 'js'
 * ```
 */
export async function init(): Promise<VizcrushContext> {
  const capabilities = await detectCapabilities();
  const backend = selectBackend(capabilities);
  return { backend, capabilities };
}
