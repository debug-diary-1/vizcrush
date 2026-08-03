# Packages

vizcrush is split into **nine independent packages** so you only install (and ship) what you actually use. Every package has the same shape: a small async TypeScript API that delegates to a WebAssembly core, with a synchronous JavaScript fallback for environments without WebAssembly.

## At a glance

| Package                                   | One-liner                                                       | Backends |
| ----------------------------------------- | --------------------------------------------------------------- | -------- |
| **[@vizcrush/core](core.md)**             | Initialize the library, detect capabilities, select the backend | JS       |
| **[@vizcrush/downsample](downsample.md)** | LTTB, MinMax-LTTB, M4, LTOB time-series downsampling            | WASM, JS |
| **[@vizcrush/aggregate](aggregate.md)**   | Welford stats, exact + t-digest percentiles, streaming windows  | WASM, JS |
| **[@vizcrush/transform](transform.md)**   | Radix sort, min-max normalize, range filter on typed arrays     | WASM, JS |
| **[@vizcrush/bin](bin.md)**               | 1D histograms, 2D density grids, hexagonal binning              | WASM, JS |
| **[@vizcrush/bin3d](bin3d.md)**           | 3D voxel grids for volumetric heatmaps                          | WASM, JS |
| **[@vizcrush/spatial](spatial.md)**       | 2D quadtree + range, k-NN queries                               | WASM, JS |
| **[@vizcrush/spatial3d](spatial3d.md)**   | 3D octree + range, k-NN, frustum culling                        | WASM, JS |
| **[@vizcrush/ai](ai.md)**                 | Anomaly + changepoint detection, auto-config, shape similarity  | JS       |

There are also **two integration packages** (covered in the User Guide):

- **[@vizcrush/react](../user-guide/react.md)** — Hooks for React apps
- **[@vizcrush/mcp-server](../user-guide/mcp.md)** — MCP server exposing vizcrush to Claude / Cursor

## Common conventions

**Inputs and outputs are typed arrays.** Almost everything takes `Float64Array` (data) or `Uint32Array` (indices). This is intentional — typed arrays are zero-copy across the JS↔WASM boundary, while plain `number[]` requires a per-element conversion that dominates runtime for any non-trivial input.

**APIs are async by default.** WASM module loading is inherently async. Sync variants exist where they're trivially safe — e.g. `lttbSync()` runs the JS fallback inline.

**Results are interleaved when paired.** XY-pair functions return `[x0, y0, x1, y1, …]` in a single `Float64Array`, not `{ x: Float64Array, y: Float64Array }`. This matches what most charting libraries consume directly.

**Backend can be overridden per call.** Most functions accept an `options.backend` of `"auto" | "wasm" | "js"`. The default is `"auto"` (use whatever `init()` selected).

## What's a "package" in the source

Every package lives under `packages/<name>/`:

```
packages/<name>/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts        # public exports — what you import
│   ├── wasm.ts         # WASM loader (async)
│   └── shaders/        # *.wgsl compute shaders (bin2d wired as opt-in, ADR 0004; rest are drafts)
└── wasm/               # generated wasm-bindgen output (gitignored, built locally)
```

The corresponding Rust crate is at `crates/vizcrush-<name>/`. See the **[Architecture](../developer-guide/architecture.md)** page for the full build pipeline.
