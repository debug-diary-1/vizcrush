# @vizcrush/react

> React hooks for vizcrush: useVizcrush, useDownsample, useBin2d, useStats, useStreamingStats.

Part of [vizcrush](https://github.com/debug-diary-1/vizcrush) — high-performance data primitives for browser visualization,
written in Rust, compiled to WebAssembly, with a pure-JS fallback.

## Install

```bash
npm install @vizcrush/react
```

## Example

```typescript
import { useVizcrush, useDownsample } from "@vizcrush/react";

const ctx = useVizcrush(); // { backend: 'wasm' | 'js', capabilities } | null
const { data, loading } = useDownsample(x, y, { threshold: 1920 });
```

## Documentation

Full guides and API reference: [debug-diary-1.github.io/vizcrush](https://debug-diary-1.github.io/vizcrush/) ·
[The vizcrush Book](https://debug-diary-1.github.io/vizcrush-book/)

## License

MIT
