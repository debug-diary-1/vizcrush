import type { BenchmarkInputType } from "../schemas.js";

export function handleCapabilities() {
  return {
    webgpu: false,
    wasm_simd: false,
    wasm: false,
    gpu_adapter: null,
    max_buffer_size: 0,
    runtime: "node",
    note: "MCP server runs in Node.js — WASM/WebGPU capabilities reflect browser environment when used via browser bindings",
  };
}

export function handleBenchmark(input: BenchmarkInputType) {
  const results: Record<string, { median_ms: number; backend: string }> = {};

  // Generate test data
  const size = input.data_size;
  const x: number[] = Array.from({ length: size });
  const y: number[] = Array.from({ length: size });
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
      switch (algo) {
        case "lttb": {
          // Simple LTTB benchmark
          const threshold = 1000;
          const bucketSize = (size - 2) / (threshold - 2);
          for (let i = 0; i < threshold - 2; i++) {
            const s = Math.floor(i * bucketSize) + 1;
            const e = Math.min(Math.floor((i + 1) * bucketSize) + 1, size - 1);
            let maxArea = -1;
            for (let j = s; j < e; j++) {
              const area = Math.abs(y[j] - y[s]);
              if (area > maxArea) maxArea = area;
            }
          }
          break;
        }
        case "bin2d": {
          const bins = 256;
          const grid = new Int32Array(bins * bins);
          for (let i = 0; i < size; i++) {
            const xi = Math.min(bins - 1, Math.floor((x[i] / size) * bins));
            const yi = Math.min(bins - 1, Math.max(0, Math.floor(((y[i] + 500) / 1000) * bins)));
            grid[yi * bins + xi]++;
          }
          break;
        }
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
    note: "Benchmarks run in Node.js. Browser WASM+SIMD/WebGPU results will be significantly faster.",
  };
}
