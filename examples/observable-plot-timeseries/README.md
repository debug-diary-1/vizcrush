# Observable Plot time series

This example runs `lttb` from `@vizcrush/downsample` over a one-million-point typed-array series, converts only the reduced result to Plot-friendly records, and renders it with Observable Plot.

The point is a clean data-shaping seam: vizcrush controls the level of detail while Plot retains its declarative API. The UI reports the backend that LTTB actually executed and separately reports local LTTB and Plot-construction timings after one untimed LTTB call on the real input. `ResizeObserver` redraws the current reduced points from the host's content-box width without rerunning LTTB or duplicating the initial Plot build.

```bash
pnpm --dir examples/observable-plot-timeseries dev
```
