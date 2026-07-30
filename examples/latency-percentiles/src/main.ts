import { DDSketch, KllSketch } from "@vizcrush/aggregate";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let ddSketch = new DDSketch(0.01);
let kllSketch = new KllSketch(200);

let rate = 100; // requests per second
let paused = false;
let pendingLatencies: number[] = [];

// Histogram bins
const HIST_BINS = 50;
const HIST_MAX = 500;
const histCounts = new Uint32Array(HIST_BINS);

// Time-series rolling buffers (last 200 readings)
const SERIES_LEN = 200;
const ddSeries = {
  p50: new Float64Array(SERIES_LEN),
  p90: new Float64Array(SERIES_LEN),
  p99: new Float64Array(SERIES_LEN),
  len: 0,
  head: 0,
};
const kllSeries = {
  p50: new Float64Array(SERIES_LEN),
  p90: new Float64Array(SERIES_LEN),
  p99: new Float64Array(SERIES_LEN),
  len: 0,
  head: 0,
};

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const elP50 = document.getElementById("p50")!;
const elP90 = document.getElementById("p90")!;
const elP95 = document.getElementById("p95")!;
const elP99 = document.getElementById("p99")!;
const elCount = document.getElementById("total-count")!;
const elMemory = document.getElementById("memory")!;
const elDdAccuracy = document.getElementById("dd-accuracy")!;
const elDdBuckets = document.getElementById("dd-buckets")!;
const elKllAccuracy = document.getElementById("kll-accuracy")!;
const elKllRetained = document.getElementById("kll-retained")!;

const histCanvas = document.getElementById("histogram") as HTMLCanvasElement;
const ddCanvas = document.getElementById("ddsketch-chart") as HTMLCanvasElement;
const kllCanvas = document.getElementById("kll-chart") as HTMLCanvasElement;

const histCtx = histCanvas.getContext("2d")!;
const ddCtx = ddCanvas.getContext("2d")!;
const kllCtx = kllCanvas.getContext("2d")!;

// ---------------------------------------------------------------------------
// Latency generation (log-normal via Box-Muller)
// ---------------------------------------------------------------------------

function generateLatency(): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.exp(3.9 + z * 0.8); // median ~50ms, p99 ~350ms
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

const rateButtons = document.querySelectorAll<HTMLButtonElement>("[data-rate]");
const btnPause = document.getElementById("btn-pause") as HTMLButtonElement;
const btnReset = document.getElementById("btn-reset") as HTMLButtonElement;

rateButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    rateButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    rate = parseInt(btn.dataset.rate!, 10);
    restartInterval();
  });
});

btnPause.addEventListener("click", () => {
  paused = !paused;
  btnPause.textContent = paused ? "Resume" : "Pause";
  btnPause.classList.toggle("active", paused);
});

btnReset.addEventListener("click", () => {
  ddSketch = new DDSketch(0.01);
  kllSketch = new KllSketch(200);
  pendingLatencies.length = 0;
  histCounts.fill(0);
  ddSeries.len = 0;
  ddSeries.head = 0;
  kllSeries.len = 0;
  kllSeries.head = 0;
  elP50.textContent = "—";
  elP90.textContent = "—";
  elP95.textContent = "—";
  elP99.textContent = "—";
  elCount.textContent = "0";
  elMemory.textContent = "—";
});

// ---------------------------------------------------------------------------
// Data ingestion interval
// ---------------------------------------------------------------------------

let ingestInterval: ReturnType<typeof setInterval> | null = null;

function restartInterval() {
  if (ingestInterval !== null) clearInterval(ingestInterval);

  // Emit latencies at ~60 Hz, batching to match target rate
  const batchSize = Math.max(1, Math.round(rate / 60));
  ingestInterval = setInterval(() => {
    if (paused) return;
    for (let i = 0; i < batchSize; i++) {
      pendingLatencies.push(generateLatency());
    }
  }, 1000 / 60);
}

restartInterval();

// ---------------------------------------------------------------------------
// Canvas sizing helper
// ---------------------------------------------------------------------------

function sizeCanvas(canvas: HTMLCanvasElement): { w: number; h: number } {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(rect.width * dpr);
  const h = Math.round(rect.height * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { w, h };
}

// ---------------------------------------------------------------------------
// Histogram rendering
// ---------------------------------------------------------------------------

function drawHistogram() {
  const { w, h } = sizeCanvas(histCanvas);
  histCtx.clearRect(0, 0, w, h);

  let maxCount = 1;
  for (let i = 0; i < HIST_BINS; i++) {
    if (histCounts[i] > maxCount) maxCount = histCounts[i];
  }

  const pad = { left: 50, right: 20, top: 20, bottom: 30 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;
  const barW = plotW / HIST_BINS;

  // Y-axis labels
  histCtx.fillStyle = "#666";
  histCtx.font = `${11 * (window.devicePixelRatio || 1)}px system-ui`;
  histCtx.textAlign = "right";
  histCtx.textBaseline = "middle";
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + plotH * (1 - i / 4);
    const val = Math.round((maxCount * i) / 4);
    histCtx.fillText(String(val), pad.left - 8, y);
    // Grid line
    histCtx.strokeStyle = "#222";
    histCtx.beginPath();
    histCtx.moveTo(pad.left, y);
    histCtx.lineTo(w - pad.right, y);
    histCtx.stroke();
  }

  // X-axis labels
  histCtx.textAlign = "center";
  histCtx.textBaseline = "top";
  for (let i = 0; i <= 5; i++) {
    const x = pad.left + (plotW * i) / 5;
    const ms = Math.round((HIST_MAX * i) / 5);
    histCtx.fillText(`${ms}ms`, x, pad.top + plotH + 8);
  }

  // Bars
  for (let i = 0; i < HIST_BINS; i++) {
    const count = histCounts[i];
    if (count === 0) continue;
    const barH = (count / maxCount) * plotH;
    const x = pad.left + i * barW;
    const y = pad.top + plotH - barH;

    // Color gradient: green -> yellow -> red
    const t = i / (HIST_BINS - 1);
    const r = Math.round(t < 0.5 ? t * 2 * 250 : 250);
    const g = Math.round(t < 0.5 ? 220 : 220 * (1 - (t - 0.5) * 2));
    histCtx.fillStyle = `rgb(${r}, ${g}, 60)`;
    histCtx.fillRect(x + 1, y, barW - 2, barH);
  }
}

// ---------------------------------------------------------------------------
// Time-series chart rendering
// ---------------------------------------------------------------------------

type SeriesData = typeof ddSeries;

function pushSeries(series: SeriesData, p50: number, p90: number, p99: number) {
  const idx = series.head;
  series.p50[idx] = p50;
  series.p90[idx] = p90;
  series.p99[idx] = p99;
  series.head = (series.head + 1) % SERIES_LEN;
  if (series.len < SERIES_LEN) series.len++;
}

function drawTimeSeries(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  series: SeriesData,
) {
  const { w, h } = sizeCanvas(canvas);
  ctx.clearRect(0, 0, w, h);

  if (series.len < 2) return;

  const pad = { left: 50, right: 20, top: 20, bottom: 10 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;
  const yMax = 500;

  // Y-axis labels and grid
  ctx.fillStyle = "#666";
  ctx.font = `${11 * (window.devicePixelRatio || 1)}px system-ui`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= 5; i++) {
    const y = pad.top + plotH * (1 - i / 5);
    const val = Math.round((yMax * i) / 5);
    ctx.fillText(`${val}`, pad.left - 8, y);
    ctx.strokeStyle = "#1c1b1b";
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
  }

  // Draw lines
  const lines: { arr: Float64Array; color: string; label: string }[] = [
    { arr: series.p50, color: "#4ade80", label: "p50" },
    { arr: series.p90, color: "#facc15", label: "p90" },
    { arr: series.p99, color: "#f87171", label: "p99" },
  ];

  const dpr = window.devicePixelRatio || 1;

  for (const line of lines) {
    ctx.beginPath();
    ctx.strokeStyle = line.color;
    ctx.lineWidth = 2 * dpr;

    for (let i = 0; i < series.len; i++) {
      // Read from oldest to newest
      const dataIdx = series.len < SERIES_LEN ? i : (series.head + i) % SERIES_LEN;
      const val = Math.min(line.arr[dataIdx], yMax);
      const x = pad.left + (i / (series.len - 1)) * plotW;
      const y = pad.top + plotH * (1 - val / yMax);

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Legend
  ctx.font = `${12 * dpr}px system-ui`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  let legendX = pad.left + 10;
  for (const line of lines) {
    ctx.fillStyle = line.color;
    ctx.fillRect(legendX, pad.top + 4, 14 * dpr, 3 * dpr);
    ctx.fillText(line.label, legendX + 18 * dpr, pad.top + 0);
    legendX += 70 * dpr;
  }
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

// ---------------------------------------------------------------------------
// Main render loop
// ---------------------------------------------------------------------------

let frameCount = 0;

function frame() {
  requestAnimationFrame(frame);

  // Drain pending latencies into sketches and histogram
  if (pendingLatencies.length > 0) {
    for (let i = 0; i < pendingLatencies.length; i++) {
      const v = pendingLatencies[i];
      ddSketch.add(v);
      kllSketch.add(v);

      // Histogram bin
      const bin = Math.min(HIST_BINS - 1, Math.max(0, Math.floor((v / HIST_MAX) * HIST_BINS)));
      histCounts[bin]++;
    }
    pendingLatencies.length = 0;
  }

  // Update time-series every ~10 frames (~6 Hz)
  frameCount++;
  if (frameCount % 10 === 0 && ddSketch.count > 0) {
    pushSeries(ddSeries, ddSketch.quantile(0.5), ddSketch.quantile(0.9), ddSketch.quantile(0.99));
    pushSeries(
      kllSeries,
      kllSketch.quantile(0.5),
      kllSketch.quantile(0.9),
      kllSketch.quantile(0.99),
    );
  }

  // Update gauges (from DDSketch)
  if (ddSketch.count > 0) {
    elP50.textContent = ddSketch.quantile(0.5).toFixed(1);
    elP90.textContent = ddSketch.quantile(0.9).toFixed(1);
    elP95.textContent = ddSketch.quantile(0.95).toFixed(1);
    elP99.textContent = ddSketch.quantile(0.99).toFixed(1);
  }
  elCount.textContent = formatCount(ddSketch.count);

  // Memory estimate: rough size of retained items
  const ddBucketCount =
    (ddSketch as any)._positiveBuckets.size + (ddSketch as any)._negativeBuckets.size;
  const kllRetained = kllSketch.numRetained;
  const totalBytes = ddBucketCount * 16 + kllRetained * 8;
  if (totalBytes > 1024) {
    elMemory.textContent = (totalBytes / 1024).toFixed(1) + " KB";
  } else {
    elMemory.textContent = totalBytes + " B";
  }

  // Stats
  elDdAccuracy.textContent = (ddSketch.relativeAccuracy * 100).toFixed(1) + "%";
  elDdBuckets.textContent = String(ddBucketCount);
  elKllAccuracy.textContent = "~" + ((1.0 / Math.sqrt(kllRetained)) * 100).toFixed(1) + "%";
  elKllRetained.textContent = String(kllRetained);

  // Render canvases
  drawHistogram();
  drawTimeSeries(ddCtx, ddCanvas, ddSeries);
  drawTimeSeries(kllCtx, kllCanvas, kllSeries);
}

requestAnimationFrame(frame);
