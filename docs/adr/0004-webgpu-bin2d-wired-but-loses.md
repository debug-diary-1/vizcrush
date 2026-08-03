# ADR 0004 — WebGPU bin2d: wired, correct, opt-in — and slower than WASM at every tested size

- **Status:** Accepted
- **Date:** 2026-07-31
- **Relates to:** ADR 0002 (predicted GPU dispatch overhead would not amortize), ADR 0003 (engine-dependent WASM/JS)

## Context

The repository has carried five WGSL compute-shader drafts since the original
spec, never wired to a dispatch path. ADR 0002 predicted the GPU wouldn't pay
for itself at browser-realistic sizes but never tested the claim. To settle it
with data — and to give the package a real WebGPU story instead of an
aspirational one — we wired the most GPU-favourable draft (`bin2d.wgsl`,
embarrassingly parallel, atomicAdd histogram with workgroup-local
accumulation) into an actual compute path.

## What was built

- `@vizcrush/bin` `src/gpu.ts`: lazy device acquisition with device-loss
  reset, cached pipeline, per-call buffers, full dispatch + readback. Every
  failure mode resolves to `null` and the caller falls back to the wasm/js
  kernel — the GPU path never throws into user code.
- **f64→f32 rebase:** WGSL has no f64. Inputs are rebased against the range
  minimum in f64, then narrowed to f32, so bin assignment stays exact for
  ranges up to ~2^24 distinguishable values per axis even when raw values are
  epoch-millisecond timestamps. Edges returned to callers are always f64.
- Opt-in API: `bin2d(x, y, opts, { backend: "webgpu" })`. Never auto-selected.
- The `.wgsl` file remains the source of truth; a unit test asserts the wired
  string is byte-identical so they cannot drift.

## Measurements

Chrome 150, Apple Silicon (Metal 3), 12 cores. 256×256 grid, 10 reps,
median (and best-of-10 for webgpu, which was noisy). WebGPU timed
**end-to-end**: rebase + upload + dispatch + readback — what a caller pays.
Full data: `benchmarks/results/webgpu-bin2d.json`; harness:
`benchmarks/webgpu-bin2d.html`.

| n    | js core | wasm       | webgpu median | webgpu best |
| ---- | ------- | ---------- | ------------- | ----------- |
| 100K | 2.9ms   | **0.6ms**  | 27.1ms        | 10.6ms      |
| 1M   | 27.7ms  | **3.1ms**  | 220.8ms       | 44.7ms      |
| 5M   | 130.6ms | **14.6ms** | 944.8ms       | 202.9ms     |

Correctness at 500K: totals identical (500,000/500,000), max per-bin
difference 1, sum of absolute differences 14 across 65,536 cells (f32
bin-edge effects), edges bit-identical.

## Findings

1. **The GPU path is correct** — parity with the f64 cores up to a handful of
   f32 boundary assignments.
2. **WASM beats WebGPU by ~15× even taking WebGPU's best-of-10**, at every
   size tested. The upload/dispatch/readback round-trip alone exceeds WASM's
   entire runtime; bin2d is memory-bound, so the GPU's arithmetic throughput
   never becomes the bottleneck it could win on.
3. ADR 0002's prediction is now measured fact on this hardware, not a guess.
4. The webgpu median-vs-best gap (5×) reflects per-call buffer allocation and
   queue scheduling noise. Buffer pooling would narrow it but cannot close a
   15× best-case deficit.

## Decision

- **Ship the WebGPU path as opt-in only.** It is real, tested, and falls back
  silently; callers who want to evaluate it on their own hardware can.
- **Never auto-select `webgpu`**, and never market it as a performance win.
  Docs state the measured numbers.
- **Do not wire the remaining four drafts now.** bin2d was the most
  GPU-favourable candidate; the others (hexbin, quadtree, octree-morton,
  bin3d) share the same round-trip cost with less parallel upside.

## When to revisit

- A workload where data already lives on the GPU (rendering pipelines that
  could consume the grid without readback) — eliminating the readback leg
  changes the arithmetic entirely.
- Chained GPU operations (bin → color-map → render) amortizing one upload.
- Hardware/driver generations that materially cut dispatch overhead.
- If revisited: pool buffers, use mapped-at-creation uploads, and re-measure
  on discrete GPUs before believing anything.
