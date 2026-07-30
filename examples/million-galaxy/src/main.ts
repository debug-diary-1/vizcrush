// Million-Star Galaxy Simulation — Canvas 2D with ImageData rendering
const canvas = document.getElementById("c") as HTMLCanvasElement;
const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
const statsEl = document.getElementById("stats")!;

let N = 1_000_000;
let armCount = 4;
let autoRotate = true;
let brightness = 1.0;

let starX: Float32Array, starY: Float32Array, starZ: Float32Array;
let starColor: Uint32Array, starSize: Float32Array;

let camRotX = 0.3;
let camRotY = 0;
let camZoom = 1.5;
let w = 0,
  h = 0;
let sortedIndices: Uint32Array;
let frameCount = 0;

// --- Galaxy generation ---
function packRGBA(r: number, g: number, b: number, a: number): number {
  return ((r & 0xff) << 24) | ((g & 0xff) << 16) | ((b & 0xff) << 8) | (a & 0xff);
}

function generateGalaxy() {
  starX = new Float32Array(N);
  starY = new Float32Array(N);
  starZ = new Float32Array(N);
  starColor = new Uint32Array(N);
  starSize = new Float32Array(N);
  sortedIndices = new Uint32Array(N);

  for (let i = 0; i < N; i++) {
    sortedIndices[i] = i;
    const arm = i % armCount;
    const armAngle = (arm / armCount) * Math.PI * 2;
    const t = Math.random();
    const radius = t * 0.45 + 0.02;
    const spiralAngle = armAngle + radius * 6 + (Math.random() - 0.5) * 0.5;
    const spread = radius * 0.15;
    const dx = (Math.random() - 0.5) * spread;
    const dy = (Math.random() - 0.5) * spread * 0.15;
    const dz = (Math.random() - 0.5) * spread;

    starX[i] = 0.5 + Math.cos(spiralAngle) * radius + dx;
    starY[i] = 0.5 + dy;
    starZ[i] = 0.5 + Math.sin(spiralAngle) * radius + dz;

    const isRedGiant = Math.random() < 0.005;
    const isBlue = Math.random() < 0.3 && radius > 0.15;

    if (radius < 0.08) {
      const b = 220 + Math.random() * 35;
      starColor[i] = packRGBA(b, b * 0.95, b * 0.7, 240);
      starSize[i] = 0.5 + Math.random() * 1.5;
    } else if (isRedGiant) {
      starColor[i] = packRGBA(255, 120, 50, 255);
      starSize[i] = 2 + Math.random() * 2;
    } else if (isBlue) {
      starColor[i] = packRGBA(150, 180, 255, 200);
      starSize[i] = 0.5 + Math.random();
    } else {
      const br = 180 + Math.random() * 75;
      starColor[i] = packRGBA(br, br * 0.9, br * 0.7, 180);
      starSize[i] = 0.3 + Math.random() * 0.7;
    }
  }
}

// --- Projection ---
function _project(x: number, y: number, z: number): [number, number, number] {
  const cx = x - 0.5,
    cy = y - 0.5,
    cz = z - 0.5;
  const cosY = Math.cos(camRotY),
    sinY = Math.sin(camRotY);
  const rx = cx * cosY + cz * sinY;
  const rz = -cx * sinY + cz * cosY;
  const cosX = Math.cos(camRotX),
    sinX = Math.sin(camRotX);
  const ry = cy * cosX - rz * sinX;
  const rz2 = cy * sinX + rz * cosX;
  const fov = 2.0;
  const dist = fov / camZoom;
  const perspective = dist / (dist + rz2 + 0.5);
  const sx = w / 2 + rx * perspective * w * 0.8;
  const sy = h / 2 - ry * perspective * h * 0.8;
  return [sx, sy, rz2];
}

// --- Depth sort (runs every ~60 frames) ---
function depthSort() {
  // Compute projected z for current camera
  const depths = new Float32Array(N);
  const cosY = Math.cos(camRotY),
    sinY = Math.sin(camRotY);
  const cosX = Math.cos(camRotX),
    sinX = Math.sin(camRotX);
  for (let i = 0; i < N; i++) {
    const cx = starX[i] - 0.5,
      cy = starY[i] - 0.5,
      cz = starZ[i] - 0.5;
    const rz = -cx * sinY + cz * cosY;
    depths[i] = cy * sinX + rz * cosX;
  }
  sortedIndices.sort((a, b) => depths[a] - depths[b]);
}

// --- Render ---
function render() {
  const t0 = performance.now();

  ctx.fillStyle = "#0d0d0d";
  ctx.fillRect(0, 0, w, h);

  // Core glow
  const coreGrad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.18);
  coreGrad.addColorStop(0, "rgba(74, 60, 30, 0.18)");
  coreGrad.addColorStop(0.4, "rgba(50, 40, 20, 0.08)");
  coreGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = coreGrad;
  ctx.fillRect(0, 0, w, h);

  if (autoRotate) camRotY += 0.002;

  // Re-sort periodically
  if (frameCount % 60 === 0) depthSort();
  frameCount++;

  const imageData = ctx.getImageData(0, 0, w, h);
  const pixels = imageData.data;
  let visible = 0;
  const br = brightness;

  // Pre-compute trig outside the loop
  const cosYv = Math.cos(camRotY),
    sinYv = Math.sin(camRotY);
  const cosXv = Math.cos(camRotX),
    sinXv = Math.sin(camRotX);
  const halfW = w / 2,
    halfH = h / 2;
  const projW = w * 0.8,
    projH = h * 0.8;
  const dist = 2.0 / camZoom;

  for (let idx = 0; idx < N; idx++) {
    const i = sortedIndices[idx];
    const cx = starX[i] - 0.5,
      cy = starY[i] - 0.5,
      cz = starZ[i] - 0.5;

    // Inline projection with pre-computed trig
    const rx = cx * cosYv + cz * sinYv;
    const rz = -cx * sinYv + cz * cosYv;
    const ry = cy * cosXv - rz * sinXv;
    const rz2 = cy * sinXv + rz * cosXv;

    if (rz2 < -0.5) continue;

    const perspective = dist / (dist + rz2 + 0.5);
    const sx = halfW + rx * perspective * projW;
    const sy = halfH - ry * perspective * projH;

    if (sx < -2 || sx >= w + 2 || sy < -2 || sy >= h + 2) continue;

    const size = starSize[i] * (1 + rz2 * 0.5) * br;
    if (size < 0.15) continue;

    visible++;

    const r = (starColor[i] >> 24) & 0xff;
    const g = (starColor[i] >> 16) & 0xff;
    const b = (starColor[i] >> 8) & 0xff;
    const a = ((starColor[i] & 0xff) / 255) * br;

    if (size < 1) {
      const px = ~~sx,
        py = ~~sy;
      if (px < 0 || px >= w || py < 0 || py >= h) continue;
      const pidx = (py * w + px) * 4;
      pixels[pidx] = Math.min(255, pixels[pidx] + ~~(r * a));
      pixels[pidx + 1] = Math.min(255, pixels[pidx + 1] + ~~(g * a));
      pixels[pidx + 2] = Math.min(255, pixels[pidx + 2] + ~~(b * a));
      pixels[pidx + 3] = 255;
    } else {
      const rad = Math.min(~~Math.ceil(size), 4);
      const invRad = 1 / (rad + 0.5);
      for (let dy = -rad; dy <= rad; dy++) {
        const py = ~~sy + dy;
        if (py < 0 || py >= h) continue;
        const rowOff = py * w;
        for (let dx = -rad; dx <= rad; dx++) {
          const px = ~~sx + dx;
          if (px < 0 || px >= w) continue;
          const d2 = dx * dx + dy * dy;
          if (d2 > rad * rad) continue;
          const falloff = (1 - Math.sqrt(d2) * invRad) * a;
          const pidx = (rowOff + px) * 4;
          pixels[pidx] = Math.min(255, pixels[pidx] + ~~(r * falloff));
          pixels[pidx + 1] = Math.min(255, pixels[pidx + 1] + ~~(g * falloff));
          pixels[pidx + 2] = Math.min(255, pixels[pidx + 2] + ~~(b * falloff));
          pixels[pidx + 3] = 255;
        }
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);

  const renderMs = performance.now() - t0;
  const now = performance.now();
  const dt = now - lastFrameTime;
  lastFrameTime = now;
  smoothFps = smoothFps * 0.9 + (1000 / Math.max(1, dt)) * 0.1;

  statsEl.innerHTML =
    `Stars: <span>${N >= 1_000_000 ? "1,000,000" : (N / 1000).toFixed(0) + "K"}</span> | ` +
    `Visible: <span>${visible.toLocaleString()}</span> | ` +
    `Render: <span>${renderMs.toFixed(1)}ms</span> | ` +
    `FPS: <span>${~~smoothFps}</span>`;

  requestAnimationFrame(render);
}

// --- Resize ---
function resize() {
  const dpr = Math.min(devicePixelRatio, 1.5); // cap DPR for perf
  w = Math.floor(innerWidth * dpr);
  h = Math.floor(innerHeight * dpr);
  canvas.width = w;
  canvas.height = h;
}

// --- Mouse / touch interaction ---
let dragging = false;
let lastX = 0,
  lastY = 0;

canvas.addEventListener("mousedown", (e) => {
  dragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
});
window.addEventListener("mouseup", () => {
  dragging = false;
});
window.addEventListener("mousemove", (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  camRotY += dx * 0.005;
  camRotX += dy * 0.005;
  camRotX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camRotX));
  lastX = e.clientX;
  lastY = e.clientY;
});

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    camZoom *= e.deltaY > 0 ? 0.93 : 1.07;
    camZoom = Math.max(0.5, Math.min(5, camZoom));
  },
  { passive: false },
);

// Touch
let lastTouchDist = 0;
let lastTouchX = 0,
  lastTouchY = 0;

canvas.addEventListener(
  "touchstart",
  (e) => {
    e.preventDefault();
    if (e.touches.length === 1) {
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      lastTouchDist = Math.sqrt(dx * dx + dy * dy);
    }
  },
  { passive: false },
);

canvas.addEventListener(
  "touchmove",
  (e) => {
    e.preventDefault();
    if (e.touches.length === 1) {
      const dx = e.touches[0].clientX - lastTouchX;
      const dy = e.touches[0].clientY - lastTouchY;
      camRotY += dx * 0.005;
      camRotX += dy * 0.005;
      camRotX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camRotX));
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (lastTouchDist > 0) {
        camZoom *= dist / lastTouchDist;
        camZoom = Math.max(0.5, Math.min(5, camZoom));
      }
      lastTouchDist = dist;
    }
  },
  { passive: false },
);

// --- Controls ---
function setupButtonGroup(id: string, onChange: (v: number) => void) {
  const container = document.getElementById(id)!;
  container.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      container.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      onChange(Number(btn.dataset.v));
    });
  });
}

setupButtonGroup("countBtns", (v) => {
  N = v;
  generateGalaxy();
});
setupButtonGroup("armBtns", (v) => {
  armCount = v;
  generateGalaxy();
});
setupButtonGroup("rotateBtns", (v) => {
  autoRotate = v === 1;
});

document.getElementById("brightnessSlider")!.addEventListener("input", (e) => {
  brightness = Number((e.target as HTMLInputElement).value);
});

window.addEventListener("resize", resize);

// --- FPS tracking ---
let lastFrameTime = performance.now();
let smoothFps = 30;

// --- Init ---
resize();
generateGalaxy();
depthSort();
requestAnimationFrame(render);
