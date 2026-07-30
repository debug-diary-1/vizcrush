import { init } from "@vizcrush/core";
import { bin3d } from "@vizcrush/bin3d";
import { generateCTVolume } from "./volume-generator";
import { renderSlice, renderOverview, type SliceAxis } from "./slice-renderer";

/* ------------------------------------------------------------------ */
/*  DOM references                                                     */
/* ------------------------------------------------------------------ */
const sliceCanvas = document.getElementById("slice-canvas") as HTMLCanvasElement;
const overviewCanvas = document.getElementById("overview-canvas") as HTMLCanvasElement;

const statBackend = document.getElementById("stat-backend")!;
const statVoxels = document.getElementById("stat-voxels")!;
const statGrid = document.getElementById("stat-grid")!;
const statTime = document.getElementById("stat-time")!;
const statMax = document.getElementById("stat-max")!;

const sliceSlider = document.getElementById("slice-slider") as HTMLInputElement;
const sliceLabel = document.getElementById("slice-label")!;
const colorMapSelect = document.getElementById("color-map") as HTMLSelectElement;
const axisButtons = document.querySelectorAll<HTMLButtonElement>("button[data-axis]");

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */
const GRID_SIZE = 64;
const NUM_POINTS = 2_000_000; // dense sampling for good voxel coverage

let grid: Uint32Array | null = null;
let maxCount = 0;
let currentAxis: SliceAxis = "z";
let currentSlice = 32;
let currentColorMap = "grayscale";
let overviewRotation = 0;
let _overviewAnimFrame = 0;

/* ------------------------------------------------------------------ */
/*  Bootstrap                                                          */
/* ------------------------------------------------------------------ */
async function bootstrap() {
  const gpu = await init();
  statBackend.textContent = gpu.backend;

  // Generate synthetic CT volume data
  const volume = generateCTVolume(NUM_POINTS);
  statVoxels.textContent = NUM_POINTS.toLocaleString();
  statGrid.textContent = `${GRID_SIZE}\u00B3`;

  // Run bin3d to create the voxel density grid
  // We use the density values as weights by placing them into the grid.
  // bin3d counts points per voxel, so denser regions get higher counts.
  // For a weighted approach, we generate points proportional to density.
  const t0 = performance.now();
  const result = await bin3d(volume.x, volume.y, volume.z, {
    xBins: GRID_SIZE,
    yBins: GRID_SIZE,
    zBins: GRID_SIZE,
    xRange: [0, 100],
    yRange: [0, 100],
    zRange: [0, 100],
  });
  const elapsed = performance.now() - t0;

  statTime.textContent = `${elapsed.toFixed(1)} ms`;

  grid = result.grid;

  // To incorporate density weighting, we scale bin counts by average density
  // in each voxel. For simplicity in this demo, the point distribution itself
  // creates the density pattern (denser structures have more points nearby).
  // We also overlay the density signal by accumulating density-weighted counts.
  const weightedGrid = new Uint32Array(grid.length);
  for (let i = 0; i < volume.x.length; i++) {
    const px = volume.x[i];
    const py = volume.y[i];
    const pz = volume.z[i];
    const d = volume.density[i];

    let xi = ((px / 100) * GRID_SIZE) | 0;
    let yi = ((py / 100) * GRID_SIZE) | 0;
    let zi = ((pz / 100) * GRID_SIZE) | 0;

    if (xi < 0) xi = 0;
    if (xi >= GRID_SIZE) xi = GRID_SIZE - 1;
    if (yi < 0) yi = 0;
    if (yi >= GRID_SIZE) yi = GRID_SIZE - 1;
    if (zi < 0) zi = 0;
    if (zi >= GRID_SIZE) zi = GRID_SIZE - 1;

    const idx = zi * GRID_SIZE * GRID_SIZE + yi * GRID_SIZE + xi;
    // Scale density to integer counts (0-100 range mapped to weight)
    weightedGrid[idx] += Math.round(d * 100);
  }

  grid = weightedGrid;

  // Find max
  maxCount = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] > maxCount) maxCount = grid[i];
  }
  statMax.textContent = maxCount.toLocaleString();

  // Initial render
  updateSlice();
  startOverviewAnimation();
}

/* ------------------------------------------------------------------ */
/*  Slice rendering                                                    */
/* ------------------------------------------------------------------ */
function updateSlice() {
  if (!grid) return;

  renderSlice(
    sliceCanvas,
    grid,
    GRID_SIZE,
    GRID_SIZE,
    GRID_SIZE,
    maxCount,
    currentAxis,
    currentSlice,
    currentColorMap,
  );
}

/* ------------------------------------------------------------------ */
/*  3D overview animation (rotating cube with slice plane)             */
/* ------------------------------------------------------------------ */
function startOverviewAnimation() {
  function animate() {
    overviewRotation += 0.008;
    renderOverview(overviewCanvas, currentAxis, currentSlice, GRID_SIZE, overviewRotation);
    _overviewAnimFrame = requestAnimationFrame(animate);
  }
  animate();
}

/* ------------------------------------------------------------------ */
/*  Controls                                                           */
/* ------------------------------------------------------------------ */

// Axis buttons
axisButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const axis = btn.dataset.axis as SliceAxis;
    if (axis === currentAxis) return;

    currentAxis = axis;

    // Update active button state
    axisButtons.forEach((b) => b.classList.toggle("active", b.dataset.axis === axis));

    // Reset slider to midpoint for new axis
    const maxSlice = GRID_SIZE - 1;
    sliceSlider.max = String(maxSlice);
    currentSlice = Math.floor(maxSlice / 2);
    sliceSlider.value = String(currentSlice);
    sliceLabel.textContent = String(currentSlice);

    updateSlice();
  });
});

// Slice slider
sliceSlider.addEventListener("input", () => {
  currentSlice = parseInt(sliceSlider.value, 10);
  sliceLabel.textContent = String(currentSlice);
  updateSlice();
});

// Color map
colorMapSelect.addEventListener("change", () => {
  currentColorMap = colorMapSelect.value;
  updateSlice();
});

// Resize
window.addEventListener("resize", () => {
  updateSlice();
});

/* ------------------------------------------------------------------ */
/*  Go                                                                 */
/* ------------------------------------------------------------------ */
bootstrap();
