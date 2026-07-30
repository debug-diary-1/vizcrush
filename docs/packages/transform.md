# @vizcrush/transform

Fast typed-array primitives: radix sort, min-max normalization, range filtering. The boring-but-essential pieces that show up in every data pipeline.

## Import

```typescript
import { sortBy, normalize, filterRange } from "@vizcrush/transform";
```

## `sortBy(data, keys?, descending?)`

Sort a `Float64Array` in place (or by separate keys) using a radix sort (linear-time on fixed-width floats).

```typescript
const data = new Float64Array([3.1, 1.4, 1.5, 9.2, 6.5]);
const sorted = await sortBy(data);
// Float64Array [1.4, 1.5, 3.1, 6.5, 9.2]
```

**Sort one array by another's keys:**

```typescript
const values = new Float64Array([10, 20, 30, 40]);
const keys = new Float64Array([3, 1, 4, 2]);

const sorted = await sortBy(values, keys);
// values reordered to match keys ascending: [20, 40, 10, 30]
```

**Descending:**

```typescript
const sorted = await sortBy(data, undefined, /* descending */ true);
```

**Cost:** O(n) — radix sort runs in linear time on fixed-width floats. ~3-5× faster than `Array.prototype.sort` on a million elements.

## `normalize(data, range?)`

Min-max normalize to `[0, 1]` (default) or a custom range:

```typescript
const data = new Float64Array([10, 20, 30, 40, 50]);
const normalized = await normalize(data);
// Float64Array [0, 0.25, 0.5, 0.75, 1]

// Custom range:
const scaled = await normalize(data, [-1, 1]);
// Float64Array [-1, -0.5, 0, 0.5, 1]
```

Useful for:

- Color mapping in heatmaps and density grids
- Feeding ML models that expect normalized inputs
- Coordinate normalization before spatial indexing

## `filterRange(x, y, xMin, xMax)`

Extract the subset of `(x, y)` pairs where `x` falls within `[xMin, xMax]`. Returns a new interleaved `Float64Array` ready to drop into another algorithm.

```typescript
const result = await filterRange(x, y, /* xMin */ 1000, /* xMax */ 2000);
// Float64Array [x0, y0, x1, y1, …] for points with 1000 ≤ x ≤ 2000
```

**Use case: viewport zoom.** When a user zooms a time-series chart, you don't want to downsample the entire dataset every frame. Filter first, then downsample the filtered slice:

```typescript
async function onZoom(visibleMin: number, visibleMax: number) {
  const sliced = await filterRange(x, y, visibleMin, visibleMax);
  // sliced is interleaved — split if needed for the next call
  // (or use a typed-array view trick)
  const slicedX = new Float64Array(sliced.length / 2);
  const slicedY = new Float64Array(sliced.length / 2);
  for (let i = 0; i < sliced.length; i += 2) {
    slicedX[i >> 1] = sliced[i];
    slicedY[i >> 1] = sliced[i + 1];
  }
  const display = await lttb(slicedX, slicedY, canvas.width);
  chart.update(display);
}
```

For a tighter pipeline that avoids the manual deinterleave, build a small wrapper that keeps `x` and `y` contiguous internally — see the [d3-large-scatter example](../reference/examples.md).

## Performance reference

| Operation                    | 100K   | 500K   | 1M     |
| ---------------------------- | ------ | ------ | ------ |
| `sortBy`                     | 5 ms   | 28 ms  | 60 ms  |
| `normalize`                  | 0.3 ms | 1.5 ms | 3.0 ms |
| `filterRange` (50% viewport) | 2 ms   | 11 ms  | 19 ms  |

## See also

- **[@vizcrush/downsample](downsample.md)** — typically follows a `filterRange` call
- **[Algorithms reference](../reference/algorithms.md#transforms)**
