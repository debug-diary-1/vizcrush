/**
 * Pure, synchronous JS cores for 3D spatial indexing — the kernel's JS
 * adapters. No WASM, no loading, no async. Imported by the async shell in
 * `index.ts`, by the parity harness, and by the MCP server, so there is exactly
 * one JS implementation of the octree and frustum cull. Mirrors
 * `vizcrush_spatial3d`.
 */

export interface BBox3d {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  zMin: number;
  zMax: number;
}

export interface OctNode {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  zMin: number;
  zMax: number;
  indices: number[];
  children: OctNode[] | null;
}

export interface OctreeCore {
  root: OctNode | null;
  xData: Float64Array;
  yData: Float64Array;
  zData: Float64Array;
  pointCount: number;
  bounds: BBox3d;
}

const MAX_POINTS = 64;
const MAX_DEPTH = 12;

function buildNode(
  x: Float64Array,
  y: Float64Array,
  z: Float64Array,
  indices: number[],
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  zMin: number,
  zMax: number,
  depth: number,
): OctNode {
  const contained = indices.filter(
    (i) =>
      x[i] >= xMin && x[i] <= xMax && y[i] >= yMin && y[i] <= yMax && z[i] >= zMin && z[i] <= zMax,
  );

  if (contained.length <= MAX_POINTS || depth >= MAX_DEPTH) {
    return { xMin, xMax, yMin, yMax, zMin, zMax, indices: contained, children: null };
  }

  const xMid = (xMin + xMax) / 2;
  const yMid = (yMin + yMax) / 2;
  const zMid = (zMin + zMax) / 2;

  return {
    xMin,
    xMax,
    yMin,
    yMax,
    zMin,
    zMax,
    indices: [],
    children: [
      buildNode(x, y, z, contained, xMin, xMid, yMin, yMid, zMin, zMid, depth + 1), // 0: ---
      buildNode(x, y, z, contained, xMid, xMax, yMin, yMid, zMin, zMid, depth + 1), // 1: +--
      buildNode(x, y, z, contained, xMin, xMid, yMid, yMax, zMin, zMid, depth + 1), // 2: -+-
      buildNode(x, y, z, contained, xMid, xMax, yMid, yMax, zMin, zMid, depth + 1), // 3: ++-
      buildNode(x, y, z, contained, xMin, xMid, yMin, yMid, zMid, zMax, depth + 1), // 4: --+
      buildNode(x, y, z, contained, xMid, xMax, yMin, yMid, zMid, zMax, depth + 1), // 5: +-+
      buildNode(x, y, z, contained, xMin, xMid, yMid, yMax, zMid, zMax, depth + 1), // 6: -++
      buildNode(x, y, z, contained, xMid, xMax, yMid, yMax, zMid, zMax, depth + 1), // 7: +++
    ],
  };
}

/**
 * Build an octree over 3D point data (pure JS). Mirrors
 * `vizcrush_spatial3d::build_octree` — same MAX_POINTS / MAX_DEPTH split and
 * the same 0.1% bounds padding.
 */
export function buildOctreeCore(x: Float64Array, y: Float64Array, z: Float64Array): OctreeCore {
  const n = x.length;
  if (n === 0) {
    return {
      root: null,
      xData: x,
      yData: y,
      zData: z,
      pointCount: 0,
      bounds: { xMin: 0, xMax: 0, yMin: 0, yMax: 0, zMin: 0, zMax: 0 },
    };
  }

  let xMin = Infinity,
    xMax = -Infinity;
  let yMin = Infinity,
    yMax = -Infinity;
  let zMin = Infinity,
    zMax = -Infinity;

  for (let i = 0; i < n; i++) {
    if (isFinite(x[i]) && isFinite(y[i]) && isFinite(z[i])) {
      if (x[i] < xMin) xMin = x[i];
      if (x[i] > xMax) xMax = x[i];
      if (y[i] < yMin) yMin = y[i];
      if (y[i] > yMax) yMax = y[i];
      if (z[i] < zMin) zMin = z[i];
      if (z[i] > zMax) zMax = z[i];
    }
  }

  const pad = Math.max(xMax - xMin, yMax - yMin, zMax - zMin) * 0.001;
  xMin -= pad;
  xMax += pad;
  yMin -= pad;
  yMax += pad;
  zMin -= pad;
  zMax += pad;

  const allIndices = Array.from({ length: n }, (_, i) => i);
  const root = buildNode(x, y, z, allIndices, xMin, xMax, yMin, yMax, zMin, zMax, 0);

  return {
    root,
    xData: x,
    yData: y,
    zData: z,
    pointCount: n,
    bounds: { xMin, xMax, yMin, yMax, zMin, zMax },
  };
}

function rangeSearch(tree: OctreeCore, node: OctNode, bbox: BBox3d, result: number[]): void {
  if (
    bbox.xMax < node.xMin ||
    bbox.xMin > node.xMax ||
    bbox.yMax < node.yMin ||
    bbox.yMin > node.yMax ||
    bbox.zMax < node.zMin ||
    bbox.zMin > node.zMax
  ) {
    return;
  }

  if (
    bbox.xMin <= node.xMin &&
    bbox.xMax >= node.xMax &&
    bbox.yMin <= node.yMin &&
    bbox.yMax >= node.yMax &&
    bbox.zMin <= node.zMin &&
    bbox.zMax >= node.zMax
  ) {
    collectAll(node, result);
    return;
  }

  for (const idx of node.indices) {
    const px = tree.xData[idx];
    const py = tree.yData[idx];
    const pz = tree.zData[idx];
    if (
      px >= bbox.xMin &&
      px <= bbox.xMax &&
      py >= bbox.yMin &&
      py <= bbox.yMax &&
      pz >= bbox.zMin &&
      pz <= bbox.zMax
    ) {
      result.push(idx);
    }
  }

  if (node.children) {
    for (const child of node.children) {
      rangeSearch(tree, child, bbox, result);
    }
  }
}

function collectAll(node: OctNode, result: number[]): void {
  for (const idx of node.indices) {
    result.push(idx);
  }
  if (node.children) {
    for (const child of node.children) {
      collectAll(child, result);
    }
  }
}

/** All points inside a 3D `bbox`, searched over a JS-built octree (pure JS). */
export function queryRange3dCore(tree: OctreeCore, bbox: BBox3d): Uint32Array {
  const result: number[] = [];
  if (tree.root) {
    rangeSearch(tree, tree.root, bbox, result);
  }
  return new Uint32Array(result);
}

/** k-nearest-neighbour search in 3D over a JS-built octree (pure JS). */
export function queryNearest3dCore(
  tree: OctreeCore,
  px: number,
  py: number,
  pz: number,
  k: number,
): Uint32Array {
  if (!tree.root || k === 0) return new Uint32Array(0);

  const candidates: Array<{ dist: number; idx: number }> = [];
  knnSearch(tree, tree.root, px, py, pz, k, candidates, { value: Infinity });

  candidates.sort((a, b) => a.dist - b.dist);
  return new Uint32Array(candidates.slice(0, k).map((c) => c.idx));
}

function knnSearch(
  tree: OctreeCore,
  node: OctNode,
  px: number,
  py: number,
  pz: number,
  k: number,
  candidates: Array<{ dist: number; idx: number }>,
  maxDist: { value: number },
): void {
  const dx = px < node.xMin ? node.xMin - px : px > node.xMax ? px - node.xMax : 0;
  const dy = py < node.yMin ? node.yMin - py : py > node.yMax ? py - node.yMax : 0;
  const dz = pz < node.zMin ? node.zMin - pz : pz > node.zMax ? pz - node.zMax : 0;
  const minDistSq = dx * dx + dy * dy + dz * dz;

  if (minDistSq > maxDist.value * maxDist.value && candidates.length >= k) {
    return;
  }

  for (const idx of node.indices) {
    const ddx = tree.xData[idx] - px;
    const ddy = tree.yData[idx] - py;
    const ddz = tree.zData[idx] - pz;
    const d = ddx * ddx + ddy * ddy + ddz * ddz;

    if (candidates.length < k || d < maxDist.value * maxDist.value) {
      candidates.push({ dist: d, idx });
      candidates.sort((a, b) => a.dist - b.dist);
      if (candidates.length > k) candidates.length = k;
      if (candidates.length === k) {
        maxDist.value = Math.sqrt(candidates[candidates.length - 1].dist);
      }
    }
  }

  if (node.children) {
    for (const child of node.children) {
      knnSearch(tree, child, px, py, pz, k, candidates, maxDist);
    }
  }
}

/**
 * Frustum culling (pure JS): returns indices of points inside the frustum
 * defined by a column-major 4x4 MVP matrix. Mirrors
 * `vizcrush_spatial3d::build_frustum_from_mvp` + `frustum_cull`.
 */
export function frustumCullCore(
  x: Float64Array,
  y: Float64Array,
  z: Float64Array,
  mvpMatrix: Float64Array,
): Uint32Array {
  const n = x.length;
  if (n === 0) return new Uint32Array(0);

  const m = mvpMatrix;
  const planes: Array<[number, number, number, number]> = [
    // Left:   row3 + row0
    [m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]],
    // Right:  row3 - row0
    [m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]],
    // Bottom: row3 + row1
    [m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]],
    // Top:    row3 - row1
    [m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]],
    // Near:   row3 + row2
    [m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]],
    // Far:    row3 - row2
    [m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]],
  ];

  // Normalize planes
  for (const plane of planes) {
    const len = Math.sqrt(plane[0] * plane[0] + plane[1] * plane[1] + plane[2] * plane[2]);
    if (len > 0) {
      plane[0] /= len;
      plane[1] /= len;
      plane[2] /= len;
      plane[3] /= len;
    }
  }

  const result: number[] = [];

  for (let i = 0; i < n; i++) {
    const px = x[i];
    const py = y[i];
    const pz = z[i];

    let inside = true;
    for (const plane of planes) {
      const dist = plane[0] * px + plane[1] * py + plane[2] * pz + plane[3];
      if (dist < 0) {
        inside = false;
        break;
      }
    }

    if (inside) {
      result.push(i);
    }
  }

  return new Uint32Array(result);
}
