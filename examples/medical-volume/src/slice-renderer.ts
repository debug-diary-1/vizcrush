/**
 * Color map functions: map a normalized density [0, 1] to RGBA values.
 */

type ColorMap = (t: number) => [number, number, number];

const colorMaps: Record<string, ColorMap> = {
  grayscale(t: number): [number, number, number] {
    const v = Math.round(t * 255);
    return [v, v, v];
  },

  bone(t: number): [number, number, number] {
    // Dark blue-gray to light yellowish-white
    const r = Math.round(lerp(0, 255, Math.min(1, t * 1.2)));
    const g = Math.round(lerp(0, 240, Math.min(1, t * 1.1)));
    const b = Math.round(lerp(20, 215, t));
    return [r, g, b];
  },

  hot(t: number): [number, number, number] {
    // Black -> Red -> Yellow -> White
    let r: number, g: number, b: number;
    if (t < 0.33) {
      const s = t / 0.33;
      r = Math.round(s * 255);
      g = 0;
      b = 0;
    } else if (t < 0.66) {
      const s = (t - 0.33) / 0.33;
      r = 255;
      g = Math.round(s * 255);
      b = 0;
    } else {
      const s = (t - 0.66) / 0.34;
      r = 255;
      g = 255;
      b = Math.round(s * 255);
    }
    return [r, g, b];
  },
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export type SliceAxis = "x" | "y" | "z";

/**
 * Render a 2D slice from the 3D voxel grid onto a canvas.
 *
 * The grid is indexed as grid[zi * yBins * xBins + yi * xBins + xi].
 *
 * @param canvas    - the target canvas element
 * @param grid      - the flat voxel grid (density values, Uint32Array from bin3d)
 * @param xBins     - grid resolution along X
 * @param yBins     - grid resolution along Y
 * @param zBins     - grid resolution along Z
 * @param maxCount  - max density value (for normalization)
 * @param axis      - which axis to slice along: 'x', 'y', or 'z'
 * @param position  - the slice index along the chosen axis
 * @param colorMap  - name of the color map to use
 */
export function renderSlice(
  canvas: HTMLCanvasElement,
  grid: Uint32Array,
  xBins: number,
  yBins: number,
  zBins: number,
  maxCount: number,
  axis: SliceAxis,
  position: number,
  colorMapName: string,
): void {
  const ctx = canvas.getContext("2d")!;
  const colorFn = colorMaps[colorMapName] ?? colorMaps.grayscale;

  // Determine slice dimensions based on axis
  let sliceW: number;
  let sliceH: number;

  switch (axis) {
    case "z": // Axial: slice at a fixed Z, show X (horizontal) x Y (vertical)
      sliceW = xBins;
      sliceH = yBins;
      break;
    case "y": // Coronal: slice at a fixed Y, show X (horizontal) x Z (vertical)
      sliceW = xBins;
      sliceH = zBins;
      break;
    case "x": // Sagittal: slice at a fixed X, show Y (horizontal) x Z (vertical)
      sliceW = yBins;
      sliceH = zBins;
      break;
  }

  // Set canvas to slice resolution, then scale up via CSS
  canvas.width = sliceW;
  canvas.height = sliceH;

  // Determine display size (fit within the parent while maintaining aspect)
  const maxDisplay =
    Math.min(canvas.parentElement?.clientWidth ?? 512, canvas.parentElement?.clientHeight ?? 512) -
    32;
  const scale = Math.floor(maxDisplay / Math.max(sliceW, sliceH));
  const displayW = sliceW * Math.max(1, scale);
  const displayH = sliceH * Math.max(1, scale);
  canvas.style.width = `${displayW}px`;
  canvas.style.height = `${displayH}px`;

  const imageData = ctx.createImageData(sliceW, sliceH);
  const pixels = imageData.data;
  const safeMax = maxCount > 0 ? maxCount : 1;

  for (let row = 0; row < sliceH; row++) {
    for (let col = 0; col < sliceW; col++) {
      let xi: number, yi: number, zi: number;

      switch (axis) {
        case "z":
          xi = col;
          yi = row;
          zi = position;
          break;
        case "y":
          xi = col;
          yi = position;
          zi = row;
          break;
        case "x":
          xi = position;
          yi = col;
          zi = row;
          break;
      }

      const gridIdx = zi * yBins * xBins + yi * xBins + xi;
      const count = grid[gridIdx] ?? 0;
      const t = count / safeMax;

      const [r, g, b] = colorFn(t);
      const pixIdx = (row * sliceW + col) * 4;
      pixels[pixIdx] = r;
      pixels[pixIdx + 1] = g;
      pixels[pixIdx + 2] = b;
      pixels[pixIdx + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

/**
 * Render a small 3D wireframe cube overview showing the current slice plane.
 */
export function renderOverview(
  canvas: HTMLCanvasElement,
  axis: SliceAxis,
  position: number,
  gridSize: number,
  rotation: number,
): void {
  const ctx = canvas.getContext("2d")!;
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
  const size = w * 0.35;

  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);
  const cosT = Math.cos(0.5); // slight tilt
  const sinT = Math.sin(0.5);

  // Project a 3D point (normalized -1 to 1) to 2D
  function project(x: number, y: number, z: number): [number, number] {
    // Rotate around Y axis
    const x1 = x * cosR + z * sinR;
    const z1 = -x * sinR + z * cosR;
    // Tilt around X axis
    const y1 = y * cosT - z1 * sinT;
    const z2 = y * sinT + z1 * cosT;

    // Simple perspective
    const scale = 1.8 / (3 + z2);
    return [cx + x1 * size * scale, cy - y1 * size * scale];
  }

  // Cube corners (normalized -1 to 1)
  const corners: [number, number, number][] = [
    [-1, -1, -1],
    [1, -1, -1],
    [1, 1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
    [1, -1, 1],
    [1, 1, 1],
    [-1, 1, 1],
  ];

  const edges: [number, number][] = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0], // front face
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4], // back face
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7], // connecting edges
  ];

  const projected = corners.map(([x, y, z]) => project(x, y, z));

  // Draw wireframe
  ctx.strokeStyle = "#2a2a4e";
  ctx.lineWidth = 1;
  for (const [a, b] of edges) {
    ctx.beginPath();
    ctx.moveTo(projected[a][0], projected[a][1]);
    ctx.lineTo(projected[b][0], projected[b][1]);
    ctx.stroke();
  }

  // Draw slice plane
  const t = (position / (gridSize - 1)) * 2 - 1; // normalize to -1..1

  let planeCorners: [number, number, number][];
  switch (axis) {
    case "z":
      planeCorners = [
        [-1, -1, t],
        [1, -1, t],
        [1, 1, t],
        [-1, 1, t],
      ];
      break;
    case "y":
      planeCorners = [
        [-1, t, -1],
        [1, t, -1],
        [1, t, 1],
        [-1, t, 1],
      ];
      break;
    case "x":
      planeCorners = [
        [t, -1, -1],
        [t, 1, -1],
        [t, 1, 1],
        [t, -1, 1],
      ];
      break;
  }

  const planeProjected = planeCorners.map(([x, y, z]) => project(x, y, z));

  ctx.beginPath();
  ctx.moveTo(planeProjected[0][0], planeProjected[0][1]);
  for (let i = 1; i < planeProjected.length; i++) {
    ctx.lineTo(planeProjected[i][0], planeProjected[i][1]);
  }
  ctx.closePath();
  ctx.fillStyle = "rgba(79, 70, 229, 0.25)";
  ctx.fill();
  ctx.strokeStyle = "#4f46e5";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Axis labels
  ctx.fillStyle = "#6b7280";
  ctx.font = "10px monospace";
  ctx.textAlign = "center";

  const xLabel = project(1.3, 0, 0);
  const yLabel = project(0, 1.3, 0);
  const zLabel = project(0, 0, 1.3);

  ctx.fillStyle = axis === "x" ? "#4f46e5" : "#4b5563";
  ctx.fillText("X", xLabel[0], xLabel[1]);
  ctx.fillStyle = axis === "y" ? "#4f46e5" : "#4b5563";
  ctx.fillText("Y", yLabel[0], yLabel[1]);
  ctx.fillStyle = axis === "z" ? "#4f46e5" : "#4b5563";
  ctx.fillText("Z", zLabel[0], zLabel[1]);
}
