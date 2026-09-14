/**
 * MCP tool handlers for 2D spatial indexing. Calls the shared `@vizcrush/spatial`
 * cores — the same quadtree the package's async shell dispatches to — so MCP and
 * direct package use cannot drift. The hand-rolled quadtree that used to live
 * here is deleted.
 */

import { buildQuadtreeSync, queryRange } from "@vizcrush/spatial";
import { paginateIndices } from "./bounded-index-store.js";
import type { SpatialIndexRegistry } from "./spatial-index-registry.js";

export function handleBuildIndex(
  registry: SpatialIndexRegistry,
  input: { x: number[]; y: number[]; index_id?: string },
) {
  const start = performance.now();
  const { x, y } = input;
  const id = input.index_id ?? registry.nextId("2d");

  const handle = buildQuadtreeSync(new Float64Array(x), new Float64Array(y));
  registry.set2d(id, { x, y, handle });
  const elapsed = performance.now() - start;

  const b = handle.bounds;
  return {
    index_id: id,
    point_count: handle.pointCount,
    bounds: { x_min: b.xMin, x_max: b.xMax, y_min: b.yMin, y_max: b.yMax },
    elapsed_ms: Math.round(elapsed * 100) / 100,
  };
}

export function handleQueryRange(
  registry: SpatialIndexRegistry,
  input: {
    index_id: string;
    x_min: number;
    x_max: number;
    y_min: number;
    y_max: number;
    offset?: number;
    limit?: number;
  },
) {
  const entry = registry.get2d(input.index_id);
  if (!entry) {
    return { error: `Index '${input.index_id}' not found` };
  }

  const start = performance.now();
  const page = paginateIndices(
    queryRange(entry.handle, {
      xMin: input.x_min,
      xMax: input.x_max,
      yMin: input.y_min,
      yMax: input.y_max,
    }),
    input.offset,
    input.limit,
  );
  const elapsed = performance.now() - start;

  return {
    ...page,
    elapsed_ms: Math.round(elapsed * 100) / 100,
  };
}
