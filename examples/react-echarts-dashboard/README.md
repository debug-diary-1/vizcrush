# React + ECharts dashboard

This example uses `useDownsample`, `useStats`, and `useVizcrush` from `@vizcrush/react` to prepare a deterministic one-million-point series for ECharts. React owns the controls and lifecycle; ECharts remains the renderer.

The UI reports vizcrush preprocessing and the synchronous `chart.setOption` call separately. Before showing the dashboard, the React hooks make one untimed call on the real input so the displayed vizcrush value excludes lazy WASM loading and reports a warm kernel call. These are local browser measurements, not general benchmark claims. ECharts has its own large-data features; this example demonstrates an explicit, renderer-independent level-of-detail boundary.

```bash
pnpm install
pnpm --dir examples/react-echarts-dashboard dev
```
