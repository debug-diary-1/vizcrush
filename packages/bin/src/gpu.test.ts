import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bin2d } from "./index.js";
import { bin2dCore } from "./cores.js";
import { bin2dGpu, rebaseToF32 } from "./gpu.js";
import { BIN2D_WGSL } from "./shaders/bin2d-wgsl.js";

describe("bin2d WebGPU path", () => {
  it("wired shader string is identical to shaders/bin2d.wgsl", () => {
    const wgslPath = fileURLToPath(new URL("./shaders/bin2d.wgsl", import.meta.url));
    expect(BIN2D_WGSL).toBe(readFileSync(wgslPath, "utf8"));
  });

  it("rebaseToF32 rebases finite values against min", () => {
    // Epoch-millisecond-sized values: raw f32 narrowing would lose ~2^17 ms of
    // resolution; rebasing first must preserve the offsets exactly.
    const base = 1_700_000_000_000;
    const data = new Float64Array([base, base + 1, base + 1000, base + 86_400_000]);
    const out = rebaseToF32(data, base);
    expect(Array.from(out)).toEqual([0, 1, 1000, 86_400_000]);
  });

  it("rebaseToF32 turns non-finite values into NaN (shader skips NaN only)", () => {
    const data = new Float64Array([NaN, Infinity, -Infinity, 5]);
    const out = rebaseToF32(data, 1);
    expect(out[0]).toBeNaN();
    expect(out[1]).toBeNaN();
    expect(out[2]).toBeNaN();
    expect(out[3]).toBe(4);
  });

  it("bin2dGpu resolves null where WebGPU is unavailable", async () => {
    // Node has no navigator.gpu; the GPU path must decline, never throw.
    const x = new Float64Array([0, 1, 2, 3]);
    const y = new Float64Array([0, 1, 2, 3]);
    expect(await bin2dGpu(x, y, 4, 4, NaN, NaN, NaN, NaN)).toBeNull();
  });

  it("bin2d with backend:'webgpu' falls back to the CPU result", async () => {
    const n = 10_000;
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = Math.sin(i * 0.37) * 100;
      y[i] = Math.cos(i * 0.53) * 100;
    }
    const viaGpuOption = await bin2d(x, y, { xBins: 64, yBins: 64 }, { backend: "webgpu" });
    const reference = bin2dCore(x, y, 64, 64, NaN, NaN, NaN, NaN);
    expect(viaGpuOption.grid).toEqual(reference.grid);
    expect(viaGpuOption.maxCount).toBe(reference.maxCount);
    expect(Array.from(viaGpuOption.xEdges)).toEqual(Array.from(reference.xEdges));
  });

  it("bin2dGpu declines degenerate ranges (CPU owns the min+1 adjustment)", async () => {
    const x = new Float64Array([5, 5, 5]);
    const y = new Float64Array([1, 2, 3]);
    expect(await bin2dGpu(x, y, 4, 4, NaN, NaN, NaN, NaN)).toBeNull();
  });
});
