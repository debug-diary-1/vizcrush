/**
 * Benchmark runner for vizcrush.
 *
 * Runs in Node.js (JS fallback path). For full WASM benchmarks,
 * use the Playwright-based runner (runner-browser.ts) which launches Chrome.
 *
 * Output: JSON results + comparison against baseline.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { lttbSync } from "@vizcrush/downsample";
import { filterRange } from "@vizcrush/transform";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");

interface BenchResult {
  name: string;
  dataSize: number;
  medianMs: number;
  p95Ms: number;
  minMs: number;
  backend: string;
}

function generateTimeSeries(n: number): { x: Float64Array; y: Float64Array } {
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  let val = 0;
  for (let i = 0; i < n; i++) {
    x[i] = i;
    val += (Math.random() - 0.498) * 10;
    y[i] = val;
  }
  return { x, y };
}

function benchmark(
  name: string,
  fn: () => void,
  runs: number = 100,
): { medianMs: number; p95Ms: number; minMs: number } {
  // Warmup
  for (let i = 0; i < 5; i++) fn();

  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }

  times.sort((a, b) => a - b);
  return {
    medianMs: round(times[Math.floor(runs / 2)]),
    p95Ms: round(times[Math.floor(runs * 0.95)]),
    minMs: round(times[0]),
  };
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

// ── Benchmark Suites ──

const SIZES = [100_000, 500_000, 1_000_000];
const TARGET = 1_000;
const results: BenchResult[] = [];

console.log("vizcrush benchmark suite (JS fallback)\n");

// LTTB benchmarks
for (const size of SIZES) {
  const { x, y } = generateTimeSeries(size);
  const { medianMs, p95Ms, minMs } = benchmark(`lttb_${size}`, () => lttbSync(x, y, TARGET), 50);
  results.push({
    name: `lttb`,
    dataSize: size,
    medianMs,
    p95Ms,
    minMs,
    backend: "js",
  });
  console.log(
    `LTTB ${size.toLocaleString()} → ${TARGET}: median=${medianMs}ms p95=${p95Ms}ms min=${minMs}ms`,
  );
}

// filterRange benchmarks
for (const size of SIZES) {
  const { x, y } = generateTimeSeries(size);
  const viewportMin = size * 0.25;
  const viewportMax = size * 0.75;
  const { medianMs, p95Ms, minMs } = benchmark(
    `filterRange_${size}`,
    () => filterRange(x, y, viewportMin, viewportMax),
    50,
  );
  results.push({
    name: "filterRange",
    dataSize: size,
    medianMs,
    p95Ms,
    minMs,
    backend: "js",
  });
  console.log(
    `filterRange ${size.toLocaleString()} (50% viewport): median=${medianMs}ms p95=${p95Ms}ms`,
  );
}

// Stats benchmarks
{
  for (const size of SIZES) {
    const data = new Float64Array(size);
    for (let i = 0; i < size; i++) data[i] = Math.random() * 1000;

    const { medianMs, p95Ms, minMs } = benchmark(
      `stats_${size}`,
      () => {
        let count = 0,
          mean = 0,
          m2 = 0,
          min = Infinity,
          max = -Infinity;
        for (let i = 0; i < data.length; i++) {
          const v = data[i];
          count++;
          if (v < min) min = v;
          if (v > max) max = v;
          const delta = v - mean;
          mean += delta / count;
          const delta2 = v - mean;
          m2 += delta * delta2;
        }
      },
      50,
    );
    results.push({ name: "stats", dataSize: size, medianMs, p95Ms, minMs, backend: "js" });
    console.log(`stats ${size.toLocaleString()}: median=${medianMs}ms p95=${p95Ms}ms`);
  }
}

// Sort benchmarks
{
  for (const size of [100_000, 500_000]) {
    const data = new Float64Array(size);
    for (let i = 0; i < size; i++) data[i] = Math.random() * 1000;

    const { medianMs, p95Ms, minMs } = benchmark(
      `sort_${size}`,
      () => {
        const arr = Array.from(data);
        arr.sort((a, b) => a - b);
      },
      20,
    );
    results.push({ name: "sort", dataSize: size, medianMs, p95Ms, minMs, backend: "js" });
    console.log(`sort ${size.toLocaleString()}: median=${medianMs}ms p95=${p95Ms}ms`);
  }
}

// ── Output Results ──

const output = {
  timestamp: new Date().toISOString(),
  platform: `${process.platform} ${process.arch}`,
  nodeVersion: process.version,
  results,
};

const resultsDir = resolve(rootDir, "results");
mkdirSync(resultsDir, { recursive: true });
const latestPath = resolve(resultsDir, "latest.json");
writeFileSync(latestPath, JSON.stringify(output, null, 2));
console.log("\nResults saved to benchmarks/results/latest.json");

// ── Compare Against Baseline ──

const baselinePath = resolve(rootDir, "benchmark-baseline.json");
if (existsSync(baselinePath)) {
  console.log("\n--- Regression Check ---");
  const baseline = JSON.parse(readFileSync(baselinePath, "utf-8"));
  let regressions = 0;

  for (const result of results) {
    const baseEntry = baseline.results?.find(
      (b: BenchResult) => b.name === result.name && b.dataSize === result.dataSize,
    );
    if (!baseEntry) continue;

    const ratio = result.medianMs / baseEntry.medianMs;
    const pctChange = ((ratio - 1) * 100).toFixed(1);
    // 25% threshold for local runs — sub-ms operations have high relative variance.
    // CI with dedicated runners can use BENCH_THRESHOLD=0.10 for tighter checks.
    const threshold = parseFloat(process.env.BENCH_THRESHOLD ?? "0.25");
    const status =
      ratio > 1 + threshold ? "REGRESSION" : ratio < 1 - threshold ? "IMPROVEMENT" : "OK";

    if (status === "REGRESSION") {
      regressions++;
      console.error(
        `  ❌ ${result.name} ${result.dataSize}: ${pctChange}% slower (${baseEntry.medianMs}ms → ${result.medianMs}ms)`,
      );
    } else if (status === "IMPROVEMENT") {
      console.log(`  ✅ ${result.name} ${result.dataSize}: ${pctChange}% faster`);
    }
  }

  if (regressions > 0) {
    console.error(`\n${regressions} regression(s) detected (>10% slower than baseline)`);
    process.exit(1);
  } else {
    console.log("\nNo regressions detected.");
  }
} else {
  console.log("\nNo baseline found. Run with --save-baseline to create one.");
  if (process.argv.includes("--save-baseline")) {
    writeFileSync(baselinePath, JSON.stringify(output, null, 2));
    console.log(`Baseline saved to ${baselinePath}`);
  }
}
