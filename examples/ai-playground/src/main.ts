import { init } from "@vizcrush/core";
import {
  detectAnomalies,
  detectChangepoints,
  autoOptimize,
  summarize,
  summarizeForLLM,
  parseDataQuery,
  computeShapeVector,
  shapeSimilarity,
} from "@vizcrush/ai";

const canvas = document.getElementById("chart") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const chartStats = document.getElementById("chartStats")!;
const anomalyOut = document.getElementById("anomalyOutput")!;
const autoOut = document.getElementById("autoOutput")!;
const summaryOut = document.getElementById("summaryOutput")!;
const queryOut = document.getElementById("queryOutput")!;

let data = new Float64Array(0);
let xData = new Float64Array(0);

// ── Data generators ──
function generate(type: string, n: number) {
  xData = new Float64Array(n);
  data = new Float64Array(n);
  for (let i = 0; i < n; i++) xData[i] = i;

  switch (type) {
    case "sine":
      for (let i = 0; i < n; i++) data[i] = Math.sin(i * 0.05) * 50 + 100;
      break;
    case "spiky": {
      let v = 100;
      for (let i = 0; i < n; i++) {
        v += (Math.random() - 0.498) * 3;
        if (Math.random() < 0.005) v += (Math.random() - 0.5) * 200;
        data[i] = v;
      }
      break;
    }
    case "shift":
      for (let i = 0; i < n; i++) {
        data[i] = (i < n / 2 ? 50 : 150) + (Math.random() - 0.5) * 10;
        if (i === Math.floor(n * 0.3)) data[i] = 300;
        if (i === Math.floor(n * 0.7)) data[i] = -20;
      }
      break;
    case "random":
      for (let i = 0; i < n; i++) data[i] = Math.random() * 100;
      break;
    case "trend":
      for (let i = 0; i < n; i++) data[i] = i * 0.1 + Math.sin(i * 0.02) * 20 + Math.random() * 5;
      break;
  }
}

// ── Chart ──
function drawChart(anomalies?: Array<{ index: number }>) {
  const dpr = devicePixelRatio;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  ctx.scale(dpr, dpr);
  const w = canvas.clientWidth,
    h = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);
  if (data.length === 0) return;

  let min = Infinity,
    max = -Infinity;
  for (let i = 0; i < data.length; i++) {
    if (data[i] < min) min = data[i];
    if (data[i] > max) max = data[i];
  }
  const range = max - min || 1;
  const step = Math.max(1, Math.floor(data.length / w));

  // Area fill
  ctx.fillStyle = "rgba(124, 58, 237, 0.06)";
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let i = 0; i < data.length; i += step) {
    const px = (i / data.length) * w;
    const py = h - 8 - ((data[i] - min) / range) * (h - 16);
    ctx.lineTo(px, py);
  }
  ctx.lineTo(w, h);
  ctx.fill();

  // Line
  ctx.strokeStyle = "#7c3aed";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < data.length; i += step) {
    const px = (i / data.length) * w;
    const py = h - 8 - ((data[i] - min) / range) * (h - 16);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  // Anomaly dots
  if (anomalies) {
    for (const a of anomalies) {
      const px = (a.index / data.length) * w;
      const py = h - 8 - ((data[a.index] - min) / range) * (h - 16);
      ctx.fillStyle = "#ef4444";
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "white";
      ctx.beginPath();
      ctx.arc(px, py, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ── Run all ──
function runAll() {
  if (data.length === 0) return;

  // 1. Anomalies
  const t0 = performance.now();
  const anomalies = detectAnomalies(data, 3);
  const changepoints = detectChangepoints(data, Math.max(20, Math.floor(data.length / 20)));
  const anomalyMs = performance.now() - t0;

  let html = `<div style="margin-bottom:8px;font-size:13px;font-weight:600;">${anomalies.length} anomalies detected <span style="color:#9ca3af;font-weight:400;font-size:11px;">(${anomalyMs.toFixed(1)}ms)</span></div>`;
  if (anomalies.length > 0) {
    for (const a of anomalies.slice(0, 8)) {
      html += `<div class="anomaly-item">
        <div class="anomaly-dot ${a.type}"></div>
        <span style="font-weight:500;">${a.type}</span>
        <span style="color:#9ca3af;">at index ${a.index}</span>
        <span style="color:#6b7280;">value=${a.value.toFixed(1)}</span>
        <span style="font-family:JetBrains Mono;font-size:10px;color:#7c3aed;">z=${a.zScore.toFixed(2)}</span>
      </div>`;
    }
    if (anomalies.length > 8)
      html += `<div style="color:#9ca3af;font-size:11px;margin-top:4px;">+ ${anomalies.length - 8} more</div>`;
  } else {
    html += `<div style="color:#9ca3af;">No anomalies found — data is clean.</div>`;
  }
  if (changepoints.length > 0) {
    html += `<div style="margin-top:8px;font-size:11px;color:#f59e0b;">Changepoints: ${changepoints
      .slice(0, 3)
      .map((c) => `index ${c}`)
      .join(", ")}${changepoints.length > 3 ? ` + ${changepoints.length - 3} more` : ""}</div>`;
  }
  anomalyOut.innerHTML = html;

  // 2. Auto-optimize
  const t1 = performance.now();
  const config = autoOptimize(xData, data, 1920);
  const autoMs = performance.now() - t1;

  autoOut.innerHTML = `
    <div class="code-block">
<span class="label">algorithm</span>    <span class="value">${config.algorithm}</span>
<span class="label">target</span>       <span class="value">${config.targetPoints} points</span>
<span class="label">speedup</span>      <span class="value">${config.estimatedSpeedup.toFixed(0)}x</span>
<span class="label">spatial</span>      ${config.spatialIndex}
<span class="label">bins</span>         ${config.binResolution ?? "N/A"}
<span class="muted">${config.reasoning}</span>
<span class="muted">(${autoMs.toFixed(1)}ms)</span></div>`;

  // 3. Summary
  const t2 = performance.now();
  const summary = summarize(xData, data);
  const llmText = summarizeForLLM(xData, data);
  const sumMs = performance.now() - t2;

  summaryOut.innerHTML = `
    <div class="code-block" style="margin-bottom:8px;">
<span class="label">trend</span>       <span class="value">${summary.trend}</span> (slope ${summary.trendSlope.toFixed(4)})
<span class="label">range</span>       [${summary.range.min.toFixed(1)} → ${summary.range.max.toFixed(1)}]
<span class="label">mean</span>        ${summary.distribution.mean.toFixed(2)}
<span class="label">stddev</span>      ${summary.distribution.stddev.toFixed(2)}
<span class="label">spikes</span>      ${summary.spikeCount}
<span class="label">anomalies</span>   ${summary.anomalyCount}
<span class="muted">(${sumMs.toFixed(1)}ms)</span></div>
    <div class="llm-label">What AI agents see:</div>
    <div class="llm-paragraph">${llmText}</div>`;

  // 4. Shape embedding + default sine comparison
  const vec = computeShapeVector(data, 16);
  const sineRef = new Float64Array(data.length).map((_, i) => Math.sin(i * 0.05));
  const sineVec = computeShapeVector(sineRef, 16);
  const sim = shapeSimilarity(vec, sineVec);

  const barColor = sim > 0.8 ? "#10b981" : sim > 0.5 ? "#f59e0b" : "#ef4444";
  queryOut.innerHTML = `
    <div style="margin-bottom:12px;">
      <div class="sim-row">
        <span class="sim-label">vs sine wave</span>
        <div class="sim-bar-bg"><div class="sim-bar" style="width:${sim * 100}%;background:${barColor}"></div></div>
        <span class="sim-value" style="color:${barColor}">${sim.toFixed(2)}</span>
      </div>
      <div class="sim-row">
        <span class="sim-label">vs self</span>
        <div class="sim-bar-bg"><div class="sim-bar" style="width:100%;background:#10b981"></div></div>
        <span class="sim-value" style="color:#10b981">1.00</span>
      </div>
    </div>
    <div style="color:#9ca3af;font-size:11px;">Type a question above and click Ask to test NLP parsing.</div>`;

  drawChart(anomalies);

  // Chart stats
  chartStats.innerHTML = `
    <span class="chart-stat"><b>${data.length.toLocaleString()}</b> points</span>
    <span class="chart-stat"><b>${anomalies.length}</b> anomalies</span>
    <span class="chart-stat">trend: <b>${summary.trend}</b></span>
    <span class="chart-stat">algo: <b>${config.algorithm}</b></span>
    <span class="chart-stat">total: <b>${(anomalyMs + autoMs + sumMs).toFixed(0)}ms</b></span>`;
}

// ── NLP Query ──
function runQuery() {
  const q = (document.getElementById("nlQuery") as HTMLInputElement).value.trim();
  if (!q) return;

  const result = parseDataQuery(q, { length: data.length, hasTimestamps: true });
  const vec = computeShapeVector(data, 16);
  const sineVec = computeShapeVector(
    new Float64Array(data.length).map((_, i) => Math.sin(i * 0.05)),
    16,
  );
  const sim = shapeSimilarity(vec, sineVec);
  const barColor = sim > 0.8 ? "#10b981" : sim > 0.5 ? "#f59e0b" : "#ef4444";

  queryOut.innerHTML = `
    <div class="code-block" style="margin-bottom:12px;">
<span class="muted">Query:</span> "${q}"

<span class="label">operation</span>    <span class="value">${result.operation}</span>
<span class="label">description</span>  ${result.description}
<span class="label">params</span>       ${JSON.stringify(result.params)}</div>
    <div style="font-size:11px;font-weight:600;color:#6b7280;margin-bottom:6px;">Shape Similarity</div>
    <div class="sim-row">
      <span class="sim-label">vs sine wave</span>
      <div class="sim-bar-bg"><div class="sim-bar" style="width:${sim * 100}%;background:${barColor}"></div></div>
      <span class="sim-value" style="color:${barColor}">${sim.toFixed(2)}</span>
    </div>`;
}

// ── Events ──
document.getElementById("generateBtn")!.addEventListener("click", () => {
  generate(
    (document.getElementById("dataType") as HTMLSelectElement).value,
    parseInt((document.getElementById("dataSize") as HTMLSelectElement).value),
  );
  runAll();
});

document.getElementById("queryBtn")!.addEventListener("click", runQuery);
document.getElementById("nlQuery")!.addEventListener("keydown", (e) => {
  if ((e as KeyboardEvent).key === "Enter") runQuery();
});

// ── Init ──
init().then(() => {
  generate("shift", 5000);
  runAll();
});
