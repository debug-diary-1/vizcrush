import { detectCapabilities } from "@vizcrush/core";
import { lttbCore } from "@vizcrush/downsample";
import { bin2dCore } from "@vizcrush/bin";
import type { BenchmarkInputType } from "../schemas.js";

/**
 * Report the runtime's real capabilities via the same probe the library's
 * `init()` uses — nothing hard-coded, so the answer is truthful wherever the
 * server runs (Node today: wasm true, webgpu false).
 */
export async function handleCapabilities() {
  const caps = await detectCapabilities();
  return {
    webgpu: caps.webgpu,
    wasm_simd: caps.wasmSimd,
    wasm: caps.wasm,
    shared_array_buffer: caps.sharedArrayBuffer,
    runtime: typeof process !== "undefined" ? `node ${process.version}` : "unknown",
    note:
      "Probed in the MCP server's own runtime. Backends: wasm | js (webgpu is a " +
      "browser-only opt-in on bin2d — see ADR 0004).",
  };
}

export function handleBenchmark(input: BenchmarkInputType) {
  const results: Record<string, { median_ms: number; backend: string }> = {};

  // Generate test data
  const size = input.data_size;
  const x = new Float64Array(size);
  const y = new Float64Array(size);
  let val = 0;
  for (let i = 0; i < size; i++) {
    x[i] = i;
    val += (Math.random() - 0.498) * 10;
    y[i] = val;
  }

  for (const algo of input.algorithms) {
    const times: number[] = [];
    const runs = 10;

    for (let r = 0; r < runs; r++) {
      const start = performance.now();
      // The real JS cores — the same implementations the kernel dispatches to —
      // not inline approximations.
      switch (algo) {
        case "lttb":
          lttbCore(x, y, 1000);
          break;
        case "bin2d":
          bin2dCore(x, y, 256, 256, NaN, NaN, NaN, NaN);
          break;
        default:
          break;
      }
      times.push(performance.now() - start);
    }

    times.sort((a, b) => a - b);
    results[algo] = {
      median_ms: Math.round(times[Math.floor(runs / 2)] * 100) / 100,
      backend: "js",
    };
  }

  return {
    data_size: size,
    results,
    note:
      "Measured on the pure-JS cores in the MCP server's Node runtime. " +
      "Relative WASM/JS performance is engine-dependent (ADR 0003).",
  };
}
