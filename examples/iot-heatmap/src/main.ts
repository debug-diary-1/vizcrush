import { init } from "@vizcrush/core";
import { bin2d } from "@vizcrush/bin";
import { percentile } from "@vizcrush/aggregate";

const gpu = await init();

// Generate 500K clustered GPS coordinates (simulating delivery vehicle tracks)
const N = 500_000;
const latitudes = new Float64Array(N);
const longitudes = new Float64Array(N);

// 5 hotspot clusters
const clusters = [
  { lat: 40.7128, lng: -74.006 }, // NYC
  { lat: 40.758, lng: -73.9855 }, // Times Square
  { lat: 40.6892, lng: -74.0445 }, // Liberty Island
  { lat: 40.7484, lng: -73.9857 }, // Empire State
  { lat: 40.7614, lng: -73.9776 }, // MoMA
];

for (let i = 0; i < N; i++) {
  const c = clusters[Math.floor(Math.random() * clusters.length)];
  const spread = 0.02 + Math.random() * 0.01;
  latitudes[i] = c.lat + (Math.random() - 0.5) * spread;
  longitudes[i] = c.lng + (Math.random() - 0.5) * spread;
}

// Viridis-like color scale
function viridis(t: number): string {
  t = Math.max(0, Math.min(1, t));
  const r = Math.round(68 + t * (253 - 68));
  const g = Math.round(1 + t * (231 - 1));
  const b = Math.round(84 + (1 - Math.abs(t - 0.5) * 2) * (170 - 84));
  return `rgb(${r},${g},${b})`;
}

async function render(bins: number) {
  const t0 = performance.now();
  const { grid, maxCount } = await bin2d(latitudes, longitudes, { xBins: bins, yBins: bins });
  const binMs = performance.now() - t0;

  const canvas = document.getElementById("heatmap") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!;
  const cellW = canvas.width / bins;
  const cellH = canvas.height / bins;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let yi = 0; yi < bins; yi++) {
    for (let xi = 0; xi < bins; xi++) {
      const count = grid[yi * bins + xi];
      if (count === 0) continue;
      const intensity = Math.pow(count / maxCount, 0.4); // gamma correction
      ctx.fillStyle = viridis(intensity);
      ctx.fillRect(xi * cellW, (bins - 1 - yi) * cellH, cellW + 0.5, cellH + 0.5);
    }
  }

  // Percentile stats
  const t1 = performance.now();
  const _pcts = await percentile(latitudes, [10, 25, 50, 75, 90]);
  const pctMs = performance.now() - t1;

  document.getElementById("stats")!.innerHTML = `
    <div class="stat"><div class="stat-label">Backend</div><div class="stat-value">${gpu.backend}</div></div>
    <div class="stat"><div class="stat-label">Points</div><div class="stat-value">${N.toLocaleString()}</div></div>
    <div class="stat"><div class="stat-label">Grid</div><div class="stat-value">${bins}x${bins}</div></div>
    <div class="stat"><div class="stat-label">bin2d</div><div class="stat-value">${binMs.toFixed(1)}ms</div></div>
    <div class="stat"><div class="stat-label">Max Density</div><div class="stat-value">${maxCount}</div></div>
    <div class="stat"><div class="stat-label">Percentiles</div><div class="stat-value">${pctMs.toFixed(1)}ms</div></div>
  `;
}

const resSelect = document.getElementById("resolution") as HTMLSelectElement;
resSelect.addEventListener("change", () => render(parseInt(resSelect.value)));
render(128);
