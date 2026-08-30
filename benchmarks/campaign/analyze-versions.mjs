// Analysis for the engine-version sweep.
//
// Reports, per engine build, the ACROSS-LAUNCH distribution of the wasm/js
// ratio and of the JavaScript baseline. Because each launch is an independent
// browser process, this spread is the one that matters when comparing builds.
// It then looks for a step change between adjacent builds, which is what
// distinguishes "the engine changed" from "the measurement drifted".
//
//   node benchmarks/campaign/analyze-versions.mjs

import { readFileSync } from "node:fs";
import { median } from "./stats.mjs";

const N = 1_000_000;
const data = JSON.parse(readFileSync(new URL("./results/versions.json", import.meta.url), "utf8"));

// What the earlier campaign (ADR 0003, March 2026) published for Chromium at 1M.
const PRIOR_RATIO = [0.23, 0.25];

console.log(
  `sessions per build: ${data.config.sessions}   size: ${N.toLocaleString()}   seed: ${data.config.seed}\n`,
);
console.log(
  `${"build".padEnd(15)}${"version".padEnd(18)}${"launches".padStart(9)}` +
    `${"js core (ms)".padStart(22)}${"wasm (ms)".padStart(22)}${"wasm/js".padStart(20)}`,
);
console.log("-".repeat(106));

const rows = [];
for (const target of data.targets) {
  const sessions = target.sessions ?? [];
  if (sessions.length === 0) {
    console.log(
      `${target.label.padEnd(15)}${String(target.version ?? "").padEnd(18)}${"0".padStart(9)}   no sessions`,
    );
    continue;
  }
  const js = sessions.map((s) => s.sizes[String(N)].js_median);
  const wasm = sessions.map((s) => s.sizes[String(N)].wasm_median);
  const ratios = sessions.map((s, i) => wasm[i] / js[i]);
  rows.push({ label: target.label, version: target.version, js, wasm, ratios });

  const range = (xs) =>
    `${median(xs).toFixed(2)} [${Math.min(...xs).toFixed(2)}, ${Math.max(...xs).toFixed(2)}]`;
  console.log(
    `${target.label.padEnd(15)}${String(target.version ?? "").padEnd(18)}` +
      `${String(sessions.length).padStart(9)}${range(js).padStart(22)}${range(wasm).padStart(22)}${range(ratios).padStart(20)}`,
  );
}

console.log("\n=== adjacent-build change (step detection) ===");
for (let i = 1; i < rows.length; i += 1) {
  const before = rows[i - 1];
  const after = rows[i];
  const jsBefore = median(before.js);
  const jsAfter = median(after.js);
  console.log(
    `  ${before.label} -> ${after.label}: js ${jsBefore.toFixed(2)} -> ${jsAfter.toFixed(2)}ms ` +
      `(${(jsBefore / jsAfter).toFixed(2)}x faster), ratio ${median(before.ratios).toFixed(2)} -> ${median(after.ratios).toFixed(2)}`,
  );
}

console.log(
  `\n=== reproduction of the prior campaign (${PRIOR_RATIO[0]}-${PRIOR_RATIO[1]} at 1M) ===`,
);
for (const row of rows) {
  const lo = Math.min(...row.ratios);
  const hi = Math.max(...row.ratios);
  const reproduces = hi <= PRIOR_RATIO[1] + 0.05;
  console.log(
    `  ${row.label.padEnd(15)} ${lo.toFixed(2)}-${hi.toFixed(2)}  ` +
      `${reproduces ? "REPRODUCES prior result" : "does NOT reproduce prior result"}`,
  );
}
