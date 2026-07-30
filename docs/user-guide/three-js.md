# Three.js Integration

vizcrush pairs naturally with Three.js for rendering large 3D point clouds. The integration story is short:

1. Use **`buildOctree`** for spatial queries (hover, select, k-NN)
2. Use **`frustumCull`** to limit per-frame rendering to visible points
3. Combine the two for adaptive LOD on very large clouds

## The basic pattern

```typescript
import * as THREE from "three";
import { buildOctree, frustumCull } from "@vizcrush/spatial3d";

// 1. Your point data — typed arrays, one component per axis
const x = new Float64Array(/* … */);
const y = new Float64Array(/* … */);
const z = new Float64Array(/* … */);

// 2. Build a Three.js Points object backed by the same data
const geometry = new THREE.BufferGeometry();
const positions = new Float32Array(x.length * 3);
for (let i = 0; i < x.length; i++) {
  positions[i * 3] = x[i];
  positions[i * 3 + 1] = y[i];
  positions[i * 3 + 2] = z[i];
}
geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

const material = new THREE.PointsMaterial({ size: 0.05, color: 0x00ffff });
const points = new THREE.Points(geometry, material);
scene.add(points);

// 3. Build the octree once
const tree = await buildOctree(x, y, z);

// 4. Per-frame: cull and update draw range
const camera = new THREE.PerspectiveCamera(/* … */);
const mvp = new THREE.Matrix4();
const mvpArr = new Float64Array(16);

async function render() {
  camera.updateMatrixWorld();
  mvp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  mvp.toArray(mvpArr);

  const visible = await frustumCull(x, y, z, mvpArr);

  // Approach A: rebuild a position buffer with only the visible points
  // (good for very sparse visibility)
  const visiblePositions = new Float32Array(visible.length * 3);
  for (let i = 0; i < visible.length; i++) {
    const idx = visible[i];
    visiblePositions[i * 3] = x[idx];
    visiblePositions[i * 3 + 1] = y[idx];
    visiblePositions[i * 3 + 2] = z[idx];
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(visiblePositions, 3));
  geometry.attributes.position.needsUpdate = true;

  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

render();
```

## MVP matrix conversion

`frustumCull` expects a **column-major** `Float64Array` of length 16. Three.js's `Matrix4.toArray()` already returns column-major, so the conversion is just:

```typescript
const mvpArr = new Float64Array(16);
mvp.toArray(mvpArr);
```

(Note: `Float32Array` works too if you cast — vizcrush will convert internally with no loss for typical view matrices.)

## Hover detection (k-NN with screen-to-world unproject)

```typescript
const raycaster = new THREE.Raycaster();
const mouseNDC = new THREE.Vector2();

canvas.addEventListener("mousemove", async (e) => {
  // 1. Convert pixel to NDC
  const rect = canvas.getBoundingClientRect();
  mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  // 2. Cast a ray, sample a point at distance 100 from camera
  raycaster.setFromCamera(mouseNDC, camera);
  const probe = raycaster.ray.origin
    .clone()
    .add(raycaster.ray.direction.clone().multiplyScalar(100));

  // 3. Find the nearest point in the cloud to the ray sample
  const nearest = await queryNearest3d(tree, probe.x, probe.y, probe.z, 1);
  if (nearest.length > 0) {
    const idx = nearest[0];
    showTooltip(x[idx], y[idx], z[idx]);
  }
});
```

This is a simplification — for more accurate ray-vs-point picking, sweep the ray through several distances and take the nearest of all queries, or use a [point-to-ray distance test](../packages/spatial3d.md) per candidate.

## Adaptive LOD with density decimation

For point clouds in the 5M+ range, even frustum culling produces too many points to draw at 60fps. Combine with `bin3d` for density-based decimation:

```typescript
import { bin3d } from "@vizcrush/bin3d";

const density = await bin3d(x, y, z, { xBins: 64, yBins: 64, zBins: 64 });

async function render() {
  const visible = await frustumCull(x, y, z, mvpArr);

  // For each visible point, check if its voxel is "saturated" — if so, skip
  // most of the points in that voxel
  const culled: number[] = [];
  let lastVoxel = -1;
  let voxelCount = 0;
  for (let i = 0; i < visible.length; i++) {
    const idx = visible[i];
    const voxelIdx = computeVoxelIndex(x[idx], y[idx], z[idx], density);
    if (voxelIdx !== lastVoxel) {
      voxelCount = 0;
      lastVoxel = voxelIdx;
    }
    voxelCount++;
    // Render at most 100 points per voxel
    if (voxelCount <= 100) culled.push(idx);
  }

  drawPoints(culled);
  requestAnimationFrame(render);
}
```

The [`point-cloud-3d` example](../reference/examples.md) demonstrates the full version of this pattern.

## See also

- **[@vizcrush/spatial3d](../packages/spatial3d.md)** — full API for octree + frustum culling
- **[@vizcrush/bin3d](../packages/bin3d.md)** — voxel binning for adaptive LOD
- **[Examples / threejs-integration](../reference/examples.md)** — runnable demo
- **[Examples / point-cloud-3d](../reference/examples.md)** — million-point cloud with hover + LOD
