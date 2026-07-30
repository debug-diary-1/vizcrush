/**
 * MCP tool handlers for 3D spatial operations. Calls the shared
 * `@vizcrush/spatial3d` cores — the same octree / frustum cull the package's
 * async shell dispatches to — so MCP and direct package use cannot drift. The
 * hand-rolled octree and frustum cull that used to live here are deleted.
 */

import { bin3dCore } from "@vizcrush/bin3d";
import {
  buildOctreeSync,
  queryRange3dCore,
  frustumCullCore,
  type OctreeHandle,
} from "@vizcrush/spatial3d";

const indexes3d = new Map<
  string,
  { x: number[]; y: number[]; z: number[]; handle: OctreeHandle }
>();
let counter3d = 0;

export function handleBuildIndex3d(input: {
  x: number[];
  y: number[];
  z: number[];
  index_id?: string;
}) {
  const start = performance.now();
  const { x, y, z } = input;
  const id = input.index_id ?? `oct_${counter3d++}`;

  const handle = buildOctreeSync(new Float64Array(x), new Float64Array(y), new Float64Array(z));
  indexes3d.set(id, { x, y, z, handle });

  const b = handle.bounds;
  return {
    index_id: id,
    point_count: handle.pointCount,
    bounds: {
      x_min: b.xMin,
      x_max: b.xMax,
      y_min: b.yMin,
      y_max: b.yMax,
      z_min: b.zMin,
      z_max: b.zMax,
    },
    elapsed_ms: Math.round((performance.now() - start) * 100) / 100,
  };
}

export function handleQueryRange3d(input: {
  index_id: string;
  x_min: number;
  x_max: number;
  y_min: number;
  y_max: number;
  z_min: number;
  z_max: number;
}) {
  const entry = indexes3d.get(input.index_id);
  if (!entry) return { error: `3D index '${input.index_id}' not found` };

  const start = performance.now();
  const indices = entry.handle._core
    ? Array.from(
        queryRange3dCore(entry.handle._core, {
          xMin: input.x_min,
          xMax: input.x_max,
          yMin: input.y_min,
          yMax: input.y_max,
          zMin: input.z_min,
          zMax: input.z_max,
        }),
      )
    : [];

  return {
    indices,
    count: indices.length,
    elapsed_ms: Math.round((performance.now() - start) * 100) / 100,
  };
}

export function handleBin3d(input: {
  x: number[];
  y: number[];
  z: number[];
  x_bins: number;
  y_bins: number;
  z_bins: number;
}) {
  const start = performance.now();
  const { x, y, z, x_bins, y_bins, z_bins } = input;

  // Calls the shared bin3d core — the same implementation the package's async
  // shell dispatches to, so MCP and direct package use cannot drift.
  const result = bin3dCore(new Float64Array(x), new Float64Array(y), new Float64Array(z), {
    xBins: x_bins,
    yBins: y_bins,
    zBins: z_bins,
  });

  return {
    grid: Array.from(result.grid),
    max_count: result.maxCount,
    x_bins,
    y_bins,
    z_bins,
    elapsed_ms: Math.round((performance.now() - start) * 100) / 100,
  };
}

export function handleFrustumCull(input: {
  x: number[];
  y: number[];
  z: number[];
  mvp_matrix: number[];
}) {
  const start = performance.now();
  const { x, y, z, mvp_matrix } = input;

  // Calls the shared frustum cull core — the same implementation the package's
  // async shell dispatches to.
  const indices = Array.from(
    frustumCullCore(
      new Float64Array(x),
      new Float64Array(y),
      new Float64Array(z),
      new Float64Array(mvp_matrix),
    ),
  );

  return {
    indices,
    count: indices.length,
    elapsed_ms: Math.round((performance.now() - start) * 100) / 100,
  };
}
