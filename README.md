# vizcrush

> High-performance data primitives for browser visualization

**vizcrush** is an open-source library that provides data processing primitives purpose-built for browser-based data visualization. Written in Rust and compiled to WebAssembly, with a pure-JS fallback so the same API runs everywhere.

> **Performance note:** WASM vs the JS fallback is **engine-dependent** (measured, see [ADR 0003](docs/adr/0003-wasm-vs-js-is-engine-dependent.md)): WASM is ~4× faster in Chromium/V8 (the dominant engine), but comparable-to-slower in Firefox and Safari, and slower on a cold first call everywhere. The `+simd128` flag does not autovectorize these branch-heavy loops, so there is no SIMD speedup ([ADR 0002](docs/adr/0002-wasm-simd-not-engaged.md)). Net: WASM wins the common case; the JS fallback keeps the same API working everywhere. There is also an opt-in WebGPU compute path for `bin2d` (`{ backend: "webgpu" }`) — measured ~15× slower than WASM end-to-end, so it is never auto-selected ([ADR 0004](docs/adr/0004-webgpu-bin2d-wired-but-loses.md)).

## The Gap

Libraries like ChartGPU, deck.gl, and Plotly handle **rendering**. Libraries like TypeGPU handle **GPU buffer management**. Nobody has built the optimized **data algorithms layer** in between — the downsampling, binning, spatial indexing, and streaming aggregation that every large-dataset visualization needs.

**vizcrush fills that gap.** It draws nothing. It takes data in and returns optimized data out — ready for any renderer.

## Quick Start

> **Not yet on npm.** The `@vizcrush/*` packages have not been published yet.
> Until the first release lands, build from source — see
> [Development](#development).

```bash
npm install @vizcrush/core @vizcrush/downsample
```

```typescript
import { init } from "@vizcrush/core";
import { lttb } from "@vizcrush/downsample";

const vc = await init();
console.log(vc.backend); // 'wasm' | 'js'

// Downsample 1M points to 1K — preserves visual shape
const { x, y } = await lttb(timestamps, values, 1000);
```

## Packages

| Package                | Description                                           |
| ---------------------- | ----------------------------------------------------- |
| `@vizcrush/core`       | Device detection, backend selection, types            |
| `@vizcrush/downsample` | LTTB, MinMaxLTTB, M4, LTOB algorithms                 |
| `@vizcrush/bin`        | 1D/2D histogram binning, hexagonal binning            |
| `@vizcrush/bin3d`      | 3D voxel grid binning                                 |
| `@vizcrush/aggregate`  | Streaming stats, quantile sketches, append+downsample |
| `@vizcrush/transform`  | Radix sort, normalize, filter on typed arrays         |
| `@vizcrush/spatial`    | Quadtree, kd-tree, hash grid, range + kNN queries     |
| `@vizcrush/spatial3d`  | Octree, 3D kNN, frustum culling                       |
| `@vizcrush/ai`         | Anomaly detection, auto-config, LLM summaries         |
| `@vizcrush/react`      | React hooks for downsample, bin, stats                |
| `@vizcrush/mcp-server` | MCP server for AI agent access                        |

## MCP Server

AI coding agents can invoke vizcrush tools directly:

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

### Available Tools

- `vizcrush_lttb` — LTTB downsampling
- `vizcrush_minmax_lttb` — MinMax + LTTB (spiky data)
- `vizcrush_auto_downsample` — Auto-select best algorithm
- `vizcrush_histogram` — 1D histogram
- `vizcrush_bin2d` — 2D density grid
- `vizcrush_stats` — Summary statistics + percentiles
- `vizcrush_normalize` — Min-max normalization
- `vizcrush_sort` — Radix sort
- `vizcrush_capabilities` — Environment detection
- `vizcrush_benchmark` — Performance comparison

## The Book

The companion book — 16 chapters explaining every algorithm inside vizcrush, why it works, and when to pick which one — is free to read at **[github.com/debug-diary-1/vizcrush-book](https://github.com/debug-diary-1/vizcrush-book)** (going public alongside this repo).

## Development

```bash
# Prerequisites: Rust, Node.js 24+, pnpm

# Run Rust tests
cargo test --workspace

# Build WASM
bash scripts/build-wasm.sh

# Build TypeScript
pnpm install && pnpm turbo build
```

## License

MIT
