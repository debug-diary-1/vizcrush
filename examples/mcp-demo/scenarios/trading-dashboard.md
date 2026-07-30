# Scenario: Trading Dashboard Optimization

## Context

A fintech team has a crypto trading dashboard showing 2M historical candlestick data points. The chart stutters on pan/zoom.

## Agent Session

```
👤 Developer:
"Our BTC trading chart has 2M data points and freezes when users zoom.
Can you optimize the rendering performance?"

🧠 Agent reasoning:
2M points is far too many for direct rendering. I'll check backend
capabilities, then use MinMaxLTTB (best for financial data with spikes)
to downsample to chart width.

⚡ MCP Tool Call: vizcrush_capabilities()
→ { wasm: true, js: true }

⚡ MCP Tool Call: vizcrush_auto_downsample(x, y, 1920, data_hint: "financial")
→ { algorithm: "minmax_lttb", original_length: 2000000,
    output_length: 1920, backend_used: "wasm", elapsed_ms: 16.2 }

⚡ MCP Tool Call: vizcrush_stats(y, percentiles: [1, 5, 25, 50, 75, 95, 99])
→ { count: 2000000, min: 21043.50, max: 69420.00, mean: 44832.17,
    std_dev: 8921.44, percentiles: { p1: 25100, p50: 44800, p99: 65200 } }

🤖 Agent response:
"Optimized! Here's what I did:

1. **Downsampling**: MinMaxLTTB reduced 2M → 1,920 points in 16ms
   - MinMaxLTTB preserves price spikes (important for trading)
   - Output matches chart width pixel-for-pixel

2. **Re-downsample on zoom**: Added resize listener that
   re-runs MinMaxLTTB to match new viewport width

3. **Stats overlay**: P1/P99 percentile bands for context

Total processing: 16ms. Chart now renders at 60fps."
```
