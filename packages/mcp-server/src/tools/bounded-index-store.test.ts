import { afterEach, describe, expect, test } from "vitest";
import { BoundedIndexStore, paginateIndices } from "./bounded-index-store.js";

afterEach(() => {
  delete process.env.VIZCRUSH_MAX_STORED_INDEXES;
});

describe("BoundedIndexStore", () => {
  test("evicts the least recently used entry at the configured limit", () => {
    process.env.VIZCRUSH_MAX_STORED_INDEXES = "2";
    const store = new BoundedIndexStore<number>();
    store.set("old", 1);
    store.set("recent", 2);
    expect(store.get("old")).toBe(1);

    store.set("new", 3);

    expect(store.get("recent")).toBeUndefined();
    expect(store.get("old")).toBe(1);
    expect(store.get("new")).toBe(3);
  });

  test("paginates typed-array results before converting them to JSON arrays", () => {
    expect(paginateIndices(new Uint32Array([0, 1, 2, 3]), 1, 2)).toEqual({
      indices: [1, 2],
      count: 2,
      total_count: 4,
      truncated: true,
      next_offset: 3,
    });
  });
});
