// GPU Particle System — WebGPU compute + render, Canvas 2D fallback

const PARTICLE_STRIDE = 8; // floats per particle: x,y,vx,vy,life,color_u32_as_f32,pad,pad
const _PARTICLE_BYTES = PARTICLE_STRIDE * 4;

// ── DOM refs ──
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const elFps = document.getElementById("fps")!;
const elAlive = document.getElementById("alive")!;
const elTotal = document.getElementById("total")!;
const elComputeMs = document.getElementById("computeMs")!;
const elRenderMs = document.getElementById("renderMs")!;
const elBackend = document.getElementById("backend")!;
const selCount = document.getElementById("countSelect") as HTMLSelectElement;
const sliderGravity = document.getElementById("gravity") as HTMLInputElement;
const sliderSpawn = document.getElementById("spawnRate") as HTMLInputElement;
const btnReset = document.getElementById("reset") as HTMLButtonElement;

let mouseX = 0.5,
  mouseY = 0.5,
  mouseActive = false;
canvas.addEventListener("mousemove", (e) => {
  mouseX = e.clientX / canvas.width;
  mouseY = e.clientY / canvas.height;
  mouseActive = true;
});
canvas.addEventListener("mouseleave", () => {
  mouseActive = false;
});

function resize() {
  canvas.width = window.innerWidth * devicePixelRatio;
  canvas.height = window.innerHeight * devicePixelRatio;
  canvas.style.width = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";
}
window.addEventListener("resize", resize);
resize();

// ── Helpers ──
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function packColor(r: number, g: number, b: number, a: number): number {
  return ((r & 0xff) << 24) | ((g & 0xff) << 16) | ((b & 0xff) << 8) | (a & 0xff);
}

// ── WGSL Shaders ──
const COMPUTE_SHADER = /* wgsl */ `
struct Particle {
  x: f32, y: f32,
  vx: f32, vy: f32,
  life: f32,
  color: u32,
  _pad1: f32,
  _pad2: f32,
}

struct Params {
  dt: f32,
  gravity: f32,
  mouse_x: f32,
  mouse_y: f32,
  mouse_active: u32,
  spawn_rate: u32,
  particle_count: u32,
  time: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(2) var<storage, read_write> alive_count: atomic<u32>;

@compute @workgroup_size(256)
fn update(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.particle_count) { return; }

  var p = particles[i];
  if (p.life <= 0.0) { return; }

  p.vy += params.gravity * params.dt;

  if (params.mouse_active == 1u) {
    let dx = params.mouse_x - p.x;
    let dy = params.mouse_y - p.y;
    let dist = max(sqrt(dx * dx + dy * dy), 0.01);
    let force = 0.5 / (dist * dist);
    p.vx += dx / dist * force * params.dt;
    p.vy += dy / dist * force * params.dt;
  }

  p.vx *= 0.999;
  p.vy *= 0.999;
  p.x += p.vx * params.dt;
  p.y += p.vy * params.dt;

  if (p.x < 0.0 || p.x > 1.0) { p.vx *= -0.7; p.x = clamp(p.x, 0.0, 1.0); }
  if (p.y < 0.0 || p.y > 1.0) { p.vy *= -0.7; p.y = clamp(p.y, 0.0, 1.0); }

  p.life -= params.dt * 0.08;

  if (p.life > 0.0) {
    atomicAdd(&alive_count, 1u);
  }

  particles[i] = p;
}
`;

const RENDER_SHADER = /* wgsl */ `
struct Particle {
  x: f32, y: f32,
  vx: f32, vy: f32,
  life: f32,
  color: u32,
  _pad1: f32,
  _pad2: f32,
}

@group(0) @binding(0) var<storage, read> particles: array<Particle>;

struct VertexOutput {
  @builtin(position) pos: vec4<f32>,
  @location(0) color: vec4<f32>,
}

@vertex
fn vs(@builtin(vertex_index) vid: u32) -> VertexOutput {
  let p = particles[vid];
  var out: VertexOutput;
  out.pos = vec4(p.x * 2.0 - 1.0, -(p.y * 2.0 - 1.0), 0.0, 1.0);
  let r = f32((p.color >> 24u) & 0xFFu) / 255.0;
  let g = f32((p.color >> 16u) & 0xFFu) / 255.0;
  let b = f32((p.color >> 8u) & 0xFFu) / 255.0;
  let a = p.life * 0.8;
  out.color = vec4(r, g, b, select(0.0, a, p.life > 0.0));
  return out;
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4<f32> {
  if (in.color.a < 0.01) { discard; }
  return in.color;
}
`;

// ── WebGPU Backend ──
async function initWebGPU() {
  if (!navigator.gpu) return null;
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return null;
  const device = await adapter.requestDevice({
    requiredLimits: { maxStorageBufferBindingSize: 512 * 1024 * 1024 },
  });
  const ctx = canvas.getContext("webgpu");
  if (!ctx) return null;
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: "opaque" });
  return { device, ctx, format };
}

async function runWebGPU() {
  const gpu = await initWebGPU();
  if (!gpu) return false;
  const { device, ctx, format } = gpu;
  elBackend.textContent = "webgpu";

  let particleCount = parseInt(selCount.value);
  let particleData = new Float32Array(particleCount * PARTICLE_STRIDE);
  let needsRebuild = false;

  function buildBuffers() {
    const particleBuf = device.createBuffer({
      size: particleData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(particleBuf, 0, particleData);
    const aliveCountBuf = device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    const aliveReadBuf = device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const paramsBuf = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    return { particleBuf, aliveCountBuf, aliveReadBuf, paramsBuf };
  }

  // Compute pipeline
  const computeModule = device.createShaderModule({ code: COMPUTE_SHADER });
  const computePipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module: computeModule, entryPoint: "update" },
  });

  // Render pipeline
  const renderModule = device.createShaderModule({ code: RENDER_SHADER });
  const renderPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: renderModule, entryPoint: "vs" },
    fragment: {
      module: renderModule,
      entryPoint: "fs",
      targets: [
        {
          format,
          blend: {
            color: { srcFactor: "src-alpha", dstFactor: "one", operation: "add" },
            alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
          },
        },
      ],
    },
    primitive: { topology: "point-list" },
  });

  let bufs = buildBuffers();
  let aliveDisplay = 0;

  function rebuildAll() {
    particleCount = parseInt(selCount.value);
    particleData = new Float32Array(particleCount * PARTICLE_STRIDE);
    bufs = buildBuffers();
    needsRebuild = false;
  }

  selCount.addEventListener("change", () => {
    needsRebuild = true;
  });
  btnReset.addEventListener("click", () => {
    needsRebuild = true;
  });

  // Spawn helper (CPU-side, writes into particleData then uploads)
  function spawnParticles(count: number, cx: number, cy: number, time: number) {
    let spawned = 0;
    for (let i = 0; i < particleCount && spawned < count; i++) {
      const off = i * PARTICLE_STRIDE;
      if (particleData[off + 4] <= 0) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.1 + Math.random() * 0.4;
        particleData[off + 0] = cx + (Math.random() - 0.5) * 0.01;
        particleData[off + 1] = cy + (Math.random() - 0.5) * 0.01;
        particleData[off + 2] = Math.cos(angle) * speed;
        particleData[off + 3] = Math.sin(angle) * speed - 0.1;
        particleData[off + 4] = 1.0;
        const hue = ((angle / (Math.PI * 2)) * 360 + time * 40) % 360;
        const [r, g, b] = hslToRgb(hue, 0.9, 0.6);
        const view = new DataView(particleData.buffer);
        view.setUint32((off + 5) * 4, packColor(r, g, b, 255), false);
        spawned++;
      }
    }
  }

  let lastTime = performance.now();
  let fpsFrames = 0,
    fpsAccum = 0;
  let simTime = 0;

  function frame() {
    if (needsRebuild) rebuildAll();

    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    simTime += dt;

    // FPS
    fpsFrames++;
    fpsAccum += dt;
    if (fpsAccum >= 0.5) {
      elFps.textContent = Math.round(fpsFrames / fpsAccum).toString();
      fpsFrames = 0;
      fpsAccum = 0;
    }

    const gravity = parseFloat(sliderGravity.value);
    const spawnRate = parseInt(sliderSpawn.value);
    const cx = mouseActive ? mouseX : 0.5;
    const cy = mouseActive ? mouseY : 0.3;

    spawnParticles(Math.ceil(spawnRate * dt), cx, cy, simTime);

    // Upload particle data
    device.queue.writeBuffer(bufs.particleBuf, 0, particleData);

    // Reset alive counter
    device.queue.writeBuffer(bufs.aliveCountBuf, 0, new Uint32Array([0]));

    // Upload params
    const paramsData = new ArrayBuffer(32);
    const pf = new Float32Array(paramsData);
    const pu = new Uint32Array(paramsData);
    pf[0] = dt;
    pf[1] = gravity;
    pf[2] = mouseX;
    pf[3] = mouseY;
    pu[4] = mouseActive ? 1 : 0;
    pu[5] = spawnRate;
    pu[6] = particleCount;
    pf[7] = simTime;
    device.queue.writeBuffer(bufs.paramsBuf, 0, paramsData);

    const computeBG = device.createBindGroup({
      layout: computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: bufs.paramsBuf } },
        { binding: 1, resource: { buffer: bufs.particleBuf } },
        { binding: 2, resource: { buffer: bufs.aliveCountBuf } },
      ],
    });

    const renderBG = device.createBindGroup({
      layout: renderPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: bufs.particleBuf } }],
    });

    const computeStart = performance.now();

    const encoder = device.createCommandEncoder();

    // Compute pass
    const cp = encoder.beginComputePass();
    cp.setPipeline(computePipeline);
    cp.setBindGroup(0, computeBG);
    cp.dispatchWorkgroups(Math.ceil(particleCount / 256));
    cp.end();

    // Copy alive count for readback
    encoder.copyBufferToBuffer(bufs.aliveCountBuf, 0, bufs.aliveReadBuf, 0, 4);

    const computeEnd = performance.now();

    // Render pass
    const textureView = ctx.getCurrentTexture().createView();
    const renderStart = performance.now();
    const rp = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0.075, g: 0.075, b: 0.075, a: 1 },
          loadOp: "clear" as GPULoadOp,
          storeOp: "store" as GPUStoreOp,
        },
      ],
    });
    rp.setPipeline(renderPipeline);
    rp.setBindGroup(0, renderBG);
    rp.draw(particleCount);
    rp.end();

    device.queue.submit([encoder.finish()]);
    const renderEnd = performance.now();

    // Read alive count (async, best effort)
    if (bufs.aliveReadBuf.mapState === "unmapped") {
      bufs.aliveReadBuf
        .mapAsync(GPUMapMode.READ)
        .then(() => {
          const data = new Uint32Array(bufs.aliveReadBuf.getMappedRange());
          aliveDisplay = data[0];
          bufs.aliveReadBuf.unmap();
        })
        .catch(() => {});
    }

    // Read back particles for CPU-side spawn tracking
    // We track life on CPU side too — update from GPU would be ideal but adds latency.
    // For spawn, we decrease life on CPU side in parallel:
    for (let i = 0; i < particleCount; i++) {
      const off = i * PARTICLE_STRIDE;
      if (particleData[off + 4] > 0) {
        particleData[off + 4] -= dt * 0.3;
        if (particleData[off + 4] < 0) particleData[off + 4] = 0;
      }
    }

    elAlive.textContent = aliveDisplay.toString();
    elTotal.textContent = particleCount.toString();
    elComputeMs.textContent = (computeEnd - computeStart).toFixed(1);
    elRenderMs.textContent = (renderEnd - renderStart).toFixed(1);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
  return true;
}

// ── Canvas 2D Fallback ──
function runCanvas2D() {
  elBackend.textContent = "canvas-fallback";
  const ctx2d = canvas.getContext("2d")!;

  let particleCount = parseInt(selCount.value);
  // Flat arrays: x, y, vx, vy, life, r, g, b
  let px: Float32Array, py: Float32Array, pvx: Float32Array, pvy: Float32Array;
  let plife: Float32Array, pr: Uint8Array, pg: Uint8Array, pb: Uint8Array;

  function alloc() {
    px = new Float32Array(particleCount);
    py = new Float32Array(particleCount);
    pvx = new Float32Array(particleCount);
    pvy = new Float32Array(particleCount);
    plife = new Float32Array(particleCount);
    pr = new Uint8Array(particleCount);
    pg = new Uint8Array(particleCount);
    pb = new Uint8Array(particleCount);
  }
  alloc();

  let needsRebuild = false;
  selCount.addEventListener("change", () => {
    needsRebuild = true;
  });
  btnReset.addEventListener("click", () => {
    needsRebuild = true;
  });

  let lastTime = performance.now();
  let fpsFrames = 0,
    fpsAccum = 0;
  let simTime = 0;

  function frame() {
    if (needsRebuild) {
      particleCount = parseInt(selCount.value);
      alloc();
      needsRebuild = false;
    }

    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    simTime += dt;

    fpsFrames++;
    fpsAccum += dt;
    if (fpsAccum >= 0.5) {
      elFps.textContent = Math.round(fpsFrames / fpsAccum).toString();
      fpsFrames = 0;
      fpsAccum = 0;
    }

    const gravity = parseFloat(sliderGravity.value);
    const spawnRate = parseInt(sliderSpawn.value);
    const cx = mouseActive ? mouseX : 0.5;
    const cy = mouseActive ? mouseY : 0.3;

    // Spawn
    let toSpawn = Math.ceil(spawnRate * dt);
    for (let i = 0; i < particleCount && toSpawn > 0; i++) {
      if (plife[i] <= 0) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.1 + Math.random() * 0.4;
        px[i] = cx + (Math.random() - 0.5) * 0.01;
        py[i] = cy + (Math.random() - 0.5) * 0.01;
        pvx[i] = Math.cos(angle) * speed;
        pvy[i] = Math.sin(angle) * speed - 0.1;
        plife[i] = 1.0;
        const hue = ((angle / (Math.PI * 2)) * 360 + simTime * 40) % 360;
        const [r, g, b] = hslToRgb(hue, 0.9, 0.6);
        pr[i] = r;
        pg[i] = g;
        pb[i] = b;
        toSpawn--;
      }
    }

    const computeStart = performance.now();
    let alive = 0;
    for (let i = 0; i < particleCount; i++) {
      if (plife[i] <= 0) continue;
      pvy[i] += gravity * dt;
      if (mouseActive) {
        const dx = mouseX - px[i],
          dy = mouseY - py[i];
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
        const force = 0.5 / (dist * dist);
        pvx[i] += (dx / dist) * force * dt;
        pvy[i] += (dy / dist) * force * dt;
      }
      pvx[i] *= 0.999;
      pvy[i] *= 0.999;
      px[i] += pvx[i] * dt;
      py[i] += pvy[i] * dt;
      if (px[i] < 0 || px[i] > 1) {
        pvx[i] *= -0.7;
        px[i] = Math.max(0, Math.min(1, px[i]));
      }
      if (py[i] < 0 || py[i] > 1) {
        pvy[i] *= -0.7;
        py[i] = Math.max(0, Math.min(1, py[i]));
      }
      plife[i] -= dt * 0.08;
      if (plife[i] > 0) alive++;
    }
    const computeEnd = performance.now();

    // Render
    const renderStart = performance.now();
    const w = canvas.width,
      h = canvas.height;
    ctx2d.fillStyle = "#131313";
    ctx2d.fillRect(0, 0, w, h);
    // Glow pass: larger, blurred particles
    ctx2d.globalCompositeOperation = "lighter";
    ctx2d.filter = "blur(3px)";
    for (let i = 0; i < particleCount; i++) {
      if (plife[i] <= 0) continue;
      const alpha = plife[i] * 0.4;
      ctx2d.fillStyle = `rgba(${pr[i]},${pg[i]},${pb[i]},${alpha.toFixed(3)})`;
      const sx = px[i] * w,
        sy = py[i] * h;
      ctx2d.fillRect(sx - 3, sy - 3, 6, 6);
    }
    ctx2d.filter = "none";
    // Core pass: bright small dots
    for (let i = 0; i < particleCount; i++) {
      if (plife[i] <= 0) continue;
      const alpha = Math.min(1, plife[i] * 1.2);
      ctx2d.fillStyle = `rgba(${Math.min(255, pr[i] + 80)},${Math.min(255, pg[i] + 80)},${Math.min(255, pb[i] + 80)},${alpha.toFixed(3)})`;
      ctx2d.fillRect(px[i] * w - 1, py[i] * h - 1, 3, 3);
    }
    ctx2d.globalCompositeOperation = "source-over";
    const renderEnd = performance.now();

    elAlive.textContent = alive.toString();
    elTotal.textContent = particleCount.toString();
    elComputeMs.textContent = (computeEnd - computeStart).toFixed(1);
    elRenderMs.textContent = (renderEnd - renderStart).toFixed(1);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// ── Entry ──
(async () => {
  const ok = await runWebGPU();
  if (!ok) runCanvas2D();
})();
