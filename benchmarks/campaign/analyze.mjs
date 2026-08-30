// Turns raw per-repetition samples into the statistics the write-up reports:
// median, IQR, and a 95% WITHIN-SESSION bootstrap interval of the median.
//
//   node benchmarks/campaign/analyze.mjs
//
// The summary is a pure function of `results/raw.json`, and the writer emits
// stable bytes, so `results/analyzed.json` is regenerable bit-for-bit — a
// property the test suite checks against the committed files.

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { describe, median } from "./stats.mjs";

const LABEL = {
  chromium: "Chromium (V8)",
  firefox: "Firefox (SpiderMonkey)",
  webkit: "WebKit (JavaScriptCore)",
};

const format = (v) => (v >= 1 ? v.toFixed(2) : v.toFixed(3));

/**
 * Summarize a raw campaign file (the shape written by run-engines.mjs) into
 * the analyzed shape: per engine and size, descriptive statistics for each
 * metric plus the derived ratios. Deterministic: same input, same output.
 */
export function summarizeEngines(raw) {
  const out = {
    generatedFrom: raw.startedAt,
    machine: raw.machine,
    config: raw.config,
    engines: {},
  };

  for (const [name, data] of Object.entries(raw.engines)) {
    out.engines[name] = {
      label: LABEL[name] ?? name,
      version: data.version,
      userAgent: data.userAgent,
      timerGranularityMs: data.timerResolutionProbeMs,
      sizes: {},
    };

    for (const size of data.sizes) {
      const stats = {
        wasm_raw: describe(size.wasm_raw),
        js_core: describe(size.js_core),
        copy_proxy: describe(size.copy_proxy),
        public_api: describe(size.public_api),
      };
      out.engines[name].sizes[size.n] = {
        ...stats,
        wasmOverJs: stats.wasm_raw.median / stats.js_core.median,
        publicApiOverJs: stats.public_api.median / stats.js_core.median,
        copyShareOfWasmPct: (stats.copy_proxy.median / stats.wasm_raw.median) * 100,
        maxAbsDiff: size.maxAbsDiff,
        callsPerBlock: size.calls,
      };
    }
  }

  return out;
}

function printReport(raw, out) {
  console.log(`machine: ${raw.machine.platform} ${raw.machine.arch} | node ${raw.machine.node}\n`);

  for (const [name, data] of Object.entries(raw.engines)) {
    const engine = out.engines[name];
    console.log(
      `### ${engine.label} v${engine.version}  (timer granularity ${engine.timerGranularityMs}ms)`,
    );

    for (const size of data.sizes) {
      const cell = engine.sizes[size.n];
      console.log(
        `  n=${size.n.toLocaleString().padStart(9)}  ` +
          `wasm ${format(cell.wasm_raw.median)}ms ` +
          `[${format(cell.wasm_raw.ci95WithinSession[0])}, ${format(cell.wasm_raw.ci95WithinSession[1])}] ` +
          `rsd ${cell.wasm_raw.rsdPct.toFixed(1)}%  |  ` +
          `js ${format(cell.js_core.median)}ms rsd ${cell.js_core.rsdPct.toFixed(1)}%`,
      );
      console.log(
        `                wasm/js=${cell.wasmOverJs.toFixed(2)}x  api/js=${cell.publicApiOverJs.toFixed(2)}x  ` +
          `copy=${format(cell.copy_proxy.median)}ms (${cell.copyShareOfWasmPct.toFixed(1)}% of wasm)  ` +
          `parity maxAbsDiff=${cell.maxAbsDiff}`,
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
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const raw = JSON.parse(readFileSync(new URL("./results/raw.json", import.meta.url), "utf8"));
  const out = summarizeEngines(raw);
  printReport(raw, out);
  writeFileSync(
    new URL("./results/analyzed.json", import.meta.url),
    `${JSON.stringify(out, null, 2)}\n`,
  );
  console.log("wrote results/analyzed.json");
}
