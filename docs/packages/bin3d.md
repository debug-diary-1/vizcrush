# @vizcrush/bin3d

3D voxel binning for volumetric heatmaps — think medical imaging, LiDAR density, voxelized point clouds, particle simulations, or any "count points per cell in 3D space" workflow.

## Import

```typescript
import { bin3d } from "@vizcrush/bin3d";
```

## `bin3d(x, y, z, options?)`

```typescript
const result = await bin3d(x, y, z, {
  xBins: 32,
  yBins: 32,
  zBins: 32,
});
// {
//   grid: Uint32Array,            // length: xBins * yBins * zBins
//   xEdges: Float64Array,         // length: xBins + 1
//   yEdges: Float64Array,         // length: yBins + 1
//   zEdges: Float64Array,         // length: zBins + 1
//   maxCount: number,
// }
```

**Full options:**

```typescript
interface Bin3dOptions {
  xBins?: number; // default 32
  yBins?: number; // default 32
  zBins?: number; // default 32
  xRange?: [number, number]; // default: auto from data
  yRange?: [number, number]; // default: auto from data
  zRange?: [number, number]; // default: auto from data
}
```

## Grid layout

The grid is **flat-indexed** in `(z, y, x)` order:

```typescript
function voxelAt(
  grid: Uint32Array,
  xBins: number,
  yBins: number,
  xi: number,
  yi: number,
  zi: number,
): number {
  return grid[zi * xBins * yBins + yi * xBins + xi];
}
```

This layout is cache-friendly for slicing along z (e.g. extracting an XY plane at a fixed depth), which is what most volume renderers want.

## Picking a resolution

3D grids grow cubically. Some common sizes:

| Resolution | Voxel count | Memory (Uint32) | Use case                         |
| ---------- | ----------- | --------------- | -------------------------------- |
| 16³        | 4,096       | 16 KB           | Coarse density preview           |
| 32³        | 32,768      | 128 KB          | Default — balanced               |
| 64³        | 262,144     | 1 MB            | Higher fidelity, still real-time |
| 128³       | 2,097,152   | 8 MB            | Offline rendering, max detail    |

256³ is 16 MB for the count grid alone — feasible but you'll feel it in browser memory and frame times. Stick to ≤ 128³ for interactive use.

## Rendering volumes

### As 2D slices

The simplest way to display a `bin3d` result is as a stack of 2D slices — pick a slice axis (X/Y/Z) and a slice index, then render the corresponding 2D plane as a heatmap:

```typescript
function extractZSlice(grid: Uint32Array, xBins: number, yBins: number, zi: number): Uint32Array {
  const slice = new Uint32Array(xBins * yBins);
  for (let yi = 0; yi < yBins; yi++) {
    for (let xi = 0; xi < xBins; xi++) {
      slice[yi * xBins + xi] = grid[zi * xBins * yBins + yi * xBins + xi];
    }
  }
  return slice;
}
```

The [medical-volume example](../reference/examples.md) does exactly this with axis switching + animated rotation.

### As 3D voxel cubes

For "Minecraft-style" volumetric rendering, iterate the grid and emit one cube per non-empty voxel:

```typescript
for (let zi = 0; zi < zBins; zi++) {
  for (let yi = 0; yi < yBins; yi++) {
    for (let xi = 0; xi < xBins; xi++) {
      const count = grid[zi * xBins * yBins + yi * xBins + xi];
      if (count === 0) continue;
      const intensity = count / maxCount;
      drawCube(xi, yi, zi, viridis(intensity));
    }
  }
}
```

For dense grids this gets expensive quickly — use a spatial index ([@vizcrush/spatial3d](spatial3d.md)) or only emit voxels above a density threshold.

## Performance reference

| Resolution | 1M points |
| ---------- | --------- |
| 32³        | 8 ms      |
| 64³        | 14 ms     |
| 128³       | 38 ms     |

## See also

- **[@vizcrush/spatial3d](spatial3d.md)** — for "find all points in a 3D bounding box" instead of "count per cell"
- **[Examples / medical-volume, lidar-terrain, voxel-heatmap-3d](../reference/examples.md)** — three different volumetric use cases
