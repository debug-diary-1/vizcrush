# Bounded time-series viewport session

This example generates one million deterministic, ordered points inside a persistent module worker. Its worker entry creates `TimeSeriesSession`, installs `@vizcrush/downsample/worker-host`, and keeps the source history resident there. The page owns one `TimeSeriesWorkerClient`; pan, zoom, resize, and backend controls send only viewport requests, and the Canvas renderer receives independently owned reduced arrays.

The session validates the complete input before replacing its history, retains only its configured capacity, selects an inclusive domain with immediate edge neighbors, and includes those neighbors inside the physical-pixel output budget. Duplicate timestamps are supported and retain input order. Non-finite coordinates and decreasing timestamps are rejected.

The worker client permits one active viewport and one replaceable latest viewport. Navigation bursts supersede obsolete callers explicitly and never collect an unbounded queue. A running synchronous kernel finishes in the worker, but its obsolete result is suppressed before rendering. Worker startup and runtime failures remain visible and never trigger silent main-thread processing.

```bash
pnpm install
pnpm --dir examples/viewport-session dev
```
