# Examples Gallery

vizcrush ships with 37 runnable example apps under `examples/`. Each one is a self-contained Vite app that demonstrates a specific integration pattern. Clone the repo, run `pnpm install && pnpm build`, then `pnpm dev` from the example folder.

## Time-Series

### `financial-timeseries`

MinMax-LTTB stock chart that preserves OHLC spikes when downsampling spiky financial data.

**vizcrush algorithms:** `lttb`, `minMaxLttb`

**Folder:** `examples/financial-timeseries/`

### `streaming-dashboard`

WebSocket-driven live dashboard with rolling stats and a real-time downsampled chart.

**vizcrush algorithms:** `StreamingStats`

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

### `chartgpu-integration`

Integration scaffold with vizcrush preprocessing, a Canvas 2D renderer, and notes showing where ChartGPU can be connected.

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

**vizcrush algorithms:** Particle physics, velocity field

**Folder:** `examples/flow-field/`

### `gpu-voronoi`

Live Voronoi diagram with glowing edges and draggable seed points.

**vizcrush algorithms:** Voronoi computation

**Folder:** `examples/gpu-voronoi/`

### `volume-raymarcher`

3D volumetric nebula raymarched per-pixel with lighting and absorption.

**vizcrush algorithms:** Raymarching, trilinear interpolation

**Folder:** `examples/volume-raymarcher/`

### `million-galaxy`

1M-star spiral galaxy rendered with ImageData projection and orbit camera.

**vizcrush algorithms:** ImageData rendering, projection

**Folder:** `examples/million-galaxy/`

### `threejs-nature`

Three.js nature scene with terrain, waterfall, and bird flock simulation.

**vizcrush algorithms:** `bin2d`, `buildHashGrid`, `hashGridQueryRadius`, `StreamingStats`

**Folder:** `examples/threejs-nature/`

## AI & Integrations

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
pnpm install     # one-time
pnpm build       # builds WASM + TypeScript packages
cd examples/streaming-dashboard
pnpm dev         # starts vite, usually at http://localhost:5173
```

Each example has its own `package.json` and is wired up via the pnpm workspace, so you don't need separate dependency installs.

## See also

- **[Algorithms reference](algorithms.md)** — find the algorithm you want to demo, then jump to the example that uses it
- **[Quickstart](../user-guide/quickstart.md)** — minimal hello-world before diving into a full example
