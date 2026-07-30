// Flow Field Visualization — Canvas 2D particle system with velocity field
// 50K+ particles streaming through a mouse-interactive wind map

// --- Constants ---
const FIELD_W = 64;
const FIELD_H = 64;
const NUM_COLOR_BUCKETS = 8;

// --- State ---
let particleCount = 50_000;
let flowSpeedMul = 1.0;
let complexity = 2.0;
let attractMode = true; // true = attract, false = repel

// Normalized mouse position [0..1]
let mouseX = 0.5;
let mouseY = 0.5;
let mouseActive = false;

// Velocity field (flat arrays for performance)
const fieldX = new Float32Array(FIELD_W * FIELD_H);
const fieldY = new Float32Array(FIELD_W * FIELD_H);

// Particle storage (struct-of-arrays for cache performance)
let px: Float32Array; // x position [0..1]
let py: Float32Array; // y position [0..1]
let pvx: Float32Array; // velocity x
let pvy: Float32Array; // velocity y
let ppx: Float32Array; // previous x
let ppy: Float32Array; // previous y
let plife: Float32Array; // remaining life (seconds)
let pspeed: Float32Array; // cached speed magnitude

// --- Canvas setup ---
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d", { alpha: false })!;
let w = 0,
  h = 0;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  w = window.innerWidth;
  h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Fill black on resize to avoid artifacts
  ctx.fillStyle = "#131313";
  ctx.fillRect(0, 0, w, h);
}

// --- Particle initialization ---
function initParticles(count: number) {
  particleCount = count;
  px = new Float32Array(count);
  py = new Float32Array(count);
  pvx = new Float32Array(count);
  pvy = new Float32Array(count);
  ppx = new Float32Array(count);
  ppy = new Float32Array(count);
  plife = new Float32Array(count);
  pspeed = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    spawnParticle(i);
  }
}

function spawnParticle(i: number) {
  px[i] = Math.random();
  py[i] = Math.random();
  pvx[i] = 0;
  pvy[i] = 0;
  ppx[i] = px[i];
  ppy[i] = py[i];
  plife[i] = 2 + Math.random() * 3;
  pspeed[i] = 0;
}

// --- Velocity field update ---
function updateField(time: number) {
  const c1 = complexity * 3.14;
  const c2 = complexity * 2.0;
  const t1 = time * 0.3 * flowSpeedMul;
  const t2 = time * 0.2 * flowSpeedMul;
  const t3 = time * 0.4 * flowSpeedMul;
  const t4 = time * 0.1 * flowSpeedMul;
  const t5 = time * 0.15 * flowSpeedMul;

  const mSign = attractMode ? 1.0 : -1.0;

  for (let gy = 0; gy < FIELD_H; gy++) {
    const cyBase = (gy + 0.5) / FIELD_H;
    for (let gx = 0; gx < FIELD_W; gx++) {
      const idx = gy * FIELD_W + gx;
      const cx = (gx + 0.5) / FIELD_W;
      const cy = cyBase;

      // Multi-octave harmonic flow (cheap approximation of Perlin noise)
      let vx = Math.sin(cx * c1 * 2 + t1) * Math.cos(cy * c2 * 2 + t2);
      let vy = Math.cos(cx * c2 * 2 - t3) * Math.sin(cy * c1 * 2 + t4);

      // Second octave for more organic feel
      vx += 0.5 * Math.sin(cx * c1 * 4 + cy * c2 * 3 + t5);
      vy += 0.5 * Math.cos(cy * c1 * 4 - cx * c2 * 3 + t1 * 0.7);

      // Third octave (finer detail)
      vx += 0.25 * Math.sin(cx * c1 * 8 + t3 * 1.3);
      vy += 0.25 * Math.cos(cy * c1 * 8 - t2 * 1.1);

      // Mouse influence
      if (mouseActive) {
        const dx = mouseX - cx;
        const dy = mouseY - cy;
        const distSq = dx * dx + dy * dy;
        if (distSq > 0.0001 && distSq < 0.16) {
          const dist = Math.sqrt(distSq);
          const force = (mSign * 0.4) / (distSq + 0.04);
          vx += (dx / dist) * force;
          vy += (dy / dist) * force;
        }
      }

      fieldX[idx] = vx;
      fieldY[idx] = vy;
    }
  }
}

// --- Particle simulation ---
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function updateParticles(dt: number) {
  const dtScaled = dt * 0.01 * flowSpeedMul;
  const decay = 0.001 * dt;
  const blend = 0.06;
  const blendInv = 1.0 - blend;

  for (let i = 0; i < particleCount; i++) {
    // Store previous position for trail drawing
    ppx[i] = px[i];
    ppy[i] = py[i];

    // Sample velocity field (nearest neighbor for speed)
    const gx = clamp(Math.floor(px[i] * FIELD_W), 0, FIELD_W - 1);
    const gy = clamp(Math.floor(py[i] * FIELD_H), 0, FIELD_H - 1);
    const idx = gy * FIELD_W + gx;

    // Smooth velocity blending
    pvx[i] = pvx[i] * blendInv + fieldX[idx] * blend;
    pvy[i] = pvy[i] * blendInv + fieldY[idx] * blend;

    // Integrate position
    px[i] += pvx[i] * dtScaled;
    py[i] += pvy[i] * dtScaled;

    // Cache speed
    pspeed[i] = Math.sqrt(pvx[i] * pvx[i] + pvy[i] * pvy[i]);

    // Decay life
    plife[i] -= decay;

    // Respawn if dead or out of bounds
    if (plife[i] <= 0 || px[i] < 0 || px[i] > 1 || py[i] < 0 || py[i] > 1) {
      spawnParticle(i);
    }
  }
}

// --- Rendering ---
// Precompute color bucket styles for batched rendering
function getColorForBucket(bucket: number, totalBuckets: number): string {
  const t = bucket / (totalBuckets - 1);
  // Deep blue (#1a1a4e) -> Cyan (#4a7fd4) -> White (#e5e2e1)
  let r: number, g: number, b: number;
  if (t < 0.5) {
    const s = t * 2;
    r = Math.floor(26 + s * (74 - 26));
    g = Math.floor(26 + s * (127 - 26));
    b = Math.floor(78 + s * (212 - 78));
  } else {
    const s = (t - 0.5) * 2;
    r = Math.floor(74 + s * (229 - 74));
    g = Math.floor(127 + s * (226 - 127));
    b = Math.floor(212 + s * (225 - 212));
  }
  return `rgb(${r},${g},${b})`;
}

const bucketColors: string[] = [];
const bucketWidths: number[] = [];
for (let b = 0; b < NUM_COLOR_BUCKETS; b++) {
  bucketColors.push(getColorForBucket(b, NUM_COLOR_BUCKETS));
  const t = b / (NUM_COLOR_BUCKETS - 1);
  bucketWidths.push(0.5 + t * 1.5);
}

function render() {
  // Trail fade effect: semi-transparent dark overlay
  ctx.fillStyle = "rgba(19, 19, 19, 0.035)";
  ctx.fillRect(0, 0, w, h);

  // Batch particles by speed bucket — one beginPath/stroke per bucket
  const maxSpeed = 3.5;

  for (let b = 0; b < NUM_COLOR_BUCKETS; b++) {
    ctx.strokeStyle = bucketColors[b];
    ctx.lineWidth = bucketWidths[b];
    ctx.globalAlpha = 0.6;
    ctx.beginPath();

    let hasSegments = false;

    for (let i = 0; i < particleCount; i++) {
      // Determine bucket
      const speed = Math.min(1.0, pspeed[i] / maxSpeed);
      const bucket = Math.min(NUM_COLOR_BUCKETS - 1, Math.floor(speed * NUM_COLOR_BUCKETS));
      if (bucket !== b) continue;

      // Skip if previous == current (just spawned)
      const x0 = ppx[i] * w;
      const y0 = ppy[i] * h;
      const x1 = px[i] * w;
      const y1 = py[i] * h;

      // Skip tiny segments (just spawned particles)
      const segDx = x1 - x0;
      const segDy = y1 - y0;
      if (segDx * segDx + segDy * segDy < 0.01) continue;

      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      hasSegments = true;
    }

    if (hasSegments) {
      ctx.stroke();
    }
  }

  ctx.globalAlpha = 1.0;
}

// --- FPS tracking ---
let frameCount = 0;
let lastFpsTime = 0;
let displayFps = 0;
const fpsEl = document.getElementById("fps")!;

function updateFps(now: number) {
  frameCount++;
  if (now - lastFpsTime >= 1000) {
    displayFps = Math.round((frameCount * 1000) / (now - lastFpsTime));
    fpsEl.textContent = String(displayFps);
    frameCount = 0;
    lastFpsTime = now;
  }
}

// --- Main loop ---
let lastTime = 0;
let simTime = 0;

function frame(now: number) {
  const dt = Math.min(now - lastTime, 33); // Cap at ~30fps equivalent dt
  lastTime = now;
  simTime += dt * 0.001;

  updateField(simTime);
  updateParticles(dt);
  render();
  updateFps(now);

  requestAnimationFrame(frame);
}

// --- UI wiring ---
const countSelect = document.getElementById("countSelect") as HTMLSelectElement;
const flowSpeedSlider = document.getElementById("flowSpeed") as HTMLInputElement;
const flowSpeedVal = document.getElementById("flowSpeedVal")!;
const complexitySlider = document.getElementById("complexity") as HTMLInputElement;
const complexityVal = document.getElementById("complexityVal")!;
const modeToggle = document.getElementById("modeToggle") as HTMLButtonElement;
const modeDisplay = document.getElementById("modeDisplay")!;
const resetBtn = document.getElementById("reset") as HTMLButtonElement;
const particleCountEl = document.getElementById("particleCount")!;

countSelect.addEventListener("change", () => {
  const count = parseInt(countSelect.value);
  initParticles(count);
  particleCountEl.textContent = count.toLocaleString();
  // Clear trails on particle count change
  ctx.fillStyle = "#131313";
  ctx.fillRect(0, 0, w, h);
});

flowSpeedSlider.addEventListener("input", () => {
  flowSpeedMul = parseFloat(flowSpeedSlider.value);
  flowSpeedVal.textContent = flowSpeedMul.toFixed(1) + "x";
});

complexitySlider.addEventListener("input", () => {
  complexity = parseFloat(complexitySlider.value);
  complexityVal.textContent = complexity.toFixed(1);
});

modeToggle.addEventListener("click", () => {
  attractMode = !attractMode;
  modeToggle.textContent = attractMode ? "Attract" : "Repel";
  modeToggle.classList.toggle("active", attractMode);
  modeDisplay.textContent = attractMode ? "Attract" : "Repel";
});

resetBtn.addEventListener("click", () => {
  initParticles(particleCount);
  ctx.fillStyle = "#131313";
  ctx.fillRect(0, 0, w, h);
});

// --- Mouse tracking ---
canvas.addEventListener("mousemove", (e) => {
  mouseX = e.clientX / w;
  mouseY = e.clientY / h;
  mouseActive = true;
});

canvas.addEventListener("mouseleave", () => {
  mouseActive = false;
});

canvas.addEventListener(
  "touchmove",
  (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    mouseX = touch.clientX / w;
    mouseY = touch.clientY / h;
    mouseActive = true;
  },
  { passive: false },
);

canvas.addEventListener("touchend", () => {
  mouseActive = false;
});

// --- Resize handling ---
window.addEventListener("resize", resize);

// --- Boot ---
resize();
initParticles(particleCount);
lastTime = performance.now();
lastFpsTime = lastTime;
requestAnimationFrame(frame);
