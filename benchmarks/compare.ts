/**
 * CI regression comparison script.
 * Compares latest benchmark results against committed baseline.
 * Exits with code 1 if any result is >10% slower.
 */

import { readFileSync, existsSync } from "node:fs";

const latestPath = "benchmarks/results/latest.json";
const baselinePath = "benchmarks/benchmark-baseline.json";

if (!existsSync(latestPath)) {
  console.error("No latest results found. Run benchmarks first.");
  process.exit(1);
}

if (!existsSync(baselinePath)) {
  console.log("No baseline found — skipping regression check.");
  process.exit(0);
}

interface BenchEntry {
  name: string;
  dataSize: number;
  medianMs: number;
}

const latest = JSON.parse(readFileSync(latestPath, "utf-8"));
const baseline = JSON.parse(readFileSync(baselinePath, "utf-8"));

let regressions = 0;
let improvements = 0;

for (const result of latest.results as BenchEntry[]) {
  const base = (baseline.results as BenchEntry[]).find(
    (b) => b.name === result.name && b.dataSize === result.dataSize,
  );
  if (!base) continue;

  const ratio = result.medianMs / base.medianMs;
  const pctChange = ((ratio - 1) * 100).toFixed(1);

  if (ratio > 1.1) {
    regressions++;
    console.error(
      `REGRESSION: ${result.name} ${result.dataSize}: +${pctChange}% (${base.medianMs}ms → ${result.medianMs}ms)`,
    );
  } else if (ratio < 0.9) {
    improvements++;
    console.log(`IMPROVEMENT: ${result.name} ${result.dataSize}: ${pctChange}% faster`);
  } else {
    console.log(`OK: ${result.name} ${result.dataSize}: ${pctChange}%`);
  }
}

if (regressions > 0) {
  console.error(`\n${regressions} regression(s) detected (>10% slower than baseline)`);
  process.exit(1);
} else {
  console.log(`\nNo regressions. ${improvements} improvement(s).`);
}
