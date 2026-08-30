import { deleteIndex } from "./spatial.js";
import { deleteIndex3d } from "./spatial3d.js";

export function handleDeleteIndex(input: { index_id: string; dimension: "2d" | "3d" }) {
  const deleted =
    input.dimension === "3d" ? deleteIndex3d(input.index_id) : deleteIndex(input.index_id);
  return { index_id: input.index_id, deleted };
}
