import { bin2d } from "@vizcrush/bin";

const $ = (id: string) => document.getElementById(id)!;
const gpuCanvas = $("gpu-canvas") as HTMLCanvasElement;
const canvas2d = $("canvas-2d") as HTMLCanvasElement;
const pointCountSel = $("point-count") as HTMLSelectElement;
const gridResSel = $("grid-res") as HTMLSelectElement;
const animToggle = $("anim-toggle") as HTMLButtonElement;
const runBtn = $("run-btn") as HTMLButtonElement;

let animating = false,
  running = false,
  gpuReady = false;

// ── Viridis colormap (JS) ──
const VIRIDIS = [
  [68, 1, 84],
  [72, 36, 117],
  [65, 68, 135],
  [42, 120, 142],
  [34, 168, 132],
  [122, 209, 81],
  [253, 231, 37],
];

function viridisCSS(t: number): string {
  const s = Math.max(0, Math.min(1, t)) * 6;
  const i = Math.min(5, Math.floor(s));
  const f = s - i;
  const a = VIRIDIS[i],
    b = VIRIDIS[Math.min(6, i + 1)];
  const r = Math.round(a[0] + (b[0] - a[0]) * f);
  const g = Math.round(a[1] + (b[1] - a[1]) * f);
  const bl = Math.round(a[2] + (b[2] - a[2]) * f);
  return `rgb(${r},${g},${bl})`;
}

// ── Data generation ──
function generateData(n: number, angle: number): { x: Float64Array; y: Float64Array } {
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const clusters = 5;
  const radius = 0.35;

  for (let i = 0; i < n; i++) {
    const c = i % clusters;
    const ca = (c / clusters) * Math.PI * 2 + angle;
    const cx = 0.5 + Math.cos(ca) * radius;
    const cy = 0.5 + Math.sin(ca) * radius;
    const spread = 0.08 + c * 0.02;
    x[i] = cx + (Math.random() - 0.5) * spread * 2;
    y[i] = cy + (Math.random() - 0.5) * spread * 2;
  }
  return { x, y };
}

// ── Canvas 2D rendering ──
async function renderCanvas2D(
  canvas: HTMLCanvasElement,
  x: Float64Array,
  y: Float64Array,
  bins: number,
): Promise<{ binTime: number; renderTime: number }> {
  const t0 = performance.now();
  const result = await bin2d(x, y, { xBins: bins, yBins: bins });
  const binTime = performance.now() - t0;

  const t1 = performance.now();
  const ctx = canvas.getContext("2d")!;
  const cellW = canvas.width / bins;
  const cellH = canvas.height / bins;

  ctx.fillStyle = "#131313";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let yi = 0; yi < bins; yi++) {
    for (let xi = 0; xi < bins; xi++) {
      const count = result.grid[yi * bins + xi];
      if (count === 0) continue;
      const intensity = Math.pow(count / result.maxCount, 0.4);
      ctx.fillStyle = viridisCSS(intensity);
      ctx.fillRect(xi * cellW, (bins - 1 - yi) * cellH, cellW + 0.5, cellH + 0.5);
    }
  }
  const renderTime = performance.now() - t1;
  return { binTime, renderTime };
}

// ── WebGPU WGSL shaders ──
const binComputeShader = /* wgsl */ `
  struct Params {
    numPoints: u32,
    binsX: u32,
    binsY: u32,
    _pad: u32,
    xMin: f32,
    xMax: f32,
    yMin: f32,
    yMax: f32,
  };

  @group(0) @binding(0) var<uniform> params: Params;
  @group(0) @binding(1) var<storage, read> pointsX: array<f32>;
  @group(0) @binding(2) var<storage, read> pointsY: array<f32>;
  @group(0) @binding(3) var<storage, read_write> grid: array<atomic<u32>>;

  @compute @workgroup_size(256)
  fn main(@builtin(global_invocation_id) gid: vec3u) {
    let idx = gid.x;
    if (idx >= params.numPoints) { return; }

    let px = pointsX[idx];
    let py = pointsY[idx];
    let xRange = params.xMax - params.xMin;
    let yRange = params.yMax - params.yMin;

    if (xRange <= 0.0 || yRange <= 0.0) { return; }

    var xi = u32(floor((px - params.xMin) / xRange * f32(params.binsX)));
    var yi = u32(floor((py - params.yMin) / yRange * f32(params.binsY)));

    if (xi >= params.binsX) { xi = params.binsX - 1u; }
    if (yi >= params.binsY) { yi = params.binsY - 1u; }

    atomicAdd(&grid[yi * params.binsX + xi], 1u);
  }
`;

const maxReduceShader = /* wgsl */ `
@group(0) @binding(0) var<storage, read> grid: array<u32>;
@group(0) @binding(1) var<storage, read_write> maxVal: array<atomic<u32>>;
struct Info { size: u32 };
@group(0) @binding(2) var<uniform> info: Info;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  if (idx >= info.size) { return; }
  atomicMax(&maxVal[0], grid[idx]);
}`;

const renderShader = /* wgsl */ `
struct Uniforms { binsX: u32, binsY: u32 };
@group(0) @binding(0) var<storage, read> grid: array<u32>;
@group(0) @binding(1) var<uniform> uniforms: Uniforms;
@group(0) @binding(2) var<storage, read> maxVal: array<u32>;
struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  var p = array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));
  var out: VOut; out.pos = vec4f(p[vi],0,1); out.uv = p[vi]*0.5+0.5; return out;
}
fn viridis(t: f32) -> vec3f {
  let c = array<vec3f,7>(vec3f(0.267,0.004,0.329),vec3f(0.282,0.141,0.459),vec3f(0.255,0.267,0.529),
    vec3f(0.165,0.471,0.557),vec3f(0.133,0.659,0.518),vec3f(0.478,0.820,0.318),vec3f(0.992,0.906,0.145));
  let s=clamp(t,0.0,1.0)*6.0; let i=min(u32(floor(s)),5u); let f=s-floor(s);
  return mix(c[i],c[min(i+1u,6u)],f);
}
@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let xi=min(u32(uv.x*f32(uniforms.binsX)),uniforms.binsX-1u);
  let yi=min(u32(uv.y*f32(uniforms.binsY)),uniforms.binsY-1u);
  let count=grid[yi*uniforms.binsX+xi]; let maxC=maxVal[0];
  if(maxC==0u||count==0u){return vec4f(0.078,0.078,0.078,1.0);}
  return vec4f(viridis(pow(f32(count)/f32(maxC),0.4)),1.0);
}`;

// ── WebGPU pipeline ──
let device: GPUDevice;
let gpuContext: GPUCanvasContext;

// Pipeline objects
let binPipeline: GPUComputePipeline;
let maxPipeline: GPUComputePipeline;
let renderPipeline: GPURenderPipeline;
let canvasFormat: GPUTextureFormat;

async function initWebGPU(): Promise<boolean> {
  if (!navigator.gpu) return false;
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return false;
  device = await adapter.requestDevice();

  gpuContext = gpuCanvas.getContext("webgpu") as GPUCanvasContext;
  canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  gpuContext.configure({ device, format: canvasFormat, alphaMode: "opaque" });

  // Compute pipeline: binning
  binPipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module: device.createShaderModule({ code: binComputeShader }), entryPoint: "main" },
  });

  // Compute pipeline: max reduction
  maxPipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module: device.createShaderModule({ code: maxReduceShader }), entryPoint: "main" },
  });

  // Render pipeline
  const renderModule = device.createShaderModule({ code: renderShader });
  renderPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: renderModule, entryPoint: "vs" },
    fragment: {
      module: renderModule,
      entryPoint: "fs",
      targets: [{ format: canvasFormat }],
    },
    primitive: { topology: "triangle-list" },
  });

  return true;
}

async function renderWebGPU(
  x: Float64Array,
  y: Float64Array,
  bins: number,
): Promise<{ binTime: number; renderTime: number }> {
  const n = x.length;

  // Convert to Float32 for GPU
  const xF32 = new Float32Array(n);
  const yF32 = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    xF32[i] = x[i];
    yF32[i] = y[i];
  }

  // Compute data range
  let xMin = Infinity,
    xMax = -Infinity,
    yMin = Infinity,
    yMax = -Infinity;
  for (let i = 0; i < n; i++) {
    if (xF32[i] < xMin) xMin = xF32[i];
    if (xF32[i] > xMax) xMax = xF32[i];
    if (yF32[i] < yMin) yMin = yF32[i];
    if (yF32[i] > yMax) yMax = yF32[i];
  }

  const gridSize = bins * bins;

  // Create buffers
  const paramsData = new ArrayBuffer(32);
  const paramsU32 = new Uint32Array(paramsData);
  const paramsF32 = new Float32Array(paramsData);
  paramsU32[0] = n;
  paramsU32[1] = bins;
  paramsU32[2] = bins;
  paramsU32[3] = 0;
  paramsF32[4] = xMin;
  paramsF32[5] = xMax;
  paramsF32[6] = yMin;
  paramsF32[7] = yMax;

  const paramsBuf = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(paramsBuf, 0, paramsData);

  const xBuf = device.createBuffer({
    size: xF32.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(xBuf, 0, xF32);

  const yBuf = device.createBuffer({
    size: yF32.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(yBuf, 0, yF32);

  const gridBuf = device.createBuffer({
    size: gridSize * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  // Zero-fill the grid
  device.queue.writeBuffer(gridBuf, 0, new Uint32Array(gridSize));

  const maxBuf = device.createBuffer({
    size: 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(maxBuf, 0, new Uint32Array([0]));

  const infoBuf = device.createBuffer({
    size: 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(infoBuf, 0, new Uint32Array([gridSize]));

  const renderUniformData = new Uint32Array([bins, bins]);
  const renderUniformBuf = device.createBuffer({
    size: 8,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(renderUniformBuf, 0, renderUniformData);

  // ── Bin compute pass ──
  const t0 = performance.now();

  const binBG = device.createBindGroup({
    layout: binPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: paramsBuf } },
      { binding: 1, resource: { buffer: xBuf } },
      { binding: 2, resource: { buffer: yBuf } },
      { binding: 3, resource: { buffer: gridBuf } },
    ],
  });

  const maxBG = device.createBindGroup({
    layout: maxPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: gridBuf } },
      { binding: 1, resource: { buffer: maxBuf } },
      { binding: 2, resource: { buffer: infoBuf } },
    ],
  });

  const enc = device.createCommandEncoder();

  const binPass = enc.beginComputePass();
  binPass.setPipeline(binPipeline);
  binPass.setBindGroup(0, binBG);
  binPass.dispatchWorkgroups(Math.ceil(n / 256));
  binPass.end();

  const maxPass = enc.beginComputePass();
  maxPass.setPipeline(maxPipeline);
  maxPass.setBindGroup(0, maxBG);
  maxPass.dispatchWorkgroups(Math.ceil(gridSize / 256));
  maxPass.end();

  device.queue.submit([enc.finish()]);
  await device.queue.onSubmittedWorkDone();
  const binTime = performance.now() - t0;

  // ── Render pass ──
  const t1 = performance.now();

  const renderBG = device.createBindGroup({
    layout: renderPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: gridBuf } },
      { binding: 1, resource: { buffer: renderUniformBuf } },
      { binding: 2, resource: { buffer: maxBuf } },
    ],
  });

  const renderEnc = device.createCommandEncoder();
  const colorView = gpuContext.getCurrentTexture().createView();
  const renderPass = renderEnc.beginRenderPass({
    colorAttachments: [
      {
        view: colorView,
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0.075, g: 0.075, b: 0.075, a: 1 },
      },
    ],
  });
  renderPass.setPipeline(renderPipeline);
  renderPass.setBindGroup(0, renderBG);
  renderPass.draw(6);
  renderPass.end();

  device.queue.submit([renderEnc.finish()]);
  await device.queue.onSubmittedWorkDone();
  const renderTime = performance.now() - t1;

  // Cleanup
  paramsBuf.destroy();
  xBuf.destroy();
  yBuf.destroy();
  gridBuf.destroy();
  maxBuf.destroy();
  infoBuf.destroy();
  renderUniformBuf.destroy();

  return { binTime, renderTime };
}

// ── UI updates ──
function updateStats(prefix: string, binTime: number, renderTime: number) {
  const total = binTime + renderTime;
  $(`${prefix}-bin-time`).textContent = `${binTime.toFixed(1)}ms`;
  $(`${prefix}-render-time`).textContent = `${renderTime.toFixed(1)}ms`;
  $(`${prefix}-total-time`).textContent = `${total.toFixed(1)}ms`;
  $(`${prefix}-fps`).textContent = total > 0 ? `${Math.round(1000 / total)}` : "--";
}

function updateComparison(gpuTotal: number, canvasTotal: number) {
  const maxTime = Math.max(gpuTotal, canvasTotal, 0.1);
  const gpuPct = (gpuTotal / maxTime) * 100;
  const canvasPct = (canvasTotal / maxTime) * 100;

  ($("bar-gpu") as HTMLElement).style.width = `${gpuPct}%`;
  ($("bar-canvas") as HTMLElement).style.width = `${canvasPct}%`;
  $("bar-gpu-time").textContent = `${gpuTotal.toFixed(1)}ms`;
  $("bar-canvas-time").textContent = `${canvasTotal.toFixed(1)}ms`;

  if (gpuTotal > 0 && canvasTotal > 0) {
    const speedup = canvasTotal / gpuTotal;
    $("comparison-text").innerHTML =
      `WebGPU: ${gpuTotal.toFixed(1)}ms | Canvas 2D: ${canvasTotal.toFixed(1)}ms | ` +
      `Speedup: <span class="speedup-value">${speedup.toFixed(1)}&times;</span>`;
  }
}

function updateComparisonNA(canvasTotal: number) {
  ($("bar-gpu") as HTMLElement).style.width = "0%";
  ($("bar-canvas") as HTMLElement).style.width = "100%";
  $("bar-gpu-time").textContent = "N/A";
  $("bar-canvas-time").textContent = `${canvasTotal.toFixed(1)}ms`;
  $("comparison-text").innerHTML =
    `WebGPU: N/A | Canvas 2D: ${canvasTotal.toFixed(1)}ms | ` +
    `Speedup: <span class="speedup-value">N/A</span>`;
}

// ── Run benchmark ──
async function runOnce(angle: number) {
  const n = parseInt(pointCountSel.value);
  const bins = parseInt(gridResSel.value);
  const { x, y } = generateData(n, angle);

  let gpuTiming: { binTime: number; renderTime: number } | null = null;

  if (gpuReady) {
    gpuTiming = await renderWebGPU(x, y, bins);
    updateStats("gpu", gpuTiming.binTime, gpuTiming.renderTime);
  }

  const canvasTiming = await renderCanvas2D(canvas2d, x, y, bins);
  updateStats("canvas", canvasTiming.binTime, canvasTiming.renderTime);

  if (gpuTiming) {
    const gpuTotal = gpuTiming.binTime + gpuTiming.renderTime;
    const canvasTotal = canvasTiming.binTime + canvasTiming.renderTime;
    updateComparison(gpuTotal, canvasTotal);
  } else {
    updateComparisonNA(canvasTiming.binTime + canvasTiming.renderTime);
  }
}

// ── Animation loop ──
let animId: number | null = null;

function startAnimation() {
  let angle = 0;
  const step = async () => {
    if (!animating) return;
    angle += 0.015;
    await runOnce(angle);
    animId = requestAnimationFrame(step);
  };
  animId = requestAnimationFrame(step);
}

function stopAnimation() {
  if (animId !== null) {
    cancelAnimationFrame(animId);
    animId = null;
  }
}

// ── Event handlers ──
animToggle.addEventListener("click", () => {
  animating = !animating;
  animToggle.textContent = animating ? "ORBITING" : "STATIC";
  animToggle.classList.toggle("toggle-off", !animating);

  if (animating) {
    startAnimation();
  } else {
    stopAnimation();
  }
});

runBtn.addEventListener("click", async () => {
  if (running) return;
  running = true;
  runBtn.textContent = "RUNNING...";
  runBtn.style.opacity = "0.6";

  try {
    await runOnce(0);
  } finally {
    running = false;
    runBtn.textContent = "RUN";
    runBtn.style.opacity = "1";
  }
});

// ── Init ──
async function init() {
  gpuReady = await initWebGPU();

  if (!gpuReady) {
    const wrap = gpuCanvas.parentElement!;
    const msg = document.createElement("div");
    msg.className = "fallback-msg";
    msg.textContent = "WebGPU not available in this browser";
    wrap.appendChild(msg);

    $("gpu-bin-time").textContent = "N/A";
    $("gpu-render-time").textContent = "N/A";
    $("gpu-total-time").textContent = "N/A";
    $("gpu-fps").textContent = "N/A";
  }

  // Run initial benchmark
  await runOnce(0);
}

init();
