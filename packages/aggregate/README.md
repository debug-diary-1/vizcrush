# @vizcrush/aggregate

> Streaming statistics and bounded-memory sketches (DDSketch, KLL, HyperLogLog, CountMin).

Part of [vizcrush](https://github.com/debug-diary-1/vizcrush) — high-performance data primitives for browser visualization,
written in Rust, compiled to WebAssembly, with a pure-JS fallback.

## Install

```bash
npm install @vizcrush/aggregate
```

## Example

```typescript
import { DDSketch, streamingStats } from "@vizcrush/aggregate";

const sketch = new DDSketch(0.01); // 1% relative error
sketch.add(latencyMs);
const p99 = sketch.quantile(0.99);
```

## Documentation

Full guides and API reference: [debug-diary-1.github.io/vizcrush](https://debug-diary-1.github.io/vizcrush/) ·
[The vizcrush Book](https://debug-diary-1.github.io/vizcrush-book/)

## License

MIT
