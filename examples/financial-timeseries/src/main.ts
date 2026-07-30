import { init } from "@vizcrush/core";
import { lttb, minMaxLttb } from "@vizcrush/downsample";

const gpu = await init();

function generateBTCLikeData(n: number) {
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  let price = 45000;
  for (let i = 0; i < n; i++) {
    x[i] = i;
    // Random walk with occasional spikes (simulating crypto volatility)
    const spike = Math.random() < 0.002 ? (Math.random() - 0.5) * 2000 : 0;
    price += (Math.random() - 0.498) * 50 + spike;
    price = Math.max(20000, Math.min(80000, price));
    y[i] = price;
  }
  return { x, y };
}

function drawChart(canvas: HTMLCanvasElement, x: Float64Array, y: Float64Array, color: string) {
  const dpr = devicePixelRatio;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);

  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const pad = 10;

  let minY = Infinity,
    maxY = -Infinity;
  for (let i = 0; i < y.length; i++) {
    if (y[i] < minY) minY = y[i];
    if (y[i] > maxY) maxY = y[i];
  }

  const rangeY = maxY - minY || 1;

  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < x.length; i++) {
    const px = pad + (i / (x.length - 1)) * (w - 2 * pad);
    const py = h - pad - ((y[i] - minY) / rangeY) * (h - 2 * pad);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

async function run() {
  const sizeSelect = document.getElementById("dataSize") as HTMLSelectElement;
  const targetSelect = document.getElementById("targetPoints") as HTMLSelectElement;

  async function update() {
    const n = parseInt(sizeSelect.value);
    const target = parseInt(targetSelect.value);

    const { x, y } = generateBTCLikeData(n);

    // LTTB
    const t0 = performance.now();
    const lttbResult = await lttb(x, y, target);
    const lttbMs = performance.now() - t0;

    // MinMaxLTTB
    const t1 = performance.now();
    const mmResult = await minMaxLttb(x, y, target);
    const mmMs = performance.now() - t1;

    // Draw
    drawChart(
      document.getElementById("lttb-chart") as HTMLCanvasElement,
      lttbResult.x,
      lttbResult.y,
      "#3b9ecf",
    );
    drawChart(
      document.getElementById("minmax-chart") as HTMLCanvasElement,
      mmResult.x,
      mmResult.y,
      "#cf6b3b",
    );

    // Stats
    const reduction = ((1 - target / n) * 100).toFixed(1);
    document.getElementById("stats")!.innerHTML = `
      <div class="stat"><div class="stat-label">Backend</div><div class="stat-value">${gpu.backend}</div></div>
      <div class="stat"><div class="stat-label">Input</div><div class="stat-value">${n.toLocaleString()}</div></div>
      <div class="stat"><div class="stat-label">Output</div><div class="stat-value">${target.toLocaleString()}</div></div>
      <div class="stat"><div class="stat-label">Reduction</div><div class="stat-value">${reduction}%</div></div>
      <div class="stat"><div class="stat-label">LTTB</div><div class="stat-value">${lttbMs.toFixed(1)}ms</div></div>
      <div class="stat"><div class="stat-label">MinMaxLTTB</div><div class="stat-value">${mmMs.toFixed(1)}ms</div></div>
    `;
  }

  sizeSelect.addEventListener("change", update);
  targetSelect.addEventListener("change", update);
  update();
}

run();
