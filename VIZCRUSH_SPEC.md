# vizcrush — Functional Specification

> GPU-Accelerated Data Primitives for Browser Visualization
> v0.1.0 · March 2026 · MIT License

> **This is the original vision document — not current behavior.** Several
> things described below as shipped were never wired up, most importantly
> WebGPU compute (only bin2d has a WebGPU path — opt-in, added 2026-07, and
> measured slower than WASM, see ADR 0004;
> `detectCapabilities()` probes `navigator.gpu` for reporting only) and
> t-digest-backed percentiles (`percentile()` is exact/sort-based; `TDigest`
> exists in the `vizcrush-aggregate` Rust crate but has no caller). For what
> actually ships, see `docs/ARCHITECTURE.md` and the ADRs in `docs/adr/` —
> ADR 0002 and ADR 0003 specifically retract the WebGPU/SIMD performance
> claims made throughout this document.

---

## 1. Executive Summary

**vizcrush** is an open-source library that provides GPU-accelerated data processing primitives purpose-built for browser-based data visualization. Written in Rust, compiled to WebAssembly with SIMD optimizations, and leveraging WebGPU compute shaders, it delivers the computational middle layer between raw data and charting libraries.

**The gap:** Libraries like ChartGPU, deck.gl, and Plotly handle rendering. Libraries like TypeGPU handle GPU buffer management. Nobody has built the optimized data algorithms layer in between — the downsampling, binning, spatial indexing, and streaming aggregation that every large-dataset visualization needs.

**vizcrush fills that gap.** It draws nothing. It takes data in and returns optimized data out — ready for any renderer.

**It also ships with an MCP server** that lets AI coding agents (Cursor, Claude Code, Copilot, VS Code) invoke GPU-accelerated data operations directly — making vizcrush the first "AI-native" data compute library.

---

## 2. Project Identity

| Attribute       | Value                                                     |
| --------------- | --------------------------------------------------------- |
| Name            | vizcrush                                                  |
| Tagline         | GPU-accelerated data primitives for browser visualization |
| License         | MIT                                                       |
| Language        | Rust (core) + TypeScript (bindings + MCP server)          |
| Compile Target  | WASM + SIMD (`wasm32-unknown-unknown`)                    |
| GPU API         | WebGPU compute shaders (WebGL fallback planned for v0.3)  |
| Bundle Target   | <15KB gzipped (core WASM module)                          |
| Dependencies    | Zero runtime JS dependencies                              |
| Browser Support | Chrome 113+, Edge 113+, Firefox 141+, Safari 26+          |
| Package Manager | npm (primary), crates.io (Rust crate)                     |
| MCP Server      | `@vizcrush/mcp-server` (stdio + streamable HTTP)          |

---

## 3. Problem Statement

### 3.1 The 100K+ Datapoint Wall

Frontend engineers building data-heavy dashboards — fintech trading views, IoT sensor panels, observability platforms — hit a performance cliff when datasets exceed 100,000 points:

- Browser tabs freeze during pan/zoom interactions
- Chart libraries (D3, Plotly, ECharts) visibly stutter above 50K points
- Developers resort to ad-hoc downsampling in JavaScript, losing visual fidelity
- Web Workers add latency from serialization overhead on interactive operations
- No standard, high-performance data processing layer exists for the browser

### 3.2 Why Existing Solutions Fall Short

| Solution                              | Limitation                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| Pure JS downsampling (downsample npm) | CPU-bound; blocks main thread on 1M+ points                                    |
| Web Workers                           | Serialization cost of 100K objects ~150ms; stale frames on rapid zoom          |
| Server-side aggregation               | Adds latency; requires backend infra; breaks offline/local workflows           |
| ChartGPU / deck.gl                    | Full chart libs — opinionated, heavy; can't use their compute layer standalone |
| TypeGPU / WebGpGpu.ts                 | Raw GPU access — no data-viz algorithms included                               |

### 3.3 The Missing Middle Layer

| Layer            | Examples                               | Status                 |
| ---------------- | -------------------------------------- | ---------------------- |
| Rendering        | ChartGPU, deck.gl, D3, ECharts, Plotly | Mature                 |
| **Data Compute** | **vizcrush ← THIS**                    | **MISSING**            |
| GPU Access       | TypeGPU, WebGpGpu.ts, wgpu             | Emerging               |
| Browser APIs     | WebGPU, WebAssembly + SIMD             | Shipped (70% coverage) |

---

## 4. Architecture

### 4.1 Design Principles

- **Zero rendering opinions:** vizcrush never touches the DOM, canvas, or any rendering surface. Data in, data out.
- **Dual compute paths:** Every algorithm has both a WASM+SIMD path (for CPU-bound transforms) and a WebGPU compute shader path (for parallel workloads). The library auto-selects the faster path based on data size and hardware.
- **Zero-copy where possible:** Uses SharedArrayBuffer and typed arrays to minimize data movement between JS, WASM, and GPU.
- **Progressive enhancement:** Works with just WASM if WebGPU is unavailable. Falls back to scalar WASM if SIMD is unsupported. Always functional, never broken.
- **Tiny footprint:** Core module under 15KB gzipped. Tree-shakeable. No runtime dependencies.
- **AI-native:** Ships with an MCP server so AI agents can invoke compute primitives directly.

### 4.2 Compute Path Selection

The library automatically selects the optimal compute backend:

| Priority    | Backend               | Condition                                   | Best For                                                          |
| ----------- | --------------------- | ------------------------------------------- | ----------------------------------------------------------------- |
| 1 (fastest) | WebGPU Compute Shader | `navigator.gpu` available + device acquired | Parallel: binning, density, spatial indexing (>100K points)       |
| 2           | WASM + SIMD           | `WebAssembly.validate(simd)` passes         | Sequential: LTTB, streaming agg, sorted transforms (<500K points) |
| 3           | WASM (scalar)         | WebAssembly supported                       | Universal fallback; ~2–4x slower than SIMD                        |
| 4 (slowest) | JS polyfill           | Always                                      | Emergency fallback; feature-complete but slow                     |

> Thresholds are configurable. Users can force a specific backend via options.

### 4.3 Module Architecture

| Module                 | Description                                                | Compute Path         |
| ---------------------- | ---------------------------------------------------------- | -------------------- |
| `@vizcrush/core`       | Device detection, backend selection, typed-array utilities | JS                   |
| `@vizcrush/downsample` | LTTB, MinMaxLTTB, M4, LTOB algorithms                      | WASM+SIMD primary    |
| `@vizcrush/bin`        | 1D/2D histogram binning, heatmap density grids             | WebGPU primary       |
| `@vizcrush/spatial`    | Quadtree, kd-tree build + range/nearest queries            | WebGPU primary       |
| `@vizcrush/aggregate`  | Streaming min/max/mean/percentile over typed arrays        | WASM+SIMD primary    |
| `@vizcrush/transform`  | Sort, filter, project, normalize on typed arrays           | WASM+SIMD primary    |
| `@vizcrush/mcp-server` | MCP server exposing all algorithms as AI-agent tools       | TypeScript (MCP SDK) |

### 4.4 Project Structure

```
vizcrush/
├── crates/
│   ├── vizcrush-core/          # Rust core: backend detection, shared types
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── detect.rs         # Feature detection (SIMD, SharedArrayBuffer)
│   │   │   └── types.rs          # Shared typed-array wrappers
│   │   └── Cargo.toml
│   ├── vizcrush-downsample/    # Rust: LTTB, MinMaxLTTB, M4, LTOB
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── lttb.rs           # LTTB with SIMD acceleration
│   │   │   ├── minmax_lttb.rs    # MinMax pre-selection + LTTB
│   │   │   ├── m4.rs             # Min-max per pixel bucket
│   │   │   └── ltob.rs           # Largest-Triangle-One-Bucket
│   │   └── Cargo.toml
│   ├── vizcrush-bin/           # Rust: histogram, bin2d (WASM path)
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── histogram.rs      # 1D binning
│   │   │   ├── bin2d.rs          # 2D density grid (WASM fallback)
│   │   │   └── hexbin.rs         # Hexagonal binning
│   │   └── Cargo.toml
│   ├── vizcrush-spatial/       # Rust: quadtree, kd-tree (WASM path)
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── quadtree.rs       # Quadtree build + query
│   │   │   └── kdtree.rs         # kd-tree (future)
│   │   └── Cargo.toml
│   ├── vizcrush-aggregate/     # Rust: streaming stats, percentiles
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── stats.rs          # min/max/mean/stddev
│   │   │   ├── streaming.rs      # Rolling window accumulator
│   │   │   └── percentile.rs     # t-digest approximate percentiles
│   │   └── Cargo.toml
│   └── vizcrush-transform/     # Rust: sort, filter, normalize
│       ├── src/
│       │   ├── lib.rs
│       │   ├── sort.rs           # Radix sort on typed arrays
│       │   ├── normalize.rs      # Min-max normalization
│       │   └── filter.rs         # Range filter without copy
│       └── Cargo.toml
├── packages/
│   ├── core/                     # TypeScript: init, detect, re-exports
│   │   ├── src/
│   │   │   ├── index.ts          # Main entry: init(), detect capabilities
│   │   │   ├── backend.ts        # Backend selection logic
│   │   │   └── types.ts          # Public TypeScript types
│   │   ├── package.json          # @vizcrush/core
│   │   └── tsconfig.json
│   ├── downsample/               # TypeScript bindings for downsample crate
│   │   ├── src/
│   │   │   ├── index.ts          # lttb(), minMaxLttb(), m4(), ltob()
│   │   │   └── wasm.ts           # WASM loader + SIMD detection
│   │   └── package.json          # @vizcrush/downsample
│   ├── bin/                      # TypeScript bindings + WebGPU shaders
│   │   ├── src/
│   │   │   ├── index.ts          # bin1d(), bin2d(), hexbin()
│   │   │   ├── wasm.ts           # WASM fallback path
│   │   │   └── shaders/
│   │   │       ├── bin2d.wgsl    # WebGPU compute shader for 2D binning
│   │   │       └── hexbin.wgsl   # WebGPU compute shader for hex binning
│   │   └── package.json          # @vizcrush/bin
│   ├── spatial/                  # TypeScript bindings + WebGPU shaders
│   │   ├── src/
│   │   │   ├── index.ts          # buildQuadtree(), queryRange(), queryNearest()
│   │   │   ├── wasm.ts           # WASM fallback path
│   │   │   └── shaders/
│   │   │       └── quadtree.wgsl # WebGPU compute shader for tree construction
│   │   └── package.json          # @vizcrush/spatial
│   ├── aggregate/                # TypeScript bindings
│   │   ├── src/
│   │   │   └── index.ts          # streamingStats(), percentile(), sketches
│   │   └── package.json          # @vizcrush/aggregate
│   ├── transform/                # TypeScript bindings
│   │   ├── src/
│   │   │   └── index.ts          # sortBy(), normalize(), filterRange()
│   │   └── package.json          # @vizcrush/transform
│   └── mcp-server/               # MCP server (TypeScript, MCP SDK)
│       ├── src/
│       │   ├── index.ts          # Server entry: register tools, start transport
│       │   ├── tools/
│       │   │   ├── downsample.ts # vizcrush_lttb, vizcrush_minmax_lttb, vizcrush_auto_downsample
│       │   │   ├── bin.ts        # vizcrush_bin2d, vizcrush_histogram
│       │   │   ├── spatial.ts    # vizcrush_build_index, vizcrush_query_range
│       │   │   ├── stats.ts      # vizcrush_stats, vizcrush_normalize, vizcrush_sort
│       │   │   └── utils.ts      # vizcrush_capabilities, vizcrush_benchmark
│       │   ├── prompts/
│       │   │   ├── optimize_chart.ts    # Pre-built workflow: analyze + recommend
│       │   │   ├── profile_data.ts      # Pre-built workflow: stats + suggest viz
│       │   │   └── migration_guide.ts   # Pre-built workflow: replace CPU code
│       │   └── schemas.ts        # Zod schemas for all tool inputs/outputs
│       ├── package.json          # @vizcrush/mcp-server
│       └── tsconfig.json
├── benchmarks/
│   ├── lttb.bench.ts             # LTTB: JS vs WASM vs WASM+SIMD at 100K/500K/1M/5M
│   ├── bin2d.bench.ts            # bin2d: JS vs WASM vs WebGPU at various sizes
│   ├── quadtree.bench.ts         # Quadtree build + query benchmarks
│   └── runner.ts                 # Benchmark harness with Playwright + Chrome
├── examples/
│   ├── chartgpu-integration/     # vizcrush + Chart.js (legacy URL retained)
│   ├── d3-large-scatter/         # vizcrush + D3 for 1M-point scatter
│   ├── streaming-dashboard/      # Real-time data with streamingStats + lttb
│   └── mcp-demo/                 # Screen recording of AI agent using MCP tools
├── scripts/
│   ├── build-wasm.sh             # Rust → WASM+SIMD compilation
│   ├── build-all.sh              # Full monorepo build
│   └── publish.sh                # npm publish for all packages
├── Cargo.toml                    # Workspace root
├── pnpm-workspace.yaml           # pnpm monorepo config
├── turbo.json                    # Turborepo pipeline config
├── .github/
│   └── workflows/
│       ├── ci.yml                # Build + test + benchmark on PR
│       └── release.yml           # Publish to npm + crates.io on tag
├── README.md
├── CONTRIBUTING.md
└── LICENSE
```

### 4.5 Build Pipeline

```bash
# 1. Build Rust → WASM+SIMD
RUSTFLAGS="-C target-feature=+simd128" cargo build \
  --target wasm32-unknown-unknown --release

# 2. Optimize WASM binary
wasm-opt -O3 --enable-simd target/wasm32-unknown-unknown/release/*.wasm -o out/

# 3. Generate TypeScript bindings
wasm-bindgen --target web --out-dir packages/*/src/generated/ out/*.wasm

# 4. Build TypeScript packages
pnpm turbo build

# 5. Build MCP server
cd packages/mcp-server && pnpm build
```

### 4.6 Key Rust Dependencies

```toml
# Cargo.toml (workspace)
[workspace]
members = ["crates/*"]
resolver = "2"

[workspace.dependencies]
wasm-bindgen = "0.2"
js-sys = "0.3"
web-sys = { version = "0.3", features = ["GpuDevice", "GpuBuffer", "GpuComputePipeline"] }
serde = { version = "1.0", features = ["derive"] }
serde-wasm-bindgen = "0.6"

# SIMD: use core::arch::wasm32::* intrinsics directly
# No external SIMD crate needed — Rust's std::arch::wasm32 provides all SIMD128 intrinsics
```

### 4.7 Key TypeScript Dependencies

```json
{
  "dependencies": {},
  "devDependencies": {
    "typescript": "^5.4",
    "@modelcontextprotocol/sdk": "latest",
    "zod": "^3.22",
    "wasm-pack": "^0.13",
    "vitest": "^2.0",
    "playwright": "^1.44",
    "@webgpu/types": "^0.1"
  }
}
```

---

## 5. API Specification

### 5.1 Initialization

```typescript
import { init } from "@vizcrush/core";

const gpu = await init();
console.log(gpu.backend); // 'webgpu' | 'wasm-simd' | 'wasm' | 'js'
console.log(gpu.capabilities); // { webgpu: true, wasmSimd: true, wasm: true }
```

### 5.2 Downsampling APIs

All downsampling functions accept typed arrays and return typed arrays. No object allocation on the hot path.

```typescript
import { lttb, minMaxLttb, m4, ltob } from "@vizcrush/downsample";

// LTTB: Largest-Triangle-Three-Buckets — preserves visual shape
const result = lttb(xFloat64Array, yFloat64Array, 1000);
// result: { x: Float64Array, y: Float64Array }

// MinMaxLTTB: Better for spiky data (financial, IoT)
const result2 = minMaxLttb(x, y, 1000);

// M4: Min-max per pixel bucket — 4 points per bucket
const result3 = m4(x, y, 1000);

// LTOB: Simpler, slightly less accurate
const result4 = ltob(x, y, 1000);
```

| Function     | Signature                                                            | Description                                                  |
| ------------ | -------------------------------------------------------------------- | ------------------------------------------------------------ |
| `lttb`       | `lttb(x: Float64Array, y: Float64Array, n: number) → { x, y }`       | Largest-Triangle-Three-Buckets; preserves visual shape       |
| `minMaxLttb` | `minMaxLttb(x: Float64Array, y: Float64Array, n: number) → { x, y }` | MinMax pre-selection + LTTB; better for spiky data           |
| `m4`         | `m4(x: Float64Array, y: Float64Array, n: number) → { x, y }`         | Min-max per pixel bucket; 4 points per bucket                |
| `ltob`       | `ltob(x: Float64Array, y: Float64Array, n: number) → { x, y }`       | Largest-Triangle-One-Bucket; simpler, slightly less accurate |

### 5.3 Binning APIs

```typescript
import { bin1d, bin2d, hexbin } from "@vizcrush/bin";

// 1D histogram
const counts = bin1d(data, 50); // Uint32Array[50]

// 2D density grid (heatmap) — runs on WebGPU compute shader
const { grid, xEdges, yEdges } = await bin2d(x, y, {
  xBins: 256,
  yBins: 256,
  backend: "webgpu",
});
// grid is Uint32Array[65536] — pass to any heatmap renderer

// Hexagonal binning
const hexResult = hexbin(x, y, 10); // radius=10
```

| Function | Signature                                                                   | Description                           |
| -------- | --------------------------------------------------------------------------- | ------------------------------------- |
| `bin1d`  | `bin1d(data: Float64Array, bins: number, range?: [min, max]) → Uint32Array` | 1D histogram counts                   |
| `bin2d`  | `bin2d(x: Float64Array, y: Float64Array, opts) → { grid, xEdges, yEdges }`  | 2D density grid for heatmaps          |
| `hexbin` | `hexbin(x: Float64Array, y: Float64Array, radius: number) → HexBinResult`   | Hexagonal binning for scatter density |

### 5.4 Spatial Indexing APIs

```typescript
import { buildQuadtree, queryRange, queryNearest } from "@vizcrush/spatial";

const tree = await buildQuadtree(xArray, yArray); // GPU-built spatial index

// Find all points in viewport
const indices = queryRange(tree, { xMin: 0, xMax: 100, yMin: 0, yMax: 100 });
// indices: Uint32Array of matching point indices

// k-nearest neighbors
const nearest = queryNearest(tree, 50, 50, 10); // px=50, py=50, k=10
```

| Function        | Signature                                                          | Description                           |
| --------------- | ------------------------------------------------------------------ | ------------------------------------- |
| `buildQuadtree` | `buildQuadtree(x: Float64Array, y: Float64Array) → QuadtreeHandle` | GPU-built spatial index               |
| `queryRange`    | `queryRange(tree: QuadtreeHandle, bbox: BBox) → Uint32Array`       | All point indices within bounding box |
| `queryNearest`  | `queryNearest(tree: QuadtreeHandle, px, py, k) → Uint32Array`      | k-nearest neighbor indices            |

### 5.5 Streaming Aggregation APIs

```typescript
import { streamingStats, percentile } from "@vizcrush/aggregate";
import { lttb } from "@vizcrush/downsample";

// Rolling stats window
const acc = streamingStats(1000); // window of 1000
acc.push(newDataChunk);
console.log(acc.mean, acc.min, acc.max, acc.stdDev);

// For chart history, keep the series yourself and downsample it directly.
// appendAndDownsample() throws: it never retained sample history.
const { x, y } = await lttb(historyX, historyY, 1000);

// Exact percentiles (sorts the input)
const pcts = percentile(data, [25, 50, 75, 95, 99]); // Float64Array[5]
```

| Function              | Signature                                                    | Description                                                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `streamingStats`      | `streamingStats(windowSize: number) → StatsAccumulator`      | Rolling min/max/mean/stddev                                                                                                                                                                              |
| `appendAndDownsample` | `appendAndDownsample(...) → throws`                          | **Removed.** Never implemented: it returned array indices, not data. Keep history in application state and call `lttb()` from `@vizcrush/downsample`.                                                    |
| `percentile`          | `percentile(data: Float64Array, p: number[]) → Float64Array` | Exact percentiles, via sorting. Approximate t-digest-backed percentiles are v0.4.0 roadmap (§ below), not yet wired to this function — `TDigest` exists in `vizcrush-aggregate` but has no caller today. |

### 5.6 Transform APIs

```typescript
import { sortBy, normalize, filterRange } from "@vizcrush/transform";

const sorted = sortBy(data, keys); // Radix sort — WASM accelerated
const normed = normalize(data); // Min-max → [0, 1]
const slice = filterRange(x, y, 10, 50); // Extract viewport without full copy
```

| Function      | Signature                                                              | Description                                       |
| ------------- | ---------------------------------------------------------------------- | ------------------------------------------------- |
| `sortBy`      | `sortBy(data: Float64Array, keys: Float64Array) → Float64Array`        | Radix sort on typed arrays (WASM)                 |
| `normalize`   | `normalize(data: Float64Array, range?: [min, max]) → Float64Array`     | Min-max normalization to [0, 1]                   |
| `filterRange` | `filterRange(x: Float64Array, y: Float64Array, xMin, xMax) → { x, y }` | Extract viewport slice without copying full array |

### 5.7 Error Handling

The library never throws on missing capabilities. It degrades gracefully:

```typescript
const gpu = await init();
if (!gpu.capabilities.webgpu) {
  console.warn("WebGPU unavailable; using WASM+SIMD");
}
// All functions still work — just on a slower backend
```

---

## 6. Performance Targets

> **Aspirational, not measured.** These were the design targets when this spec
> was written. The WebGPU column was never built, and measured WASM behavior
> differs (see ADR 0002/0003 and `benchmarks/results/`). Kept for the record.

| Operation             | Data Size              | JS Baseline | WASM+SIMD Target | WebGPU Target    | Speedup Goal |
| --------------------- | ---------------------- | ----------- | ---------------- | ---------------- | ------------ |
| LTTB downsample       | 1M → 1K points         | ~85ms       | ~8ms             | N/A (sequential) | 10x          |
| MinMaxLTTB            | 1M → 1K points         | ~120ms      | ~12ms            | N/A              | 10x          |
| bin2d (heatmap)       | 1M points, 256×256     | ~200ms      | ~30ms            | ~4ms             | 50x (GPU)    |
| Quadtree build        | 1M points              | ~350ms      | ~50ms            | ~8ms             | 40x (GPU)    |
| Quadtree range query  | 1M points, 1% viewport | ~15ms       | ~3ms             | ~0.5ms           | 30x (GPU)    |
| Streaming append+LTTB | 10K append to 1M       | ~90ms       | ~6ms             | N/A              | 15x          |
| sort (radix)          | 1M Float64             | ~180ms      | ~20ms            | ~5ms             | 35x (GPU)    |

> N/A = algorithm is inherently sequential; WASM+SIMD is the optimal path.

---

## 7. MCP Server Specification

### 7.1 Why an MCP Server

In 2026, the dominant way developers discover and use libraries is through AI coding assistants. An MCP server transforms vizcrush from a library developers must learn into a capability AI agents can invoke directly.

| Without MCP                           | With MCP                                            |
| ------------------------------------- | --------------------------------------------------- |
| Developer reads vizcrush docs         | Developer says: "downsample this data to 1K points" |
| Developer writes import + init code   | AI agent calls `vizcrush_lttb` tool automatically   |
| Developer debugs typed array handling | Agent handles data format conversion                |
| 15–30 minutes to first result         | 15–30 seconds to first result                       |

### 7.2 MCP Server Identity

| Attribute     | Value                             |
| ------------- | --------------------------------- |
| npm package   | `@vizcrush/mcp-server`            |
| Binary name   | `vizcrush-mcp-server`             |
| Tool prefix   | `vizcrush_`                       |
| Transport     | stdio (default) + streamable HTTP |
| Config format | Standard MCP JSON config          |

### 7.3 MCP Tool Definitions

#### Downsampling Tools

**`vizcrush_lttb`** — Downsample time-series data using Largest-Triangle-Three-Buckets.

| Parameter       | Type                                      | Required | Description                                         |
| --------------- | ----------------------------------------- | -------- | --------------------------------------------------- |
| `x`             | `number[]`                                | Yes      | X values (timestamps). Must be strictly increasing. |
| `y`             | `number[]`                                | Yes      | Y values (metrics). Same length as x.               |
| `target_points` | `number`                                  | Yes      | Desired output count                                |
| `backend`       | `"auto" \| "wasm-simd" \| "wasm" \| "js"` | No       | Force a specific compute backend. Default: "auto"   |

Returns: `{ x: number[], y: number[], original_length: number, algorithm: "lttb", backend_used: string, elapsed_ms: number }`
Annotations: `readOnlyHint: true, destructiveHint: false, idempotentHint: true`

**`vizcrush_minmax_lttb`** — MinMax pre-selection + LTTB. Better for spiky data. Same parameters as `vizcrush_lttb`.

**`vizcrush_auto_downsample`** — Intelligently selects the best downsampling algorithm based on data characteristics.

| Parameter       | Type                                                    | Required | Description                  |
| --------------- | ------------------------------------------------------- | -------- | ---------------------------- |
| `x`             | `number[]`                                              | Yes      | X values                     |
| `y`             | `number[]`                                              | Yes      | Y values                     |
| `target_points` | `number`                                                | Yes      | Desired output count         |
| `data_hint`     | `"time_series" \| "scatter" \| "financial" \| "sensor"` | No       | Hint for algorithm selection |

Selection logic: `time_series → LTTB`, `financial/sensor → MinMaxLTTB`, `scatter → M4`.

#### Binning Tools

**`vizcrush_bin2d`** — Compute a 2D density grid (heatmap) from scatter data. Runs on WebGPU compute shaders.

| Parameter | Type               | Required | Description                   |
| --------- | ------------------ | -------- | ----------------------------- |
| `x`       | `number[]`         | Yes      | X coordinates                 |
| `y`       | `number[]`         | Yes      | Y coordinates                 |
| `x_bins`  | `number`           | No       | Horizontal bins. Default: 256 |
| `y_bins`  | `number`           | No       | Vertical bins. Default: 256   |
| `x_range` | `[number, number]` | No       | Custom x range. Default: auto |
| `y_range` | `[number, number]` | No       | Custom y range. Default: auto |

Returns: `{ grid: number[][], x_edges: number[], y_edges: number[], max_count: number, elapsed_ms: number }`

**`vizcrush_histogram`** — 1D histogram binning.

| Parameter | Type               | Required | Description                       |
| --------- | ------------------ | -------- | --------------------------------- |
| `data`    | `number[]`         | Yes      | Input values                      |
| `bins`    | `number`           | No       | Number of bins. Default: 50       |
| `range`   | `[number, number]` | No       | Custom range. Default: [min, max] |

#### Spatial Indexing Tools

**`vizcrush_build_index`** — Build a spatial index (quadtree) over 2D point data.

| Parameter  | Type       | Required | Description                   |
| ---------- | ---------- | -------- | ----------------------------- |
| `x`        | `number[]` | Yes      | X coordinates                 |
| `y`        | `number[]` | Yes      | Y coordinates                 |
| `index_id` | `string`   | No       | Custom ID. Default: auto UUID |

Returns: `{ index_id: string, point_count: number, bounds: { x_min, x_max, y_min, y_max }, elapsed_ms: number }`

**`vizcrush_query_range`** — Find all points within a bounding box.

| Parameter  | Type     | Required | Description         |
| ---------- | -------- | -------- | ------------------- |
| `index_id` | `string` | Yes      | ID from build_index |
| `x_min`    | `number` | Yes      | Left bound          |
| `x_max`    | `number` | Yes      | Right bound         |
| `y_min`    | `number` | Yes      | Bottom bound        |
| `y_max`    | `number` | Yes      | Top bound           |

Returns: `{ indices: number[], count: number, elapsed_ms: number }`

#### Statistics & Transform Tools

**`vizcrush_stats`** — Compute summary statistics over a numeric array.

| Parameter     | Type       | Required | Description                           |
| ------------- | ---------- | -------- | ------------------------------------- |
| `data`        | `number[]` | Yes      | Input values                          |
| `percentiles` | `number[]` | No       | Percentiles to compute. Default: [50] |

Returns: `{ count, min, max, mean, std_dev, percentiles: { p25, p50, ... }, elapsed_ms }`

**`vizcrush_normalize`** — Min-max normalize to [0, 1]. Params: `{ data: number[] }`

**`vizcrush_sort`** — Radix sort on large numeric arrays. Params: `{ data: number[], descending?: boolean }`

#### Utility Tools

**`vizcrush_capabilities`** — Report environment GPU/WASM capabilities. No parameters.

Returns: `{ webgpu: boolean, wasm_simd: boolean, wasm: boolean, gpu_adapter: string | null, max_buffer_size: number }`
Annotations: `readOnlyHint: true`

**`vizcrush_benchmark`** — Quick benchmark comparing backends on user's hardware.

| Parameter    | Type       | Required | Description                                         |
| ------------ | ---------- | -------- | --------------------------------------------------- |
| `data_size`  | `number`   | No       | Points to benchmark. Default: 100000                |
| `algorithms` | `string[]` | No       | Algorithms to benchmark. Default: ["lttb", "bin2d"] |

### 7.4 MCP Prompts (Pre-built Workflows)

| Prompt Name                | Description                                                  | When Agent Uses It                               |
| -------------------------- | ------------------------------------------------------------ | ------------------------------------------------ |
| `vizcrush_optimize_chart`  | Analyze dataset and recommend optimal downsampling strategy  | Developer: "optimize this chart for performance" |
| `vizcrush_profile_data`    | Run stats, detect data shape, suggest best visualization     | Developer: "help me visualize this data"         |
| `vizcrush_migration_guide` | Generate code replacing CPU-bound downsampling with vizcrush | Developer: "speed up my dashboard"               |

### 7.5 MCP Server Configuration

**Claude Code / Claude Desktop** — `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "vizcrush": {
      "command": "npx",
      "args": ["-y", "@vizcrush/mcp-server"],
      "env": {}
    }
  }
}
```

**Cursor** — `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "vizcrush": {
      "command": "npx",
      "args": ["-y", "@vizcrush/mcp-server"]
    }
  }
}
```

**VS Code** — `.vscode/mcp.json`:

```json
{
  "servers": {
    "vizcrush": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@vizcrush/mcp-server"]
    }
  }
}
```

**Remote HTTP mode:**

```bash
npx @vizcrush/mcp-server --transport http --port 3847
# Server running at http://localhost:3847/mcp
```

---

## 8. Current Verification

The original strategy named tools that were never installed. The repository now verifies these concrete seams:

| Layer             | Tool                                              | Scope                                                                                    |
| ----------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Rust              | `cargo fmt`, `clippy`, `cargo test`               | Algorithm correctness, edge cases, and WASM compilation                                  |
| TypeScript        | Vitest                                            | Public package behavior, property tests, kernel parity, and MCP protocol round-trips     |
| Packaged browsers | Playwright                                        | Freshly packed npm artifacts executing real WASM and JS in Chromium, Firefox, and WebKit |
| Bundler           | Vite fixture                                      | Emitted WASM asset and statically analyzable package self-import                         |
| Performance       | Deterministic Node runner                         | Shipped JS cores compared with a reviewed baseline; shared-runner threshold is 75%       |
| Security          | `pnpm audit`, `cargo audit`, MCP regression tests | Dependency advisories, file-policy escapes, authentication, and streamed body limits     |

`cargo-fuzz`, BrowserStack, and a 10% shared-runner performance gate remain unimplemented; this document no longer presents them as shipped.

---

## 9. Roadmap

> Timelines below are the original planning dates, kept for the record.

| Version          | Timeline       | Current status             | Original scope                                                                                                                              |
| ---------------- | -------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **v0.1.0 (MVP)** | April 2026     | Shipped, corrected by ADRs | LTTB + MinMaxLTTB + histogram + stats + init/detect. WASM+SIMD only. TypeScript bindings. MCP server. Benchmark suite.                      |
| **v0.2.0**       | June 2026      | Partial                    | bin2d WebGPU, MCP spatial tools, HTTP, and React shipped; WebGPU quadtree/sort did not.                                                     |
| **v0.3.0**       | September 2026 | Partial                    | Streaming aggregation, hexbin, filterRange, and prompts shipped; WebGL fallback and VS Code MCP Apps did not.                               |
| **v0.4.0**       | December 2026  | Partial                    | CSV input and integrations shipped; t-digest/kd-tree remain Rust-only, Arrow input is absent, and SharedArrayBuffer zero-copy was rejected. |
| **v1.0.0**       | Q1 2027        | Partial                    | Packages, docs, performance CI, and MCP resources shipped; “full coverage” and directory listings were not completed claims.                |

> **v1.1+ algorithm expansion:** see §14 (Algorithm Expansion Roadmap) for the post-v1.0 algorithm pipeline — GPU foundation primitives, streaming sketches (DDSketch, KLL, HLL++, Count-Min), GPU M4, Morton/radix sort, spatial hash grid, CUSUM, and transform extensions.

---

## 10. Positioning

vizcrush occupies a gap: rendering libraries (ChartGPU, deck.gl, Plotly) couple
compute to their renderer; buffer libraries (TypeGPU) provide no algorithms.
vizcrush is a standalone data-processing layer — algorithms in, optimized data
out, renderer-agnostic — with an MCP server so AI agents can invoke the same
tools directly.

## 11. (Removed)

_This section held internal launch metrics and competitive-positioning tables —
planning material, not part of the technical spec. Removed before open-sourcing;
section numbering is preserved so cross-references stay valid._

---

## 12. Examples

The `examples/` directory ships with the library and serves two purposes: documentation for developers and integration test cases. Each example is a standalone project that can be run independently.

### 12.1 Example: Financial Time-Series Dashboard

**Directory:** `examples/financial-timeseries/`
**Demonstrates:** LTTB + MinMaxLTTB downsampling, streaming append, backend auto-selection
**Target audience:** Fintech developers building trading dashboards

**Scenario:** A crypto trading dashboard receives 2M historical candlestick data points from an exchange API. The chart needs to render smoothly at 60fps with pan/zoom on a 1920px-wide canvas.

**What the example shows:**

- Loading 2M data points from a static JSON file (included) or generated synthetically
- Downsampling to chart width using `lttb()` and `minMaxLttb()` side-by-side
- Visual comparison: original data (faded) overlaid with downsampled data (bright)
- Interactive controls: data size selector (10K / 100K / 500K / 1M / 2M), target point count (200 / 500 / 1000 / 2000)
- Live performance stats: input points, output points, reduction %, elapsed time, backend used
- Estimated WASM+SIMD speedup vs. measured JS baseline

**Key code pattern:**

```typescript
// examples/financial-timeseries/src/main.ts
import { init } from "@vizcrush/core";
import { lttb, minMaxLttb } from "@vizcrush/downsample";

const gpu = await init();
console.log(`Backend: ${gpu.backend}`); // 'wasm-simd' | 'webgpu' | 'wasm' | 'js'

// Load historical OHLCV data
const response = await fetch("./data/btc-1m-candles.json");
const candles = await response.json();
const timestamps = new Float64Array(candles.map((c) => c.time));
const closes = new Float64Array(candles.map((c) => c.close));

// Downsample to fit chart width
const chartWidth = document.getElementById("chart").clientWidth;
const { x, y } = lttb(timestamps, closes, chartWidth);

// For financial data with spikes, MinMaxLTTB preserves extremes better
const { x: x2, y: y2 } = minMaxLttb(timestamps, closes, chartWidth);

// Feed to any chart library — this example uses Chart.js
const chart = new Chart(ctx, {
  type: "line",
  data: {
    labels: Array.from(x),
    datasets: [
      {
        data: Array.from(y),
        borderColor: "#3B9ECF",
        borderWidth: 1.5,
        pointRadius: 0,
      },
    ],
  },
});

// Re-downsample on resize
window.addEventListener("resize", () => {
  const newWidth = document.getElementById("chart").clientWidth;
  const { x: rx, y: ry } = lttb(timestamps, closes, newWidth);
  chart.data.labels = Array.from(rx);
  chart.data.datasets[0].data = Array.from(ry);
  chart.update("none"); // skip animation for perf
});
```

**File structure:**

```
examples/financial-timeseries/
├── index.html              # Standalone HTML entry
├── src/
│   ├── main.ts             # Core logic: load → downsample → render
│   ├── chart.ts             # Chart.js wrapper with resize handling
│   ├── controls.ts          # Data size / target point selectors
│   └── perf-display.ts      # Stats overlay (points, ms, backend)
├── data/
│   └── generate-data.ts     # Script to generate synthetic BTC-like candle data
├── package.json
└── vite.config.ts
```

---

### 12.2 Example: IoT Sensor Heatmap

**Directory:** `examples/iot-heatmap/`
**Demonstrates:** `bin2d()` for 2D density grids, `stats()` for summary statistics, WebGPU compute path
**Target audience:** IoT platform developers, observability engineers

**Scenario:** A fleet management dashboard has 500K GPS coordinate readings from delivery vehicles over 24 hours. The team needs a density heatmap showing traffic concentration zones, plus statistical summaries.

**What the example shows:**

- Generating 500K clustered scatter points (simulating GPS coordinates with hotspot clusters)
- Computing a 2D density grid with `bin2d()` at configurable resolution (32×32 to 256×256)
- Rendering the density grid as a canvas heatmap with a perceptual color ramp (cool→warm)
- Computing summary statistics with `percentile()` for annotation overlays
- Interactive controls: point count, bin resolution, color scale
- GPU vs. CPU timing comparison

**Key code pattern:**

```typescript
// examples/iot-heatmap/src/main.ts
import { init } from "@vizcrush/core";
import { bin2d } from "@vizcrush/bin";
import { percentile } from "@vizcrush/aggregate";

const gpu = await init();

// Load or generate GPS coordinates
const latitudes = new Float64Array(gpsData.map((p) => p.lat));
const longitudes = new Float64Array(gpsData.map((p) => p.lng));

// Create 256×256 density grid — runs on WebGPU if available
const { grid, xEdges, yEdges, maxCount } = await bin2d(latitudes, longitudes, {
  xBins: 256,
  yBins: 256,
  backend: "auto",
});
// grid: Uint32Array[65536] with count per cell
// maxCount: peak density value for color normalization

// Render to canvas with perceptual color mapping
const canvas = document.getElementById("heatmap") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const cellW = canvas.width / 256;
const cellH = canvas.height / 256;

for (let yi = 0; yi < 256; yi++) {
  for (let xi = 0; xi < 256; xi++) {
    const count = grid[yi * 256 + xi];
    if (count === 0) continue;
    const intensity = Math.pow(count / maxCount, 0.4); // gamma for visibility
    ctx.fillStyle = viridisColorScale(intensity);
    ctx.fillRect(xi * cellW, (255 - yi) * cellH, cellW + 0.5, cellH + 0.5);
  }
}

// Overlay statistics
const temps = new Float64Array(gpsData.map((p) => p.temperature));
const pcts = percentile(temps, [10, 25, 50, 75, 90]);
// Render percentile annotations on chart
```

**File structure:**

```
examples/iot-heatmap/
├── index.html
├── src/
│   ├── main.ts              # Load → bin → render heatmap
│   ├── color-scales.ts       # Viridis, plasma, inferno color ramps
│   ├── canvas-renderer.ts    # Canvas 2D heatmap drawing
│   ├── controls.ts           # Bin resolution / color scale selectors
│   └── stats-overlay.ts      # Percentile annotations
├── data/
│   └── generate-gps.ts       # Generate clustered GPS data
├── package.json
└── vite.config.ts
```

---

### 12.3 Example: Streaming Dashboard

**Directory:** `examples/streaming-dashboard/`
**Demonstrates:** `streamingStats()`, `lttbSync()`, and a bounded rolling view
**Target audience:** Observability/monitoring platform developers

**Scenario:** A monitoring dashboard ingests 1,000 simulated metrics per second. It maintains a 20K-point rolling buffer and continuously downsamples that history to 400 display points. Applications can replace the generator with a WebSocket handler without changing the accumulator or downsampling seam.

**What the example shows:**

- In-browser generator producing 50 points every 50ms (1,000/sec)
- Fixed 20K rolling buffer
- `lttbSync()` over caller-retained history, with `streamingStats()` for the rolling summary
- `streamingStats()` computing rolling min/max/mean/stddev
- Live stat pills for buffer size, total ingested, displayed points, and rolling statistics
- Start/Stop controls for the stream

**Key code pattern:**

```typescript
// examples/streaming-dashboard/src/main.ts
import { init } from "@vizcrush/core";
import { streamingStats } from "@vizcrush/aggregate";
import { lttbSync } from "@vizcrush/downsample";

const gpu = await init();

// Initialize rolling window accumulator
const BUFFER_SIZE = 20_000;
const DISPLAY_POINTS = 400;
const acc = streamingStats(BUFFER_SIZE);

function renderHistory(history: number[], firstTimestamp: number) {
  const rawY = Float64Array.from(history);
  const rawX = Float64Array.from(rawY, (_, index) => firstTimestamp + index);
  const sampled =
    rawY.length > DISPLAY_POINTS ? lttbSync(rawX, rawY, DISPLAY_POINTS) : { x: rawX, y: rawY };
  renderChart(sampled.x, sampled.y);
}

setInterval(() => {
  const batch = generateMetrics(50);
  acc.pushBatch(batch);
  appendToRollingHistory(batch, BUFFER_SIZE);
  renderHistory(history, totalIngested - history.length);
}, 50);
```

**File structure:**

```
examples/streaming-dashboard/
├── index.html
├── src/
│   └── main.ts              # generator → rolling stats/LTTB → Canvas 2D
├── README.md
├── package.json
└── vite.config.ts
```

---

### 12.4 Example: Chart.js Integration

**Directory:** `examples/chartgpu-integration/`
**Demonstrates:** Using vizcrush as a preprocessing layer for Chart.js rendering
**Target audience:** Chart.js users who need to render datasets larger than the chart should receive directly

**Scenario:** A developer is already using Chart.js for interaction and axes but has too much raw data to render efficiently. vizcrush handles the data reduction, and Chart.js handles the chart.

**Key code pattern:**

```typescript
// examples/chartgpu-integration/src/main.ts
import { init } from "@vizcrush/core";
import { lttb } from "@vizcrush/downsample";
import { bin2d } from "@vizcrush/bin";
import Chart from "chart.js/auto";

const gpu = await init();

// ── Line chart with LTTB downsampling ──
const rawTimestamps = new Float64Array(/* 1M points */);
const rawValues = new Float64Array(/* 1M points */);

const { x, y } = await lttb(rawTimestamps, rawValues, 2000);

new Chart(document.querySelector("#line-chart canvas"), {
  type: "line",
  data: {
    datasets: [
      {
        label: "CPU usage",
        data: Array.from(x, (xi, i) => ({ x: xi, y: y[i] })),
        pointRadius: 0,
      },
    ],
  },
  options: { parsing: false, animation: false },
});

// ── Scatter density with bin2d preprocessing ──
const scatterX = new Float64Array(/* 500K points */);
const scatterY = new Float64Array(/* 500K points */);

const { grid, xEdges, yEdges, maxCount } = await bin2d(scatterX, scatterY, {
  xBins: 128,
  yBins: 128,
});

// Convert density grid to a much smaller Chart.js scatter dataset
const densityPoints = [];
for (let yi = 0; yi < 128; yi++) {
  for (let xi = 0; xi < 128; xi++) {
    const count = grid[yi * 128 + xi];
    if (count > 0) {
      densityPoints.push({ x: xEdges[xi], y: yEdges[yi], count });
    }
  }
}

new Chart(document.querySelector("#scatter-chart canvas"), {
  type: "scatter",
  data: { datasets: [{ data: densityPoints }] },
  options: { parsing: false, animation: false },
});
```

**File structure:**

```
examples/chartgpu-integration/
├── index.html
├── src/
│   ├── main.ts              # vizcrush preprocessing → Chart.js rendering
│   ├── line-chart.ts         # LTTB → line chart
│   └── scatter-density.ts    # bin2d → scatter density
├── package.json             # depends on both vizcrush + Chart.js
└── vite.config.ts
```

---

### 12.5 Example: D3.js Large Scatter Plot

**Directory:** `examples/d3-large-scatter/`
**Demonstrates:** `buildQuadtree()`, `queryRange()`, viewport-based rendering with spatial indexing
**Target audience:** D3 developers hitting performance limits with large datasets

**Scenario:** A research dashboard has 1M data points from a genomics experiment. D3's built-in quadtree is too slow to rebuild on every pan/zoom. vizcrush builds the spatial index once (on GPU) and handles viewport queries in sub-millisecond time.

**Key code pattern:**

```typescript
// examples/d3-large-scatter/src/main.ts
import { init } from "@vizcrush/core";
import { buildQuadtree, queryRange } from "@vizcrush/spatial";
import * as d3 from "d3";

const gpu = await init();

// Build spatial index once — runs on WebGPU (~8ms for 1M points)
const xData = new Float64Array(/* 1M x coordinates */);
const yData = new Float64Array(/* 1M y coordinates */);
const tree = await buildQuadtree(xData, yData);

// D3 zoom handler: query only visible points
const zoom = d3.zoom().on("zoom", (event) => {
  const transform = event.transform;
  const [x0, x1] = xScale.domain();
  const [y0, y1] = yScale.domain();

  // Sub-millisecond range query via GPU spatial index
  const visibleIndices = queryRange(tree, {
    xMin: x0,
    xMax: x1,
    yMin: y0,
    yMax: y1,
  });
  // visibleIndices: Uint32Array of point indices in viewport

  // Render only visible points with D3
  const visibleData = Array.from(visibleIndices).map((i) => ({
    x: xData[i],
    y: yData[i],
  }));

  // D3 binds only what's visible — fast even with 1M total points
  const circles = svg.selectAll("circle").data(visibleData, (d, i) => i);

  circles
    .enter()
    .append("circle")
    .attr("r", 2)
    .attr("fill", "#3B9ECF")
    .attr("opacity", 0.6)
    .merge(circles)
    .attr("cx", (d) => xScale(d.x))
    .attr("cy", (d) => yScale(d.y));

  circles.exit().remove();
});
```

**File structure:**

```
examples/d3-large-scatter/
├── index.html
├── src/
│   ├── main.ts              # Build index → zoom handler → D3 render
│   ├── scales.ts             # D3 scales with domain tracking
│   └── data-generator.ts     # Generate 1M genomics-like scatter data
├── package.json             # depends on vizcrush + d3
└── vite.config.ts
```

---

### 12.6 Example: MCP Agent Demo

**Directory:** `examples/mcp-demo/`
**Demonstrates:** The MCP server in action with AI coding agents
**Target audience:** Developers evaluating the MCP integration, content for launch blog/video

**This is not a runnable app** — it's a recording script + annotated transcript showing how an AI agent uses vizcrush tools during a real coding session.

**Scenario transcript:**

```
👤 Developer (in Cursor):
"I have 2M data points from our IoT sensors. The dashboard chart is
freezing when users try to zoom. Can you fix the performance?"

🧠 Agent reasoning:
2M points is too many for direct rendering. I'll check what compute
capabilities are available, then use vizcrush to downsample for
the chart width and bin2d for the overview heatmap.

⚡ MCP Tool Call: vizcrush_capabilities()
→ { webgpu: true, wasm_simd: true, gpu_adapter: "Apple M2" }

⚡ MCP Tool Call: vizcrush_auto_downsample(x, y, 1920, data_hint: "sensor")
→ { algorithm: "minmax_lttb", original_length: 2000000,
    output_length: 1920, backend_used: "wasm-simd", elapsed_ms: 16.2 }

⚡ MCP Tool Call: vizcrush_bin2d(x, y, x_bins: 256, y_bins: 256)
→ { grid: Uint32Array[65536], max_count: 847,
    backend_used: "webgpu", elapsed_ms: 3.8 }

🤖 Agent response:
"Done! I've optimized your dashboard with two changes:

1. Time-series chart: MinMaxLTTB downsampling
   2M → 1,920 points in 16ms (preserves sensor spikes)

2. Overview heatmap: 2D binning on WebGPU
   Full dataset processed in 3.8ms

Total processing time: 20ms. Dashboard now runs at 60fps."
```

**File structure:**

```
examples/mcp-demo/
├── README.md                # Full annotated transcript (above)
├── recording.gif            # Screen recording of the agent session
├── mcp-config-cursor.json   # Copy-paste config for Cursor
├── mcp-config-claude.json   # Copy-paste config for Claude Code
├── mcp-config-vscode.json   # Copy-paste config for VS Code
└── scenarios/
    ├── trading-dashboard.md  # Financial data scenario transcript
    ├── iot-sensors.md        # IoT scenario transcript (above)
    └── observability.md      # Server monitoring scenario transcript
```

---

### 12.7 Example: Benchmark Suite

**Directory:** `benchmarks/`
**Demonstrates:** Performance measurement infrastructure, used for launch blog content and CI regression testing

**What it measures:**

- LTTB: JS baseline vs. WASM vs. WASM+SIMD at 100K / 500K / 1M / 5M points
- MinMaxLTTB: same size ladder
- bin2d: JS vs. WASM vs. WebGPU at 100K / 500K / 1M with grid sizes 64² / 128² / 256²
- Quadtree build: JS vs. WASM vs. WebGPU at 100K / 500K / 1M
- Quadtree range query: 1% / 5% / 25% / 50% viewport at 1M points
- sort (radix): JS Array.sort vs. WASM radix at 100K / 500K / 1M
- Memory usage: heap snapshots before/after each operation

**Key code pattern:**

```typescript
// benchmarks/lttb.bench.ts
import { init } from "@vizcrush/core";
import { lttb } from "@vizcrush/downsample";

const SIZES = [100_000, 500_000, 1_000_000, 5_000_000];
const TARGET = 1_000;
const RUNS = 100;

const gpu = await init();

for (const size of SIZES) {
  const x = new Float64Array(size);
  const y = new Float64Array(size);
  // Fill with synthetic time-series data
  let val = 0;
  for (let i = 0; i < size; i++) {
    x[i] = i;
    val += (Math.random() - 0.498) * 10;
    y[i] = val;
  }

  // Warmup
  for (let i = 0; i < 5; i++) lttb(x, y, TARGET);

  // Measure
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    lttb(x, y, TARGET);
    times.push(performance.now() - t0);
  }

  times.sort((a, b) => a - b);
  console.log(`LTTB ${size.toLocaleString()} → ${TARGET}:
    median: ${times[Math.floor(RUNS / 2)].toFixed(2)}ms
    p95:    ${times[Math.floor(RUNS * 0.95)].toFixed(2)}ms
    min:    ${times[0].toFixed(2)}ms
    backend: ${gpu.backend}`);
}
```

**Benchmark runner** (uses Playwright for real browser execution):

```typescript
// benchmarks/runner.ts
import { chromium } from "playwright";

const browser = await chromium.launch({
  args: ["--enable-features=WebGPU", "--enable-unsafe-webgpu"],
});
const page = await browser.newPage();
await page.goto("http://localhost:5173/benchmarks/");

// Collect results from console.log output
const results: string[] = [];
page.on("console", (msg) => results.push(msg.text()));

// Wait for all benchmarks to complete
await page.waitForSelector("#benchmark-complete", { timeout: 120_000 });

// Output results as JSON for CI comparison
const output = JSON.parse(results.join("\n"));
fs.writeFileSync("benchmark-results.json", JSON.stringify(output, null, 2));

// Compare against baseline (fail CI if >10% regression)
const baseline = JSON.parse(fs.readFileSync("benchmark-baseline.json", "utf-8"));
for (const [key, value] of Object.entries(output)) {
  const baseVal = baseline[key];
  if (baseVal && value.median > baseVal.median * 1.1) {
    console.error(
      `REGRESSION: ${key} is ${((value.median / baseVal.median - 1) * 100).toFixed(1)}% slower`,
    );
    process.exit(1);
  }
}
```

**File structure:**

```
benchmarks/
├── lttb.bench.ts             # LTTB across sizes and backends
├── minmax-lttb.bench.ts      # MinMaxLTTB benchmarks
├── bin2d.bench.ts             # 2D binning: JS vs WASM vs WebGPU
├── quadtree.bench.ts          # Build + query benchmarks
├── sort.bench.ts              # Radix sort vs Array.sort
├── memory.bench.ts            # Heap snapshot measurements
├── runner.ts                  # Playwright-based benchmark runner
├── compare.ts                 # CI regression comparison script
├── benchmark-baseline.json    # Committed baseline for CI
├── index.html                 # Browser entry for benchmark suite
└── results/
    └── .gitkeep               # Results generated per-run
```

---

### 12.8 Example Summary Table

| Example               | Primary APIs                  | Chart Library | Key Metric Demonstrated            |
| --------------------- | ----------------------------- | ------------- | ---------------------------------- |
| Financial Time-Series | `lttb`, `minMaxLttb`          | Chart.js      | 2M → 1,920 pts in 16ms             |
| IoT Sensor Heatmap    | `bin2d`, `percentile`         | Canvas 2D     | 500K pts → 256² grid in 4ms        |
| Streaming Dashboard   | `lttbSync`, `streamingStats`  | Canvas 2D     | 20K rolling points → 400 displayed |
| Chart.js Integration  | `lttb`, `bin2d`               | Chart.js      | vizcrush as preprocessing layer    |
| D3 Large Scatter      | `buildQuadtree`, `queryRange` | D3.js         | 1M pt viewport query in <1ms       |
| MCP Agent Demo        | MCP tools                     | N/A           | Agent session transcript + configs |
| Benchmark Suite       | All                           | N/A           | CI regression testing              |

---

## 13. Risks and Mitigations

| Risk                                                           | Probability | Mitigation                                                                                     |
| -------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| WebGPU compute shader perf varies across GPU vendors           | High        | Benchmark Intel, AMD, Apple, NVIDIA; document variance; prefer WASM for inconsistent workloads |
| ChartGPU or deck.gl builds their own WASM compute layer        | Medium      | Ship fast; establish as the standard; maintain excellent DX                                    |
| Audience too small for meaningful adoption                     | Medium      | Target specific verticals (fintech, IoT, observability); MCP registries expand reach           |
| WASM+SIMD doesn't deliver dramatic speedups for all algorithms | Medium      | Benchmark before committing; drop sub-3x algorithms from WASM                                  |
| Single-maintainer bus factor                                   | Medium      | Keep scope tight; say no to chart features; grow co-maintainers                                |
| MCP protocol evolves and breaks tool schemas                   | Low         | Pin to stable MCP SDK; follow spec changelog                                                   |

---

## 14. Algorithm Expansion Roadmap

This section captures the planned algorithm additions beyond the v0.1–v1.0 roadmap in Section 9, the rationale for each, and the load-bearing design decisions (portability traps, library opinions, dependency ordering) that future work must respect. Entries are scoped to _what, why, where, dependencies, complexity_ — full API sketches land in per-algorithm PRs, not here. The spec captures decisions; the code captures interfaces.

**Implementation status (August 2026):** reservoir sampling, DDSketch, KLL, HyperLogLog, Count-Min Sketch, Morton ordering, spatial hash grids, CUSUM, log/power transforms, and quantile normalization ship today. GPU scan/segmented reduction/compaction, GPU M4, and GPU radix sort remain future work. Treat the numbered ordering below as historical planning, not a current backlog.

### 14.1 Design Stances

These are the load-bearing opinions that drive the rest of this section. Read them first.

| Stance                             | Decision                                                                                                                                                                                                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quantile sketch default            | **KLL** is the new default for rank-error quantile queries. **DDSketch** is the default for _relative-error_ queries on positive-skewed data (latencies, sizes). **t-digest** stays for backward compatibility and is a deprecation candidate once KLL has shipped and burned in. |
| Cardinality sketch                 | **HLL++** for v1. **CPC** is deferred — implementing both upfront is scope creep for a sketch nobody has asked for yet. HLL++ has more downstream tooling that understands its serialization.                                                                                     |
| Reference implementations          | Apache DataSketches (Java/C++) defines the reference _merge semantics and error-bound documentation_ we match. **No code is lifted** — Apache-2.0 boundaries stay clean.                                                                                                          |
| GPU scan portability               | Default to a **two-pass scan** (per-workgroup scan → scan of block sums → uniform add). **Decoupled-lookback** is opt-in only; it requires forward-progress guarantees WebGPU does not formally provide and can deadlock on some Metal/mobile drivers.                            |
| Segmented reduction is a primitive | **Segmented reduction / segmented scan ships in Tier 1 alongside plain scan.** It is the primitive behind GPU M4 (per-bucket min/max), GPU histogram finalization, and any group-by aggregation. Shipping plain scan alone forces re-invention in three places.                   |
| Reservoir sampling crate placement | Lives in **`vizcrush-aggregate`**, not `vizcrush-downsample`. Streaming primitives over unknown-length input belong with t-digest, Welford, and HLL. Downsample is shape-preserving selection over a known array — mixing the two dilutes both crates' purpose.                   |
| Sketch coexistence                 | Multiple quantile sketches (KLL + DDSketch + t-digest) is intentional, not indecision. The library exposes all three behind a common trait, defaults are documented per data shape, and `vizcrush_auto_downsample`-style hint logic picks one when the user does not.             |

### 14.2 Tier 1 — GPU Foundation Primitives

These primitives unblock everything else on the GPU side. Nothing in Tiers 2–5 with a WebGPU path can ship until Tier 1 lands.

**Parallel prefix sum (scan)** — Workgroup-level and device-level inclusive/exclusive scan in WGSL. Prerequisite for GPU `bin2d`/`bin3d` finalization, GPU radix sort, stream compaction, and GPU histogram bucket assignment. Default implementation is the two-pass Blelloch work-efficient scan (per-workgroup scan → scan of block sums → uniform add); decoupled-lookback (Merrill & Garland) is an opt-in fast path gated behind a capability flag because it requires forward-progress guarantees WebGPU does not formally provide. Lands in `vizcrush-core` as a reusable WGSL include. Complexity: O(n) work, O(log n) depth.

**Segmented reduction / segmented scan** — Per-segment min/max/sum where segment boundaries are described by a flag array or a sorted segment-id array. The primitive behind GPU M4 (per-bucket min/max), histogram finalization across workgroups, and any group-by aggregation kernel. Lands alongside plain scan in `vizcrush-core`. Complexity: O(n) work, O(log n) depth. Caveat: efficient only when average segment length ≥ workgroup size (256); pathologically small segments fall back to one-thread-per-segment.

**Stream compaction** — Scan-driven "keep elements matching a predicate, packed contiguously" kernel. Powers GPU-side viewport filtering and predicate-based subsetting without round-tripping to CPU. Depends on prefix sum. Lands in `vizcrush-core`. Complexity: O(n) work.

### 14.3 Tier 2 — Streaming Sketches (`vizcrush-aggregate` expansion)

**Reservoir sampling (Vitter Algorithm R) + weighted reservoir (Efraimidis–Spirakis A-Res)** — Uniform random sample of size _k_ from a stream of unknown length, in O(k) space per accumulator. The library has shape-preserving downsampling but no statistically representative _sampling_; this gap shows up the moment a user wants a training-set extract, an unbiased scatter thinning, or a preview render. ~20 lines of Rust. Lands in `vizcrush-aggregate`. Complexity: O(1) amortized per item; O(k) space.

**DDSketch** — Mergeable quantile sketch with _relative-error_ guarantees. Complements t-digest rather than replacing it: t-digest gives rank-error bounds, which can allow large _relative_ errors in heavy tails of skewed distributions like latencies. DDSketch's logarithmic bucket mapping bounds relative error directly. Default for positive-skewed data. Lands in `vizcrush-aggregate`. Complexity: O(1) insertion; bounded-memory variant uses a collapsing strategy to cap bucket count.

**KLL sketch** — Mergeable rank-error quantile sketch with provably (near-)optimal space/error tradeoff. Becomes the new default for rank-error quantile queries; t-digest is retained for backward compatibility and is a deprecation candidate after KLL has burned in. Apache DataSketches' KLL is the reference for merge semantics and error-bound documentation. Lands in `vizcrush-aggregate`. Complexity: ε-approximate rank queries with O(1/ε · log²(log(1/δ))) space.

**HyperLogLog++ (HLL++)** — Cardinality estimation for streams. Answers "how many distinct values?" — a question nothing in `vizcrush-aggregate` currently covers but every binning, color-encoding, and legend decision implicitly depends on. ~6 KB for 1% error on billions of distinct items. HLL++ adds Google's small-cardinality bias correction over plain HLL. Lands in `vizcrush-aggregate`. Complexity: O(1) insertion; ~6 KB sketch for 1% error.

**Count-Min sketch** — Streaming frequency estimation and top-K heavy-hitter detection. Pairs naturally with HLL (cardinality) and KLL/DDSketch (distribution shape) to give a complete streaming profile of any data column. Lands in `vizcrush-aggregate`. Complexity: O(1) insertion; configurable width × depth memory budget; one-sided ε-approximate frequency with probability 1−δ.

### 14.4 Tier 3 — GPU Algorithm Acceleration

Tier 3 covers algorithms that depend on Tier 1 primitives and run primarily on the GPU. Most are spatial (`vizcrush-spatial` / `vizcrush-spatial3d`); GPU M4 lives in `vizcrush-downsample` but is grouped here because it shares the Tier 1 dependency and is the validation kernel for the rest of the tier.

**GPU M4 (precedes radix sort intentionally)** — M4 is trivially parallel per bucket (first/last/min/max are independent reductions). It needs only Tier 1 primitives — plain scan plus segmented reduction — and is small enough to validate the GPU compute infrastructure end-to-end before committing to the larger radix-sort effort. Bucket-size assumption: efficient when average bucket length ≥ 256 points (one workgroup per bucket); smaller buckets fall back to a CPU/WASM path or a one-thread-per-bucket kernel. Lands in `vizcrush-downsample`. Complexity: O(n) work, O(log b) depth where b = bucket size.

**Morton-code point ordering** — Z-order linearization of 2D/3D coordinates into a 1D sortable key. Independently useful as a _cache-friendly point ordering_ for any subsequent traversal — ships and earns its keep before the radix-sort dependency lands. Once GPU radix sort exists, Morton ordering becomes the input to GPU-parallel quadtree/octree construction. Lands in `vizcrush-spatial` and `vizcrush-spatial3d`. Complexity: O(n) bit-interleave per point.

**GPU radix sort** — LSB radix sort on `u32` keys (typically Morton codes), implemented over the Tier 1 scan primitive. Enables GPU-native spatial index construction (sorted Morton codes → median splits → tree), GPU sorted-group-by, and any future GPU order-statistics work. kishimisu's WebGPU radix sort is the reference for kernel structure but not a code lift. Lands in `vizcrush-transform` (the kernel) with consumers in `vizcrush-spatial`. Complexity: O(n · k/r) for k-bit keys in r-bit passes.

**Spatial hash grid** — Uniform-cell hash grid (`cell = floor(pos / cellSize)`) for uniform-density point clouds: IoT sensor grids, particle systems, binned heatmaps. O(1) insertion and O(k) neighbor lookup. Much lower implementation and maintenance cost than R-tree, and covers the dense-grid use case better. Add this _before_ R-tree unless geospatial/GIS becomes a concrete roadmap item. Lands in `vizcrush-spatial`. Complexity: O(n) build, O(1) point insert, O(k) neighbor query.

### 14.5 Tier 4 — Streaming Detection & Transforms

**CUSUM (cumulative sum) change-point detection** — Online detector for shifts in the mean of a piecewise-stationary stream. Complements the existing MAD outlier detector in `vizcrush-ai`: MAD flags individual point outliers, CUSUM flags _regime shifts_ when the entire distribution moves. O(1) per observation. Useful for IoT dashboards, financial monitoring, and any "alert when the signal changes character" workflow. Lands in `vizcrush-ai`. Complexity: O(1) state per stream.

**Log / power transform** — Pre-transform kernel for log-normal data (latencies, income, sensor readings) before binning or downsampling. Dramatically improves visual fidelity when raw values span orders of magnitude. Extends the existing `vizcrush-transform` crate. Complexity: O(n).

**Quantile normalization** — Rank-based transform that makes distributions comparable across series in multi-series dashboards. Extends `vizcrush-transform`. Complexity: O(n log n) (sort-bound).

### 14.6 Explicitly Deferred

These are real algorithms with real use cases, deferred because the immediate cost outweighs the immediate value. Re-evaluate when a concrete consumer appears.

| Algorithm                   | Why deferred                                                                                                                                                                                      | Re-evaluate when                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Ramer–Douglas–Peucker (RDP) | Path/polyline simplification, but vizcrush has no trajectory primitive yet. Quadtree/kd-tree already cover scatter and non-monotonic-x cases. Adding RDP without a consumer is speculative scope. | A GPS-trace or polyline example lands in `examples/`.              |
| R-tree / R\*-tree           | Bounding-box and polygon queries are real, but R-tree's maintenance cost is meaningful and the spatial hash grid covers the immediate dense-grid use cases more cheaply.                          | A geospatial/GIS example or downstream consumer is on the roadmap. |
| Multivariate M4             | Interesting extension but **GPU** (univariate) M4 is both easier and higher impact. Multivariate M4 only matters when an example needs correlated downsampling across channels.                   | A correlated multi-series example appears in `examples/`.          |
| CPC sketch                  | More space-efficient than HLL++, but HLL++ ships first to avoid maintaining two cardinality sketches with overlapping coverage and no asked-for need.                                             | HLL++ memory becomes a measured bottleneck for a real user.        |

### 14.7 Priority Ordering

Build order is dependency-driven, then value-driven within each tier. Items in the same tier may ship in parallel if independent.

> **Scheduling callout:** Tier 2 sketches (#4–#8) are CPU/WASM-only and have **no GPU dependencies**. They can ship in parallel with Tier 1 GPU work and are the recommended near-term effort while the GPU primitives are landing.

| #   | Algorithm                              | Crate                            | Tier | Depends on | Rationale                                                                             |
| --- | -------------------------------------- | -------------------------------- | ---- | ---------- | ------------------------------------------------------------------------------------- |
| 1   | Parallel prefix sum (two-pass default) | `vizcrush-core`                  | 1    | —          | Unblocks GPU `bin2d`/`bin3d`, radix sort, stream compaction, segmented scan.          |
| 2   | Segmented reduction / segmented scan   | `vizcrush-core`                  | 1    | #1         | Required by GPU M4, GPU histogram finalize, any group-by kernel.                      |
| 3   | Stream compaction                      | `vizcrush-core`                  | 1    | #1         | Powers GPU-side viewport filter and predicate subsetting.                             |
| 4   | Reservoir sampling (+ A-Res)           | `vizcrush-aggregate`             | 2    | —          | Cheap, fills an obvious gap, immediately useful and CPU-only.                         |
| 5   | DDSketch                               | `vizcrush-aggregate`             | 2    | —          | Relative-error quantile sketch for skewed data; complements t-digest.                 |
| 6   | KLL sketch                             | `vizcrush-aggregate`             | 2    | —          | New default rank-error quantile sketch; t-digest deprecation candidate after burn-in. |
| 7   | HyperLogLog++                          | `vizcrush-aggregate`             | 2    | —          | Cardinality estimation; nothing in the library covers this today.                     |
| 8   | Count-Min sketch                       | `vizcrush-aggregate`             | 2    | —          | Heavy-hitter / frequency estimation; pairs with HLL and KLL/DDSketch.                 |
| 9   | GPU M4                                 | `vizcrush-downsample`            | 3    | #1, #2     | Lowest-hanging GPU downsample kernel; validates Tier 1 end-to-end.                    |
| 10  | Morton-code point ordering             | `vizcrush-spatial`, `-spatial3d` | 3    | —          | Cache-friendly ordering on its own; input to GPU radix sort once #11 lands.           |
| 11  | GPU radix sort                         | `vizcrush-transform`             | 3    | #1, #10    | Enables GPU-parallel spatial index construction and sorted group-by.                  |
| 12  | Spatial hash grid                      | `vizcrush-spatial`               | 3    | —          | Cheap, covers dense-grid use cases better than R-tree.                                |
| 13  | CUSUM change-point detection           | `vizcrush-ai`                    | 4    | —          | Regime-shift detection complementing the existing MAD outlier detector.               |
| 14  | Log/power transform                    | `vizcrush-transform`             | 4    | —          | Pre-transform for log-normal data before binning/downsampling.                        |
| 15  | Quantile normalization                 | `vizcrush-transform`             | 4    | —          | Distribution alignment for multi-series dashboards.                                   |
