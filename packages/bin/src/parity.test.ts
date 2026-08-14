import { describe, test, expect } from "vitest";
import {
  loadWasmForParity,
  parityMode,
  injectWasmModuleForTesting,
  expectFloatArraysClose,
  PARITY_EPSILON,
} from "@vizcrush/core/parity";
import { binKernels } from "./index.js";

// Load the REAL wasm-bindgen module from disk (Node can't run bindgen's
// import.meta fetch) and register it as the loaders' module transport. From
// here on, everything — marshal, dispatch, unmarshal, fallback — is the same
// production kernel path callers use. Missing wasm fails under
// VIZCRUSH_REQUIRE_WASM (CI), and skips loudly otherwise.
const wasm = await loadWasmForParity(import.meta.url, "vizcrush_bin");
const mode = parityMode(wasm, "vizcrush_bin");
if (wasm) injectWasmModuleForTesting("vizcrush_bin", wasm);

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

describe.runIf(mode === "run")("bin JS ≡ WASM parity (kernel seam)", () => {
  describe("bin1d / histogram", () => {
    test.each([
      { n: 1000, bins: 50 },
      { n: 2048, bins: 64 },
      { n: 333, bins: 16 },
    ])("n=$n bins=$bins", async ({ n, bins }) => {
      const data = makeData(n);

      const js = await binKernels.bin1d.withBackend(data, bins, undefined, { backend: "js" });
      const ws = await binKernels.bin1d.withBackend(data, bins, undefined, { backend: "wasm" });

      // The seam must report what actually ran — a silent JS fallback here
      // would mean "parity" compared JS against itself.
      expect(js.backend).toBe("js");
      expect(ws.backend).toBe("wasm");

      expect(ws.result.counts).toEqual(js.result.counts);
      expectFloatArraysClose(ws.result.edges, js.result.edges, PARITY_EPSILON, "bin1d edges");
    });
  });

  describe("bin2d", () => {
    test.each([
      { n: 1000, xb: 16, yb: 16 },
      { n: 2048, xb: 32, yb: 24 },
    ])("n=$n xb=$xb yb=$yb", async ({ n, xb, yb }) => {
      const { x, y } = makeXY(n);

      const js = await binKernels.bin2d.withBackend(x, y, xb, yb, NaN, NaN, NaN, NaN, {
        backend: "js",
      });
      const ws = await binKernels.bin2d.withBackend(x, y, xb, yb, NaN, NaN, NaN, NaN, {
        backend: "wasm",
      });

      expect(js.backend).toBe("js");
      expect(ws.backend).toBe("wasm");

      expect(ws.result.grid).toEqual(js.result.grid);
      expect(ws.result.maxCount).toBe(js.result.maxCount);
      expectFloatArraysClose(ws.result.xEdges, js.result.xEdges, PARITY_EPSILON, "bin2d xEdges");
      expectFloatArraysClose(ws.result.yEdges, js.result.yEdges, PARITY_EPSILON, "bin2d yEdges");
    });
  });

  describe("hexbin", () => {
    test.each([
      { n: 1000, radius: 20 },
      { n: 333, radius: 35 },
    ])("n=$n radius=$radius", async ({ n, radius }) => {
      const { x, y } = makeXY(n);

      const js = await binKernels.hexbin.withBackend(x, y, radius, { backend: "js" });
      const ws = await binKernels.hexbin.withBackend(x, y, radius, { backend: "wasm" });

      expect(js.backend).toBe("js");
      expect(ws.backend).toBe("wasm");

      // Both backends emit non-zero bins in arbitrary (hash/map) order — compare
      // as sets keyed by quantised centre. Total count and bin set must match.
      const key = (cx: number, cy: number) => `${cx.toFixed(6)},${cy.toFixed(6)}`;
      const wsMap = new Map<string, number>();
      for (const e of ws.result) wsMap.set(key(e.cx, e.cy), e.count);
      const jsMap = new Map<string, number>();
      for (const e of js.result) jsMap.set(key(e.cx, e.cy), e.count);

      expect(jsMap.size).toBe(wsMap.size);
      const jsTotal = js.result.reduce((a, e) => a + e.count, 0);
      const wsTotal = ws.result.reduce((a, e) => a + e.count, 0);
      expect(jsTotal).toBe(wsTotal);
      expect(jsTotal).toBe(n);
      for (const [k, c] of jsMap) {
        expect(wsMap.get(k)).toBe(c);
      }
    });
  });
});
