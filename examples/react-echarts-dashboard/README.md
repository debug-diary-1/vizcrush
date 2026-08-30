# React + ECharts dashboard

This example uses `useDownsample`, `useStats`, and `useVizcrush` from `@vizcrush/react` to prepare a deterministic one-million-point series for ECharts. React owns the controls and lifecycle; ECharts remains the renderer.

The UI reports downsampling and the synchronous `chart.setOption` call separately, sequencing summary statistics after the measured downsample so the two stages do not contend. Before showing the dashboard, the React hooks make one untimed call on the real input so the displayed downsample value excludes lazy WASM loading and reports a warm kernel call. `useVizcrush` reports the capability-selected preferred backend; individual kernels can still fall back if lazy WASM loading fails. ECharts preserves the active zoom while controls change. These are local browser measurements, not general benchmark claims. ECharts has its own large-data features; this example demonstrates an explicit, renderer-independent level-of-detail boundary.

```bash
pnpm install
pnpm --dir examples/react-echarts-dashboard dev
```
