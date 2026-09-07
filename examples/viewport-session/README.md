# Bounded time-series viewport session

This example generates one million deterministic, ordered points inside a persistent module worker, then appends deterministic batches beyond that fixed retention capacity. Its worker entry creates `TimeSeriesSession`, installs `@vizcrush/downsample/worker-host`, and keeps the source history resident there. The page owns one `TimeSeriesWorkerClient`; pan, zoom, resize, stream, and backend controls send only bounded requests, and the Canvas renderer receives independently owned reduced arrays.

The session validates the complete input before replacing its history, retains only its configured capacity, selects an inclusive domain with immediate edge neighbors, and includes those neighbors inside the physical-pixel output budget. Duplicate timestamps are supported and retain input order. Non-finite coordinates and decreasing timestamps are rejected.

The worker client permits one active viewport and one replaceable latest viewport. Navigation bursts supersede obsolete callers explicitly and never collect an unbounded queue. A running synchronous kernel finishes in the worker, but its obsolete result is suppressed before rendering. Worker startup and runtime failures remain visible and never trigger silent main-thread processing.

The producer permits one unacknowledged append. It waits for acknowledgement before creating the next batch, and transfer mode is checked before the input buffers detach. Viewports are prioritized between queued append batches so continuous ingestion cannot starve every render. Panning disables follow-latest; the explicit follow control resumes it. Pause lets one already transferred batch finish, then keeps the retained window fixed; the button shows that intermediate state. Reset disposes the worker and recreates the seeded scenario. A panned-away domain remains fixed as retention advances, and the UI explains when that inspected range has been evicted instead of jumping it forward.

The metrics separate retained source bytes, fixed source/scratch/pending/output capacity bounds, and each caller-owned result. These are deterministic typed-array accounting figures, not a bound on total browser heap or a claim of zero allocation.

```bash
pnpm install
pnpm --dir examples/viewport-session dev
```
