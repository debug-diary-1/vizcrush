export interface Bin3dResult {
  grid: Uint32Array; // flat z*y*x grid
  xEdges: Float64Array;
  yEdges: Float64Array;
  zEdges: Float64Array;
  maxCount: number;
}

export interface Bin3dOptions {
  xBins?: number; // default 32
  yBins?: number; // default 32
  zBins?: number; // default 32
  xRange?: [number, number];
  yRange?: [number, number];
  zRange?: [number, number];
}

/**
 * Pure, synchronous JS core for 3D voxel binning — the kernel's JS adapter.
 * No WASM, no loading, no async. Imported by the async shell in `index.ts`, by
 * the parity harness, and by the MCP server, so there is exactly one JS
 * implementation. Mirrors `vizcrush_bin3d::bin3d`.
 */
export function bin3dCore(
  x: Float64Array,
  y: Float64Array,
  z: Float64Array,
  opts?: Bin3dOptions,
): Bin3dResult {
  const n = x.length;
  const xBins = opts?.xBins ?? 32;
  const yBins = opts?.yBins ?? 32;
  const zBins = opts?.zBins ?? 32;

  // Determine ranges.
  let xMin: number, xMax: number;
  let yMin: number, yMax: number;
  let zMin: number, zMax: number;

  const hasXRange = !!opts?.xRange;
  const hasYRange = !!opts?.yRange;
  const hasZRange = !!opts?.zRange;

  if (hasXRange) {
    [xMin, xMax] = opts!.xRange!;
  } else {
    xMin = Infinity;
    xMax = -Infinity;
  }
  if (hasYRange) {
    [yMin, yMax] = opts!.yRange!;
  } else {
    yMin = Infinity;
    yMax = -Infinity;
  }
  if (hasZRange) {
    [zMin, zMax] = opts!.zRange!;
  } else {
    zMin = Infinity;
    zMax = -Infinity;
  }

  // Single pass for all auto-range detection.
  if (!hasXRange || !hasYRange || !hasZRange) {
    for (let i = 0; i < n; i++) {
      if (!hasXRange) {
        if (x[i] < xMin) xMin = x[i];
        if (x[i] > xMax) xMax = x[i];
      }
      if (!hasYRange) {
        if (y[i] < yMin) yMin = y[i];
        if (y[i] > yMax) yMax = y[i];
      }
      if (!hasZRange) {
        if (z[i] < zMin) zMin = z[i];
        if (z[i] > zMax) zMax = z[i];
      }
    }
    if (!isFinite(xMin)) {
      xMin = 0;
      xMax = 1;
    }
    if (!isFinite(yMin)) {
      yMin = 0;
      yMax = 1;
    }
    if (!isFinite(zMin)) {
      zMin = 0;
      zMax = 1;
    }
  }

  // Handle min==max edge case.
  if (xMin === xMax) {
    xMin -= 0.5;
    xMax += 0.5;
  }
  if (yMin === yMax) {
    yMin -= 0.5;
    yMax += 0.5;
  }
  if (zMin === zMax) {
    zMin -= 0.5;
    zMax += 0.5;
  }

  const xRange = xMax - xMin;
  const yRange = yMax - yMin;
  const zRange = zMax - zMin;

  // Precompute reciprocals — multiply is ~10x faster than divide.
  const xInv = xBins / xRange;
  const yInv = yBins / yRange;
  const zInv = zBins / zRange;
  const xyBins = yBins * xBins;

  const totalBins = xBins * yBins * zBins;
  const grid = new Uint32Array(totalBins);
  let maxCount = 0;

  for (let i = 0; i < n; i++) {
    const px = x[i];
    const py = y[i];
    const pz = z[i];

    let xi = ((px - xMin) * xInv) | 0;
    let yi = ((py - yMin) * yInv) | 0;
    let zi = ((pz - zMin) * zInv) | 0;

    if (xi < 0) xi = 0;
    if (xi >= xBins) xi = xBins - 1;
    if (yi < 0) yi = 0;
    if (yi >= yBins) yi = yBins - 1;
    if (zi < 0) zi = 0;
    if (zi >= zBins) zi = zBins - 1;

    const binIdx = zi * xyBins + yi * xBins + xi;
    grid[binIdx]++;
    if (grid[binIdx] > maxCount) maxCount = grid[binIdx];
  }

  const xEdges = new Float64Array(xBins + 1);
  const yEdges = new Float64Array(yBins + 1);
  const zEdges = new Float64Array(zBins + 1);

  for (let i = 0; i <= xBins; i++) xEdges[i] = xMin + (xRange / xBins) * i;
  for (let i = 0; i <= yBins; i++) yEdges[i] = yMin + (yRange / yBins) * i;
  for (let i = 0; i <= zBins; i++) zEdges[i] = zMin + (zRange / zBins) * i;

  return { grid, xEdges, yEdges, zEdges, maxCount };
}
