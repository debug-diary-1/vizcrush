import { ReservoirSampler } from "@vizcrush/aggregate";

const K_VALUES = [10, 50, 100, 500, 1000];
const kSlider = document.getElementById("k-slider") as HTMLInputElement;
const kVal = document.getElementById("k-val")!;
const dataSizeSel = document.getElementById("data-size") as HTMLSelectElement;
const distSel = document.getElementById("distribution") as HTMLSelectElement;
const scatterCanvas = document.getElementById("scatter") as HTMLCanvasElement;
const histCanvas = document.getElementById("histogram") as HTMLCanvasElement;
const statsEl = document.getElementById("stats")!;
const chiEl = document.getElementById("chi-result")!;

function setupCanvas(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  const rect = c.getBoundingClientRect();
  c.width = rect.width * dpr;
  c.height = rect.height * dpr;
  const ctx = c.getContext("2d")!;
  ctx.scale(dpr, dpr);
  return ctx;
}

function boxMuller(): number {
  let u = 0,
    v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function generateData(n: number, dist: string): Float64Array {
  const data = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (dist === "uniform") {
      data[i] = Math.random() * 100;
    } else if (dist === "normal") {
      data[i] = 50 + boxMuller() * 15;
    } else {
      data[i] = Math.random() < 0.5 ? 25 + boxMuller() * 8 : 75 + boxMuller() * 8;
    }
  }
  return data;
}

function buildHistogram(
  data: Float64Array | number[],
  bins: number,
  min: number,
  max: number,
): number[] {
  const counts = Array.from({ length: bins }, () => 0);
  const range = max - min || 1;
  for (let i = 0; i < data.length; i++) {
    const v = typeof data[i] === "number" ? data[i] : (data as Float64Array)[i];
    const bin = Math.min(bins - 1, Math.floor(((v - min) / range) * bins));
    counts[bin]++;
  }
  return counts;
}

function meanStd(data: Float64Array | number[]): [number, number] {
  let sum = 0,
    sum2 = 0,
    n = data.length;
  for (let i = 0; i < n; i++) {
    sum += data[i];
    sum2 += data[i] * data[i];
  }
  const mean = sum / n;
  return [mean, Math.sqrt(sum2 / n - mean * mean)];
}

function chiSquared(observed: number[], expected: number[]): number {
  let chi2 = 0;
  for (let i = 0; i < observed.length; i++) {
    if (expected[i] > 0) {
      const diff = observed[i] - expected[i];
      chi2 += (diff * diff) / expected[i];
    }
  }
  return chi2;
}

function run() {
  const k = K_VALUES[parseInt(kSlider.value)];
  kVal.textContent = k.toString();
  const n = parseInt(dataSizeSel.value);
  const dist = distSel.value;

  const data = generateData(n, dist);
  const sampler = new ReservoirSampler(k);
  sampler.addBatch(data);
  const sample = sampler.sample;

  let globalMin = Infinity,
    globalMax = -Infinity;
  for (let i = 0; i < data.length; i++) {
    if (data[i] < globalMin) globalMin = data[i];
    if (data[i] > globalMax) globalMax = data[i];
  }

  // Draw scatter
  const sctx = setupCanvas(scatterCanvas);
  const sw = scatterCanvas.getBoundingClientRect().width;
  const sh = scatterCanvas.getBoundingClientRect().height;
  const pad = 40;

  sctx.clearRect(0, 0, sw, sh);
  sctx.fillStyle = "#111";
  sctx.fillRect(0, 0, sw, sh);

  // Axes
  sctx.strokeStyle = "#333";
  sctx.beginPath();
  sctx.moveTo(pad, pad);
  sctx.lineTo(pad, sh - pad);
  sctx.lineTo(sw - pad, sh - pad);
  sctx.stroke();
  sctx.fillStyle = "#666";
  sctx.font = "11px system-ui";
  sctx.fillText("Index", sw / 2, sh - 5);
  sctx.save();
  sctx.translate(12, sh / 2);
  sctx.rotate(-Math.PI / 2);
  sctx.fillText("Value", 0, 0);
  sctx.restore();

  const range = globalMax - globalMin || 1;
  const xScale = (sw - pad * 2) / n;
  const yScale = (sh - pad * 2) / range;

  // Full data (faded)
  sctx.fillStyle = "rgba(100,100,100,0.08)";
  const step = Math.max(1, Math.floor(n / 4000));
  for (let i = 0; i < n; i += step) {
    const x = pad + i * xScale;
    const y = sh - pad - (data[i] - globalMin) * yScale;
    sctx.fillRect(x, y, 2, 2);
  }

  // Sample (bright green)
  sctx.fillStyle = "rgba(76, 175, 80, 0.7)";
  for (let i = 0; i < sample.length; i++) {
    // Place sample dots at random x positions since we don't track indices
    const x = pad + Math.random() * (sw - pad * 2);
    const y = sh - pad - (sample[i] - globalMin) * yScale;
    sctx.beginPath();
    sctx.arc(x, y, 3, 0, Math.PI * 2);
    sctx.fill();
  }

  sctx.fillStyle = "#666";
  sctx.font = "11px system-ui";
  sctx.fillStyle = "#555";
  sctx.fillText(`Full data (${n.toLocaleString()} pts, faded)`, pad + 10, pad + 15);
  sctx.fillStyle = "#4caf50";
  sctx.fillText(`Reservoir sample (k=${k}, green)`, pad + 10, pad + 30);

  // Histogram
  const BINS = 30;
  const fullHist = buildHistogram(data, BINS, globalMin, globalMax);
  const sampleHist = buildHistogram(Array.from(sample), BINS, globalMin, globalMax);

  // Normalize sample histogram to full data scale
  const sampleScale = n / sample.length;
  const normSampleHist = sampleHist.map((c) => c * sampleScale);

  const hctx = setupCanvas(histCanvas);
  const hw = histCanvas.getBoundingClientRect().width;
  const hh = histCanvas.getBoundingClientRect().height;
  hctx.clearRect(0, 0, hw, hh);
  hctx.fillStyle = "#111";
  hctx.fillRect(0, 0, hw, hh);

  const hPad = 40;
  const maxCount = Math.max(...fullHist, ...normSampleHist);
  const barW = (hw - hPad * 2) / BINS;

  for (let i = 0; i < BINS; i++) {
    const x = hPad + i * barW;
    // Full data bar
    const h1 = (fullHist[i] / maxCount) * (hh - hPad * 2);
    hctx.fillStyle = "rgba(74,127,212,0.4)";
    hctx.fillRect(x + 1, hh - hPad - h1, barW - 2, h1);
    // Sample bar (outline)
    const h2 = (normSampleHist[i] / maxCount) * (hh - hPad * 2);
    hctx.strokeStyle = "#4caf50";
    hctx.lineWidth = 1.5;
    hctx.strokeRect(x + 1, hh - hPad - h2, barW - 2, h2);
  }

  hctx.strokeStyle = "#333";
  hctx.beginPath();
  hctx.moveTo(hPad, hPad);
  hctx.lineTo(hPad, hh - hPad);
  hctx.lineTo(hw - hPad, hh - hPad);
  hctx.stroke();
  hctx.fillStyle = "#4a7fd4";
  hctx.font = "11px system-ui";
  hctx.fillText("Full (blue fill)", hPad + 5, hPad + 12);
  hctx.fillStyle = "#4caf50";
  hctx.fillText("Sample (green outline, scaled)", hPad + 5, hPad + 26);

  // Stats
  const [fMean, fStd] = meanStd(data);
  const [sMean, sStd] = meanStd(Array.from(sample));

  statsEl.innerHTML = `
    <div class="stat"><div class="stat-label">Sample size</div><div class="stat-value">${sample.length}</div></div>
    <div class="stat"><div class="stat-label">Total ingested</div><div class="stat-value">${n.toLocaleString()}</div></div>
    <div class="stat"><div class="stat-label">Full mean</div><div class="stat-value">${fMean.toFixed(2)}</div></div>
    <div class="stat"><div class="stat-label">Sample mean</div><div class="stat-value">${sMean.toFixed(2)}</div></div>
    <div class="stat"><div class="stat-label">Full stddev</div><div class="stat-value">${fStd.toFixed(2)}</div></div>
    <div class="stat"><div class="stat-label">Sample stddev</div><div class="stat-value">${sStd.toFixed(2)}</div></div>
  `;

  // Chi-squared test
  const expectedHist = fullHist.map((c) => c * (sample.length / n));
  const chi2 = chiSquared(sampleHist, expectedHist);
  const df = BINS - 1;
  // Approximate p-value threshold for chi-squared at df=29, alpha=0.05 is ~42.6
  const threshold = df + 2 * Math.sqrt(2 * df); // rough approximation
  const pass = chi2 < threshold;

  chiEl.innerHTML = `
    <div style="font-size:0.8rem;color:#888;">Chi-squared goodness-of-fit</div>
    <div style="font-size:1.2rem;font-weight:bold;margin:0.3rem 0;" class="${pass ? "pass" : "fail"}">
      ${pass ? "PASS" : "FAIL"} &mdash; &chi;&sup2; = ${chi2.toFixed(1)}
    </div>
    <div style="font-size:0.75rem;color:#666;">df=${df}, threshold=${threshold.toFixed(1)}</div>
    <div style="font-size:0.75rem;color:#666;margin-top:0.5rem;">
      Mean diff: ${Math.abs(fMean - sMean).toFixed(3)} &bull;
      StdDev diff: ${Math.abs(fStd - sStd).toFixed(3)}
    </div>
  `;
}

kSlider.addEventListener("input", run);
dataSizeSel.addEventListener("change", run);
distSel.addEventListener("change", run);
window.addEventListener("resize", run);
run();
