# Chart.js integration

This example is a real Chart.js integration: vizcrush reduces large typed-array inputs, then Chart.js renders the smaller datasets.

```text
1,000,000 time-series points -> lttb -> 2,000 Chart.js line points
500,000 scatter points       -> bin2d -> non-empty Chart.js scatter bins
```

The important seam is intentionally small:

```ts
const { x, y } = await lttb(timestamps, values, 2_000);
renderLineChart(container, x, y);

const { grid, maxCount } = await bin2d(scatterX, scatterY, {
  xBins: 128,
  yBins: 128,
});
renderScatterDensity(container, grid, 128, 128, maxCount);
```

Run it from the repository root:

```sh
pnpm --dir examples/chartgpu-integration dev
```

The directory retains its historical name so existing gallery URLs continue to work; the former ChartGPU placeholder has been replaced by Chart.js.
