import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  benchmarkOperations,
  compareWithBaseline,
  formatBelowNoiseFloorLine,
  generateTimeSeries,
  parseBenchmarkNoiseFloor,
  parseBenchmarkSeed,
  parseBenchmarkThreshold,
  persistBenchmarkArtifacts,
  validateBenchmarkRunMode,
  type BenchmarkOutput,
} from "./suite.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("benchmark suite", () => {
  test("rejects invalid benchmark environment values", () => {
    expect(() => parseBenchmarkThreshold("NaN")).toThrow(/threshold/i);
    expect(() => parseBenchmarkThreshold("-0.1")).toThrow(/threshold/i);
    expect(() => parseBenchmarkSeed("42junk")).toThrow(/seed/i);
    expect(() => parseBenchmarkSeed("1.5")).toThrow(/seed/i);
  });

  test("accepts finite thresholds and integer seeds", () => {
    expect(parseBenchmarkThreshold("0.75")).toBe(0.75);
    expect(parseBenchmarkSeed("42")).toBe(42);
  });

  test("rejects invalid noise floor values", () => {
    expect(() => parseBenchmarkNoiseFloor("NaN")).toThrow(/noise_floor/i);
    expect(() => parseBenchmarkNoiseFloor("-1")).toThrow(/noise_floor/i);
  });

  test("accepts a finite non-negative noise floor, including zero", () => {
    expect(parseBenchmarkNoiseFloor("1")).toBe(1);
    expect(parseBenchmarkNoiseFloor("0")).toBe(0);
  });

  test("quick mode skips baseline comparison", () => {
    expect(
      validateBenchmarkRunMode({
        baselinePath: "/benchmarks/benchmark-baseline.json",
        canonicalBaselinePath: "/benchmarks/benchmark-baseline.json",
        quick: true,
        saveBaseline: false,
      }),
    ).toEqual({ compareBaseline: false });
  });

  test("quick mode cannot overwrite the canonical baseline", () => {
    expect(() =>
      validateBenchmarkRunMode({
        baselinePath: "/benchmarks/benchmark-baseline.json",
        canonicalBaselinePath: "/benchmarks/benchmark-baseline.json",
        quick: true,
        saveBaseline: true,
      }),
    ).toThrow(/quick.*separate BENCH_BASELINE_PATH/i);

    expect(
      validateBenchmarkRunMode({
        baselinePath: "/tmp/quick-baseline.json",
        canonicalBaselinePath: "/benchmarks/benchmark-baseline.json",
        quick: true,
        saveBaseline: true,
      }),
    ).toEqual({ compareBaseline: false });
  });

  test("named operations execute the shipped vizcrush cores", () => {
    const values = new Float64Array([3, 1, 2]);

    expect(benchmarkOperations.stats(values).mean).toBe(2);
    expect(Array.from(benchmarkOperations.sort(values))).toEqual([1, 2, 3]);
  });

  test("generated datasets are deterministic for a given seed", () => {
    const first = generateTimeSeries(20, 42);
    const second = generateTimeSeries(20, 42);

    expect(first.x).toEqual(second.x);
    expect(first.y).toEqual(second.y);
  });

  test("save-baseline replaces an existing reviewed artifact", () => {
    const directory = mkdtempSync(join(tmpdir(), "vizcrush-benchmark-"));
    temporaryDirectories.push(directory);
    const resultsPath = join(directory, "latest.json");
    const baselinePath = join(directory, "baseline.json");
    writeFileSync(baselinePath, JSON.stringify({ timestamp: "old", results: [] }));

    const output: BenchmarkOutput = {
      timestamp: "new",
      platform: "test",
      nodeVersion: "test",
      seed: 42,
      results: [],
    };
    persistBenchmarkArtifacts(output, { resultsPath, baselinePath, saveBaseline: true });

    expect(JSON.parse(readFileSync(baselinePath, "utf8"))).toEqual(output);
    expect(JSON.parse(readFileSync(resultsPath, "utf8"))).toEqual(output);
  });

  test("missing baselines cannot be mistaken for a successful comparison", () => {
    const directory = mkdtempSync(join(tmpdir(), "vizcrush-benchmark-"));
    temporaryDirectories.push(directory);
    const output: BenchmarkOutput = {
      timestamp: "new",
      platform: "test",
      nodeVersion: "test",
      seed: 42,
      results: [],
    };

    expect(() => compareWithBaseline(output, join(directory, "missing.json"), 0.75)).toThrow(
      /baseline not found/i,
    );
  });

  test("rejects a baseline generated with a different dataset seed", () => {
    const directory = mkdtempSync(join(tmpdir(), "vizcrush-benchmark-"));
    temporaryDirectories.push(directory);
    const baselinePath = join(directory, "baseline.json");
    const output: BenchmarkOutput = {
      timestamp: "new",
      platform: "test",
      nodeVersion: "test",
      seed: 42,
      results: [],
    };
    writeFileSync(baselinePath, JSON.stringify({ ...output, seed: 41 }));

    expect(() => compareWithBaseline(output, baselinePath, 0.75)).toThrow(/seed mismatch/i);
  });

  test("rejects a baseline that does not cover every current benchmark", () => {
    const directory = mkdtempSync(join(tmpdir(), "vizcrush-benchmark-"));
    temporaryDirectories.push(directory);
    const baselinePath = join(directory, "baseline.json");
    const output: BenchmarkOutput = {
      timestamp: "new",
      platform: "test",
      nodeVersion: "test",
      seed: 42,
      results: [
        {
          name: "stats",
          dataSize: 100,
          medianMs: 1,
          p95Ms: 1,
          minMs: 1,
          backend: "js",
        },
      ],
    };
    writeFileSync(baselinePath, JSON.stringify({ ...output, results: [] }));

    expect(() => compareWithBaseline(output, baselinePath, 0.75)).toThrow(
      /no entry for stats 100/i,
    );
  });

  test("rejects a malformed baseline result collection", () => {
    const directory = mkdtempSync(join(tmpdir(), "vizcrush-benchmark-"));
    temporaryDirectories.push(directory);
    const baselinePath = join(directory, "baseline.json");
    const output: BenchmarkOutput = {
      timestamp: "new",
      platform: "test",
      nodeVersion: "test",
      seed: 42,
      results: [],
    };
    writeFileSync(baselinePath, JSON.stringify({ ...output, results: null }));

    expect(() => compareWithBaseline(output, baselinePath, 0.75)).toThrow(/invalid.*results/i);
  });

  test("rejects a zero or non-finite baseline median", () => {
    const directory = mkdtempSync(join(tmpdir(), "vizcrush-benchmark-"));
    temporaryDirectories.push(directory);
    const baselinePath = join(directory, "baseline.json");
    const result = {
      name: "stats",
      dataSize: 100,
      medianMs: 1,
      p95Ms: 1,
      minMs: 1,
      backend: "js" as const,
    };
    const output: BenchmarkOutput = {
      timestamp: "new",
      platform: "test",
      nodeVersion: "test",
      seed: 42,
      results: [result],
    };
    writeFileSync(
      baselinePath,
      JSON.stringify({ ...output, results: [{ ...result, medianMs: 0 }] }),
    );

    expect(() => compareWithBaseline(output, baselinePath, 0.75)).toThrow(/invalid.*median/i);
  });

  test("a baseline below the noise floor cannot be flagged as a regression", () => {
    const directory = mkdtempSync(join(tmpdir(), "vizcrush-benchmark-"));
    temporaryDirectories.push(directory);
    const baselinePath = join(directory, "baseline.json");
    const baselineResult = {
      name: "lttb",
      dataSize: 100_000,
      medianMs: 0.33,
      p95Ms: 0.4,
      minMs: 0.3,
      backend: "js" as const,
    };
    const output: BenchmarkOutput = {
      timestamp: "new",
      platform: "test",
      nodeVersion: "test",
      seed: 42,
      results: [{ ...baselineResult, medianMs: 0.66 }],
    };
    writeFileSync(baselinePath, JSON.stringify({ ...output, results: [baselineResult] }));

    const comparison = compareWithBaseline(output, baselinePath, 0.25);

    expect(comparison.regressions).toEqual([]);
    expect(comparison.belowNoiseFloor).toEqual([
      { name: "lttb", dataSize: 100_000, baselineMedianMs: 0.33 },
    ]);
  });

  test("a baseline at or above the noise floor still regresses when it doubles", () => {
    const directory = mkdtempSync(join(tmpdir(), "vizcrush-benchmark-"));
    temporaryDirectories.push(directory);
    const baselinePath = join(directory, "baseline.json");
    const baselineResult = {
      name: "lttb",
      dataSize: 100_000,
      medianMs: 2,
      p95Ms: 2.2,
      minMs: 1.8,
      backend: "js" as const,
    };
    const output: BenchmarkOutput = {
      timestamp: "new",
      platform: "test",
      nodeVersion: "test",
      seed: 42,
      results: [{ ...baselineResult, medianMs: 4 }],
    };
    writeFileSync(baselinePath, JSON.stringify({ ...output, results: [baselineResult] }));

    const comparison = compareWithBaseline(output, baselinePath, 0.25);

    expect(comparison.belowNoiseFloor).toEqual([]);
    expect(comparison.regressions).toHaveLength(1);
    expect(comparison.regressions[0]).toMatch(/lttb 100000/);
  });

  test("formats the below-noise-floor line exactly as the runner prints it", () => {
    expect(formatBelowNoiseFloorLine({ name: "lttb", dataSize: 100_000 }, 1)).toBe(
      "lttb 100,000: BELOW NOISE FLOOR (1 ms baseline)",
    );
  });

  test("a noise floor of zero restores the pre-guardrail behavior", () => {
    const directory = mkdtempSync(join(tmpdir(), "vizcrush-benchmark-"));
    temporaryDirectories.push(directory);
    const baselinePath = join(directory, "baseline.json");
    const baselineResult = {
      name: "lttb",
      dataSize: 100_000,
      medianMs: 0.33,
      p95Ms: 0.4,
      minMs: 0.3,
      backend: "js" as const,
    };
    const output: BenchmarkOutput = {
      timestamp: "new",
      platform: "test",
      nodeVersion: "test",
      seed: 42,
      results: [{ ...baselineResult, medianMs: 0.66 }],
    };
    writeFileSync(baselinePath, JSON.stringify({ ...output, results: [baselineResult] }));

    const comparison = compareWithBaseline(output, baselinePath, 0.25, 0);

    expect(comparison.belowNoiseFloor).toEqual([]);
    expect(comparison.regressions).toHaveLength(1);
  });
});
