import { init } from "@vizcrush/core";
import { streamingStats } from "@vizcrush/aggregate";
import { lttbSync } from "@vizcrush/downsample";

async function main() {
  const gpu = await init();
  const BUFFER_SIZE = 20_000;
  const DISPLAY_POINTS = 400;
  const acc = streamingStats(BUFFER_SIZE);

  const canvas = document.getElementById("chart") as HTMLCanvasElement;
  canvas.width = canvas.clientWidth * devicePixelRatio;
  canvas.height = canvas.clientHeight * devicePixelRatio;
  const ctx = canvas.getContext("2d")!;

  const displayBuffer: number[] = [];
  let totalIngested = 0;
  let running = false;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  function updateStats() {
    const el = document.getElementById("stats")!;
    el.innerHTML = `
      <div class="pill"><div class="pill-label">Buffer</div><div class="pill-value">${acc.length.toLocaleString()}</div></div>
      <div class="pill"><div class="pill-label">Ingested</div><div class="pill-value">${totalIngested.toLocaleString()}</div></div>
      <div class="pill"><div class="pill-label">Displayed</div><div class="pill-value">${Math.min(displayBuffer.length, DISPLAY_POINTS)}</div></div>
      <div class="pill"><div class="pill-label">Mean</div><div class="pill-value">${acc.length > 0 ? acc.mean.toFixed(1) : "-"}</div></div>
      <div class="pill"><div class="pill-label">Min</div><div class="pill-value">${acc.length > 0 ? acc.min.toFixed(1) : "-"}</div></div>
      <div class="pill"><div class="pill-label">Max</div><div class="pill-value">${acc.length > 0 ? acc.max.toFixed(1) : "-"}</div></div>
      <div class="pill"><div class="pill-label">Std Dev</div><div class="pill-value">${acc.length > 0 ? acc.stdDev.toFixed(2) : "-"}</div></div>
      <div class="pill"><div class="pill-label">Backend</div><div class="pill-value">${gpu.backend}</div></div>
    `;
  }

  function renderChart() {
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (displayBuffer.length < 2) return;

    const rawY = Float64Array.from(displayBuffer);
    const firstTimestamp = totalIngested - rawY.length;
    const rawX = Float64Array.from(rawY, (_, index) => firstTimestamp + index);
    const sampled =
      rawY.length > DISPLAY_POINTS ? lttbSync(rawX, rawY, DISPLAY_POINTS) : { x: rawX, y: rawY };
    const n = sampled.y.length;
    let min = Infinity,
      max = -Infinity;
    for (const v of sampled.y) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const range = max - min || 1;
    const xRange = sampled.x[n - 1] - sampled.x[0] || 1;
    const padding = 20;

    ctx.strokeStyle = "#3b9ecf";
    ctx.lineWidth = 1.5 * devicePixelRatio;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = padding + ((sampled.x[i] - sampled.x[0]) / xRange) * (w - 2 * padding);
      const y = h - padding - ((sampled.y[i] - min) / range) * (h - 2 * padding);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function ingestBatch() {
    const batch = new Float64Array(50);
    for (let i = 0; i < 50; i++) {
      batch[i] = Math.sin(totalIngested * 0.01) * 50 + Math.random() * 20 - 10;
      totalIngested++;
    }

    acc.pushBatch(batch);
    for (let i = 0; i < batch.length; i++) {
      displayBuffer.push(batch[i]);
    }
    if (displayBuffer.length > BUFFER_SIZE) {
      displayBuffer.splice(0, displayBuffer.length - BUFFER_SIZE);
    }

    updateStats();
    renderChart();
  }

  document.getElementById("start")!.addEventListener("click", () => {
    if (running) return;
    running = true;
    intervalId = setInterval(ingestBatch, 50); // 50 pts every 50ms = 1000/sec
  });

  document.getElementById("stop")!.addEventListener("click", () => {
    running = false;
    if (intervalId) clearInterval(intervalId);
  });

  updateStats();
}

main().catch(console.error);
