# Bounded time-series viewport session

This example loads one million deterministic, ordered points into `TimeSeriesSession` from `@vizcrush/downsample/session`. Pan, zoom, resize, and backend controls all use the same session interface. The Canvas renderer receives only independently owned reduced arrays and scales x positions from their timestamps.

The session validates the complete input before replacing its history, retains only its configured capacity, selects an inclusive domain with immediate edge neighbors, and includes those neighbors inside the physical-pixel output budget. Duplicate timestamps are supported and retain input order. Non-finite coordinates and decreasing timestamps are rejected.

This slice runs session work in the calling context. Use it to inspect the data contract and viewport behavior; it does not claim main-thread isolation. The persistent-worker adapter is introduced separately.

```bash
pnpm install
pnpm --dir examples/viewport-session dev
```
