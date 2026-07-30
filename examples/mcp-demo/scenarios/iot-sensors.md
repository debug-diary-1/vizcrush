# Scenario: IoT Sensor Fleet Dashboard

## Context

A fleet management company has 500K GPS readings from delivery vehicles over 24 hours. They need a density heatmap showing traffic concentration zones.

## Agent Session

```
👤 Developer:
"I have 500K GPS coordinate readings from our delivery fleet.
The dashboard needs a density heatmap showing hotspots. Can you help?"

🧠 Agent reasoning:
500K scatter points → bin2d for density grid → render as heatmap.
I'll also compute percentiles for temperature overlay.

⚡ MCP Tool Call: vizcrush_capabilities()
→ { wasm: true, js: true }

⚡ MCP Tool Call: vizcrush_bin2d(x, y, x_bins: 256, y_bins: 256)
→ { grid: [...65536 cells...], max_count: 847,
    backend_used: "wasm", elapsed_ms: 3.8 }

⚡ MCP Tool Call: vizcrush_stats(temperatures, percentiles: [10, 25, 50, 75, 90])
→ { count: 500000, min: -5.2, max: 42.1, mean: 18.7,
    percentiles: { p10: 8.2, p50: 18.5, p90: 29.8 } }

🤖 Agent response:
"Done! I've created a 256×256 density heatmap from your 500K GPS points:

1. **Density grid**: bin2d processed in 3.8ms via WASM
   - Peak density: 847 readings in one cell (likely a depot)
   - Use viridis color scale with gamma correction for visibility

2. **Temperature stats**: Median 18.5°C, 90th percentile 29.8°C
   - Overlay P10/P90 bands on the heatmap

3. **Interactive controls**: Resolution selector (32² to 256²)
   for different zoom levels"
```
