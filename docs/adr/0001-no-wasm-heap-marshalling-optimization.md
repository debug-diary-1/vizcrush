# ADR 0001 — Do not build a wasm-heap marshalling optimization

- **Status:** Accepted
- **Date:** 2026-05-29
- **Context issue:** #37 (speculative, benchmark-first)
- **Supersedes the removed `zero-copy.ts` module:** #35

## Context

The kernel marshals input typed arrays across the JS↔WASM boundary via
wasm-bindgen's `passArrayF64ToWasm0`, which `malloc`s a buffer in WASM linear
memory and copies the bytes in (`getFloat64ArrayMemory0().set(arg, ptr/8)`) on
every call. Issue #37 proposed a benchmark to decide whether eliminating that
copy — by letting callers write directly into a reused wasm-heap buffer
("prototype A") — was worth a public API change. The go/no-go bar was a **≥15%
end-to-end win on ≥1M-point calls**.

## Measurement

Benchmark `benchmarks/wasm-boundary.bench.ts`, Node v24.14.1, darwin/arm64.
Per algorithm we measured the full forced-WASM call, the equivalent pure-JS
core, and the inbound copy (a `Float64Array.set` of the same size — a faithful
proxy for `passArrayF64ToWasm0`).

| Algorithm     | Size | wasm full | js core   | copy/wasm | wasm/js |
| ------------- | ---- | --------- | --------- | --------- | ------- |
| lttb          | 1M   | 1.89ms    | 1.87ms    | 23.4%     | 1.01×   |
| lttb          | 10M  | 17.36ms   | 17.33ms   | 23.5%     | 1.00×   |
| bin2d         | 1M   | 8.16ms    | 8.13ms    | 4.1%      | 1.00×   |
| bin2d         | 10M  | 79.91ms   | 79.72ms   | 4.9%      | 1.00×   |
| buildQuadtree | 1M   | 147.15ms  | 147.68ms  | 0.2%      | 1.00×   |
| buildQuadtree | 10M  | 1563.73ms | 1552.19ms | 0.3%      | 1.01×   |

Two findings:

1. **`wasm/js ≈ 1.00×` everywhere.** In Node/V8 the WASM path is not faster than
   the pure-JS core for these algorithms — the JIT matches the SIMD build.
2. **The copy is only a meaningful fraction for `lttb` (~23%).** For `bin2d`
   (~5%) and `buildQuadtree` (~0.2%), compute dominates and the copy is noise.

## Decision

**Do not build prototype A (a wasm-heap / reused-buffer marshalling path) at this
time, and make no public API change.**

The end-to-end bar is not met:

- For **one-shot calls** (data originates on the JS heap), the inbound copy is
  unavoidable regardless of API — you must get the bytes into linear memory
  somehow. Removing the bindgen copy just moves it.
- The copy is only ≥15% of the call for `lttb`, and there `wasm ≈ js`, so even a
  perfect copy-elimination would merely let the WASM path match-then-slightly-
  beat the JS core we already ship — not deliver a user-visible end-to-end win.
- For the compute-bound algorithms the copy is already negligible.

## Consequences

- The boundary copy stays. The kernel's direct typed-array marshalling remains
  the honest "zero-copy across the language boundary" story (a single bulk
  memcpy, no per-element boxing).
- `benchmarks/wasm-boundary.bench.ts` is kept as the harness that produced this
  decision, so the question can be re-measured if conditions change.

## When to revisit

- **A concrete streaming / per-frame use case for `lttb`** where the _same_
  buffer is re-downsampled many times. Buffer reuse is the one scenario where
  prototype A could yield a real (~20% on `lttb`) win, because the malloc+copy
  amortizes across calls. Build it then, gated on that use case — not before.
- **A surprising separate finding (out of scope for #37):** WASM provides ~no
  speedup over JS in Node for these algorithms. Worth its own investigation
  (is SIMD actually engaged? bindgen call overhead? V8 simply this good?), and
  it matters more for the library's value proposition than copy-elimination
  does. This ADR does not decide that question.
