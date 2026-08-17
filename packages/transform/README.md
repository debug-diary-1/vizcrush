# @vizcrush/transform

> Sort, normalize, filter, and log/power transforms on typed arrays.

Part of [vizcrush](https://github.com/debug-diary-1/vizcrush) — high-performance data primitives for browser visualization,
written in Rust, compiled to WebAssembly, with a pure-JS fallback.

## Install

```bash
npm install @vizcrush/transform
```

## Example

```typescript
import { normalize, log10Transform } from "@vizcrush/transform";

const scaled = await normalize(await log10Transform(values)); // [0, 1] on a log axis
```

## Documentation

Full guides and API reference: [debug-diary-1.github.io/vizcrush](https://debug-diary-1.github.io/vizcrush/) ·
[The vizcrush Book](https://debug-diary-1.github.io/vizcrush-book/)

## License

MIT
