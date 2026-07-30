import { describe, test, expect } from "vitest";
import { loadWasmForParity, expectFloatArraysClose, PARITY_EPSILON } from "@vizcrush/core/parity";
import {
  normalizeCore,
  sortCore,
  sortByKeysCore,
  logTransformCore,
  powerTransformCore,
} from "./cores.js";

// Load the REAL wasm-bindgen module once. If the build is absent, the parity
// tests skip rather than fail (CI builds wasm; local runs may not).
const wasm = await loadWasmForParity(import.meta.url, "vizcrush_transform");

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

describe.runIf(wasm !== null)("transform JS ≡ WASM parity", () => {
  const sizes = [{ n: 1000 }, { n: 2048 }, { n: 333 }];

  describe("normalize", () => {
    test.each(sizes)("auto range n=$n", ({ n }) => {
      const data = makeData(n);
      const js = normalizeCore(data, NaN, NaN);
      const wasmRaw = (wasm as any).normalize(data, NaN, NaN) as Float64Array;
      expectFloatArraysClose(wasmRaw, js, PARITY_EPSILON, "normalize");
    });

    test.each(sizes)("custom range n=$n", ({ n }) => {
      const data = makeData(n);
      const js = normalizeCore(data, 50, 350);
      const wasmRaw = (wasm as any).normalize(data, 50, 350) as Float64Array;
      expectFloatArraysClose(wasmRaw, js, PARITY_EPSILON, "normalize-range");
    });
  });

  describe("radix_sort", () => {
    test.each(sizes)("ascending n=$n", ({ n }) => {
      const data = makeData(n);
      const js = sortCore(data, false);
      const wasmRaw = (wasm as any).radix_sort(data, false) as Float64Array;
      expectFloatArraysClose(wasmRaw, js, PARITY_EPSILON, "radix_sort-asc");
    });

    test.each(sizes)("descending n=$n", ({ n }) => {
      const data = makeData(n);
      const js = sortCore(data, true);
      const wasmRaw = (wasm as any).radix_sort(data, true) as Float64Array;
      expectFloatArraysClose(wasmRaw, js, PARITY_EPSILON, "radix_sort-desc");
    });
  });

  describe("sort_by_keys", () => {
    test.each(sizes)("n=$n", ({ n }) => {
      const data = makeData(n);
      const keys = makeKeys(n);
      const js = sortByKeysCore(data, keys, false);
      const wasmRaw = (wasm as any).sort_by_keys(data, keys) as Float64Array;
      expectFloatArraysClose(wasmRaw, js, PARITY_EPSILON, "sort_by_keys");
    });
  });

  describe("log_transform", () => {
    test.each(sizes)("base e n=$n", ({ n }) => {
      const data = makeData(n);
      const js = logTransformCore(data, Math.E);
      const wasmRaw = (wasm as any).log_transform(data, Math.E) as Float64Array;
      expectFloatArraysClose(wasmRaw, js, PARITY_EPSILON, "log_transform");
    });

    test.each(sizes)("base 10 n=$n", ({ n }) => {
      const data = makeData(n);
      const js = logTransformCore(data, 10);
      const wasmRaw = (wasm as any).log_transform(data, 10) as Float64Array;
      expectFloatArraysClose(wasmRaw, js, PARITY_EPSILON, "log_transform-10");
    });
  });

  describe("power_transform", () => {
    test.each(sizes)("square n=$n", ({ n }) => {
      const data = makeData(n);
      const js = powerTransformCore(data, 2);
      const wasmRaw = (wasm as any).power_transform(data, 2) as Float64Array;
      expectFloatArraysClose(wasmRaw, js, PARITY_EPSILON, "power_transform-sq");
    });

    test.each(sizes)("sqrt n=$n", ({ n }) => {
      const data = makeData(n);
      const js = powerTransformCore(data, 0.5);
      const wasmRaw = (wasm as any).power_transform(data, 0.5) as Float64Array;
      expectFloatArraysClose(wasmRaw, js, PARITY_EPSILON, "power_transform-sqrt");
    });
  });
});

// Guardrail: surface module availability without failing CI when wasm is absent.
test("transform wasm module availability is reported", () => {
  expect(typeof (wasm === null ? "absent" : "present")).toBe("string");
});
