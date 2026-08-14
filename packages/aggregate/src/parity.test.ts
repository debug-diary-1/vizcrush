import { describe, test, expect } from "vitest";
import {
  loadWasmForParity,
  parityMode,
  injectWasmModuleForTesting,
  expectFloatArraysClose,
  PARITY_EPSILON,
} from "@vizcrush/core/parity";
import { aggregateKernels } from "./index.js";

// Load the REAL wasm-bindgen module from disk (Node can't run bindgen's
// import.meta fetch) and register it as the loaders' module transport. From
// here on, everything — marshal, dispatch, unmarshal, fallback — is the same
// production kernel path callers use. Missing wasm fails under
// VIZCRUSH_REQUIRE_WASM (CI), and skips loudly otherwise.
const wasm = await loadWasmForParity(import.meta.url, "vizcrush_aggregate");
const mode = parityMode(wasm, "vizcrush_aggregate");
if (wasm) injectWasmModuleForTesting("vizcrush_aggregate", wasm);

function makeData(n: number): Float64Array {
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    d[i] = Math.sin(i * 0.05) * 100 + Math.cos(i * 0.013) * 17 + 200;
  }
  return d;
}

describe.runIf(mode === "run")("aggregate JS ≡ WASM parity (kernel seam)", () => {
  describe("stats", () => {
    test.each([{ n: 1000 }, { n: 2048 }, { n: 333 }])("n=$n", async ({ n }) => {
      const data = makeData(n);

      const js = await aggregateKernels.stats.withBackend(data, { backend: "js" });
      const ws = await aggregateKernels.stats.withBackend(data, { backend: "wasm" });

      // The seam must report what actually ran — a silent JS fallback here
      // would mean "parity" compared JS against itself.
      expect(js.backend).toBe("js");
      expect(ws.backend).toBe("wasm");

      expect(ws.result.count).toBe(js.result.count);
      expectFloatArraysClose(
        [ws.result.min, ws.result.max, ws.result.mean, ws.result.stdDev, ws.result.variance],
        [js.result.min, js.result.max, js.result.mean, js.result.stdDev, js.result.variance],
        PARITY_EPSILON,
        "stats(min,max,mean,stdDev,variance)",
      );
    });
  });

  describe("percentile", () => {
    const pcts = [0, 25, 50, 75, 90, 95, 99, 100];
    test.each([{ n: 1000 }, { n: 2048 }, { n: 333 }])("n=$n", async ({ n }) => {
      const data = makeData(n);

      const js = await aggregateKernels.percentile.withBackend(data, pcts, { backend: "js" });
      const ws = await aggregateKernels.percentile.withBackend(data, pcts, { backend: "wasm" });

      expect(js.backend).toBe("js");
      expect(ws.backend).toBe("wasm");

      expectFloatArraysClose(ws.result, js.result, PARITY_EPSILON, "percentile");
    });
  });
});
