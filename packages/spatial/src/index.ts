import type { KernelCallOptions } from "@vizcrush/core";
import { defineKernel, createWasmLoader } from "@vizcrush/core";
import {
  buildQuadtreeCore,
  queryRangeCore,
  queryNearestCore,
  mortonOrder2dCore,
  buildHashGridCore,
  hashGridQueryRadiusCore,
  hashGridQueryRangeCore,
  type BBox,
  type QuadtreeCore,
  type SpatialHashGridCore,
} from "./cores.js";

export {
  buildQuadtreeCore,
  queryRangeCore,
  queryNearestCore,
  mortonOrder2dCore,
  buildHashGridCore,
  hashGridQueryRadiusCore,
  hashGridQueryRangeCore,
  type BBox,
  type QuadtreeCore,
  type QuadNode,
  type SpatialHashGridCore,
} from "./cores.js";

/**
 * Single WASM loader for the spatial crate. The dynamic import is authored here
 * so the `../wasm/...` specifier resolves against this package's `dist/`. The
 * core kernel/loader owns caching, init, and null-on-failure — replacing the
 * hand-rolled `loadWasm` trampoline.
 */
const loader = createWasmLoader("vizcrush_spatial", () =>
  new Function("p", "return import(p)")(["..", "wasm", "vizcrush_spatial.js"].join("/")),
);

export interface QuadtreeHandle {
  id: string;
  pointCount: number;
  bounds: BBox;
  /** Pure-JS core tree, present when the JS adapter ran. */
  _core?: QuadtreeCore;
  /** WASM tree object, present when the WASM adapter ran. */
  _wasmTree?: any;
}

let treeCounter = 0;

// ── buildQuadtree ──
// The kernel owns load · dispatch · fallback; the JS adapter is the pure
// `buildQuadtreeCore`, the WASM adapter calls `build_quadtree` and reads its
// bounds. Both unmarshal into a uniform `QuadtreeHandle`. Typed arrays cross
// the boundary directly (no `Array.from` boxing).
type BuildArgs = [x: Float64Array, y: Float64Array];

const buildQuadtreeKernel = defineKernel<
  BuildArgs,
  QuadtreeHandle,
  [Float64Array, Float64Array],
  any
>({
  wasmModuleName: "vizcrush_spatial",
  loader,
  wasmFn: (mod, x, y) => mod.build_quadtree(x, y),
  jsFallback: (x, y) => {
    const core = buildQuadtreeCore(x, y);
    return {
      id: `qt_${treeCounter++}`,
      pointCount: core.pointCount,
      bounds: core.bounds,
      _core: core,
    };
  },
  marshal: (x, y) => [x, y],
  unmarshal: (wasmTree, x) => {
    const b = wasmTree.bounds();
    return {
      id: `qt_${treeCounter++}`,
      pointCount: x.length,
      bounds: { xMin: b[0], xMax: b[1], yMin: b[2], yMax: b[3] },
      _wasmTree: wasmTree,
    };
  },
  // The wasm build_quadtree returns an opaque tree object regardless of size;
  // dispatch is purely "wasm available or not", so cross at any size.
  sizeOf: () => Number.POSITIVE_INFINITY,
});

// ── mortonOrder2d ──
type MortonArgs = [x: Float64Array, y: Float64Array];

const mortonOrder2dKernel = defineKernel<
  MortonArgs,
  Uint32Array,
  [Float64Array, Float64Array],
  Uint32Array
>({
  wasmModuleName: "vizcrush_spatial",
  loader,
  wasmFn: (mod, x, y) => new Uint32Array(mod.morton_order_2d(x, y)),
  jsFallback: mortonOrder2dCore,
  marshal: (x, y) => [x, y],
  unmarshal: (raw) => raw,
  sizeOf: (x) => x.length,
});

/**
 * Build a spatial index (quadtree) over 2D point data.
 * Uses WASM+SIMD when available, falls back to JS.
 */
export async function buildQuadtree(
  x: Float64Array,
  y: Float64Array,
  opts?: KernelCallOptions,
): Promise<QuadtreeHandle> {
  return buildQuadtreeKernel(x, y, opts);
}

/**
 * Synchronous quadtree build (the kernel's pure-JS core). Use when an async
 * shell / WASM dispatch is not wanted (e.g. the MCP server).
 */
export function buildQuadtreeSync(x: Float64Array, y: Float64Array): QuadtreeHandle {
  return buildQuadtreeKernel.core(x, y);
}

/**
 * Find all points within a bounding box.
 */
export function queryRange(tree: QuadtreeHandle, bbox: BBox): Uint32Array {
  if (tree._wasmTree) {
    return tree._wasmTree.query_range(bbox.xMin, bbox.xMax, bbox.yMin, bbox.yMax);
  }
  if (tree._core) {
    return queryRangeCore(tree._core, bbox);
  }
  return new Uint32Array(0);
}

/**
 * k-nearest neighbor search.
 */
export function queryNearest(tree: QuadtreeHandle, px: number, py: number, k: number): Uint32Array {
  if (tree._wasmTree) {
    return tree._wasmTree.query_nearest(px, py, k);
  }
  if (tree._core) {
    return queryNearestCore(tree._core, px, py, k);
  }
  return new Uint32Array(0);
}

/**
 * Reorder 2D points by Z-order curve (Morton code) for cache-friendly access.
 * Returns indices sorted by Morton code.
 */
export async function mortonOrder2d(
  x: Float64Array,
  y: Float64Array,
  opts?: KernelCallOptions,
): Promise<Uint32Array> {
  return mortonOrder2dKernel(x, y, opts);
}

// ── Spatial Hash Grid ──
// Same shape as buildQuadtree above: the kernel owns load · dispatch ·
// fallback, the JS adapter is buildHashGridCore, the WASM adapter constructs
// `SpatialHashGrid` and inserts. Both unmarshal into a uniform handle with
// query methods dispatching on whichever adapter actually ran.

export interface SpatialHashGridHandle {
  cellSize: number;
  count: number;
  cellCount: number;
  /** Pure-JS core grid, present when the JS adapter ran. */
  _core?: SpatialHashGridCore;
  /** WASM grid object, present when the WASM adapter ran. */
  _wasmGrid?: any;
}

type BuildHashGridArgs = [x: Float64Array, y: Float64Array, cellSize: number];

const buildHashGridKernel = defineKernel<
  BuildHashGridArgs,
  SpatialHashGridHandle,
  [Float64Array, Float64Array, number],
  any
>({
  wasmModuleName: "vizcrush_spatial",
  loader,
  wasmFn: (mod, x, y, cellSize) => {
    const grid = new mod.SpatialHashGrid(cellSize);
    grid.insert_batch(x, y);
    return grid;
  },
  jsFallback: (x, y, cellSize) => {
    const core = buildHashGridCore(x, y, cellSize);
    return {
      cellSize,
      count: core.xData.length,
      cellCount: core.cellCount,
      _core: core,
    };
  },
  marshal: (x, y, cellSize) => [x, y, cellSize],
  unmarshal: (wasmGrid) => ({
    cellSize: wasmGrid.cell_size,
    count: wasmGrid.count,
    cellCount: wasmGrid.cell_count,
    _wasmGrid: wasmGrid,
  }),
  // The wasm grid returns an opaque handle regardless of size; dispatch is
  // purely "wasm available or not", same rationale as buildQuadtree.
  sizeOf: () => Number.POSITIVE_INFINITY,
});

/**
 * Build a spatial hash grid for fast radius and range queries on uniform-density point clouds.
 * Uses WASM when available, falls back to JS.
 */
export async function buildHashGrid(
  x: Float64Array,
  y: Float64Array,
  cellSize: number,
  opts?: KernelCallOptions,
): Promise<SpatialHashGridHandle> {
  return buildHashGridKernel(x, y, cellSize, opts);
}

/**
 * Synchronous hash grid build (the kernel's pure-JS core). Use when an async
 * shell / WASM dispatch is not wanted (e.g. the MCP server).
 */
export function buildHashGridSync(
  x: Float64Array,
  y: Float64Array,
  cellSize: number,
): SpatialHashGridHandle {
  return buildHashGridKernel.core(x, y, cellSize);
}

/**
 * Query all points within a radius of (px, py).
 */
export function hashGridQueryRadius(
  handle: SpatialHashGridHandle,
  px: number,
  py: number,
  radius: number,
): Uint32Array {
  if (handle._wasmGrid) {
    return handle._wasmGrid.query_radius(px, py, radius);
  }
  if (handle._core) {
    return hashGridQueryRadiusCore(handle._core, px, py, radius);
  }
  return new Uint32Array(0);
}

/**
 * Query all points within an axis-aligned bounding box.
 */
export function hashGridQueryRange(
  handle: SpatialHashGridHandle,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
): Uint32Array {
  if (handle._wasmGrid) {
    return handle._wasmGrid.query_range(xMin, xMax, yMin, yMax);
  }
  if (handle._core) {
    return hashGridQueryRangeCore(handle._core, xMin, xMax, yMin, yMax);
  }
  return new Uint32Array(0);
}

/** The WASM-backed kernels, exposed for the shared parity harness. */
export const spatialKernels = {
  buildQuadtree: buildQuadtreeKernel,
  mortonOrder2d: mortonOrder2dKernel,
  buildHashGrid: buildHashGridKernel,
};
