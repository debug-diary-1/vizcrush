// WebGPU Compute Heatmap — 1M points binned on GPU, rendered as viridis heatmap

// ── WGSL Shaders ──────────────────────────────────────────────────────────────

const COMPUTE_SHADER = /* wgsl */ `
struct Params {
  point_count: u32,
  x_bins: u32,
  y_bins: u32,
  _pad: u32,
  x_min: f32, x_max: f32,
  y_min: f32, y_max: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> x_data: array<f32>;
@group(0) @binding(2) var<storage, read> y_data: array<f32>;
@group(0) @binding(3) var<storage, read_write> grid: array<atomic<u32>>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.point_count) { return; }

  let x = x_data[i];
  let y = y_data[i];

  if (x < params.x_min || x > params.x_max || y < params.y_min || y > params.y_max) { return; }

  var xi = u32((x - params.x_min) / (params.x_max - params.x_min) * f32(params.x_bins));
  var yi = u32((y - params.y_min) / (params.y_max - params.y_min) * f32(params.y_bins));
  if (xi >= params.x_bins) { xi = params.x_bins - 1u; }
  if (yi >= params.y_bins) { yi = params.y_bins - 1u; }

  atomicAdd(&grid[yi * params.x_bins + xi], 1u);
}
`;

const RENDER_SHADER = /* wgsl */ `
struct RenderParams {
  x_bins: u32,
  y_bins: u32,
  max_count: u32,
  canvas_w: f32,
  canvas_h: f32,
  _pad1: u32,
  _pad2: u32,
  _pad3: u32,
}

@group(0) @binding(0) var<uniform> rparams: RenderParams;
@group(0) @binding(1) var<storage, read> grid: array<u32>;

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vs(@builtin(vertex_index) vid: u32) -> VsOut {
  // Full-screen triangle
  var positions = array<vec2<f32>, 3>(
    vec2(-1.0, -1.0),
    vec2( 3.0, -1.0),
    vec2(-1.0,  3.0),
  );
  var uvs = array<vec2<f32>, 3>(
    vec2(0.0, 1.0),
    vec2(2.0, 1.0),
    vec2(0.0, -1.0),
  );
  var out: VsOut;
  out.pos = vec4(positions[vid], 0.0, 1.0);
  out.uv = uvs[vid];
  return out;
}

fn viridis(t: f32) -> vec3<f32> {
  let c0 = vec3(0.267, 0.004, 0.329);
  let c1 = vec3(0.282, 0.140, 0.458);
  let c2 = vec3(0.253, 0.265, 0.530);
  let c3 = vec3(0.163, 0.471, 0.558);
  let c4 = vec3(0.134, 0.658, 0.517);
  let c5 = vec3(0.477, 0.821, 0.318);
  let c6 = vec3(0.993, 0.906, 0.144);

  let s = clamp(t, 0.0, 1.0) * 6.0;
  let i = u32(s);
  let f = fract(s);

  var colors = array<vec3<f32>, 7>(c0, c1, c2, c3, c4, c5, c6);
  let a = colors[min(i, 5u)];
  let b = colors[min(i + 1u, 6u)];
  return mix(a, b, f);
}

@fragment
fn fs(inp: VsOut) -> @location(0) vec4<f32> {
  let uv = inp.uv;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    discard;
  }

  let xi = u32(uv.x * f32(rparams.x_bins));
  let yi = u32(uv.y * f32(rparams.y_bins));
  let cx = min(xi, rparams.x_bins - 1u);
  let cy = min(yi, rparams.y_bins - 1u);
  let count = grid[cy * rparams.x_bins + cx];

  if (count == 0u) {
    return vec4(0.08, 0.08, 0.08, 1.0);
  }

  let intensity = pow(f32(count) / f32(rparams.max_count), 0.4);
  let color = viridis(intensity);
  return vec4(color, 1.0);
}
`;

// ── Data Generation ───────────────────────────────────────────────────────────

function boxMullerPair(): [number, number] {
  let u1 = 0,
    u2 = 0;
  while (u1 === 0) u1 = Math.random();
  while (u2 === 0) u2 = Math.random();
  const mag = Math.sqrt(-2.0 * Math.log(u1));
  const theta = 2.0 * Math.PI * u2;
  return [mag * Math.cos(theta), mag * Math.sin(theta)];
}

function generateClustered(n: number): { x: Float32Array; y: Float32Array } {
  const centers = [
    [0.25, 0.25],
    [0.75, 0.25],
    [0.5, 0.5],
    [0.25, 0.75],
    [0.75, 0.75],
    [0.5, 0.15],
  ];
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const c = centers[Math.floor(Math.random() * centers.length)];
    const [gx, gy] = boxMullerPair();
    x[i] = c[0] + gx * 0.08;
    y[i] = c[1] + gy * 0.08;
  }
  return { x, y };
}

function generateUniform(n: number): { x: Float32Array; y: Float32Array } {
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = Math.random();
    y[i] = Math.random();
  }
  return { x, y };
}

function generateSpiral(n: number): { x: Float32Array; y: Float32Array } {
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const arms = 3;
  for (let i = 0; i < n; i++) {
    const arm = Math.floor(Math.random() * arms);
    const t = Math.random() * 4 * Math.PI;
    const r = (t / (4 * Math.PI)) * 0.45;
    const offset = (arm / arms) * 2 * Math.PI;
    const [nx, ny] = boxMullerPair();
    x[i] = 0.5 + r * Math.cos(t + offset) + nx * 0.012;
    y[i] = 0.5 + r * Math.sin(t + offset) + ny * 0.012;
  }
  return { x, y };
}

function generatePoints(n: number, dist: string) {
  if (dist === "uniform") return generateUniform(n);
  if (dist === "spiral") return generateSpiral(n);
  return generateClustered(n);
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("heatmap-canvas");
const pointCountSel = $<HTMLSelectElement>("point-count");
const gridResSel = $<HTMLSelectElement>("grid-res");
const distSel = $<HTMLSelectElement>("distribution");
const runBtn = $<HTMLButtonElement>("run-btn");

function setStat(id: string, val: string) {
  $<HTMLSpanElement>(id).textContent = val;
}

// ── Viridis JS (for colorbar + fallback) ──────────────────────────────────────

function viridisJS(t: number): [number, number, number] {
  const c = [
    [0.267, 0.004, 0.329],
    [0.282, 0.14, 0.458],
    [0.253, 0.265, 0.53],
    [0.163, 0.471, 0.558],
    [0.134, 0.658, 0.517],
    [0.477, 0.821, 0.318],
    [0.993, 0.906, 0.144],
  ];
  const s = Math.max(0, Math.min(1, t)) * 6;
  const i = Math.min(Math.floor(s), 5);
  const f = s - i;
  return [
    c[i][0] + (c[i + 1][0] - c[i][0]) * f,
    c[i][1] + (c[i + 1][1] - c[i][1]) * f,
    c[i][2] + (c[i + 1][2] - c[i][2]) * f,
  ];
}

function drawColorbar(maxCount: number) {
  const cb = $<HTMLCanvasElement>("colorbar-canvas");
  const ctx = cb.getContext("2d")!;
  const h = cb.height;
  for (let y = 0; y < h; y++) {
    const t = 1 - y / h;
    const [r, g, b] = viridisJS(t);
    ctx.fillStyle = `rgb(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0})`;
    ctx.fillRect(0, y, cb.width, 1);
  }
  $<HTMLSpanElement>("cb-max").textContent = String(maxCount);
  $<HTMLSpanElement>("cb-min").textContent = "0";
}

// ── WebGPU Path ───────────────────────────────────────────────────────────────

async function initWebGPU() {
  if (!navigator.gpu) return null;
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return null;
  const device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize,
    },
  });
  return { adapter, device };
}

async function runWebGPU(device: GPUDevice, n: number, bins: number, dist: string) {
  const _t0 = performance.now();

  // Generate data
  const { x, y } = generatePoints(n, dist);
  const _tGen = performance.now();

  // Params buffer (32 bytes)
  const paramsData = new ArrayBuffer(32);
  const paramsU32 = new Uint32Array(paramsData);
  const paramsF32 = new Float32Array(paramsData);
  paramsU32[0] = n;
  paramsU32[1] = bins;
  paramsU32[2] = bins;
  paramsU32[3] = 0;
  paramsF32[4] = 0.0;
  paramsF32[5] = 1.0;
  paramsF32[6] = 0.0;
  paramsF32[7] = 1.0;

  const paramsBuf = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(paramsBuf, 0, paramsData);

  const xBuf = device.createBuffer({
    size: x.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(xBuf, 0, x);

  const yBuf = device.createBuffer({
    size: y.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(yBuf, 0, y);

  const gridSize = bins * bins * 4;
  const gridBuf = device.createBuffer({
    size: gridSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const gridReadBuf = device.createBuffer({
    size: gridSize,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });

  // Compute pipeline
  const computeModule = device.createShaderModule({ code: COMPUTE_SHADER });
  const computePipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module: computeModule, entryPoint: "main" },
  });

  const computeBG = device.createBindGroup({
    layout: computePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: paramsBuf } },
      { binding: 1, resource: { buffer: xBuf } },
      { binding: 2, resource: { buffer: yBuf } },
      { binding: 3, resource: { buffer: gridBuf } },
    ],
  });

  // Dispatch compute
  const tCompute0 = performance.now();
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(computePipeline);
  pass.setBindGroup(0, computeBG);
  pass.dispatchWorkgroups(Math.ceil(n / 256));
  pass.end();

  // Copy grid for readback
  encoder.copyBufferToBuffer(gridBuf, 0, gridReadBuf, 0, gridSize);
  device.queue.submit([encoder.finish()]);

  // Read back to find max
  await gridReadBuf.mapAsync(GPUMapMode.READ);
  const gridData = new Uint32Array(gridReadBuf.getMappedRange().slice(0));
  gridReadBuf.unmap();
  const tCompute1 = performance.now();

  let maxCount = 0;
  for (let i = 0; i < gridData.length; i++) {
    if (gridData[i] > maxCount) maxCount = gridData[i];
  }
  if (maxCount === 0) maxCount = 1;

  // Render pipeline
  const ctx = canvas.getContext("webgpu")!;
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: "opaque" });

  // Size canvas to grid (capped at 512 for perf)
  const displaySize = Math.min(bins, 512);
  canvas.width = displaySize;
  canvas.height = displaySize;

  const renderModule = device.createShaderModule({ code: RENDER_SHADER });
  const renderPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: renderModule, entryPoint: "vs" },
    fragment: {
      module: renderModule,
      entryPoint: "fs",
      targets: [{ format }],
    },
    primitive: { topology: "triangle-list" },
  });

  // Render params (32 bytes)
  const rparamsData = new ArrayBuffer(32);
  const rparamsU32 = new Uint32Array(rparamsData);
  const rparamsF32 = new Float32Array(rparamsData);
  rparamsU32[0] = bins;
  rparamsU32[1] = bins;
  rparamsU32[2] = maxCount;
  rparamsF32[3] = displaySize;
  rparamsF32[4] = displaySize;
  rparamsU32[5] = 0;
  rparamsU32[6] = 0;
  rparamsU32[7] = 0;

  const rparamsBuf = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(rparamsBuf, 0, rparamsData);

  // Upload grid data for render (non-atomic version)
  const gridRenderBuf = device.createBuffer({
    size: gridSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(gridRenderBuf, 0, gridData);

  const renderBG = device.createBindGroup({
    layout: renderPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: rparamsBuf } },
      { binding: 1, resource: { buffer: gridRenderBuf } },
    ],
  });

  // Draw
  const tRender0 = performance.now();
  const renderEncoder = device.createCommandEncoder();
  const renderPass = renderEncoder.beginRenderPass({
    colorAttachments: [
      {
        view: ctx.getCurrentTexture().createView(),
        clearValue: { r: 0.08, g: 0.08, b: 0.08, a: 1 },
        loadOp: "clear" as GPULoadOp,
        storeOp: "store" as GPUStoreOp,
      },
    ],
  });
  renderPass.setPipeline(renderPipeline);
  renderPass.setBindGroup(0, renderBG);
  renderPass.draw(3);
  renderPass.end();
  device.queue.submit([renderEncoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  const tRender1 = performance.now();

  // Cleanup
  paramsBuf.destroy();
  xBuf.destroy();
  yBuf.destroy();
  gridBuf.destroy();
  gridReadBuf.destroy();
  rparamsBuf.destroy();
  gridRenderBuf.destroy();

  const computeMs = tCompute1 - tCompute0;
  const renderMs = tRender1 - tRender0;
  const totalMs = tRender1 - tCompute0;

  setStat("stat-compute", computeMs.toFixed(1) + " ms");
  setStat("stat-render", renderMs.toFixed(1) + " ms");
  setStat("stat-total", totalMs.toFixed(1) + " ms");
  setStat("stat-throughput", (n / (totalMs / 1000) / 1e6).toFixed(1) + " M/s");
  setStat("stat-backend", "webgpu");
  drawColorbar(maxCount);
}

// ── Canvas 2D Fallback ────────────────────────────────────────────────────────

function bin2dCPU(x: Float32Array, y: Float32Array, bins: number) {
  const grid = new Uint32Array(bins * bins);
  let maxCount = 0;
  for (let i = 0; i < x.length; i++) {
    const px = x[i],
      py = y[i];
    if (px < 0 || px > 1 || py < 0 || py > 1) continue;
    let xi = (px * bins) | 0;
    let yi = (py * bins) | 0;
    if (xi >= bins) xi = bins - 1;
    if (yi >= bins) yi = bins - 1;
    const val = ++grid[yi * bins + xi];
    if (val > maxCount) maxCount = val;
  }
  return { grid, maxCount };
}

function renderCanvasFallback(n: number, bins: number, dist: string) {
  const _t0 = performance.now();
  const { x, y } = generatePoints(n, dist);
  const tGen = performance.now();

  const { grid, maxCount } = bin2dCPU(x, y, bins);
  const tBin = performance.now();

  const displaySize = Math.min(bins, 512);
  canvas.width = displaySize;
  canvas.height = displaySize;
  const ctx = canvas.getContext("2d")!;
  const cellW = displaySize / bins;
  const cellH = displaySize / bins;

  for (let row = 0; row < bins; row++) {
    for (let col = 0; col < bins; col++) {
      const count = grid[row * bins + col];
      if (count === 0) {
        ctx.fillStyle = "rgb(20,20,20)";
      } else {
        const intensity = Math.pow(count / maxCount, 0.4);
        const [r, g, b] = viridisJS(intensity);
        ctx.fillStyle = `rgb(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0})`;
      }
      ctx.fillRect(col * cellW, row * cellH, Math.ceil(cellW), Math.ceil(cellH));
    }
  }
  const tRender = performance.now();

  const computeMs = tBin - tGen;
  const renderMs = tRender - tBin;
  const totalMs = tRender - tGen;

  setStat("stat-compute", computeMs.toFixed(1) + " ms");
  setStat("stat-render", renderMs.toFixed(1) + " ms");
  setStat("stat-total", totalMs.toFixed(1) + " ms");
  setStat("stat-throughput", (n / (totalMs / 1000) / 1e6).toFixed(1) + " M/s");
  setStat("stat-backend", "canvas-fallback");
  drawColorbar(maxCount);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const gpu = await initWebGPU();
  const useGPU = gpu !== null;

  if (!useGPU) {
    const wrap = canvas.parentElement!;
    const msg = document.createElement("div");
    msg.className = "fallback-msg";
    msg.textContent = "WebGPU unavailable — using Canvas 2D fallback";
    wrap.appendChild(msg);
  }

  async function run() {
    const n = parseInt(pointCountSel.value);
    const bins = parseInt(gridResSel.value);
    const dist = distSel.value;

    runBtn.disabled = true;
    runBtn.textContent = "...";

    try {
      if (useGPU) {
        await runWebGPU(gpu!.device, n, bins, dist);
      } else {
        renderCanvasFallback(n, bins, dist);
      }
    } catch (err) {
      console.error("Render error:", err);
      setStat("stat-backend", "error");
    }

    runBtn.disabled = false;
    runBtn.textContent = "RUN";
  }

  runBtn.addEventListener("click", run);
  pointCountSel.addEventListener("change", run);
  gridResSel.addEventListener("change", run);
  distSel.addEventListener("change", run);

  // Initial run
  await run();
}

main().catch(console.error);
