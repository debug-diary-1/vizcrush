import { describe, test, expect } from "vitest";
import {
  loadWasmForParity,
  parityMode,
  injectWasmModuleForTesting,
  expectFloatArraysClose,
  PARITY_EPSILON,
} from "@vizcrush/core/parity";
import { downsampleKernels } from "./index.js";

// Load the REAL wasm-bindgen module from disk (Node can't run bindgen's
// import.meta fetch) and register it as the loaders' module transport. From
// here on, everything — marshal, dispatch, unmarshal, fallback — is the same
// production kernel path callers use. Missing wasm fails under
// VIZCRUSH_REQUIRE_WASM (CI), and skips loudly otherwise.
const wasm = await loadWasmForParity(import.meta.url, "vizcrush_downsample");
const mode = parityMode(wasm, "vizcrush_downsample");
if (wasm) injectWasmModuleForTesting("vizcrush_downsample", wasm);

const algorithms = [
  { name: "lttb", kernel: downsampleKernels.lttb },
  { name: "minMaxLttb", kernel: downsampleKernels.minMaxLttb },
  { name: "m4", kernel: downsampleKernels.m4 },
  { name: "ltob", kernel: downsampleKernels.ltob },
];

function makeInput(n: number): { x: Float64Array; y: Float64Array } {
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = i;
    y[i] = Math.sin(i * 0.05) * 100 + Math.cos(i * 0.013) * 17;
  }
  return { x, y };
}

const cases: { n: number; threshold: number }[] = [
  { n: 1000, threshold: 50 },
  { n: 5000, threshold: 200 },
  { n: 2048, threshold: 100 },
  { n: 333, threshold: 40 },
];

describe.runIf(mode === "run")("downsample JS ≡ WASM parity (kernel seam)", () => {
  describe.each(algorithms)("$name", ({ kernel }) => {
    test.each(cases)("n=$n threshold=$threshold", async ({ n, threshold }) => {
      const { x, y } = makeInput(n);

      const js = await kernel.withBackend(x, y, threshold, { backend: "js" });
      const ws = await kernel.withBackend(x, y, threshold, { backend: "wasm" });

      // The seam must report what actually ran — a silent JS fallback here
      // would mean "parity" compared JS against itself.
      expect(js.backend).toBe("js");
      expect(ws.backend).toBe("wasm");

      expectFloatArraysClose(ws.result.x, js.result.x, PARITY_EPSILON, "x");
      expectFloatArraysClose(ws.result.y, js.result.y, PARITY_EPSILON, "y");
    });
  });
});
