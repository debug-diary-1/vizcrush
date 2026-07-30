# @vizcrush/downsample

Time-series downsampling — reduce a million points to a thousand while preserving the **visual shape** of your chart. All four algorithms here are designed to look "the same" as the source data when rendered, even at extreme reduction ratios.

## When to use which

| Algorithm        | Best for                                                                 | Cost                |
| ---------------- | ------------------------------------------------------------------------ | ------------------- |
| **`lttb`**       | Smooth, monotonic time series (sensor readings, metrics)                 | O(n)                |
| **`minMaxLttb`** | Spiky data — financial OHLC, IoT bursts, anomaly-rich signals            | O(n) + extrema scan |
| **`m4`**         | Per-pixel rendering: returns 4 points (min, max, first, last) per bucket | O(n)                |
| **`ltob`**       | Simpler one-bucket variant of LTTB; slightly less accurate but faster    | O(n)                |

If you're not sure, use **`lttb`** as a default and switch to `minMaxLttb` if you notice spikes getting smoothed away. Or call **[`autoOptimize()`](ai.md)** from `@vizcrush/ai` to pick automatically based on data shape.

## Import

```typescript
import { lttb, lttbSync, minMaxLttb, m4, ltob } from "@vizcrush/downsample";
```

## `lttb(x, y, threshold)`

**Largest-Triangle-Three-Buckets.** The canonical visual-preserving downsampler from Sveinn Steinarsson's thesis.

```typescript
const x = new Float64Array(N);
const y = new Float64Array(N);
// … fill with data, x typically monotonic (timestamps or indices) …

const result = await lttb(x, y, 1000);
// Returns: Float64Array of length 2000, interleaved [x0, y0, x1, y1, …, x999, y999]
```

**Parameters:**

- `x: Float64Array` — x-coordinates (typically monotonic; timestamps or sequence indices)
- `y: Float64Array` — y-coordinates, same length as `x`
- `threshold: number` — target output point count

**Returns:** `Promise<Float64Array>` — interleaved `[x, y]` pairs.

**Backend selection:** WASM when WebAssembly is available; falls back to the pure-JS core otherwise.

## `lttbSync(x, y, threshold)`

Synchronous JavaScript fallback. Use this only if you can't `await` (e.g. inside a render loop where you've already pre-warmed the WASM module). Otherwise prefer the async `lttb()`.

```typescript
const result = lttbSync(x, y, 1000);
```

## `minMaxLttb(x, y, threshold)`

**MinMax-LTTB.** Pre-pass that captures local minima and maxima before applying LTTB. Significantly better than vanilla LTTB on spiky data because it never accidentally drops a peak.

```typescript
const result = await minMaxLttb(x, y, 1000);
```

Use it for:

- Financial OHLC / candlestick data
- IoT sensor data with bursts (vibration, current spikes)
- Anomaly-rich datasets where missing a single peak is meaningful

**Trade-off:** somewhat slower than plain `lttb` due to the extra extrema pass.

## `m4(x, y, threshold)`

**M4.** Returns four points per bucket: min, max, first, last. Designed for **per-pixel** rendering — if your chart is 1920 px wide, ask for `threshold = 1920 * 4 = 7680` and you get a perfectly faithful reconstruction at native resolution.

```typescript
const screenWidth = canvas.width;
const result = await m4(x, y, screenWidth * 4);
```

M4 is the right choice for:

- Line charts where pixel-perfect fidelity matters
- Charts that will be zoomed in (preserves all extrema)

## `ltob(x, y, threshold)`

**Largest-Triangle-One-Bucket.** Simpler variant: picks one point per bucket (the one forming the largest triangle with adjacent bucket means). Faster than LTTB, slightly less accurate.

```typescript
const result = await ltob(x, y, 1000);
```

Use it when you need maximum throughput and don't mind a slight loss of fidelity.

## Result format

All four functions return an **interleaved** `Float64Array`:

```
[x0, y0, x1, y1, x2, y2, …, x_{n-1}, y_{n-1}]
```

This is the format ChartGPU, Chart.js (with the right adapter), and most WebGL line renderers want. To split into separate arrays:

```typescript
const result = await lttb(x, y, 1000);

const xs = new Float64Array(result.length / 2);
const ys = new Float64Array(result.length / 2);
for (let i = 0; i < result.length; i += 2) {
  xs[i >> 1] = result[i];
  ys[i >> 1] = result[i + 1];
}
```

## Performance reference

Measured numbers live in `benchmarks/results/` — run the suite in `benchmarks/` to reproduce on your hardware. As of the latest run, `lttb` 1M → 1000 takes ~1.8 ms on the pure-JS core in Node (`benchmarks/results/latest.json`), and ~1.5 ms on the WASM backend in Chromium. Which backend wins is engine-dependent: WASM is ~4× faster in Chromium/V8, while the JS core is comparable or faster in Firefox and Safari — see ADR 0003 (`docs/adr/0003-wasm-vs-js-is-engine-dependent.md`). No WebGPU compute path is wired for these algorithms; the WASM and JS cores are the available paths.

## Patterns

### Downsample on viewport zoom

```typescript
function onZoom(visibleXMin: number, visibleXMax: number) {
  // 1. Filter to viewport
  const sliced = await filterRange(x, y, visibleXMin, visibleXMax);
  // 2. Downsample to display resolution
  const visible = await lttb(sliced.x, sliced.y, canvas.width);
  // 3. Render
  chart.update(visible);
}
```

`filterRange` lives in **[@vizcrush/transform](transform.md)**.

### Streaming append

When new data arrives in real time, use **`appendAndDownsample`** from **[@vizcrush/aggregate](aggregate.md)** to merge new samples into a streaming buffer in one pass.

## See also

- **[autoOptimize](ai.md#autooptimize)** — pick the right downsampling algorithm automatically
- **[@vizcrush/aggregate / appendAndDownsample](aggregate.md#appendanddownsample)** — streaming append
- **[Algorithms reference](../reference/algorithms.md#downsampling)** — full algorithm comparison
