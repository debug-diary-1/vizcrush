# @vizcrush/bin

> 1D histograms, 2D density grids, and hexagonal binning for heatmaps.

Part of [vizcrush](https://github.com/debug-diary-1/vizcrush) — high-performance data primitives for browser visualization,
written in Rust, compiled to WebAssembly, with a pure-JS fallback.

## Install

```bash
npm install @vizcrush/bin
```

## Example

```typescript
import { bin2d } from "@vizcrush/bin";

const { grid, xEdges, yEdges, maxCount } = await bin2d(x, y, { xBins: 128, yBins: 128 });
// grid is a Uint32Array of length 128 * 128, row-major
```

## Documentation

Full guides and API reference: [debug-diary-1.github.io/vizcrush](https://debug-diary-1.github.io/vizcrush/) ·
[The vizcrush Book](https://debug-diary-1.github.io/vizcrush-book/)

## License

MIT
