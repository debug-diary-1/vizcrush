# Examples Gallery

vizcrush ships with 42 runnable example apps under `examples/`. Gallery cards distinguish examples that import vizcrush from adjacent graphics demos that teach browser rendering techniques. For a guided route through the collection, start with the [examples README](https://github.com/debug-diary-1/vizcrush/tree/main/examples).

## Time-Series

### `financial-timeseries`

MinMax-LTTB stock chart that preserves OHLC spikes when downsampling spiky financial data.

**vizcrush algorithms:** `lttb`, `minMaxLttb`

**Folder:** `examples/financial-timeseries/`

### `streaming-dashboard`

Simulated live dashboard with rolling stats and a real-time downsampled chart. The in-browser generator can be replaced by a WebSocket handler in an application.

**vizcrush algorithms:** `streamingStats`, `lttbSync`

**Folder:** `examples/streaming-dashboard/`

### `neon-timeseries`

Glowing neon tube charts with LTTB streaming and a 4-pass Canvas 2D bloom effect.

**vizcrush algorithms:** `lttbSync`, `StreamingStats`

**Folder:** `examples/neon-timeseries/`

## Scatter and Density

### `d3-large-scatter`

D3 + vizcrush for million-point scatter plots with quadtree hover detection.

**vizcrush algorithms:** `buildQuadtree`, `queryRange`, `bin2d`

**Folder:** `examples/d3-large-scatter/`

### `iot-heatmap`

GPS sensor density heatmap with viridis colormap and percentile stats panel.

**vizcrush algorithms:** `bin2d`, `percentile`

**Folder:** `examples/iot-heatmap/`

### `chartgpu-integration` (Chart.js)

Real Chart.js integration that renders LTTB output and non-empty `bin2d` density bins. The historical directory name is retained so existing gallery URLs do not break.

**vizcrush algorithms:** `lttb`, `bin2d`

**Folder:** `examples/chartgpu-integration/`

## 3D & Volumetric

### `point-cloud-3d`

Million-point 3D point cloud with octree, frustum culling, and nearest-neighbor hover.

**vizcrush algorithms:** `buildOctree`, `frustumCull`, `queryNearest3d`

**Folder:** `examples/point-cloud-3d/`

### `threejs-integration`

Three.js + vizcrush frustum culling pipeline for rendering large point clouds at 60 fps.

**vizcrush algorithms:** `buildOctree`, `frustumCull`

**Folder:** `examples/threejs-integration/`

### `globe-3d`

Spherical lat/lng data projected onto a 3D globe with octree region queries.

**vizcrush algorithms:** `buildOctree`, `queryRange3d`

**Folder:** `examples/globe-3d/`

### `lidar-terrain`

LiDAR point cloud rendered as terrain mesh with voxel binning for multi-LOD rendering.

**vizcrush algorithms:** `bin3d`

**Folder:** `examples/lidar-terrain/`

### `medical-volume`

Volumetric CT data visualized as 2D slices extracted from a `bin3d` voxel grid with axis switching and multiple colormaps.

**vizcrush algorithms:** `bin3d`

**Folder:** `examples/medical-volume/`

### `voxel-heatmap-3d`

3D density voxels rendered as colored cubes with a custom rotate-and-project wireframe loop.

**vizcrush algorithms:** `bin3d`

**Folder:** `examples/voxel-heatmap-3d/`

### `benchmark-3d`

Performance comparison of 3D operations (octree build, frustum cull, voxel bin) against pure JS.

**vizcrush algorithms:** `buildOctree`, `frustumCull`, `bin3d`

**Folder:** `examples/benchmark-3d/`

## Streaming Sketches — Dedicated

### `reservoir-sampling`

Reservoir sampling with k vs representativeness tradeoff, chi-squared test, and histogram comparison.

**vizcrush algorithms:** `ReservoirSampler`

**Folder:** `examples/reservoir-sampling/`

### `ddsketch`

CDF overlay (exact vs sketch) with interactive alpha accuracy tradeoff controls.

**vizcrush algorithms:** `DDSketch`

**Folder:** `examples/ddsketch/`

### `kll-sketch`

CDF comparison with k vs compression ratio and rank error visualization.

**vizcrush algorithms:** `KllSketch`

**Folder:** `examples/kll-sketch/`

### `hyperloglog`

Animated streaming unique counter with register heatmap and convergence chart.

**vizcrush algorithms:** `HyperLogLog`

**Folder:** `examples/hyperloglog/`

### `countmin-sketch`

Top-20 frequency bars with over-estimation highlighting for heavy-hitter detection.

**vizcrush algorithms:** `CountMinSketch`

**Folder:** `examples/countmin-sketch/`

## Streaming Sketches — Composite

### `latency-percentiles`

Real-time p50/p90/p95/p99 tail latency tracking with DDSketch vs KLL comparison.

**vizcrush algorithms:** `DDSketch`, `KllSketch`

**Folder:** `examples/latency-percentiles/`

### `stream-analytics`

HLL unique counting + Count-Min heavy hitters + reservoir scatter in a unified dashboard.

**vizcrush algorithms:** `HyperLogLog`, `CountMinSketch`, `ReservoirSampler`

**Folder:** `examples/stream-analytics/`

### `sketch-comparison`

DDSketch vs KLL vs exact head-to-head with a triple CDF overlay.

**vizcrush algorithms:** `DDSketch`, `KllSketch`, `percentile`

**Folder:** `examples/sketch-comparison/`

## Transforms

### `data-transforms`

Log/power transform and quantile normalization with before/after histograms.

**vizcrush algorithms:** `logTransform`, `powerTransform`, `quantileNormalize`

**Folder:** `examples/data-transforms/`

### `log-transform`

Interactive base selector across 4 distributions with before/after histogram comparison.

**vizcrush algorithms:** `logTransform`, `lnTransform`, `log10Transform`

**Folder:** `examples/log-transform/`

### `quantile-normalization`

2-4 series alignment with overlaid histograms showing pre- and post-normalization distributions.

**vizcrush algorithms:** `quantileNormalize`

**Folder:** `examples/quantile-normalization/`

## Spatial

### `spatial-hashgrid`

Interactive hover neighbor search with hash grid vs quadtree performance comparison.

**vizcrush algorithms:** `buildHashGrid`, `hashGridQueryRadius`, `buildQuadtree`, `queryRange`, `mortonOrder2d`

**Folder:** `examples/spatial-hashgrid/`

### `morton-renderer`

Animated Z-curve vs random rendering order with cache locality scoring.

**vizcrush algorithms:** `mortonOrder2d`

**Folder:** `examples/morton-renderer/`

### `reservoir-scatter`

Full/sample scatter overlay with KS test and quadrant density comparison.

**vizcrush algorithms:** `ReservoirSampler`

**Folder:** `examples/reservoir-scatter/`

## GPU / WebGPU

### `webgpu-heatmap`

Compute shader bins 1M points into a viridis-colored heatmap via fragment shader.

**vizcrush algorithms:** none — a standalone WebGPU demo; the compute shader is the example's own (vizcrush's only WebGPU compute path is bin2d's opt-in one — ADR 0004)

**Folder:** `examples/webgpu-heatmap/`

### `gpu-particles`

Compute shader physics + render pipeline particle system with real-time simulation.

**vizcrush algorithms:** none — a standalone WebGPU demo; the compute shaders are the example's own

**Folder:** `examples/gpu-particles/`

### `gpu-vs-canvas`

Side-by-side WebGPU vs Canvas 2D benchmark for binning and rendering.

**vizcrush algorithms:** `bin2d` (on the Canvas 2D side); the WebGPU side uses the example's own compute shader

**Folder:** `examples/gpu-vs-canvas/`

## Visual Showcase

### `flow-field`

50K particles streaming through a velocity field with fading trails.

**vizcrush algorithms:** none — a standalone graphics demo with its own particle simulation

**Folder:** `examples/flow-field/`

### `gpu-voronoi`

Live Voronoi diagram with glowing edges and draggable seed points.

**vizcrush algorithms:** none — a standalone graphics demo with its own Voronoi implementation

**Folder:** `examples/gpu-voronoi/`

### `volume-raymarcher`

3D volumetric nebula raymarched per-pixel with lighting and absorption.

**vizcrush algorithms:** none — a standalone graphics demo with its own raymarcher

**Folder:** `examples/volume-raymarcher/`

### `million-galaxy`

1M-star spiral galaxy rendered with ImageData projection and orbit camera.

**vizcrush algorithms:** none — a standalone graphics demo with its own projection and renderer

**Folder:** `examples/million-galaxy/`

### `threejs-nature`

Three.js nature scene with terrain, waterfall, and bird flock simulation.

**vizcrush algorithms:** `bin2d`, `buildHashGrid`, `hashGridQueryRadius`, `StreamingStats`

**Folder:** `examples/threejs-nature/`

## AI & Integrations

### `react-echarts-dashboard`

React controls backed by `@vizcrush/react` hooks reduce and summarize a one-million-point typed-array series before a real ECharts canvas renderer receives it.

**vizcrush APIs:** `useDownsample`, `useStats`, `useVizcrush`

**Folder:** `examples/react-echarts-dashboard/`

### `worker-pipeline`

Transfers typed-array buffers to a module worker, runs LTTB away from the main thread, and transfers the bounded result back for Canvas rendering.

**vizcrush algorithms:** `lttb`

**Folder:** `examples/worker-pipeline/`

### `deckgl-density-lod`

Aggregates one million positions into selectable density-grid levels before constructing deck.gl `GridCellLayer` objects.

**vizcrush algorithms:** `bin2dWithBackend`

**Folder:** `examples/deckgl-density-lod/`

### `observable-plot-timeseries`

Uses LTTB to bound the number of SVG marks while keeping Observable Plot's declarative chart API.

**vizcrush algorithms:** `lttb`

**Folder:** `examples/observable-plot-timeseries/`

### `arrow-data-pipeline`

Decodes numeric columns from an Apache Arrow IPC stream, sends those typed arrays through LTTB and statistics, and renders the bounded result with Canvas.

**vizcrush algorithms:** `lttb`, `stats`

**Folder:** `examples/arrow-data-pipeline/`

### `ai-playground`

Interactive exploration of anomaly detection, auto-optimization, and shape similarity from `@vizcrush/ai`.

**vizcrush algorithms:** `detectAnomalies`, `autoOptimize`, `summarize`, `shapeSimilarity`

**Folder:** `examples/ai-playground/`

### `mcp-demo`

MCP server configuration walkthrough with sample CSV files and example prompts for Claude Desktop, Claude Code, and Cursor.

**vizcrush algorithms:** MCP tools

**Folder:** `examples/mcp-demo/`

## Running an example

From the monorepo root:

```bash
pnpm install
pnpm build:wasm
pnpm examples
```

To run one example, use `pnpm --dir examples/streaming-dashboard dev`. Each example has an ordinary Vite development script and is wired through the pnpm workspace, so no global development command or separate install is required.

## See also

- **[Algorithms reference](algorithms.md)** — find the algorithm you want to demo, then jump to the example that uses it
- **[Quickstart](../user-guide/quickstart.md)** — minimal hello-world before diving into a full example
