/**
 * Pure, synchronous JS cores for 2D spatial indexing — the kernel's JS
 * adapters. No WASM, no loading, no async. Imported by the async shell in
 * `index.ts`, by the parity harness, and by the MCP server, so there is exactly
 * one JS implementation of the quadtree and Morton ordering. Mirrors
 * `vizcrush_spatial`.
 */

export interface BBox {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface QuadNode {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  indices: number[];
  children: QuadNode[] | null;
}

export interface QuadtreeCore {
  root: QuadNode | null;
  xData: Float64Array;
  yData: Float64Array;
  pointCount: number;
  bounds: BBox;
}

const MAX_POINTS = 64;
const MAX_DEPTH = 12;

function buildNode(
  x: Float64Array,
  y: Float64Array,
  indices: number[],
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  depth: number,
): QuadNode {
  const contained = indices.filter(
    (i) => x[i] >= xMin && x[i] <= xMax && y[i] >= yMin && y[i] <= yMax,
  );

  if (contained.length <= MAX_POINTS || depth >= MAX_DEPTH) {
    return { xMin, xMax, yMin, yMax, indices: contained, children: null };
  }

  const xMid = (xMin + xMax) / 2;
  const yMid = (yMin + yMax) / 2;

  return {
    xMin,
    xMax,
    yMin,
    yMax,
    indices: [],
    children: [
      buildNode(x, y, contained, xMin, xMid, yMid, yMax, depth + 1), // NW
      buildNode(x, y, contained, xMid, xMax, yMid, yMax, depth + 1), // NE
      buildNode(x, y, contained, xMin, xMid, yMin, yMid, depth + 1), // SW
      buildNode(x, y, contained, xMid, xMax, yMin, yMid, depth + 1), // SE
    ],
  };
}

/**
 * Build a quadtree over 2D point data (pure JS). Mirrors
 * `vizcrush_spatial::build_quadtree` — same MAX_POINTS / MAX_DEPTH split and
 * the same 0.1% bounds padding.
 */
export function buildQuadtreeCore(x: Float64Array, y: Float64Array): QuadtreeCore {
  const n = x.length;
  if (n === 0) {
    return {
      root: null,
      xData: x,
      yData: y,
      pointCount: 0,
      bounds: { xMin: 0, xMax: 0, yMin: 0, yMax: 0 },
    };
  }

  let xMin = Infinity,
    xMax = -Infinity,
    yMin = Infinity,
    yMax = -Infinity;
  for (let i = 0; i < n; i++) {
    if (isFinite(x[i]) && isFinite(y[i])) {
      if (x[i] < xMin) xMin = x[i];
      if (x[i] > xMax) xMax = x[i];
      if (y[i] < yMin) yMin = y[i];
      if (y[i] > yMax) yMax = y[i];
    }
  }

  const pad = Math.max(xMax - xMin, yMax - yMin) * 0.001;
  xMin -= pad;
  xMax += pad;
  yMin -= pad;
  yMax += pad;

  const allIndices = Array.from({ length: n }, (_, i) => i);
  const root = buildNode(x, y, allIndices, xMin, xMax, yMin, yMax, 0);

  return {
    root,
    xData: x,
    yData: y,
    pointCount: n,
    bounds: { xMin, xMax, yMin, yMax },
  };
}

function rangeSearch(tree: QuadtreeCore, node: QuadNode, bbox: BBox, result: number[]): void {
  if (
    bbox.xMax < node.xMin ||
    bbox.xMin > node.xMax ||
    bbox.yMax < node.yMin ||
    bbox.yMin > node.yMax
  ) {
    return;
  }

  if (
    bbox.xMin <= node.xMin &&
    bbox.xMax >= node.xMax &&
    bbox.yMin <= node.yMin &&
    bbox.yMax >= node.yMax
  ) {
    collectAll(node, result);
    return;
  }

  for (const idx of node.indices) {
    const px = tree.xData[idx];
    const py = tree.yData[idx];
    if (px >= bbox.xMin && px <= bbox.xMax && py >= bbox.yMin && py <= bbox.yMax) {
      result.push(idx);
    }
  }

  if (node.children) {
    for (const child of node.children) {
      rangeSearch(tree, child, bbox, result);
    }
  }
}

function collectAll(node: QuadNode, result: number[]): void {
  for (const idx of node.indices) {
    result.push(idx);
  }
  if (node.children) {
    for (const child of node.children) {
      collectAll(child, result);
    }
  }
}

/** All points inside `bbox`, searched over a JS-built quadtree (pure JS). */
export function queryRangeCore(tree: QuadtreeCore, bbox: BBox): Uint32Array {
  const result: number[] = [];
  if (tree.root) {
    rangeSearch(tree, tree.root, bbox, result);
  }
  return new Uint32Array(result);
}

/** k-nearest-neighbour search over a JS-built quadtree (pure JS). */
export function queryNearestCore(
  tree: QuadtreeCore,
  px: number,
  py: number,
  k: number,
): Uint32Array {
  if (!tree.root || k === 0) return new Uint32Array(0);

  const candidates: Array<{ dist: number; idx: number }> = [];
  knnSearch(tree, tree.root, px, py, k, candidates, { value: Infinity });

  candidates.sort((a, b) => a.dist - b.dist);
  return new Uint32Array(candidates.slice(0, k).map((c) => c.idx));
}

function knnSearch(
  tree: QuadtreeCore,
  node: QuadNode,
  px: number,
  py: number,
  k: number,
  candidates: Array<{ dist: number; idx: number }>,
  maxDist: { value: number },
): void {
  const dx = px < node.xMin ? node.xMin - px : px > node.xMax ? px - node.xMax : 0;
  const dy = py < node.yMin ? node.yMin - py : py > node.yMax ? py - node.yMax : 0;
  const minDistSq = dx * dx + dy * dy;

  if (minDistSq > maxDist.value * maxDist.value && candidates.length >= k) {
    return;
  }

  for (const idx of node.indices) {
    const ddx = tree.xData[idx] - px;
    const ddy = tree.yData[idx] - py;
    const d = ddx * ddx + ddy * ddy;

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
      knnSearch(tree, child, px, py, k, candidates, maxDist);
    }
  }
}

// ── Morton-code ordering ──

/**
 * Reorder 2D points by Z-order (Morton) curve (pure JS). Returns indices sorted
 * by Morton code. Mirrors `vizcrush_spatial::morton_order_2d`.
 */
export function mortonOrder2dCore(x: Float64Array, y: Float64Array): Uint32Array {
  const n = Math.min(x.length, y.length);
  if (n === 0) return new Uint32Array();

  let xMin = Infinity,
    xMax = -Infinity,
    yMin = Infinity,
    yMax = -Infinity;
  for (let i = 0; i < n; i++) {
    if (isFinite(x[i]) && isFinite(y[i])) {
      if (x[i] < xMin) xMin = x[i];
      if (x[i] > xMax) xMax = x[i];
      if (y[i] < yMin) yMin = y[i];
      if (y[i] > yMax) yMax = y[i];
    }
  }

  const xRange = xMax > xMin ? xMax - xMin : 1;
  const yRange = yMax > yMin ? yMax - yMin : 1;
  const scale = (1 << 16) - 1; // 16-bit per dimension

  const indexed: [number, number][] = []; // [mortonCode, originalIndex]
  for (let i = 0; i < n; i++) {
    if (!isFinite(x[i]) || !isFinite(y[i])) {
      indexed.push([0xffffffff, i]); // NaN → sort to end
      continue;
    }
    const xi = Math.min(scale, Math.floor(((x[i] - xMin) / xRange) * scale));
    const yi = Math.min(scale, Math.floor(((y[i] - yMin) / yRange) * scale));
    indexed.push([mortonEncode2d(xi, yi), i]);
  }

  indexed.sort((a, b) => a[0] - b[0]);
  const result = new Uint32Array(n);
  for (let i = 0; i < n; i++) result[i] = indexed[i][1];
  return result;
}

function mortonEncode2d(x: number, y: number): number {
  x = spreadBits(x);
  y = spreadBits(y);
  return x | (y << 1);
}

function spreadBits(v: number): number {
  v = (v | (v << 8)) & 0x00ff00ff;
  v = (v | (v << 4)) & 0x0f0f0f0f;
  v = (v | (v << 2)) & 0x33333333;
  v = (v | (v << 1)) & 0x55555555;
  return v;
}

// ── Spatial Hash Grid ──

export interface SpatialHashGridCore {
  cellSize: number;
  invCellSize: number;
  cellCount: number;
  grid: Map<string, number[]>;
  xData: Float64Array;
  yData: Float64Array;
}

/**
 * Build a spatial hash grid over 2D point data (pure JS). Mirrors
 * `vizcrush_spatial::SpatialHashGrid::new` + `insert_batch` — non-finite
 * coordinates are silently skipped, same as the Rust adapter.
 */
export function buildHashGridCore(
  x: Float64Array,
  y: Float64Array,
  cellSize: number,
): SpatialHashGridCore {
  const invCellSize = 1 / cellSize;
  const grid = new Map<string, number[]>();
  const xData: number[] = [];
  const yData: number[] = [];

  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    if (!isFinite(x[i]) || !isFinite(y[i])) continue;
    const idx = xData.length;
    xData.push(x[i]);
    yData.push(y[i]);
    const cx = Math.floor(x[i] * invCellSize);
    const cy = Math.floor(y[i] * invCellSize);
    const key = `${cx},${cy}`;
    const cell = grid.get(key);
    if (cell) cell.push(idx);
    else grid.set(key, [idx]);
  }

  return {
    cellSize,
    invCellSize,
    cellCount: grid.size,
    grid,
    xData: new Float64Array(xData),
    yData: new Float64Array(yData),
  };
}

/** All points within `radius` of `(px, py)`, searched over a JS-built hash grid. */
export function hashGridQueryRadiusCore(
  core: SpatialHashGridCore,
  px: number,
  py: number,
  radius: number,
): Uint32Array {
  const r2 = radius * radius;
  const inv = core.invCellSize;
  const cxMin = Math.floor((px - radius) * inv);
  const cxMax = Math.floor((px + radius) * inv);
  const cyMin = Math.floor((py - radius) * inv);
  const cyMax = Math.floor((py + radius) * inv);

  const result: number[] = [];
  for (let cx = cxMin; cx <= cxMax; cx++) {
    for (let cy = cyMin; cy <= cyMax; cy++) {
      const cell = core.grid.get(`${cx},${cy}`);
      if (!cell) continue;
      for (const idx of cell) {
        const dx = core.xData[idx] - px;
        const dy = core.yData[idx] - py;
        if (dx * dx + dy * dy <= r2) result.push(idx);
      }
    }
  }
  return new Uint32Array(result);
}

/** All points inside an axis-aligned bounding box, searched over a JS-built hash grid. */
export function hashGridQueryRangeCore(
  core: SpatialHashGridCore,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
): Uint32Array {
  const inv = core.invCellSize;
  const cxMin = Math.floor(xMin * inv);
  const cxMax = Math.floor(xMax * inv);
  const cyMin = Math.floor(yMin * inv);
  const cyMax = Math.floor(yMax * inv);

  const result: number[] = [];
  for (let cx = cxMin; cx <= cxMax; cx++) {
    for (let cy = cyMin; cy <= cyMax; cy++) {
      const cell = core.grid.get(`${cx},${cy}`);
      if (!cell) continue;
      for (const idx of cell) {
        const xi = core.xData[idx];
        const yi = core.yData[idx];
        if (xi >= xMin && xi <= xMax && yi >= yMin && yi <= yMax) {
          result.push(idx);
        }
      }
    }
  }
  return new Uint32Array(result);
}
