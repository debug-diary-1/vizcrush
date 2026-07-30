import { logTransform } from "@vizcrush/transform";

// --- Data generation ---

function boxMuller(): number {
  let u = 0,
    v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function generateData(dist: string, n: number): Float64Array {
  const data = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    switch (dist) {
      case "lognormal":
        data[i] = Math.exp(boxMuller() * 1.2 + 1);
        break;
      case "exponential":
        data[i] = -Math.log(1 - Math.random()) / 0.3;
        break;
      case "pareto": {
        const alpha = 2.5;
        data[i] = 1 / Math.pow(1 - Math.random(), 1 / alpha);
        break;
      }
      case "chi-squared": {
        // k=4 degrees of freedom via sum of squared normals
        let s = 0;
        for (let j = 0; j < 4; j++) {
          const z = boxMuller();
          s += z * z;
        }
        data[i] = s;
        break;
      }
    }
  }
  return data;
}

// --- Stats ---

function computeStats(data: Float64Array) {
  let n = 0,
    sum = 0,
    sum2 = 0,
    sum3 = 0,
    sum4 = 0;
  let min = Infinity,
    max = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (!isFinite(v)) continue;
    n++;
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const mean = sum / n;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (!isFinite(v)) continue;
    const d = v - mean;
    sum2 += d * d;
    sum3 += d * d * d;
    sum4 += d * d * d * d;
  }
  const variance = sum2 / n;
  const std = Math.sqrt(variance);
  const skewness = std > 0 ? sum3 / n / (std * std * std) : 0;
  const kurtosis = std > 0 ? sum4 / n / (variance * variance) - 3 : 0;
  return { mean, std, min, max, skewness, kurtosis, n };
}

function filterFinite(data: Float64Array): Float64Array {
  const out: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (isFinite(data[i])) out.push(data[i]);
  }
  return new Float64Array(out);
}

// --- Histogram computation ---

function computeBins(data: Float64Array, numBins: number) {
  let min = Infinity,
    max = -Infinity;
  for (let i = 0; i < data.length; i++) {
    if (!isFinite(data[i])) continue;
    if (data[i] < min) min = data[i];
    if (data[i] > max) max = data[i];
  }
  if (min === max) {
    max = min + 1;
  }
  const binWidth = (max - min) / numBins;
  const counts = new Float64Array(numBins);
  for (let i = 0; i < data.length; i++) {
    if (!isFinite(data[i])) continue;
    let bin = Math.floor((data[i] - min) / binWidth);
    if (bin >= numBins) bin = numBins - 1;
    if (bin < 0) bin = 0;
    counts[bin]++;
  }
  return { counts, min, max, binWidth };
}

// --- Canvas rendering ---

function setupCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  return ctx;
}

const MARGIN = { top: 20, right: 20, bottom: 35, left: 55 };

function drawHistogram(canvas: HTMLCanvasElement, data: Float64Array, color: string, numBins = 60) {
  const ctx = setupCanvas(canvas);
  const rect = canvas.getBoundingClientRect();
  const w = rect.width,
    h = rect.height;
  const plotW = w - MARGIN.left - MARGIN.right;
  const plotH = h - MARGIN.top - MARGIN.bottom;

  ctx.clearRect(0, 0, w, h);

  const { counts, min, max, binWidth: _binWidth } = computeBins(data, numBins);
  let maxCount = 0;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] > maxCount) maxCount = counts[i];
  }
  if (maxCount === 0) return;

  // Grid lines
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = MARGIN.top + plotH * (1 - i / 4);
    ctx.beginPath();
    ctx.moveTo(MARGIN.left, y);
    ctx.lineTo(MARGIN.left + plotW, y);
    ctx.stroke();
  }

  // Bars
  const barW = plotW / numBins;
  const r = Math.min(2, barW / 3);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.85;
  for (let i = 0; i < numBins; i++) {
    if (counts[i] === 0) continue;
    const barH = (counts[i] / maxCount) * plotH;
    const x = MARGIN.left + i * barW;
    const y = MARGIN.top + plotH - barH;
    roundedRect(ctx, x + 0.5, y, barW - 1, barH, r);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Y-axis labels
  ctx.fillStyle = "#555";
  ctx.font = "11px 'JetBrains Mono', 'SF Mono', monospace";
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i++) {
    const y = MARGIN.top + plotH * (1 - i / 4);
    const val = Math.round((maxCount * i) / 4);
    ctx.fillText(String(val), MARGIN.left - 6, y + 4);
  }

  // X-axis ticks
  ctx.textAlign = "center";
  const tickCount = 5;
  for (let i = 0; i <= tickCount; i++) {
    const val = min + (max - min) * (i / tickCount);
    const x = MARGIN.left + plotW * (i / tickCount);
    ctx.fillText(formatNum(val), x, h - 8);
    ctx.beginPath();
    ctx.moveTo(x, MARGIN.top + plotH);
    ctx.lineTo(x, MARGIN.top + plotH + 4);
    ctx.strokeStyle = "#555";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Axes
  ctx.strokeStyle = "#444";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(MARGIN.left, MARGIN.top);
  ctx.lineTo(MARGIN.left, MARGIN.top + plotH);
  ctx.lineTo(MARGIN.left + plotW, MARGIN.top + plotH);
  ctx.stroke();
}

function drawOverlaidHistograms(
  canvas: HTMLCanvasElement,
  datasets: Float64Array[],
  colors: string[],
  numBins = 60,
) {
  const ctx = setupCanvas(canvas);
  const rect = canvas.getBoundingClientRect();
  const w = rect.width,
    h = rect.height;
  const plotW = w - MARGIN.left - MARGIN.right;
  const plotH = h - MARGIN.top - MARGIN.bottom;
  ctx.clearRect(0, 0, w, h);

  // Find global min/max
  let gMin = Infinity,
    gMax = -Infinity;
  for (const d of datasets) {
    for (let i = 0; i < d.length; i++) {
      if (!isFinite(d[i])) continue;
      if (d[i] < gMin) gMin = d[i];
      if (d[i] > gMax) gMax = d[i];
    }
  }
  if (gMin === gMax) gMax = gMin + 1;
  const bw = (gMax - gMin) / numBins;

  // Compute normalized bins (area = 1)
  const allNorm: Float64Array[] = [];
  let maxDensity = 0;
  for (const d of datasets) {
    const counts = new Float64Array(numBins);
    let finiteCount = 0;
    for (let i = 0; i < d.length; i++) {
      if (!isFinite(d[i])) continue;
      finiteCount++;
      let bin = Math.floor((d[i] - gMin) / bw);
      if (bin >= numBins) bin = numBins - 1;
      if (bin < 0) bin = 0;
      counts[bin]++;
    }
    // Normalize to density
    for (let i = 0; i < numBins; i++) {
      counts[i] = counts[i] / (finiteCount * bw);
      if (counts[i] > maxDensity) maxDensity = counts[i];
    }
    allNorm.push(counts);
  }

  // Grid
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = MARGIN.top + plotH * (1 - i / 4);
    ctx.beginPath();
    ctx.moveTo(MARGIN.left, y);
    ctx.lineTo(MARGIN.left + plotW, y);
    ctx.stroke();
  }

  const barW = plotW / numBins;
  for (let d = 0; d < allNorm.length; d++) {
    ctx.fillStyle = colors[d];
    ctx.globalAlpha = 0.4;
    for (let i = 0; i < numBins; i++) {
      if (allNorm[d][i] === 0) continue;
      const barH = (allNorm[d][i] / maxDensity) * plotH;
      const x = MARGIN.left + i * barW;
      const y = MARGIN.top + plotH - barH;
      ctx.fillRect(x, y, barW - 0.5, barH);
    }
  }
  ctx.globalAlpha = 1;

  // Legend
  ctx.font = "12px 'JetBrains Mono', 'SF Mono', monospace";
  const labels = ["Raw", "Transformed"];
  for (let i = 0; i < datasets.length; i++) {
    const lx = MARGIN.left + 10 + i * 120;
    ctx.fillStyle = colors[i];
    ctx.globalAlpha = 0.8;
    ctx.fillRect(lx, MARGIN.top + 4, 14, 10);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#888";
    ctx.textAlign = "left";
    ctx.fillText(labels[i] || "", lx + 20, MARGIN.top + 13);
  }

  // X-axis
  ctx.fillStyle = "#555";
  ctx.textAlign = "center";
  for (let i = 0; i <= 5; i++) {
    const val = gMin + (gMax - gMin) * (i / 5);
    const x = MARGIN.left + plotW * (i / 5);
    ctx.fillText(formatNum(val), x, h - 8);
  }

  // Axes
  ctx.strokeStyle = "#444";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(MARGIN.left, MARGIN.top);
  ctx.lineTo(MARGIN.left, MARGIN.top + plotH);
  ctx.lineTo(MARGIN.left + plotW, MARGIN.top + plotH);
  ctx.stroke();
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  r = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function formatNum(v: number): string {
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  if (Math.abs(v) >= 1) return v.toFixed(2);
  return v.toPrecision(3);
}

// --- DOM refs ---

const elDist = document.getElementById("dist-type") as HTMLSelectElement;
const elSize = document.getElementById("sample-size") as HTMLSelectElement;
const elBase = document.getElementById("log-base") as HTMLSelectElement;
const elCustomWrap = document.getElementById("custom-base-wrap")!;
const elCustomBase = document.getElementById("custom-base") as HTMLInputElement;
const elCustomVal = document.getElementById("custom-base-val")!;
const elArrow = document.getElementById("arrow-label")!;

function getBase(): number {
  const v = elBase.value;
  if (v === "e") return Math.E;
  if (v === "custom") return parseFloat(elCustomBase.value);
  return parseFloat(v);
}

function getBaseLabel(): string {
  const v = elBase.value;
  if (v === "e") return "ln(x)";
  if (v === "custom") return `log_${parseFloat(elCustomBase.value).toFixed(1)}(x)`;
  return `log_${v}(x)`;
}

function setText(id: string, text: string) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// --- Main update ---

async function update() {
  const dist = elDist.value;
  const n = parseInt(elSize.value, 10);
  const base = getBase();

  elArrow.innerHTML = `&rarr; ${getBaseLabel()}`;
  elCustomWrap.className = elBase.value === "custom" ? "custom-base visible" : "custom-base";
  elCustomVal.textContent = parseFloat(elCustomBase.value).toFixed(1);

  const raw = generateData(dist, n);
  const transformed = filterFinite(await logTransform(raw, base));

  // Draw histograms
  drawHistogram(document.getElementById("canvas-raw") as HTMLCanvasElement, raw, "#e07040");
  drawHistogram(
    document.getElementById("canvas-transformed") as HTMLCanvasElement,
    transformed,
    "#40c0a0",
  );

  // Overlay
  drawOverlaidHistograms(
    document.getElementById("canvas-overlay") as HTMLCanvasElement,
    [raw, transformed],
    ["#e07040", "#40c0a0"],
  );

  // Stats
  const sBefore = computeStats(raw);
  const sAfter = computeStats(transformed);

  setText("stat-skew-before", sBefore.skewness.toFixed(3));
  setText("stat-skew-after", sAfter.skewness.toFixed(3));
  setText("stat-kurt-before", sBefore.kurtosis.toFixed(3));
  setText("stat-kurt-after", sAfter.kurtosis.toFixed(3));
  setText("stat-mean-before", formatNum(sBefore.mean));
  setText("stat-mean-after", formatNum(sAfter.mean));
  setText("stat-min-before", formatNum(sBefore.min));
  setText("stat-min-after", formatNum(sAfter.min));
  setText("stat-max-before", formatNum(sBefore.max));
  setText("stat-max-after", formatNum(sAfter.max));
  setText("stat-std-before", formatNum(sBefore.std));
  setText("stat-std-after", formatNum(sAfter.std));
}

// --- Event listeners ---

elDist.addEventListener("change", update);
elSize.addEventListener("change", update);
elBase.addEventListener("change", update);
elCustomBase.addEventListener("input", update);

window.addEventListener("resize", update);
update();
