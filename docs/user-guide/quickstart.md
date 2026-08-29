# Quickstart

This example reduces a million-point time series to 1,000 chart-ready points.

## 1. Install

```bash
npm install @vizcrush/downsample
```

## 2. Create a sample series

```typescript
const pointCount = 1_000_000;
const x = new Float64Array(pointCount);
const y = new Float64Array(pointCount);

for (let i = 0; i < pointCount; i++) {
  x[i] = i;
  y[i] = Math.sin(i / 5_000) * 100 + Math.random() * 10;
}
```

vizcrush accepts typed arrays. On the WASM path, `wasm-bindgen` performs a bulk copy into WebAssembly linear memory; typed arrays avoid per-element boxing and keep that boundary predictable.

## 3. Downsample with LTTB

```typescript
import { lttb } from "@vizcrush/downsample";

const start = performance.now();
const result = await lttb(x, y, 1_000);
const elapsed = performance.now() - start;

console.log(`Downsampled in ${elapsed.toFixed(2)}ms`);
console.log(result.x.length, result.y.length); // 1000, 1000
```

The result is a `{ x, y }` object containing two `Float64Array` instances. The first and last points are preserved.

WASM versus JavaScript performance varies by browser and whether the call is warm. Run [Backend Lab](https://debug-diary-1.github.io/vizcrush/examples/backend-lab/) on your machine instead of relying on a cross-runtime absolute number; the methodology and reference results are in [ADR 0003](../adr/0003-wasm-vs-js-is-engine-dependent.md).

## 4. Hand the result to your renderer

```typescript
renderLine({
  x: result.x,
  y: result.y,
});
```

vizcrush does not draw the chart. Adapt the two arrays to the input shape expected by Canvas, D3, Three.js, WebGL, or another renderer.

For spiky financial or IoT data, try MinMax-LTTB:

```typescript
import { minMaxLttb } from "@vizcrush/downsample";

const result = await minMaxLttb(x, y, 1_000);
```

## What's next

- Try a [2D heatmap](../packages/bin.md) with `bin2d()`
- Build a [spatial index](../packages/spatial.md) for a large scatter plot
- Add [React hooks](react.md)
- Configure the [MCP server](mcp.md)
- Browse all [live examples](https://debug-diary-1.github.io/vizcrush/examples/)
