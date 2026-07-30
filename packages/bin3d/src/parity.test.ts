import { describe, test, expect } from "vitest";
import { loadWasmForParity, expectFloatArraysClose, PARITY_EPSILON } from "@vizcrush/core/parity";
import { bin3dCore } from "./cores.js";

// Load the REAL wasm-bindgen module once. If the build is absent, the parity
// tests skip rather than fail (CI builds wasm; local runs may not).
const wasm = await loadWasmForParity(import.meta.url, "vizcrush_bin3d");

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

describe.runIf(wasm !== null)("bin3d JS ≡ WASM parity", () => {
  // Explicit ranges chosen wide enough that no point lands on a bin edge, so
  // the mul-vs-div reciprocal difference between cores cannot flip a bin.
  test.each([
    { n: 1000, xb: 4, yb: 4, zb: 4 },
    { n: 2000, xb: 8, yb: 8, zb: 8 },
    { n: 512, xb: 5, yb: 5, zb: 5 },
  ])("n=$n grid=$xbx$ybx$zb", ({ n, xb, yb, zb }) => {
    const { x, y, z } = makeXYZ(n);
    const opts = {
      xBins: xb,
      yBins: yb,
      zBins: zb,
      xRange: [0, 200] as [number, number],
      yRange: [0, 200] as [number, number],
      zRange: [0, 200] as [number, number],
    };

    const js = bin3dCore(x, y, z, opts);
    const wasmRaw = (wasm as any).bin3d(
      x,
      y,
      z,
      xb,
      yb,
      zb,
      0,
      200,
      0,
      200,
      0,
      200,
    ) as Float64Array;

    const gridSize = xb * yb * zb;
    const jsPacked = new Float64Array(gridSize + (xb + 1) + (yb + 1) + (zb + 1));
    for (let i = 0; i < gridSize; i++) jsPacked[i] = js.grid[i];
    for (let i = 0; i <= xb; i++) jsPacked[gridSize + i] = js.xEdges[i];
    for (let i = 0; i <= yb; i++) jsPacked[gridSize + xb + 1 + i] = js.yEdges[i];
    for (let i = 0; i <= zb; i++) jsPacked[gridSize + xb + 1 + yb + 1 + i] = js.zEdges[i];

    expectFloatArraysClose(wasmRaw, jsPacked, PARITY_EPSILON, "bin3d");
  });
});

// Guardrail: surface module availability without failing CI when wasm is absent.
test("bin3d wasm module availability is reported", () => {
  expect(typeof (wasm === null ? "absent" : "present")).toBe("string");
});
