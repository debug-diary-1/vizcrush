// Turns raw per-repetition samples into the statistics the write-up reports:
// median, IQR, and a 95% WITHIN-SESSION bootstrap interval of the median.
//
//   node benchmarks/campaign/analyze.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { describe, median } from "./stats.mjs";

const raw = JSON.parse(readFileSync(new URL("./results/raw.json", import.meta.url), "utf8"));

const LABEL = {
  chromium: "Chromium (V8)",
  firefox: "Firefox (SpiderMonkey)",
  webkit: "WebKit (JavaScriptCore)",
};

const format = (v) => (v >= 1 ? v.toFixed(2) : v.toFixed(3));
const out = { generatedFrom: raw.startedAt, machine: raw.machine, config: raw.config, engines: {} };

console.log(`machine: ${raw.machine.platform} ${raw.machine.arch} | node ${raw.machine.node}\n`);

for (const [name, data] of Object.entries(raw.engines)) {
  out.engines[name] = {
    label: LABEL[name] ?? name,
    version: data.version,
    userAgent: data.userAgent,
    timerGranularityMs: data.timerResolutionProbeMs,
    sizes: {},
  };
  console.log(
    `### ${LABEL[name] ?? name} v${data.version}  (timer granularity ${data.timerResolutionProbeMs}ms)`,
  );

  for (const size of data.sizes) {
    const stats = {
      wasm_raw: describe(size.wasm_raw),
      js_core: describe(size.js_core),
      copy_proxy: describe(size.copy_proxy),
      public_api: describe(size.public_api),
    };
    const wasmOverJs = stats.wasm_raw.median / stats.js_core.median;
    const apiOverJs = stats.public_api.median / stats.js_core.median;
    const copyShare = (stats.copy_proxy.median / stats.wasm_raw.median) * 100;

    out.engines[name].sizes[size.n] = {
      ...stats,
      wasmOverJs,
      publicApiOverJs: apiOverJs,
      copyShareOfWasmPct: copyShare,
      maxAbsDiff: size.maxAbsDiff,
      callsPerBlock: size.calls,
    };

    console.log(
      `  n=${size.n.toLocaleString().padStart(9)}  ` +
        `wasm ${format(stats.wasm_raw.median)}ms ` +
        `[${format(stats.wasm_raw.ci95WithinSession[0])}, ${format(stats.wasm_raw.ci95WithinSession[1])}] ` +
        `rsd ${stats.wasm_raw.rsdPct.toFixed(1)}%  |  ` +
        `js ${format(stats.js_core.median)}ms rsd ${stats.js_core.rsdPct.toFixed(1)}%`,
    );
    console.log(
      `                wasm/js=${wasmOverJs.toFixed(2)}x  api/js=${apiOverJs.toFixed(2)}x  ` +
        `copy=${format(stats.copy_proxy.median)}ms (${copyShare.toFixed(1)}% of wasm)  ` +
        `parity maxAbsDiff=${size.maxAbsDiff}`,
    );
  }
  console.log("");
}

// The Node arm, when present, lets the write-up put V8-in-Node beside
// V8-in-Chromium from the same build.
try {
  const node = JSON.parse(readFileSync(new URL("./results/node.json", import.meta.url), "utf8"));
  console.log(`### Node ${node.runtime} (V8, no browser)`);
  for (const size of node.sizes) {
    const w = median(size.wasm_raw);
    const j = median(size.js_core);
    console.log(
      `  n=${size.n.toLocaleString().padStart(9)}  wasm ${format(w)}ms  js ${format(j)}ms  ` +
        `wasm/js=${(w / j).toFixed(2)}x`,
    );
  }
  console.log("");
} catch {
  // Optional arm; absence is not an error.
}

writeFileSync(new URL("./results/analyzed.json", import.meta.url), JSON.stringify(out, null, 2));
console.log("wrote results/analyzed.json");
