// Volume Raymarcher — Canvas 2D volumetric renderer

const canvas = document.getElementById("c") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

// --- State ---
let volumeSize = 32;
let maxSteps = 64;
let renderScale = 0.5;
let autoRotate = true;
let transferMode: "emission" | "absorption" | "mip" = "emission";
let rotationY = 0;
let rotationX = 0.3;
let volume = generateVolume(volumeSize);

// Mouse drag state
let dragging = false;
let lastMX = 0,
  lastMY = 0;

// Offscreen canvas for half-res rendering
let offCanvas: HTMLCanvasElement;
let offCtx: CanvasRenderingContext2D;

// --- Volume Generation ---
function generateVolume(size: number): Float32Array {
  const data = new Float32Array(size * size * size);
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const cx = x / size - 0.5,
          cy = y / size - 0.5,
          cz = z / size - 0.5;
        let d = 0;
        d += Math.exp(-(cx * cx + cy * cy + cz * cz) * 20);
        d += Math.exp(-((cx - 0.2) ** 2 + (cy + 0.1) ** 2 + (cz - 0.15) ** 2) * 30) * 0.7;
        d += Math.exp(-((cx + 0.15) ** 2 + (cy - 0.2) ** 2 + (cz + 0.1) ** 2) * 25) * 0.5;
        d += Math.sin(x * 1.5) * Math.cos(y * 1.3) * Math.sin(z * 1.7) * 0.1;
        data[z * size * size + y * size + x] = Math.max(0, d);
      }
    }
  }
  return data;
}

// --- Trilinear Sampling ---
function sampleVolume(vol: Float32Array, size: number, px: number, py: number, pz: number): number {
  // Map from world [-0.5, 0.5] to voxel [0, size-1]
  const vx = (px + 0.5) * size - 0.5;
  const vy = (py + 0.5) * size - 0.5;
  const vz = (pz + 0.5) * size - 0.5;
  if (vx < 0 || vy < 0 || vz < 0 || vx >= size - 1 || vy >= size - 1 || vz >= size - 1) return 0;

  const x0 = vx | 0,
    y0 = vy | 0,
    z0 = vz | 0;
  const x1 = x0 + 1,
    y1 = y0 + 1,
    z1 = z0 + 1;
  const fx = vx - x0,
    fy = vy - y0,
    fz = vz - z0;
  const s = size,
    s2 = s * s;

  const c000 = vol[z0 * s2 + y0 * s + x0],
    c100 = vol[z0 * s2 + y0 * s + x1];
  const c010 = vol[z0 * s2 + y1 * s + x0],
    c110 = vol[z0 * s2 + y1 * s + x1];
  const c001 = vol[z1 * s2 + y0 * s + x0],
    c101 = vol[z1 * s2 + y0 * s + x1];
  const c011 = vol[z1 * s2 + y1 * s + x0],
    c111 = vol[z1 * s2 + y1 * s + x1];

  const ix = 1 - fx,
    iy = 1 - fy,
    iz = 1 - fz;
  return (
    (c000 * ix + c100 * fx) * iy * iz +
    (c010 * ix + c110 * fx) * fy * iz +
    (c001 * ix + c101 * fx) * iy * fz +
    (c011 * ix + c111 * fx) * fy * fz
  );
}

// --- Raymarching ---
function raymarch(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  vol: Float32Array,
  size: number,
  steps: number,
  mode: string,
): [number, number, number, number] {
  const stepSize = 1.5 / steps;
  let t = 0;
  let aR = 0,
    aG = 0,
    aB = 0,
    aA = 0;
  let mipMax = 0;

  // Ray-box intersection for [-0.5, 0.5]^3
  let tmin = -1e9,
    tmax = 1e9;
  for (let i = 0; i < 3; i++) {
    const o = i === 0 ? ox : i === 1 ? oy : oz;
    const d = i === 0 ? dx : i === 1 ? dy : dz;
    if (Math.abs(d) < 1e-8) {
      if (o < -0.5 || o > 0.5) return [0, 0, 0, 0];
    } else {
      let t1 = (-0.5 - o) / d,
        t2 = (0.5 - o) / d;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
    }
  }
  if (tmin > tmax || tmax < 0) return [0, 0, 0, 0];
  t = Math.max(tmin, 0);

  const endT = tmax;
  const gradEps = 0.5 / size;

  for (let i = 0; i < steps && t < endT; i++) {
    const px = ox + dx * t;
    const py = oy + dy * t;
    const pz = oz + dz * t;
    const density = sampleVolume(vol, size, px, py, pz);

    if (mode === "mip") {
      mipMax = Math.max(mipMax, density);
      t += stepSize;
      continue;
    }

    if (density > 0.01) {
      // Transfer function: cool blue -> warm white/yellow
      const d2 = density * density;
      const r = density * 0.3 + d2 * 0.7;
      const g = density * 0.5 + d2 * 0.3;
      const b = density * 0.8 + d2 * 0.1;

      if (mode === "emission") {
        // Gradient-based normals for diffuse lighting
        const nx =
          sampleVolume(vol, size, px + gradEps, py, pz) -
          sampleVolume(vol, size, px - gradEps, py, pz);
        const ny =
          sampleVolume(vol, size, px, py + gradEps, pz) -
          sampleVolume(vol, size, px, py - gradEps, pz);
        const nz =
          sampleVolume(vol, size, px, py, pz + gradEps) -
          sampleVolume(vol, size, px, py, pz - gradEps);
        const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) + 0.001;
        // Light direction (normalized [0.5, 0.7, -0.5])
        const diffuse =
          Math.max(0, (nx / nl) * 0.5 + (ny / nl) * 0.7 + (nz / nl) * -0.5) * 0.6 + 0.4;

        const alpha = density * stepSize * 8;
        aR += (1 - aA) * r * diffuse * alpha;
        aG += (1 - aA) * g * diffuse * alpha;
        aB += (1 - aA) * b * diffuse * alpha;
        aA += (1 - aA) * alpha;
        if (aA > 0.98) break;
      } else {
        // absorption
        const alpha = density * stepSize * 6;
        const transmit = 1 - aA;
        aR += transmit * r * alpha * 0.5;
        aG += transmit * g * alpha * 0.5;
        aB += transmit * b * alpha * 0.5;
        aA += transmit * alpha;
        if (aA > 0.98) break;
      }
    }
    t += stepSize;
  }

  if (mode === "mip") {
    const v = Math.min(1, mipMax);
    return [v * 0.4 + v * v * 0.6, v * 0.6 + v * v * 0.2, v * 0.9, v > 0.01 ? 1 : 0];
  }
  return [aR, aG, aB, aA];
}

// --- Camera ---
function getCameraRay(px: number, py: number, w: number, h: number) {
  const aspect = w / h;
  const fov = Math.PI / 4;
  const tanHalf = Math.tan(fov / 2);
  const ndcX = (px / w - 0.5) * 2 * aspect * tanHalf;
  const ndcY = (0.5 - py / h) * 2 * tanHalf;

  const cosY = Math.cos(rotationY),
    sinY = Math.sin(rotationY);
  const cosX = Math.cos(rotationX),
    sinX = Math.sin(rotationX);
  const dist = 2.5;

  // Camera position: orbit around origin
  const originX = sinY * cosX * dist;
  const originY = sinX * dist;
  const originZ = cosY * cosX * dist;

  // Camera basis vectors (look-at origin)
  const fwdX = -originX / dist,
    fwdY = -originY / dist,
    fwdZ = -originZ / dist;
  // Right = cross(fwd, up) where up = (0,1,0)
  const rLen = Math.sqrt(fwdZ * fwdZ + fwdX * fwdX) || 0.001;
  const rightX = fwdZ / rLen,
    rightZ = -fwdX / rLen;
  // True up = cross(right, fwd)
  const upX = -rightZ * fwdY;
  const upY = rightZ * fwdX - rightX * fwdZ;
  const upZ = rightX * fwdY;

  let dirX = fwdX + ndcX * rightX + ndcY * upX;
  let dirY = fwdY + ndcY * upY;
  let dirZ = fwdZ + ndcX * rightZ + ndcY * upZ;
  const len = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ);
  dirX /= len;
  dirY /= len;
  dirZ /= len;

  return { originX, originY, originZ, dirX, dirY, dirZ };
}

// --- Resize ---
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  setupOffscreen();
}

function setupOffscreen() {
  offCanvas = document.createElement("canvas");
  offCanvas.width = Math.floor(canvas.width * renderScale);
  offCanvas.height = Math.floor(canvas.height * renderScale);
  offCtx = offCanvas.getContext("2d")!;
}

// --- Render ---
function render() {
  const rw = offCanvas.width,
    rh = offCanvas.height;
  const imageData = offCtx.createImageData(rw, rh);
  const buf = imageData.data;

  if (autoRotate) rotationY += 0.008;

  for (let py = 0; py < rh; py++) {
    for (let px = 0; px < rw; px++) {
      const ray = getCameraRay(px, py, rw, rh);
      const [r, g, b, a] = raymarch(
        ray.originX,
        ray.originY,
        ray.originZ,
        ray.dirX,
        ray.dirY,
        ray.dirZ,
        volume,
        volumeSize,
        maxSteps,
        transferMode,
      );

      const idx = (py * rw + px) * 4;
      // Vignette: darken edges slightly
      const uvx = px / rw - 0.5,
        uvy = py / rh - 0.5;
      const vig = 1 - (uvx * uvx + uvy * uvy) * 0.6;
      const bgR = 19 * vig,
        bgG = 19 * vig,
        bgB = 19 * vig;

      buf[idx] = Math.min(255, (r * 255 * a + bgR * (1 - a)) | 0);
      buf[idx + 1] = Math.min(255, (g * 255 * a + bgG * (1 - a)) | 0);
      buf[idx + 2] = Math.min(255, (b * 255 * a + bgB * (1 - a)) | 0);
      buf[idx + 3] = 255;
    }
  }

  offCtx.putImageData(imageData, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(offCanvas, 0, 0, canvas.width, canvas.height);
}

// --- Animation Loop ---
function loop() {
  const t0 = performance.now();
  render();
  const ms = (performance.now() - t0) | 0;
  document.getElementById("sTime")!.textContent = String(ms);
  requestAnimationFrame(loop);
}

// --- Controls ---
function initControls() {
  const volSel = document.getElementById("volSize") as HTMLSelectElement;
  const stepsSel = document.getElementById("steps") as HTMLSelectElement;
  const scaleSel = document.getElementById("scale") as HTMLSelectElement;
  const transferSel = document.getElementById("transfer") as HTMLSelectElement;
  const rotateBtn = document.getElementById("autoRotate") as HTMLButtonElement;

  volSel.addEventListener("change", () => {
    volumeSize = parseInt(volSel.value);
    volume = generateVolume(volumeSize);
    document.getElementById("sVol")!.innerHTML = volSel.value + "&sup3;";
  });
  stepsSel.addEventListener("change", () => {
    maxSteps = parseInt(stepsSel.value);
    document.getElementById("sSteps")!.textContent = stepsSel.value;
  });
  scaleSel.addEventListener("change", () => {
    renderScale = parseFloat(scaleSel.value);
    setupOffscreen();
    document.getElementById("sScale")!.textContent = scaleSel.value + "x";
  });
  transferSel.addEventListener("change", () => {
    transferMode = transferSel.value as typeof transferMode;
  });
  rotateBtn.addEventListener("click", () => {
    autoRotate = !autoRotate;
    rotateBtn.textContent = autoRotate ? "On" : "Off";
    rotateBtn.classList.toggle("active", autoRotate);
  });
}

// --- Mouse Drag ---
function initMouse() {
  canvas.addEventListener("mousedown", (e) => {
    dragging = true;
    lastMX = e.clientX;
    lastMY = e.clientY;
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastMX,
      dy = e.clientY - lastMY;
    rotationY += dx * 0.006;
    rotationX = Math.max(-1.2, Math.min(1.2, rotationX + dy * 0.006));
    lastMX = e.clientX;
    lastMY = e.clientY;
  });
  window.addEventListener("mouseup", () => {
    dragging = false;
  });
}

// --- Init ---
resize();
window.addEventListener("resize", resize);
initControls();
initMouse();
loop();
