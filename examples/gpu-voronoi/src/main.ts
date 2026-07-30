// ── State ──
interface Seed {
  x: number;
  y: number;
  vx: number;
  vy: number;
}
let seeds: Seed[] = [];
let seedCount = 200;
let palette: "rainbow" | "blue" | "earth" = "rainbow";
let glowOn = true;
let animOn = true;
let clickAdd = true;
let dragging = -1;
let dirty = true;

const GRID = 400;
const cellMap = new Uint16Array(GRID * GRID);
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const offscreen = document.createElement("canvas");
const offCtx = offscreen.getContext("2d")!;
const glowCanvas = document.createElement("canvas");
const glowCtx = glowCanvas.getContext("2d")!;
const statsEl = document.getElementById("stats")!;

// ── Color helpers ──
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function seedColor(i: number): [number, number, number] {
  if (palette === "rainbow") {
    const hue = (i * 137.508) % 360;
    const sat = 50 + (i % 3) * 15;
    const lum = 22 + (i % 5) * 7;
    return hslToRgb(hue, sat, lum);
  } else if (palette === "blue") {
    const hue = 200 + ((i * 37) % 40);
    const sat = 40 + (i % 4) * 12;
    const lum = 18 + (i % 6) * 6;
    return hslToRgb(hue, sat, lum);
  } else {
    const hue = 20 + ((i * 47) % 50);
    const sat = 30 + (i % 3) * 15;
    const lum = 18 + (i % 5) * 7;
    return hslToRgb(hue, sat, lum);
  }
}

// ── Seed generation ──
function generateSeeds(n: number) {
  seeds = [];
  for (let i = 0; i < n; i++) {
    seeds.push({
      x: 0.05 + Math.random() * 0.9,
      y: 0.05 + Math.random() * 0.9,
      vx: (Math.random() - 0.5) * 0.0004,
      vy: (Math.random() - 0.5) * 0.0004,
    });
  }
  dirty = true;
}

// ── Voronoi computation ──
function computeVoronoi() {
  const n = seeds.length;
  for (let py = 0; py < GRID; py++) {
    for (let px = 0; px < GRID; px++) {
      const x = (px + 0.5) / GRID;
      const y = (py + 0.5) / GRID;
      let minD = Infinity,
        nearest = 0;
      for (let i = 0; i < n; i++) {
        const dx = x - seeds[i].x,
          dy = y - seeds[i].y;
        const d = dx * dx + dy * dy;
        if (d < minD) {
          minD = d;
          nearest = i;
        }
      }
      cellMap[py * GRID + px] = nearest;
    }
  }
}

// ── Precompute color LUT ──
let colorLUT = new Uint8Array(0);
function buildColorLUT() {
  colorLUT = new Uint8Array(seeds.length * 3);
  for (let i = 0; i < seeds.length; i++) {
    const [r, g, b] = seedColor(i);
    colorLUT[i * 3] = r;
    colorLUT[i * 3 + 1] = g;
    colorLUT[i * 3 + 2] = b;
  }
}

// ── Render ──
function render() {
  const w = canvas.width,
    h = canvas.height;
  offscreen.width = w;
  offscreen.height = h;

  const imageData = offCtx.createImageData(w, h);
  const data = imageData.data;
  const scaleX = GRID / w,
    scaleY = GRID / h;

  // Edge pixel buffer for glow pass
  const edgeBuf = glowOn ? new Uint8Array(w * h) : null;

  for (let py = 0; py < h; py++) {
    const gy = Math.min((py * scaleY) | 0, GRID - 1);
    for (let px = 0; px < w; px++) {
      const gx = Math.min((px * scaleX) | 0, GRID - 1);
      const cell = cellMap[gy * GRID + gx];
      const idx = (py * w + px) * 4;

      // Edge detection
      let isEdge = false;
      if (gx > 0 && cellMap[gy * GRID + gx - 1] !== cell) isEdge = true;
      else if (gx < GRID - 1 && cellMap[gy * GRID + gx + 1] !== cell) isEdge = true;
      else if (gy > 0 && cellMap[(gy - 1) * GRID + gx] !== cell) isEdge = true;
      else if (gy < GRID - 1 && cellMap[(gy + 1) * GRID + gx] !== cell) isEdge = true;

      if (isEdge) {
        data[idx] = 74;
        data[idx + 1] = 180;
        data[idx + 2] = 230;
        data[idx + 3] = 255;
        if (edgeBuf) edgeBuf[py * w + px] = 1;
      } else {
        const ci = cell * 3;
        data[idx] = colorLUT[ci];
        data[idx + 1] = colorLUT[ci + 1];
        data[idx + 2] = colorLUT[ci + 2];
        data[idx + 3] = 255;
      }
    }
  }
  offCtx.putImageData(imageData, 0, 0);

  // Compose to main canvas
  ctx.drawImage(offscreen, 0, 0);

  // Glow pass
  if (glowOn && edgeBuf) {
    glowCanvas.width = w;
    glowCanvas.height = h;
    const glowData = glowCtx.createImageData(w, h);
    const gd = glowData.data;
    for (let i = 0; i < edgeBuf.length; i++) {
      if (edgeBuf[i]) {
        const j = i * 4;
        gd[j] = 74;
        gd[j + 1] = 180;
        gd[j + 2] = 230;
        gd[j + 3] = 200;
      }
    }
    glowCtx.putImageData(glowData, 0, 0);
    glowCtx.filter = "blur(6px)";
    glowCtx.drawImage(glowCanvas, 0, 0);
    glowCtx.filter = "none";
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(glowCanvas, 0, 0);
    ctx.globalCompositeOperation = "source-over";
  }

  // Draw seed dots
  ctx.fillStyle = "#e5e2e1";
  for (const s of seeds) {
    ctx.beginPath();
    ctx.arc(s.x * w, s.y * h, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ── Animation loop ──
function animateSeeds() {
  for (const s of seeds) {
    s.x += s.vx;
    s.y += s.vy;
    if (s.x < 0.01 || s.x > 0.99) s.vx *= -1;
    if (s.y < 0.01 || s.y > 0.99) s.vy *= -1;
    s.x = Math.max(0.01, Math.min(0.99, s.x));
    s.y = Math.max(0.01, Math.min(0.99, s.y));
  }
}

let lastRenderMs = 0;
function frame() {
  if (animOn && dragging < 0) {
    animateSeeds();
    dirty = true;
  }
  if (dirty) {
    const t0 = performance.now();
    computeVoronoi();
    render();
    lastRenderMs = performance.now() - t0;
    dirty = false;
    statsEl.textContent = `Seeds: ${seeds.length} | Render: ${lastRenderMs.toFixed(1)}ms | Grid: ${GRID}\u00d7${GRID}`;
  }
  requestAnimationFrame(frame);
}

// ── Resize ──
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  dirty = true;
}
window.addEventListener("resize", resize);

// ── Mouse interaction ──
function seedAt(mx: number, my: number, threshold: number): number {
  const w = canvas.width,
    h = canvas.height;
  const nx = mx / w,
    ny = my / h;
  let best = -1,
    bestD = (threshold * threshold) / (w * w);
  for (let i = 0; i < seeds.length; i++) {
    const dx = nx - seeds[i].x,
      dy = ny - seeds[i].y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

canvas.addEventListener("mousedown", (e) => {
  if (e.button === 2) {
    e.preventDefault();
    const idx = seedAt(e.clientX, e.clientY, 30);
    if (idx >= 0 && seeds.length > 3) {
      seeds.splice(idx, 1);
      buildColorLUT();
      dirty = true;
    }
    return;
  }
  const idx = seedAt(e.clientX, e.clientY, 20);
  if (idx >= 0) {
    dragging = idx;
  } else if (clickAdd) {
    seeds.push({
      x: e.clientX / canvas.width,
      y: e.clientY / canvas.height,
      vx: (Math.random() - 0.5) * 0.0004,
      vy: (Math.random() - 0.5) * 0.0004,
    });
    buildColorLUT();
    dirty = true;
  }
});

canvas.addEventListener("mousemove", (e) => {
  if (dragging >= 0) {
    seeds[dragging].x = e.clientX / canvas.width;
    seeds[dragging].y = e.clientY / canvas.height;
    dirty = true;
  }
});

canvas.addEventListener("mouseup", () => {
  dragging = -1;
});
canvas.addEventListener("mouseleave", () => {
  dragging = -1;
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

// ── Controls ──
function wireButtons(id: string, cb: (v: string) => void) {
  const el = document.getElementById(id)!;
  el.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest(".btn") as HTMLElement;
    if (!btn) return;
    el.querySelectorAll(".btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    cb(btn.dataset.v!);
  });
}

wireButtons("seedBtns", (v) => {
  seedCount = +v;
  generateSeeds(seedCount);
  buildColorLUT();
});
wireButtons("paletteBtns", (v) => {
  palette = v as any;
  buildColorLUT();
  dirty = true;
});
wireButtons("glowBtns", (v) => {
  glowOn = v === "on";
  dirty = true;
});
wireButtons("animBtns", (v) => {
  animOn = v === "on";
  dirty = true;
});
wireButtons("clickBtns", (v) => {
  clickAdd = v === "on";
});

// ── Init ──
resize();
generateSeeds(seedCount);
buildColorLUT();
frame();
