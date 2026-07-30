import { KllSketch } from "@vizcrush/aggregate";

const K_VALUES = [50, 100, 200, 500, 1000];
const kSlider = document.getElementById("k-slider") as HTMLInputElement;
const kVal = document.getElementById("k-val")!;
const dataSizeSel = document.getElementById("data-size") as HTMLSelectElement;
const cdfCanvas = document.getElementById("cdf-chart") as HTMLCanvasElement;
const errorCanvas = document.getElementById("error-bars") as HTMLCanvasElement;
const statsEl = document.getElementById("stats")!;
const errorTableEl = document.getElementById("error-table")!;
const infoEl = document.getElementById("info")!;

function setupCanvas(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  const rect = c.getBoundingClientRect();
  c.width = rect.width * dpr;
  c.height = rect.height * dpr;
  const ctx = c.getContext("2d")!;
  ctx.scale(dpr, dpr);
  return ctx;
}

function run() {
  const k = K_VALUES[parseInt(kSlider.value)];
  kVal.textContent = k.toString();
  const n = parseInt(dataSizeSel.value);

  // Generate uniform data 0..n
  const data = new Float64Array(n);
  for (let i = 0; i < n; i++) data[i] = Math.random() * n;

  const sketch = new KllSketch(k);
  sketch.addBatch(data);

  // Sort for exact CDF
  const sorted = Array.from(data).sort((a, b) => a - b);

  // Build CDFs
  const PTS = 100;
  const exactCdf: number[] = [];
  const kllCdf: number[] = [];
  const qVals: number[] = [];

  for (let i = 0; i < PTS; i++) {
    const q = (i + 0.5) / PTS;
    qVals.push(q);
    exactCdf.push(sorted[Math.floor(q * (n - 1))]);
    kllCdf.push(sketch.quantile(q));
  }

  // Draw CDF
  const ctx = setupCanvas(cdfCanvas);
  const w = cdfCanvas.getBoundingClientRect().width;
  const h = cdfCanvas.getBoundingClientRect().height;
  const pad = 50;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "#333";
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

  const allVals = [...exactCdf, ...kllCdf];
  const yMin = Math.min(...allVals);
  const yMax = Math.max(...allVals);
  const yRange = yMax - yMin || 1;

  const toX = (q: number) => pad + q * (w - pad * 2);
  const toY = (v: number) => h - pad - ((v - yMin) / yRange) * (h - pad * 2);

  // Exact CDF
  ctx.strokeStyle = "#4a7fd4";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < PTS; i++) {
    const x = toX(qVals[i]),
      y = toY(exactCdf[i]);
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();

  // KLL CDF
  ctx.strokeStyle = "#f5a623";
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 3]);
  ctx.beginPath();
  for (let i = 0; i < PTS; i++) {
    const x = toX(qVals[i]),
      y = toY(kllCdf[i]);
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
  ctx.fillText("KLL CDF", pad + 40, pad + 33);

  // Error bar chart for p50, p90, p99
  const pcts = [50, 90, 99];
  const errors: { label: string; err: number; exact: number; est: number }[] = [];
  for (const p of pcts) {
    const exact = sorted[Math.floor((p / 100) * (n - 1))];
    const est = sketch.quantile(p / 100);
    const err = exact !== 0 ? Math.abs((est - exact) / exact) * 100 : 0;
    errors.push({ label: `p${p}`, err, exact, est });
  }

  const ectx = setupCanvas(errorCanvas);
  const ew = errorCanvas.getBoundingClientRect().width;
  const eh = errorCanvas.getBoundingClientRect().height;
  const ePad = 50;

  ectx.clearRect(0, 0, ew, eh);
  ectx.fillStyle = "#111";
  ectx.fillRect(0, 0, ew, eh);

  ectx.strokeStyle = "#333";
  ectx.beginPath();
  ectx.moveTo(ePad, ePad);
  ectx.lineTo(ePad, eh - ePad);
  ectx.lineTo(ew - ePad, eh - ePad);
  ectx.stroke();

  const maxErr = Math.max(0.5, ...errors.map((e) => e.err));
  const barW = (ew - ePad * 2) / (pcts.length * 2 + 1);

  ectx.fillStyle = "#666";
  ectx.font = "11px system-ui";
  ectx.fillText("Relative Error %", ew / 2 - 40, eh - 8);

  for (let i = 0; i < errors.length; i++) {
    const x = ePad + (i * 2 + 1) * barW;
    const barH = (errors[i].err / maxErr) * (eh - ePad * 2);

    // Exact bar (blue, short reference line)
    ectx.fillStyle = "#4a7fd4";
    ectx.fillRect(x, eh - ePad - barH, barW * 0.8, barH);

    // Label
    ectx.fillStyle = "#e5e2e1";
    ectx.font = "12px system-ui";
    ectx.fillText(errors[i].label, x + barW * 0.1, eh - ePad + 16);
    ectx.fillStyle = "#f5a623";
    ectx.font = "10px system-ui";
    ectx.fillText(`${errors[i].err.toFixed(2)}%`, x, eh - ePad - barH - 6);
  }

  ectx.fillStyle = "#888";
  ectx.font = "11px system-ui";
  ectx.fillText("Percentile Error Comparison", ePad + 5, ePad + 12);

  // Stats
  const retained = sketch.numRetained;
  const compressionRatio = ((retained / n) * 100).toFixed(2);
  const maxRankError = ((1 / k) * 100).toFixed(3);

  statsEl.innerHTML = `
    <div class="stat"><div class="stat-label">k parameter</div><div class="stat-value">${k}</div></div>
    <div class="stat"><div class="stat-label">Total items</div><div class="stat-value">${n.toLocaleString()}</div></div>
    <div class="stat"><div class="stat-label">Retained</div><div class="stat-value">${retained.toLocaleString()}</div></div>
    <div class="stat"><div class="stat-label">Compression</div><div class="stat-value">${compressionRatio}%</div></div>
  `;

  let tableHtml = `<table style="width:100%;border-collapse:collapse;font-size:0.8rem;">
    <tr><th style="text-align:left;color:#888;padding:0.3rem;">Metric</th><th style="color:#888;padding:0.3rem;">Exact</th><th style="color:#888;padding:0.3rem;">KLL</th><th style="color:#888;padding:0.3rem;">Err%</th></tr>`;
  for (const e of errors) {
    const cls = e.err < 1 ? "color:#4caf50" : "color:#f44336";
    tableHtml += `<tr><td style="padding:0.3rem;">${e.label}</td><td style="padding:0.3rem;">${e.exact.toFixed(1)}</td><td style="padding:0.3rem;">${e.est.toFixed(1)}</td><td style="padding:0.3rem;${cls}">${e.err.toFixed(2)}%</td></tr>`;
  }
  tableHtml += "</table>";
  errorTableEl.innerHTML = tableHtml;

  infoEl.innerHTML = `
    Max rank error bound: ~${maxRankError}%<br/>
    Memory: ~${((retained * 8) / 1024).toFixed(1)} KB (${retained} retained items &times; 8 bytes)
  `;
}

kSlider.addEventListener("input", run);
dataSizeSel.addEventListener("change", run);
window.addEventListener("resize", run);
run();
