import { init } from "@vizcrush/core";
import { lttb } from "@vizcrush/downsample";
import { bin2d } from "@vizcrush/bin";
import { renderLineChart } from "./line-chart.js";
import { renderScatterDensity } from "./scatter-density.js";

async function main() {
  const gpu = await init();

  // ── Generate synthetic time-series data ──
  const N = 1_000_000;
  const timestamps = new Float64Array(N);
  const values = new Float64Array(N);
  let val = 0;
  for (let i = 0; i < N; i++) {
    timestamps[i] = i;
    val += (Math.random() - 0.498) * 10;
    values[i] = val;
  }

  // ── LTTB Downsampling ──
  const t0 = performance.now();
  const { x, y } = await lttb(timestamps, values, 2000);
  const lttbMs = performance.now() - t0;

  // ── Render line chart ──
  const lineContainer = document.getElementById("line-chart")!;
  lineContainer.innerHTML = "";
  renderLineChart(lineContainer, x, y);

  // ── Generate scatter data (3 clusters) ──
  const scatterX = new Float64Array(500_000);
  const scatterY = new Float64Array(500_000);
  for (let i = 0; i < 500_000; i++) {
    const cluster = Math.floor(Math.random() * 3);
    const cx = [200, 500, 800][cluster];
    const cy = [300, 600, 200][cluster];
    scatterX[i] = cx + (Math.random() - 0.5) * 200;
    scatterY[i] = cy + (Math.random() - 0.5) * 200;
  }

  // ── 2D Binning ──
  const t1 = performance.now();
  const { grid, maxCount } = await bin2d(scatterX, scatterY, {
    xBins: 128,
    yBins: 128,
  });
  const binMs = performance.now() - t1;

  // ── Render scatter density heatmap ──
  const scatterContainer = document.getElementById("scatter-chart")!;
  scatterContainer.innerHTML = "";
  renderScatterDensity(scatterContainer, grid, 128, 128, maxCount);

  // ── Display stats ──
  document.getElementById("stats")!.innerHTML = `
    <div class="stat">
      <div class="stat-label">Backend</div>
      <div class="stat-value">${gpu.backend}</div>
    </div>
    <div class="stat">
      <div class="stat-label">LTTB (1M → 2K)</div>
      <div class="stat-value">${lttbMs.toFixed(1)}ms</div>
    </div>
    <div class="stat">
      <div class="stat-label">bin2d (500K → 128²)</div>
      <div class="stat-value">${binMs.toFixed(1)}ms</div>
    </div>
    <div class="stat">
      <div class="stat-label">Max Density</div>
      <div class="stat-value">${maxCount}</div>
    </div>
  `;
}

main().catch(console.error);
