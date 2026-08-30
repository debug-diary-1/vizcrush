// Node arm of the campaign: identical seeded input, identical batch timing,
// per-repetition retention. Lets a write-up put the V8-in-Node figure beside
// the V8-in-Chromium figure from the same build of the library.
//
//   node benchmarks/campaign/run-node.mjs

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

const THRESHOLD = 1000;
const SIZES = [
  { n: 100_000, calls: 300 },
  { n: 1_000_000, calls: 30 },
];
const REPS = 15;
const WARMUPS = 3;
const SEED = 42;

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let v = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    v = (v + Math.imul(v ^ (v >>> 7), 61 | v)) ^ v;
    return ((v ^ (v >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function makeSeries(n, seed) {
  const random = mulberry32(seed);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  let value = 0;
  for (let i = 0; i < n; i += 1) {
    x[i] = i;
    value += (random() - 0.498) * 10;
    y[i] = value;
  }
  return { x, y };
}

function timeBlock(fn, calls) {
  const started = performance.now();
  for (let i = 0; i < calls; i += 1) fn();
  return (performance.now() - started) / calls;
}

function measure(fn, calls) {
  for (let i = 0; i < WARMUPS; i += 1) timeBlock(fn, calls);
  const samples = [];
  for (let i = 0; i < REPS; i += 1) samples.push(timeBlock(fn, calls));
  return samples;
}

const out = {
  startedAt: new Date().toISOString(),
  runtime: process.version,
  platform: `${process.platform} ${process.arch}`,
  config: { sizes: SIZES, reps: REPS, warmups: WARMUPS, seed: SEED, threshold: THRESHOLD },
  sizes: [],
};

for (const { n, calls } of SIZES) {
  const { x, y } = makeSeries(n, SEED);
  const scratchX = new Float64Array(n);
  const scratchY = new Float64Array(n);

  const wasmOut = wasmLttb(x, y, THRESHOLD);
  const jsOut = lttbCore(x, y, THRESHOLD);
  let maxAbsDiff = 0;
  for (let i = 0; i < jsOut.x.length; i += 1) {
    maxAbsDiff = Math.max(
      maxAbsDiff,
      Math.abs(wasmOut[i * 2] - jsOut.x[i]),
      Math.abs(wasmOut[i * 2 + 1] - jsOut.y[i]),
    );
  }

  out.sizes.push({
    n,
    calls,
    maxAbsDiff,
    wasm_raw: measure(() => wasmLttb(x, y, THRESHOLD), calls),
    js_core: measure(() => lttbCore(x, y, THRESHOLD), calls),
    copy_proxy: measure(() => {
      scratchX.set(x);
      scratchY.set(y);
    }, calls),
  });
}

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
writeFileSync(new URL("./results/node.json", import.meta.url), JSON.stringify(out, null, 2));
console.log("wrote results/node.json");
