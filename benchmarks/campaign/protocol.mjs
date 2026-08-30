// The measurement protocol shared by every arm of the campaign.
//
// The claim the campaign defends is "same work, different engine", which only
// holds if the browser harness (site/bench.js) and the Node arm (run-node.mjs)
// execute the SAME input generation, timing method, parity gate, and
// configuration. This module is that single definition: it has no imports and
// touches nothing but `performance.now()`, so the browser loads it over HTTP
// and Node imports it directly, byte-identical.
//
// Timing method: batch timing. Firefox and WebKit coarsen performance.now() to
// ~1ms as a Spectre mitigation, so a single sub-ms call is unmeasurable. We run
// N calls as one timed block and divide by N; N is chosen per size so a block
// is ~100ms in the slowest engine, keeping timer quantization near or below 1%.
//
// This measures hot steady-state throughput, NOT one-shot interactive latency:
// cold first calls are slower than JS in every engine we have measured.

/** LTTB output threshold used by every measurement in the campaign. */
export const THRESHOLD = 1000;

/**
 * Input sizes with calls-per-timed-block, chosen so a block lands near ~100ms
 * in the SLOWEST engine measured (WebKit), keeping the ~1ms timer quantization
 * of Firefox/WebKit near 1%. `asyncCalls` is lower because the public API adds
 * promise machinery per call.
 */
export const SIZES = [
  { n: 100_000, calls: 300, asyncCalls: 100 },
  { n: 1_000_000, calls: 30, asyncCalls: 20 },
];

/** Timed blocks retained per (engine, size, metric). */
export const REPS = 15;

/** Untimed blocks run before the timed ones to reach JIT steady state. */
export const WARMUPS = 3;

/** Seed for the input series; fixed so every arm measures identical bytes. */
export const SEED = 42;

/** Deterministic 32-bit PRNG (mulberry32); same stream in every engine. */
export function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Seeded random-walk series of length `n`: monotone x, drifting y. */
export function makeSeries(n, seed) {
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

// A result that never escapes a timed loop is dead code to the optimizer, and
// V8 is entitled to skip or reshape it — fatal for a campaign whose headline is
// a JS-only speedup. So every timed callback must return a scalar derived from
// its result, and the timing loops fold that scalar into this accumulator,
// which the runners record into their JSON output. Consumption is identical
// for the WASM and JS arms: one element read plus one add per call.
let sink = 0;

/** Accumulated benchmark sink; runners record it so consumption is auditable. */
export const sinkValue = () => sink;

/**
 * Time `calls` invocations of `fn` as one block; returns ms per call.
 * `fn` must return a scalar derived from its result (see the sink note above).
 */
export function timeBlock(fn, calls) {
  const started = performance.now();
  for (let i = 0; i < calls; i += 1) sink += fn();
  return (performance.now() - started) / calls;
}

/** Async variant of `timeBlock`; `fn` must resolve to a result-derived scalar. */
export async function timeBlockAsync(fn, calls) {
  const started = performance.now();
  for (let i = 0; i < calls; i += 1) sink += await fn();
  return (performance.now() - started) / calls;
}

/** Run `warmups` untimed then `reps` timed blocks; returns ms-per-call samples. */
export function measure(fn, { calls, reps, warmups }) {
  for (let i = 0; i < warmups; i += 1) timeBlock(fn, calls);
  const samples = [];
  for (let i = 0; i < reps; i += 1) samples.push(timeBlock(fn, calls));
  return samples;
}

/** Async variant of `measure` for the public-API arm. */
export async function measureAsync(fn, { calls, reps, warmups }) {
  for (let i = 0; i < warmups; i += 1) await timeBlockAsync(fn, calls);
  const samples = [];
  for (let i = 0; i < reps; i += 1) samples.push(await timeBlockAsync(fn, calls));
  return samples;
}

/**
 * Parity gate, run before any timing of a size cell. The WASM output
 * (interleaved [x0, y0, x1, y1, ...]) and the JS output ({x, y}) must agree
 * exactly — same length, elementwise difference of exactly 0, nothing
 * non-finite — otherwise the runtimes are not comparable and the run must not
 * produce a number at all. Throws on any violation; returns the recorded
 * maxAbsDiff (always 0) on success.
 */
export function assertParity(wasmOut, jsOut, context = "") {
  const where = context ? ` (${context})` : "";
  if (jsOut.x.length !== jsOut.y.length) {
    throw new Error(
      `parity gate${where}: JS x/y lengths differ: ${jsOut.x.length} vs ${jsOut.y.length}`,
    );
  }
  if (wasmOut.length !== 2 * jsOut.x.length) {
    throw new Error(
      `parity gate${where}: output lengths differ: wasm ${wasmOut.length / 2} points vs js ${jsOut.x.length}`,
    );
  }
  let maxAbsDiff = 0;
  for (let i = 0; i < jsOut.x.length; i += 1) {
    maxAbsDiff = Math.max(
      maxAbsDiff,
      Math.abs(wasmOut[i * 2] - jsOut.x[i]),
      Math.abs(wasmOut[i * 2 + 1] - jsOut.y[i]),
    );
  }
  if (!Number.isFinite(maxAbsDiff)) {
    throw new Error(`parity gate${where}: non-finite difference (maxAbsDiff=${maxAbsDiff})`);
  }
  if (maxAbsDiff !== 0) {
    throw new Error(`parity gate${where}: outputs differ (maxAbsDiff=${maxAbsDiff})`);
  }
  return maxAbsDiff;
}

/**
 * Empirical clock granularity: the smallest non-zero delta observed over a
 * spin. Recorded so the analysis can state the quantization floor rather than
 * assume it. Firefox and WebKit report ~1ms here; Chromium and Node far less.
 */
export function probeTimerResolution() {
  let smallest = Infinity;
  for (let i = 0; i < 20_000; i += 1) {
    const a = performance.now();
    let b = performance.now();
    while (b === a) b = performance.now();
    smallest = Math.min(smallest, b - a);
  }
  return smallest;
}
