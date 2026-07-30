# @vizcrush/spatial

2D spatial indexing — quadtree-based range queries and k-nearest-neighbor search over million-point scatter datasets. Build the index once, query it many times for hover detection, region selection, or "find the 10 nearest points to my mouse".

## Import

```typescript
import { buildQuadtree, queryRange, queryNearest } from "@vizcrush/spatial";
```

## `buildQuadtree(x, y)`

Construct a 2D spatial index over a point set. Returns an opaque handle you pass to subsequent queries.

```typescript
const x = new Float64Array(/* … */);
const y = new Float64Array(/* … */);

const tree = await buildQuadtree(x, y);
// {
//   id: number,
//   pointCount: number,
//   bounds: { xMin, xMax, yMin, yMax },
//   _tree: …,        // internal — don't touch
//   _wasmTree?: …,   // internal — don't touch
// }
```

**Configuration (compile-time):**

- **Max points per leaf:** 64 — leaves split into 4 children when this is exceeded.
- **Max depth:** 12 — hard cap to bound worst-case build time on degenerate inputs.

**Cost:** O(n log n) build — ~145 ms for 500K points measured in Node (`benchmarks/results/comparison.json`).

**Memory:** ~40 bytes per point (overhead) plus the original arrays which the tree references.

## `queryRange(tree, bbox)`

Find all points within an axis-aligned bounding box.

```typescript
const indices = await queryRange(tree, {
  xMin: 100,
  xMax: 200,
  yMin: 50,
  yMax: 150,
});
// Uint32Array of point indices into the original x/y arrays
```

The returned `Uint32Array` indexes back into the `x` and `y` arrays you passed to `buildQuadtree`. To get coordinates:

```typescript
for (let i = 0; i < indices.length; i++) {
  const idx = indices[i];
  console.log(x[idx], y[idx]);
}
```

**Cost:** O(log n + k) where k is the number of points in the box.

## `queryNearest(tree, px, py, k)`

Find the k nearest points to a query position.

```typescript
const indices = await queryNearest(tree, /* px */ 150, /* py */ 100, /* k */ 10);
// Uint32Array of length 10 — indices of the 10 nearest points, sorted by distance
```

**Cost:** O(log n) for small k. Internally uses a bounded priority-queue traversal of the quadtree.

## Common patterns

### Hover detection in a scatter plot

```typescript
const tree = await buildQuadtree(x, y);

canvas.addEventListener("mousemove", async (e) => {
  const { dataX, dataY } = pixelToData(e.clientX, e.clientY);
  const nearest = await queryNearest(tree, dataX, dataY, 1);
  if (nearest.length > 0) {
    const idx = nearest[0];
    showTooltip(x[idx], y[idx]);
  }
});
```

### Lasso / box selection

```typescript
async function onBoxSelect(box: { xMin; xMax; yMin; yMax }) {
  const indices = await queryRange(tree, box);
  highlight(indices);
}
```

### Density-aware decimation

Combine with `bin2d` to skip rendering buckets with high density:

```typescript
const density = await bin2d(x, y, { xBins: 64, yBins: 64 });

// Per pixel cluster: query the tree, but only render N representative points per cluster
for (let yi = 0; yi < density.yBins; yi++) {
  for (let xi = 0; xi < density.xBins; xi++) {
    const count = density.grid[yi * density.xBins + xi];
    if (count > 1000) {
      // dense — sample only 5 representatives
      const indices = await queryRange(tree, cellToBox(xi, yi));
      const sample = sampleN(indices, 5);
      drawPoints(sample);
    } else {
      // sparse — draw all
      drawPoints(/* all in bucket */);
    }
  }
}
```

## Performance reference

Measured in Node (`benchmarks/results/comparison.json` — run the suite in `benchmarks/` to reproduce):

| Operation                     | 100K  | 500K    |
| ----------------------------- | ----- | ------- |
| `buildQuadtree`               | 25 ms | 146 ms  |
| `queryRange` (1% of the data) | —     | 0.02 ms |

Query times are essentially independent of dataset size once the tree is built — that's the whole point of the index. Whether the WASM or JS core is faster for the build depends on the engine; see ADR 0003.

## When to use a quadtree

- ✅ You'll query the same dataset many times (build once, query often)
- ✅ Queries are spatial: "what's near this point?" or "what's in this box?"
- ✅ Hover, click, lasso selection in scatter plots
- ✅ Spatial joins between two datasets
- ❌ One-off filtering — use `filterRange` from [@vizcrush/transform](transform.md) instead
- ❌ Density visualization — use `bin2d` from [@vizcrush/bin](bin.md)

## See also

- **[@vizcrush/spatial3d](spatial3d.md)** — 3D version with octree + frustum culling
- **[Algorithms reference / Spatial indexing](../reference/algorithms.md#spatial-indexing)**
