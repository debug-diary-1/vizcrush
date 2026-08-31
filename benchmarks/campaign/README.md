# Measurement campaign

The harness, raw data, and analysis behind the WebAssembly-versus-JavaScript
figures this project publishes. It exists so the numbers can be audited and
re-run rather than taken on trust: every claim in [ADR
0003](../../docs/adr/0003-wasm-vs-js-is-engine-dependent.md) and in the write-up
traces to a file in `results/`.

## Why it looks like this

**One protocol module for every arm.** The claim is "same work, different
engine", so the input generation, batch timing, parity gate, and configuration
(sizes, calls per block, reps, warmups, seed) live once in `protocol.mjs`. The
browser harness loads it over HTTP and the Node arm imports it directly —
byte-identical, with nothing to drift.

**Batch timing.** Firefox and WebKit coarsen `performance.now()` to about a
millisecond as a Spectre mitigation, so a single sub-millisecond call is
unmeasurable there. Each measurement runs `N` calls as one timed block and
divides by `N`. In the committed campaign, blocks land between roughly 40 ms
and 500 ms, limiting a 1 ms clock quantum to at most a few percent. Exact call
counts are recorded per size. The harness also probes clock granularity
empirically rather than assuming it.

**Every timed result is consumed.** Work whose result never escapes a timed
loop is dead code to the optimizer, and a JIT is entitled to skip or reshape
it — fatal for a campaign whose headline is a JavaScript-only speedup. Every
timed core callback therefore checksums every x/y output pair, and the timing
loop folds that checksum into a sink that the runners record in their JSON
(`benchmarkSink`). Reading only LTTB's last point would not be sufficient: it
is copied directly from the input and does not depend on the bucket/argmax
work. The WASM and JS checksum loops perform identical reads and arithmetic.
Consequently, `wasm_raw` and `js_core` mean kernel plus complete output
consumption, not an unobserved bare-kernel call.

**Hot steady state, not cold start.** Batch timing measures throughput once
everything is warm. That is the right statistic for "which backend is faster
while running" and the wrong one for one-shot interactive latency: cold first
calls are slower than the JS core in every engine measured.

**Two kinds of dispersion, kept apart.** Within-session spread (timed blocks
inside one browser process) is small and says nothing about reproducibility
across launches. `run-versions.mjs` therefore measures each configuration in
several independent browser launches, and `analyze-versions.mjs` reports the
across-launch range. Confusing the two overstates precision.

**Counterbalanced round-robin build order.** The version sweep interleaves its
launches — session 0 of every build, then session 1 of every build, and so on —
and rotates the first build each session. Over one five-session cycle, every
build occupies every within-round position once. That distributes both slow
machine-state drift and shorter within-round drift across builds instead of
confounding either with build identity.

**A parity gate that gates.** Before any cell is timed, the WebAssembly and
JavaScript outputs must agree exactly: same length, elementwise difference of
exactly zero, nothing non-finite. A violation throws and aborts the run —
no number is produced at all — so a runtime difference can never be a
difference in work done. `maxAbsDiff` is recorded per cell and is `0`
throughout the committed data.

**The copy proxy bounds one cost only.** `copy_proxy` times two `.set()`
calls into preallocated scratch buffers — the bulk copy wasm-bindgen performs
when passing typed arrays into linear memory, and nothing else. It
deliberately excludes allocation and the rest of the marshalling, so it can
rule bulk copying in or out as an explanation and nothing more.

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

`SESSIONS` must be a positive integer. To keep an independent repeat of the
sweep, point `VERSIONS_OUT` at another file and hand it to the analyzer:

```bash
VERSIONS_OUT=versions-run2.json SESSIONS=5 node benchmarks/campaign/run-versions.mjs
node benchmarks/campaign/analyze-versions.mjs results/versions-run2.json
```

The harness itself is under test — statistics, protocol, parity gate, server,
analyzers, and sweep orchestration:

```bash
pnpm exec vitest run benchmarks/campaign
```

Each runner starts its own static server on an ephemeral port, rooted at the
repository, so `/packages/...` resolves to the real workspace packages and the
`.wasm` is served as `application/wasm`.

`run-versions.mjs` is Chromium-only. Playwright's Firefox and WebKit
distributions launch through a `pw_run.sh` wrapper rather than a browser
executable, so pointing `executablePath` at a specific cached build hangs
instead of launching.

## Obtaining the historical Chromium builds

`run-versions.mjs` sweeps whatever Chromium builds sit in Playwright's browser
cache (`~/Library/Caches/ms-playwright` on macOS, `~/.cache/ms-playwright` on
Linux, `%LOCALAPPDATA%\ms-playwright` on Windows; override with
`PLAYWRIGHT_BROWSERS_PATH`). `pnpm exec playwright install` fetches only the
build pinned by the Playwright version in this repo, so the historical builds
must be installed deliberately. On a machine whose cache holds unrelated
builds, pin the target set explicitly — an unknown name fails loudly rather
than being dropped:

```bash
SWEEP_BUILDS=chromium-1200,chromium-1208,chromium-1223,chromium-1228,chromium-1234 \
  SESSIONS=5 node benchmarks/campaign/run-versions.mjs
```

(or point `PLAYWRIGHT_BROWSERS_PATH` at a cache dedicated to the sweep).

Each Playwright release pins exactly one Chromium build, recorded in that
release's `playwright-core/browsers.json`. Installing a historical release's
browser into the shared cache adds the matching `chromium-<build>` directory.
The committed sweep used five builds, installable with:

```bash
# PLAYWRIGHT_SKIP_BROWSER_GC=1 stops newer installs from deleting older builds.
export PLAYWRIGHT_SKIP_BROWSER_GC=1
pnpm dlx playwright-core@1.57.0 install chromium   # chromium-1200 = 143.0.7499.4
pnpm dlx playwright-core@1.58.0 install chromium   # chromium-1208 = 145.0.7632.6
pnpm dlx playwright-core@1.60.0 install chromium   # chromium-1223 = 148.0.7778.96
pnpm dlx playwright-core@1.61.0 install chromium   # chromium-1228 = 149.0.7827.55
pnpm dlx playwright-core@1.62.0 install chromium   # chromium-1234 = 151.0.7922.34
```

To find the release that pins some other build, check `browsers.json` of
candidate releases (e.g. `https://unpkg.com/playwright-core@<release>/browsers.json`).
Any set of two or more builds straddling a suspected boundary is enough to
run the sweep; the exact five above are only needed to reproduce the committed
table. The sweep discovers builds in the Linux, Windows, and both macOS cache
layouts.

## What is in `results/`

| File                 | Contents                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| `raw.json`           | Per-repetition samples, three engines, current builds                                                 |
| `analyzed.json`      | Medians, IQR, within-session bootstrap intervals, ratios                                              |
| `node.json`          | Node arm, same protocol                                                                               |
| `versions.json`      | Version sweep: five Chromium builds x five independent launches, with per-repetition samples retained |
| `versions-run2.json` | An independent repeat of the whole sweep, so its reproducibility is auditable rather than asserted    |

Committed results are the exact bytes their generators wrote (the formatter is
told to leave `results/` alone), so `node benchmarks/campaign/analyze.mjs`
regenerates `analyzed.json` bit-for-bit from the committed `raw.json` — the
test suite checks this equality on every run. Both analyzers reject incomplete
or corrupt artifacts before reporting: the engine analyzer requires all three
named browsers, and the version analyzer derives its comparisons from retained
raw samples while checking every stored median and minimum against them.

## The result that motivated the sweep

A previously published figure said WebAssembly was "about 4x faster in
Chromium". It stopped reproducing. Rather than leave that as an unexplained
discrepancy, the sweep holds the harness, machine, seed, statistic, and launch
procedure fixed and varies only the engine binary:

| Chromium      | js core (ms) | wasm (ms) | wasm/js |
| ------------- | ------------ | --------- | ------- |
| 143.0.7499.4  | 6.15         | 1.60      | 0.26    |
| 145.0.7632.6  | 6.16         | 1.58      | 0.26    |
| 148.0.7778.96 | 6.09         | 1.59      | 0.26    |
| 149.0.7827.55 | 1.81         | 1.58      | 0.88    |
| 151.0.7922.34 | 1.80         | 1.60      | 0.89    |

Builds 143 through 148 reproduce the old result, which validates the current
harness against the older measurement. The JavaScript baseline then improves
3.36x at the 148/149 boundary while the WebAssembly path stays flat. The old
number was correct for its engine and expired when V8 improved underneath it.
An independent repeat of the whole sweep (`versions-run2.json`) puts the step
at 3.35x with per-build median ratios within 0.03 of the first run — and because
every timed result's full output now feeds the benchmark sink, the step cannot
be an artifact of the optimizer preserving only LTTB's copied endpoint while
discarding unobserved bucket work.

The practical lesson, and the reason this directory exists: a performance claim
about a JIT-compiled host is a claim about a specific engine build. Prefer
direction and range over a single magnitude, and prefer a harness a reader can
run over a number in a README.
