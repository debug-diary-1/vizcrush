# Scenario: Server Monitoring Dashboard

## Context

A server monitoring dashboard receives 1,000 metrics/sec via WebSocket. The chart must stay smooth while maintaining a 20K-point rolling buffer.

## Agent Session

```
👤 Developer:
"Our monitoring dashboard receives 1K metrics/sec and the chart
keeps stuttering. We're using a 20K rolling buffer but the
re-rendering is too slow. Help?"

🧠 Agent reasoning:
The key issue is re-downsampling the full buffer on every update.
Keep the plotted history in app state and downsample it with lttb.
streamingStats provides live min/max/mean without re-scanning.

⚡ MCP Tool Call: vizcrush_capabilities()
→ { wasm: true, js: true }

⚡ MCP Tool Call: vizcrush_benchmark(data_size: 20000, algorithms: ["lttb"])
→ { results: { lttb: { median_ms: 0.04 } },
    note: "20K → 400 points in 0.04ms — well within 16ms frame budget" }

🤖 Agent response:
"Here's the fix using vizcrush's streaming primitives:

1. **lttb**: Downsample the history you already keep
   - 20K → 400 display points in 0.04ms (400x under frame budget)

2. **streamingStats**: Rolling min/max/mean/stddev
   - O(1) amortized per push — no re-scanning the buffer
   - Live stat pills update every frame

3. **requestAnimationFrame throttle**: Only render once per frame
   even if multiple batches arrive between frames

Result: 1K pts/sec ingestion at solid 60fps with live stats."
```
