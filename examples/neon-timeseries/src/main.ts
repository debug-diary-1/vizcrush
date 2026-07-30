import { lttbSync } from "@vizcrush/downsample";

// --- Config ---
const MAX_RAW = 100_000;
const SAMPLES_PER_FRAME = 100;

interface Series {
  name: string;
  color: [number, number, number];
  rawX: Float64Array;
  rawY: Float64Array;
  len: number;
  visible: boolean;
}

const series: Series[] = [
  {
    name: "CPU",
    color: [74, 127, 212],
    rawX: new Float64Array(MAX_RAW),
    rawY: new Float64Array(MAX_RAW),
    len: 0,
    visible: true,
  },
  {
    name: "Memory",
    color: [212, 74, 127],
    rawX: new Float64Array(MAX_RAW),
    rawY: new Float64Array(MAX_RAW),
    len: 0,
    visible: true,
  },
  {
    name: "Network",
    color: [74, 212, 160],
    rawX: new Float64Array(MAX_RAW),
    rawY: new Float64Array(MAX_RAW),
    len: 0,
    visible: true,
  },
];

let speed = 1;
let lttbThreshold = 1000;
let time = 0;
let lttbMs = 0;
let totalPoints = 0;
let displayedPoints = 0;

// --- Canvas setup ---
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

function resize() {
  const dpr = devicePixelRatio;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
resize();
addEventListener("resize", resize);

// --- Controls ---
const statsBar = document.getElementById("stats-bar")!;

document.querySelectorAll<HTMLButtonElement>("[data-series]").forEach((btn) => {
  const c = series[+btn.dataset.series!].color;
  btn.style.setProperty("--dot-color", `rgb(${c[0]},${c[1]},${c[2]})`);
  (btn as HTMLElement).style.cssText += `; --dot-color: rgb(${c[0]},${c[1]},${c[2]})`;
  // Apply dot color via pseudo-element workaround
  btn.addEventListener("click", () => {
    const s = series[+btn.dataset.series!];
    s.visible = !s.visible;
    btn.classList.toggle("active", s.visible);
    btn.classList.toggle("off", !s.visible);
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((btn) => {
  btn.addEventListener("click", () => {
    speed = +btn.dataset.speed!;
    document.querySelectorAll("[data-speed]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-lttb]").forEach((btn) => {
  btn.addEventListener("click", () => {
    lttbThreshold = +btn.dataset.lttb!;
    document.querySelectorAll("[data-lttb]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  });
});

// Inject series dot colors
const style = document.createElement("style");
style.textContent = series
  .map(
    (s, i) =>
      `[data-series="${i}"]::before { background: rgb(${s.color.join(",")}); box-shadow: 0 0 4px rgb(${s.color.join(",")}); }`,
  )
  .join("\n");
document.head.appendChild(style);

// --- Data generation ---
function generateSample(idx: number, t: number): number {
  switch (idx) {
    case 0:
      return 40 + Math.sin(t * 0.5) * 20 + Math.random() * 15;
    case 1:
      return 60 + Math.sin(t * 0.3) * 10 + Math.random() * 8;
    case 2:
      return 20 + Math.abs(Math.sin(t * 0.8)) * 50 + Math.random() * 10;
    default:
      return 0;
  }
}

function pushSamples() {
  const count = SAMPLES_PER_FRAME * speed;
  for (let s = 0; s < series.length; s++) {
    const ser = series[s];
    for (let i = 0; i < count; i++) {
      const t = time + i * 0.01;
      if (ser.len < MAX_RAW) {
        ser.rawX[ser.len] = t;
        ser.rawY[ser.len] = generateSample(s, t);
        ser.len++;
      } else {
        // Shift half the buffer out
        const half = MAX_RAW >> 1;
        ser.rawX.copyWithin(0, half);
        ser.rawY.copyWithin(0, half);
        ser.len = half;
        ser.rawX[ser.len] = t;
        ser.rawY[ser.len] = generateSample(s, t);
        ser.len++;
      }
    }
  }
  time += count * 0.01;
}

// --- Drawing ---
const MARGIN = { top: 60, right: 100, bottom: 50, left: 60 };

function drawPath(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

function drawNeonLine(
  ctx: CanvasRenderingContext2D,
  pts: { x: number; y: number }[],
  color: [number, number, number],
) {
  if (pts.length < 2) return;
  const [r, g, b] = color;

  // Bloom (widest, faintest)
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.filter = "blur(12px)";
  ctx.strokeStyle = `rgba(${r},${g},${b},0.08)`;
  ctx.lineWidth = 20;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  drawPath(ctx, pts);
  ctx.restore();

  // Glow
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.filter = "blur(4px)";
  ctx.strokeStyle = `rgba(${r},${g},${b},0.15)`;
  ctx.lineWidth = 8;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  drawPath(ctx, pts);
  ctx.restore();

  // Color halo
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = `rgba(${r},${g},${b},0.5)`;
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  drawPath(ctx, pts);
  ctx.restore();

  // Core (bright white)
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  drawPath(ctx, pts);
  ctx.restore();
}

function drawReflection(
  ctx: CanvasRenderingContext2D,
  pts: { x: number; y: number }[],
  color: [number, number, number],
  reflectY: number,
) {
  if (pts.length < 2) return;
  const reflected = pts.map((p) => ({ x: p.x, y: reflectY + (reflectY - p.y) * 0.3 }));
  const [r, g, b] = color;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.filter = "blur(8px)";
  ctx.strokeStyle = `rgba(${r},${g},${b},0.03)`;
  ctx.lineWidth = 6;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  drawPath(ctx, reflected);
  ctx.restore();
}

let fps = 60;
let _lastFrameTime = performance.now();
let frameCount = 0;
let lastFpsUpdate = performance.now();

function frame(now: number) {
  requestAnimationFrame(frame);

  // FPS tracking
  frameCount++;
  if (now - lastFpsUpdate >= 500) {
    fps = Math.round((frameCount * 1000) / (now - lastFpsUpdate));
    frameCount = 0;
    lastFpsUpdate = now;
  }
  _lastFrameTime = now;

  pushSamples();

  const w = innerWidth;
  const h = innerHeight;
  const chartL = MARGIN.left;
  const chartR = w - MARGIN.right;
  const chartT = MARGIN.top;
  const chartB = h - MARGIN.bottom;
  const chartW = chartR - chartL;
  const chartH = chartB - chartT;

  // Clear
  ctx.fillStyle = "#131313";
  ctx.fillRect(0, 0, w, h);

  // Grid lines
  ctx.strokeStyle = "rgba(42,42,42,0.3)";
  ctx.lineWidth = 1;
  const yLabels = [0, 25, 50, 75, 100];
  ctx.font = "11px 'JetBrains Mono', monospace";
  ctx.fillStyle = "#555";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const pct of yLabels) {
    const y = chartB - (pct / 100) * chartH;
    ctx.beginPath();
    ctx.moveTo(chartL, y);
    ctx.lineTo(chartR, y);
    ctx.stroke();
    ctx.fillText(`${pct}%`, chartL - 10, y);
  }

  // Downsample + draw each series
  totalPoints = 0;
  displayedPoints = 0;
  const t0 = performance.now();

  const allScreenPts: { pts: { x: number; y: number }[]; ser: Series }[] = [];

  for (const ser of series) {
    if (!ser.visible || ser.len < 2) continue;
    totalPoints += ser.len;

    const xSlice = ser.rawX.subarray(0, ser.len);
    const ySlice = ser.rawY.subarray(0, ser.len);
    const threshold = Math.min(lttbThreshold, ser.len);
    const result = lttbSync(xSlice, ySlice, threshold);
    displayedPoints += result.x.length;

    // Map to screen coords
    const xMin = xSlice[0];
    const xMax = xSlice[ser.len - 1];
    const xRange = xMax - xMin || 1;

    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < result.x.length; i++) {
      const sx = chartL + ((result.x[i] - xMin) / xRange) * chartW;
      const sy = chartB - (Math.min(Math.max(result.y[i], 0), 100) / 100) * chartH;
      pts.push({ x: sx, y: sy });
    }

    allScreenPts.push({ pts, ser });
  }

  lttbMs = performance.now() - t0;

  // Draw reflections first
  for (const { pts, ser } of allScreenPts) {
    drawReflection(ctx, pts, ser.color, chartB);
  }

  // Draw neon lines
  for (const { pts, ser } of allScreenPts) {
    drawNeonLine(ctx, pts, ser.color);
  }

  // Pulsing dot + value label at end of each line
  const pulseAlpha = 0.5 + Math.sin(now * 0.006) * 0.5;
  for (const { pts, ser } of allScreenPts) {
    const last = pts[pts.length - 1];
    const [r, g, b] = ser.color;

    // Pulse glow
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.beginPath();
    ctx.arc(last.x, last.y, 8 + pulseAlpha * 4, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${r},${g},${b},${0.15 * pulseAlpha})`;
    ctx.fill();
    ctx.restore();

    // Dot
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.beginPath();
    ctx.arc(last.x, last.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,0.9)`;
    ctx.fill();
    ctx.restore();

    // Value label
    const rawVal = ser.rawY[ser.len - 1];
    ctx.save();
    ctx.font = "12px 'JetBrains Mono', monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.shadowColor = `rgb(${r},${g},${b})`;
    ctx.shadowBlur = 8;
    ctx.fillText(`${rawVal.toFixed(1)}%`, last.x + 12, last.y);
    ctx.restore();
  }

  // Legend (top-right)
  ctx.save();
  ctx.font = "11px 'JetBrains Mono', monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  let ly = 24;
  for (const ser of series) {
    const [r, g, b] = ser.color;
    const alpha = ser.visible ? 1 : 0.25;

    // Dot
    ctx.beginPath();
    ctx.arc(w - 90, ly, 4, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
    ctx.shadowColor = `rgb(${r},${g},${b})`;
    ctx.shadowBlur = ser.visible ? 6 : 0;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Name
    ctx.fillStyle = `rgba(229,226,225,${alpha})`;
    ctx.fillText(ser.name, w - 80, ly);
    ly += 20;
  }
  ctx.restore();

  // Stats
  statsBar.textContent = `Points: ${totalPoints.toLocaleString()} | Displayed: ${displayedPoints.toLocaleString()} | LTTB: ${lttbMs.toFixed(1)}ms | FPS: ${fps}`;
}

requestAnimationFrame(frame);
