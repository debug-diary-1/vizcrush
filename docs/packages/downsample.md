# @vizcrush/downsample

Reduce a large paired time series to a display-sized result while preserving its visual shape.

## Install

```bash
npm install @vizcrush/downsample
```

## Choose an algorithm

| Algorithm    | Best for                                                       | Cost                           |
| ------------ | -------------------------------------------------------------- | ------------------------------ |
| `lttb`       | General time series and sensor metrics                         | O(n)                           |
| `minMaxLttb` | Spiky financial, IoT, or anomaly-rich data                     | O(n) plus extrema preselection |
| `m4`         | Preserving first, last, minimum, and maximum values per bucket | O(n)                           |
| `ltob`       | A simpler one-bucket triangle variant                          | O(n)                           |

Start with `lttb`. Switch to `minMaxLttb` when isolated peaks must survive aggressive reduction.

## Asynchronous API

```typescript
import { lttb, minMaxLttb, m4, ltob } from "@vizcrush/downsample";

const result = await lttb(x, y, 1_000, { backend: "auto" });

console.log(result.x); // Float64Array(1000)
console.log(result.y); // Float64Array(1000)
```

All four functions accept:

- `x: Float64Array` — x coordinates, usually timestamps or ordered indices
- `y: Float64Array` — y coordinates with the same length
- `threshold: number` — requested output point count
- an optional trailing `KernelCallOptions` with `backend: "auto" | "wasm" | "js"`

They return `Promise<DownsampleResult>`, where:

```typescript
interface DownsampleResult {
  x: Float64Array;
  y: Float64Array;
}
```

The Rust/WASM implementation uses an interleaved array internally at the binding boundary, but the public TypeScript API returns separate `x` and `y` arrays.

## Synchronous JavaScript API

```typescript
import { lttbSync } from "@vizcrush/downsample";

const result = lttbSync(x, y, 1_000);
```

`lttbSync()` always runs the pure-JavaScript core. It is useful when an asynchronous call does not fit the surrounding control flow.

## Viewport pattern

Filter to the visible x range before downsampling to the display width:

```typescript
import { filterRange } from "@vizcrush/transform";
import { lttb } from "@vizcrush/downsample";

async function onZoom(visibleMin: number, visibleMax: number) {
  const sliced = filterRange(x, y, visibleMin, visibleMax);
  const visible = await lttb(sliced.x, sliced.y, canvas.width);
  renderLine(visible.x, visible.y);
}
```

## Performance

Absolute timings vary by browser, hardware, input shape, and cold versus warm calls. The measured WASM/JavaScript ratio is also engine-dependent. Use [Backend Lab](https://debug-diary-1.github.io/vizcrush/examples/backend-lab/) to test your environment and read [ADR 0003](../adr/0003-wasm-vs-js-is-engine-dependent.md) before quoting results.

## See also

- [Quickstart](../user-guide/quickstart.md)
- [Backends & Capabilities](../user-guide/backends.md)
- [Algorithms reference](../reference/algorithms.md#downsampling)
