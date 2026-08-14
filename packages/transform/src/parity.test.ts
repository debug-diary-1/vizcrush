import { describe, test, expect } from "vitest";
import {
  loadWasmForParity,
  parityMode,
  injectWasmModuleForTesting,
  expectFloatArraysClose,
  PARITY_EPSILON,
} from "@vizcrush/core/parity";
import { transformKernels } from "./index.js";

// Load the REAL wasm-bindgen module from disk (Node can't run bindgen's
// import.meta fetch) and register it as the loaders' module transport. From
// here on, everything — marshal, dispatch, unmarshal, fallback — is the same
// production kernel path callers use. Missing wasm fails under
// VIZCRUSH_REQUIRE_WASM (CI), and skips loudly otherwise.
const wasm = await loadWasmForParity(import.meta.url, "vizcrush_transform");
const mode = parityMode(wasm, "vizcrush_transform");
if (wasm) injectWasmModuleForTesting("vizcrush_transform", wasm);

function makeData(n: number): Float64Array {
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    d[i] = Math.sin(i * 0.05) * 100 + Math.cos(i * 0.013) * 17 + 200;
  }
  return d;
}

function makeKeys(n: number): Float64Array {
  const k = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    k[i] = Math.cos(i * 0.07) * 50 + i * 0.001;
  }
  return k;
}

// Every backend pair must report what actually ran — a silent JS fallback
// would mean "parity" compared JS against itself.
function expectBackends(js: { backend: "wasm" | "js" }, ws: { backend: "wasm" | "js" }): void {
  expect(js.backend).toBe("js");
  expect(ws.backend).toBe("wasm");
}

describe.runIf(mode === "run")("transform JS ≡ WASM parity (kernel seam)", () => {
  const sizes = [{ n: 1000 }, { n: 2048 }, { n: 333 }];

  describe("normalize", () => {
    test.each(sizes)("auto range n=$n", async ({ n }) => {
      const data = makeData(n);
      const js = await transformKernels.normalize.withBackend(data, NaN, NaN, { backend: "js" });
      const ws = await transformKernels.normalize.withBackend(data, NaN, NaN, { backend: "wasm" });
      expectBackends(js, ws);
      expectFloatArraysClose(ws.result, js.result, PARITY_EPSILON, "normalize");
    });

    test.each(sizes)("custom range n=$n", async ({ n }) => {
      const data = makeData(n);
      const js = await transformKernels.normalize.withBackend(data, 50, 350, { backend: "js" });
      const ws = await transformKernels.normalize.withBackend(data, 50, 350, { backend: "wasm" });
      expectBackends(js, ws);
      expectFloatArraysClose(ws.result, js.result, PARITY_EPSILON, "normalize-range");
    });
  });

  describe("sort (radix_sort)", () => {
    test.each(sizes)("ascending n=$n", async ({ n }) => {
      const data = makeData(n);
      const js = await transformKernels.sort.withBackend(data, false, { backend: "js" });
      const ws = await transformKernels.sort.withBackend(data, false, { backend: "wasm" });
      expectBackends(js, ws);
      expectFloatArraysClose(ws.result, js.result, PARITY_EPSILON, "radix_sort-asc");
    });

    test.each(sizes)("descending n=$n", async ({ n }) => {
      const data = makeData(n);
      const js = await transformKernels.sort.withBackend(data, true, { backend: "js" });
      const ws = await transformKernels.sort.withBackend(data, true, { backend: "wasm" });
      expectBackends(js, ws);
      expectFloatArraysClose(ws.result, js.result, PARITY_EPSILON, "radix_sort-desc");
    });
  });

  describe("sortByKeys", () => {
    test.each(sizes)("n=$n", async ({ n }) => {
      const data = makeData(n);
      const keys = makeKeys(n);
      const js = await transformKernels.sortByKeys.withBackend(data, keys, false, {
        backend: "js",
      });
      const ws = await transformKernels.sortByKeys.withBackend(data, keys, false, {
        backend: "wasm",
      });
      expectBackends(js, ws);
      expectFloatArraysClose(ws.result, js.result, PARITY_EPSILON, "sort_by_keys");
    });
  });

  describe("logTransform", () => {
    test.each(sizes)("base e n=$n", async ({ n }) => {
      const data = makeData(n);
      const js = await transformKernels.logTransform.withBackend(data, Math.E, { backend: "js" });
      const ws = await transformKernels.logTransform.withBackend(data, Math.E, {
        backend: "wasm",
      });
      expectBackends(js, ws);
      expectFloatArraysClose(ws.result, js.result, PARITY_EPSILON, "log_transform");
    });

    test.each(sizes)("base 10 n=$n", async ({ n }) => {
      const data = makeData(n);
      const js = await transformKernels.logTransform.withBackend(data, 10, { backend: "js" });
      const ws = await transformKernels.logTransform.withBackend(data, 10, { backend: "wasm" });
      expectBackends(js, ws);
      expectFloatArraysClose(ws.result, js.result, PARITY_EPSILON, "log_transform-10");
    });
  });

  describe("powerTransform", () => {
    test.each(sizes)("square n=$n", async ({ n }) => {
      const data = makeData(n);
      const js = await transformKernels.powerTransform.withBackend(data, 2, { backend: "js" });
      const ws = await transformKernels.powerTransform.withBackend(data, 2, { backend: "wasm" });
      expectBackends(js, ws);
      expectFloatArraysClose(ws.result, js.result, PARITY_EPSILON, "power_transform-sq");
    });

    test.each(sizes)("sqrt n=$n", async ({ n }) => {
      const data = makeData(n);
      const js = await transformKernels.powerTransform.withBackend(data, 0.5, { backend: "js" });
      const ws = await transformKernels.powerTransform.withBackend(data, 0.5, { backend: "wasm" });
      expectBackends(js, ws);
      expectFloatArraysClose(ws.result, js.result, PARITY_EPSILON, "power_transform-sqrt");
    });
  });
});
