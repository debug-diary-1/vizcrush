import { describe, test, expect } from "vitest";
import { loadWasmForParity, parityMode, injectWasmModuleForTesting } from "@vizcrush/core/parity";
import {
  spatialKernels,
  queryRange,
  queryNearest,
  hashGridQueryRadius,
  hashGridQueryRange,
} from "./index.js";

// Load the REAL wasm-bindgen module from disk (Node can't run bindgen's
// import.meta fetch) and register it as the loaders' module transport. From
// here on, everything — marshal, dispatch, unmarshal, fallback — is the same
// production kernel path callers use. Missing wasm fails under
// VIZCRUSH_REQUIRE_WASM (CI), and skips loudly otherwise.
const wasm = await loadWasmForParity(import.meta.url, "vizcrush_spatial");
const mode = parityMode(wasm, "vizcrush_spatial");
if (wasm) injectWasmModuleForTesting("vizcrush_spatial", wasm);

function makePoints(n: number): { x: Float64Array; y: Float64Array } {
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = Math.sin(i * 0.07) * 500 + Math.cos(i * 0.011) * 73 + 500;
    y[i] = Math.cos(i * 0.05) * 500 + Math.sin(i * 0.017) * 91 + 500;
  }
  return { x, y };
}

/** Compare two index lists as sets — spatial queries are order-agnostic. */
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

describe.runIf(mode === "run")("spatial JS ≡ WASM parity (kernel seam)", () => {
  const sizes = [{ n: 1000 }, { n: 4096 }, { n: 333 }];
  const queries = [
    { xMin: 100, xMax: 400, yMin: 200, yMax: 700 },
    { xMin: -10, xMax: 2000, yMin: -10, yMax: 2000 }, // full range
    { xMin: 5000, xMax: 6000, yMin: 5000, yMax: 6000 }, // empty
    { xMin: 480, xMax: 520, yMin: 480, yMax: 520 },
  ];

  describe("quadtree range + nearest query", () => {
    test.each(sizes)("n=$n", async ({ n }) => {
      const { x, y } = makePoints(n);

      const js = await spatialKernels.buildQuadtree.withBackend(x, y, { backend: "js" });
      const ws = await spatialKernels.buildQuadtree.withBackend(x, y, { backend: "wasm" });

      // The seam must report what actually ran — a silent JS fallback here
      // would mean "parity" compared JS against itself.
      expect(js.backend).toBe("js");
      expect(ws.backend).toBe("wasm");
      expect(ws.result.pointCount).toBe(js.result.pointCount);

      // Which adapter backs a handle is the module's private knowledge; parity
      // is observable only through the public query functions — the same
      // queries on both handles must agree.
      for (const q of queries) {
        expectSameIndexSet(
          queryRange(ws.result, q),
          queryRange(js.result, q),
          `quadtree-range n=${n}`,
        );
      }

      for (const { px, py, k } of [
        { px: 500, py: 500, k: 1 },
        { px: 500, py: 500, k: 10 },
        { px: 0, py: 0, k: 5 },
      ]) {
        expectSameIndexSet(
          queryNearest(ws.result, px, py, k),
          queryNearest(js.result, px, py, k),
          `quadtree-nearest n=${n} k=${k}`,
        );
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

    test.each(sizes)("n=$n", async ({ n }) => {
      const { x, y } = makePoints(n);

      const js = await spatialKernels.buildHashGrid.withBackend(x, y, cellSize, {
        backend: "js",
      });
      const ws = await spatialKernels.buildHashGrid.withBackend(x, y, cellSize, {
        backend: "wasm",
      });

      expect(js.backend).toBe("js");
      expect(ws.backend).toBe("wasm");

      expect(ws.result.count).toBe(js.result.count);
      expect(ws.result.cellCount).toBe(js.result.cellCount);

      for (const r of radii) {
        expectSameIndexSet(
          hashGridQueryRadius(ws.result, 500, 500, r),
          hashGridQueryRadius(js.result, 500, 500, r),
          `hashgrid-radius n=${n} r=${r}`,
        );
      }
      for (const q of rangeQueries) {
        expectSameIndexSet(
          hashGridQueryRange(ws.result, q.xMin, q.xMax, q.yMin, q.yMax),
          hashGridQueryRange(js.result, q.xMin, q.xMax, q.yMin, q.yMax),
          `hashgrid-range n=${n}`,
        );
      }
    });
  });

  // The Morton orderings use different normalisation scales by design (JS uses
  // a 16-bit grid; the Rust crate uses a 21-bit grid), so the permutations are
  // not byte-identical. Both must, however, be valid permutations of 0..n.
  describe("morton_order_2d permutation validity", () => {
    test.each(sizes)("n=$n", async ({ n }) => {
      const { x, y } = makePoints(n);

      const js = await spatialKernels.mortonOrder2d.withBackend(x, y, { backend: "js" });
      const ws = await spatialKernels.mortonOrder2d.withBackend(x, y, { backend: "wasm" });

      expect(js.backend).toBe("js");
      expect(ws.backend).toBe("wasm");

      expect(js.result.length).toBe(n);
      expect(ws.result.length).toBe(n);
      const identity = Array.from({ length: n }, (_, i) => i);
      expectSameIndexSet(ws.result, identity, `morton-wasm-perm n=${n}`);
      expectSameIndexSet(js.result, identity, `morton-js-perm n=${n}`);
    });
  });
});
