# vizcrush

> Make large browser datasets small enough to visualize.

[![CI](https://github.com/debug-diary-1/vizcrush/actions/workflows/ci.yml/badge.svg)](https://github.com/debug-diary-1/vizcrush/actions/workflows/ci.yml)
[![npm: @vizcrush/core](https://img.shields.io/npm/v/%40vizcrush%2Fcore?label=%40vizcrush%2Fcore)](https://www.npmjs.com/package/@vizcrush/core)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**vizcrush** reduces massive browser datasets into bounded, renderer-ready data for D3, Three.js, deck.gl, Canvas, WebGL, and WebGPU. Downsample time series, build density bins, query 2D and 3D spatial indexes, and compute streaming statistics before the data reaches your chart.

The algorithms are written in Rust and compiled to WebAssembly, with the same asynchronous API backed by a pure-JavaScript fallback. Outputs remain typed arrays, keeping vizcrush decoupled from the rendering layer.

**[Live examples](https://debug-diary-1.github.io/vizcrush/examples/)** · **[Documentation](https://debug-diary-1.github.io/vizcrush/)** · **[Algorithm book](https://debug-diary-1.github.io/vizcrush-book/)**

## Quick start

```bash
npm install @vizcrush/downsample
```

```typescript
import { lttb } from "@vizcrush/downsample";

// Preserve the visual shape of 1M points in a 1K-point result.
const result = await lttb(timestamps, values, 1_000);
renderChart(result.x, result.y);
```

Try **[Backend Lab](https://debug-diary-1.github.io/vizcrush/examples/backend-lab/)** to compare the JavaScript and WASM implementations in your own browser.

## Pick the primitive for your problem

| You are building                  | Start with                                                                                                                                      | What it does                                          |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| A dense time-series chart         | [`@vizcrush/downsample`](https://www.npmjs.com/package/@vizcrush/downsample)                                                                    | Reduces point count while preserving visual shape     |
| A heatmap or scatter-density view | [`@vizcrush/bin`](https://www.npmjs.com/package/@vizcrush/bin)                                                                                  | Produces histograms, 2D grids, and hexagonal bins     |
| A pan-and-zoom 2D explorer        | [`@vizcrush/spatial`](https://www.npmjs.com/package/@vizcrush/spatial)                                                                          | Provides quadtree, hash-grid, range, and k-NN queries |
| A point cloud or volume viewer    | [`@vizcrush/spatial3d`](https://www.npmjs.com/package/@vizcrush/spatial3d) + [`@vizcrush/bin3d`](https://www.npmjs.com/package/@vizcrush/bin3d) | Adds octrees, frustum culling, and voxel grids        |
| A live telemetry dashboard        | [`@vizcrush/aggregate`](https://www.npmjs.com/package/@vizcrush/aggregate)                                                                      | Computes one-pass stats and bounded-memory sketches   |
| A React visualization             | [`@vizcrush/react`](https://www.npmjs.com/package/@vizcrush/react)                                                                              | Wraps common operations in React hooks                |
| An AI-assisted data workflow      | [`@vizcrush/mcp-server`](https://www.npmjs.com/package/@vizcrush/mcp-server)                                                                    | Exposes vizcrush operations as MCP tools              |

See the **[quickstart](https://debug-diary-1.github.io/vizcrush/user-guide/quickstart)**, follow the **[production adoption path](https://debug-diary-1.github.io/vizcrush/user-guide/production-adoption)**, or browse all **[42 runnable examples](https://debug-diary-1.github.io/vizcrush/examples/)**.

## Why vizcrush exists

Rendering libraries solve the final drawing step. Large browser visualizations also need an algorithms layer between raw data and the renderer:

```text
API / file / stream → vizcrush → chart / canvas / WebGL renderer
                       ├─ downsample
                       ├─ bin and aggregate
                       └─ index and query
```

vizcrush deliberately draws nothing. Its small, composable packages let you keep your renderer and only add the data operation you need.

## Packages

| Package                                                                      | Description                                               |
| ---------------------------------------------------------------------------- | --------------------------------------------------------- |
| [`@vizcrush/core`](https://www.npmjs.com/package/@vizcrush/core)             | Runtime capability detection and WASM/JS dispatch         |
| [`@vizcrush/downsample`](https://www.npmjs.com/package/@vizcrush/downsample) | LTTB, MinMaxLTTB, M4, and LTOB downsampling               |
| [`@vizcrush/bin`](https://www.npmjs.com/package/@vizcrush/bin)               | 1D/2D histograms and hexagonal binning                    |
| [`@vizcrush/bin3d`](https://www.npmjs.com/package/@vizcrush/bin3d)           | 3D voxel-grid binning                                     |
| [`@vizcrush/aggregate`](https://www.npmjs.com/package/@vizcrush/aggregate)   | Streaming stats and bounded-memory sketches               |
| [`@vizcrush/transform`](https://www.npmjs.com/package/@vizcrush/transform)   | Sort, normalize, and filter typed arrays                  |
| [`@vizcrush/spatial`](https://www.npmjs.com/package/@vizcrush/spatial)       | Quadtree, hash-grid, range, and k-NN queries              |
| [`@vizcrush/spatial3d`](https://www.npmjs.com/package/@vizcrush/spatial3d)   | Octree, 3D k-NN, and frustum culling                      |
| [`@vizcrush/ai`](https://www.npmjs.com/package/@vizcrush/ai)                 | Anomaly detection, auto-configuration, and data summaries |
| [`@vizcrush/react`](https://www.npmjs.com/package/@vizcrush/react)           | React hooks for common vizcrush operations                |
| [`@vizcrush/mcp-server`](https://www.npmjs.com/package/@vizcrush/mcp-server) | MCP server for AI-agent access                            |

## Performance, without magic

WASM performance is engine- and version-dependent. Through Chromium 148 the WASM kernel was about 4× faster than the JavaScript core; Chromium 149 shipped a V8 improvement that made the JavaScript core 3.36× faster, leaving WASM only ~1.1× ahead there (measured through Chromium 151). In Firefox and Safari the JavaScript core is comparable or faster. Cold first calls are slower everywhere. The JavaScript fallback keeps the API available across environments. The measurements behind these numbers are committed in [`benchmarks/campaign/`](benchmarks/campaign/).

The opt-in WebGPU path for `bin2d` is currently slower end to end than WASM because transfer costs dominate, so vizcrush never auto-selects it. The measurements, limitations, and rejected optimizations are documented in [ADR 0002](docs/adr/0002-wasm-simd-not-engaged.md), [ADR 0003](docs/adr/0003-wasm-vs-js-is-engine-dependent.md), and [ADR 0004](docs/adr/0004-webgpu-bin2d-wired-but-loses.md).

## MCP server

AI coding agents can invoke 24 vizcrush tools over MCP:

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

Tools cover downsampling, binning, spatial queries, statistics, transforms, file inspection, capability detection, benchmarking, anomaly detection, and summaries. See the **[MCP guide](https://debug-diary-1.github.io/vizcrush/user-guide/mcp)** for configuration and security options.

## Contributing

Bug reports, focused feature proposals, documentation improvements, new examples, and algorithm work are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow, or [open an issue](https://github.com/debug-diary-1/vizcrush/issues/new/choose) to start a discussion.

For vulnerabilities, follow the private reporting process in [SECURITY.md](SECURITY.md).

## Development

```bash
# Prerequisites: Rust, Node.js 24+, pnpm 10+
pnpm install
pnpm build
pnpm test:all
```

## License

[MIT](LICENSE) © vizcrush contributors
