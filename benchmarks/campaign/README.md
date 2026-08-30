# Measurement campaign

The harness, raw data, and analysis behind the WebAssembly-versus-JavaScript
figures this project publishes. It exists so the numbers can be audited and
re-run rather than taken on trust: every claim in [ADR
0003](../../docs/adr/0003-wasm-vs-js-is-engine-dependent.md) and in the write-up
traces to a file in `results/`.

## Why it looks like this

**Batch timing.** Firefox and WebKit coarsen `performance.now()` to about a
millisecond as a Spectre mitigation, so a single sub-millisecond call is
unmeasurable there. Each measurement runs `N` calls as one timed block and
divides by `N`, with `N` chosen so a block lands near 100 ms in the slowest
engine. The harness also probes the clock granularity empirically and records
it, rather than assuming it.

**Hot steady state, not cold start.** Batch timing measures throughput once
everything is warm. That is the right statistic for "which backend is faster
while running" and the wrong one for one-shot interactive latency: cold first
calls are slower than the JS core in every engine measured.

**Two kinds of dispersion, kept apart.** Within-session spread (timed blocks
inside one browser process) is small and says nothing about reproducibility
across launches. `run-versions.mjs` therefore measures each configuration in
several independent browser launches, and `analyze-versions.mjs` reports the
across-launch range. Confusing the two overstates precision.

**A parity gate before every timing.** The WebAssembly and JavaScript outputs
must agree exactly before their runtimes are compared, so a performance
difference can never be a difference in work done. `maxAbsDiff` is recorded per
cell and is `0` throughout.

## Running it

Requires the workspace to be built (`pnpm build`), since the harness loads the
real `packages/*/dist` and `packages/*/wasm` artifacts, and Playwright browsers
(`pnpm exec playwright install`).

```bash
node benchmarks/campaign/run-engines.mjs    # Chromium, Firefox, WebKit -> results/raw.json
node benchmarks/campaign/run-node.mjs       # same protocol in Node      -> results/node.json
node benchmarks/campaign/analyze.mjs        # medians, IQR, CIs          -> results/analyzed.json

SESSIONS=5 node benchmarks/campaign/run-versions.mjs   # engine-version sweep -> results/versions.json
node benchmarks/campaign/analyze-versions.mjs          # across-launch ranges, step detection
```

Each runner starts its own static server on an ephemeral port, rooted at the
repository, so `/packages/...` resolves to the real workspace packages and the
`.wasm` is served as `application/wasm`.

`run-versions.mjs` is Chromium-only. Playwright's Firefox and WebKit
distributions launch through a `pw_run.sh` wrapper rather than a browser
executable, so pointing `executablePath` at a specific cached build hangs
instead of launching.

## What is in `results/`

| File            | Contents                                                                                              |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| `raw.json`      | Per-repetition samples, three engines, current builds                                                 |
| `analyzed.json` | Medians, IQR, within-session bootstrap intervals, ratios                                              |
| `node.json`     | Node arm, same protocol                                                                               |
| `versions.json` | Version sweep: five Chromium builds x five independent launches, with per-repetition samples retained |

## The result that motivated the sweep

A previously published figure said WebAssembly was "about 4x faster in
Chromium". It stopped reproducing. Rather than leave that as an unexplained
discrepancy, the sweep holds the harness, machine, seed, statistic, and launch
procedure fixed and varies only the engine binary:

| Chromium      | js core (ms) | wasm (ms) | wasm/js |
| ------------- | ------------ | --------- | ------- |
| 143.0.7499.4  | 6.16         | 1.57      | 0.26    |
| 145.0.7632.6  | 6.15         | 1.53      | 0.25    |
| 148.0.7778.96 | 5.99         | 1.52      | 0.25    |
| 149.0.7827.55 | 1.79         | 1.55      | 0.87    |
| 151.0.7922.34 | 1.82         | 1.60      | 0.88    |

Builds 143 through 148 reproduce the old result, which validates the current
harness against the older measurement. The JavaScript baseline then improves
3.34x at the 148/149 boundary while the WebAssembly path stays flat. The old
number was correct for its engine and expired when V8 improved underneath it.

The practical lesson, and the reason this directory exists: a performance claim
about a JIT-compiled host is a claim about a specific engine build. Prefer
direction and range over a single magnitude, and prefer a harness a reader can
run over a number in a README.
