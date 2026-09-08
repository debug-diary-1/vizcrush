# Streaming viewport adoption

Use `TimeSeriesSession` when a chart must explore a large ordered series while new points arrive. The supported browser path keeps fixed-capacity history and preprocessing in one persistent worker, returns only a pixel-bounded result, and leaves rendering to your chart or Canvas code.

Try the [live million-point viewport](https://debug-diary-1.github.io/vizcrush/examples/viewport-session/) or copy its complete source from [`examples/viewport-session`](https://github.com/debug-diary-1/vizcrush/tree/main/examples/viewport-session).

## Install

```bash
npm install @vizcrush/downsample
```

There is no umbrella runtime dependency. The session, worker client, and worker host remain explicit subpath imports.

## Create the worker entry

Keep this entry in the consuming application so Vite and other static bundlers can discover it:

```ts
// viewport.worker.ts
import { TimeSeriesSession } from "@vizcrush/downsample/session";
import { installTimeSeriesWorkerHost } from "@vizcrush/downsample/worker-host";

const session = new TimeSeriesSession({
  capacity: 1_000_000,
  maxIngestionBatchPoints: 65_536,
  maxOutputPoints: 20_000,
  pointsPerPixel: 1,
});

session.load(initialTimestamps, initialValues);
installTimeSeriesWorkerHost(self, session);
```

Vite projects must keep `worker.format: "es"` because the WASM glue is code split:

```ts
// vite.config.ts
import { defineConfig } from "vite";

export default defineConfig({ worker: { format: "es" } });
```

`load()` and `append()` validate equal-length `Float64Array` pairs, finite coordinates, and nondecreasing timestamps before mutation. Duplicate timestamps remain in input order. An append may equal the newest retained timestamp but cannot precede it. When capacity is exceeded, the session evicts the oldest paired points through fixed circular storage.

## Own one worker client

```ts
// main.ts
import {
  TimeSeriesWorkerBusyError,
  TimeSeriesWorkerClient,
} from "@vizcrush/downsample/worker-client";

const worker = new Worker(new URL("./viewport.worker.ts", import.meta.url), {
  type: "module",
});
const client = new TimeSeriesWorkerClient(worker);

const response = await client.view(
  {
    xMin: visibleStart,
    xMax: visibleEnd,
    widthCssPixels: canvas.clientWidth,
    devicePixelRatio: window.devicePixelRatio,
  },
  { backend: "auto" },
);

renderLine(response.value.x, response.value.y);
console.log(response.value.backend, response.value.reason);
console.log(response.workerProcessingMs);
```

`workerProcessingMs` measures host handling inside the worker. Measure around `await client.view(...)` for caller round trip, and stop the caller-to-render timer only after your renderer completes. These are different boundaries; none is a universal frame-rate promise.

One viewport may run while one replaceable latest viewport waits. Replaced callers reject with `TimeSeriesWorkerSupersededError`. Synchronous WASM work already running is allowed to finish, but an obsolete result is suppressed.

## Append with backpressure

Safe-copy mode leaves producer buffers usable and snapshots their values when accepted:

```ts
await client.append(batchTimestamps, batchValues);
```

Transfer mode relinquishes two complete, separate `ArrayBuffer` instances immediately after client-side layout checks and backpressure acceptance:

```ts
await client.append(batchTimestamps, batchValues, { transfer: true });
// batchTimestamps.byteLength === 0
// batchValues.byteLength === 0
```

Subarrays, shared buffers, or x/y views over the same buffer reject before detachment. Only one append may be unacknowledged. Await its acknowledgement before producing another batch:

```ts
try {
  await client.append(x, y, { transfer: true });
} catch (error) {
  if (error instanceof TimeSeriesWorkerBusyError) {
    // This batch was not accepted and its buffers remain owned by the producer.
  }
}
```

Finite-coordinate, length, ordering, and configured batch-size validation happens in the worker before session mutation. A host validation error can therefore arrive after an accepted transfer has detached the producer buffers; only a client-side layout or backpressure rejection guarantees that transfer ownership stayed with the producer.

The client prioritizes the latest queued viewport between append batches. A viewport result identifies the source revision it actually read; it may reflect an earlier acknowledged append without being allowed to overwrite a newer viewport request.

## Follow, pan, and render

Follow-latest belongs in the controller, not retained storage. Keep the current visible span and move its end to `state.newestX` after an append acknowledgement. Disable following when the user pans. Do not move a panned-away domain when retention advances: `visiblePoints === 0` tells you the requested range was evicted, while an `edgeNeighborPoints` result may retain one line-continuity point.

Scale x positions from returned timestamps, not array indexes:

```ts
const px = ((result.x[index] - visibleStart) / (visibleEnd - visibleStart)) * width;
```

Returned x/y buffers belong to the caller. Convert them into renderer-specific objects only after reduction, and release results your renderer no longer needs.

## Account for buffers

`client.state()` and append acknowledgements report:

- retained source bytes and fixed source-buffer capacity;
- reusable linearization scratch capacity;
- the maximum accepted pending append batch;
- the maximum caller-owned output pair; and
- their summed accounted capacity.

The browser example also accounts for its producer batch and retained comparison results. These figures are typed-array bounds, not total browser heap: worker runtime, WASM memory, renderer objects, messages, and garbage-collector state are outside that claim. Allocation is bounded, not absent.

## Dispose and surface failures

```ts
window.addEventListener("pagehide", () => void client.dispose(), { once: true });
```

`dispose()` is idempotent, rejects outstanding work, terminates the owned worker, and prevents late results from publishing. Worker startup and runtime failures remain visible; the client never silently falls back to main-thread processing.

## Run and export the measured scenario

From a repository checkout:

```bash
pnpm install
pnpm build:wasm
pnpm --dir examples/viewport-session dev
```

Choose **Run measured scenario**, then **Download raw JSON**. Each run first resets to the same seeded million-point state, regardless of prior interactive streaming. The local report contains that cold initialization, exact starting source index and revision, every viewport domain, warm viewport and real Canvas-resize samples, a navigation burst, steady-state streaming after retention is full, actual backends, numerical JS/WASM comparisons, raw frame gaps, p50/p95 timing summaries, scenario parameters, browser/package identifiers, and named buffer accounting. No telemetry is sent.

The provisional 100 ms p95 caller-to-render target is reported only for that run. Treat a miss as evidence to investigate on that device, not as a flaky CI threshold; treat a pass as local evidence, not a portable responsiveness claim.
