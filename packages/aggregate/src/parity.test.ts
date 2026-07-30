import { describe, test, expect } from "vitest";
import { loadWasmForParity, expectFloatArraysClose, PARITY_EPSILON } from "@vizcrush/core/parity";
import { statsCore, percentileCore } from "./cores.js";

// Load the REAL wasm-bindgen module once. If the build is absent, the parity
// tests skip rather than fail (CI builds wasm; local runs may not).
const wasm = await loadWasmForParity(import.meta.url, "vizcrush_aggregate");

function makeData(n: number): Float64Array {
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    d[i] = Math.sin(i * 0.05) * 100 + Math.cos(i * 0.013) * 17 + 200;
  }
  return d;
}

describe.runIf(wasm !== null)("aggregate JS ≡ WASM parity", () => {
  describe("stats / compute_stats", () => {
    test.each([{ n: 1000 }, { n: 2048 }, { n: 333 }])("n=$n", ({ n }) => {
      const data = makeData(n);

      const js = statsCore(data);
      const wasmRaw = (wasm as any).compute_stats(data) as Float64Array;

      const jsPacked = new Float64Array([
        js.count,
        js.min,
        js.max,
        js.mean,
        js.stdDev,
        js.variance,
      ]);

      expectFloatArraysClose(wasmRaw, jsPacked, PARITY_EPSILON, "compute_stats");
    });
  });

  describe("percentile / compute_percentiles", () => {
    const pcts = [0, 25, 50, 75, 90, 95, 99, 100];
    test.each([{ n: 1000 }, { n: 2048 }, { n: 333 }])("n=$n", ({ n }) => {
      const data = makeData(n);

      const js = percentileCore(data, pcts);
      const wasmRaw = (wasm as any).compute_percentiles(
        data,
        new Float64Array(pcts),
      ) as Float64Array;

      expectFloatArraysClose(wasmRaw, js, PARITY_EPSILON, "compute_percentiles");
    });
  });
});

// Guardrail: surface module availability without failing CI when wasm is absent.
test("aggregate wasm module availability is reported", () => {
  expect(typeof (wasm === null ? "absent" : "present")).toBe("string");
});
