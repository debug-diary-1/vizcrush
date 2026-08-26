# Changelog

## Architecture pass (2026-08-13)

### Deep-module cleanup — findings 1, 2, and 5-lite of the August architecture review

- **Parity tests now run through the kernel seam.** Every package's JS ≡ WASM
  parity suite exercises the production `defineKernel` path (marshal →
  dispatch → unmarshal) via `withBackend`, asserting which backend actually
  ran, instead of calling raw wasm-bindgen exports with bespoke re-packing.
  A missing WASM build now **fails** CI (`VIZCRUSH_REQUIRE_WASM=1`) instead
  of silently skipping — previously CI's TypeScript job never built WASM at
  all, so parity had never once run in CI. Test seam:
  `injectWasmModuleForTesting` substitutes only the module transport (Node
  can't run bindgen's `import.meta` fetch).
- **Spatial handles are opaque** (breaking, pre-npm-publish):
  `QuadtreeHandle`, `SpatialHashGridHandle`, and the spatial3d handles no
  longer expose `_core` / `_wasmTree` / `_wasmGrid`; adapter identity lives in
  a module-private WeakMap. Queries on a foreign or deserialized object now
  throw a descriptive error instead of returning empty results. MCP tools use
  the public query API rather than reaching into handle internals.
- **Truthful backend reporting:** new `bin2dWithBackend` reports
  `"webgpu" | "wasm" | "js"` for what actually ran (a fallen-back `webgpu`
  request reports the real path). The MCP `vizcrush_capabilities` tool now
  probes the runtime via `detectCapabilities()` instead of returning a
  hard-coded all-false table, and `vizcrush_benchmark` measures the real JS
  cores instead of inline approximations.

## @vizcrush/bin v1.1.0 (2026-07-31)

### WebGPU compute path for bin2d — opt-in, measured

- **`bin2d(x, y, opts, { backend: "webgpu" })`** runs the previously-draft
  `bin2d.wgsl` compute shader on a real WebGPU pipeline: lazy device
  acquisition with device-loss recovery, f64→f32 range rebase (epoch-scale
  values bin correctly), silent fallback to the wasm/js kernel on any failure.
- Never auto-selected — and for a reason: measured end-to-end it is ~15×
  slower than WASM at 100K/1M/5M points on Apple Silicon/Metal
  (upload + dispatch + readback dominate; ADR 0004 has the numbers and the
  conditions under which this could flip).
- Parity: totals identical to the f64 cores; at most a few boundary-adjacent
  counts differ (f32 bin-edge effects). Edges are always f64.
- New exports: `bin2dGpu`, `rebaseToF32`, `bin2dBounds`; new
  `benchmarks/webgpu-bin2d.html` harness and
  `benchmarks/results/webgpu-bin2d.json`.
- The other four `.wgsl` files remain unwired drafts.

## @vizcrush/core v2.0.0 (2026-05-29)

### Breaking changes — core honesty pass

The backend kernel is now the single consumer of backend selection, so the
decorative parts of `@vizcrush/core`'s public surface have been retired or made
truthful.

- **`Backend` narrowed to `'wasm' | 'js'`.** A single SIMD-enabled WASM binary is
  always built and no WebGPU compute path is wired, so `'wasm-simd'` and
  `'webgpu'` never named a distinct selectable path. `selectBackend` now returns
  `'wasm'` when WebAssembly is available and `'js'` otherwise. `detectCapabilities`
  still probes WebGPU/SIMD/SharedArrayBuffer for reporting.
- **Removed `DEFAULT_THRESHOLDS` and the `BackendThresholds` type.** These were
  exported but unused; the real size threshold lives in the kernel as
  `DEFAULT_AUTO_THRESHOLD` / a spec's `autoThreshold`.
- **Removed the SharedArrayBuffer zero-copy module.** `createHandle`, `fromHandle`,
  `toSharedFloat64Array`, `createSharedFloat64Array`, `createSharedUint32Array`,
  `isShared`, `hasSharedArrayBuffer`, and the `SharedDataHandle` type are gone.
  They were never consumed; the kernel marshals typed arrays across the WASM
  boundary directly, which is the honest zero-copy story.
- **Removed the `DownsampleOptions` type and the unused `backend?` field on
  `Bin2dOptions`.** Per-call backend selection is expressed via the kernel's
  `KernelCallOptions` (`backend?: 'auto' | 'wasm' | 'js'`).

**Migration:** drop imports of the removed symbols. If you read `init().backend`
for display, expect `'wasm' | 'js'`. To force a path per call, pass
`{ backend: 'js' | 'wasm' | 'auto' }` (a `KernelCallOptions`) to an algorithm
function instead of the old `DownsampleOptions.backend`.

## v1.0.0 (2026-03-31)

### Initial Release

> **Correction (2026-07):** this entry originally described a
> `WebGPU → WASM+SIMD → WASM → JS` backend chain and WASM speedup figures that
> were never real. No WebGPU compute path was ever wired, and `+simd128` does
> not change the generated code for these kernels (see ADR 0002/0003). The
> entry below is corrected to what v1.0.0 actually contained.

**Core Library**

- `@vizcrush/core` — Init, capability detection, backend selection (plus
  SharedArrayBuffer utilities and a WebGPU device probe, both removed in
  v2.0.0 as never-consumed)
- `@vizcrush/downsample` — LTTB, MinMaxLTTB, M4, LTOB downsampling algorithms
- `@vizcrush/bin` — 1D histogram, 2D density grid, hexagonal binning
- `@vizcrush/aggregate` — Welford stats, streaming accumulator, DDSketch/KLL quantile sketches, append+downsample
- `@vizcrush/transform` — Radix sort, min-max normalization, range filter
- `@vizcrush/spatial` — Quadtree, kd-tree (2D spatial indexing)

**3D Extensions**

- `@vizcrush/spatial3d` — Octree, 3D kNN, frustum culling
- `@vizcrush/bin3d` — 3D voxel grid binning

**AI Features**

- `@vizcrush/ai` — Anomaly detection (MAD Z-score), changepoint detection (CUSUM), auto-optimization, natural language query parsing, LLM-ready data summaries, shape embeddings with cosine similarity

**Framework Integration**

- `@vizcrush/react` — useDownsample, useBin2d, useStats, useStreamingStats hooks

**AI Agent Integration**

- `@vizcrush/mcp-server` — 23 MCP tools, 3 prompts, 2 resources, stdio + HTTP transport

**Engine**

- 9 Rust crates compiled to WebAssembly, with a pure-JS fallback core
- Automatic backend selection: WASM → JS fallback
- 5 WGSL shader drafts (never wired to a compute path; see ADR 0002)
- 435 tests (158 Rust + 277 TypeScript), counted at the 2026-07-30 honesty pass rather than at this release

**Performance**

- LTTB 1M→1K: ~1.8ms (JS core, Node/V8); WASM ~4× faster in Chromium,
  engine-dependent elsewhere (ADR 0003)
- Octree build 500K: ~200ms; 3D kNN query (k=10): ~0.3ms; 3D range query: ~0.01ms

**Examples**

- 37 interactive examples: financial time-series, IoT heatmap, streaming dashboard, ChartGPU integration, D3 large scatter, 3D point cloud, voxel heatmap, 3D benchmark, LiDAR terrain, globe visualization, medical volume viewer, Three.js integration, AI playground, MCP demo configs, and more
