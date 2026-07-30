# @vizcrush/ai

AI-native data analysis primitives. Anomaly detection, changepoint detection, auto-configuration of downsampling/binning, data summarization, shape embeddings, and natural-language query parsing — all running in pure JavaScript so they work everywhere.

These functions are designed to be **cheap to call** so you can sprinkle them throughout your app: detect anomalies on every new batch of data, ask "what algorithm should I use?" before each render, generate a summary string to feed to an LLM, etc.

## Import

```typescript
import {
  detectAnomalies,
  detectChangepoints,
  autoOptimize,
  summarize,
  summarizeForLLM,
  parseDataQuery,
  computeShapeVector,
  shapeSimilarity,
} from "@vizcrush/ai";
```

## `detectAnomalies(data, sensitivity?)`

Detect outliers using **MAD (Median Absolute Deviation)** with modified Z-scores. Returns anomalies classified by type.

```typescript
const anomalies = detectAnomalies(data, /* sensitivity */ 3.5);
// [
//   { index: 142, value: 98.7, zScore: 4.2, type: "spike" },
//   { index: 305, value: 12.1, zScore: -3.9, type: "dip" },
//   { index: 580, value: 54.0, zScore: 2.1, type: "shift" },
// ]
```

**Parameters:**

- `data: Float64Array` — input series
- `sensitivity: number` (default `3.5`) — modified Z-score threshold. Lower → more sensitive (more anomalies flagged). Typical range: `2.5` (very sensitive) to `5.0` (only egregious outliers).

**Anomaly types:**

- **`spike`** — local maximum well above the rolling median
- **`dip`** — local minimum well below the rolling median
- **`shift`** — sustained step change, detected by a regime change in the rolling mean

**Why MAD instead of standard Z-score?** MAD is **robust to outliers** — a single huge spike doesn't inflate the threshold. Standard `(value - mean) / stddev` is biased by the very anomalies you're trying to detect.

## `detectChangepoints(data, minSegment?)`

CUSUM (Cumulative Sum Control Chart) changepoint detection. Returns the indices where the underlying process appears to shift mean.

```typescript
const cps = detectChangepoints(data, /* minSegment */ 50);
// [200, 750] — two structural breaks
```

**Parameters:**

- `data: Float64Array` — input series
- `minSegment: number` (default `10`) — minimum length of a segment between changepoints. Larger → fewer, more meaningful changes; smaller → more sensitive.

Use this for:

- Regime detection in financial time series
- Detecting when a sensor's drift changes
- Auto-segmenting a dataset before per-segment analysis

## `autoOptimize(x, y, screenWidth?)`

Analyze a dataset and recommend the best downsampling algorithm + parameters. Used internally by some MCP tools and intended to be called before every render so you always pick the right strategy.

```typescript
const config = autoOptimize(x, y, /* screenWidth */ 1920);
// {
//   algorithm: "lttb" | "minmax_lttb" | "m4",
//   targetPoints: 1920,
//   binResolution: 0,             // > 0 if scatter binning recommended
//   spatialIndex: "none" | "quadtree",
//   streaming: false,
//   estimatedSpeedup: 520,        // data-reduction factor vs raw (n / targetPoints)
//   reasoning: "Spiky data detected — MinMax-LTTB preserves extrema better.",
// }
```

**Heuristics it uses:**

- **Monotonicity check** — strictly monotonic x → time-series, otherwise scatter
- **Spike ratio** — `count(|y - median| > 3*MAD) / n` > 0.1 → spiky → recommend MinMax-LTTB
- **Dataset size** — > 500K and scatter → recommend a quadtree
- **Screen width** — sets `targetPoints` to `screenWidth` (or `screenWidth * 4` for M4)

## `summarize(x, y)`

Generate a structured summary of an `(x, y)` series. Useful for dashboards and as input to LLM-based analysis.

```typescript
const summary = summarize(x, y);
// {
//   trend: "increasing" | "decreasing" | "stable" | "volatile",
//   trendSlope: 0.42,
//   range: { min: 12.0, max: 98.7 },
//   distribution: { mean: 54.3, stdDev: 18.2, skewness: 0.3 },
//   spikeCount: 7,
//   anomalyCount: 3,
//   summary: "1.2M-point time series, generally increasing (slope 0.42). 7 spikes detected.",
// }
```

The text `summary` is a one-line natural-language description suitable for displaying directly or passing to an LLM as context.

## `summarizeForLLM(x, y)`

Returns a longer natural-language string optimized for LLM context windows. Includes shape, distribution, anomaly summary, and recommendations.

```typescript
const text = summarizeForLLM(x, y);
// "This dataset contains 1,200,000 points spanning x=[0, 1199999], y=[12.0, 98.7].
//  The series is generally increasing with slope 0.42 (R² = 0.78). Distribution is
//  mildly right-skewed (skewness 0.3). 7 spikes and 3 anomalies were detected.
//  Recommended visualization: line chart with MinMax-LTTB downsampling to 1920 points."

await llm.chat({ system: text, user: "What's notable about this data?" });
```

## `parseDataQuery(query, dataInfo)`

Parse simple natural-language data queries. Used by the MCP server to translate user requests into algorithm calls.

```typescript
const result = parseDataQuery("show me anomalies above 100 in the last hour", {
  length: 1_000_000,
  hasTimestamps: true,
});
// {
//   operation: "filter+anomaly",
//   params: { above: 100, range: { unit: "hour", count: 1 } },
//   description: "Filter values > 100 within the last hour, then run anomaly detection",
// }
```

**Patterns it recognizes:**

| Phrase                                                                           | Operation         |
| -------------------------------------------------------------------------------- | ----------------- |
| `"above N"`, `"greater than N"`, `"over N"`, `"exceeding N"`, `"spikes above N"` | Filter > N        |
| `"below N"`, `"less than N"`, `"under N"`                                        | Filter < N        |
| `"last hour"`, `"last 5 minutes"`, `"last day"`                                  | Time range filter |
| `"anomalies"`, `"outliers"`, `"unusual"`                                         | Anomaly detection |
| `"downsample to N"`, `"reduce to N"`, `"N points"`                               | Downsample to N   |
| `"trend"`, `"slope"`, `"direction"`                                              | Trend analysis    |

It's intentionally a small rule-based parser, not an LLM call — fast, deterministic, and zero-cost. For more sophisticated NLP, route the query through your LLM and let it call MCP tools instead.

## `computeShapeVector(data, dimensions?)` and `shapeSimilarity(a, b)`

Compute a fixed-size feature vector that captures the _shape_ of a time series, independent of length and absolute scale. Then compare two series with cosine similarity.

```typescript
const vec1 = computeShapeVector(seriesA);
const vec2 = computeShapeVector(seriesB);

const similarity = shapeSimilarity(vec1, vec2);
// number in [0, 1] — 1 means identical shape, 0 means orthogonal
```

**What's in the vector** (default 16 dimensions):

| Dimensions | Feature                               |
| ---------- | ------------------------------------- |
| 0–7        | Histogram (8 bins, normalized)        |
| 8          | Trend slope (sign + magnitude)        |
| 9          | Volatility (coefficient of variation) |
| 10         | Spike ratio                           |
| 11–14      | Autocorrelation at lags 1, 2, 4, 8    |
| 15         | Mean (normalized)                     |

Use shape vectors for:

- **"Find similar charts"** — compare a query series against a library of reference patterns
- **Clustering** — group dashboards by data shape
- **Anomaly retrieval** — find historical periods that look like the current one

## All sync, all the time

Every function in `@vizcrush/ai` is **synchronous** and runs in pure JavaScript. They're cheap enough to call on every render or every new data batch, and they don't require WebAssembly. There's a Rust crate (`vizcrush-ai`) planned for the heavier cases, but the JS implementations are already fast enough for most use cases.

## See also

- **[AI Features guide](../user-guide/ai.md)** — end-to-end patterns
- **[MCP Server](../user-guide/mcp.md)** — these same functions exposed as MCP tools to AI agents
- **[Examples / ai-playground](../reference/examples.md)** — interactive UI for exploring all of this
