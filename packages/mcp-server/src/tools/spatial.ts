/**
 * MCP tool handlers for 2D spatial indexing. Calls the shared `@vizcrush/spatial`
 * cores — the same quadtree the package's async shell dispatches to — so MCP and
 * direct package use cannot drift. The hand-rolled quadtree that used to live
 * here is deleted.
 */

import { buildQuadtreeSync, queryRange, type QuadtreeHandle } from "@vizcrush/spatial";

const spatialIndexes = new Map<
  string,
  {
    x: number[];
    y: number[];
    handle: QuadtreeHandle;
  }
>();

let indexCounter = 0;

export function handleBuildIndex(input: { x: number[]; y: number[]; index_id?: string }) {
  const start = performance.now();
  const { x, y } = input;
  const id = input.index_id ?? `idx_${indexCounter++}`;

  const handle = buildQuadtreeSync(new Float64Array(x), new Float64Array(y));
  spatialIndexes.set(id, { x, y, handle });
  const elapsed = performance.now() - start;

  const b = handle.bounds;
  return {
    index_id: id,
    point_count: handle.pointCount,
    bounds: { x_min: b.xMin, x_max: b.xMax, y_min: b.yMin, y_max: b.yMax },
    elapsed_ms: Math.round(elapsed * 100) / 100,
  };
}

export function handleQueryRange(input: {
  index_id: string;
  x_min: number;
  x_max: number;
  y_min: number;
  y_max: number;
}) {
  const entry = spatialIndexes.get(input.index_id);
  if (!entry) {
    return { error: `Index '${input.index_id}' not found` };
  }

  const start = performance.now();
  const indices = Array.from(
    queryRange(entry.handle, {
      xMin: input.x_min,
      xMax: input.x_max,
      yMin: input.y_min,
      yMax: input.y_max,
    }),
  );
  const elapsed = performance.now() - start;

  return {
    indices,
    count: indices.length,
    elapsed_ms: Math.round(elapsed * 100) / 100,
  };
}

// ── MCP Resource helpers (v1.0) ──

export function getIndexList() {
  return Array.from(spatialIndexes.entries()).map(([id, entry]) => ({
    index_id: id,
    point_count: entry.handle.pointCount,
    bounds: entry.handle.bounds,
  }));
}

export function getIndexDetail(indexId: string) {
  const entry = spatialIndexes.get(indexId);
  if (!entry) {
    return { error: `Index '${indexId}' not found` };
  }

  // Sample first 10 points
  const sampleSize = Math.min(10, entry.x.length);
  const sample = Array.from({ length: sampleSize }, (_, i) => ({
    index: i,
    x: entry.x[i],
    y: entry.y[i],
  }));

  return {
    index_id: indexId,
    point_count: entry.handle.pointCount,
    bounds: entry.handle.bounds,
    sample_points: sample,
  };
}
