import { quantileNormalize } from "@vizcrush/transform";

const COLORS = ["#e05050", "#5090e0", "#50c070", "#e0a030"];
const LABELS = ["Series A", "Series B", "Series C", "Series D"];
const N = 5000;

// --- Data generation ---

function boxMuller(): number {
  let u = 0,
    v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function genNormal(mean: number, std: number, n: number): Float64Array {
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) d[i] = boxMuller() * std + mean;
  return d;
}

function genExponential(lambda: number, n: number): Float64Array {
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) d[i] = -Math.log(1 - Math.random()) / lambda;
  return d;
}

function genUniform(lo: number, hi: number, n: number): Float64Array {
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) d[i] = lo + Math.random() * (hi - lo);
  return d;
}

function genBimodal(n: number): Float64Array {
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    d[i] = Math.random() < 0.5 ? boxMuller() * 5 + 30 : boxMuller() * 5 + 70;
  }
  return d;
}

function generateSeries(mix: string, count: number): Float64Array[] {
  const generators: (() => Float64Array)[] = [];

  if (mix === "diverse") {
    generators.push(
      () => genNormal(50, 10, N),
      () => genExponential(0.1, N),
      () => genUniform(0, 100, N),
      () => genBimodal(N),
    );
  } else if (mix === "all-skewed") {
    generators.push(
      () => genExponential(0.05, N),
      () => genExponential(0.1, N),
      () => genExponential(0.2, N),
      () => genExponential(0.5, N),
    );
  } else {
    generators.push(
      () => genNormal(40, 8, N),
      () => genNormal(60, 12, N),
      () => genNormal(50, 5, N),
      () => genNormal(55, 15, N),
    );
  }

  return generators.slice(0, count).map((fn) => fn());
}

// --- Stats ---

function seriesStats(data: Float64Array) {
  let sum = 0,
    sum2 = 0,
    n = 0;
  for (let i = 0; i < data.length; i++) {
    if (!isFinite(data[i])) continue;
    n++;
    sum += data[i];
  }
  const mean = sum / n;
  for (let i = 0; i < data.length; i++) {
    if (!isFinite(data[i])) continue;
    const d = data[i] - mean;
    sum2 += d * d;
  }
  return { mean, stdDev: Math.sqrt(sum2 / n) };
}

// --- Canvas ---

function setupCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  return ctx;
}

const MARGIN = { top: 24, right: 20, bottom: 35, left: 55 };

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

  // Global range
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

  // Compute bins
  const allCounts: Float64Array[] = [];
  let maxCount = 0;
  for (const d of datasets) {
    const counts = new Float64Array(numBins);
    for (let i = 0; i < d.length; i++) {
      if (!isFinite(d[i])) continue;
      let bin = Math.floor((d[i] - gMin) / bw);
      if (bin >= numBins) bin = numBins - 1;
      if (bin < 0) bin = 0;
      counts[bin]++;
    }
    for (let i = 0; i < numBins; i++) {
      if (counts[i] > maxCount) maxCount = counts[i];
    }
    allCounts.push(counts);
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

  // Bars
  const barW = plotW / numBins;
  for (let d = 0; d < allCounts.length; d++) {
    ctx.fillStyle = colors[d];
    ctx.globalAlpha = 0.35;
    for (let i = 0; i < numBins; i++) {
      if (allCounts[d][i] === 0) continue;
      const barH = (allCounts[d][i] / maxCount) * plotH;
      const x = MARGIN.left + i * barW;
      const y = MARGIN.top + plotH - barH;
      ctx.fillRect(x, y, barW - 0.5, barH);
    }
    // Outline
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = colors[d];
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < numBins; i++) {
      const barH = (allCounts[d][i] / maxCount) * plotH;
      const x = MARGIN.left + i * barW + barW / 2;
      const y = MARGIN.top + plotH - barH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Legend
  ctx.font = "11px 'JetBrains Mono', 'SF Mono', monospace";
  for (let i = 0; i < datasets.length; i++) {
    const lx = MARGIN.left + 8 + i * 90;
    ctx.fillStyle = colors[i];
    ctx.globalAlpha = 0.8;
    ctx.fillRect(lx, MARGIN.top + 2, 12, 8);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#888";
    ctx.textAlign = "left";
    ctx.fillText(LABELS[i], lx + 16, MARGIN.top + 10);
  }

  // X-axis
  ctx.fillStyle = "#555";
  ctx.textAlign = "center";
  ctx.font = "11px 'JetBrains Mono', 'SF Mono', monospace";
  for (let i = 0; i <= 5; i++) {
    const val = gMin + (gMax - gMin) * (i / 5);
    const x = MARGIN.left + plotW * (i / 5);
    ctx.fillText(formatNum(val), x, h - 8);
  }

  // Y-axis labels
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i++) {
    const y = MARGIN.top + plotH * (1 - i / 4);
    ctx.fillText(String(Math.round((maxCount * i) / 4)), MARGIN.left - 6, y + 4);
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

function formatNum(v: number): string {
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  if (Math.abs(v) >= 1) return v.toFixed(2);
  return v.toPrecision(3);
}

// --- Main ---

const elNumSeries = document.getElementById("num-series") as HTMLSelectElement;
const elDistMix = document.getElementById("dist-mix") as HTMLSelectElement;
const elStatsBody = document.getElementById("stats-body")!;

async function update() {
  const count = parseInt(elNumSeries.value, 10);
  const mix = elDistMix.value;
  const series = generateSeries(mix, count);

  // Draw before
  drawOverlaidHistograms(
    document.getElementById("canvas-before") as HTMLCanvasElement,
    series,
    COLORS.slice(0, count),
  );

  // Quantile normalize
  const normalized = await quantileNormalize(series);

  // Draw after
  drawOverlaidHistograms(
    document.getElementById("canvas-after") as HTMLCanvasElement,
    normalized,
    COLORS.slice(0, count),
  );

  // Stats table
  let html = "";
  for (let i = 0; i < count; i++) {
    const before = seriesStats(series[i]);
    const after = seriesStats(normalized[i]);
    html += `<tr>
      <td><span class="color-dot" style="background:${COLORS[i]}"></span>${LABELS[i]}</td>
      <td>${before.mean.toFixed(2)}</td>
      <td>${after.mean.toFixed(2)}</td>
      <td>${before.stdDev.toFixed(2)}</td>
      <td>${after.stdDev.toFixed(2)}</td>
    </tr>`;
  }
  elStatsBody.innerHTML = html;
}

elNumSeries.addEventListener("change", update);
elDistMix.addEventListener("change", update);
window.addEventListener("resize", update);
update();
