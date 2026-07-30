import { init } from "@vizcrush/core";
import { buildOctree } from "@vizcrush/spatial3d";
import { generateTerrain } from "./terrain-generator";
import { renderWithLOD, type CameraState } from "./lod-renderer";

/* ------------------------------------------------------------------ */
/*  DOM references                                                     */
/* ------------------------------------------------------------------ */
const canvas = document.getElementById("canvas") as HTMLCanvasElement;

const statBackend = document.getElementById("stat-backend")!;
const statTotal = document.getElementById("stat-total")!;
const statRendered = document.getElementById("stat-rendered")!;
const statLod = document.getElementById("stat-lod")!;
const statFrame = document.getElementById("stat-frame")!;
const statSavings = document.getElementById("stat-savings")!;

const lodSlider = document.getElementById("lod-slider") as HTMLInputElement;
const lodValueEl = document.getElementById("lod-value")!;

const countButtons = document.querySelectorAll<HTMLButtonElement>(".controls button[data-count]");

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */
let pointCount = 200_000;
let terrain: { x: Float64Array; y: Float64Array; z: Float64Array };
let octree: Awaited<ReturnType<typeof buildOctree>> | null = null;
let lodFactor = 4;

const camera: CameraState = {
  cx: 0,
  cz: 0,
  zoom: 1.5,
  tiltFactor: 0.7,
};

/* ------------------------------------------------------------------ */
/*  Initialise vizcrush                                                */
/* ------------------------------------------------------------------ */
async function bootstrap() {
  const gpu = await init();
  statBackend.textContent = gpu.backend;
  await rebuild(pointCount);
}

/* ------------------------------------------------------------------ */
/*  Build terrain + octree                                             */
/* ------------------------------------------------------------------ */
async function rebuild(n: number) {
  pointCount = n;

  // Update button state
  countButtons.forEach((btn) => {
    btn.classList.toggle("active", Number(btn.dataset.count) === n);
  });

  // Generate terrain data
  terrain = generateTerrain(n);
  statTotal.textContent = n.toLocaleString();

  // Build octree
  octree = await buildOctree(terrain.x, terrain.y, terrain.z);

  render();
}

/* ------------------------------------------------------------------ */
/*  Render                                                             */
/* ------------------------------------------------------------------ */
function render() {
  if (!octree) return;

  const stats = renderWithLOD(canvas, terrain, camera, octree, lodFactor);

  statRendered.textContent = stats.totalRendered.toLocaleString();
  statLod.textContent = `near ${stats.nearCount.toLocaleString()} / mid ${stats.midCount.toLocaleString()} / far ${stats.farCount.toLocaleString()}`;
  statFrame.textContent = `${stats.frameMs.toFixed(1)} ms`;

  const savings = pointCount > 0 ? ((1 - stats.totalRendered / pointCount) * 100).toFixed(1) : "0";
  statSavings.textContent = `${savings}%`;
}

/* ------------------------------------------------------------------ */
/*  Interaction: mouse drag to pan, scroll to zoom                     */
/* ------------------------------------------------------------------ */
let dragging = false;
let lastX = 0;
let lastY = 0;

canvas.addEventListener("mousedown", (e) => {
  dragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
});

window.addEventListener("mousemove", (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;
  camera.cx -= dx / camera.zoom;
  camera.cz -= dy / camera.zoom;
  render();
});

window.addEventListener("mouseup", () => {
  dragging = false;
});

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    camera.zoom = Math.max(0.2, Math.min(10, camera.zoom * factor));
    render();
  },
  { passive: false },
);

/* ------------------------------------------------------------------ */
/*  LOD slider                                                         */
/* ------------------------------------------------------------------ */
lodSlider.addEventListener("input", () => {
  lodFactor = Number(lodSlider.value);
  lodValueEl.textContent = String(lodFactor);
  render();
});

/* ------------------------------------------------------------------ */
/*  Point count selector                                               */
/* ------------------------------------------------------------------ */
countButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const n = Number(btn.dataset.count);
    if (n && n !== pointCount) rebuild(n);
  });
});

/* ------------------------------------------------------------------ */
/*  Resize                                                             */
/* ------------------------------------------------------------------ */
window.addEventListener("resize", () => render());

/* ------------------------------------------------------------------ */
/*  Go                                                                 */
/* ------------------------------------------------------------------ */
bootstrap();
