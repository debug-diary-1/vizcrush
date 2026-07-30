# Streaming Data

Live dashboards, real-time plots, and append-only data streams are first-class use cases for vizcrush. The pattern centers on **two primitives**:

- **`StreamingStats`** (`@vizcrush/aggregate`) — rolling-window statistics with O(1) updates
- **`appendAndDownsample`** (`@vizcrush/aggregate`) — merge new samples and re-downsample in one pass

Together they let you render a live chart of millions of historical points + new samples at 60 fps without ever holding the full raw history in memory.

## The streaming-dashboard pattern

```typescript
import { StreamingStats, appendAndDownsample } from "@vizcrush/aggregate";

// 1. Create a bounded buffer for the raw history
const buffer = new StreamingStats(/* windowSize */ 50_000);

// 2. Track the currently-displayed downsampled view
let displayed: Float64Array = new Float64Array();
const TARGET_POINTS = 1920; // typically your canvas width

// 3. Each time new data arrives, push + redraw
async function onNewSamples(newSamples: Float64Array) {
  displayed = await appendAndDownsample(buffer, newSamples, TARGET_POINTS);
  chart.update(displayed); // re-renders the chart with new points
}

// Wire to a websocket / EventSource / SSE / polling loop
const ws = new WebSocket("wss://example.com/stream");
ws.onmessage = (e) => {
  const samples = new Float64Array(JSON.parse(e.data));
  onNewSamples(samples);
};
```

This gives you:

- **Bounded memory** — `StreamingStats` keeps a ring buffer of the last 50K samples; older data is automatically dropped
- **Bounded render cost** — `appendAndDownsample` always returns ~1920 points regardless of how much data has flowed through
- **Live stats** — `buffer.mean`, `buffer.stdDev`, `buffer.min`, `buffer.max` are always current

## Showing rolling stats alongside the chart

```typescript
function renderStatsPanel() {
  document.getElementById("mean")!.textContent = buffer.mean.toFixed(2);
  document.getElementById("stddev")!.textContent = buffer.stdDev.toFixed(2);
  document.getElementById("min")!.textContent = buffer.min.toFixed(2);
  document.getElementById("max")!.textContent = buffer.max.toFixed(2);
}

async function onNewSamples(newSamples: Float64Array) {
  displayed = await appendAndDownsample(buffer, newSamples, TARGET_POINTS);
  chart.update(displayed);
  renderStatsPanel();
}
```

The Welford-updated stats are always exact for the **current window** — they're not approximations.

## High-frequency input

If samples arrive faster than ~60 Hz, batch them and only redraw on the next animation frame:

```typescript
let pending: number[] = [];
let scheduled = false;

ws.onmessage = (e) => {
  pending.push(JSON.parse(e.data));
  if (!scheduled) {
    scheduled = true;
    requestAnimationFrame(async () => {
      const batch = new Float64Array(pending);
      pending = [];
      scheduled = false;
      displayed = await appendAndDownsample(buffer, batch, TARGET_POINTS);
      chart.update(displayed);
    });
  }
};
```

This caps redraws at 60/sec while still keeping `StreamingStats` 100% up to date.

## Anomaly detection on the live stream

Combine with `@vizcrush/ai` to flag anomalies as they arrive:

```typescript
import { detectAnomalies } from "@vizcrush/ai";

async function onNewSamples(newSamples: Float64Array) {
  displayed = await appendAndDownsample(buffer, newSamples, TARGET_POINTS);

  // Run anomaly detection on the latest batch only
  const anomalies = detectAnomalies(newSamples, /* sensitivity */ 3.5);
  for (const a of anomalies) {
    showAlert(`Anomaly at index ${a.index}: ${a.value} (z=${a.zScore.toFixed(2)})`);
  }

  chart.update(displayed);
}
```

You can also run anomaly detection over the **full window** by feeding `buffer` into a typed-array view periodically.

## React version

If you're in React, `useStreamingStats` from `@vizcrush/react` wraps the same primitives in a hook:

```tsx
import { useStreamingStats } from "@vizcrush/react";

function LiveDashboard() {
  const { stats, push, pushBatch } = useStreamingStats(50_000);

  useEffect(() => {
    const ws = new WebSocket("wss://example.com/stream");
    ws.onmessage = (e) => pushBatch(new Float64Array(JSON.parse(e.data)));
    return () => ws.close();
  }, [pushBatch]);

  return (
    <div>
      <StatsPanel stats={stats} />
      <Chart /* … */ />
    </div>
  );
}
```

## Performance notes

- `StreamingStats.push` is sub-microsecond. `pushBatch` runs at ~250 M samples/sec on a modern CPU.
- `appendAndDownsample` runs in **a single pass** over the new samples + the existing buffer — total cost is dominated by the downsample step (~3 ms for a 1M-point buffer at 1920 target points).
- Don't store the raw history in component state. Keep it in the `StreamingStats` instance and only put the **downsampled output** in React state.

## See also

- **[@vizcrush/aggregate / StreamingStats](../packages/aggregate.md#streamingstats--rolling-window)** — full API
- **[@vizcrush/aggregate / appendAndDownsample](../packages/aggregate.md#appendanddownsampleacc-newdata-targetn)**
- **[@vizcrush/react / useStreamingStats](react.md#usestreamingstatswindowsize)**
- **[Examples / streaming-dashboard](../reference/examples.md)** — full WebSocket-driven demo
