# Streaming Data

vizcrush separates two concerns in a live dashboard:

- `StreamingStats` maintains rolling mean, variance, minimum, and maximum values.
- `@vizcrush/downsample` reduces the history your application retains before rendering.

## Rolling statistics

```typescript
import { StreamingStats } from "@vizcrush/aggregate";

const stats = new StreamingStats(50_000);

socket.onmessage = (event) => {
  const batch = new Float64Array(JSON.parse(event.data));
  stats.pushBatch(batch);

  renderStats({
    mean: stats.mean,
    standardDeviation: stats.stdDev,
    min: stats.min,
    max: stats.max,
    count: stats.length,
  });
};
```

The window is bounded: after 50,000 samples, pushing a value evicts the oldest value from the statistics window.

## A bounded chart history

Keep chart history in application state, convert it to typed arrays, and downsample at redraw time:

```typescript
import { lttb } from "@vizcrush/downsample";

const maxHistory = 50_000;
const targetPoints = 1_920;
const history: number[] = [];
let nextIndex = 0;

async function onSamples(batch: number[]) {
  history.push(...batch);
  nextIndex += batch.length;
  if (history.length > maxHistory) {
    history.splice(0, history.length - maxHistory);
  }

  const y = Float64Array.from(history);
  const x = Float64Array.from(
    { length: history.length },
    (_, index) => nextIndex - history.length + index,
  );

  const visible = await lttb(x, y, targetPoints);
  renderLine(visible.x, visible.y);
}
```

For a high-frequency stream, batch incoming samples and redraw at most once per animation frame. The statistics accumulator can still accept every batch.

## Approximate distribution metrics

For streams that need percentiles, distinct counts, or frequencies without retaining every value, use the bounded-memory sketches in `@vizcrush/aggregate`:

- `DDSketch` or `KllSketch` for approximate quantiles
- `HyperLogLog` for distinct counts
- `CountMinSketch` for approximate frequencies
- `ReservoirSampler` for a representative sample

See [@vizcrush/aggregate](../packages/aggregate.md) for the APIs.

## React

`useStreamingStats(windowSize)` wraps `StreamingStats` and returns `stats`, `push`, `pushBatch`, and `reset`.

```tsx
const { stats, pushBatch } = useStreamingStats(50_000);
```

The hook manages statistics only; keep the chart history separately and pass its downsampled result to your renderer.

## See also

- [@vizcrush/aggregate](../packages/aggregate.md)
- [@vizcrush/downsample](../packages/downsample.md)
- [React Integration](react.md)
