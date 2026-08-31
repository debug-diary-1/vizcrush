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
// N calls as one timed block and divide by N. The committed cells land between
// roughly 40ms and 500ms per block, limiting a 1ms clock quantum to at most a
// few percent; exact calls-per-block are recorded with every size.
//
// This measures hot steady-state throughput, NOT one-shot interactive latency:
// cold first calls are slower than JS in every engine we have measured.

/** LTTB output threshold used by every measurement in the campaign. */
export const THRESHOLD = 1000;

/**
 * Input sizes with calls-per-timed-block, chosen to turn sub-millisecond calls
 * into blocks lasting tens to hundreds of milliseconds. `asyncCalls` is lower
 * because the public API adds promise machinery per call.
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
// a JS-only speedup. Reading only LTTB's final point is insufficient because
// that endpoint is copied directly from the input and does not depend on the
// bucket/argmax work. Every timed core callback therefore returns a checksum of
// every output point, and the timing loops fold it into this accumulator. The
// WASM and JS checksum loops perform the same reads and arithmetic per point.
let sink = 0;

/** Accumulated benchmark sink; runners record it so consumption is auditable. */
export const sinkValue = () => sink;

/**
 * Checksum an interleaved WASM result, reading every x/y output pair in order.
 * The matching split-output helper below performs identical arithmetic.
 */
export function checksumInterleaved(output) {
  if (output.length % 2 !== 0) {
    throw new Error(`cannot checksum odd interleaved output length ${output.length}`);
  }
  let checksum = 0;
  for (let i = 0; i < output.length; i += 2) checksum += output[i] * 0.5 + output[i + 1];
  if (!Number.isFinite(checksum)) throw new Error("interleaved output checksum is not finite");
  return checksum;
}

/** Checksum a split JS result, reading every x/y output pair in order. */
export function checksumSplit(output) {
  if (output.x.length !== output.y.length) {
    throw new Error(
      `cannot checksum split output with lengths ${output.x.length}/${output.y.length}`,
    );
  }
  let checksum = 0;
  for (let i = 0; i < output.x.length; i += 1) checksum += output.x[i] * 0.5 + output.y[i];
  if (!Number.isFinite(checksum)) throw new Error("split output checksum is not finite");
  return checksum;
}

/**
 * Time `calls` invocations of `fn` as one block; returns ms per call.
 * `fn` must return a scalar derived from its result (see the sink note above).
 */
export function timeBlock(fn, calls) {
  const started = performance.now();
  for (let i = 0; i < calls; i += 1) sink += fn();
  const perCall = (performance.now() - started) / calls;
  if (!Number.isFinite(sink)) throw new Error("benchmark sink is not finite");
  return perCall;
}

/** Async variant of `timeBlock`; `fn` must resolve to a result-derived scalar. */
export async function timeBlockAsync(fn, calls) {
  const started = performance.now();
  for (let i = 0; i < calls; i += 1) sink += await fn();
  const perCall = (performance.now() - started) / calls;
  if (!Number.isFinite(sink)) throw new Error("benchmark sink is not finite");
  return perCall;
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
 * Gate parity and measure the three synchronous metrics shared by the browser
 * and Node arms. Keeping this binding in the protocol module prevents output
 * consumption, copy-proxy behavior, or metric order from drifting by runtime.
 */
export function measureCoreCell({ x, y, calls, reps, warmups, wasmLttb, jsLttb }) {
  const wasmOut = wasmLttb(x, y, THRESHOLD);
  const jsOut = jsLttb(x, y, THRESHOLD);
  const maxAbsDiff = assertParity(wasmOut, jsOut, `n=${x.length}`);
  const opts = { calls, reps, warmups };
  const scratchX = new Float64Array(x.length);
  const scratchY = new Float64Array(y.length);

  return {
    outputLength: jsOut.x.length,
    maxAbsDiff,
    wasm_raw: measure(() => checksumInterleaved(wasmLttb(x, y, THRESHOLD)), opts),
    js_core: measure(() => checksumSplit(jsLttb(x, y, THRESHOLD)), opts),
    copy_proxy: measure(() => {
      scratchX.set(x);
      scratchY.set(y);
      return scratchX[0] + scratchX[x.length - 1] + scratchY[0] + scratchY[y.length - 1];
    }, opts),
  };
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
  for (let i = 0; i < 1_000; i += 1) {
    const a = performance.now();
    let b = performance.now();
    while (b === a) b = performance.now();
    smallest = Math.min(smallest, b - a);
  }
  return smallest;
}
