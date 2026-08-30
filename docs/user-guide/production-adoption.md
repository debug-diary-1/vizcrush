# Production adoption path

Use vizcrush as the compute stage between data ingestion and rendering. The production path is deliberately small:

```text
typed arrays → reduce/index with vizcrush → adapt the bounded result → render
```

Start with [`financial-timeseries`](https://debug-diary-1.github.io/vizcrush/examples/financial-timeseries/) for the full million-point flow, then choose the renderer adapter below.

## 1. Bound work to visible pixels

```ts
import { minMaxLttb } from "@vizcrush/downsample";

export async function prepareLineSeries(
  x: Float64Array,
  y: Float64Array,
  cssWidth: number,
): Promise<{ x: Float64Array; y: Float64Array }> {
  if (x.length <= 2) return { x, y };
  const pixelRatio = globalThis.devicePixelRatio ?? 1;
  const target = Math.min(x.length, Math.max(2, Math.ceil(cssWidth * pixelRatio)));
  return minMaxLttb(x, y, target);
}
```

Keep the original typed arrays outside renderer state. Recompute when the viewport or source data changes, and pass only the reduced result to the chart.

## 2. Adapt after reduction

These adapters intentionally allocate ordinary objects only after vizcrush has bounded the point count.

### Chart.js

```ts
export function toChartJsPoints(result: { x: Float64Array; y: Float64Array }) {
  return Array.from(result.x, (x, index) => ({ x, y: result.y[index] }));
}
```

### ECharts

```ts
export function toEChartsPoints(result: { x: Float64Array; y: Float64Array }) {
  return Array.from(result.x, (x, index) => [x, result.y[index]] as const);
}
```

### D3

```ts
selection.attr("d", line(Array.from(result.x, (x, index) => [x, result.y[index]])));
```

Runnable implementations live in the [Chart.js](https://debug-diary-1.github.io/vizcrush/examples/chartgpu-integration/), [React + ECharts](https://debug-diary-1.github.io/vizcrush/examples/react-echarts-dashboard/), and [Observable Plot](https://debug-diary-1.github.io/vizcrush/examples/observable-plot-timeseries/) examples.

## 3. Verify the backend in your deployment

Backend performance is engine-dependent. Use [Backend Lab](https://debug-diary-1.github.io/vizcrush/examples/backend-lab/) on representative hardware instead of copying an absolute benchmark from another runtime.

The repository’s packaged-browser workflow provides a stronger compatibility guarantee: it packs the same npm artifacts users install, installs them in a fresh fixture, bundles them with Vite, then executes forced WASM and JS calls with parity checks in Chromium, Firefox, and WebKit. Measurements are uploaded as workflow artifacts rather than marketed as universal numbers.

## 4. Inspect package cost

Check the registry artifact you are about to adopt:

```bash
npm view @vizcrush/downsample version dist.unpackedSize dist.fileCount
npm pack --dry-run @vizcrush/downsample
```

Install only the primitive packages your application uses. There is no umbrella runtime package, so adopting downsampling does not pull in spatial, 3D, AI, React, or MCP code.

## Production checklist

- Keep raw data in typed arrays; allocate renderer objects after reduction.
- Use a target derived from viewport width rather than a fixed global constant.
- Warm the chosen operation before recording interactive latency.
- Exercise the JS fallback in tests as well as WASM.
- Move ingestion and preprocessing to a worker when parsing itself blocks the main thread.
- Run `npm audit`/your normal supply-chain checks against the exact lockfile.
- Measure on the browsers and devices your users actually run.

For worker transfer, see [`worker-pipeline`](https://debug-diary-1.github.io/vizcrush/examples/worker-pipeline/). For density views, use [`deckgl-density-lod`](https://debug-diary-1.github.io/vizcrush/examples/deckgl-density-lod/) or `bin2d()` instead of rendering every scatter point.
