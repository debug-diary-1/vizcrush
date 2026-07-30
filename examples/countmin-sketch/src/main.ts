import { CountMinSketch } from "@vizcrush/aggregate";

const widthSel = document.getElementById("width-sel") as HTMLSelectElement;
const depthSel = document.getElementById("depth-sel") as HTMLSelectElement;
const zipfSel = document.getElementById("zipf-sel") as HTMLSelectElement;
const barCanvas = document.getElementById("bar-chart") as HTMLCanvasElement;
const heatCanvas = document.getElementById("heat-strip") as HTMLCanvasElement;
const statsEl = document.getElementById("stats")!;
const worstTable = document.getElementById("worst-table")!;
const heatLabel = document.getElementById("heat-label")!;

function setupCanvas(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  const rect = c.getBoundingClientRect();
  c.width = rect.width * dpr;
  c.height = rect.height * dpr;
  const ctx = c.getContext("2d")!;
  ctx.scale(dpr, dpr);
  return ctx;
}

// Zipf distribution: P(k) proportional to 1/k^s
function generateZipf(n: number, numItems: number, exponent: number): number[] {
  // Build CDF for Zipf
  const weights: number[] = [];
  let total = 0;
  for (let k = 1; k <= numItems; k++) {
    const w = 1 / Math.pow(k, exponent);
    weights.push(w);
    total += w;
  }
  // Normalize to CDF
  const cdf: number[] = [];
  let cum = 0;
  for (let k = 0; k < numItems; k++) {
    cum += weights[k] / total;
    cdf.push(cum);
  }

  const result: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.random();
    // Binary search in CDF
    let lo = 0,
      hi = numItems - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    result.push(lo + 1); // 1-indexed items
  }
  return result;
}

function run() {
  const width = parseInt(widthSel.value);
  const depth = parseInt(depthSel.value);
  const exponent = parseFloat(zipfSel.value);
  const N = 100000;
  const NUM_ITEMS = 1000;

  const data = generateZipf(N, NUM_ITEMS, exponent);
  const sketch = new CountMinSketch(width, depth);
  const exactCounts = new Map<number, number>();

  for (const v of data) {
    sketch.add(v);
    exactCounts.set(v, (exactCounts.get(v) || 0) + 1);
  }

  // Top 20 by actual frequency
  const sorted = Array.from(exactCounts.entries()).sort((a, b) => b[1] - a[1]);
  const top20 = sorted.slice(0, 20);

  // Get estimates for top 20
  const top20Data = top20.map(([item, actual]) => {
    const est = sketch.estimate(item);
    return { item, actual, est, over: est - actual };
  });

  // Draw bar chart
  const ctx = setupCanvas(barCanvas);
  const w = barCanvas.getBoundingClientRect().width;
  const h = barCanvas.getBoundingClientRect().height;
  const pad = 50;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "#2a2a2a";
  ctx.beginPath();
  ctx.moveTo(pad, pad);
  ctx.lineTo(pad, h - pad);
  ctx.lineTo(w - pad, h - pad);
  ctx.stroke();

  const maxCount = Math.max(...top20Data.map((d) => Math.max(d.actual, d.est)));
  const barW = (w - pad * 2) / top20Data.length;

  for (let i = 0; i < top20Data.length; i++) {
    const d = top20Data[i];
    const x = pad + i * barW;

    // Actual bar (filled blue)
    const hActual = (d.actual / maxCount) * (h - pad * 2);
    ctx.fillStyle = "rgba(59,158,207,0.6)";
    ctx.fillRect(x + 2, h - pad - hActual, barW - 4, hActual);

    // Estimate bar (outline, orange if over-counting)
    const hEst = (d.est / maxCount) * (h - pad * 2);
    if (d.over > 0) {
      // Red over-estimation region
      ctx.fillStyle = "rgba(244,67,54,0.3)";
      ctx.fillRect(x + 2, h - pad - hEst, barW - 4, hEst - hActual);
    }
    ctx.strokeStyle = d.over > 0 ? "#f44336" : "#4caf50";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 2, h - pad - hEst, barW - 4, hEst);

    // Item label
    ctx.fillStyle = "#666";
    ctx.font = "9px 'JetBrains Mono', 'SF Mono', monospace";
    ctx.save();
    ctx.translate(x + barW / 2, h - pad + 4);
    ctx.rotate(Math.PI / 4);
    ctx.fillText(`#${d.item}`, 0, 0);
    ctx.restore();
  }

  ctx.fillStyle = "#666";
  ctx.font = "11px 'JetBrains Mono', 'SF Mono', monospace";
  ctx.fillText("Top 20 items by frequency", pad + 5, pad + 12);

  // Legend
  const lx = w - pad - 200;
  ctx.fillStyle = "rgba(59,158,207,0.6)";
  ctx.fillRect(lx, pad + 5, 14, 10);
  ctx.fillStyle = "#e5e2e1";
  ctx.font = "11px 'JetBrains Mono', 'SF Mono', monospace";
  ctx.fillText("Actual", lx + 18, pad + 14);
  ctx.strokeStyle = "#f44336";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(lx, pad + 22, 14, 10);
  ctx.fillStyle = "#e5e2e1";
  ctx.fillText("CM estimate (red = over)", lx + 18, pad + 31);

  // Y-axis labels
  for (let i = 0; i <= 4; i++) {
    const v = Math.round((maxCount * i) / 4);
    const y = h - pad - (i / 4) * (h - pad * 2);
    ctx.fillStyle = "#555";
    ctx.font = "10px 'JetBrains Mono', 'SF Mono', monospace";
    ctx.fillText(v.toLocaleString(), 5, y + 4);
    ctx.strokeStyle = "#1c1b1b";
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(w - pad, y);
    ctx.stroke();
  }

  // Draw heat strip (first row of CM table)
  const hctx = setupCanvas(heatCanvas);
  const hw = heatCanvas.getBoundingClientRect().width;
  const hh = heatCanvas.getBoundingClientRect().height;

  hctx.clearRect(0, 0, hw, hh);
  hctx.fillStyle = "#0f0f1e";
  hctx.fillRect(0, 0, hw, hh);

  const table = (sketch as any)._table as Uint32Array;
  let maxCell = 1;
  for (let i = 0; i < width; i++) if (table[i] > maxCell) maxCell = table[i];

  const cellW = hw / width;
  for (let i = 0; i < width; i++) {
    const intensity = table[i] / maxCell;
    const r = Math.floor(10 + intensity * 234);
    const g = Math.floor(10 + intensity * 60);
    const b = Math.floor(30 + intensity * 30);
    hctx.fillStyle = `rgb(${r},${g},${b})`;
    hctx.fillRect(i * cellW, 0, cellW + 0.5, hh);
  }

  heatLabel.textContent = `Row 0 of ${depth} rows, ${width} cells, max cell count = ${maxCell.toLocaleString()}`;

  // Stats
  const memBytes = width * depth * 4;
  statsEl.innerHTML = `
    <div class="stat"><div class="stat-label">Width</div><div class="stat-value">${width}</div></div>
    <div class="stat"><div class="stat-label">Depth</div><div class="stat-value">${depth}</div></div>
    <div class="stat"><div class="stat-label">Memory</div><div class="stat-value">${(memBytes / 1024).toFixed(1)}KB</div></div>
  `;

  // Worst over-estimates table
  const byOver = [...top20Data].sort((a, b) => b.over - a.over).slice(0, 8);
  let rows = "";
  for (const d of byOver) {
    rows += `<tr>
      <td>#${d.item}</td>
      <td>${d.actual.toLocaleString()}</td>
      <td>${d.est.toLocaleString()}</td>
      <td class="over">+${d.over.toLocaleString()}</td>
    </tr>`;
  }
  worstTable.innerHTML = rows;
}

widthSel.addEventListener("change", run);
depthSel.addEventListener("change", run);
zipfSel.addEventListener("change", run);
window.addEventListener("resize", run);
run();
