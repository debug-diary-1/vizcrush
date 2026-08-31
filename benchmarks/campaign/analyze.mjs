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
const REQUIRED_ENGINES = Object.keys(LABEL);

const format = (v) => (v >= 1 ? v.toFixed(2) : v.toFixed(3));
const positiveFinite = (value) => Number.isFinite(value) && value > 0;

/**
 * Validate the complete cross-engine artifact before computing statistics.
 * A missing size/metric, browser error, parity failure, invalid sink, or
 * malformed sample set must fail analysis rather than yield a plausible table.
 */
export function validateEngineResults(raw) {
  if (!Number.isInteger(raw?.config?.reps) || raw.config.reps <= 0) {
    throw new Error("engine results require a positive config.reps");
  }
  if (!Array.isArray(raw.config.sizes) || raw.config.sizes.length === 0) {
    throw new Error("engine results require configured sizes");
  }
  const engineNames = Object.keys(raw.engines ?? {}).sort();
  if (engineNames.join("\0") !== [...REQUIRED_ENGINES].sort().join("\0")) {
    throw new Error(`engine results require exactly: ${REQUIRED_ENGINES.join(", ")}`);
  }
  const engines = Object.entries(raw.engines);

  for (const [name, engine] of engines) {
    if (!Array.isArray(engine.errors)) throw new Error(`${name}: errors must be an array`);
    if (engine.errors.length > 0) {
      throw new Error(`${name}: browser emitted errors: ${engine.errors.join(" | ")}`);
    }
    if (!Number.isFinite(engine.benchmarkSink)) {
      throw new Error(`${name}: benchmark sink is not finite`);
    }
    if (!positiveFinite(engine.timerResolutionProbeMs)) {
      throw new Error(`${name}: invalid timer resolution`);
    }
    if (!Array.isArray(engine.sizes) || engine.sizes.length !== raw.config.sizes.length) {
      throw new Error(`${name}: incomplete size results`);
    }

    for (const configured of raw.config.sizes) {
      const cell = engine.sizes.find((candidate) => candidate.n === configured.n);
      const where = `${name} size ${configured.n}`;
      if (!cell) throw new Error(`${where}: missing cell`);
      if (cell.maxAbsDiff !== 0) throw new Error(`${where}: parity gate did not pass`);
      if (!Number.isInteger(cell.outputLength) || cell.outputLength <= 0) {
        throw new Error(`${where}: invalid output length`);
      }
      for (const key of ["wasm_raw", "js_core", "copy_proxy", "public_api"]) {
        const samples = cell[key];
        if (!Array.isArray(samples) || samples.length !== raw.config.reps) {
          throw new Error(`${where}: ${key} must contain ${raw.config.reps} samples`);
        }
        if (!samples.every(positiveFinite)) throw new Error(`${where}: invalid ${key} sample`);
      }
    }
  }
}

/** Validate the optional Node companion artifact before displaying it. */
export function validateNodeResults(node) {
  if (!Number.isInteger(node?.config?.reps) || node.config.reps <= 0) {
    throw new Error("node results require a positive config.reps");
  }
  if (!Array.isArray(node.config.sizes) || node.config.sizes.length === 0) {
    throw new Error("node results require configured sizes");
  }
  if (!Number.isFinite(node.benchmarkSink)) {
    throw new Error("node benchmark sink is not finite");
  }
  if (!positiveFinite(node.timerResolutionProbeMs)) {
    throw new Error("node results contain an invalid timer resolution");
  }
  if (!Array.isArray(node.sizes) || node.sizes.length !== node.config.sizes.length) {
    throw new Error("node results contain incomplete size results");
  }
  for (const configured of node.config.sizes) {
    const cell = node.sizes.find((candidate) => candidate.n === configured.n);
    const where = `node size ${configured.n}`;
    if (!cell) throw new Error(`${where}: missing cell`);
    if (cell.maxAbsDiff !== 0) throw new Error(`${where}: parity gate did not pass`);
    if (!Number.isInteger(cell.outputLength) || cell.outputLength <= 0) {
      throw new Error(`${where}: invalid output length`);
    }
    for (const key of ["wasm_raw", "js_core", "copy_proxy"]) {
      const samples = cell[key];
      if (!Array.isArray(samples) || samples.length !== node.config.reps) {
        throw new Error(`${where}: ${key} must contain ${node.config.reps} samples`);
      }
      if (!samples.every(positiveFinite)) throw new Error(`${where}: invalid ${key} sample`);
    }
  }
}

/**
 * Summarize a raw campaign file (the shape written by run-engines.mjs) into
 * the analyzed shape: per engine and size, descriptive statistics for each
 * metric plus the derived ratios. Deterministic: same input, same output.
 */
export function summarizeEngines(raw) {
  validateEngineResults(raw);
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
    validateNodeResults(node);
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
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    // Optional arm; absence is not an error, but a malformed artifact is.
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
