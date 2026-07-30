import { init } from "@vizcrush/core";
import { buildOctree, queryRange3d } from "@vizcrush/spatial3d";
import { OrbitCamera } from "./camera";
import { generatePointCloud } from "./data-generator";

/* ------------------------------------------------------------------ */
/*  DOM references                                                     */
/* ------------------------------------------------------------------ */
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

const statBackend = document.getElementById("stat-backend")!;
const statTotal = document.getElementById("stat-total")!;
const statVisible = document.getElementById("stat-visible")!;
const statOctree = document.getElementById("stat-octree")!;
const statCull = document.getElementById("stat-cull")!;

const countButtons = document.querySelectorAll<HTMLButtonElement>(".controls button[data-count]");

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */
let pointCount = 100_000;
let cloud: { x: Float64Array; y: Float64Array; z: Float64Array };
let octree: Awaited<ReturnType<typeof buildOctree>> | null = null;
const camera = new OrbitCamera();

/* ------------------------------------------------------------------ */
/*  Initialise vizcrush                                                */
/* ------------------------------------------------------------------ */
async function bootstrap() {
  const gpu = await init();
  statBackend.textContent = gpu.backend;
  await rebuild(pointCount);
}

/* ------------------------------------------------------------------ */
/*  Build point cloud + octree                                         */
/* ------------------------------------------------------------------ */
async function rebuild(n: number) {
  pointCount = n;

  // Update button state
  countButtons.forEach((btn) => {
    btn.classList.toggle("active", Number(btn.dataset.count) === n);
  });

  // Generate data
  cloud = generatePointCloud(n);
  statTotal.textContent = n.toLocaleString();

  // Build octree
  const t0 = performance.now();
  octree = await buildOctree(cloud.x, cloud.y, cloud.z);
  const buildMs = (performance.now() - t0).toFixed(1);
  statOctree.textContent = `${buildMs} ms`;

  render();
}

/* ------------------------------------------------------------------ */
/*  Render loop                                                        */
/* ------------------------------------------------------------------ */
function render() {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;

  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  if (!octree) return;

  const aspect = w / h;
  const mvp = camera.getMVPMatrix(aspect);

  // Use octree range query to get points in a broad view volume,
  // then project. Much faster than testing all N points.
  const t0 = performance.now();
  const bounds = octree.bounds;
  const visibleIndices = queryRange3d(octree, {
    xMin: bounds.xMin,
    xMax: bounds.xMax,
    yMin: bounds.yMin,
    yMax: bounds.yMax,
    zMin: bounds.zMin,
    zMax: bounds.zMax,
  });

  // Cap rendering to 50K points for smooth Canvas 2D performance
  const MAX_RENDER = 50_000;
  const step = Math.max(1, Math.floor(visibleIndices.length / MAX_RENDER));
  const cullMs = (performance.now() - t0).toFixed(1);
  statCull.textContent = `${cullMs} ms`;
  statVisible.textContent = `${Math.min(visibleIndices.length, MAX_RENDER).toLocaleString()} / ${visibleIndices.length.toLocaleString()}`;

  // Project and draw visible points
  const halfW = w / 2;
  const halfH = h / 2;

  // Pre-extract MVP entries for inline projection
  const m0 = mvp[0],
    m1 = mvp[1],
    _m2 = mvp[2],
    m3 = mvp[3];
  const m4 = mvp[4],
    m5 = mvp[5],
    _m6 = mvp[6],
    m7 = mvp[7];
  const m8 = mvp[8],
    m9 = mvp[9],
    _m10 = mvp[10],
    m11 = mvp[11];
  const m12 = mvp[12],
    m13 = mvp[13],
    _m14 = mvp[14],
    m15 = mvp[15];

  const camPos = camera.position;

  // Batch draw using a single path per color bucket for performance
  const bucketCount = 8;
  const buckets: { sx: number; sy: number; size: number }[][] = Array.from(
    { length: bucketCount },
    () => [],
  );

  const len = visibleIndices.length;
  for (let i = 0; i < len; i += step) {
    const idx = visibleIndices[i];
    const px = cloud.x[idx];
    const py = cloud.y[idx];
    const pz = cloud.z[idx];

    // Clip space: MVP * [px, py, pz, 1]
    const clipW = m3 * px + m7 * py + m11 * pz + m15;
    if (clipW <= 0) continue;

    const invW = 1 / clipW;
    const clipX = (m0 * px + m4 * py + m8 * pz + m12) * invW;
    const clipY = (m1 * px + m5 * py + m9 * pz + m13) * invW;

    // NDC to screen
    const sx = (clipX + 1) * halfW;
    const sy = (1 - clipY) * halfH;

    // Skip off-screen
    if (sx < -10 || sx > w + 10 || sy < -10 || sy > h + 10) continue;

    // Distance for color and size
    const dx = px - camPos[0];
    const dy = py - camPos[1];
    const dz = pz - camPos[2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Depth normalised 0..1 (near=0, far=1)
    const depthNorm = Math.min(1, Math.max(0, dist / 800));

    // Size: closer = larger
    const size = Math.max(0.5, 3 * (1 - depthNorm * 0.8));

    // Color bucket (near=bright blue, far=dim blue)
    const bucket = Math.min(bucketCount - 1, Math.floor(depthNorm * bucketCount));
    buckets[bucket].push({ sx, sy, size });
  }

  // Draw each bucket with its colour
  for (let b = 0; b < bucketCount; b++) {
    const pts = buckets[b];
    if (pts.length === 0) continue;

    const t = b / (bucketCount - 1);
    const r = Math.round(30 + 70 * (1 - t));
    const g = Math.round(80 + 120 * (1 - t));
    const bl = Math.round(160 + 95 * (1 - t));
    const alpha = 0.4 + 0.6 * (1 - t);

    ctx.fillStyle = `rgba(${r},${g},${bl},${alpha})`;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      ctx.moveTo(p.sx + p.size, p.sy);
      ctx.arc(p.sx, p.sy, p.size, 0, Math.PI * 2);
    }
    ctx.fill();
  }
}

/* ------------------------------------------------------------------ */
/*  Interaction: mouse drag to orbit, scroll to zoom                   */
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
  camera.rotate(dx, dy);
  render();
});

window.addEventListener("mouseup", () => {
  dragging = false;
});

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    camera.zoom(e.deltaY);
    render();
  },
  { passive: false },
);

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
