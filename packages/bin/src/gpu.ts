import type { Bin2dResult } from "@vizcrush/core";
import { bin2dBounds } from "./cores.js";
import { BIN2D_WGSL } from "./shaders/bin2d-wgsl.js";

/**
 * WebGPU compute path for bin2d — the wired version of `shaders/bin2d.wgsl`.
 *
 * Opt-in via `bin2d(x, y, opts, { backend: "webgpu" })`. Every failure mode
 * (no `navigator.gpu`, adapter/device denied, device lost, oversized input,
 * degenerate range) resolves to `null` so the caller falls back to the
 * wasm/js kernel; the GPU path never throws into user code.
 *
 * Precision: WGSL has no f64, so inputs are rebased against the range minimum
 * in f64 and only then narrowed to f32. That keeps bin assignment exact for
 * ranges spanning up to ~2^24 distinguishable values per axis even when the
 * raw values are huge (epoch-millisecond timestamps). Points within f32
 * epsilon of a bin edge may land in the neighbouring bin relative to the f64
 * cores. Edges returned to callers are always computed in f64.
 */

/** Must match `@workgroup_size` in the shader. */
const WG_SIZE = 256;
/** `dispatchWorkgroups` is capped at 65535 per dimension (WebGPU default limit). */
const MAX_POINTS = 65535 * WG_SIZE;

/** GPUBufferUsage flag values, fixed by the WebGPU spec. Written out so this
 * module compiles without DOM/WebGPU type libs (Node has neither). */
const MAP_READ = 0x1;
const COPY_SRC = 0x4;
const COPY_DST = 0x8;
const UNIFORM = 0x40;
const STORAGE = 0x80;

interface GpuState {
  device: any;
  pipeline: any;
}

let statePromise: Promise<GpuState | null> | null = null;

async function acquire(): Promise<GpuState | null> {
  const gpu = typeof navigator !== "undefined" ? (navigator as any).gpu : undefined;
  if (!gpu) return null;
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    if (!device) return null;
    // A lost device poisons every object created from it; drop the cache so
    // the next call re-acquires from scratch.
    device.lost.then(
      () => {
        statePromise = null;
      },
      () => {
        statePromise = null;
      },
    );
    const module = device.createShaderModule({ code: BIN2D_WGSL });
    const pipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module, entryPoint: "main" },
    });
    return { device, pipeline };
  } catch {
    return null;
  }
}

function getState(): Promise<GpuState | null> {
  if (!statePromise) statePromise = acquire().catch(() => null);
  return statePromise;
}

/**
 * Rebase to `min` in f64, then narrow to f32. Non-finite values become NaN so
 * the shader skips them — matching the JS/WASM cores, which skip every
 * non-finite point (the shader's own guard only checks NaN).
 */
export function rebaseToF32(data: Float64Array, min: number): Float32Array {
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    out[i] = Number.isFinite(v) ? v - min : NaN;
  }
  return out;
}

/**
 * Run bin2d on the GPU. Resolves to `null` whenever the GPU path cannot run
 * or fails mid-flight; callers fall back to the wasm/js kernel.
 */
export async function bin2dGpu(
  x: Float64Array,
  y: Float64Array,
  xBins: number,
  yBins: number,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
): Promise<Bin2dResult | null> {
  const n = x.length;
  if (n === 0 || n > MAX_POINTS || xBins <= 0 || yBins <= 0) return null;

  const b = bin2dBounds(x, y, xMin, xMax, yMin, yMax);
  // Degenerate ranges take the cores' `min + 1` adjustment; let the CPU own
  // that path rather than replicating the edge case here.
  if (!(b.mxX > b.mnX) || !(b.mxY > b.mnY)) return null;

  const state = await getState();
  if (!state) return null;
  const { device, pipeline } = state;

  const gridSize = xBins * yBins;
  const buffers: any[] = [];
  try {
    const xs = rebaseToF32(x, b.mnX);
    const ys = rebaseToF32(y, b.mnY);

    // struct Params { point_count, x_bins, y_bins, _pad: u32; x_min, x_max, y_min, y_max: f32 }
    const params = new ArrayBuffer(32);
    const pu = new Uint32Array(params, 0, 4);
    const pf = new Float32Array(params, 16, 4);
    pu[0] = n;
    pu[1] = xBins;
    pu[2] = yBins;
    pf[0] = 0;
    pf[1] = Math.fround(b.mxX - b.mnX);
    pf[2] = 0;
    pf[3] = Math.fround(b.mxY - b.mnY);

    const mkBuffer = (size: number, usage: number) => {
      const buf = device.createBuffer({ size, usage });
      buffers.push(buf);
      return buf;
    };

    const paramsBuf = mkBuffer(32, UNIFORM | COPY_DST);
    const xBuf = mkBuffer(xs.byteLength, STORAGE | COPY_DST);
    const yBuf = mkBuffer(ys.byteLength, STORAGE | COPY_DST);
    // Storage buffers are zero-initialized per spec — no explicit clear needed.
    const gridBuf = mkBuffer(gridSize * 4, STORAGE | COPY_SRC);
    const readBuf = mkBuffer(gridSize * 4, MAP_READ | COPY_DST);

    device.queue.writeBuffer(paramsBuf, 0, params);
    device.queue.writeBuffer(xBuf, 0, xs);
    device.queue.writeBuffer(yBuf, 0, ys);

    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: paramsBuf } },
        { binding: 1, resource: { buffer: xBuf } },
        { binding: 2, resource: { buffer: yBuf } },
        { binding: 3, resource: { buffer: gridBuf } },
      ],
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(n / WG_SIZE));
    pass.end();
    encoder.copyBufferToBuffer(gridBuf, 0, readBuf, 0, gridSize * 4);
    device.queue.submit([encoder.finish()]);

    await readBuf.mapAsync(MAP_READ);
    const grid = new Uint32Array(readBuf.getMappedRange().slice(0));
    readBuf.unmap();

    let maxCount = 0;
    for (let i = 0; i < gridSize; i++) {
      if (grid[i] > maxCount) maxCount = grid[i];
    }

    // Edges are always f64, from the same formulas as the CPU cores.
    const xWidth = (b.mxX - b.mnX) / xBins;
    const yWidth = (b.mxY - b.mnY) / yBins;
    const xEdges = new Float64Array(xBins + 1);
    const yEdges = new Float64Array(yBins + 1);
    for (let i = 0; i <= xBins; i++) xEdges[i] = b.mnX + i * xWidth;
    for (let i = 0; i <= yBins; i++) yEdges[i] = b.mnY + i * yWidth;

    return { grid, xEdges, yEdges, maxCount };
  } catch {
    return null;
  } finally {
    for (const buf of buffers) {
      try {
        buf.destroy();
      } catch {
        // A lost device may have destroyed buffers already.
      }
    }
  }
}
