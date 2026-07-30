import { HyperLogLog } from "@vizcrush/aggregate";

const pSlider = document.getElementById("p-slider") as HTMLInputElement;
const pVal = document.getElementById("p-val")!;
const uniqueSel = document.getElementById("unique-count") as HTMLSelectElement;
const counterCanvas = document.getElementById("counter-chart") as HTMLCanvasElement;
const convCanvas = document.getElementById("convergence") as HTMLCanvasElement;
const regCanvas = document.getElementById("register-strip") as HTMLCanvasElement;
const hllEstEl = document.getElementById("hll-estimate")!;
const exactEl = document.getElementById("exact-count")!;
const statsEl = document.getElementById("stats")!;
const regInfo = document.getElementById("reg-info")!;

let animId = 0;

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
  cancelAnimationFrame(animId);

  const p = parseInt(pSlider.value);
  pVal.textContent = p.toString();
  const uniqueCount = parseInt(uniqueSel.value);
  const m = 1 << p;

  const hll = new HyperLogLog(p);
  const registers = (hll as any)._registers as Uint8Array;

  // Pre-generate all values
  const values = new Float64Array(uniqueCount);
  for (let i = 0; i < uniqueCount; i++) values[i] = i;

  // Convergence tracking
  const checkpoints = 50;
  const batchSize = Math.max(1, Math.floor(uniqueCount / checkpoints));
  const convergenceData: { frac: number; error: number }[] = [];

  let ingested = 0;
  let _frame = 0;

  function animate() {
    // Ingest a batch
    const end = Math.min(ingested + batchSize, uniqueCount);
    for (let i = ingested; i < end; i++) hll.add(values[i]);
    ingested = end;

    const est = hll.estimate();
    const err = ingested > 0 ? ((est - ingested) / ingested) * 100 : 0;
    convergenceData.push({ frac: ingested / uniqueCount, error: Math.abs(err) });

    // Update counter
    hllEstEl.textContent = Math.round(est).toLocaleString();
    exactEl.textContent = `Exact: ${ingested.toLocaleString()}`;

    // Draw counter chart (bar comparison)
    const ctx = setupCanvas(counterCanvas);
    const w = counterCanvas.getBoundingClientRect().width;
    const h = counterCanvas.getBoundingClientRect().height;
    const pad = 50;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, w, h);

    const maxV = Math.max(est, ingested) * 1.1;
    const barW = (w - pad * 2) / 4;

    // Exact bar
    const h1 = (ingested / maxV) * (h - pad * 2);
    ctx.fillStyle = "#4a7fd4";
    ctx.fillRect(pad + barW * 0.5, h - pad - h1, barW, h1);
    ctx.fillStyle = "#e5e2e1";
    ctx.font = "12px 'JetBrains Mono', 'SF Mono', monospace";
    ctx.fillText("Exact", pad + barW * 0.6, h - pad + 18);
    ctx.fillStyle = "#4a7fd4";
    ctx.font = "13px 'JetBrains Mono', 'SF Mono', monospace";
    ctx.fillText(ingested.toLocaleString(), pad + barW * 0.5, h - pad - h1 - 8);

    // HLL bar
    const h2 = (est / maxV) * (h - pad * 2);
    ctx.fillStyle = "#f5a623";
    ctx.fillRect(pad + barW * 2.5, h - pad - h2, barW, h2);
    ctx.fillStyle = "#e5e2e1";
    ctx.fillText("HLL", pad + barW * 2.7, h - pad + 18);
    ctx.fillStyle = "#f5a623";
    ctx.fillText(Math.round(est).toLocaleString(), pad + barW * 2.5, h - pad - h2 - 8);

    // Error label
    const errColor = Math.abs(err) < 5 ? "#4caf50" : "#f44336";
    ctx.fillStyle = errColor;
    ctx.font = "bold 16px 'JetBrains Mono', 'SF Mono', monospace";
    ctx.fillText(`Error: ${err.toFixed(2)}%`, w / 2 - 50, pad + 20);

    ctx.strokeStyle = "#2a2a2a";
    ctx.beginPath();
    ctx.moveTo(pad, pad);
    ctx.lineTo(pad, h - pad);
    ctx.lineTo(w - pad, h - pad);
    ctx.stroke();

    // Draw convergence chart
    const cctx = setupCanvas(convCanvas);
    const cw = convCanvas.getBoundingClientRect().width;
    const ch = convCanvas.getBoundingClientRect().height;
    const cPad = 50;

    cctx.clearRect(0, 0, cw, ch);
    cctx.fillStyle = "#111";
    cctx.fillRect(0, 0, cw, ch);

    cctx.strokeStyle = "#2a2a2a";
    cctx.beginPath();
    cctx.moveTo(cPad, cPad);
    cctx.lineTo(cPad, ch - cPad);
    cctx.lineTo(cw - cPad, ch - cPad);
    cctx.stroke();

    cctx.fillStyle = "#666";
    cctx.font = "11px 'JetBrains Mono', 'SF Mono', monospace";
    cctx.fillText("Progress", cw / 2 - 20, ch - 8);
    cctx.save();
    cctx.translate(12, ch / 2);
    cctx.rotate(-Math.PI / 2);
    cctx.fillText("Error %", 0, 0);
    cctx.restore();

    if (convergenceData.length > 1) {
      const maxErr = Math.max(5, ...convergenceData.map((d) => d.error));
      cctx.strokeStyle = "#f5a623";
      cctx.lineWidth = 2;
      cctx.beginPath();
      for (let i = 0; i < convergenceData.length; i++) {
        const x = cPad + convergenceData[i].frac * (cw - cPad * 2);
        const y = ch - cPad - (convergenceData[i].error / maxErr) * (ch - cPad * 2);
        if (i === 0) {
          cctx.moveTo(x, y);
        } else {
          cctx.lineTo(x, y);
        }
      }
      cctx.stroke();

      // Std error line
      const stdErr = hll.stdError * 100;
      const seY = ch - cPad - (stdErr / maxErr) * (ch - cPad * 2);
      cctx.strokeStyle = "#f44336";
      cctx.setLineDash([4, 4]);
      cctx.beginPath();
      cctx.moveTo(cPad, seY);
      cctx.lineTo(cw - cPad, seY);
      cctx.stroke();
      cctx.setLineDash([]);
      cctx.fillStyle = "#f44336";
      cctx.font = "10px 'JetBrains Mono', 'SF Mono', monospace";
      cctx.fillText(`Std error: ${stdErr.toFixed(1)}%`, cw - cPad - 100, seY - 5);
    }

    cctx.fillStyle = "#888";
    cctx.font = "11px 'JetBrains Mono', 'SF Mono', monospace";
    cctx.fillText("Error convergence over stream", cPad + 5, cPad + 12);

    // Draw register heatmap
    const rctx = setupCanvas(regCanvas);
    const rw = regCanvas.getBoundingClientRect().width;
    const rh = regCanvas.getBoundingClientRect().height;

    rctx.clearRect(0, 0, rw, rh);
    rctx.fillStyle = "#0f0f1e";
    rctx.fillRect(0, 0, rw, rh);

    let maxReg = 1;
    for (let i = 0; i < m; i++) if (registers[i] > maxReg) maxReg = registers[i];

    // Determine cell layout
    const cols = Math.min(m, Math.ceil(Math.sqrt(m * (rw / rh))));
    const rows = Math.ceil(m / cols);
    const cellW = rw / cols;
    const cellH = rh / rows;

    for (let i = 0; i < m; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const intensity = registers[i] / maxReg;
      const r = Math.floor(59 + intensity * 196);
      const g = Math.floor(30 + intensity * 128);
      const b = Math.floor(30 + intensity * 177);
      rctx.fillStyle = `rgb(${r},${g},${b})`;
      rctx.fillRect(col * cellW, row * cellH, cellW, cellH);
    }

    regInfo.textContent = `2^${p} = ${m.toLocaleString()} registers, max value = ${maxReg}`;

    // Stats
    const memBytes = m;
    statsEl.innerHTML = `
      <div class="stat"><div class="stat-label">Precision</div><div class="stat-value">${p}</div></div>
      <div class="stat"><div class="stat-label">Registers</div><div class="stat-value">${m.toLocaleString()}</div></div>
      <div class="stat"><div class="stat-label">Memory</div><div class="stat-value">${memBytes < 1024 ? memBytes + "B" : (memBytes / 1024).toFixed(1) + "KB"}</div></div>
      <div class="stat"><div class="stat-label">Std Error</div><div class="stat-value">${(hll.stdError * 100).toFixed(2)}%</div></div>
      <div class="stat"><div class="stat-label">Error</div><div class="stat-value">${Math.abs(err).toFixed(2)}%</div></div>
      <div class="stat"><div class="stat-label">Progress</div><div class="stat-value">${Math.round((ingested / uniqueCount) * 100)}%</div></div>
    `;

    if (ingested < uniqueCount) {
      animId = requestAnimationFrame(animate);
    }

    _frame++;
  }

  animate();
}

pSlider.addEventListener("input", run);
uniqueSel.addEventListener("change", run);
window.addEventListener("resize", () => {
  cancelAnimationFrame(animId);
  run();
});
run();
