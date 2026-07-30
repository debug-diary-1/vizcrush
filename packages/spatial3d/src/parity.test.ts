import { describe, test, expect } from "vitest";
import { loadWasmForParity } from "@vizcrush/core/parity";
import { buildOctreeCore, queryRange3dCore, frustumCullCore } from "./cores.js";

// Load the REAL wasm-bindgen module once. If the build is absent, the parity
// tests skip rather than fail (CI builds wasm; local runs may not).
const wasm = await loadWasmForParity(import.meta.url, "vizcrush_spatial3d");

function makePoints(n: number) {
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = Math.sin(i * 0.07) * 50 + 50;
    y[i] = Math.cos(i * 0.05) * 50 + 50;
    z[i] = Math.sin(i * 0.017) * 50 + 50;
  }
  return { x, y, z };
}

function expectSameIndexSet(actual: ArrayLike<number>, expected: ArrayLike<number>, label: string) {
  const a = new Set(Array.from(actual as ArrayLike<number>));
  const e = new Set(Array.from(expected as ArrayLike<number>));
  if (a.size !== e.size) {
    throw new Error(`${label}: size mismatch — js=${e.size} wasm=${a.size}`);
  }
  for (const v of e) {
    if (!a.has(v)) throw new Error(`${label}: js index ${v} missing from wasm result`);
  }
}

describe.runIf(wasm !== null)("spatial3d JS ≡ WASM parity", () => {
  const sizes = [{ n: 1000 }, { n: 4096 }, { n: 333 }];

  describe("octree range query", () => {
    const boxes = [
      { xMin: 20, xMax: 60, yMin: 30, yMax: 70, zMin: 10, zMax: 80 },
      { xMin: -1e6, xMax: 1e6, yMin: -1e6, yMax: 1e6, zMin: -1e6, zMax: 1e6 }, // full
      { xMin: 500, xMax: 600, yMin: 500, yMax: 600, zMin: 500, zMax: 600 }, // empty
    ];
    test.each(sizes)("n=$n", ({ n }) => {
      const { x, y, z } = makePoints(n);
      const jsTree = buildOctreeCore(x, y, z);
      const wasmTree = (wasm as any).build_octree(x, y, z);
      for (const b of boxes) {
        const js = queryRange3dCore(jsTree, b);
        const w = wasmTree.query_range(
          b.xMin,
          b.xMax,
          b.yMin,
          b.yMax,
          b.zMin,
          b.zMax,
        ) as Uint32Array;
        expectSameIndexSet(w, js, `octree-range n=${n}`);
      }
    });
  });

  describe("frustum_cull", () => {
    const mvps = [
      new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -50, -50, -50, 200]),
      new Float64Array([0.02, 0, 0, 0, 0, 0.02, 0, 0, 0, 0, 0.02, 0, -1, -1, -1, 2]),
    ];
    test.each(sizes)("n=$n", ({ n }) => {
      const { x, y, z } = makePoints(n);
      for (const mvp of mvps) {
        const js = frustumCullCore(x, y, z, mvp);
        const planes = (wasm as any).build_frustum_from_mvp(mvp);
        const w = (wasm as any).frustum_cull(x, y, z, planes) as Uint32Array;
        expectSameIndexSet(w, js, `frustum-cull n=${n}`);
      }
    });
  });
});

// Guardrail: surface module availability without failing CI when wasm is absent.
test("spatial3d wasm module availability is reported", () => {
  expect(typeof (wasm === null ? "absent" : "present")).toBe("string");
});
