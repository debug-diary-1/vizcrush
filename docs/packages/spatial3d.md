# @vizcrush/spatial3d

3D spatial indexing — octree range queries, k-nearest-neighbor search, and **frustum culling** for GPU rendering of large point clouds.

If you're rendering 3D data with Three.js, Babylon, or a custom WebGPU pipeline, frustum culling is the killer feature: extract the 6 view-frustum planes from your camera's MVP matrix and let vizcrush filter your million-point cloud down to just what's visible — in single-digit milliseconds.

## Import

```typescript
import { buildOctree, queryRange3d, queryNearest3d, frustumCull } from "@vizcrush/spatial3d";
```

## `buildOctree(x, y, z)`

```typescript
const x = new Float64Array(/* … */);
const y = new Float64Array(/* … */);
const z = new Float64Array(/* … */);

const tree = await buildOctree(x, y, z);
// {
//   id: number,
//   pointCount: number,
//   bounds: { xMin, xMax, yMin, yMax, zMin, zMax },
//   _tree, _wasmTree
// }
```

**Configuration:** same as quadtree — `MAX_POINTS = 64` per leaf, `MAX_DEPTH = 12`. Each split creates 8 octants.

**Cost:** O(n log n) build — ~200 ms for 500K points measured in Node (`benchmarks/results/comparison3d.json`).

## `queryRange3d(tree, bbox)`

Range query over a 3D axis-aligned bounding box.

```typescript
const indices = await queryRange3d(tree, {
  xMin: 0,
  xMax: 100,
  yMin: 0,
  yMax: 100,
  zMin: 0,
  zMax: 50,
});
// Uint32Array of indices into x/y/z
```

## `queryNearest3d(tree, px, py, pz, k)`

k-nearest neighbors in 3D.

```typescript
const nearest = await queryNearest3d(tree, /* px */ 50, /* py */ 50, /* pz */ 25, /* k */ 5);
// Uint32Array of length 5
```

## `frustumCull(x, y, z, mvpMatrix)`

**The big one.** Extract view-frustum planes from a 4×4 MVP matrix and return the indices of all points visible inside the frustum.

```typescript
import { frustumCull } from "@vizcrush/spatial3d";

// mvpMatrix from your camera (Three.js, custom, etc.)
// Must be column-major Float64Array of length 16
const mvpMatrix = new Float64Array(16);
threeCamera.projectionMatrix.multiply(threeCamera.matrixWorldInverse).toArray(mvpMatrix);

const visible = await frustumCull(x, y, z, mvpMatrix);
// Uint32Array of point indices visible in the current view
```

The function:

1. Extracts the 6 frustum planes (left, right, top, bottom, near, far) from the MVP matrix in Rust
2. Tests every point against all 6 planes
3. Returns the indices that pass

**Cost:** linear in the input — ~4.5 ms for 500K points measured in Node (`benchmarks/results/comparison3d.json`). Far cheaper than rebuilding a per-frame octree query.

**Note:** `frustumCull` does _not_ require a pre-built octree. It works directly on the raw `x/y/z` arrays. For very large clouds (10M+ points), you can combine the two: build an octree once, prune at the node level, then frustum-test the surviving points. The `point-cloud-3d` example shows this pattern.

## Three.js integration

```typescript
import * as THREE from "three";
import { frustumCull } from "@vizcrush/spatial3d";

const camera = new THREE.PerspectiveCamera(/* … */);
const x = /* Float64Array of point positions */;
const y = /* … */;
const z = /* … */;

function render() {
  // 1. Update camera matrices
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();

  // 2. Compose MVP — column-major Float64Array of length 16
  const mvp = new THREE.Matrix4()
    .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const mvpArr = new Float64Array(mvp.elements);

  // 3. Cull
  const visible = await frustumCull(x, y, z, mvpArr);

  // 4. Update Three.js geometry to render only visible points
  geometry.setDrawRange(0, visible.length);
  // (or rebuild a position buffer from visible indices)

  renderer.render(scene, camera);
  requestAnimationFrame(render);
}
```

The full pattern is in the [`threejs-integration` example](../reference/examples.md).

## Common patterns

### Adaptive LOD with octree + frustum

```typescript
const tree = await buildOctree(x, y, z);

function render() {
  const visibleIndices = await frustumCull(x, y, z, mvpMatrix);
  // Optionally: density-decimate visibleIndices before rendering
  // (e.g. only render every Nth point if camera is far away)
  drawPoints(visibleIndices);
}
```

### k-NN for tooltip in 3D

```typescript
const tree = await buildOctree(x, y, z);

canvas.addEventListener("mousemove", async (e) => {
  // Project mouse to a world ray, sample point on the ray
  const { wx, wy, wz } = pixelToWorld(e.clientX, e.clientY);
  const nearest = await queryNearest3d(tree, wx, wy, wz, 1);
  if (nearest.length > 0) showTooltip3d(nearest[0]);
});
```

## Performance reference

Measured in Node (`benchmarks/results/comparison3d.json` — run the suite in `benchmarks/` to reproduce):

| Operation                  | 100K  | 500K    |
| -------------------------- | ----- | ------- |
| `buildOctree`              | 33 ms | 202 ms  |
| `queryRange3d` (5% volume) | —     | 0.01 ms |
| `queryNearest3d` (k=10)    | —     | 0.29 ms |
| `frustumCull`              | —     | 4.5 ms  |

Whether the WASM or JS core is faster depends on the engine; see ADR 0003.

## See also

- **[@vizcrush/bin3d](bin3d.md)** — voxel binning for 3D density
- **[Three.js Integration guide](../user-guide/three-js.md)** — full pattern walkthrough
- **[Examples / point-cloud-3d, threejs-integration](../reference/examples.md)**
