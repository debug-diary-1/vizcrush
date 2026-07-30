import { DDSketch, KllSketch, percentile } from "@vizcrush/aggregate";

// ── Elements ──
const distSelect = document.getElementById("distribution") as HTMLSelectElement;
const sizeSelect = document.getElementById("data-size") as HTMLSelectElement;
const alphaSelect = document.getElementById("dd-alpha") as HTMLSelectElement;
const kSelect = document.getElementById("kll-k") as HTMLSelectElement;

const cdfCanvas = document.getElementById("cdf-canvas") as HTMLCanvasElement;
const memCanvas = document.getElementById("memory-canvas") as HTMLCanvasElement;
const errorTbody = document.getElementById("error-tbody") as HTMLTableSectionElement;

// ── Data generation ──
function generateData(dist: string, n: number): Float64Array {
  const data = new Float64Array(n);
  switch (dist) {
    case "lognormal":
      for (let i = 0; i < n; i++) {
        // Box-Muller for standard normal, then exponentiate
        const u1 = Math.random();
        const u2 = Math.random();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        data[i] = Math.exp(z);
      }
      break;
    case "exponential":
      for (let i = 0; i < n; i++) {
        data[i] = -Math.log(1 - Math.random());
      }
      break;
    case "uniform":
      for (let i = 0; i < n; i++) {
        data[i] = Math.random() * 1000;
      }
      break;
    case "bimodal":
      for (let i = 0; i < n; i++) {
        const u1 = Math.random();
        const u2 = Math.random();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        data[i] = Math.random() < 0.5 ? 20 + z * 5 : 80 + z * 10;
      }
      break;
  }
  return data;
}

// ── Helpers ──
function fmt(v: number): string {
  if (Math.abs(v) >= 1000) return v.toFixed(1);
  if (Math.abs(v) >= 10) return v.toFixed(2);
  if (Math.abs(v) >= 1) return v.toFixed(3);
  return v.toFixed(4);
}

function pctFmt(v: number): string {
  return (v * 100).toFixed(3) + "%";
}

function setGaugeValue(id: string, value: number): void {
  const el = document.getElementById(id);
  if (!el) return;
  const valEl = el.querySelector(".value") as HTMLElement;
  if (valEl) valEl.textContent = fmt(value);
}

// ── Canvas drawing helpers ──
function setupCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  return ctx;
}

interface CurveData {
  points: [number, number][]; // [quantile 0-1, value]
  color: string;
  label: string;
}

function drawCDF(canvas: HTMLCanvasElement, curves: CurveData[]): void {
  const ctx = setupCanvas(canvas);
  const rect = canvas.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  const pad = { top: 20, right: 20, bottom: 40, left: 70 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  ctx.clearRect(0, 0, w, h);

  // Find value range across all curves
  let vMin = Infinity,
    vMax = -Infinity;
  for (const c of curves) {
    for (const [, v] of c.points) {
      if (isFinite(v)) {
        if (v < vMin) vMin = v;
        if (v > vMax) vMax = v;
      }
    }
  }
  if (!isFinite(vMin)) {
    vMin = 0;
    vMax = 1;
  }
  const vRange = vMax - vMin || 1;

  // Grid
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const y = pad.top + (i / 5) * plotH;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + plotW, y);
    ctx.stroke();
  }
  for (let i = 0; i <= 5; i++) {
    const x = pad.left + (i / 5) * plotW;
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, pad.top + plotH);
    ctx.stroke();
  }

  // Axes labels
  ctx.fillStyle = "#666";
  ctx.font = "11px 'JetBrains Mono', 'SF Mono', monospace";
  ctx.textAlign = "center";
  for (let i = 0; i <= 5; i++) {
    const q = i / 5;
    ctx.fillText(q.toFixed(1), pad.left + (i / 5) * plotW, pad.top + plotH + 16);
  }
  ctx.fillText("Quantile", pad.left + plotW / 2, pad.top + plotH + 34);

  ctx.textAlign = "right";
  for (let i = 0; i <= 5; i++) {
    const v = vMin + ((5 - i) / 5) * vRange;
    ctx.fillText(fmt(v), pad.left - 6, pad.top + (i / 5) * plotH + 4);
  }

  // Draw curves
  for (const curve of curves) {
    ctx.strokeStyle = curve.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    let started = false;
    for (const [q, v] of curve.points) {
      const x = pad.left + q * plotW;
      const y = pad.top + (1 - (v - vMin) / vRange) * plotH;
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function drawMemoryBars(
  canvas: HTMLCanvasElement,
  bars: { label: string; bytes: number; color: string }[],
): void {
  const ctx = setupCanvas(canvas);
  const rect = canvas.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  const pad = { top: 20, right: 20, bottom: 50, left: 20 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  ctx.clearRect(0, 0, w, h);

  const maxBytes = Math.max(...bars.map((b) => b.bytes), 1);
  const barWidth = plotW / (bars.length * 2 + 1);

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const barH = (b.bytes / maxBytes) * plotH;
    const x = pad.left + (i * 2 + 1) * barWidth;
    const y = pad.top + plotH - barH;

    ctx.fillStyle = b.color;
    ctx.beginPath();
    // Rounded top
    const r = Math.min(6, barWidth / 2);
    ctx.moveTo(x, y + r);
    ctx.arcTo(x, y, x + barWidth, y, r);
    ctx.arcTo(x + barWidth, y, x + barWidth, y + barH, r);
    ctx.lineTo(x + barWidth, pad.top + plotH);
    ctx.lineTo(x, pad.top + plotH);
    ctx.closePath();
    ctx.fill();

    // Value label
    ctx.fillStyle = "#e5e2e1";
    ctx.font = "bold 12px 'JetBrains Mono', 'SF Mono', monospace";
    ctx.textAlign = "center";
    const bytesStr =
      b.bytes >= 1048576
        ? (b.bytes / 1048576).toFixed(1) + " MB"
        : b.bytes >= 1024
          ? (b.bytes / 1024).toFixed(1) + " KB"
          : b.bytes + " B";
    ctx.fillText(bytesStr, x + barWidth / 2, y - 6);

    // Name label
    ctx.fillStyle = "#888";
    ctx.font = "11px 'JetBrains Mono', 'SF Mono', monospace";
    ctx.fillText(b.label, x + barWidth / 2, pad.top + plotH + 16);
  }
}

// ── Main update ──
async function update(): Promise<void> {
  const dist = distSelect.value;
  const n = parseInt(sizeSelect.value, 10);
  const alpha = parseFloat(alphaSelect.value);
  const k = parseInt(kSelect.value, 10);

  // Generate data
  const data = generateData(dist, n);

  // Build sketches
  const dd = new DDSketch(alpha);
  const kll = new KllSketch(k);
  dd.addBatch(data);
  kll.addBatch(data);

  // Exact percentiles for gauges and table
  const tablePcts = [10, 25, 50, 75, 90, 95, 99];
  const exactVals = await percentile(data, tablePcts);

  // Gauge values: p50, p90, p99
  const gaugeMap: [string, number][] = [
    ["p50", 50],
    ["p90", 90],
    ["p99", 99],
  ];

  for (const [label, pct] of gaugeMap) {
    const idx = tablePcts.indexOf(pct);
    const ev = exactVals[idx];
    const dv = dd.quantile(pct / 100);
    const kv = kll.quantile(pct / 100);
    setGaugeValue(`g-exact-${label}`, ev);
    setGaugeValue(`g-dd-${label}`, dv);
    setGaugeValue(`g-kll-${label}`, kv);
  }

  // Build CDF curves: 200 evenly-spaced quantile points
  const numCdfPoints = 200;
  const cdfQuantiles: number[] = [];
  for (let i = 1; i <= numCdfPoints; i++) {
    cdfQuantiles.push(i / (numCdfPoints + 1));
  }

  // Exact CDF: sort data, pick quantile values
  const sorted = Array.from(data).sort((a, b) => a - b);
  const exactCdf: [number, number][] = cdfQuantiles.map((q) => {
    const idx = Math.min(Math.floor(q * sorted.length), sorted.length - 1);
    return [q, sorted[idx]];
  });

  const ddCdf: [number, number][] = cdfQuantiles.map((q) => [q, dd.quantile(q)]);
  const kllCdf: [number, number][] = cdfQuantiles.map((q) => [q, kll.quantile(q)]);

  drawCDF(cdfCanvas, [
    { points: exactCdf, color: "#4a7fd4", label: "Exact" },
    { points: ddCdf, color: "#fb923c", label: "DDSketch" },
    { points: kllCdf, color: "#4ade80", label: "KLL" },
  ]);

  // Error table
  errorTbody.innerHTML = "";
  for (let i = 0; i < tablePcts.length; i++) {
    const pct = tablePcts[i];
    const ev = exactVals[i];
    const dv = dd.quantile(pct / 100);
    const kv = kll.quantile(pct / 100);
    const ddErr = ev !== 0 ? Math.abs(dv - ev) / Math.abs(ev) : 0;
    const kllErr = ev !== 0 ? Math.abs(kv - ev) / Math.abs(ev) : 0;

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>p${pct}</td>
      <td class="exact-col">${fmt(ev)}</td>
      <td class="dd-col">${fmt(dv)}</td>
      <td class="dd-col">${pctFmt(ddErr)}</td>
      <td class="kll-col">${fmt(kv)}</td>
      <td class="kll-col">${pctFmt(kllErr)}</td>
    `;
    errorTbody.appendChild(row);
  }

  // Memory comparison
  // DDSketch: count unique buckets (positive + negative + overhead)
  // Access internal bucket maps via cast
  const ddAny = dd as any;
  const ddBuckets = (ddAny._positiveBuckets?.size || 0) + (ddAny._negativeBuckets?.size || 0);
  const ddBytes = ddBuckets * 16; // key (8) + count (8) per bucket in Map

  const kllRetained = kll.numRetained;
  const kllBytes = kllRetained * 8;

  const exactBytes = n * 8;

  drawMemoryBars(memCanvas, [
    { label: "DDSketch", bytes: ddBytes, color: "#fb923c" },
    { label: "KLL", bytes: kllBytes, color: "#4ade80" },
    { label: "Exact", bytes: exactBytes, color: "#4a7fd4" },
  ]);
}

// ── Event listeners ──
distSelect.addEventListener("change", update);
sizeSelect.addEventListener("change", update);
alphaSelect.addEventListener("change", update);
kSelect.addEventListener("change", update);

// Handle resize
let resizeTimer: number;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(update, 150);
});

// Initial run
update();
