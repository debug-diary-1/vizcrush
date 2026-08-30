import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareWithBaseline,
  parseBenchmarkSeed,
  parseBenchmarkThreshold,
  persistBenchmarkArtifacts,
  runBenchmarkSuite,
  validateBenchmarkRunMode,
} from "./suite.js";

const benchmarkDirectory = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const canonicalBaselinePath = resolve(`${benchmarkDirectory}/benchmark-baseline.json`);
const saveBaseline = process.argv.includes("--save-baseline");
const quick = process.argv.includes("--quick");
const threshold = parseBenchmarkThreshold(process.env.BENCH_THRESHOLD ?? "0.25");
const seed = parseBenchmarkSeed(process.env.BENCH_SEED ?? "42");
const resultsPath = resolve(
  process.env.BENCH_RESULTS_PATH ?? `${benchmarkDirectory}/results/latest.json`,
);
const baselinePath = resolve(process.env.BENCH_BASELINE_PATH ?? canonicalBaselinePath);
const { compareBaseline } = validateBenchmarkRunMode({
  baselinePath,
  canonicalBaselinePath,
  quick,
  saveBaseline,
});

console.log(`vizcrush benchmark suite (shipped JS cores, seed ${seed})`);
const output = runBenchmarkSuite({
  sizes: quick ? [10_000] : undefined,
  runs: quick ? 3 : undefined,
  seed,
});
persistBenchmarkArtifacts(output, { resultsPath, baselinePath, saveBaseline });

for (const result of output.results) {
  console.log(
    `${result.name} ${result.dataSize.toLocaleString()}: ` +
      `median=${result.medianMs}ms p95=${result.p95Ms}ms min=${result.minMs}ms`,
  );
}

if (saveBaseline) {
  console.log(`Baseline saved to ${baselinePath}`);
} else if (!compareBaseline) {
  console.log("Quick mode completed without comparing against the full benchmark baseline.");
} else {
  if (!existsSync(baselinePath)) {
    console.error(
      `No benchmark baseline found at ${baselinePath}; run with --save-baseline before comparing.`,
    );
    process.exitCode = 1;
  } else {
    const regressions = compareWithBaseline(output, baselinePath, threshold);
    if (regressions.length === 0) {
      console.log(`No regressions exceeded the ${(threshold * 100).toFixed(0)}% threshold.`);
    }
    for (const regression of regressions) console.error(`REGRESSION: ${regression}`);
    if (regressions.length > 0) {
      console.error(
        `${regressions.length} regression(s) exceeded the ${(threshold * 100).toFixed(0)}% threshold.`,
      );
      process.exitCode = 1;
    }
  }
}
