# Getting Started

Welcome to vizcrush. This page is the entry point — by the end of it you'll have the toolkit running locally and a sense of where to go next.

## What you'll need

| Tool                 | Version                               | Why                                                     |
| -------------------- | ------------------------------------- | ------------------------------------------------------- |
| **Node.js**          | 24 or newer                           | Runtime + ESM support                                   |
| **pnpm**             | 10 or newer                           | Workspace package manager                               |
| **Rust toolchain**   | 1.94.1                                | Only if you want to rebuild the WASM crates from source |
| **A modern browser** | Chrome 113+, Firefox 117+, Safari 17+ | WebAssembly support                                     |

You don't need Rust if you just want to use vizcrush — the WASM artifacts are built once and shipped with the packages.

## Three-step intro

1. **[Install](installation.md)** only the `@vizcrush/*` packages your application needs from npm.
2. **[Run the quickstart](quickstart.md)** — a minimal end-to-end example: downsample a million points and pass the result to a renderer.
3. **[Browse the example apps](../reference/examples.md)** — 42 runnable demos covering financial time-series, IoT heatmaps, point clouds, framework and data-format integrations, volumetric medical data, and more.

## How vizcrush is organized

vizcrush is a monorepo. The two layers you'll interact with are:

- **TypeScript packages** under `packages/` — what you actually `import` from. Each package is published independently and wraps a thin async API around the WASM core, with a JavaScript fallback for environments without WebAssembly.
- **Rust crates** under `crates/` — the algorithms themselves, compiled to WebAssembly with `wasm-bindgen`. You only touch these if you're contributing or rebuilding from source.

There are nine core and algorithm packages — see the **[Packages overview](../packages/index.md)** for a one-line summary of each, or jump straight to a specific one:

| Package                                               | Use it for                                                      |
| ----------------------------------------------------- | --------------------------------------------------------------- |
| **[@vizcrush/core](../packages/core.md)**             | Initialize the library, detect capabilities, select the backend |
| **[@vizcrush/downsample](../packages/downsample.md)** | Reduce 1M+ point time series to display-friendly counts         |
| **[@vizcrush/aggregate](../packages/aggregate.md)**   | Min/max/mean/stddev, percentiles, sketches, streaming windows   |
| **[@vizcrush/transform](../packages/transform.md)**   | Sort, normalize, filter typed arrays                            |
| **[@vizcrush/bin](../packages/bin.md)**               | 1D histograms, 2D density grids, hexagonal binning              |
| **[@vizcrush/bin3d](../packages/bin3d.md)**           | 3D voxel grids for volumetric heatmaps                          |
| **[@vizcrush/spatial](../packages/spatial.md)**       | 2D quadtree + range/k-NN queries                                |
| **[@vizcrush/spatial3d](../packages/spatial3d.md)**   | 3D octree + frustum culling                                     |
| **[@vizcrush/ai](../packages/ai.md)**                 | Anomaly/changepoint detection, auto-config, shape similarity    |

There are also two integration packages:

- **[@vizcrush/react](react.md)** — Hooks (`useDownsample`, `useBin2d`, `useStats`, `useStreamingStats`, `useVizcrush`)
- **[@vizcrush/mcp-server](mcp.md)** — MCP server that exposes the full toolkit to Claude, Cursor, and other AI agents

## A word on backends

vizcrush picks its compute backend at runtime:

1. **WASM** — the Rust core compiled to WebAssembly. Chosen whenever WebAssembly is available.
2. **JavaScript** — pure-JS fallback so the API still works on legacy or restricted environments.

Which one is faster depends on the engine and its version: WASM won ~4× in Chromium through 148, but a V8 improvement in Chromium 149 made the JS core 3.36× faster, leaving the two within ~1.1× there; the JS core is comparable or faster in Firefox and Safari — see ADR 0003 (`docs/adr/0003-wasm-vs-js-is-engine-dependent.md`) and `benchmarks/campaign/`.

You can let it auto-select with `init()`, override per call, or inspect `ctx.capabilities` to see what's available. See **[Backends & Capabilities](backends.md)** for details.

## Next

- **[Installation →](installation.md)**
- **[Quickstart →](quickstart.md)**
