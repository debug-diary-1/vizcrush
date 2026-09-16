# @vizcrush/ai

> Anomaly and changepoint detection, auto-configuration, LLM-ready summaries, shape embeddings.

Part of [vizcrush](https://github.com/debug-diary-1/vizcrush) — high-performance data primitives for browser visualization,
written in Rust, compiled to WebAssembly, with a pure-JS fallback.

## Install

```bash
npm install @vizcrush/ai
```

## Example

```typescript
import { detectAnomalies, summarizeForLLM } from "@vizcrush/ai";

const anomalies = detectAnomalies(sensorData, 3.0);
const paragraph = summarizeForLLM(x, y); // fits in an LLM context window
```

AI analysis treats the supplied series as the complete analysis window: variance and standard
deviation use the population definition (`n` denominator). Non-finite observations are omitted;
for paired `x`/`y` inputs, the whole pair is omitted. Reported anomaly and changepoint indices
always refer to the original input.

## Documentation

Full guides and API reference: [debug-diary-1.github.io/vizcrush](https://debug-diary-1.github.io/vizcrush/) ·
[The vizcrush Book](https://debug-diary-1.github.io/vizcrush-book/)

## License

MIT
