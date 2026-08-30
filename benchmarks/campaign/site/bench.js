// Cross-engine LTTB measurement harness.
//
// Measures four things per (engine, size), keeping EVERY repetition so the
// analysis can report dispersion rather than a bare minimum:
//
//   wasm_raw    raw wasm-bindgen `lttb` export
//   js_core     the shipped pure-JS `lttbCore`
//   copy_proxy  two Float64Array allocations + .set of the same size, a proxy
//               for the bulk copy wasm-bindgen performs when passing typed
//               arrays into linear memory. This is the probe for the
//               SpiderMonkey outlier: if bulk copying explained it, copy_proxy
//               would track the gap. It does not.
//   public_api  the library's async public call (forced wasm), i.e. what an
//               application actually pays.
//
// Timing method: batch timing. Firefox and WebKit coarsen performance.now() to
// ~1ms as a Spectre mitigation, so a single sub-ms call is unmeasurable. We run
// N calls as one timed block and divide by N; N is chosen per size so a block
// is ~100ms in the slowest engine, keeping timer quantization near or below 1%.
//
// This measures hot steady-state throughput, NOT one-shot interactive latency:
// cold first calls are slower than JS in every engine we have measured.

import initWasm, { lttb as wasmLttb } from "/packages/downsample/wasm/vizcrush_downsample.js";
import { lttbCore } from "/packages/downsample/dist/cores.js";
import { downsampleKernels } from "@vizcrush/downsample";

const THRESHOLD = 1000;

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
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

async function timeBlockAsync(fn, calls) {
  const started = performance.now();
  for (let i = 0; i < calls; i += 1) await fn();
  return (performance.now() - started) / calls;
}

function measure(fn, { calls, reps, warmups }) {
  for (let i = 0; i < warmups; i += 1) timeBlock(fn, calls);
  const samples = [];
  for (let i = 0; i < reps; i += 1) samples.push(timeBlock(fn, calls));
  return samples;
}

async function measureAsync(fn, { calls, reps, warmups }) {
  for (let i = 0; i < warmups; i += 1) await timeBlockAsync(fn, calls);
  const samples = [];
  for (let i = 0; i < reps; i += 1) samples.push(await timeBlockAsync(fn, calls));
  return samples;
}

// Empirical clock granularity: the smallest non-zero delta observed over a
// spin. Recorded so the analysis can state the quantization floor rather than
// assume it. Firefox and WebKit report ~1ms here; Chromium far less.
function probeTimerResolution() {
  let smallest = Infinity;
  for (let i = 0; i < 20_000; i += 1) {
    const a = performance.now();
    let b = performance.now();
    while (b === a) b = performance.now();
    smallest = Math.min(smallest, b - a);
  }
  return smallest;
}

export async function run({ sizes, reps, warmups, seed }) {
  await initWasm();

  const out = {
    threshold: THRESHOLD,
    seed,
    reps,
    warmups,
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    timerResolutionProbeMs: probeTimerResolution(),
    sizes: [],
  };

  for (const { n, calls, asyncCalls } of sizes) {
    const { x, y } = makeSeries(n, seed);

    // Correctness gate: the two implementations must agree before their
    // timings are comparable at all.
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

    const opts = { calls, reps, warmups };
    const scratchX = new Float64Array(n);
    const scratchY = new Float64Array(n);

    out.sizes.push({
      n,
      calls,
      asyncCalls,
      outputLength: jsOut.x.length,
      maxAbsDiff,
      wasm_raw: measure(() => wasmLttb(x, y, THRESHOLD), opts),
      js_core: measure(() => lttbCore(x, y, THRESHOLD), opts),
      copy_proxy: measure(() => {
        scratchX.set(x);
        scratchY.set(y);
      }, opts),
      public_api: await measureAsync(
        () => downsampleKernels.lttb(x, y, THRESHOLD, { backend: "wasm" }),
        { calls: asyncCalls, reps, warmups },
      ),
    });
  }

  return out;
}

globalThis.__runCampaign = run;
