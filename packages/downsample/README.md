# @vizcrush/downsample

> LTTB, MinMaxLTTB, M4, and LTOB downsampling for time-series visualization.

Part of [vizcrush](https://github.com/debug-diary-1/vizcrush) — high-performance data primitives for browser visualization,
written in Rust, compiled to WebAssembly, with a pure-JS fallback.

## Install

```bash
npm install @vizcrush/downsample
```

## Example

```typescript
import { lttb } from "@vizcrush/downsample";

// Reduce 1M points to 1,920 while preserving visual shape.
const { x, y } = await lttb(timestamps, values, 1920);
```

## Documentation

Full guides and API reference: [debug-diary-1.github.io/vizcrush](https://debug-diary-1.github.io/vizcrush/) ·
[The vizcrush Book](https://debug-diary-1.github.io/vizcrush-book/)

## License

MIT
