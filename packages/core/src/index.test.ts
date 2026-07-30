import { describe, test, expect } from "vitest";
import { detectCapabilities, selectBackend } from "./index.js";
import type { Capabilities } from "./types.js";

describe("detectCapabilities", () => {
  test("returns capabilities object", async () => {
    const caps = await detectCapabilities();
    expect(caps).toHaveProperty("wasm");
    expect(caps).toHaveProperty("wasmSimd");
    expect(caps).toHaveProperty("webgpu");
    expect(caps).toHaveProperty("sharedArrayBuffer");
    expect(typeof caps.wasm).toBe("boolean");
  });

  test("wasm is supported in Node.js", async () => {
    const caps = await detectCapabilities();
    expect(caps.wasm).toBe(true);
  });
});

describe("selectBackend", () => {
  // Only 'wasm' and 'js' are real paths: one SIMD binary is always built and no
  // WebGPU compute path is wired, so the WebGPU/SIMD probes do not select a path.
  test("selects wasm when WebAssembly is available", () => {
    const caps: Capabilities = {
      webgpu: true,
      wasmSimd: true,
      wasm: true,
      sharedArrayBuffer: true,
    };
    expect(selectBackend(caps)).toBe("wasm");
  });

  test("selects wasm even when WebGPU/SIMD probes are false", () => {
    const caps: Capabilities = {
      webgpu: false,
      wasmSimd: false,
      wasm: true,
      sharedArrayBuffer: false,
    };
    expect(selectBackend(caps)).toBe("wasm");
  });

  test("falls back to js when WebAssembly is unavailable", () => {
    const caps: Capabilities = {
      webgpu: false,
      wasmSimd: false,
      wasm: false,
      sharedArrayBuffer: false,
    };
    expect(selectBackend(caps)).toBe("js");
  });
});

describe("init", () => {
  test("returns context with backend and capabilities", async () => {
    const { init } = await import("./index.js");
    const ctx = await init();
    expect(ctx).toHaveProperty("backend");
    expect(ctx).toHaveProperty("capabilities");
    expect(["wasm", "js"]).toContain(ctx.backend);
  });
});
