import { HyperLogLog, CountMinSketch, ReservoirSampler } from "@vizcrush/aggregate";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const RESERVOIR_K = 500;
const HLL_PRECISION = 14;
const CM_WIDTH = 1024;
const CM_DEPTH = 5;
const MAX_USER_ID = 10000;
const HLL_HISTORY_LEN = 200;
const SCATTER_TRAIL = 5000;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let eventsPerSecond = 1000;
let paused = false;

// Sketches
let hll = new HyperLogLog(HLL_PRECISION);
let cms = new CountMinSketch(CM_WIDTH, CM_DEPTH);
let reservoir = new ReservoirSampler(RESERVOIR_K);

// Exact tracking for comparison
let exactUnique = new Set<number>();
let exactCounts = new Map<number, number>();

// HLL history for line chart
let hllHistory: { estimate: number; exact: number }[] = [];

// Scatter trail: ring buffer of recent event positions
let scatterTrail: { x: number; y: number }[] = [];
let scatterIdx = 0;
let scatterFull = false;

// Reservoir positions (stored alongside values)
let reservoirPositions: { x: number; y: number; userId: number }[] = [];

// Timing
let lastFrameTime = 0;
let fractionalEvents = 0;

// ---------------------------------------------------------------------------
// Event generation (Zipf-like)
// ---------------------------------------------------------------------------

function generateUserId(): number {
  const u = Math.random();
  return Math.floor(Math.pow(u, 2) * MAX_USER_ID);
}

function generateEventPosition(userId: number): [number, number] {
  const angle = (userId / MAX_USER_ID) * Math.PI * 6;
  const radius = 0.3 + (userId / MAX_USER_ID) * 0.4;
  return [
    0.5 + radius * Math.cos(angle) + (Math.random() - 0.5) * 0.05,
    0.5 + radius * Math.sin(angle) + (Math.random() - 0.5) * 0.05,
  ];
}

// ---------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------

function setupCanvas(id: string): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.getElementById(id) as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  return { canvas, ctx };
}

const canvases: Record<string, { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }> = {};

function initCanvases() {
  for (const id of ["hll-chart", "cm-chart", "rs-chart", "scatter"]) {
    canvases[id] = setupCanvas(id);
  }
}

// ---------------------------------------------------------------------------
// Rendering: HLL line chart
// ---------------------------------------------------------------------------

function drawHllChart() {
  const { canvas, ctx } = canvases["hll-chart"];
  const w = canvas.width / (window.devicePixelRatio || 1);
  const h = canvas.height / (window.devicePixelRatio || 1);
  ctx.clearRect(0, 0, w, h);

  if (hllHistory.length < 2) return;

  // Find y range
  let maxY = 0;
  for (const pt of hllHistory) {
    if (pt.estimate > maxY) maxY = pt.estimate;
    if (pt.exact > maxY) maxY = pt.exact;
  }
  maxY = Math.max(maxY * 1.1, 1);

  const padding = { left: 50, right: 10, top: 10, bottom: 25 };
  const plotW = w - padding.left - padding.right;
  const plotH = h - padding.top - padding.bottom;

  // Grid lines
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 0.5;
  const gridSteps = 4;
  for (let i = 0; i <= gridSteps; i++) {
    const gy = padding.top + (plotH / gridSteps) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, gy);
    ctx.lineTo(w - padding.right, gy);
    ctx.stroke();

    // Labels
    const label = Math.round(maxY * (1 - i / gridSteps));
    ctx.fillStyle = "#666";
    ctx.font = "10px system-ui";
    ctx.textAlign = "right";
    ctx.fillText(formatNumber(label), padding.left - 5, gy + 3);
  }

  const xStep = plotW / (hllHistory.length - 1);

  function plotLine(data: number[], color: string) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    for (let i = 0; i < data.length; i++) {
      const x = padding.left + i * xStep;
      const y = padding.top + plotH * (1 - data[i] / maxY);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Exact line (blue)
  plotLine(
    hllHistory.map((p) => p.exact),
    "#3b82f6",
  );
  // HLL estimate (purple)
  plotLine(
    hllHistory.map((p) => p.estimate),
    "#a78bfa",
  );

  // Legend
  ctx.font = "10px system-ui";
  ctx.textAlign = "left";
  ctx.fillStyle = "#a78bfa";
  ctx.fillText("HLL estimate", padding.left + 5, padding.top + 14);
  ctx.fillStyle = "#3b82f6";
  ctx.fillText("Exact", padding.left + 100, padding.top + 14);
}

// ---------------------------------------------------------------------------
// Rendering: Count-Min bar chart (top 10)
// ---------------------------------------------------------------------------

function getTop10(): { userId: number; estimated: number; actual: number }[] {
  // Get top 10 from exact counts
  const sorted = Array.from(exactCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  return sorted.map(([userId, actual]) => ({
    userId,
    estimated: cms.estimate(userId),
    actual,
  }));
}

function drawCmChart() {
  const { canvas, ctx } = canvases["cm-chart"];
  const w = canvas.width / (window.devicePixelRatio || 1);
  const h = canvas.height / (window.devicePixelRatio || 1);
  ctx.clearRect(0, 0, w, h);

  const top10 = getTop10();
  if (top10.length === 0) return;

  const padding = { left: 65, right: 10, top: 10, bottom: 5 };
  const plotW = w - padding.left - padding.right;
  const plotH = h - padding.top - padding.bottom;
  const barHeight = Math.min(18, plotH / top10.length - 4);
  const gap = (plotH - barHeight * top10.length) / (top10.length + 1);

  const maxVal = Math.max(...top10.map((d) => Math.max(d.estimated, d.actual)), 1);

  for (let i = 0; i < top10.length; i++) {
    const d = top10[i];
    const y = padding.top + gap * (i + 1) + barHeight * i;

    // Estimated bar (orange, wider)
    const estW = (d.estimated / maxVal) * plotW;
    ctx.fillStyle = "rgba(251, 146, 60, 0.3)";
    ctx.fillRect(padding.left, y, estW, barHeight);
    ctx.strokeStyle = "rgba(251, 146, 60, 0.6)";
    ctx.lineWidth = 1;
    ctx.strokeRect(padding.left, y, estW, barHeight);

    // Actual bar (solid orange)
    const actW = (d.actual / maxVal) * plotW;
    ctx.fillStyle = "rgba(251, 146, 60, 0.8)";
    ctx.fillRect(padding.left, y + 2, actW, barHeight - 4);

    // Label
    ctx.fillStyle = "#aaa";
    ctx.font = "10px system-ui";
    ctx.textAlign = "right";
    ctx.fillText(`user ${d.userId}`, padding.left - 5, y + barHeight / 2 + 3);

    // Count label
    ctx.textAlign = "left";
    ctx.fillStyle = "#888";
    ctx.fillText(`${d.actual}`, padding.left + actW + 4, y + barHeight / 2 + 3);
  }
}

// ---------------------------------------------------------------------------
// Rendering: Reservoir histogram
// ---------------------------------------------------------------------------

function drawRsChart() {
  const { canvas, ctx } = canvases["rs-chart"];
  const w = canvas.width / (window.devicePixelRatio || 1);
  const h = canvas.height / (window.devicePixelRatio || 1);
  ctx.clearRect(0, 0, w, h);

  const sample = reservoir.sample;
  if (sample.length === 0) return;

  const padding = { left: 10, right: 10, top: 10, bottom: 25 };
  const plotW = w - padding.left - padding.right;
  const plotH = h - padding.top - padding.bottom;

  // Build histogram with 40 bins
  const numBins = 40;
  const bins = new Uint32Array(numBins);
  for (let i = 0; i < sample.length; i++) {
    const bin = Math.min(numBins - 1, Math.floor((sample[i] / MAX_USER_ID) * numBins));
    bins[bin]++;
  }

  let maxBin = 0;
  for (let i = 0; i < numBins; i++) {
    if (bins[i] > maxBin) maxBin = bins[i];
  }
  maxBin = Math.max(maxBin, 1);

  const barW = plotW / numBins;

  for (let i = 0; i < numBins; i++) {
    const barH = (bins[i] / maxBin) * plotH;
    const x = padding.left + i * barW;
    const y = padding.top + plotH - barH;

    ctx.fillStyle = "rgba(74, 222, 128, 0.6)";
    ctx.fillRect(x, y, barW - 1, barH);
  }

  // X-axis labels
  ctx.fillStyle = "#666";
  ctx.font = "9px system-ui";
  ctx.textAlign = "center";
  for (let i = 0; i <= 4; i++) {
    const val = Math.round((i / 4) * MAX_USER_ID);
    const x = padding.left + (i / 4) * plotW;
    ctx.fillText(String(val), x, h - 5);
  }
}

// ---------------------------------------------------------------------------
// Rendering: Scatter plot
// ---------------------------------------------------------------------------

function drawScatter() {
  const { canvas, ctx } = canvases["scatter"];
  const w = canvas.width / (window.devicePixelRatio || 1);
  const h = canvas.height / (window.devicePixelRatio || 1);
  ctx.clearRect(0, 0, w, h);

  const padding = { left: 10, right: 10, top: 10, bottom: 10 };
  const plotW = w - padding.left - padding.right;
  const plotH = h - padding.top - padding.bottom;

  // Draw all events (faded)
  ctx.fillStyle = "rgba(100, 100, 140, 0.15)";
  const trailLen = scatterFull ? SCATTER_TRAIL : scatterIdx;
  for (let i = 0; i < trailLen; i++) {
    const pt = scatterTrail[i];
    const sx = padding.left + pt.x * plotW;
    const sy = padding.top + pt.y * plotH;
    ctx.fillRect(sx - 1, sy - 1, 2, 2);
  }

  // Draw reservoir sample (bright green)
  ctx.fillStyle = "rgba(74, 222, 128, 0.8)";
  for (const pt of reservoirPositions) {
    const sx = padding.left + pt.x * plotW;
    const sy = padding.top + pt.y * plotH;
    ctx.beginPath();
    ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// DOM updates
// ---------------------------------------------------------------------------

const el = {
  hllEstimate: document.getElementById("hll-estimate")!,
  hllExact: document.getElementById("hll-exact")!,
  hllError: document.getElementById("hll-error")!,
  hllMemory: document.getElementById("hll-memory")!,
  cmTop: document.getElementById("cm-top")!,
  cmTotal: document.getElementById("cm-total")!,
  cmDims: document.getElementById("cm-dims")!,
  rsCount: document.getElementById("rs-count")!,
  rsK: document.getElementById("rs-k")!,
  rsIngested: document.getElementById("rs-ingested")!,
};

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(Math.round(n));
}

function updateDOM() {
  const estimate = Math.round(hll.estimate());
  const exact = exactUnique.size;
  const error = exact > 0 ? (Math.abs(estimate - exact) / exact) * 100 : 0;
  const memoryKB = (1 << HLL_PRECISION) / 1024; // 1 byte per register

  el.hllEstimate.textContent = formatNumber(estimate);
  el.hllExact.textContent = formatNumber(exact);
  el.hllError.textContent = error.toFixed(2) + "%";
  el.hllMemory.textContent = memoryKB + " KB";

  // Count-Min top user
  const top10 = getTop10();
  if (top10.length > 0) {
    el.cmTop.textContent = `user ${top10[0].userId}`;
  }
  el.cmTotal.textContent = formatNumber(cms.count);
  el.cmDims.textContent = `${CM_WIDTH}\u00d7${CM_DEPTH}`;

  // Reservoir
  el.rsCount.textContent = String(Math.min(reservoir.count, RESERVOIR_K));
  el.rsK.textContent = String(RESERVOIR_K);
  el.rsIngested.textContent = formatNumber(reservoir.count);
}

// ---------------------------------------------------------------------------
// Simulation loop
// ---------------------------------------------------------------------------

// We also need to track reservoir positions alongside the sampler.
// Since ReservoirSampler only stores numeric values, we maintain a parallel
// structure that mirrors its sampling decisions.
let _reservoirData: { userId: number; x: number; y: number }[] = [];
let _reservoirCount = 0;
// Use same RNG logic as reservoir to keep positions in sync -- but actually
// the simplest approach: maintain our own parallel reservoir of positions.
// We re-seed with the same seed used internally.
// Actually, we can't access the internal RNG. Instead, we'll maintain our
// own full parallel reservoir manually:

class ParallelReservoir<T> {
  private _k: number;
  private _items: T[] = [];
  private _count = 0;
  private _rngState: number;

  constructor(k: number) {
    this._k = k;
    this._rngState = (k * 2654435761) | 0 || 1;
  }

  private _nextRng(): number {
    let s = this._rngState;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this._rngState = s;
    return (s >>> 0) / 0x100000000;
  }

  add(item: T): void {
    this._count++;
    if (this._items.length < this._k) {
      this._items.push(item);
    } else {
      const j = Math.floor(this._nextRng() * this._count);
      if (j < this._k) {
        this._items[j] = item;
      }
    }
  }

  get items(): T[] {
    return this._items;
  }

  get count(): number {
    return this._count;
  }

  reset(): void {
    this._items = [];
    this._count = 0;
    this._rngState = (this._k * 2654435761) | 0 || 1;
  }
}

const posReservoir = new ParallelReservoir<{ x: number; y: number; userId: number }>(RESERVOIR_K);

function processEvents(count: number) {
  for (let i = 0; i < count; i++) {
    const userId = generateUserId();
    const [x, y] = generateEventPosition(userId);

    // Feed sketches
    hll.add(userId);
    cms.add(userId);
    reservoir.add(userId);

    // Exact tracking
    exactUnique.add(userId);
    exactCounts.set(userId, (exactCounts.get(userId) || 0) + 1);

    // Parallel position reservoir
    posReservoir.add({ x, y, userId });

    // Scatter trail (ring buffer)
    if (scatterTrail.length < SCATTER_TRAIL) {
      scatterTrail.push({ x, y });
    } else {
      scatterTrail[scatterIdx] = { x, y };
    }
    scatterIdx = (scatterIdx + 1) % SCATTER_TRAIL;
    if (scatterIdx === 0 && scatterTrail.length >= SCATTER_TRAIL) {
      scatterFull = true;
    }
  }

  // Update reservoir positions from parallel reservoir
  reservoirPositions = posReservoir.items;
}

let lastHllSnapshot = 0;

function frame(time: number) {
  if (!lastFrameTime) lastFrameTime = time;
  const dt = Math.min((time - lastFrameTime) / 1000, 0.1); // cap at 100ms
  lastFrameTime = time;

  if (!paused) {
    // Calculate how many events to generate this frame
    fractionalEvents += eventsPerSecond * dt;
    const eventsThisFrame = Math.floor(fractionalEvents);
    fractionalEvents -= eventsThisFrame;

    if (eventsThisFrame > 0) {
      processEvents(eventsThisFrame);
    }

    // Snapshot HLL history at ~5 Hz
    if (time - lastHllSnapshot > 200) {
      lastHllSnapshot = time;
      hllHistory.push({
        estimate: Math.round(hll.estimate()),
        exact: exactUnique.size,
      });
      if (hllHistory.length > HLL_HISTORY_LEN) {
        hllHistory.shift();
      }
    }
  }

  // Render
  updateDOM();
  drawHllChart();
  drawCmChart();
  drawRsChart();
  drawScatter();

  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

function reset() {
  hll = new HyperLogLog(HLL_PRECISION);
  cms = new CountMinSketch(CM_WIDTH, CM_DEPTH);
  reservoir = new ReservoirSampler(RESERVOIR_K);
  exactUnique = new Set<number>();
  exactCounts = new Map<number, number>();
  hllHistory = [];
  scatterTrail = [];
  scatterIdx = 0;
  scatterFull = false;
  reservoirPositions = [];
  posReservoir.reset();
  fractionalEvents = 0;
  lastFrameTime = 0;
  lastHllSnapshot = 0;
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function initControls() {
  // Rate buttons
  const rateButtons = document.querySelectorAll<HTMLButtonElement>("button[data-events]");
  rateButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      rateButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      eventsPerSecond = parseInt(btn.dataset.events!, 10);
    });
  });

  // Pause
  const pauseBtn = document.getElementById("btn-pause") as HTMLButtonElement;
  pauseBtn.addEventListener("click", () => {
    paused = !paused;
    pauseBtn.textContent = paused ? "Resume" : "Pause";
    pauseBtn.classList.toggle("active", paused);
    if (!paused) {
      lastFrameTime = 0; // reset so dt doesn't spike
    }
  });

  // Reset
  const resetBtn = document.getElementById("btn-reset") as HTMLButtonElement;
  resetBtn.addEventListener("click", () => {
    reset();
  });
}

// ---------------------------------------------------------------------------
// Handle resize
// ---------------------------------------------------------------------------

function handleResize() {
  for (const id of Object.keys(canvases)) {
    const { canvas, ctx } = canvases[id];
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

initCanvases();
initControls();
window.addEventListener("resize", handleResize);
requestAnimationFrame(frame);
