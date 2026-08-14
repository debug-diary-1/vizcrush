import type { KernelCallOptions } from "@vizcrush/core";
import { defineKernel, createWasmLoader } from "@vizcrush/core";
import {
  buildOctreeCore,
  queryRange3dCore,
  queryNearest3dCore,
  frustumCullCore,
  type BBox3d,
  type OctreeCore,
} from "./cores.js";

export {
  buildOctreeCore,
  queryRange3dCore,
  queryNearest3dCore,
  frustumCullCore,
  type BBox3d,
  type OctreeCore,
  type OctNode,
} from "./cores.js";

/**
 * Single WASM loader for the spatial3d crate. The dynamic import is authored
 * here so the `../wasm/...` specifier resolves against this package's `dist/`.
 * The core kernel/loader owns caching, init, and null-on-failure — replacing
 * the hand-rolled `loadWasm` trampoline and the `wasmReady` flag.
 */
const loader = createWasmLoader("vizcrush_spatial3d", () =>
  new Function("p", "return import(p)")(["..", "wasm", "vizcrush_spatial3d.js"].join("/")),
);

export interface OctreeHandle {
  id: string;
  pointCount: number;
  bounds: BBox3d;
}

/**
 * Which adapter backs a handle is this module's private knowledge. Handles
 * stay plain serializable metadata; the adapter object lives here, keyed by
 * handle identity, so no caller can branch on the backing adapter again.
 */
type OctreeBacking = { kind: "js"; core: OctreeCore } | { kind: "wasm"; tree: any };
const octreeBacking = new WeakMap<OctreeHandle, OctreeBacking>();

function octreeBackingOf(tree: OctreeHandle): OctreeBacking {
  const b = octreeBacking.get(tree);
  if (!b) {
    throw new Error(
      "Not a live octree handle — build one with buildOctree/buildOctreeSync " +
        "in this process (handles do not survive serialization)",
    );
  }
  return b;
}

let treeCounter = 0;

// ── buildOctree ──
// The kernel owns load · dispatch · fallback; the JS adapter is the pure
// `buildOctreeCore`, the WASM adapter calls `build_octree` and reads its
// bounds. Both unmarshal into a uniform `OctreeHandle`.
type BuildArgs = [x: Float64Array, y: Float64Array, z: Float64Array];

const buildOctreeKernel = defineKernel<
  BuildArgs,
  OctreeHandle,
  [Float64Array, Float64Array, Float64Array],
  any
>({
  wasmModuleName: "vizcrush_spatial3d",
  loader,
  wasmFn: (mod, x, y, z) => mod.build_octree(x, y, z),
  jsFallback: (x, y, z) => {
    const core = buildOctreeCore(x, y, z);
    const handle: OctreeHandle = {
      id: `ot_${treeCounter++}`,
      pointCount: core.pointCount,
      bounds: core.bounds,
    };
    octreeBacking.set(handle, { kind: "js", core });
    return handle;
  },
  marshal: (x, y, z) => [x, y, z],
  unmarshal: (wasmTree, x) => {
    const b = wasmTree.bounds();
    const handle: OctreeHandle = {
      id: `ot_${treeCounter++}`,
      pointCount: x.length,
      bounds: { xMin: b[0], xMax: b[1], yMin: b[2], yMax: b[3], zMin: b[4], zMax: b[5] },
    };
    octreeBacking.set(handle, { kind: "wasm", tree: wasmTree });
    return handle;
  },
  // The wasm build_octree returns an opaque tree object regardless of size;
  // dispatch is purely "wasm available or not", so cross at any size.
  sizeOf: () => Number.POSITIVE_INFINITY,
});

// ── frustumCull ──
// WASM extracts the 6 planes in Rust then tests points with SIMD; the JS core
// folds both steps. Typed arrays cross directly (no `Array.from` boxing).
type FrustumArgs = [x: Float64Array, y: Float64Array, z: Float64Array, mvpMatrix: Float64Array];

const frustumCullKernel = defineKernel<
  FrustumArgs,
  Uint32Array,
  [Float64Array, Float64Array, Float64Array, Float64Array],
  Uint32Array
>({
  wasmModuleName: "vizcrush_spatial3d",
  loader,
  wasmFn: (mod, x, y, z, mvp) => {
    const planes = mod.build_frustum_from_mvp(mvp);
    return mod.frustum_cull(x, y, z, planes) as Uint32Array;
  },
  jsFallback: frustumCullCore,
  marshal: (x, y, z, mvp) => [x, y, z, mvp],
  unmarshal: (raw) => raw,
  sizeOf: (x) => x.length,
});

/**
 * Build a spatial index (octree) over 3D point data.
 * Uses WASM+SIMD when available, falls back to JS.
 */
export async function buildOctree(
  x: Float64Array,
  y: Float64Array,
  z: Float64Array,
  opts?: KernelCallOptions,
): Promise<OctreeHandle> {
  return buildOctreeKernel(x, y, z, opts);
}

/**
 * Synchronous octree build (the kernel's pure-JS core). Use when an async
 * shell / WASM dispatch is not wanted (e.g. the MCP server).
 */
export function buildOctreeSync(x: Float64Array, y: Float64Array, z: Float64Array): OctreeHandle {
  return buildOctreeKernel.core(x, y, z);
}

/**
 * Find all points within a 3D bounding box.
 */
export function queryRange3d(tree: OctreeHandle, bbox: BBox3d): Uint32Array {
  const b = octreeBackingOf(tree);
  return b.kind === "wasm"
    ? b.tree.query_range(bbox.xMin, bbox.xMax, bbox.yMin, bbox.yMax, bbox.zMin, bbox.zMax)
    : queryRange3dCore(b.core, bbox);
}

/**
 * k-nearest neighbor search in 3D.
 */
export function queryNearest3d(
  tree: OctreeHandle,
  px: number,
  py: number,
  pz: number,
  k: number,
): Uint32Array {
  const b = octreeBackingOf(tree);
  return b.kind === "wasm"
    ? b.tree.query_nearest(px, py, pz, k)
    : queryNearest3dCore(b.core, px, py, pz, k);
}

/**
 * Frustum culling: returns indices of points inside the frustum defined by a
 * column-major 4x4 MVP matrix.
 */
export async function frustumCull(
  x: Float64Array,
  y: Float64Array,
  z: Float64Array,
  mvpMatrix: Float64Array,
  opts?: KernelCallOptions,
): Promise<Uint32Array> {
  return frustumCullKernel(x, y, z, mvpMatrix, opts);
}

/**
 * Synchronous frustum cull (the kernel's pure-JS core).
 */
export function frustumCullSync(
  x: Float64Array,
  y: Float64Array,
  z: Float64Array,
  mvpMatrix: Float64Array,
): Uint32Array {
  return frustumCullKernel.core(x, y, z, mvpMatrix);
}

/** The WASM-backed kernels, exposed for the shared parity harness. */
export const spatial3dKernels = {
  buildOctree: buildOctreeKernel,
  frustumCull: frustumCullKernel,
};
