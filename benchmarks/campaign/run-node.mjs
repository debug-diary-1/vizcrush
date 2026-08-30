// Node arm of the campaign: the protocol module used by the browser harness —
// identical seeded input, identical batch timing, identical parity gate,
// identical configuration — driven from Node. Lets a write-up put the
// V8-in-Node figure beside the V8-in-Chromium figure from the same build of
// the library.
//
//   node benchmarks/campaign/run-node.mjs

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  REPS,
  SEED,
  SIZES,
  THRESHOLD,
  WARMUPS,
  assertParity,
  makeSeries,
  measure,
  probeTimerResolution,
  sinkValue,
} from "./protocol.mjs";
import { median } from "./stats.mjs";

const WASM_DIR = fileURLToPath(new URL("../../packages/downsample/wasm/", import.meta.url));
const { lttbCore } = await import(
  new URL("../../packages/downsample/dist/cores.js", import.meta.url).href
);

// The shipped glue targets the web (it fetches the .wasm relative to
// import.meta.url), so in Node we hand it the bytes directly.
const glue = await import(new URL(`${WASM_DIR}vizcrush_downsample.js`, import.meta.url).href);
await glue.default({ module_or_path: readFileSync(`${WASM_DIR}vizcrush_downsample_bg.wasm`) });
const wasmLttb = glue.lttb;

const out = {
  startedAt: new Date().toISOString(),
  runtime: process.version,
  platform: `${process.platform} ${process.arch}`,
  config: { sizes: SIZES, reps: REPS, warmups: WARMUPS, seed: SEED, threshold: THRESHOLD },
  timerResolutionProbeMs: probeTimerResolution(),
  sizes: [],
};

for (const { n, calls } of SIZES) {
  const { x, y } = makeSeries(n, SEED);
  const scratchX = new Float64Array(n);
  const scratchY = new Float64Array(n);

  // Same gate as the browser arm: exact agreement or no numbers at all.
  const wasmOut = wasmLttb(x, y, THRESHOLD);
  const jsOut = lttbCore(x, y, THRESHOLD);
  const maxAbsDiff = assertParity(wasmOut, jsOut, `n=${n}`);
  const last = jsOut.x.length - 1;
  const opts = { calls, reps: REPS, warmups: WARMUPS };

  out.sizes.push({
    n,
    calls,
    outputLength: jsOut.x.length,
    maxAbsDiff,
    wasm_raw: measure(() => wasmLttb(x, y, THRESHOLD)[2 * last + 1], opts),
    js_core: measure(() => lttbCore(x, y, THRESHOLD).y[last], opts),
    copy_proxy: measure(() => {
      scratchX.set(x);
      scratchY.set(y);
      return scratchY[n - 1];
    }, opts),
  });
}

out.benchmarkSink = sinkValue();

for (const size of out.sizes) {
  const w = median(size.wasm_raw);
  const j = median(size.js_core);
  console.log(
    `n=${size.n.toLocaleString().padStart(9)}  wasm=${w.toFixed(3)}ms  js=${j.toFixed(3)}ms  ` +
      `wasm/js=${(w / j).toFixed(2)}x  copy=${median(size.copy_proxy).toFixed(3)}ms  ` +
      `maxAbsDiff=${size.maxAbsDiff}`,
  );
}

mkdirSync(new URL("./results/", import.meta.url), { recursive: true });
writeFileSync(new URL("./results/node.json", import.meta.url), `${JSON.stringify(out, null, 2)}\n`);
console.log("wrote results/node.json");
