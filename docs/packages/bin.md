# @vizcrush/bin

Histograms, 2D density grids, and hexagonal binning — the building blocks for heatmaps and density-aware scatter plots. Runs on the WASM core where WebAssembly is available, with a pure-JS fallback otherwise.

## Import

```typescript
import { bin1d, bin2d, hexbin } from "@vizcrush/bin";
```

## `bin1d(data, bins, range?)`

1D histogram with fixed-width bins.

```typescript
const data = new Float64Array(/* 1M samples */);
const result = await bin1d(data, /* bins */ 64);
// {
//   counts: Uint32Array [c0, c1, …, c63],
//   edges:  Float64Array [e0, e1, …, e64], // length is bins + 1
// }
```

**With explicit range:**

```typescript
const result = await bin1d(data, 64, [0, 100]);
// Bins values into [0, 100] in 64 equal-width bins
```

If `range` is omitted, vizcrush computes `[min, max]` of `data` in a single pre-pass.

## `bin2d(x, y, options?)`

2D density grid — the standard heatmap building block.

```typescript
import { bin2d } from "@vizcrush/bin";

const result = await bin2d(x, y, {
  xBins: 256,
  yBins: 256,
});
// {
//   grid: Uint32Array,        // length: xBins * yBins, row-major
//   xEdges: Float64Array,     // length: xBins + 1
//   yEdges: Float64Array,     // length: yBins + 1
//   maxCount: number,         // peak bucket count
// }
```

**Full options:**

```typescript
interface Bin2dOptions {
  xBins?: number; // default 256
  yBins?: number; // default 256
  xRange?: [number, number]; // default: auto-compute from data
  yRange?: [number, number]; // default: auto-compute from data
}

// Trailing call options:
interface Bin2dCallOptions {
  backend?: "auto" | "wasm" | "js" | "webgpu"; // default "auto"
}
```

**Reading the grid:** the result is row-major, so the bucket at column `xi`, row `yi` is `grid[yi * xBins + xi]`.

```typescript
function gridAt(grid: Uint32Array, xBins: number, xi: number, yi: number): number {
  return grid[yi * xBins + xi];
}
```

**Rendering:** normalize counts to `[0, 1]` and feed to a colormap (viridis, magma, etc.):

```typescript
const intensity = result.grid[i] / result.maxCount;
const color = viridis(intensity);
```

**Performance:** runs on the WASM core (with a JS fallback). Force the path per call with the trailing call options: `bin2d(x, y, { xBins, yBins }, { backend: "js" })`.

**WebGPU (opt-in):** `{ backend: "webgpu" }` runs the wired WGSL compute shader, falling back silently to wasm/js whenever the GPU path can't run. To know which backend actually produced a result, use `bin2dWithBackend(x, y, opts, callOpts)` — it returns `{ result, backend: "webgpu" | "wasm" | "js" }` reporting the real outcome, not the request. It is never auto-selected, and on measured hardware it is ~15× slower than WASM end-to-end (upload + dispatch + readback dominate — see ADR 0004). Inputs are rebased in f64 before the f32 narrowing, so epoch-scale values bin correctly; a handful of edge-adjacent points may land one bin over versus the f64 cores.

## `hexbin(x, y, radius)`

Hexagonal binning — uses hexagons instead of squares, which look more visually balanced for density plots and avoid the diagonal artifacts of rectangular grids.

```typescript
const cells = await hexbin(x, y, /* radius */ 4);
// HexBinEntry[] where each entry is { cx, cy, count }
```

Each `HexBinEntry` is one hexagon center with the count of points falling inside it. Returns only **non-empty** cells, so the result is sparse (much smaller than a dense grid for sparse data).

**Choosing a radius:** smaller radius → finer detail, more cells. Larger radius → smoother, fewer cells. A good starting point is `radius ≈ canvasWidth / 100`.

**Rendering hexagons:**

```typescript
const cells = await hexbin(x, y, 4);
const maxCount = Math.max(...cells.map((c) => c.count));

for (const cell of cells) {
  const intensity = cell.count / maxCount;
  drawHexagon(cell.cx, cell.cy, /* radius */ 4, viridis(intensity));
}
```

## Performance reference

For measured numbers, run the suite in `benchmarks/` and see `benchmarks/results/`. As one backed data point, a 1M-point histogram (50 bins) runs in ~2.5 ms on the pure-JS core in Node (`benchmarks/results/comparison.json`). Whether WASM or JS is faster depends on the engine and its version — WASM won ~4× in Chromium through 148, near parity there since Chromium 149 (~1.1×), and the JS core is comparable or faster in Firefox and Safari; see ADR 0003 (`docs/adr/0003-wasm-vs-js-is-engine-dependent.md`) and `benchmarks/campaign/`.

## When to use which

| Goal                                  | Use                               |
| ------------------------------------- | --------------------------------- |
| Distribution of one variable          | `bin1d`                           |
| Density plot of `(x, y)` scatter      | `bin2d`                           |
| Smooth density without grid artifacts | `hexbin`                          |
| 3D volumetric density                 | [`bin3d`](bin3d.md)               |
| Spatial query (find points in a box)  | [`@vizcrush/spatial`](spatial.md) |

## See also

- **[@vizcrush/bin3d](bin3d.md)** — 3D voxel binning
- **[Examples / iot-heatmap](../reference/examples.md)** — end-to-end 2D heatmap
- **[Algorithms reference / Binning](../reference/algorithms.md#binning--density)**
