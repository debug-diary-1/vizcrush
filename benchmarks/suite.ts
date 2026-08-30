import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { aggregateKernels } from "@vizcrush/aggregate";
import { lttbSync } from "@vizcrush/downsample";
import { filterRange, transformKernels } from "@vizcrush/transform";

export interface BenchResult {
  name: string;
  dataSize: number;
  medianMs: number;
  p95Ms: number;
  minMs: number;
  backend: "js";
}

export interface BenchmarkOutput {
  timestamp: string;
  platform: string;
  nodeVersion: string;
  seed: number;
  results: BenchResult[];
}

export interface BenchmarkArtifactOptions {
  resultsPath: string;
  baselinePath: string;
  saveBaseline: boolean;
}

export function parseBenchmarkThreshold(value: string): number {
  const threshold = Number(value);
  if (value.trim() === "" || !Number.isFinite(threshold) || threshold < 0) {
    throw new Error(`BENCH_THRESHOLD must be a finite non-negative number; received ${value}`);
  }
  return threshold;
}

export function parseBenchmarkSeed(value: string): number {
  const seed = Number(value);
  if (value.trim() === "" || !Number.isSafeInteger(seed)) {
    throw new Error(`BENCH_SEED must be a safe integer; received ${value}`);
  }
  return seed;
}

export const benchmarkOperations = {
  lttb: (x: Float64Array, y: Float64Array, target: number) => lttbSync(x, y, target),
  filterRange: (x: Float64Array, y: Float64Array, viewportMin: number, viewportMax: number) =>
    filterRange(x, y, viewportMin, viewportMax),
  stats: (data: Float64Array) => aggregateKernels.stats.core(data),
  sort: (data: Float64Array) => transformKernels.sort.core(data, false),
};

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function generateTimeSeries(n: number, seed: number): { x: Float64Array; y: Float64Array } {
  const random = mulberry32(seed);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  let value = 0;
  for (let index = 0; index < n; index++) {
    x[index] = index;
    value += (random() - 0.498) * 10;
    y[index] = value;
  }
  return { x, y };
}

function measure(
  fn: () => unknown,
  runs: number,
): Omit<BenchResult, "name" | "dataSize" | "backend"> {
  for (let index = 0; index < Math.min(5, runs); index++) fn();
  const times: number[] = [];
  for (let index = 0; index < runs; index++) {
    const started = performance.now();
    fn();
    times.push(performance.now() - started);
  }
  times.sort((a, b) => a - b);
  return {
    medianMs: round(times[Math.floor(times.length / 2)]),
    p95Ms: round(times[Math.min(times.length - 1, Math.floor(times.length * 0.95))]),
    minMs: round(times[0]),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function runBenchmarkSuite(options?: {
  sizes?: number[];
  runs?: number;
  seed?: number;
}): BenchmarkOutput {
  const sizes = options?.sizes ?? [100_000, 500_000, 1_000_000];
  const runs = options?.runs ?? 50;
  const seed = options?.seed ?? 42;
  const results: BenchResult[] = [];

  for (const [sizeIndex, size] of sizes.entries()) {
    const { x, y } = generateTimeSeries(size, seed + sizeIndex);
    results.push({
      name: "lttb",
      dataSize: size,
      ...measure(() => benchmarkOperations.lttb(x, y, Math.min(1_000, size)), runs),
      backend: "js",
    });
    results.push({
      name: "filterRange",
      dataSize: size,
      ...measure(() => benchmarkOperations.filterRange(x, y, size * 0.25, size * 0.75), runs),
      backend: "js",
    });
    results.push({
      name: "stats",
      dataSize: size,
      ...measure(() => benchmarkOperations.stats(y), runs),
      backend: "js",
    });
    if (size <= 500_000) {
      results.push({
        name: "sort",
        dataSize: size,
        ...measure(() => benchmarkOperations.sort(y), Math.min(runs, 20)),
        backend: "js",
      });
    }
  }

  return {
    timestamp: new Date().toISOString(),
    platform: `${process.platform} ${process.arch}`,
    nodeVersion: process.version,
    seed,
    results,
  };
}

export function persistBenchmarkArtifacts(
  output: BenchmarkOutput,
  options: BenchmarkArtifactOptions,
): void {
  mkdirSync(dirname(options.resultsPath), { recursive: true });
  writeFileSync(options.resultsPath, JSON.stringify(output, null, 2));
  if (options.saveBaseline) {
    mkdirSync(dirname(options.baselinePath), { recursive: true });
    writeFileSync(options.baselinePath, JSON.stringify(output, null, 2));
  }
}

export function compareWithBaseline(
  output: BenchmarkOutput,
  baselinePath: string,
  threshold: number,
): string[] {
  if (!existsSync(baselinePath)) {
    throw new Error(`Benchmark baseline not found at ${baselinePath}`);
  }
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as unknown;
  if (!isRecord(baseline) || !Array.isArray(baseline.results)) {
    throw new Error("Benchmark baseline is invalid: results must be an array");
  }
  if (!Number.isSafeInteger(baseline.seed) || baseline.seed !== output.seed) {
    throw new Error(
      `Benchmark baseline seed mismatch: expected ${output.seed}, found ${String(baseline.seed)}`,
    );
  }
  const regressions: string[] = [];
  for (const result of output.results) {
    const previous = baseline.results.find(
      (entry) =>
        isRecord(entry) && entry.name === result.name && entry.dataSize === result.dataSize,
    );
    if (!previous) {
      throw new Error(`Benchmark baseline has no entry for ${result.name} ${result.dataSize}`);
    }
    const previousMedian = isRecord(previous) ? previous.medianMs : undefined;
    if (
      typeof previousMedian !== "number" ||
      !Number.isFinite(previousMedian) ||
      previousMedian <= 0
    ) {
      throw new Error(
        `Benchmark baseline has an invalid median for ${result.name} ${result.dataSize}`,
      );
    }
    const ratio = result.medianMs / previousMedian;
    if (ratio > 1 + threshold) {
      regressions.push(
        `${result.name} ${result.dataSize}: ${((ratio - 1) * 100).toFixed(1)}% slower ` +
          `(${previousMedian}ms -> ${result.medianMs}ms)`,
      );
    }
  }
  return regressions;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
