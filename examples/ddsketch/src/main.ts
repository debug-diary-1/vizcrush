import { DDSketch } from "@vizcrush/aggregate";

const alphaSlider = document.getElementById("alpha-slider") as HTMLInputElement;
const alphaVal = document.getElementById("alpha-val")!;
const distSel = document.getElementById("distribution") as HTMLSelectElement;
const dataSizeSel = document.getElementById("data-size") as HTMLSelectElement;
const cdfCanvas = document.getElementById("cdf-chart") as HTMLCanvasElement;
const statsEl = document.getElementById("stats")!;
const tableBody = document.getElementById("qtable-body")!;

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
    if (dist === "lognormal") {
      data[i] = Math.exp(boxMuller() * 0.5 + 2);
    } else if (dist === "exponential") {
      data[i] = -Math.log(1 - Math.random()) * 10;
    } else {
      data[i] = Math.random() * 100;
    }
  }
  return data;
}

function sliderToAlpha(v: number): number {
  // Map 0..100 to 0.001..0.1 logarithmically
  const minLog = Math.log(0.001);
  const maxLog = Math.log(0.1);
  return Math.exp(minLog + (v / 100) * (maxLog - minLog));
}

function run() {
  const alpha = sliderToAlpha(parseInt(alphaSlider.value));
  alphaVal.textContent = alpha.toFixed(4);
  const n = parseInt(dataSizeSel.value);
  const dist = distSel.value;

  const data = generateData(n, dist);
  const sketch = new DDSketch(alpha);
  sketch.addBatch(data);

  // Sort for exact CDF
  const sorted = Array.from(data).sort((a, b) => a - b);

  // Build CDFs at 100 points
  const CDF_POINTS = 100;
  const minVal = sorted[0];
  const maxVal = sorted[sorted.length - 1];
  const _range = maxVal - minVal || 1;

  const exactCdf: number[] = [];
  const sketchCdf: number[] = [];
  const xVals: number[] = [];

  for (let i = 0; i < CDF_POINTS; i++) {
    const q = (i + 0.5) / CDF_POINTS;
    const exactVal = sorted[Math.floor(q * (n - 1))];
    const sketchVal = sketch.quantile(q);
    xVals.push(q);
    exactCdf.push(exactVal);
    sketchCdf.push(sketchVal);
  }

  // Draw CDF chart
  const ctx = setupCanvas(cdfCanvas);
  const w = cdfCanvas.getBoundingClientRect().width;
  const h = cdfCanvas.getBoundingClientRect().height;
  const pad = 50;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, w, h);

  // Axes
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, pad);
  ctx.lineTo(pad, h - pad);
  ctx.lineTo(w - pad, h - pad);
  ctx.stroke();

  ctx.fillStyle = "#666";
  ctx.font = "11px system-ui";
  ctx.fillText("Quantile (q)", w / 2 - 30, h - 8);
  ctx.save();
  ctx.translate(12, h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("Value", 0, 0);
  ctx.restore();

  // Axis labels
  for (let i = 0; i <= 4; i++) {
    const q = i / 4;
    const x = pad + q * (w - pad * 2);
    ctx.fillStyle = "#555";
    ctx.fillText(q.toFixed(2), x - 10, h - pad + 16);
    ctx.strokeStyle = "#1c1b1b";
    ctx.beginPath();
    ctx.moveTo(x, pad);
    ctx.lineTo(x, h - pad);
    ctx.stroke();
  }

  const allVals = [...exactCdf, ...sketchCdf];
  const yMin = Math.min(...allVals);
  const yMax = Math.max(...allVals);
  const yRange = yMax - yMin || 1;

  const toX = (q: number) => pad + q * (w - pad * 2);
  const toY = (v: number) => h - pad - ((v - yMin) / yRange) * (h - pad * 2);

  // Draw exact CDF (blue)
  ctx.strokeStyle = "#4a7fd4";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < CDF_POINTS; i++) {
    const x = toX(xVals[i]);
    const y = toY(exactCdf[i]);
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();

  // Draw DDSketch CDF (orange)
  ctx.strokeStyle = "#f5a623";
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 3]);
  ctx.beginPath();
  for (let i = 0; i < CDF_POINTS; i++) {
    const x = toX(xVals[i]);
    const y = toY(sketchCdf[i]);
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Legend
  ctx.fillStyle = "#4a7fd4";
  ctx.font = "12px system-ui";
  ctx.fillRect(pad + 15, pad + 10, 20, 3);
  ctx.fillText("Exact CDF", pad + 40, pad + 16);
  ctx.fillStyle = "#f5a623";
  ctx.fillRect(pad + 15, pad + 28, 20, 3);
  ctx.fillText("DDSketch CDF", pad + 40, pad + 33);

  // Stats
  const bucketCount = (sketch as any)._positiveBuckets.size + (sketch as any)._negativeBuckets.size;
  const memEstimate = bucketCount * 12; // rough: key(4) + value(8) per entry

  statsEl.innerHTML = `
    <div class="stat"><div class="stat-label">Buckets</div><div class="stat-value">${bucketCount}</div></div>
    <div class="stat"><div class="stat-label">Memory</div><div class="stat-value">${memEstimate < 1024 ? memEstimate + "B" : (memEstimate / 1024).toFixed(1) + "KB"}</div></div>
    <div class="stat"><div class="stat-label">Alpha</div><div class="stat-value">${alpha.toFixed(4)}</div></div>
  `;

  // Quantile comparison table
  const pcts = [10, 25, 50, 75, 90, 95, 99];
  let rows = "";
  for (const p of pcts) {
    const exact = sorted[Math.floor((p / 100) * (n - 1))];
    const est = sketch.quantile(p / 100);
    const err = exact !== 0 ? Math.abs((est - exact) / exact) * 100 : 0;
    const cls = err <= alpha * 100 ? "good" : "error";
    rows += `<tr>
      <td>p${p}</td>
      <td>${exact.toFixed(2)}</td>
      <td>${est.toFixed(2)}</td>
      <td class="${cls}">${err.toFixed(2)}%</td>
    </tr>`;
  }
  tableBody.innerHTML = rows;
}

alphaSlider.addEventListener("input", run);
distSel.addEventListener("change", run);
dataSizeSel.addEventListener("change", run);
window.addEventListener("resize", run);
run();
