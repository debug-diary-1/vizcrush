# Quickstart

A minimal end-to-end example: initialize vizcrush, generate a million-point time series, downsample it to a display-friendly count, and inspect the result.

## 1. Initialize the library

```typescript
import { init } from "@vizcrush/core";

const ctx = await init();
console.log(`Backend: ${ctx.backend}`);
console.log(`Capabilities:`, ctx.capabilities);
// Backend: wasm  (or js depending on environment)
// Capabilities: { webgpu: true, wasmSimd: true, wasm: true, sharedArrayBuffer: true }
```

`init()` probes the runtime once, picks the best backend, and returns a context object you can pass around or inspect. See **[Backends & Capabilities](backends.md)** for the selection rules.

## 2. Generate a sample time series

```typescript
const N = 1_000_000;
const x = new Float64Array(N);
const y = new Float64Array(N);
for (let i = 0; i < N; i++) {
  x[i] = i;
  y[i] = Math.sin(i / 5000) * 100 + Math.random() * 10;
}
```

vizcrush APIs operate on `Float64Array` (or `Uint32Array` for indices) — typed arrays mean **zero-copy transfer** to and from WebAssembly. Don't pass plain `number[]`.

## 3. Downsample with LTTB

```typescript
import { lttb } from "@vizcrush/downsample";

const start = performance.now();
const result = await lttb(x, y, 1000); // 1M points → 1000 points
const elapsed = performance.now() - start;

console.log(`Downsampled in ${elapsed.toFixed(2)}ms`);
console.log(`Result length: ${result.length}`); // 2000 (interleaved [x, y, x, y, …])
```

The result is a **single interleaved** `Float64Array`: `[x0, y0, x1, y1, …, x999, y999]`. This layout matches what most charting libraries (Chart.js, D3, ChartGPU, ECharts) consume directly with minimal copying.

Expected timings (see `benchmarks/results/latest.json` and ADR 0003):

| Backend | 1M → 1000 LTTB     |
| ------- | ------------------ |
| `wasm`  | ~1.5 ms (Chromium) |
| `js`    | ~1.8 ms (Node/V8)  |

Which backend wins is engine-dependent — WASM is ~4× faster than the JS core in Chromium/V8, but the JS core is comparable or faster in Firefox and WebKit, and the first WASM call pays a one-time module-load cost everywhere.

## 4. Pick the right algorithm for your data

LTTB is optimized for smooth time-series. For spiky financial or IoT data, use **MinMax-LTTB** which preserves extrema:

```typescript
import { minMaxLttb } from "@vizcrush/downsample";

const result = await minMaxLttb(x, y, 1000);
```

Or let vizcrush pick automatically based on a quick statistical analysis of your data:

```typescript
import { autoOptimize } from "@vizcrush/ai";

const config = autoOptimize(x, y, /* screenWidth */ 1920);
console.log(config);
// {
//   algorithm: "minmax_lttb",
//   targetPoints: 1920,
//   binResolution: 0,
//   spatialIndex: "none",
//   streaming: false,
//   estimatedSpeedup: 520,
//   reasoning: "Spiky data detected (spike ratio 12.4) — MinMax-LTTB preserves extrema better than vanilla LTTB."
// }
```

## 5. Plug into a chart

The interleaved result format is what most charting libraries already want. For example with ChartGPU:

```typescript
import { Chart } from "@chartgpu/core";

const result = await lttb(x, y, 1000);

const chart = new Chart(canvas, {
  data: result, // already interleaved
  layout: "xy-pairs",
});
```

For libraries that want separate x/y arrays, deinterleave with a quick view:

```typescript
const xs = new Float64Array(result.length / 2);
const ys = new Float64Array(result.length / 2);
for (let i = 0; i < result.length; i += 2) {
  xs[i >> 1] = result[i];
  ys[i >> 1] = result[i + 1];
}
```

## What's next

This was the hello-world. From here you can:

- Try a **2D heatmap** instead → **[@vizcrush/bin](../packages/bin.md)** with `bin2d()`
- Build a **spatial index** for million-point scatter plots → **[@vizcrush/spatial](../packages/spatial.md)**
- Compute **streaming statistics** for a real-time dashboard → **[Streaming Data guide](streaming.md)**
- Wire it into **React** with hooks → **[React Integration](react.md)**
- Expose vizcrush to **Claude / Cursor** as MCP tools → **[MCP Server](mcp.md)**
- Detect **anomalies and changepoints** automatically → **[AI Features](ai.md)**

Or browse the **[examples gallery](../reference/examples.md)** — 37 runnable demos that cover most real-world patterns.
