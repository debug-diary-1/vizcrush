import { mortonOrder2d } from "@vizcrush/spatial";

// ── Elements ──
const resolutionSelect = document.getElementById("resolution") as HTMLSelectElement;
const speedSelect = document.getElementById("speed") as HTMLSelectElement;
const restartBtn = document.getElementById("restart-btn") as HTMLButtonElement;

const randomCanvas = document.getElementById("random-canvas") as HTMLCanvasElement;
const mortonCanvas = document.getElementById("morton-canvas") as HTMLCanvasElement;

const randomProgressEl = document.getElementById("random-progress") as HTMLElement;
const mortonProgressEl = document.getElementById("morton-progress") as HTMLElement;

const statRandomDist = document.getElementById("stat-random-dist") as HTMLElement;
const statMortonDist = document.getElementById("stat-morton-dist") as HTMLElement;
const statRandomLocality = document.getElementById("stat-random-locality") as HTMLElement;
const statMortonLocality = document.getElementById("stat-morton-locality") as HTMLElement;

// ── State ──
interface Point {
  x: number;
  y: number;
  gridX: number;
  gridY: number;
}

let points: Point[] = [];
let mortonIndices: Uint32Array = new Uint32Array();
let _animFrame = 0;
let currentIndex = 0;
let totalPoints = 0;
let animating = false;
let rafId = 0;

// ── Canvas setup ──
function setupCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  return ctx;
}

function getCanvasSize(canvas: HTMLCanvasElement): number {
  return canvas.getBoundingClientRect().width;
}

// ── Color gradient from blue to red ──
function progressColor(t: number): string {
  // t in [0,1]: blue(0) -> cyan(0.25) -> green(0.5) -> yellow(0.75) -> red(1)
  const r = Math.floor(255 * Math.min(1, 2 * t));
  const g = Math.floor(255 * Math.min(1, 2 * (1 - t)));
  const b = Math.floor(255 * Math.max(0, 1 - 2 * t));
  return `rgb(${r},${g},${b})`;
}

// ── Point generation ──
function generateGrid(resolution: number): Point[] {
  const pts: Point[] = [];
  const jitter = 0.3; // fraction of cell size
  for (let gy = 0; gy < resolution; gy++) {
    for (let gx = 0; gx < resolution; gx++) {
      const cx = (gx + 0.5) / resolution;
      const cy = (gy + 0.5) / resolution;
      // Slight jitter for natural look
      const jx = cx + ((Math.random() - 0.5) * jitter) / resolution;
      const jy = cy + ((Math.random() - 0.5) * jitter) / resolution;
      pts.push({ x: jx, y: jy, gridX: gx, gridY: gy });
    }
  }
  return pts;
}

// ── Draw background grid ──
function drawBackground(ctx: CanvasRenderingContext2D, size: number, resolution: number): void {
  const pad = 20;
  const plotSize = size - 2 * pad;
  ctx.clearRect(0, 0, size, size);

  // Grid lines
  ctx.strokeStyle = "#1c1b1b";
  ctx.lineWidth = 1;
  for (let i = 0; i <= resolution; i++) {
    const pos = pad + (i / resolution) * plotSize;
    ctx.beginPath();
    ctx.moveTo(pos, pad);
    ctx.lineTo(pos, pad + plotSize);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(pad, pos);
    ctx.lineTo(pad + plotSize, pos);
    ctx.stroke();
  }
}

// ── Map point to canvas coordinates ──
function toCanvas(p: Point, size: number): [number, number] {
  const pad = 20;
  const plotSize = size - 2 * pad;
  return [pad + p.x * plotSize, pad + p.y * plotSize];
}

// ── Distance between two points (in grid cells) ──
function gridDistance(a: Point, b: Point): number {
  const dx = a.gridX - b.gridX;
  const dy = a.gridY - b.gridY;
  return Math.sqrt(dx * dx + dy * dy);
}

// ── Compute stats for an ordering ──
function computeStats(pts: Point[], order: number[]): { avgDist: number; localityPct: number } {
  if (order.length < 2) return { avgDist: 0, localityPct: 100 };

  let totalDist = 0;
  let localCount = 0;
  for (let i = 1; i < order.length; i++) {
    const d = gridDistance(pts[order[i]], pts[order[i - 1]]);
    totalDist += d;
    if (d <= 2) localCount++;
  }

  return {
    avgDist: totalDist / (order.length - 1),
    localityPct: (localCount / (order.length - 1)) * 100,
  };
}

// ── Main ──
async function init(): Promise<void> {
  cancelAnimationFrame(rafId);
  animating = false;

  const resolution = parseInt(resolutionSelect.value, 10);
  const speed = parseInt(speedSelect.value, 10);

  points = generateGrid(resolution);
  totalPoints = points.length;
  currentIndex = 0;

  // Compute Morton ordering
  const x = new Float64Array(points.map((p) => p.x));
  const y = new Float64Array(points.map((p) => p.y));
  try {
    mortonIndices = await mortonOrder2d(x, y);
  } catch {
    // Fallback: generate Morton indices manually if the import fails
    console.warn("mortonOrder2d failed, using fallback");
    mortonIndices = mortonOrderFallback(x, y);
  }

  // Random order: just index order (0, 1, 2, ...)
  const randomOrder = Array.from({ length: totalPoints }, (_, i) => i);

  // Setup canvases
  const rCtx = setupCanvas(randomCanvas);
  const mCtx = setupCanvas(mortonCanvas);
  const rSize = getCanvasSize(randomCanvas);
  const mSize = getCanvasSize(mortonCanvas);

  drawBackground(rCtx, rSize, resolution);
  drawBackground(mCtx, mSize, resolution);

  // Reset progress
  randomProgressEl.textContent = "0%";
  mortonProgressEl.textContent = "0%";
  statRandomDist.textContent = "--";
  statMortonDist.textContent = "--";
  statRandomLocality.textContent = "--";
  statMortonLocality.textContent = "--";

  // Instant mode
  if (speed === 0) {
    drawAllPoints(rCtx, rSize, randomOrder, resolution);
    drawAllPoints(mCtx, mSize, Array.from(mortonIndices), resolution);
    randomProgressEl.textContent = "100%";
    mortonProgressEl.textContent = "100%";
    showStats(randomOrder, Array.from(mortonIndices));
    return;
  }

  // Animated mode
  animating = true;
  currentIndex = 0;

  const mortonOrderArr = Array.from(mortonIndices);

  function animate(): void {
    if (!animating) return;

    const stepsPerFrame = speed;
    for (let s = 0; s < stepsPerFrame && currentIndex < totalPoints; s++) {
      const i = currentIndex;
      const t = i / (totalPoints - 1);
      const color = progressColor(t);
      const pointRadius = Math.max(2, Math.min(6, 120 / resolution));

      // Random canvas
      {
        const ri = randomOrder[i];
        const [cx, cy] = toCanvas(points[ri], rSize);

        // Line from previous
        if (i > 0) {
          const prevRi = randomOrder[i - 1];
          const [px, py] = toCanvas(points[prevRi], rSize);
          rCtx.strokeStyle = color;
          rCtx.globalAlpha = 0.4;
          rCtx.lineWidth = 1.5;
          rCtx.beginPath();
          rCtx.moveTo(px, py);
          rCtx.lineTo(cx, cy);
          rCtx.stroke();
          rCtx.globalAlpha = 1;
        }

        // Point
        rCtx.fillStyle = color;
        rCtx.beginPath();
        rCtx.arc(cx, cy, pointRadius, 0, Math.PI * 2);
        rCtx.fill();
      }

      // Morton canvas
      {
        const mi = mortonOrderArr[i];
        const [cx, cy] = toCanvas(points[mi], mSize);

        // Line from previous
        if (i > 0) {
          const prevMi = mortonOrderArr[i - 1];
          const [px, py] = toCanvas(points[prevMi], mSize);
          mCtx.strokeStyle = color;
          mCtx.globalAlpha = 0.4;
          mCtx.lineWidth = 1.5;
          mCtx.beginPath();
          mCtx.moveTo(px, py);
          mCtx.lineTo(cx, cy);
          mCtx.stroke();
          mCtx.globalAlpha = 1;
        }

        // Point
        mCtx.fillStyle = color;
        mCtx.beginPath();
        mCtx.arc(cx, cy, pointRadius, 0, Math.PI * 2);
        mCtx.fill();
      }

      currentIndex++;
    }

    const pct = Math.floor((currentIndex / totalPoints) * 100);
    randomProgressEl.textContent = `${pct}%`;
    mortonProgressEl.textContent = `${pct}%`;

    if (currentIndex < totalPoints) {
      rafId = requestAnimationFrame(animate);
    } else {
      animating = false;
      showStats(randomOrder, mortonOrderArr);
    }
  }

  rafId = requestAnimationFrame(animate);
}

function drawAllPoints(
  ctx: CanvasRenderingContext2D,
  size: number,
  order: number[],
  resolution: number,
): void {
  const pointRadius = Math.max(2, Math.min(6, 120 / resolution));
  for (let i = 0; i < order.length; i++) {
    const t = i / (order.length - 1);
    const color = progressColor(t);
    const pi = order[i];
    const [cx, cy] = toCanvas(points[pi], size);

    if (i > 0) {
      const prevPi = order[i - 1];
      const [px, py] = toCanvas(points[prevPi], size);
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(cx, cy);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, pointRadius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function showStats(randomOrder: number[], mortonOrder: number[]): void {
  const rStats = computeStats(points, randomOrder);
  const mStats = computeStats(points, mortonOrder);

  statRandomDist.textContent = rStats.avgDist.toFixed(2);
  statMortonDist.textContent = mStats.avgDist.toFixed(2);
  statRandomLocality.textContent = rStats.localityPct.toFixed(1) + "%";
  statMortonLocality.textContent = mStats.localityPct.toFixed(1) + "%";
}

// ── Inline Morton fallback (avoids WASM import issues in dev) ──
function mortonOrderFallback(x: Float64Array, y: Float64Array): Uint32Array {
  const n = Math.min(x.length, y.length);
  if (n === 0) return new Uint32Array();
  let xMin = Infinity,
    xMax = -Infinity,
    yMin = Infinity,
    yMax = -Infinity;
  for (let i = 0; i < n; i++) {
    if (x[i] < xMin) xMin = x[i];
    if (x[i] > xMax) xMax = x[i];
    if (y[i] < yMin) yMin = y[i];
    if (y[i] > yMax) yMax = y[i];
  }
  const xR = xMax > xMin ? xMax - xMin : 1;
  const yR = yMax > yMin ? yMax - yMin : 1;
  const sc = (1 << 16) - 1;
  function spread(v: number): number {
    v = (v | (v << 8)) & 0x00ff00ff;
    v = (v | (v << 4)) & 0x0f0f0f0f;
    v = (v | (v << 2)) & 0x33333333;
    v = (v | (v << 1)) & 0x55555555;
    return v;
  }
  const indexed: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const xi = Math.min(sc, Math.floor(((x[i] - xMin) / xR) * sc));
    const yi = Math.min(sc, Math.floor(((y[i] - yMin) / yR) * sc));
    indexed.push([spread(xi) | (spread(yi) << 1), i]);
  }
  indexed.sort((a, b) => a[0] - b[0]);
  const result = new Uint32Array(n);
  for (let i = 0; i < n; i++) result[i] = indexed[i][1];
  return result;
}

// ── Event listeners ──
resolutionSelect.addEventListener("change", init);
speedSelect.addEventListener("change", init);
restartBtn.addEventListener("click", init);

let resizeTimer: number;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(init, 200);
});

// Initial run
init().catch((err) => console.error("Morton renderer init failed:", err));
