import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  benchmarkOperations,
  generateTimeSeries,
  persistBenchmarkArtifacts,
  type BenchmarkOutput,
} from "./suite.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("benchmark suite", () => {
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
});
