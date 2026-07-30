import {
  logTransform,
  log10Transform,
  lnTransform,
  powerTransform,
  quantileNormalize,
} from "@vizcrush/transform";

// ---------------------------------------------------------------------------
// Data generators
// ---------------------------------------------------------------------------

function generateLogNormal(n: number, mu = 3.0, sigma = 1.0): Float64Array {
  const data = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const u1 = Math.random() || 1e-10;
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    data[i] = Math.exp(mu + sigma * z);
  }
  return data;
}

function generateExponential(n: number, lambda = 1.0): Float64Array {
  const data = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    data[i] = -Math.log(1 - Math.random()) / lambda;
  }
  return data;
}

function generatePareto(n: number, alpha = 1.5, xm = 1.0): Float64Array {
  const data = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    data[i] = xm / Math.pow(1 - Math.random(), 1 / alpha);
  }
  return data;
}

function generateNormal(n: number, mu = 0, sigma = 1): Float64Array {
  const data = new Float64Array(n);
  for (let i = 0; i < n; i += 2) {
    const u1 = Math.random() || 1e-10;
    const u2 = Math.random();
    const r = Math.sqrt(-2 * Math.log(u1));
    data[i] = mu + sigma * r * Math.cos(2 * Math.PI * u2);
    if (i + 1 < n) {
      data[i + 1] = mu + sigma * r * Math.sin(2 * Math.PI * u2);
    }
  }
  return data;
}

function generateUniform(n: number, min = 0, max = 1): Float64Array {
  const data = new Float64Array(n);
  const range = max - min;
  for (let i = 0; i < n; i++) {
    data[i] = min + Math.random() * range;
  }
  return data;
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

function skewness(data: Float64Array): number {
  let n = 0;
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    if (!isFinite(data[i])) continue;
    n++;
    sum += data[i];
  }
  if (n < 3) return NaN;
  const mean = sum / n;

  let m2 = 0;
  let m3 = 0;
  for (let i = 0; i < data.length; i++) {
    if (!isFinite(data[i])) continue;
    const d = data[i] - mean;
    m2 += d * d;
    m3 += d * d * d;
  }
  m2 /= n;
  m3 /= n;

  const s = Math.sqrt(m2);
  if (s === 0) return 0;
  return m3 / (s * s * s);
}

function dataRange(data: Float64Array): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < data.length; i++) {
    if (!isFinite(data[i])) continue;
    if (data[i] < min) min = data[i];
    if (data[i] > max) max = data[i];
  }
  return [min, max];
}

// ---------------------------------------------------------------------------
// Histogram renderer
// ---------------------------------------------------------------------------

const BG_COLOR = "#131313";
const GRID_COLOR = "rgba(255,255,255,0.06)";
const AXIS_COLOR = "rgba(255,255,255,0.25)";
const LABEL_COLOR = "rgba(255,255,255,0.5)";

interface OverlaySeries {
  data: Float64Array;
  color: string;
}

interface HistogramOptions {
  bins?: number;
  color?: string;
  xLabel?: string;
  overlay?: OverlaySeries[];
}

function computeBins(
  data: Float64Array,
  nBins: number,
  rangeMin?: number,
  rangeMax?: number,
): { counts: number[]; min: number; max: number; binWidth: number } {
  let min = rangeMin ?? Infinity;
  let max = rangeMax ?? -Infinity;
  if (rangeMin === undefined || rangeMax === undefined) {
    for (let i = 0; i < data.length; i++) {
      if (!isFinite(data[i])) continue;
      if (data[i] < min) min = data[i];
      if (data[i] > max) max = data[i];
    }
  }
  if (!isFinite(min) || !isFinite(max) || min === max) {
    min = (min || 0) - 1;
    max = (max || 0) + 1;
  }
  const binWidth = (max - min) / nBins;
  const counts = Array.from({ length: nBins }, () => 0);
  for (let i = 0; i < data.length; i++) {
    if (!isFinite(data[i])) continue;
    let idx = Math.floor((data[i] - min) / binWidth);
    if (idx < 0) idx = 0;
    if (idx >= nBins) idx = nBins - 1;
    counts[idx]++;
  }
  return { counts, min, max, binWidth };
}

function drawHistogram(
  canvas: HTMLCanvasElement,
  data: Float64Array,
  options?: HistogramOptions,
): void {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  canvas.width = w * dpr;
  canvas.height = h * dpr;

  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);

  // Clear
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, w, h);

  const nBins = options?.bins ?? 50;
  const color = options?.color ?? "#4a7fd4";
  const xLabel = options?.xLabel;
  const overlays = options?.overlay;

  const margin = { top: 12, right: 16, bottom: xLabel ? 36 : 24, left: 44 };
  const pw = w - margin.left - margin.right;
  const ph = h - margin.top - margin.bottom;

  // Determine shared range for overlays
  let globalMin = Infinity;
  let globalMax = -Infinity;
  const allSeries: { data: Float64Array; color: string }[] = [{ data, color }];
  if (overlays) allSeries.push(...overlays);

  for (const s of allSeries) {
    for (let i = 0; i < s.data.length; i++) {
      if (!isFinite(s.data[i])) continue;
      if (s.data[i] < globalMin) globalMin = s.data[i];
      if (s.data[i] > globalMax) globalMax = s.data[i];
    }
  }
  if (!isFinite(globalMin) || !isFinite(globalMax) || globalMin === globalMax) {
    globalMin = (globalMin || 0) - 1;
    globalMax = (globalMax || 0) + 1;
  }

  // Compute bins for all series
  const allBins = allSeries.map((s) => computeBins(s.data, nBins, globalMin, globalMax));

  // Find max count across all series
  let maxCount = 0;
  for (const b of allBins) {
    for (const c of b.counts) {
      if (c > maxCount) maxCount = c;
    }
  }
  if (maxCount === 0) maxCount = 1;

  // Grid lines
  ctx.save();
  ctx.translate(margin.left, margin.top);

  const nGridY = 4;
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  for (let i = 0; i <= nGridY; i++) {
    const y = (i / nGridY) * ph;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(pw, y);
    ctx.stroke();
  }

  // Draw bars for each series
  const barWidth = pw / nBins;
  const radius = Math.min(barWidth * 0.3, 3);

  for (let si = allSeries.length - 1; si >= 0; si--) {
    const bins = allBins[si];
    const seriesColor = allSeries[si].color;

    ctx.fillStyle = seriesColor;
    ctx.globalAlpha = allSeries.length > 1 ? 0.55 : 0.8;

    for (let i = 0; i < nBins; i++) {
      const count = bins.counts[i];
      if (count === 0) continue;
      const x = i * barWidth;
      const barH = (count / maxCount) * ph;
      const y = ph - barH;
      const bw = Math.max(barWidth - 1, 1);

      // Rounded top rectangle
      ctx.beginPath();
      if (barH > radius * 2) {
        ctx.moveTo(x, ph);
        ctx.lineTo(x, y + radius);
        ctx.arcTo(x, y, x + radius, y, radius);
        ctx.arcTo(x + bw, y, x + bw, y + radius, radius);
        ctx.lineTo(x + bw, ph);
      } else {
        ctx.rect(x, y, bw, barH);
      }
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1.0;

  // Axes
  ctx.strokeStyle = AXIS_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, ph);
  ctx.lineTo(pw, ph);
  ctx.stroke();

  // Y-axis labels
  ctx.fillStyle = LABEL_COLOR;
  ctx.font = "10px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= nGridY; i++) {
    const y = ph - (i / nGridY) * ph;
    const val = (i / nGridY) * maxCount;
    let label: string;
    if (val >= 1000) {
      label = (val / 1000).toFixed(1) + "k";
    } else {
      label = Math.round(val).toString();
    }
    ctx.fillText(label, -6, y);
  }

  // X-axis labels
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const nTicksX = 5;
  for (let i = 0; i <= nTicksX; i++) {
    const x = (i / nTicksX) * pw;
    const val = globalMin + (i / nTicksX) * (globalMax - globalMin);
    const label = formatNumber(val);
    ctx.fillText(label, x, ph + 4);
  }

  // X-axis label text
  if (xLabel) {
    ctx.fillStyle = LABEL_COLOR;
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(xLabel, pw / 2, ph + 20);
  }

  ctx.restore();
}

function formatNumber(v: number): string {
  const abs = Math.abs(v);
  if (abs === 0) return "0";
  if (abs >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (abs >= 1e3) return (v / 1e3).toFixed(1) + "k";
  if (abs >= 1) return v.toFixed(1);
  if (abs >= 0.01) return v.toFixed(2);
  return v.toExponential(1);
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

function $canvas(id: string): HTMLCanvasElement {
  return document.getElementById(id) as HTMLCanvasElement;
}

function $select(id: string): HTMLSelectElement {
  return document.getElementById(id) as HTMLSelectElement;
}

function $input(id: string): HTMLInputElement {
  return document.getElementById(id) as HTMLInputElement;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let rawData: Float64Array = new Float64Array(0);

// Quantile normalization data (generated once)
let qnSeries: Float64Array[] = [];
let qnNormalized: Float64Array[] = [];
const QN_COLORS = ["#4a7fd4", "#e8594f", "#4ecf6d"];

// ---------------------------------------------------------------------------
// Section 1 & 2: Log and Power transforms
// ---------------------------------------------------------------------------

function generateData(): Float64Array {
  const distType = $select("dist-type").value;
  const n = parseInt($select("data-size").value, 10);
  switch (distType) {
    case "exponential":
      return generateExponential(n, 0.5);
    case "pareto":
      return generatePareto(n, 1.5, 1.0);
    case "lognormal":
    default:
      return generateLogNormal(n, 3.0, 1.0);
  }
}

async function updateLogSection(): Promise<void> {
  rawData = generateData();

  const baseStr = $select("log-base").value;
  let _base: number;
  let logResult: Float64Array;
  switch (baseStr) {
    case "10":
      _base = 10;
      logResult = await log10Transform(rawData);
      break;
    case "2":
      _base = 2;
      logResult = await logTransform(rawData, 2);
      break;
    case "e":
    default:
      _base = Math.E;
      logResult = await lnTransform(rawData);
      break;
  }

  // Draw histograms
  drawHistogram($canvas("hist-raw"), rawData, {
    color: "#e8594f",
    xLabel: "Value",
  });
  drawHistogram($canvas("hist-log"), logResult, {
    color: "#4ecf6d",
    xLabel: baseStr === "e" ? "ln(x)" : `log${baseStr}(x)`,
  });

  // Stats
  const rawSkew = skewness(rawData);
  const logSkew = skewness(logResult);
  const [rMin, rMax] = dataRange(rawData);
  const [lMin, lMax] = dataRange(logResult);

  $("raw-skew").textContent = rawSkew.toFixed(2);
  $("raw-range").textContent = `${formatNumber(rMin)} .. ${formatNumber(rMax)}`;
  $("log-skew").textContent = logSkew.toFixed(2);
  $("log-range").textContent = `${formatNumber(lMin)} .. ${formatNumber(lMax)}`;
}

async function updatePowerSection(): Promise<void> {
  const exp = parseFloat($input("power-exp").value);
  $("power-exp-val").textContent = exp.toFixed(1);
  $("power-label").textContent = exp.toFixed(1);

  const powerResult = await powerTransform(rawData, exp);

  drawHistogram($canvas("hist-power-raw"), rawData, {
    color: "#e8594f",
    xLabel: "Value",
  });
  drawHistogram($canvas("hist-power-out"), powerResult, {
    color: "#c77dff",
    xLabel: `x^${exp.toFixed(1)}`,
  });
}

// ---------------------------------------------------------------------------
// Section 3: Quantile normalization
// ---------------------------------------------------------------------------

async function initQuantileSection(): Promise<void> {
  const n = 5000;
  qnSeries = [generateNormal(n, 10, 3), generateExponential(n, 0.2), generateUniform(n, 0, 25)];

  qnNormalized = await quantileNormalize(qnSeries);
  drawQuantilePlots();
}

function drawQuantilePlots(): void {
  // Before
  drawHistogram($canvas("qn-before"), qnSeries[0], {
    bins: 40,
    color: QN_COLORS[0],
    xLabel: "Value",
    overlay: [
      { data: qnSeries[1], color: QN_COLORS[1] },
      { data: qnSeries[2], color: QN_COLORS[2] },
    ],
  });

  // After
  drawHistogram($canvas("qn-after"), qnNormalized[0], {
    bins: 40,
    color: QN_COLORS[0],
    xLabel: "Value (normalized)",
    overlay: [
      { data: qnNormalized[1], color: QN_COLORS[1] },
      { data: qnNormalized[2], color: QN_COLORS[2] },
    ],
  });
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

async function onControlChange(): Promise<void> {
  await updateLogSection();
  await updatePowerSection();
}

async function onPowerSliderInput(): Promise<void> {
  await updatePowerSection();
}

function init(): void {
  $select("dist-type").addEventListener("change", onControlChange);
  $select("data-size").addEventListener("change", onControlChange);
  $select("log-base").addEventListener("change", onControlChange);
  $input("power-exp").addEventListener("input", onPowerSliderInput);

  window.addEventListener("resize", () => {
    // Redraw all on resize
    updateLogSection().then(() => updatePowerSection());
    drawQuantilePlots();
  });

  // Initial render
  updateLogSection().then(() => updatePowerSection());
  initQuantileSection();
}

init();
