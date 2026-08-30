# Observable Plot time series

This example runs `lttb` from `@vizcrush/downsample` over a one-million-point typed-array series, converts only the reduced result to Plot-friendly records, and renders it with Observable Plot.

The point is a clean data-shaping seam: vizcrush controls the level of detail while Plot retains its declarative API. The UI separately reports local LTTB and Plot-construction timings after one untimed LTTB call on the real input. ResizeObserver redraws the current reduced points without rerunning LTTB.

```bash
pnpm --dir examples/observable-plot-timeseries dev
```
