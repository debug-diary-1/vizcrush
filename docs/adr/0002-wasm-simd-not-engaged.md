# ADR 0002 — WASM/SIMD is not engaged; correct the claims, don't chase intrinsics

- **Status:** Accepted
- **Date:** 2026-05-29
- **Context issue:** #39 (investigation, surfaced by #37 / ADR 0001)

## Context

The `+simd128` WASM build is sold (README, docs, a `stats.rs` doc comment) as the
fast path. The #37 benchmark's control measurement showed `wasm/js ≈ 1.00×` in
Node/V8, which prompted this investigation: is SIMD actually engaged, and does
WASM earn its keep?

## Experiments

Harness: `benchmarks/wasm-boundary.bench.ts` plus a raw simd-vs-scalar rebuild
(downsample + aggregate built with and without `-C target-feature=+simd128`,
bindgen `--target nodejs`, called directly). Node v24.14.1, darwin/arm64,
release profile (`opt-level=3, lto=true, codegen-units=1`).

**1. Is SIMD in the binary?**

- `vizcrush_downsample.wasm` built with `+simd128` is **byte-identical** (same
  SHA-256) to the scalar build. `+simd128` produced _zero_ different code for
  LTTB — no autovectorization.
- `vizcrush_aggregate.wasm` differs slightly (87,911 vs 88,847 bytes) — some
  vectorization happened somewhere in the crate, but see timing below.

**2. SIMD-on vs SIMD-off timing (raw exports):**

| Algorithm     | Size | wasm-simd | wasm-scalar | js core |
| ------------- | ---- | --------- | ----------- | ------- |
| lttb          | 100K | 157µs     | 160µs       | 250µs   |
| lttb          | 1M   | 1.85ms    | 1.81ms      | 1.82ms  |
| lttb          | 10M  | 16.79ms   | 16.61ms     | 16.65ms |
| compute_stats | 1M   | 4.06ms    | 4.03ms      | —       |
| compute_stats | 10M  | 41.15ms   | 40.72ms     | —       |

`simd/scalar ≈ 1.00×` for both algorithms — SIMD makes no runtime difference,
even for the "vectorizable" stats loop. The hot loops are branch-heavy (LTTB:
argmax with `if area > max_area`; stats: `is_finite` skip + min/max branches),
which blocks autovectorization, and there are no explicit SIMD intrinsics in the
Rust. The `stats.rs` doc comment describing a "SIMD pre-scan" was fiction —
removed.

**3. Why wasm/js ≈ 1.00× in the public path.** Raw WASM _does_ beat the JS core
at 100K (157µs vs 250µs, ~1.6×). But the kernel's marshalling overhead (the
boundary copy + deinterleave, see ADR 0001) erases that win in the full public
call. At ≥1M the algorithms are memory-bandwidth bound and raw WASM ≈ JS anyway.

**4. Cold-start.** First-call latency at 1M: wasm 1.91ms vs js 1.92ms (1.00×).
No cold-start advantage at this size in Node.

## Decision

1. **Do not hand-write SIMD intrinsics.** At the input sizes that matter (≥1M)
   these algorithms are memory-bandwidth bound, so vectorizing the compute would
   optimize something that isn't the bottleneck. The small-input win WASM
   already has is eaten by marshalling, not by lack of SIMD.
2. **Keep the `+simd128` flag.** It is harmless (identical or smaller binaries)
   and may help future vectorizable code.
3. **Stop claiming SIMD speedups.** Fixed in this change: the `stats.rs` comment
   and the README headline. WASM is kept, but **not** for "cross-engine
   consistency" — browser benchmarking (ADR 0003) later refuted that. The real
   reason to keep it: WASM is ~4× faster than the JS core in Chromium/V8, the
   dominant engine. It is comparable-to-slower in Firefox/WebKit. Not a SIMD
   advantage either way.

## Consequences / follow-ups

- A fuller audit of WASM/SIMD performance framing across the remaining docs
  (LAUNCH, ARCHITECTURE, getting-started, per-package pages) is **deferred to a
  follow-up issue** — this change fixes only the outright-false claims.
- **The shipped binaries were never run through `wasm-opt`.** `scripts/build-wasm.sh`
  calls `wasm-opt` only _if the tool is present_, and binaryen was not installed,
  so the step was silently skipped (the committed `vizcrush_downsample_bg.wasm` is
  24,031 bytes — the raw rustc/bindgen size).

  **Resolved (#40):** binaryen installed; lead does **not** change finding #1.
  Two sub-findings:
  - The script's invocation was also wrong: `wasm-opt --enable-simd` _fails
    validation_ on current binaryen (v129) because rustc emits `memory.copy`
    and `i32.trunc_sat_*` ops that need `bulk-memory` / `nontrapping-float-to-int`
    enabled too. Fixed to `wasm-opt -O3 -all`, and the step now **fails loudly**
    if binaryen is missing (opt out with `SKIP_WASM_OPT=1`).
  - Re-measured raw-rustc vs `wasm-opt -O3 -all`: **no runtime gain** (lttb
    1.05–1.10×, i.e. marginally slower; compute_stats 1.00×). wasm-opt is a
    **size** optimization (~10–12% smaller: downsample 24,031 → 22,937 bytes),
    not a speed or SIMD one. SIMD still does not engage. Running the fixed
    `build:wasm` will produce the smaller binaries; regenerating + committing the
    shipped artifacts is left to a release build.

- **Browser benchmarking was not run** (no browser tooling in this environment).
  WASM's consistency advantage is a cross-engine claim; the Node results justify
  the docs correction and the "keep WASM" decision regardless, but the browser
  numbers belong in the follow-up.
