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

## Bounded viewport session

Use the `session` subpath when one owner should validate paired history, retain a fixed capacity, select an inclusive viewport, and reduce to a physical-pixel budget:

```typescript
import { TimeSeriesSession } from "@vizcrush/downsample/session";

const session = new TimeSeriesSession({
  capacity: 1_000_000,
  maxIngestionBatchPoints: 65_536,
  maxOutputPoints: 20_000,
});
session.load(x, y);

const visible = await session.view({
  xMin: visibleMin,
  xMax: visibleMax,
  widthCssPixels: canvas.clientWidth,
  devicePixelRatio: window.devicePixelRatio,
});
renderLine(visible.x, visible.y);
```

`load()` accepts equal-length `Float64Array` inputs whose coordinates are finite and whose x values are nondecreasing. Duplicate timestamps preserve input order. Validation covers the complete input before history changes; oversized valid inputs retain their newest `capacity` points. Inputs are copied, and every viewport result owns independent buffers.

The viewport domain is inclusive. The session includes an immediate source point outside each edge when available so a line can cross the viewport boundary, and those neighbors count against the total output budget. Zero CSS width returns no points. Positive sub-pixel targets return at most one point, while larger targets use LTTB only when reduction is needed. The result reports the source revision, selected and visible counts, edge-neighbor count, point budget, and completed-call backend diagnostics.

Session work runs in its caller's context. For a persistent browser worker, create the worker in your application so the bundler can discover its entry:

```typescript
// main.ts
import { TimeSeriesWorkerClient } from "@vizcrush/downsample/worker-client";

const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
const client = new TimeSeriesWorkerClient(worker);
const { value: visible } = await client.view(viewport);
renderLine(visible.x, visible.y);

// worker.ts
import { TimeSeriesSession } from "@vizcrush/downsample/session";
import { installTimeSeriesWorkerHost } from "@vizcrush/downsample/worker-host";

const session = new TimeSeriesSession({
  capacity: 1_000_000,
  maxIngestionBatchPoints: 65_536,
  maxOutputPoints: 20_000,
});
session.load(x, y);
installTimeSeriesWorkerHost(self, session);
```

One client owns one long-lived worker. Each viewport result includes transport, viewport, and session-generation identities, plus worker processing time separately from caller round trip. The client bounds navigation to one active request and one replaceable latest request. Replaced callers reject with `TimeSeriesWorkerSupersededError`; a running synchronous kernel is allowed to finish, but its obsolete result is suppressed. Startup, message, and runtime errors reject affected work and terminate the worker without falling back to the main thread. `dispose()` is idempotent and prevents later results from reaching the caller.

`client.load(x, y)` uses the structured-clone algorithm, so the caller keeps its input buffers. `client.load(x, y, { transfer: true })` opts into detachment and avoids that transport copy. Transfer mode requires each `Float64Array` to cover its own complete, separate `ArrayBuffer`; shared buffers, subarrays, and aliased layouts reject before either buffer is detached. The session still validates and owns its retained copy. Returned viewport buffers belong to the caller.

`session.append(x, y)` and `client.append(x, y)` retain ordered batches through fixed-capacity circular storage. The client snapshots safe-copy inputs when accepted; `{ transfer: true }` detaches valid dedicated inputs immediately. Only one append may be unacknowledged, and a second append rejects with `TimeSeriesWorkerBusyError` before ownership changes. State reports retained range, source revision, and separate source/scratch/pending/output byte bounds.

## Performance

Absolute timings vary by browser, hardware, input shape, and cold versus warm calls. The measured WASM/JavaScript ratio is also engine-dependent. Use [Backend Lab](https://debug-diary-1.github.io/vizcrush/examples/backend-lab/) to test your environment and read [ADR 0003](../adr/0003-wasm-vs-js-is-engine-dependent.md) before quoting results.

## See also

- [Quickstart](../user-guide/quickstart.md)
- [Backends & Capabilities](../user-guide/backends.md)
- [Streaming viewport adoption](../user-guide/streaming-viewport.md)
- [Algorithms reference](../reference/algorithms.md#downsampling)
