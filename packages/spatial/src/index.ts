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
 * Single WASM loader for the vizcrush_spatial crate.
 *
 * The specifier is the package's own name rather than a relative path, and it
 * is a plain `import()` rather than a hidden one, because both properties are
 * load-bearing for bundled consumers. A relative `../wasm/...` resolves
 * correctly only while this file lives in the package's `dist/`; once a bundler
 * inlines it, the same path resolves against the application chunk and 404s,
 * and the loader's swallow-failures contract turns that into a silent drop to
 * the JS core. Keeping it statically analysable lets bundlers treat the
 * wasm-bindgen glue as a module, rewrite its internal
 * `new URL('..._bg.wasm', import.meta.url)`, and emit the binary as an asset.
 * It stays a dynamic `import()`, so it remains a lazily-fetched chunk.
 */
const loader = createWasmLoader(
  "vizcrush_spatial",
  () => import("@vizcrush/spatial/wasm/vizcrush_spatial.js"),
);

export interface QuadtreeHandle {
  id: string;
  pointCount: number;
  bounds: BBox;
}

/**
 * Which adapter backs a handle is this module's private knowledge. Handles
 * stay plain serializable metadata; the adapter object lives here, keyed by
 * handle identity, so no caller can branch on `_core` / `_wasmTree` again.
 */
interface QuadtreeBacking {
  queryRange(bbox: BBox): Uint32Array;
  queryNearest(px: number, py: number, k: number): Uint32Array;
}
const quadtreeBacking = new WeakMap<QuadtreeHandle, QuadtreeBacking>();

function quadtreeBackingOf(tree: QuadtreeHandle): QuadtreeBacking {
  const b = quadtreeBacking.get(tree);
  if (!b) {
    throw new Error(
      "Not a live quadtree handle — build one with buildQuadtree/buildQuadtreeSync " +
        "in this process (handles do not survive serialization)",
    );
  }
  return b;
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
    const handle: QuadtreeHandle = {
      id: `qt_${treeCounter++}`,
      pointCount: core.pointCount,
      bounds: core.bounds,
    };
    quadtreeBacking.set(handle, {
      queryRange: (bbox) => queryRangeCore(core, bbox),
      queryNearest: (px, py, k) => queryNearestCore(core, px, py, k),
    });
    return handle;
  },
  marshal: (x, y) => [x, y],
  unmarshal: (wasmTree, x) => {
    const b = wasmTree.bounds();
    const handle: QuadtreeHandle = {
      id: `qt_${treeCounter++}`,
      pointCount: x.length,
      bounds: { xMin: b[0], xMax: b[1], yMin: b[2], yMax: b[3] },
    };
    quadtreeBacking.set(handle, {
      queryRange: (bbox) => wasmTree.query_range(bbox.xMin, bbox.xMax, bbox.yMin, bbox.yMax),
      queryNearest: (px, py, k) => wasmTree.query_nearest(px, py, k),
    });
    return handle;
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
  return quadtreeBackingOf(tree).queryRange(bbox);
}

/**
 * k-nearest neighbor search.
 */
export function queryNearest(tree: QuadtreeHandle, px: number, py: number, k: number): Uint32Array {
  return quadtreeBackingOf(tree).queryNearest(px, py, k);
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
}

/** Adapter backing for hash-grid handles; same privacy story as quadtrees. */
interface HashGridBacking {
  queryRadius(px: number, py: number, radius: number): Uint32Array;
  queryRange(xMin: number, xMax: number, yMin: number, yMax: number): Uint32Array;
}
const hashGridBacking = new WeakMap<SpatialHashGridHandle, HashGridBacking>();

function hashGridBackingOf(handle: SpatialHashGridHandle): HashGridBacking {
  const b = hashGridBacking.get(handle);
  if (!b) {
    throw new Error(
      "Not a live hash-grid handle — build one with buildHashGrid/buildHashGridSync " +
        "in this process (handles do not survive serialization)",
    );
  }
  return b;
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
    const handle: SpatialHashGridHandle = {
      cellSize,
      count: core.xData.length,
      cellCount: core.cellCount,
    };
    hashGridBacking.set(handle, {
      queryRadius: (px, py, radius) => hashGridQueryRadiusCore(core, px, py, radius),
      queryRange: (xMin, xMax, yMin, yMax) => hashGridQueryRangeCore(core, xMin, xMax, yMin, yMax),
    });
    return handle;
  },
  marshal: (x, y, cellSize) => [x, y, cellSize],
  unmarshal: (wasmGrid) => {
    const handle: SpatialHashGridHandle = {
      cellSize: wasmGrid.cell_size,
      count: wasmGrid.count,
      cellCount: wasmGrid.cell_count,
    };
    hashGridBacking.set(handle, {
      queryRadius: (px, py, radius) => wasmGrid.query_radius(px, py, radius),
      queryRange: (xMin, xMax, yMin, yMax) => wasmGrid.query_range(xMin, xMax, yMin, yMax),
    });
    return handle;
  },
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
  return hashGridBackingOf(handle).queryRadius(px, py, radius);
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
  return hashGridBackingOf(handle).queryRange(xMin, xMax, yMin, yMax);
}

/** The WASM-backed kernels, exposed for the shared parity harness. */
export const spatialKernels = {
  buildQuadtree: buildQuadtreeKernel,
  mortonOrder2d: mortonOrder2dKernel,
  buildHashGrid: buildHashGridKernel,
};
