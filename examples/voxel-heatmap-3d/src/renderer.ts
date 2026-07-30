import { type ColorScaleFn, viridis3d } from "./color-scale";

export interface RenderOptions {
  canvas: HTMLCanvasElement;
  grid: Float64Array | Uint32Array | number[];
  xBins: number;
  yBins: number;
  zBins: number;
  maxCount: number;
  rotationX: number; // radians
  rotationY: number; // radians
  colorScale?: ColorScaleFn;
}

interface Voxel {
  ix: number;
  iy: number;
  iz: number;
  count: number;
  depth: number;
}

/**
 * Render a 3D voxel grid as an isometric cube display on a 2D canvas.
 * Each non-zero cell is drawn as a small cube with 3 visible faces.
 * Cubes are sorted back-to-front (painter's algorithm) for correct overlap.
 */
export function renderVoxels(opts: RenderOptions): void {
  const {
    canvas,
    grid,
    xBins,
    yBins,
    zBins,
    maxCount,
    rotationX,
    rotationY,
    colorScale = viridis3d,
  } = opts;

  const ctx = canvas.getContext("2d")!;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Clear
  ctx.fillStyle = "#0a0a0f";
  ctx.fillRect(0, 0, w, h);

  // Collect non-zero voxels
  const voxels: Voxel[] = [];
  for (let iz = 0; iz < zBins; iz++) {
    for (let iy = 0; iy < yBins; iy++) {
      for (let ix = 0; ix < xBins; ix++) {
        const idx = iz * yBins * xBins + iy * xBins + ix;
        const count = grid[idx];
        if (count > 0) {
          voxels.push({ ix, iy, iz, count, depth: 0 });
        }
      }
    }
  }

  if (voxels.length === 0) return;

  // Cube size in screen pixels
  const maxDim = Math.max(xBins, yBins, zBins);
  const cubeSize = (Math.min(w, h) * 0.55) / maxDim;

  // Center offset so the grid is centered in the canvas
  const cx = w / 2;
  const cy = h / 2;

  // Rotation matrices (Y-axis then X-axis)
  const cosY = Math.cos(rotationY);
  const sinY = Math.sin(rotationY);
  const cosX = Math.cos(rotationX);
  const sinX = Math.sin(rotationX);

  // Transform a grid-local 3D point to rotated 3D
  function rotate(x: number, y: number, z: number): [number, number, number] {
    // Center the grid around origin
    const hx = xBins / 2;
    const hy = yBins / 2;
    const hz = zBins / 2;
    let rx = x - hx;
    let ry = y - hy;
    let rz = z - hz;

    // Rotate around Y axis
    const x1 = rx * cosY + rz * sinY;
    const z1 = -rx * sinY + rz * cosY;

    // Rotate around X axis
    const y1 = ry * cosX - z1 * sinX;
    const z2 = ry * sinX + z1 * cosX;

    return [x1, y1, z2];
  }

  // Isometric projection: 3D -> 2D
  const cos30 = Math.cos(Math.PI / 6);
  const sin30 = Math.sin(Math.PI / 6);

  function project(x3: number, y3: number, z3: number): [number, number] {
    const sx = cx + (x3 - z3) * cos30 * cubeSize;
    const sy = cy - y3 * cubeSize + (x3 + z3) * sin30 * cubeSize;
    return [sx, sy];
  }

  // Compute depth for sorting (back-to-front)
  for (const v of voxels) {
    const [, , z2] = rotate(v.ix + 0.5, v.iy + 0.5, v.iz + 0.5);
    v.depth = z2;
  }

  // Sort back-to-front: draw far voxels first
  voxels.sort((a, b) => a.depth - b.depth);

  // Draw each voxel as a cube with 3 visible faces
  for (const v of voxels) {
    const t = v.count / maxCount;
    const color = colorScale(t);
    const { r, g, b, a } = color;

    // 8 corners of the unit cube at grid position
    const x0 = v.ix;
    const y0 = v.iy;
    const z0 = v.iz;
    const x1 = v.ix + 1;
    const y1 = v.iy + 1;
    const z1 = v.iz + 1;

    // Rotate and project all 8 corners
    const c000 = project(...rotate(x0, y0, z0));
    const c100 = project(...rotate(x1, y0, z0));
    const c010 = project(...rotate(x0, y1, z0));
    const c110 = project(...rotate(x1, y1, z0));
    const c001 = project(...rotate(x0, y0, z1));
    const _c101 = project(...rotate(x1, y0, z1));
    const c011 = project(...rotate(x0, y1, z1));
    const c111 = project(...rotate(x1, y1, z1));

    // Top face (y = y1)
    ctx.beginPath();
    ctx.moveTo(c010[0], c010[1]);
    ctx.lineTo(c110[0], c110[1]);
    ctx.lineTo(c111[0], c111[1]);
    ctx.lineTo(c011[0], c011[1]);
    ctx.closePath();
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`;
    ctx.fill();

    // Left face (x = x0)
    ctx.beginPath();
    ctx.moveTo(c000[0], c000[1]);
    ctx.lineTo(c010[0], c010[1]);
    ctx.lineTo(c011[0], c011[1]);
    ctx.lineTo(c001[0], c001[1]);
    ctx.closePath();
    ctx.fillStyle = `rgba(${Math.round(r * 0.7)}, ${Math.round(g * 0.7)}, ${Math.round(b * 0.7)}, ${a})`;
    ctx.fill();

    // Right face (z = z0)
    ctx.beginPath();
    ctx.moveTo(c000[0], c000[1]);
    ctx.lineTo(c100[0], c100[1]);
    ctx.lineTo(c110[0], c110[1]);
    ctx.lineTo(c010[0], c010[1]);
    ctx.closePath();
    ctx.fillStyle = `rgba(${Math.round(r * 0.85)}, ${Math.round(g * 0.85)}, ${Math.round(b * 0.85)}, ${a})`;
    ctx.fill();
  }
}
