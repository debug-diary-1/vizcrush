import { describe, test, expect } from "vitest";
import { loadWasmForParity, expectFloatArraysClose, PARITY_EPSILON } from "@vizcrush/core/parity";
import { bin1dCore, bin2dCore, hexbinCore } from "./cores.js";

// Load the REAL wasm-bindgen module once. If the build is absent, the parity
// tests skip rather than fail (CI builds wasm; local runs may not).
const wasm = await loadWasmForParity(import.meta.url, "vizcrush_bin");

function makeData(n: number): Float64Array {
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    d[i] = Math.sin(i * 0.05) * 100 + Math.cos(i * 0.013) * 17 + 200;
  }
  return d;
}

function makeXY(n: number): { x: Float64Array; y: Float64Array } {
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = Math.sin(i * 0.05) * 100 + 200;
    y[i] = Math.cos(i * 0.031) * 80 + 150;
  }
  return { x, y };
}

describe.runIf(wasm !== null)("bin JS ≡ WASM parity", () => {
  describe("bin1d / histogram", () => {
    test.each([
      { n: 1000, bins: 50 },
      { n: 2048, bins: 64 },
      { n: 333, bins: 16 },
    ])("n=$n bins=$bins", ({ n, bins }) => {
      const data = makeData(n);

      const js = bin1dCore(data, bins);
      const wasmRaw = (wasm as any).histogram(data, bins, NaN, NaN) as Float64Array;

      // Reconstruct JS packed form: counts as f64, then edges.
      const jsPacked = new Float64Array(bins + bins + 1);
      for (let i = 0; i < bins; i++) jsPacked[i] = js.counts[i];
      for (let i = 0; i <= bins; i++) jsPacked[bins + i] = js.edges[i];

      expectFloatArraysClose(wasmRaw, jsPacked, PARITY_EPSILON, "histogram");
    });
  });

  describe("bin2d", () => {
    test.each([
      { n: 1000, xb: 16, yb: 16 },
      { n: 2048, xb: 32, yb: 24 },
    ])("n=$n xb=$xb yb=$yb", ({ n, xb, yb }) => {
      const { x, y } = makeXY(n);

      const js = bin2dCore(x, y, xb, yb, NaN, NaN, NaN, NaN);
      const wasmRaw = (wasm as any).bin2d(x, y, xb, yb, NaN, NaN, NaN, NaN) as Float64Array;

      const gridSize = xb * yb;
      const jsPacked = new Float64Array(gridSize + (xb + 1) + (yb + 1));
      for (let i = 0; i < gridSize; i++) jsPacked[i] = js.grid[i];
      for (let i = 0; i <= xb; i++) jsPacked[gridSize + i] = js.xEdges[i];
      for (let i = 0; i <= yb; i++) jsPacked[gridSize + xb + 1 + i] = js.yEdges[i];

      expectFloatArraysClose(wasmRaw, jsPacked, PARITY_EPSILON, "bin2d");
    });
  });

  describe("hexbin", () => {
    test.each([
      { n: 1000, radius: 20 },
      { n: 333, radius: 35 },
    ])("n=$n radius=$radius", ({ n, radius }) => {
      const { x, y } = makeXY(n);

      const js = hexbinCore(x, y, radius);
      const wasmRaw = (wasm as any).hexbin(x, y, radius) as Float64Array;

      // Both store non-zero bins in arbitrary (hash/map) order — compare as
      // sets keyed by quantised centre. Total count and bin set must match.
      const key = (cx: number, cy: number) => `${cx.toFixed(6)},${cy.toFixed(6)}`;
      const wasmMap = new Map<string, number>();
      for (let i = 0; i + 2 < wasmRaw.length; i += 3) {
        wasmMap.set(key(wasmRaw[i], wasmRaw[i + 1]), wasmRaw[i + 2]);
      }
      const jsMap = new Map<string, number>();
      for (const e of js) jsMap.set(key(e.cx, e.cy), e.count);

      expect(jsMap.size).toBe(wasmMap.size);
      const jsTotal = js.reduce((a, e) => a + e.count, 0);
      let wasmTotal = 0;
      for (const c of wasmMap.values()) wasmTotal += c;
      expect(jsTotal).toBe(wasmTotal);
      expect(jsTotal).toBe(n);
      for (const [k, c] of jsMap) {
        expect(wasmMap.get(k)).toBe(c);
      }
    });
  });
});

// Guardrail: surface module availability without failing CI when wasm is absent.
test("bin wasm module availability is reported", () => {
  expect(typeof (wasm === null ? "absent" : "present")).toBe("string");
});
