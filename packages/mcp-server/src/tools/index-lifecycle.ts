import type { SpatialIndexRegistry } from "./spatial-index-registry.js";

export function handleDeleteIndex(
  registry: SpatialIndexRegistry,
  input: { index_id: string; dimension: "2d" | "3d" },
) {
  const deleted = registry.delete(input.index_id, input.dimension);
  return { index_id: input.index_id, deleted };
}
