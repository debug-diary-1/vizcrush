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

const positiveFinite = (value) => Number.isFinite(value) && value > 0;

/**
 * Validate a complete version-sweep artifact before deriving any comparison.
 * Partial launches, duplicate/missing session indices, malformed samples,
 * parity failures, or an incomplete execution order invalidate the sweep.
 */
export function validateVersionResults(data, { requiredSize = N } = {}) {
  const { config } = data ?? {};
  if (!Number.isInteger(config?.sessions) || config.sessions <= 0) {
    throw new Error("version results require a positive config.sessions");
  }
  if (!Number.isInteger(config.reps) || config.reps <= 0) {
    throw new Error("version results require a positive config.reps");
  }
  if (!Array.isArray(config.sizes) || config.sizes.length === 0) {
    throw new Error("version results require configured sizes");
  }
  const configuredSizes = config.sizes.map((size) => size.n);
  if (!configuredSizes.includes(requiredSize)) {
    throw new Error(`version results do not include required size ${requiredSize}`);
  }
  if (!Array.isArray(data.targets) || data.targets.length < 2) {
    throw new Error("version results require at least two build targets");
  }

  const labels = data.targets.map((target) => target.label);
  if (new Set(labels).size !== labels.length)
    throw new Error("version build labels must be unique");
  if (!Array.isArray(config.builds) || config.builds.join("\0") !== labels.join("\0")) {
    throw new Error("version targets do not match config.builds order");
  }

  const orders = [];
  for (const target of data.targets) {
    if (typeof target.version !== "string" || target.version.length === 0) {
      throw new Error(`${target.label}: missing browser version`);
    }
    if (!Array.isArray(target.sessions) || target.sessions.length !== config.sessions) {
      throw new Error(
        `${target.label}: expected ${config.sessions} sessions, got ${target.sessions?.length ?? 0}`,
      );
    }
    const indices = target.sessions.map((session) => session.index).sort((a, b) => a - b);
    if (indices.some((value, index) => value !== index)) {
      throw new Error(`${target.label}: session indices must be exactly 0..${config.sessions - 1}`);
    }

    for (const session of target.sessions) {
      if (!Number.isInteger(session.order) || session.order < 0) {
        throw new Error(`${target.label} session ${session.index}: invalid execution order`);
      }
      orders.push(session.order);
      if (!Number.isFinite(session.benchmarkSink)) {
        throw new Error(`${target.label} session ${session.index}: benchmark sink is not finite`);
      }

      for (const size of configuredSizes) {
        const cell = session.sizes?.[String(size)];
        const where = `${target.label} session ${session.index} size ${size}`;
        if (!cell) throw new Error(`${where}: missing cell`);
        if (cell.maxAbsDiff !== 0) throw new Error(`${where}: parity gate did not pass`);
        for (const key of [
          "wasm_median",
          "wasm_min",
          "js_median",
          "js_min",
          "copy_median",
          "api_median",
        ]) {
          if (!positiveFinite(cell[key])) throw new Error(`${where}: invalid ${key}`);
        }
        for (const key of ["wasm_raw", "js_core"]) {
          const samples = cell.samples?.[key];
          if (!Array.isArray(samples) || samples.length !== config.reps) {
            throw new Error(`${where}: ${key} must contain ${config.reps} samples`);
          }
          if (!samples.every(positiveFinite)) throw new Error(`${where}: invalid ${key} sample`);
        }
        const derived = {
          wasm_median: median(cell.samples.wasm_raw),
          wasm_min: Math.min(...cell.samples.wasm_raw),
          js_median: median(cell.samples.js_core),
          js_min: Math.min(...cell.samples.js_core),
        };
        for (const [key, value] of Object.entries(derived)) {
          if (cell[key] !== value) {
            throw new Error(`${where}: stored ${key} does not match raw samples`);
          }
        }
      }
    }
  }

  orders.sort((a, b) => a - b);
  if (orders.some((value, index) => value !== index)) {
    throw new Error("version execution orders must be unique and contiguous");
  }

  const byOrder = new Map();
  for (const target of data.targets) {
    for (const session of target.sessions) {
      byOrder.set(session.order, { label: target.label, session: session.index });
    }
  }
  for (let session = 0; session < config.sessions; session += 1) {
    for (let position = 0; position < labels.length; position += 1) {
      const order = session * labels.length + position;
      const actual = byOrder.get(order);
      const expected = labels[(session + position) % labels.length];
      if (actual?.session !== session || actual.label !== expected) {
        throw new Error(`version execution order ${order} is not counterbalanced`);
      }
    }
  }
}

/**
 * Summarize a sweep file (the shape written by run-versions.mjs) at size `n`:
 * per-build across-launch js/wasm/ratio distributions, adjacent-build step
 * changes, and a reproduction verdict against the prior campaign's ratio
 * band. A build reproduces the prior result only if its whole observed range
 * lies inside the band widened by `tolerance` ON BOTH SIDES — a ratio far
 * below the band is as much a failure to reproduce as one far above it.
 */
export function summarizeVersions(data, { n = N, prior = PRIOR_RATIO, tolerance = 0.05 } = {}) {
  validateVersionResults(data, { requiredSize: n });
  const rows = [];
  for (const target of data.targets) {
    const sessions = target.sessions;
    const js = sessions.map((s) => median(s.sizes[String(n)].samples.js_core));
    const wasm = sessions.map((s) => median(s.sizes[String(n)].samples.wasm_raw));
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

  const steps = [];
  for (let i = 1; i < rows.length; i += 1) {
    const before = rows[i - 1];
    const after = rows[i];
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

  const reproduction = rows.map((row) => {
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
