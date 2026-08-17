# @vizcrush/core

> Device detection, backend selection, and shared types for vizcrush.

Part of [vizcrush](https://github.com/debug-diary-1/vizcrush) — high-performance data primitives for browser visualization,
written in Rust, compiled to WebAssembly, with a pure-JS fallback.

## Install

```bash
npm install @vizcrush/core
```

## Example

```typescript
import { init } from "@vizcrush/core";

const vc = await init();
console.log(vc.backend); // 'wasm' | 'js'
```

## Documentation

Full guides and API reference: [debug-diary-1.github.io/vizcrush](https://debug-diary-1.github.io/vizcrush/) ·
[The vizcrush Book](https://debug-diary-1.github.io/vizcrush-book/)

## License

MIT
