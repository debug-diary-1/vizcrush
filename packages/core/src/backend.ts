import type { Backend, Capabilities } from "./types.js";

export async function detectCapabilities(): Promise<Capabilities> {
  const capabilities: Capabilities = {
    webgpu: false,
    wasmSimd: false,
    wasm: false,
    sharedArrayBuffer: false,
  };

  // Check WebAssembly support
  if (typeof WebAssembly !== "undefined") {
    capabilities.wasm = true;

    // Check SIMD support
    try {
      // Minimal valid WASM module with SIMD
      const simdTest = new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0,
        253, 15, 253, 98, 11,
      ]);
      capabilities.wasmSimd = WebAssembly.validate(simdTest);
    } catch {
      capabilities.wasmSimd = false;
    }
  }

  // Check WebGPU support
  if (typeof navigator !== "undefined" && "gpu" in navigator) {
    try {
      const adapter = await (navigator as any).gpu.requestAdapter();
      if (adapter) {
        const device = await adapter.requestDevice();
        if (device) {
          capabilities.webgpu = true;
          device.destroy();
        }
      }
    } catch {
      capabilities.webgpu = false;
    }
  }

  // Check SharedArrayBuffer support
  if (typeof SharedArrayBuffer !== "undefined") {
    capabilities.sharedArrayBuffer = true;
  }

  return capabilities;
}

/**
 * The path that will actually run. The library ships a single SIMD-enabled
 * WASM binary and wires no WebGPU compute path, so the only honest choices are
 * `'wasm'` (when WebAssembly is available) and `'js'` (the pure fallback).
 * `capabilities` still carries the raw WebGPU/SIMD/SharedArrayBuffer probes for
 * reporting, but they no longer imply distinct selectable backends.
 */
export function selectBackend(capabilities: Capabilities): Backend {
  return capabilities.wasm ? "wasm" : "js";
}
