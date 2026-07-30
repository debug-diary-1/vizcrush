# AI Features

vizcrush ships with a small but powerful set of AI-native data analysis primitives in `@vizcrush/ai`. They're all **synchronous, pure JavaScript**, cheap to call, and designed to be sprinkled throughout your app or chained behind an LLM.

This guide walks through the most common AI patterns end-to-end. For full API details see the **[@vizcrush/ai package reference](../packages/ai.md)**.

## Pattern 1: Anomaly detection on a fresh dataset

```typescript
import { detectAnomalies } from "@vizcrush/ai";

const anomalies = detectAnomalies(data, /* sensitivity */ 3.5);

for (const a of anomalies) {
  console.log(`${a.type} at index ${a.index}: value=${a.value}, z=${a.zScore.toFixed(2)}`);
}
// spike at index 142: value=98.7, z=4.21
// dip   at index 305: value=12.1, z=-3.94
// shift at index 580: value=54.0, z=2.11
```

**Tuning sensitivity:**

| Sensitivity | Behavior                                         |
| ----------- | ------------------------------------------------ |
| `2.5`       | Very sensitive — flags lots of points            |
| `3.5`       | Default — flags points 3.5+ MADs from the median |
| `5.0`       | Conservative — only egregious outliers           |

The detection uses **Median Absolute Deviation (MAD)** rather than standard Z-score, which means a single huge outlier doesn't bias the threshold. Robust by design.

## Pattern 2: Auto-pick the right downsampler

Instead of guessing whether to use `lttb` or `minMaxLttb`, ask vizcrush:

```typescript
import { autoOptimize } from "@vizcrush/ai";
import { lttb, minMaxLttb, m4 } from "@vizcrush/downsample";

const config = autoOptimize(x, y, /* screenWidth */ 1920);
// {
//   algorithm: "minmax_lttb",
//   targetPoints: 1920,
//   binResolution: 0,
//   spatialIndex: "none",
//   reasoning: "Spiky data detected (spike ratio 12.4)…",
// }

const fns = { lttb, minmax_lttb: minMaxLttb, m4 };
const result = await fns[config.algorithm](x, y, config.targetPoints);
```

Call `autoOptimize` once when a dataset loads (it's fast — single pass over the data). For continuously updating streams, you usually don't need to re-run it — the recommendation rarely changes for the same data source.

## Pattern 3: Generate context for an LLM

```typescript
import { summarizeForLLM } from "@vizcrush/ai";

const dataContext = summarizeForLLM(x, y);

const response = await llm.chat({
  system: `You are a data analyst. Here is context about the user's data:\n${dataContext}`,
  messages: [
    { role: "user", content: "What's notable about this data? Suggest one visualization." },
  ],
});
```

`summarizeForLLM` returns a longer natural-language paragraph including:

- Dataset size and x/y ranges
- Trend direction and slope
- Distribution stats (mean, stddev, skewness)
- Anomaly and spike counts
- A recommended visualization

Designed to be drop-in friendly with any LLM API.

## Pattern 4: Detect regime changes

Use `detectChangepoints` to find places where the underlying process shifts:

```typescript
import { detectChangepoints } from "@vizcrush/ai";

const cps = detectChangepoints(data, /* minSegment */ 50);
// [200, 750]

// Split into segments and analyze each
let prev = 0;
for (const cp of [...cps, data.length]) {
  const segment = data.subarray(prev, cp);
  const segStats = await stats(segment);
  console.log(`Segment [${prev}..${cp}]: mean=${segStats.mean.toFixed(2)}`);
  prev = cp;
}
```

CUSUM is conservative by design — it only fires on sustained shifts, not transient spikes. Pair with `detectAnomalies` if you want to catch both.

## Pattern 5: "Find similar charts" with shape embeddings

```typescript
import { computeShapeVector, shapeSimilarity } from "@vizcrush/ai";

// Pre-compute embeddings for a library of reference patterns
const library = [
  { name: "rising linear", data: makeRising() },
  { name: "spike train", data: makeSpikes() },
  { name: "step function", data: makeSteps() },
  // …
];
const embeddings = library.map((entry) => ({
  ...entry,
  vector: computeShapeVector(entry.data),
}));

// Now match a query series
function findMostSimilar(query: Float64Array) {
  const queryVec = computeShapeVector(query);
  return embeddings
    .map((e) => ({ name: e.name, score: shapeSimilarity(queryVec, e.vector) }))
    .sort((a, b) => b.score - a.score);
}

console.log(findMostSimilar(myData));
// [
//   { name: "spike train", score: 0.92 },
//   { name: "step function", score: 0.41 },
//   { name: "rising linear", score: 0.15 },
// ]
```

Useful for:

- Pattern matching against historical incidents
- Clustering dashboards by data shape
- "What does this remind me of?" exploration

## Pattern 6: Natural-language data queries

For simple queries you don't need an LLM round-trip — `parseDataQuery` is a fast rule-based parser:

```typescript
import { parseDataQuery } from "@vizcrush/ai";

const result = parseDataQuery("show spikes above 100 in the last hour", {
  length: 1_000_000,
  hasTimestamps: true,
});
// {
//   operation: "filter+anomaly",
//   params: { above: 100, range: { unit: "hour", count: 1 } },
//   description: "Filter values > 100 within the last hour, then run anomaly detection",
// }

// Then execute based on `result.operation`
```

Patterns it recognizes include `"above N"`, `"below N"`, `"last hour"`, `"anomalies"`, `"downsample to N"`, `"trend"`, etc. — see the [package reference](../packages/ai.md#parsedataqueryquery-datainfo) for the full list.

For more sophisticated NLP, route the user's query through your LLM and have it call the **[MCP server tools](mcp.md)** instead.

## Combining everything

A complete "smart dashboard" pattern:

```typescript
import { autoOptimize, detectAnomalies, summarizeForLLM } from "@vizcrush/ai";
import { lttb, minMaxLttb, m4 } from "@vizcrush/downsample";

async function loadAndAnalyze(x: Float64Array, y: Float64Array) {
  // 1. Pick the right algorithm
  const config = autoOptimize(x, y, window.innerWidth);

  // 2. Downsample for display
  const fns = { lttb, minmax_lttb: minMaxLttb, m4 };
  const display = await fns[config.algorithm](x, y, config.targetPoints);
  chart.update(display);

  // 3. Run anomaly detection in the background
  const anomalies = detectAnomalies(y, 3.5);
  if (anomalies.length > 0) {
    showAnomalyOverlay(anomalies);
  }

  // 4. Generate a one-liner for the dashboard header
  const summary = summarizeForLLM(x, y);
  document.getElementById("summary")!.textContent = summary;
}
```

That's a fully adaptive, auto-optimized, anomaly-aware dashboard in ~15 lines of glue code.

## See also

- **[@vizcrush/ai package reference](../packages/ai.md)** — full API docs
- **[MCP Server](mcp.md)** — these same functions exposed to Claude / Cursor as tools
- **[Examples / ai-playground](../reference/examples.md)** — interactive UI for exploring all of this
