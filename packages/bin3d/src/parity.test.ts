import { describe, test, expect } from "vitest";
import {
  loadWasmForParity,
  parityMode,
  injectWasmModuleForTesting,
  expectFloatArraysClose,
  PARITY_EPSILON,
} from "@vizcrush/core/parity";
import { bin3dKernels } from "./index.js";

// Load the REAL wasm-bindgen module from disk (Node can't run bindgen's
// import.meta fetch) and register it as the loaders' module transport. From
// here on, everything — marshal, dispatch, unmarshal, fallback — is the same
// production kernel path callers use. Missing wasm fails under
// VIZCRUSH_REQUIRE_WASM (CI), and skips loudly otherwise.
const wasm = await loadWasmForParity(import.meta.url, "vizcrush_bin3d");
const mode = parityMode(wasm, "vizcrush_bin3d");
if (wasm) injectWasmModuleForTesting("vizcrush_bin3d", wasm);

function makeXYZ(n: number): { x: Float64Array; y: Float64Array; z: Float64Array } {
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = Math.sin(i * 0.05) * 50 + 100;
    y[i] = Math.cos(i * 0.031) * 40 + 80;
    z[i] = Math.sin(i * 0.017) * 30 + 60;
  }
  return { x, y, z };
}

describe.runIf(mode === "run")("bin3d JS ≡ WASM parity (kernel seam)", () => {
  // Explicit ranges chosen wide enough that no point lands on a bin edge, so
  // the mul-vs-div reciprocal difference between cores cannot flip a bin.
  test.each([
    { n: 1000, xb: 4, yb: 4, zb: 4 },
    { n: 2000, xb: 8, yb: 8, zb: 8 },
    { n: 512, xb: 5, yb: 5, zb: 5 },
  ])("n=$n grid=$xb×$yb×$zb", async ({ n, xb, yb, zb }) => {
    const { x, y, z } = makeXYZ(n);
    const opts = {
      xBins: xb,
      yBins: yb,
      zBins: zb,
      xRange: [0, 200] as [number, number],
      yRange: [0, 200] as [number, number],
      zRange: [0, 200] as [number, number],
    };

    const js = await bin3dKernels.bin3d.withBackend(x, y, z, opts, { backend: "js" });
    const ws = await bin3dKernels.bin3d.withBackend(x, y, z, opts, { backend: "wasm" });

    // The seam must report what actually ran — a silent JS fallback here
    // would mean "parity" compared JS against itself.
    expect(js.backend).toBe("js");
    expect(ws.backend).toBe("wasm");

    expect(ws.result.grid).toEqual(js.result.grid);
    expect(ws.result.maxCount).toBe(js.result.maxCount);
    expectFloatArraysClose(ws.result.xEdges, js.result.xEdges, PARITY_EPSILON, "bin3d xEdges");
    expectFloatArraysClose(ws.result.yEdges, js.result.yEdges, PARITY_EPSILON, "bin3d yEdges");
    expectFloatArraysClose(ws.result.zEdges, js.result.zEdges, PARITY_EPSILON, "bin3d zEdges");
  });
});
