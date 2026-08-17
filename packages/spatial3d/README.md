# @vizcrush/spatial3d

> Octree, 3D kNN, and frustum culling for point clouds.

Part of [vizcrush](https://github.com/debug-diary-1/vizcrush) — high-performance data primitives for browser visualization,
written in Rust, compiled to WebAssembly, with a pure-JS fallback.

## Install

```bash
npm install @vizcrush/spatial3d
```

## Example

```typescript
import { buildOctree, queryRange3d, frustumCull } from "@vizcrush/spatial3d";

const tree = await buildOctree(x, y, z);
const inBox = queryRange3d(tree, { xMin, xMax, yMin, yMax, zMin, zMax });
```

## Documentation

Full guides and API reference: [debug-diary-1.github.io/vizcrush](https://debug-diary-1.github.io/vizcrush/) ·
[The vizcrush Book](https://debug-diary-1.github.io/vizcrush-book/)

## License

MIT
