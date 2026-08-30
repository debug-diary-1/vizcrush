import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compareWithBaseline, persistBenchmarkArtifacts, runBenchmarkSuite } from "./suite.js";

const benchmarkDirectory = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const saveBaseline = process.argv.includes("--save-baseline");
const quick = process.argv.includes("--quick");
const threshold = Number.parseFloat(process.env.BENCH_THRESHOLD ?? "0.25");
const seed = Number.parseInt(process.env.BENCH_SEED ?? "42", 10);
const resultsPath = resolve(
  process.env.BENCH_RESULTS_PATH ?? `${benchmarkDirectory}/results/latest.json`,
);
const baselinePath = resolve(
  process.env.BENCH_BASELINE_PATH ?? `${benchmarkDirectory}/benchmark-baseline.json`,
);

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
} else {
  const regressions = compareWithBaseline(output, baselinePath, threshold);
  if (regressions.length > 0) {
    for (const regression of regressions) console.error(`REGRESSION: ${regression}`);
    console.error(
      `${regressions.length} regression(s) exceeded the ${(threshold * 100).toFixed(0)}% threshold.`,
    );
    process.exitCode = 1;
  } else {
    console.log(`No regressions exceeded the ${(threshold * 100).toFixed(0)}% threshold.`);
  }
}
