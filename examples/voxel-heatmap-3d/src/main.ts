import { init } from "@vizcrush/core";
import { bin3d } from "@vizcrush/bin3d";
import { renderVoxels } from "./renderer";
import { COLOR_SCALES, type ColorScaleFn } from "./color-scale";

// ---- DOM refs ----
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const statBackend = document.getElementById("stat-backend")!;
const statPoints = document.getElementById("stat-points")!;
const statGrid = document.getElementById("stat-grid")!;
const statTime = document.getElementById("stat-time")!;
const statMax = document.getElementById("stat-max")!;

const ctrlPoints = document.getElementById("ctrl-points") as HTMLSelectElement;
const ctrlGrid = document.getElementById("ctrl-grid") as HTMLSelectElement;
const ctrlColor = document.getElementById("ctrl-color") as HTMLSelectElement;

// ---- State ----
let rotationX = -0.5; // radians
let rotationY = 0.6;
let isDragging = false;
let lastMouseX = 0;
let lastMouseY = 0;

let currentGrid: Float64Array | Uint32Array | number[] = [];
let currentBins = 16;
let currentMaxCount = 0;
let currentColorScale: ColorScaleFn = COLOR_SCALES.viridis;

// ---- Point generation: 5 density clusters in 3D ----
function generatePoints(count: number): { x: Float64Array; y: Float64Array; z: Float64Array } {
  const x = new Float64Array(count);
  const y = new Float64Array(count);
  const z = new Float64Array(count);

  // 5 cluster centers in [0, 1] range
  const clusters = [
    { cx: 0.2, cy: 0.3, cz: 0.2, spread: 0.08, weight: 0.3 },
    { cx: 0.7, cy: 0.7, cz: 0.8, spread: 0.06, weight: 0.25 },
    { cx: 0.5, cy: 0.5, cz: 0.5, spread: 0.12, weight: 0.2 },
    { cx: 0.8, cy: 0.2, cz: 0.3, spread: 0.07, weight: 0.15 },
    { cx: 0.3, cy: 0.8, cz: 0.7, spread: 0.09, weight: 0.1 },
  ];

  // Build cumulative weight array for cluster selection
  const cumWeights: number[] = [];
  let total = 0;
  for (const c of clusters) {
    total += c.weight;
    cumWeights.push(total);
  }

  for (let i = 0; i < count; i++) {
    // Pick a cluster
    const r = Math.random() * total;
    let ci = 0;
    for (let j = 0; j < cumWeights.length; j++) {
      if (r < cumWeights[j]) {
        ci = j;
        break;
      }
    }
    const c = clusters[ci];

    // Gaussian-ish via Box-Muller
    const u1 = Math.random() || 1e-10;
    const u2 = Math.random();
    const _u3 = Math.random();
    const u4 = Math.random() || 1e-10;
    const u5 = Math.random();

    const g1 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const g2 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);
    const g3 = Math.sqrt(-2 * Math.log(u4)) * Math.cos(2 * Math.PI * u5);

    x[i] = Math.max(0, Math.min(1, c.cx + g1 * c.spread));
    y[i] = Math.max(0, Math.min(1, c.cy + g2 * c.spread));
    z[i] = Math.max(0, Math.min(1, c.cz + g3 * c.spread));
  }

  return { x, y, z };
}

// ---- Main pipeline ----
async function run() {
  const backend = await init();
  statBackend.textContent = backend ?? "js";

  const pointCount = parseInt(ctrlPoints.value, 10);
  const bins = parseInt(ctrlGrid.value, 10);
  const colorKey = ctrlColor.value;
  currentColorScale = COLOR_SCALES[colorKey] ?? COLOR_SCALES.viridis;

  statPoints.textContent = (pointCount / 1000).toFixed(0) + "K";
  statGrid.textContent = `${bins}\u00B3`;

  // Generate data
  const { x, y, z } = generatePoints(pointCount);

  // Run bin3d
  const t0 = performance.now();
  const result = await bin3d(x, y, z, {
    xBins: bins,
    yBins: bins,
    zBins: bins,
  });
  const elapsed = performance.now() - t0;

  statTime.textContent = elapsed.toFixed(1) + " ms";

  currentGrid = result.grid;
  currentBins = bins;

  // Find max density
  let maxCount = 0;
  for (let i = 0; i < currentGrid.length; i++) {
    if (currentGrid[i] > maxCount) maxCount = currentGrid[i];
  }
  currentMaxCount = maxCount;
  statMax.textContent = maxCount.toLocaleString();

  // Update subtitle
  const subtitle = document.querySelector("header p");
  if (subtitle) {
    subtitle.innerHTML = `${(pointCount / 1000).toFixed(0)}K scatter points &rarr; ${bins}&sup3; voxel density grid`;
  }

  draw();
}

function draw() {
  renderVoxels({
    canvas,
    grid: currentGrid,
    xBins: currentBins,
    yBins: currentBins,
    zBins: currentBins,
    maxCount: currentMaxCount,
    rotationX,
    rotationY,
    colorScale: currentColorScale,
  });
}

// ---- Mouse drag rotation ----
canvas.addEventListener("mousedown", (e) => {
  isDragging = true;
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
});

window.addEventListener("mousemove", (e) => {
  if (!isDragging) return;
  const dx = e.clientX - lastMouseX;
  const dy = e.clientY - lastMouseY;
  rotationY += dx * 0.005;
  rotationX += dy * 0.005;
  // Clamp X rotation to avoid flipping
  rotationX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, rotationX));
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
  draw();
});

window.addEventListener("mouseup", () => {
  isDragging = false;
});

// ---- Controls ----
ctrlPoints.addEventListener("change", run);
ctrlGrid.addEventListener("change", run);
ctrlColor.addEventListener("change", () => {
  currentColorScale = COLOR_SCALES[ctrlColor.value] ?? COLOR_SCALES.viridis;
  draw();
});

// ---- Resize ----
window.addEventListener("resize", draw);

// ---- Start ----
run();
