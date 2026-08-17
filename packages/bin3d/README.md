# @vizcrush/bin3d

> 3D voxel-grid binning for point clouds and volumetric density.

Part of [vizcrush](https://github.com/debug-diary-1/vizcrush) — high-performance data primitives for browser visualization,
written in Rust, compiled to WebAssembly, with a pure-JS fallback.

## Install

```bash
npm install @vizcrush/bin3d
```

## Example

```typescript
import { bin3d } from "@vizcrush/bin3d";

const result = await bin3d(x, y, z, { xBins: 32, yBins: 32, zBins: 32 });
```

## Documentation

Full guides and API reference: [debug-diary-1.github.io/vizcrush](https://debug-diary-1.github.io/vizcrush/) ·
[The vizcrush Book](https://debug-diary-1.github.io/vizcrush-book/)

## License

MIT
