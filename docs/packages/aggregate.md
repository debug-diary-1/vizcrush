# @vizcrush/aggregate

Streaming statistics, exact percentiles, rolling windows, and bounded-memory sketches for real-time pipelines. Stats are **single-pass** (Welford's algorithm) so memory stays bounded even on multi-million-point inputs.

## Import

```typescript
import { stats, percentile, StreamingStats, DDSketch, KllSketch } from "@vizcrush/aggregate";
```

## `stats(data)`

One-pass `count, min, max, mean, stdDev, variance` over a typed array using **Welford's online algorithm**.

```typescript
const data = new Float64Array([1, 2, 3, 4, 5]);
const result = await stats(data);
// {
//   count: 5,
//   min: 1,
//   max: 5,
//   mean: 3,
//   stdDev: 1.4142...,
//   variance: 2,
// }
```

**Why Welford?** Naïve `sum / n` then subtract-the-mean variance loses precision catastrophically on large or skewed datasets. Welford is numerically stable and runs in a single pass over the input — same memory cost as a single accumulator regardless of data size.

## `percentile(data, percentiles)`

Exact percentile estimation. Sorts a copy of the data and interpolates linearly between adjacent values.

```typescript
const data = new Float64Array(/* … */);
const result = await percentile(data, [10, 25, 50, 75, 90, 95, 99]);
// Float64Array — one entry per requested percentile, in the same order
```

**Cost:** O(n log n) due to the internal sort.

For much larger streaming data where an O(n log n) sort is too costly, `@vizcrush/aggregate` also ships mergeable approximate sketches — `DDSketch`, `KllSketch`, `HyperLogLog`, `CountMinSketch` — each a class with `add`/`addBatch` plus its own query method (`quantile`, `estimate`, …). `StreamingStats` does not compute quantiles; it only tracks mean/min/max/stdDev over a window. `TDigest` exists in the Rust crate (`vizcrush-aggregate::tdigest`) but has no TypeScript entry point yet — it's not callable from this package today.

## `StreamingStats` — rolling window

A class that maintains stats over a sliding window of the last N values, designed for live dashboards.

```typescript
import { StreamingStats } from "@vizcrush/aggregate";

const win = new StreamingStats(/* windowSize */ 10_000);

// On each new sample:
win.push(newValue);

// Or batched:
win.pushBatch(newValues);

// Query at any time:
console.log(win.mean, win.stdDev, win.min, win.max, win.length);
```

**Available getters:**

| Getter     | Type   | Description                         |
| ---------- | ------ | ----------------------------------- |
| `mean`     | number | Welford-updated rolling mean        |
| `stdDev`   | number | Welford-updated rolling stddev      |
| `variance` | number | Welford-updated rolling variance    |
| `min`      | number | Window minimum                      |
| `max`      | number | Window maximum                      |
| `length`   | number | Current sample count (≤ windowSize) |

**Methods:**

- `push(v: number)` — add one sample, evict oldest if window is full
- `pushBatch(values: Float64Array)` — bulk insert; faster than looping push
- `recomputeMinMax()` — force recomputation of min/max (useful after a large eviction)

**Memory:** O(windowSize). The class keeps the raw samples in a ring buffer so eviction is O(1).

## Performance reference

| Operation                    | 100K   | 500K   | 1M     |
| ---------------------------- | ------ | ------ | ------ |
| `stats`                      | 0.6 ms | 3.1 ms | 6.3 ms |
| `percentile` (5 percentiles) | 1.5 ms | 8 ms   | 17 ms  |

`StreamingStats.push`/`pushBatch` are pure JS (no WASM dispatch) and sub-microsecond per sample.

## When to use what

| Goal                                    | Use                        |
| --------------------------------------- | -------------------------- |
| One-shot stats over a fixed dataset     | `stats()`                  |
| Multiple specific percentiles           | `percentile([10, 50, 90])` |
| Rolling window in a live dashboard      | `StreamingStats`           |
| Approximate percentiles on huge streams | `DDSketch` / `KllSketch`   |

## See also

- **[Streaming Data guide](../user-guide/streaming.md)** — end-to-end streaming dashboard pattern
- **[@vizcrush/downsample](downsample.md)** — reduce a retained chart window to display size
- **[Algorithms reference / Aggregation](../reference/algorithms.md#aggregation--statistics)**
