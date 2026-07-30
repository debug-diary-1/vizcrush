# ADR 0003 — WASM vs JS is engine-dependent; the "consistency" rationale was wrong

- **Status:** Accepted
- **Date:** 2026-05-29
- **Context issue:** #43 (browser benchmarking — the deferred part of #40)
- **Corrects:** ADR 0002 and the README, which claimed WASM's benefit is "cross-engine consistency." The browser data refutes that.

## Context

#37/#39 measured Node/V8 only, where WASM ≈ JS. ADR 0002 kept WASM on the
assumption that its real value is **cross-engine consistency**. #43 was filed to
test that in actual browsers. It is now tested.

## Method

`playwright-core` driving the locally-cached browser binaries (no MCP, no
download): Chromium (V8), Firefox Nightly rv:144 (SpiderMonkey), WebKit 2227
(JavaScriptCore). Raw wasm-bindgen `lttb` vs the JS `lttbCore`, served over a
local HTTP server, timed in-page.

Firefox and WebKit **coarsen `performance.now()` to ~1ms** (Spectre mitigation),
which made per-call timing useless (0µs / round-ms). Fixed with **batch timing**:
run N calls as one block, take the min over several reps, divide by N — so the
effective resolution is timer/N.

## Results (LTTB, batch-timed)

| Engine                  | Size | wasm   | js core | wasm/js   |
| ----------------------- | ---- | ------ | ------- | --------- |
| Chromium (V8)           | 100K | 150µs  | 643µs   | **0.23×** |
| Chromium (V8)           | 1M   | 1.52ms | 6.03ms  | **0.25×** |
| Firefox (SpiderMonkey)  | 100K | 1.97ms | 268µs   | 7.37×     |
| Firefox (SpiderMonkey)  | 1M   | 17.2ms | 2.13ms  | **8.09×** |
| WebKit (JavaScriptCore) | 100K | 188µs  | 142µs   | 1.32×     |
| WebKit (JavaScriptCore) | 1M   | 1.98ms | 1.38ms  | **1.44×** |

Cold-start (single first call, 1M): wasm slower than JS in every engine
(Chromium 1.18×, WebKit 2.0×, Firefox 4.5×) — the WASM instantiation/JIT warmup
cost.

## Caveats (read before quoting absolute numbers)

- **Within-engine wasm/js ratios are the trustworthy output.** Absolute numbers
  are runtime/engine-dependent: headless-Chromium's JS core (6ms) is ~3× slower
  than Node's JS core (1.8ms, #39) on the same V8 — so don't compare absolutes
  across runtimes.
- **Firefox's wasm (17ms) is a ~10× outlier vs Chromium's wasm (1.5ms).** Likely
  SpiderMonkey's wasm-bindgen array marshalling / allocation per call, not pure
  compute. Flagged, not fully root-caused. The qualitative conclusion does not
  depend on it (WebKit also shows wasm slower, cleanly).

## Findings

1. **wasm/js is NOT consistent across engines** — it ranges from 4× _faster_
   (Chromium) to ~8× _slower_ (Firefox). The JS core is, if anything, the _more_
   consistent of the two (1.4–6ms across engines vs wasm's 1.5–17ms).
2. WASM is a **decisive win in V8/Chromium** (~4×), the dominant browser engine.
3. WASM is **comparable-to-slower in Firefox and WebKit**, and **slower cold** in
   all engines.

## Decision

- **Keep WASM.** It wins ~4× in Chromium/V8, which is most users. Removing it
  would regress the common case.
- **Retract the "cross-engine consistency" rationale** (ADR 0002 / README). It is
  the opposite of true. The honest framing is: _WASM is substantially faster than
  the JS fallback in Chromium/V8, and comparable-to-slower in Firefox/Safari._
  README updated accordingly.
- **No uniform-speedup claim**, consistent with ADR 0002.

## When to revisit

- **Size/engine-aware dispatch:** the kernel could prefer the JS core on
  SpiderMonkey/JSC (where it's faster) and WASM on V8. Real but speculative —
  needs the Firefox-wasm-outlier root-caused first, and a value case beyond a
  micro-benchmark. Out of scope here.
- **Root-cause the Firefox wasm 10× slowdown** (marshalling vs compute) before
  any per-engine dispatch work.
