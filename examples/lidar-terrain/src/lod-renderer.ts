import type { OctreeHandle } from "@vizcrush/spatial3d";
import { queryRange3d } from "@vizcrush/spatial3d";

export interface CameraState {
  cx: number; // centre x (pan)
  cz: number; // centre z (pan)
  zoom: number; // pixels per world-unit
  tiltFactor: number; // 0..1 — how much z affects y on screen
}

export interface LODStats {
  totalRendered: number;
  nearCount: number;
  midCount: number;
  farCount: number;
  frameMs: number;
}

/**
 * Colour a point by elevation.
 *   low (< -20)  -> green (grass)
 *   mid (-20..20) -> brown (earth)
 *   high (> 20)  -> white (snow)
 * Returns an [r, g, b] tuple.
 */
function elevationColor(y: number): [number, number, number] {
  // Normalise to roughly -50..50 range
  const t = Math.max(0, Math.min(1, (y + 50) / 100));

  if (t < 0.3) {
    // Deep green to green
    const s = t / 0.3;
    return [Math.round(20 + 40 * s), Math.round(80 + 100 * s), Math.round(20 + 30 * s)];
  } else if (t < 0.6) {
    // Green to brown
    const s = (t - 0.3) / 0.3;
    return [Math.round(60 + 100 * s), Math.round(180 - 80 * s), Math.round(50 - 20 * s)];
  } else if (t < 0.85) {
    // Brown to light grey
    const s = (t - 0.6) / 0.25;
    return [Math.round(160 + 60 * s), Math.round(100 + 80 * s), Math.round(30 + 140 * s)];
  } else {
    // Grey to white (snow)
    const s = (t - 0.85) / 0.15;
    return [Math.round(220 + 35 * s), Math.round(180 + 75 * s), Math.round(170 + 85 * s)];
  }
}

/**
 * Render terrain points with level-of-detail decimation.
 *
 * Divides the view into distance bands from the camera centre:
 *   - near  (0 .. nearR):       full density (every point)
 *   - mid   (nearR .. midR):    every `midSkip` points
 *   - far   (midR ..):          every `farSkip` points
 *
 * `lodFactor` (1-10) controls aggressiveness:
 *   1 = gentle LOD (mid skip 2, far skip 4)
 *  10 = aggressive (mid skip 16, far skip 64)
 */
export function renderWithLOD(
  canvas: HTMLCanvasElement,
  points: { x: Float64Array; y: Float64Array; z: Float64Array },
  camera: CameraState,
  octree: OctreeHandle,
  lodFactor: number,
): LODStats {
  const t0 = performance.now();

  const ctx = canvas.getContext("2d")!;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;

  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // Distance band thresholds in world units
  const nearR = 100;
  const midR = 300;

  // LOD skip rates scale with lodFactor (1..10)
  const midSkip = Math.max(2, Math.round(2 + (lodFactor - 1) * 1.6));
  const farSkip = Math.max(4, Math.round(4 + (lodFactor - 1) * 6.7));

  // Query the three bands from the octree
  const nearIndices = queryRange3d(octree, {
    xMin: camera.cx - nearR,
    xMax: camera.cx + nearR,
    yMin: octree.bounds.yMin,
    yMax: octree.bounds.yMax,
    zMin: camera.cz - nearR,
    zMax: camera.cz + nearR,
  });

  const midIndices = queryRange3d(octree, {
    xMin: camera.cx - midR,
    xMax: camera.cx + midR,
    yMin: octree.bounds.yMin,
    yMax: octree.bounds.yMax,
    zMin: camera.cz - midR,
    zMax: camera.cz + midR,
  });

  const farIndices = queryRange3d(octree, {
    xMin: octree.bounds.xMin,
    xMax: octree.bounds.xMax,
    yMin: octree.bounds.yMin,
    yMax: octree.bounds.yMax,
    zMin: octree.bounds.zMin,
    zMax: octree.bounds.zMax,
  });

  // Build sets to deduplicate band membership (near takes priority over mid, etc.)
  const nearSet = new Set<number>();
  for (let i = 0; i < nearIndices.length; i++) nearSet.add(nearIndices[i]);

  const midSet = new Set<number>();
  for (let i = 0; i < midIndices.length; i++) {
    if (!nearSet.has(midIndices[i])) midSet.add(midIndices[i]);
  }

  const farSet = new Set<number>();
  for (let i = 0; i < farIndices.length; i++) {
    const idx = farIndices[i];
    if (!nearSet.has(idx) && !midSet.has(idx)) farSet.add(idx);
  }

  // Collect indices with appropriate decimation
  const renderIndices: number[] = [];

  // Near: full density
  for (const idx of nearSet) {
    renderIndices.push(idx);
  }
  const nearCount = renderIndices.length;

  // Mid: decimated
  let midCounter = 0;
  let midRendered = 0;
  for (const idx of midSet) {
    if (midCounter % midSkip === 0) {
      renderIndices.push(idx);
      midRendered++;
    }
    midCounter++;
  }

  // Far: heavily decimated
  let farCounter = 0;
  let farRendered = 0;
  for (const idx of farSet) {
    if (farCounter % farSkip === 0) {
      renderIndices.push(idx);
      farRendered++;
    }
    farCounter++;
  }

  // Sort by z (back to front) for correct overlap with the tilt view
  renderIndices.sort((a, b) => points.z[b] - points.z[a]);

  // Projection: top-down orthographic with slight 3D tilt
  const halfW = w / 2;
  const halfH = h / 2;
  const tilt = 0.35 * camera.tiltFactor;

  // Batch draw: bucket by color for fewer style switches
  const bucketCount = 12;
  const buckets: Array<Array<{ sx: number; sy: number; size: number }>> = Array.from(
    { length: bucketCount },
    () => [],
  );
  const bucketColors: [number, number, number][] = [];

  // Pre-compute colour per bucket (evenly spaced across elevation)
  for (let b = 0; b < bucketCount; b++) {
    const elev = -50 + (100 * b) / (bucketCount - 1);
    bucketColors.push(elevationColor(elev));
  }

  for (let i = 0; i < renderIndices.length; i++) {
    const idx = renderIndices[i];
    const px = points.x[idx];
    const py = points.y[idx];
    const pz = points.z[idx];

    // Project to screen
    const sx = halfW + (px - camera.cx) * camera.zoom;
    const sy = halfH + (pz - camera.cz) * camera.zoom * tilt - py * camera.zoom * 0.5;

    // Cull offscreen
    if (sx < -5 || sx > w + 5 || sy < -5 || sy > h + 5) continue;

    // Point size: slightly larger for nearer z
    const depthFade = 1 - Math.min(1, Math.abs(pz - camera.cz) / 400);
    const size = Math.max(0.5, 1.2 + 1.0 * depthFade);

    // Colour bucket
    const elevNorm = Math.max(0, Math.min(1, (py + 50) / 100));
    const b = Math.min(bucketCount - 1, Math.floor(elevNorm * bucketCount));
    buckets[b].push({ sx, sy, size });
  }

  // Draw buckets
  for (let b = 0; b < bucketCount; b++) {
    const pts = buckets[b];
    if (pts.length === 0) continue;

    const [r, g, bl] = bucketColors[b];
    ctx.fillStyle = `rgba(${r},${g},${bl},0.85)`;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      ctx.moveTo(p.sx + p.size, p.sy);
      ctx.arc(p.sx, p.sy, p.size, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  const frameMs = performance.now() - t0;
  const totalRendered = nearCount + midRendered + farRendered;

  return {
    totalRendered,
    nearCount,
    midCount: midRendered,
    farCount: farRendered,
    frameMs,
  };
}
