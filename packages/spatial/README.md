# @vizcrush/spatial

> Quadtree, spatial hash grid, Morton ordering — range and kNN queries over 2D points.

Part of [vizcrush](https://github.com/debug-diary-1/vizcrush) — high-performance data primitives for browser visualization,
written in Rust, compiled to WebAssembly, with a pure-JS fallback.

## Install

```bash
npm install @vizcrush/spatial
```

## Example

```typescript
import { buildQuadtree, queryRange, queryNearest } from "@vizcrush/spatial";

const tree = await buildQuadtree(x, y);
const visible = queryRange(tree, { xMin, xMax, yMin, yMax });
const nearest = queryNearest(tree, cursorX, cursorY, 5);
```

## Documentation

Full guides and API reference: [debug-diary-1.github.io/vizcrush](https://debug-diary-1.github.io/vizcrush/) ·
[The vizcrush Book](https://debug-diary-1.github.io/vizcrush-book/)

## License

MIT
