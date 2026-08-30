---
layout: home

hero:
  name: vizcrush
  text: Make large browser datasets small enough to visualize
  tagline: Renderer-agnostic downsampling, binning, spatial indexing, and streaming aggregation in Rust, WASM, and JavaScript
  actions:
    - theme: brand
      text: Get Started
      link: /user-guide/getting-started
    - theme: alt
      text: Try Live Examples
      link: /examples/
    - theme: alt
      text: View on GitHub
      link: https://github.com/debug-diary-1/vizcrush

features:
  - title: Downsampling
    details: LTTB, MinMax-LTTB, M4, LTOB — preserve the visual shape of millions of points in your charts.
    link: /packages/downsample
  - title: Binning & Density
    details: 1D histograms, 2D density grids, hexagonal binning, 3D voxel grids.
    link: /packages/bin
  - title: Spatial Indexes
    details: Quadtree, octree, Morton curves, hash grids, k-NN, range queries, frustum culling.
    link: /packages/spatial
  - title: Streaming Stats
    details: Welford one-pass stats, HyperLogLog, DDSketch, KLL, CountMin, reservoir sampling.
    link: /packages/aggregate
  - title: AI Features
    details: Anomaly + changepoint detection, auto-config, shape embeddings, NL query parsing.
    link: /packages/ai
  - title: MCP Server
    details: Expose 24 tools to Claude, Cursor, and other MCP-aware agents over stdio or HTTP.
    link: /user-guide/mcp
---

## Quick taste

```typescript
import { lttb } from "@vizcrush/downsample";

// Downsample 1M points to 1K before handing them to your renderer.
const x = new Float64Array(1_000_000);
const y = new Float64Array(1_000_000);
// ... fill x, y with your data ...

const { x: xs, y: ys } = await lttb(x, y, 1000);
// xs, ys are Float64Array[1000] — feed them to any renderer
```

## Where to go next

- New here? Start with the **[Getting Started](/user-guide/getting-started)** guide.
- Want to see it work end-to-end? Jump to the **[Quickstart](/user-guide/quickstart)**.
- Looking for a specific algorithm? Check the **[Algorithms reference](/reference/algorithms)**.
- Building a React app? See **[React Integration](/user-guide/react)**.
- Wiring it into Claude or Cursor? See **[MCP Server](/user-guide/mcp)**.
