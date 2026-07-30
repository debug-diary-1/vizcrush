import { buildHashGrid, hashGridQueryRadius, type SpatialHashGridHandle } from "@vizcrush/spatial";
import { buildQuadtree, queryRange, type QuadtreeHandle } from "@vizcrush/spatial";
import { mortonOrder2d } from "@vizcrush/spatial";

// ── DOM references ──

const canvas = document.getElementById("scatter") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

const pointCountEl = document.getElementById("point-count") as HTMLSelectElement;
const distributionEl = document.getElementById("distribution") as HTMLSelectElement;
const radiusEl = document.getElementById("radius") as HTMLSelectElement;

const hgTimeEl = document.getElementById("hg-time")!;
const hgFoundEl = document.getElementById("hg-found")!;
const hgCellsEl = document.getElementById("hg-cells")!;
const qtTimeEl = document.getElementById("qt-time")!;
const qtFoundEl = document.getElementById("qt-found")!;
const hgBuildEl = document.getElementById("hg-build")!;
const qtBuildEl = document.getElementById("qt-build")!;
const mortonTimeEl = document.getElementById("morton-time")!;

// ── State ──

let x: Float64Array;
let y: Float64Array;
let hashGrid: SpatialHashGridHandle;
let quadtree: QuadtreeHandle;
let radius = 0.05;
let offscreenCanvas: OffscreenCanvas | HTMLCanvasElement;
let offscreenCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
let currentN = 50000;

// ── Data generation ──

function generatePoints(n: number, distribution: string): { x: Float64Array; y: Float64Array } {
  const xArr = new Float64Array(n);
  const yArr = new Float64Array(n);

  switch (distribution) {
    case "uniform":
      for (let i = 0; i < n; i++) {
        xArr[i] = Math.random();
        yArr[i] = Math.random();
      }
      break;

    case "clustered": {
      const clusters = Array.from({ length: 6 }, () => ({
        cx: Math.random(),
        cy: Math.random(),
        spread: 0.05 + Math.random() * 0.1,
      }));
      for (let i = 0; i < n; i++) {
        const c = clusters[i % clusters.length];
        const u1 = Math.random() || 1e-10;
        const u2 = Math.random();
        const z1 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        const z2 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);
        xArr[i] = Math.max(0, Math.min(1, c.cx + z1 * c.spread));
        yArr[i] = Math.max(0, Math.min(1, c.cy + z2 * c.spread));
      }
      break;
    }

    case "grid": {
      const side = Math.ceil(Math.sqrt(n));
      for (let i = 0; i < n; i++) {
        xArr[i] = (i % side) / side + (Math.random() - 0.5) * 0.005;
        yArr[i] = Math.floor(i / side) / side + (Math.random() - 0.5) * 0.005;
      }
      break;
    }
  }

  return { x: xArr, y: yArr };
}

// ── Canvas sizing ──

function sizeCanvas(): void {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ── Offscreen base layer ──

function renderBaseLayer(): void {
  const rect = canvas.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;

  if (typeof OffscreenCanvas !== "undefined") {
    offscreenCanvas = new OffscreenCanvas(w, h);
  } else {
    offscreenCanvas = document.createElement("canvas");
    offscreenCanvas.width = w;
    offscreenCanvas.height = h;
  }

  offscreenCtx = offscreenCanvas.getContext("2d")! as any;
  offscreenCtx.fillStyle = "#1c1b1b";
  offscreenCtx.fillRect(0, 0, w, h);

  // Draw all points as tiny faded dots
  offscreenCtx.fillStyle = "rgba(74, 127, 212, 0.15)";
  const n = x.length;
  const dotSize = n > 100000 ? 1 : n > 50000 ? 1.5 : 2;

  for (let i = 0; i < n; i++) {
    const px = x[i] * w;
    const py = y[i] * h;
    offscreenCtx.fillRect(px - dotSize * 0.5, py - dotSize * 0.5, dotSize, dotSize);
  }
}

// ── Drawing ──

function redraw(mx: number, my: number, r: number, neighbors: Uint32Array): void {
  const rect = canvas.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;

  // Composite base layer
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(offscreenCanvas as any, 0, 0, w, h);

  // Draw query radius circle
  ctx.beginPath();
  ctx.arc(mx * w, my * h, r * w, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(248, 113, 113, 0.6)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Highlight neighbor points (green)
  const dotSize = currentN > 100000 ? 2 : currentN > 50000 ? 3 : 4;
  ctx.fillStyle = "#4ade80";
  for (let i = 0; i < neighbors.length; i++) {
    const idx = neighbors[i];
    const px = x[idx] * w;
    const py = y[idx] * h;
    ctx.fillRect(px - dotSize * 0.5, py - dotSize * 0.5, dotSize, dotSize);
  }

  // Draw query point (red)
  ctx.beginPath();
  ctx.arc(mx * w, my * h, 5, 0, Math.PI * 2);
  ctx.fillStyle = "#f87171";
  ctx.fill();
}

function drawIdle(): void {
  const rect = canvas.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(offscreenCanvas as any, 0, 0, w, h);
}

// ── Timing display ──

function formatTime(ms: number): string {
  if (ms < 0.01) return "<0.01ms";
  return ms.toPrecision(3) + "ms";
}

function updateTimings(hgTime: number, qtTime: number, hgCount: number, qtCount: number): void {
  hgTimeEl.textContent = formatTime(hgTime);
  qtTimeEl.textContent = formatTime(qtTime);
  hgFoundEl.textContent = String(hgCount);
  qtFoundEl.textContent = String(qtCount);

  // Compute cells checked for display
  const inv = 1 / hashGrid.cellSize;
  const _cxMin = Math.floor((parseFloat(radiusEl.value) * -1 + 0.5) * inv); // approximate
  const cellsChecked = (Math.floor((radius * 2) / hashGrid.cellSize) + 1) ** 2;
  hgCellsEl.textContent = String(cellsChecked);
}

// ── Mouse interaction ──

canvas.addEventListener("mousemove", (e: MouseEvent) => {
  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left) / rect.width;
  const my = (e.clientY - rect.top) / rect.height;

  // Clamp to [0, 1]
  const qx = Math.max(0, Math.min(1, mx));
  const qy = Math.max(0, Math.min(1, my));

  // Query hash grid
  const t0 = performance.now();
  const hgResult = hashGridQueryRadius(hashGrid, qx, qy, radius);
  const hgTime = performance.now() - t0;

  // Query quadtree (range query with bounding box around the circle)
  const t1 = performance.now();
  const qtResult = queryRange(quadtree, {
    xMin: qx - radius,
    xMax: qx + radius,
    yMin: qy - radius,
    yMax: qy + radius,
  });
  const qtTime = performance.now() - t1;

  updateTimings(hgTime, qtTime, hgResult.length, qtResult.length);
  redraw(qx, qy, radius, hgResult);
});

canvas.addEventListener("mouseleave", () => {
  hgTimeEl.textContent = "---";
  qtTimeEl.textContent = "---";
  hgFoundEl.textContent = "---";
  qtFoundEl.textContent = "---";
  hgCellsEl.textContent = "---";
  drawIdle();
});

// ── Build / rebuild ──

async function rebuild(): Promise<void> {
  currentN = parseInt(pointCountEl.value, 10);
  const distribution = distributionEl.value;
  radius = parseFloat(radiusEl.value);

  // Reset display
  hgTimeEl.textContent = "---";
  qtTimeEl.textContent = "---";
  hgFoundEl.textContent = "---";
  qtFoundEl.textContent = "---";
  hgCellsEl.textContent = "---";
  hgBuildEl.textContent = "building...";
  qtBuildEl.textContent = "building...";
  mortonTimeEl.textContent = "computing...";

  // Generate points
  const pts = generatePoints(currentN, distribution);
  x = pts.x;
  y = pts.y;

  // Build hash grid
  // cellSize should be roughly equal to the search radius for optimal performance
  const cellSize = radius;
  const hgStart = performance.now();
  hashGrid = await buildHashGrid(x, y, cellSize);
  const hgBuildTime = performance.now() - hgStart;
  hgBuildEl.textContent = formatTime(hgBuildTime);

  // Build quadtree
  const qtStart = performance.now();
  quadtree = await buildQuadtree(x, y);
  const qtBuildTime = performance.now() - qtStart;
  qtBuildEl.textContent = formatTime(qtBuildTime);

  // Morton reordering
  const mortonStart = performance.now();
  await mortonOrder2d(x, y);
  const mortonTime = performance.now() - mortonStart;
  mortonTimeEl.textContent = formatTime(mortonTime);

  // Render base layer and draw
  sizeCanvas();
  renderBaseLayer();
  drawIdle();
}

// ── Controls ──

pointCountEl.addEventListener("change", () => rebuild());
distributionEl.addEventListener("change", () => rebuild());
radiusEl.addEventListener("change", () => rebuild());

// Handle window resize
window.addEventListener("resize", () => {
  sizeCanvas();
  renderBaseLayer();
  drawIdle();
});

// ── Init ──

rebuild();
