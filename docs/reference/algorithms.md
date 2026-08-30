# Algorithms Reference

A catalog of the algorithm families shipping in vizcrush, with the package and Rust crate that implements them. Use this page to find the right tool for a job; the generated [project inventory](generated-inventory.md) is the canonical runtime-export list.

## Downsampling

Reduce a paired `(x, y)` series to a smaller, visually-equivalent set.

| Algorithm                                 | Function       | Package                                             | Best for                           |
| ----------------------------------------- | -------------- | --------------------------------------------------- | ---------------------------------- |
| **LTTB** (Largest-Triangle-Three-Buckets) | `lttb()`       | [`@vizcrush/downsample`](../packages/downsample.md) | Smooth time series, sensor metrics |
| **MinMax-LTTB**                           | `minMaxLttb()` | [`@vizcrush/downsample`](../packages/downsample.md) | Spiky data — financial, IoT bursts |
| **M4** (Min-Max-Min-Max)                  | `m4()`         | [`@vizcrush/downsample`](../packages/downsample.md) | Per-pixel rendering, max fidelity  |
| **LTOB** (Largest-Triangle-One-Bucket)    | `ltob()`       | [`@vizcrush/downsample`](../packages/downsample.md) | Faster simpler variant of LTTB     |

All four return `{ x: Float64Array, y: Float64Array }`. Reference paper: Steinarsson, _"Downsampling Time Series for Visual Representation"_ (2013).

## Aggregation & statistics

| Algorithm                              | Function / Class              | Package                                           | Notes                                 |
| -------------------------------------- | ----------------------------- | ------------------------------------------------- | ------------------------------------- |
| **Welford's online stats**             | `stats()`, `StreamingStats`   | [`@vizcrush/aggregate`](../packages/aggregate.md) | One-pass, numerically stable          |
| **Exact percentiles**                  | `percentile()`                | [`@vizcrush/aggregate`](../packages/aggregate.md) | Sort + linear interpolation           |
| **t-digest** (approximate percentiles) | `vizcrush-aggregate::tdigest` | (Rust crate)                                      | Approximate, sub-linear memory        |
| **DDSketch / KLL**                     | `DDSketch`, `KllSketch`       | [`@vizcrush/aggregate`](../packages/aggregate.md) | Bounded-memory approximate quantiles  |
| **Reservoir sampling**                 | `ReservoirSampler`            | [`@vizcrush/aggregate`](../packages/aggregate.md) | Bounded representative stream sample  |
| **HyperLogLog**                        | `HyperLogLog`                 | [`@vizcrush/aggregate`](../packages/aggregate.md) | Approximate distinct-value count      |
| **Count-Min Sketch**                   | `CountMinSketch`              | [`@vizcrush/aggregate`](../packages/aggregate.md) | Approximate frequencies/heavy hitters |

## Transforms

| Algorithm                  | Function                             | Package                                           | Cost                        |
| -------------------------- | ------------------------------------ | ------------------------------------------------- | --------------------------- |
| **Radix sort**             | `sortBy()`                           | [`@vizcrush/transform`](../packages/transform.md) | O(n) for fixed-width floats |
| **Min-max normalize**      | `normalize()`                        | [`@vizcrush/transform`](../packages/transform.md) | O(n) two-pass               |
| **Range filter**           | `filterRange()`                      | [`@vizcrush/transform`](../packages/transform.md) | O(n) single pass            |
| **Log / power transform**  | `logTransform()`, `powerTransform()` | [`@vizcrush/transform`](../packages/transform.md) | O(n)                        |
| **Quantile normalization** | `quantileNormalize()`                | [`@vizcrush/transform`](../packages/transform.md) | O(n log n)                  |

## Binning & density

| Algorithm             | Function   | Package                                   | Output                                         |
| --------------------- | ---------- | ----------------------------------------- | ---------------------------------------------- |
| **1D histogram**      | `bin1d()`  | [`@vizcrush/bin`](../packages/bin.md)     | `Uint32Array` counts + `Float64Array` edges    |
| **2D density grid**   | `bin2d()`  | [`@vizcrush/bin`](../packages/bin.md)     | Row-major `Uint32Array` of size `xBins*yBins`  |
| **Hexagonal binning** | `hexbin()` | [`@vizcrush/bin`](../packages/bin.md)     | Sparse list of `{cx, cy, count}` cells         |
| **3D voxel binning**  | `bin3d()`  | [`@vizcrush/bin3d`](../packages/bin3d.md) | Flat `Uint32Array` of size `xBins*yBins*zBins` |

## Spatial indexing

| Index                 | Build / Query functions                                      | Package                                           | Dimensions    |
| --------------------- | ------------------------------------------------------------ | ------------------------------------------------- | ------------- |
| **Quadtree**          | `buildQuadtree`, `queryRange`, `queryNearest`                | [`@vizcrush/spatial`](../packages/spatial.md)     | 2D            |
| **Octree**            | `buildOctree`, `queryRange3d`, `queryNearest3d`              | [`@vizcrush/spatial3d`](../packages/spatial3d.md) | 3D            |
| **k-d tree**          | (in `vizcrush-spatial::kdtree`, future export)               | (Rust crate)                                      | 2D / N-D      |
| **Spatial hash grid** | `buildHashGrid`, `hashGridQueryRadius`, `hashGridQueryRange` | [`@vizcrush/spatial`](../packages/spatial.md)     | 2D            |
| **Morton ordering**   | `mortonOrder2d()`                                            | [`@vizcrush/spatial`](../packages/spatial.md)     | 2D            |
| **Frustum culling**   | `frustumCull()`                                              | [`@vizcrush/spatial3d`](../packages/spatial3d.md) | 3D, MVP-based |

Both quadtree and octree use the same configuration: `MAX_POINTS = 64` per leaf, `MAX_DEPTH = 12`.

## AI & analysis

| Algorithm                             | Function                           | Package                             | Implementation                                 |
| ------------------------------------- | ---------------------------------- | ----------------------------------- | ---------------------------------------------- |
| **Anomaly detection (MAD + Z-score)** | `detectAnomalies()`                | [`@vizcrush/ai`](../packages/ai.md) | Robust to outliers, classifies spike/dip/shift |
| **Changepoint detection (CUSUM)**     | `detectChangepoints()`             | [`@vizcrush/ai`](../packages/ai.md) | Sustained mean shifts                          |
| **Auto-optimization**                 | `autoOptimize()`                   | [`@vizcrush/ai`](../packages/ai.md) | Heuristic algorithm + parameter selection      |
| **Data summarization**                | `summarize()`, `summarizeForLLM()` | [`@vizcrush/ai`](../packages/ai.md) | Trend, distribution, anomalies                 |
| **Shape embeddings**                  | `computeShapeVector()`             | [`@vizcrush/ai`](../packages/ai.md) | 16-dim feature vector                          |
| **Shape similarity**                  | `shapeSimilarity()`                | [`@vizcrush/ai`](../packages/ai.md) | Cosine similarity in [0, 1]                    |
| **NL query parsing**                  | `parseDataQuery()`                 | [`@vizcrush/ai`](../packages/ai.md) | Rule-based, no LLM round-trip                  |

## Backend selection

| Function               | Package                                 | Purpose                              |
| ---------------------- | --------------------------------------- | ------------------------------------ |
| `init()`               | [`@vizcrush/core`](../packages/core.md) | Initialize, auto-select best backend |
| `detectCapabilities()` | [`@vizcrush/core`](../packages/core.md) | Probe runtime features               |
| `selectBackend(caps)`  | [`@vizcrush/core`](../packages/core.md) | Apply selection rules                |

The selection is: **WASM → JS** — WASM whenever WebAssembly is available, the pure-JS core otherwise. See **[Backends & Capabilities](../user-guide/backends.md)** for details.

## Performance reference

Run the suite in `benchmarks/` for numbers on your hardware; results land in `benchmarks/results/`. Reference points from the latest Node run (pure-JS core, V8 — `benchmarks/results/latest.json`):

| Operation     | Input size | Time   |
| ------------- | ---------- | ------ |
| `lttb`        | 1M → 1000  | 1.8 ms |
| `filterRange` | 1M         | 5.3 ms |
| `stats`       | 1M         | 3.9 ms |

In Chromium, the WASM backend runs `lttb` 1M → 1000 in ~1.5 ms — WASM is roughly 4× faster than the JS core in Chromium/V8, but the JS core is comparable or faster in Firefox and WebKit, and the first WASM call pays a one-time module-load cost. See ADR 0003 (`docs/adr/0003-wasm-vs-js-is-engine-dependent.md`). No WebGPU compute path is wired for any of these algorithms.

## See also

- **[Packages overview](../packages/index.md)** — at-a-glance package summary
- **[Examples gallery](examples.md)** — runnable demos for each algorithm
