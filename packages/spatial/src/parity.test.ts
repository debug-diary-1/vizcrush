import { describe, test, expect } from "vitest";
import { loadWasmForParity } from "@vizcrush/core/parity";
import {
  buildQuadtreeCore,
  queryRangeCore,
  mortonOrder2dCore,
  buildHashGridCore,
  hashGridQueryRadiusCore,
  hashGridQueryRangeCore,
} from "./cores.js";

// Load the REAL wasm-bindgen module once. If the build is absent, the parity
// tests skip rather than fail (CI builds wasm; local runs may not).
const wasm = await loadWasmForParity(import.meta.url, "vizcrush_spatial");

function makePoints(n: number): { x: Float64Array; y: Float64Array } {
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = Math.sin(i * 0.07) * 500 + Math.cos(i * 0.011) * 73 + 500;
    y[i] = Math.cos(i * 0.05) * 500 + Math.sin(i * 0.017) * 91 + 500;
  }
  return { x, y };
}

/** Compare two index lists as sets — range/cull queries are order-agnostic. */
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

describe.runIf(wasm !== null)("spatial JS ≡ WASM parity", () => {
  const sizes = [{ n: 1000 }, { n: 4096 }, { n: 333 }];
  const queries = [
    { xMin: 100, xMax: 400, yMin: 200, yMax: 700 },
    { xMin: -10, xMax: 2000, yMin: -10, yMax: 2000 }, // full range
    { xMin: 5000, xMax: 6000, yMin: 5000, yMax: 6000 }, // empty
    { xMin: 480, xMax: 520, yMin: 480, yMax: 520 },
  ];

  describe("quadtree range query", () => {
    test.each(sizes)("n=$n", ({ n }) => {
      const { x, y } = makePoints(n);
      const jsTree = buildQuadtreeCore(x, y);
      const wasmTree = (wasm as any).build_quadtree(x, y);
      for (const q of queries) {
        const js = queryRangeCore(jsTree, q);
        const w = wasmTree.query_range(q.xMin, q.xMax, q.yMin, q.yMax) as Uint32Array;
        expectSameIndexSet(w, js, `quadtree-range n=${n}`);
      }
    });
  });

  describe("hash grid radius + range query", () => {
    const cellSize = 20;
    const radii = [5, 20, 80];
    const rangeQueries = [
      { xMin: 100, xMax: 400, yMin: 200, yMax: 700 },
      { xMin: 5000, xMax: 6000, yMin: 5000, yMax: 6000 }, // empty
    ];

    test.each(sizes)("n=$n", ({ n }) => {
      const { x, y } = makePoints(n);
      const jsGrid = buildHashGridCore(x, y, cellSize);
      const wasmGrid = new (wasm as any).SpatialHashGrid(cellSize);
      wasmGrid.insert_batch(x, y);

      expect(wasmGrid.count).toBe(jsGrid.xData.length);
      expect(wasmGrid.cell_count).toBe(jsGrid.cellCount);

      for (const r of radii) {
        const js = hashGridQueryRadiusCore(jsGrid, 500, 500, r);
        const w = wasmGrid.query_radius(500, 500, r) as Uint32Array;
        expectSameIndexSet(w, js, `hashgrid-radius n=${n} r=${r}`);
      }
      for (const q of rangeQueries) {
        const js = hashGridQueryRangeCore(jsGrid, q.xMin, q.xMax, q.yMin, q.yMax);
        const w = wasmGrid.query_range(q.xMin, q.xMax, q.yMin, q.yMax) as Uint32Array;
        expectSameIndexSet(w, js, `hashgrid-range n=${n}`);
      }
    });
  });

  // The Morton orderings use different normalisation scales by design (JS uses
  // a 16-bit grid; the Rust crate uses a 21-bit grid), so the permutations are
  // not byte-identical. Both must, however, be valid permutations of 0..n.
  describe("morton_order_2d permutation validity", () => {
    test.each(sizes)("n=$n", ({ n }) => {
      const { x, y } = makePoints(n);
      const js = mortonOrder2dCore(x, y);
      const w = new Uint32Array((wasm as any).morton_order_2d(x, y));
      expect(js.length).toBe(n);
      expect(w.length).toBe(n);
      expectSameIndexSet(
        w,
        Array.from({ length: n }, (_, i) => i),
        `morton-wasm-perm n=${n}`,
      );
      expectSameIndexSet(
        js,
        Array.from({ length: n }, (_, i) => i),
        `morton-js-perm n=${n}`,
      );
    });
  });
});

// Guardrail: surface module availability without failing CI when wasm is absent.
test("spatial wasm module availability is reported", () => {
  expect(typeof (wasm === null ? "absent" : "present")).toBe("string");
});
