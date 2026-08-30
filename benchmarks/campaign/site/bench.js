// Browser arm of the campaign. The protocol — input generation, batch timing,
// benchmark sink, parity gate, configuration — lives in ../protocol.mjs and is
// shared byte-for-byte with the Node arm; this file only binds it to the four
// implementations measured per (engine, size), keeping EVERY repetition so the
// analysis can report dispersion rather than a bare minimum:
//
//   wasm_raw    raw wasm-bindgen `lttb` export
//   js_core     the shipped pure-JS `lttbCore`
//   copy_proxy  two `.set()`s into PREALLOCATED scratch buffers of the same
//               size — a proxy for the bulk copy wasm-bindgen performs when
//               passing typed arrays into linear memory. It deliberately
//               excludes allocation and the rest of the marshalling, so it can
//               rule bulk copying in or out and nothing more. This is the
//               probe for the SpiderMonkey outlier: if bulk copying explained
//               it, copy_proxy would track the gap. It does not.
//   public_api  the library's async public call (forced wasm), i.e. what an
//               application actually pays.
//
// Every timed callback returns the last y value of its output, which the
// shared timing loop folds into an observable sink; without that, work whose
// result never escapes is eligible for dead-code elimination.

import initWasm, { lttb as wasmLttb } from "/packages/downsample/wasm/vizcrush_downsample.js";
import { lttbCore } from "/packages/downsample/dist/cores.js";
import { downsampleKernels } from "@vizcrush/downsample";
import {
  THRESHOLD,
  assertParity,
  makeSeries,
  measure,
  measureAsync,
  probeTimerResolution,
  sinkValue,
} from "../protocol.mjs";

/**
 * Run the full campaign in this browser: for each size, gate parity, then
 * measure all four implementations. Returns the raw per-repetition samples
 * plus environment metadata; throws (failing the whole run) if the parity
 * gate rejects.
 */
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

    // Correctness gate: the two implementations must agree exactly before
    // their timings are comparable at all. A mismatch aborts the run.
    const wasmOut = wasmLttb(x, y, THRESHOLD);
    const jsOut = lttbCore(x, y, THRESHOLD);
    const maxAbsDiff = assertParity(wasmOut, jsOut, `n=${n}`);
    const last = jsOut.x.length - 1;

    const opts = { calls, reps, warmups };
    const scratchX = new Float64Array(n);
    const scratchY = new Float64Array(n);

    out.sizes.push({
      n,
      calls,
      asyncCalls,
      outputLength: jsOut.x.length,
      maxAbsDiff,
      wasm_raw: measure(() => wasmLttb(x, y, THRESHOLD)[2 * last + 1], opts),
      js_core: measure(() => lttbCore(x, y, THRESHOLD).y[last], opts),
      copy_proxy: measure(() => {
        scratchX.set(x);
        scratchY.set(y);
        return scratchY[n - 1];
      }, opts),
      public_api: await measureAsync(
        () => downsampleKernels.lttb(x, y, THRESHOLD, { backend: "wasm" }).then((r) => r.y[last]),
        { calls: asyncCalls, reps, warmups },
      ),
    });
  }

  out.benchmarkSink = sinkValue();
  return out;
}

globalThis.__runCampaign = run;
