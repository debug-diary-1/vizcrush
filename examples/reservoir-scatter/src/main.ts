import { ReservoirSampler } from "@vizcrush/aggregate";

// --- Point generation ---

interface Point {
  x: number;
  y: number;
}

function generatePoints(dist: string, n: number): Point[] {
  const pts: Point[] = [];
  switch (dist) {
    case "spiral":
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const angle = t * 6 * Math.PI;
        const r = t;
        const noise = 0.02;
        pts.push({
          x: r * Math.cos(angle) + (Math.random() - 0.5) * noise,
          y: r * Math.sin(angle) + (Math.random() - 0.5) * noise,
        });
      }
      break;
    case "clusters": {
      const centers = [
        { cx: -0.5, cy: -0.5 },
        { cx: 0.5, cy: 0.5 },
        { cx: -0.5, cy: 0.5 },
        { cx: 0.5, cy: -0.5 },
        { cx: 0, cy: 0 },
      ];
      for (let i = 0; i < n; i++) {
        const c = centers[i % centers.length];
        pts.push({
          x: c.cx + boxMuller() * 0.12,
          y: c.cy + boxMuller() * 0.12,
        });
      }
      break;
    }
    case "grid-with-gaps":
      for (let i = 0; i < n; i++) {
        const gx = Math.floor(Math.random() * 8);
        const gy = Math.floor(Math.random() * 8);
        // Checkerboard: skip if both coords are even or both odd
        if ((gx + gy) % 2 === 0) {
          i--;
          continue;
        }
        pts.push({
          x: (gx + Math.random()) / 8 - 0.5,
          y: (gy + Math.random()) / 8 - 0.5,
        });
      }
      break;
  }
  return pts;
}

function boxMuller(): number {
  let u = 0,
    v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// --- Reservoir sampling by index ---

function samplePoints(points: Point[], k: number): Point[] {
  const sampler = new ReservoirSampler(k);
  // Feed indices into the sampler
  for (let i = 0; i < points.length; i++) {
    sampler.add(i);
  }
  const sampledIndices = sampler.sample;
  const result: Point[] = [];
  for (let i = 0; i < sampledIndices.length; i++) {
    const idx = Math.round(sampledIndices[i]);
    if (idx >= 0 && idx < points.length) {
      result.push(points[idx]);
    }
  }
  return result;
}

// --- Stats ---

function computeStats(pts: Point[]) {
  let sx = 0,
    sy = 0,
    sx2 = 0,
    sy2 = 0;
  const n = pts.length;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
  }
  const mx = sx / n,
    my = sy / n;
  for (const p of pts) {
    sx2 += (p.x - mx) ** 2;
    sy2 += (p.y - my) ** 2;
  }
  return {
    meanX: mx,
    meanY: my,
    stdX: Math.sqrt(sx2 / n),
    stdY: Math.sqrt(sy2 / n),
  };
}

// --- KS test (two-sample, x-marginal) ---

function ksTest(a: number[], b: number[]): { D: number; pValue: number } {
  const sa = a.slice().sort((x, y) => x - y);
  const sb = b.slice().sort((x, y) => x - y);
  const na = sa.length,
    nb = sb.length;
  let ia = 0,
    ib = 0,
    D = 0;
  while (ia < na && ib < nb) {
    if (sa[ia] <= sb[ib]) {
      ia++;
    } else {
      ib++;
    }
    const diff = Math.abs(ia / na - ib / nb);
    if (diff > D) D = diff;
  }
  const ne = Math.sqrt((na * nb) / (na + nb));
  // Approximate p-value (Kolmogorov distribution)
  const lambda = (ne + 0.12 + 0.11 / ne) * D;
  let p = 0;
  for (let k = 1; k <= 100; k++) {
    p += (-1) ** (k - 1) * Math.exp(-2 * k * k * lambda * lambda);
  }
  return { D, pValue: Math.max(0, Math.min(1, 2 * p)) };
}

// --- Quadrant density ---

function quadrantDensity(
  pts: Point[],
  gridSize: number,
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
) {
  const counts = Array.from({ length: gridSize * gridSize }, () => 0);
  const rangeX = bounds.maxX - bounds.minX || 1;
  const rangeY = bounds.maxY - bounds.minY || 1;
  for (const p of pts) {
    let gx = Math.floor(((p.x - bounds.minX) / rangeX) * gridSize);
    let gy = Math.floor(((p.y - bounds.minY) / rangeY) * gridSize);
    gx = Math.max(0, Math.min(gridSize - 1, gx));
    gy = Math.max(0, Math.min(gridSize - 1, gy));
    counts[gy * gridSize + gx]++;
  }
  return counts;
}

// --- Canvas helpers ---

function setupCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  return ctx;
}

// --- Draw scatter ---

function drawScatter(canvas: HTMLCanvasElement, allPts: Point[], samplePts: Point[]) {
  const ctx = setupCanvas(canvas);
  const rect = canvas.getBoundingClientRect();
  const w = rect.width,
    h = rect.height;
  const pad = 30;

  ctx.fillStyle = "#0e0e1a";
  ctx.fillRect(0, 0, w, h);

  // Compute bounds
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of allPts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const rx = maxX - minX || 1,
    ry = maxY - minY || 1;
  const scale = Math.min((w - pad * 2) / rx, (h - pad * 2) / ry);
  const ox = (w - rx * scale) / 2,
    oy = (h - ry * scale) / 2;

  function toScreen(p: Point): [number, number] {
    return [ox + (p.x - minX) * scale, oy + (maxY - p.y) * scale];
  }

  // Grid lines
  ctx.strokeStyle = "#1c1b1b";
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const frac = i / 4;
    const x = ox + frac * rx * scale;
    const y = oy + frac * ry * scale;
    ctx.beginPath();
    ctx.moveTo(x, oy);
    ctx.lineTo(x, oy + ry * scale);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ox, y);
    ctx.lineTo(ox + rx * scale, y);
    ctx.stroke();
  }

  // All points (faded)
  ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
  for (const p of allPts) {
    const [sx, sy] = toScreen(p);
    ctx.beginPath();
    ctx.arc(sx, sy, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Sample points (bright)
  ctx.fillStyle = "#50e080";
  ctx.shadowColor = "#50e080";
  ctx.shadowBlur = 3;
  for (const p of samplePts) {
    const [sx, sy] = toScreen(p);
    ctx.beginPath();
    ctx.arc(sx, sy, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
}

// --- Draw density comparison ---

function drawDensity(
  canvas: HTMLCanvasElement,
  fullCounts: number[],
  sampleCounts: number[],
  gridSize: number,
) {
  const ctx = setupCanvas(canvas);
  const rect = canvas.getBoundingClientRect();
  const w = rect.width,
    h = rect.height;
  ctx.clearRect(0, 0, w, h);

  const cellW = (w - 20) / (gridSize * 2 + 1);
  const cellH = (h - 30) / gridSize;

  const maxFull = Math.max(...fullCounts, 1);
  const maxSample = Math.max(...sampleCounts, 1);

  // Labels
  ctx.fillStyle = "#555";
  ctx.font = "10px 'JetBrains Mono', 'SF Mono', monospace";
  ctx.textAlign = "center";
  ctx.fillText("Full Dataset", (gridSize * cellW) / 2 + 5, 10);
  ctx.fillText("Sample", w - (gridSize * cellW) / 2 - 5, 10);

  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      const idx = gy * gridSize + gx;
      // Full
      const intensity = fullCounts[idx] / maxFull;
      const r = Math.round(50 + intensity * 150);
      const b = Math.round(100 + intensity * 100);
      ctx.fillStyle = `rgb(${r}, ${Math.round(60 + intensity * 60)}, ${b})`;
      ctx.fillRect(5 + gx * cellW, 15 + gy * cellH, cellW - 1, cellH - 1);

      // Full count text
      ctx.fillStyle = intensity > 0.5 ? "#fff" : "#666";
      ctx.font = "9px 'JetBrains Mono', 'SF Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText(
        String(fullCounts[idx]),
        5 + gx * cellW + cellW / 2,
        15 + gy * cellH + cellH / 2 + 3,
      );

      // Sample
      const si = sampleCounts[idx] / maxSample;
      const sg = Math.round(80 + si * 144);
      ctx.fillStyle = `rgb(${Math.round(30 + si * 50)}, ${sg}, ${Math.round(50 + si * 78)})`;
      const sxOff = w - 5 - gridSize * cellW;
      ctx.fillRect(sxOff + gx * cellW, 15 + gy * cellH, cellW - 1, cellH - 1);

      ctx.fillStyle = si > 0.5 ? "#fff" : "#666";
      ctx.fillText(
        String(sampleCounts[idx]),
        sxOff + gx * cellW + cellW / 2,
        15 + gy * cellH + cellH / 2 + 3,
      );
    }
  }
}

// --- DOM refs ---

const elTotal = document.getElementById("total-points") as HTMLSelectElement;
const elK = document.getElementById("sample-k") as HTMLSelectElement;
const elDist = document.getElementById("dist-type") as HTMLSelectElement;

function formatNum(v: number): string {
  if (Math.abs(v) >= 100) return v.toFixed(1);
  if (Math.abs(v) >= 1) return v.toFixed(3);
  return v.toPrecision(4);
}

function statRow(label: string, full: string, sample: string): string {
  return `<div class="stat-row">
    <span class="label">${label}</span>
    <span class="val-full">${full}</span>
    <span class="val-sample">${sample}</span>
  </div>`;
}

// --- Main ---

function update() {
  const n = parseInt(elTotal.value, 10);
  const k = parseInt(elK.value, 10);
  const dist = elDist.value;

  const allPts = generatePoints(dist, n);
  const samplePts = samplePoints(allPts, k);

  // Draw scatter
  drawScatter(document.getElementById("canvas-scatter") as HTMLCanvasElement, allPts, samplePts);

  // Bounds for density
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of allPts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const bounds = { minX, maxX, minY, maxY };

  // Density
  const gridSize = 4;
  const fullDensity = quadrantDensity(allPts, gridSize, bounds);
  const sampleDensity = quadrantDensity(samplePts, gridSize, bounds);

  drawDensity(
    document.getElementById("canvas-density") as HTMLCanvasElement,
    fullDensity,
    sampleDensity,
    gridSize,
  );

  // KS test
  const fullX = allPts.map((p) => p.x);
  const sampleX = samplePts.map((p) => p.x);
  const ks = ksTest(fullX, sampleX);
  const ksEl = document.getElementById("ks-result")!;
  const pass = ks.pValue > 0.05;
  ksEl.innerHTML = `
    <div class="ks-badge ${pass ? "ks-pass" : "ks-fail"}">
      D = ${ks.D.toFixed(4)}, p = ${ks.pValue.toFixed(4)}
      ${pass ? " (not significant -- good!)" : " (significant -- sampling may be off)"}
    </div>
  `;

  // Stats comparison
  const fullStats = computeStats(allPts);
  const sampleStats = computeStats(samplePts);
  const panel = document.getElementById("stats-panel")!;
  panel.innerHTML =
    statRow("Mean X", formatNum(fullStats.meanX), formatNum(sampleStats.meanX)) +
    statRow("Mean Y", formatNum(fullStats.meanY), formatNum(sampleStats.meanY)) +
    statRow("Std X", formatNum(fullStats.stdX), formatNum(sampleStats.stdX)) +
    statRow("Std Y", formatNum(fullStats.stdY), formatNum(sampleStats.stdY)) +
    statRow("Count", String(allPts.length), String(samplePts.length));
}

elTotal.addEventListener("change", update);
elK.addEventListener("change", update);
elDist.addEventListener("change", update);
window.addEventListener("resize", update);
update();
