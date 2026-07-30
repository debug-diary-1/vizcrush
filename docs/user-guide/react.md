# React Integration

`@vizcrush/react` is a thin layer of React hooks over the algorithm packages. They handle async lifecycles, loading and error states, and re-runs on input changes — so you can use vizcrush in a React app without writing your own `useEffect` plumbing.

## Install

```typescript
import {
  useGpuCompute,
  useDownsample,
  useBin2d,
  useStats,
  useStreamingStats,
} from "@vizcrush/react";
```

## `useGpuCompute()`

Initialize vizcrush once per app and share the context.

```tsx
import { useGpuCompute } from "@vizcrush/react";

function App() {
  const ctx = useGpuCompute();

  if (!ctx) return <div>Initializing vizcrush…</div>;

  return (
    <div>
      <div>Backend: {ctx.backend}</div>
      <Chart />
    </div>
  );
}
```

The hook calls `init()` once per app and caches the result. Subsequent calls (in any component) return the same context.

## `useDownsample(x, y, options)`

Downsample a paired `(x, y)` series. Re-runs whenever inputs or options change.

```tsx
import { useDownsample } from "@vizcrush/react";

function MyChart({ x, y }: { x: Float64Array; y: Float64Array }) {
  const { data, loading, error, elapsed } = useDownsample(x, y, {
    algorithm: "minmax_lttb",
    threshold: 1920,
  });

  if (loading) return <Spinner />;
  if (error) return <Error message={error.message} />;

  return (
    <>
      <ChartGPU data={data!} />
      <small>Downsampled in {elapsed.toFixed(1)}ms</small>
    </>
  );
}
```

**Options:**

| Option      | Type                              | Default    | Description               |
| ----------- | --------------------------------- | ---------- | ------------------------- |
| `algorithm` | `"lttb" \| "minmax_lttb" \| "m4"` | `"lttb"`   | Which downsampler to use  |
| `threshold` | `number`                          | (required) | Target output point count |

**Returns:**

```typescript
{
  data: Float64Array | null; // interleaved [x, y] pairs
  loading: boolean;
  error: Error | null;
  elapsed: number; // ms for the most recent run
}
```

The hook re-runs whenever `x`, `y`, or any option changes. To avoid unnecessary recomputation, memoize your input arrays:

```tsx
const x = useMemo(() => new Float64Array(rawData.map((d) => d.timestamp)), [rawData]);
const y = useMemo(() => new Float64Array(rawData.map((d) => d.value)), [rawData]);
```

## `useBin2d(x, y, options)`

2D density grid hook.

```tsx
import { useBin2d } from "@vizcrush/react";

function Heatmap({ x, y }) {
  const { data, loading } = useBin2d(x, y, {
    xBins: 256,
    yBins: 256,
  });

  if (loading) return <Spinner />;

  return <CanvasHeatmap grid={data!.grid} max={data!.maxCount} bins={256} />;
}
```

Same options as the [`bin2d()` function](../packages/bin.md#bin2dx-y-options).

## `useStats(data, percentiles?)`

Compute summary stats and (optionally) percentiles in one hook.

```tsx
import { useStats } from "@vizcrush/react";

function StatsPanel({ data }: { data: Float64Array }) {
  const { data: stats, percentiles, loading } = useStats(data, [25, 50, 75, 90]);

  if (loading) return <Spinner />;

  return (
    <dl>
      <dt>Mean</dt>
      <dd>{stats!.mean.toFixed(2)}</dd>
      <dt>StdDev</dt>
      <dd>{stats!.stdDev.toFixed(2)}</dd>
      <dt>P25 / P50 / P75 / P90</dt>
      <dd>
        {Array.from(percentiles)
          .map((p) => p.toFixed(1))
          .join(" / ")}
      </dd>
    </dl>
  );
}
```

## `useStreamingStats(windowSize)`

Rolling-window stats for live dashboards. Returns a stable `push` callback so you don't trigger spurious re-renders.

```tsx
import { useStreamingStats } from "@vizcrush/react";

function LiveDashboard() {
  const { stats, push, pushBatch, reset } = useStreamingStats(/* window */ 10_000);

  useEffect(() => {
    const ws = new WebSocket(/* … */);
    ws.onmessage = (e) => {
      const samples = JSON.parse(e.data);
      pushBatch(new Float64Array(samples));
    };
    return () => ws.close();
  }, [pushBatch]);

  return (
    <div>
      <div>Mean: {stats.mean.toFixed(2)}</div>
      <div>
        Min: {stats.min.toFixed(2)} / Max: {stats.max.toFixed(2)}
      </div>
      <button onClick={reset}>Reset</button>
    </div>
  );
}
```

The hook batches updates internally so you can `push` thousands of times per second without overwhelming React's reconciler.

## Performance tips

- **Memoize input arrays.** React shallow-compares dependencies, so a fresh `Float64Array` every render = a hook re-run every render. Wrap in `useMemo`.
- **Throttle for live data.** If new samples arrive faster than ~60 Hz, use `useStreamingStats` (which already batches) or wrap your inputs in a custom hook that batches updates.
- **Render the result, not the source.** The downsampled output is what should be in component state — never store the raw 1M-point array if you can avoid it.

## See also

- **[Streaming Data guide](streaming.md)** — full live-dashboard pattern
- **[@vizcrush/downsample](../packages/downsample.md)**, **[@vizcrush/bin](../packages/bin.md)**, **[@vizcrush/aggregate](../packages/aggregate.md)** — the underlying packages
