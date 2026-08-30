const DEFAULT_MAX_STORED_INDEXES = 16;
export const DEFAULT_QUERY_LIMIT = 10_000;

function configuredIndexLimit(): number {
  const parsed = Number.parseInt(
    process.env.VIZCRUSH_MAX_STORED_INDEXES ?? String(DEFAULT_MAX_STORED_INDEXES),
    10,
  );
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_STORED_INDEXES;
}

export class BoundedIndexStore<T> {
  private entriesById = new Map<string, { value: T; lastAccessed: number }>();
  private accessCounter = 0;

  set(id: string, value: T): void {
    if (!this.entriesById.has(id) && this.entriesById.size >= configuredIndexLimit()) {
      let oldestId: string | undefined;
      let oldestAccess = Infinity;
      for (const [candidateId, entry] of this.entriesById) {
        if (entry.lastAccessed < oldestAccess) {
          oldestId = candidateId;
          oldestAccess = entry.lastAccessed;
        }
      }
      if (oldestId) this.entriesById.delete(oldestId);
    }
    this.entriesById.set(id, { value, lastAccessed: ++this.accessCounter });
  }

  get(id: string): T | undefined {
    const entry = this.entriesById.get(id);
    if (!entry) return undefined;
    entry.lastAccessed = ++this.accessCounter;
    return entry.value;
  }

  delete(id: string): boolean {
    return this.entriesById.delete(id);
  }

  entries(): Array<[string, T]> {
    return Array.from(this.entriesById, ([id, entry]) => [id, entry.value]);
  }
}

export function paginateIndices(
  indices: Uint32Array | number[],
  offset = 0,
  limit = DEFAULT_QUERY_LIMIT,
) {
  const safeOffset = Math.max(0, offset);
  const safeLimit = Math.max(1, Math.min(limit, DEFAULT_QUERY_LIMIT));
  const totalCount = indices.length;
  const page = Array.from(indices.slice(safeOffset, safeOffset + safeLimit));
  const nextOffset = safeOffset + page.length;
  return {
    indices: page,
    count: page.length,
    total_count: totalCount,
    truncated: nextOffset < totalCount,
    next_offset: nextOffset < totalCount ? nextOffset : null,
  };
}
