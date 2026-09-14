import type { QuadtreeHandle } from "@vizcrush/spatial";
import type { OctreeHandle } from "@vizcrush/spatial3d";
import { BoundedIndexStore, configuredIndexLimit } from "./bounded-index-store.js";

export interface SpatialIndex2dEntry {
  x: number[];
  y: number[];
  handle: QuadtreeHandle;
}

export interface SpatialIndex3dEntry {
  x: number[];
  y: number[];
  z: number[];
  handle: OctreeHandle;
}

export type SpatialDimension = "2d" | "3d";

/** Owns the independent 2D and 3D index namespaces for one MCP server. */
export class SpatialIndexRegistry {
  readonly #indexes2d: BoundedIndexStore<SpatialIndex2dEntry>;
  readonly #indexes3d: BoundedIndexStore<SpatialIndex3dEntry>;
  #counter2d = 0;
  #counter3d = 0;

  constructor(limit = configuredIndexLimit()) {
    this.#indexes2d = new BoundedIndexStore(limit);
    this.#indexes3d = new BoundedIndexStore(limit);
  }

  nextId(dimension: SpatialDimension): string {
    return dimension === "2d" ? `idx_${this.#counter2d++}` : `oct_${this.#counter3d++}`;
  }

  set2d(id: string, entry: SpatialIndex2dEntry): void {
    this.#indexes2d.set(id, entry);
  }

  set3d(id: string, entry: SpatialIndex3dEntry): void {
    this.#indexes3d.set(id, entry);
  }

  get2d(id: string): SpatialIndex2dEntry | undefined {
    return this.#indexes2d.get(id);
  }

  get3d(id: string): SpatialIndex3dEntry | undefined {
    return this.#indexes3d.get(id);
  }

  delete(id: string, dimension: SpatialDimension): boolean {
    return dimension === "2d" ? this.#indexes2d.delete(id) : this.#indexes3d.delete(id);
  }

  list2d() {
    return this.#indexes2d.entries().map(([id, entry]) => ({
      index_id: id,
      point_count: entry.handle.pointCount,
      bounds: entry.handle.bounds,
    }));
  }

  detail2d(id: string) {
    const entry = this.#indexes2d.get(id);
    if (!entry) return { error: `Index '${id}' not found` };
    const sampleSize = Math.min(10, entry.x.length);
    return {
      index_id: id,
      point_count: entry.handle.pointCount,
      bounds: entry.handle.bounds,
      sample_points: Array.from({ length: sampleSize }, (_, index) => ({
        index,
        x: entry.x[index],
        y: entry.y[index],
      })),
    };
  }
}
