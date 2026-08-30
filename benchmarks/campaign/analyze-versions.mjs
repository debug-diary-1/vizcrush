// Analysis for the engine-version sweep.
//
// Reports, per engine build, the ACROSS-LAUNCH distribution of the wasm/js
// ratio and of the JavaScript baseline. Because each launch is an independent
// browser process, this spread is the one that matters when comparing builds.
// It then looks for a step change between adjacent builds, which is what
// distinguishes "the engine changed" from "the measurement drifted".
//
//   node benchmarks/campaign/analyze-versions.mjs [results/versions-run2.json]

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { median } from "./stats.mjs";

const N = 1_000_000;

// What the earlier campaign (ADR 0003, March 2026) published for Chromium at 1M.
const PRIOR_RATIO = [0.23, 0.25];

/**
 * Summarize a sweep file (the shape written by run-versions.mjs) at size `n`:
 * per-build across-launch js/wasm/ratio distributions, adjacent-build step
 * changes, and a reproduction verdict against the prior campaign's ratio
 * band. A build reproduces the prior result only if its whole observed range
 * lies inside the band widened by `tolerance` ON BOTH SIDES — a ratio far
 * below the band is as much a failure to reproduce as one far above it.
 */
export function summarizeVersions(data, { n = N, prior = PRIOR_RATIO, tolerance = 0.05 } = {}) {
  const rows = [];
  for (const target of data.targets) {
    const sessions = target.sessions ?? [];
    if (sessions.length === 0) {
      rows.push({ label: target.label, version: target.version, sessions: 0 });
      continue;
    }
    const js = sessions.map((s) => s.sizes[String(n)].js_median);
    const wasm = sessions.map((s) => s.sizes[String(n)].wasm_median);
    const ratios = sessions.map((s, i) => wasm[i] / js[i]);
    rows.push({
      label: target.label,
      version: target.version,
      sessions: sessions.length,
      js,
      wasm,
      ratios,
    });
  }

  const measured = rows.filter((row) => row.sessions > 0);
  const steps = [];
  for (let i = 1; i < measured.length; i += 1) {
    const before = measured[i - 1];
    const after = measured[i];
    steps.push({
      from: before.label,
      to: after.label,
      jsBefore: median(before.js),
      jsAfter: median(after.js),
      jsSpeedup: median(before.js) / median(after.js),
      ratioBefore: median(before.ratios),
      ratioAfter: median(after.ratios),
    });
  }

  const reproduction = measured.map((row) => {
    const lo = Math.min(...row.ratios);
    const hi = Math.max(...row.ratios);
    return {
      label: row.label,
      lo,
      hi,
      reproduces: lo >= prior[0] - tolerance && hi <= prior[1] + tolerance,
    };
  });

  return { n, prior, tolerance, rows, steps, reproduction };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2] ?? "results/versions.json";
  const data = JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"));
  const { rows, steps, reproduction, prior } = summarizeVersions(data);

  console.log(
    `sessions per build: ${data.config.sessions}   size: ${N.toLocaleString()}   seed: ${data.config.seed}\n`,
  );
  console.log(
    `${"build".padEnd(15)}${"version".padEnd(18)}${"launches".padStart(9)}` +
      `${"js core (ms)".padStart(22)}${"wasm (ms)".padStart(22)}${"wasm/js".padStart(20)}`,
  );
  console.log("-".repeat(106));

  const range = (xs) =>
    `${median(xs).toFixed(2)} [${Math.min(...xs).toFixed(2)}, ${Math.max(...xs).toFixed(2)}]`;
  for (const row of rows) {
    if (row.sessions === 0) {
      console.log(
        `${row.label.padEnd(15)}${String(row.version ?? "").padEnd(18)}${"0".padStart(9)}   no sessions`,
      );
      continue;
    }
    console.log(
      `${row.label.padEnd(15)}${String(row.version ?? "").padEnd(18)}` +
        `${String(row.sessions).padStart(9)}${range(row.js).padStart(22)}${range(row.wasm).padStart(22)}${range(row.ratios).padStart(20)}`,
    );
  }

  console.log("\n=== adjacent-build change (step detection) ===");
  for (const step of steps) {
    console.log(
      `  ${step.from} -> ${step.to}: js ${step.jsBefore.toFixed(2)} -> ${step.jsAfter.toFixed(2)}ms ` +
        `(${step.jsSpeedup.toFixed(2)}x faster), ratio ${step.ratioBefore.toFixed(2)} -> ${step.ratioAfter.toFixed(2)}`,
    );
  }

  console.log(`\n=== reproduction of the prior campaign (${prior[0]}-${prior[1]} at 1M) ===`);
  for (const verdict of reproduction) {
    console.log(
      `  ${verdict.label.padEnd(15)} ${verdict.lo.toFixed(2)}-${verdict.hi.toFixed(2)}  ` +
        `${verdict.reproduces ? "REPRODUCES prior result" : "does NOT reproduce prior result"}`,
    );
  }
}
