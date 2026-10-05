# PRD: Interactive streaming time-series viewport

Status: proposed for review. Target: the first supported adoption workflow for Vizcrush.

## Problem Statement

An application developer can install a downsampling primitive, but still has to design raw-data ownership, viewport filtering, streaming retention, worker messaging, stale-result handling, and renderer updates. Examples demonstrate these pieces separately. A Promise-returning API does not keep synchronous preprocessing off the UI thread, and bounded history alone does not bound queued work or per-update allocations. Availability-based WASM selection also does not establish that the selected path is fastest.

The user needs to explore a million-point time series while new data arrives, with predictable memory ownership and responsive controls, without designing a second data-processing framework around Vizcrush.

## Solution

Provide a reusable, renderer-independent time-series session in the existing downsampling package, plus a persistent-worker adapter and one complete Canvas demonstration. The session retains bounded paired typed-array history, selects the visible domain, reduces to a pixel-derived point budget, and returns data with actual execution diagnostics. The demo supports pan, zoom, resize, continuous ingestion, pause, resume, reset, and following the newest data.

Build on existing algorithms, worker examples, and packaged-browser verification. Promote a single adoption path after its behavior and limits are tested. Do not create another charting API or promise a universal frame rate.

## User Stories

1. As an application developer, I want to install the existing downsampling package, so that adopting this workflow does not require an umbrella dependency.
2. As an application developer, I want a small session API, so that raw history and viewport reduction have one owner.
3. As an application developer, I want explicit typed-array ownership, so that I know whether input buffers remain usable.
4. As an application developer, I want validated paired, ordered data, so that invalid ingestion cannot silently corrupt my chart.
5. As a dashboard user, I want to load one million time-series points, so that I can explore the original signal.
6. As a dashboard user, I want to pan and zoom over a visible domain, so that detail reflects the region I am inspecting.
7. As a dashboard user, I want resizing to adjust the point budget, so that rendering work follows the available pixels.
8. As an application developer, I want meaningful empty, singleton, duplicate-timestamp, and boundary behavior, so that sparse and unusual windows remain correct.
9. As an application developer, I want viewport-edge neighbors preserved within the point budget, so that a line can cross the visible boundary correctly.
10. As a dashboard user, I want only the latest requested viewport painted, so that rapid navigation cannot display stale results.
11. As an application developer, I want preprocessing and retained history in a persistent worker, so that repeated interactions do not repeatedly transfer the full dataset.
12. As an application developer, I want a bounded request queue, so that a burst of viewport events cannot create unbounded work.
13. As an application developer, I want explicit worker errors and disposal, so that pending callers settle and resources can be released.
14. As an application developer, I want continuous append with fixed retention capacity, so that a long session cannot accumulate unlimited history.
15. As an application developer, I want ingestion backpressure, so that producer speed cannot silently turn into an unbounded message queue.
16. As a dashboard user, I want to follow the newest data or inspect older retained data, so that new arrivals do not unexpectedly move my viewport.
17. As a dashboard user, I want pause, resume, and reset controls, so that I can inspect data and repeat a scenario.
18. As an application developer, I want requested and actual backend information with decision reasons, so that I can distinguish configuration from execution.
19. As an application developer, I want explicit JS and WASM overrides, so that I can reproduce backend behavior and failures.
20. As an application developer, I want timing boundaries labeled accurately, so that worker compute, message round trip, and rendering are not conflated.
21. As an application developer, I want retained buffer and queue accounting, so that I can verify the stated bounds without confusing it with total browser heap.
22. As an evaluator, I want a seeded scenario and downloadable local results, so that repeated comparisons use the same data and protocol.
23. As an application developer, I want the packed npm artifacts exercised in Chromium, Firefox, and WebKit, so that workspace aliases cannot hide integration failures.
24. As an application developer, I want a complete copyable integration and ownership guide, so that I can replace the synthetic producer with my own source.
25. As a reader, I want backend documentation consistent with the new SIMD investigation, so that I do not adopt based on a retracted performance explanation.
26. As a keyboard user, I want labeled navigation and stream controls, so that the demonstration is usable without pointer gestures.

## Implementation Decisions

- Modules: (1) bounded time-series session owning paired storage, validation, viewport selection, reduction and diagnostic results; (2) worker client/host owning transport, lifecycle, transfer ownership and bounded scheduling; (3) example controller owning user interactions and a Canvas renderer consuming only reduced data; (4) a scenario runner using the same public session path and retaining measurements.
- Add explicit subpath exports to the existing downsampling package. Preserve existing primitive signatures, thresholds and behavior. Keep renderer dependencies out of the library. The worker entry belongs to the consuming application and installs the library host, giving bundlers a statically analyzable worker entry.
- Use the existing LTTB kernel initially. An independent JS implementation is already available through the same kernel. Do not introduce a new algorithm, fast-math mode, or persistent Wasm heap API in this milestone.
- The synchronous session can run in any supported JS environment; the worker adapter is the documented browser adoption path. Do not silently fall back to main-thread processing when worker creation fails.
- A session has configurable fixed point capacity, a fixed maximum ingestion batch, and a fixed maximum output budget. Proposed demo defaults: 1,000,000 retained points, 65,536 points per accepted batch, and 20,000 maximum returned points. Oversized initial histories retain the newest capacity points only after validating the complete input.
- Store x/y in paired Float64Array buffers. Use fixed-capacity circular storage and reusable scratch space where needed; return independently owned result buffers. Account for retained source, scratch, result and pending-transfer buffers separately. Bounded allocation is the contract, not zero allocation or a total-heap guarantee.
- Accept equal-length arrays of finite coordinates with nondecreasing x. Duplicate timestamps preserve input order. A batch with invalid coordinates, lengths, ordering, or configuration is rejected without partially changing session state. Appends cannot precede the last retained timestamp. Non-finite gaps and out-of-order ingestion are intentionally unsupported initially and documented.
- Input copy is the safe default. Explicit transfer mode relinquishes ownership of dedicated ArrayBuffers; document detached-buffer behavior and reject unsupported shared/aliased transfer layouts. Outputs are owned by the caller and can be passed to the renderer directly.
- A viewport specifies an inclusive finite x-domain, CSS width and device-pixel ratio. Derive a bounded output target from physical width, retain immediate edge neighbors when needed for line continuity, and include those neighbors inside the overall budget. Zero width returns an empty result. Degenerate and tiny budgets are handled explicitly rather than letting an algorithm's early return violate the bound.
- Each session generation and viewport request has an identity; results also identify the source revision. Replacing/resetting a session invalidates old results. A viewport response may reflect an earlier acknowledged append revision, but may never overwrite a newer viewport request. This avoids starving rendering during continuous ingestion.
- Bound viewport scheduling to one outstanding worker request and one replaceable latest pending viewport. Superseded promises settle with a documented cancellation result/error. This does not imply preemption of a synchronous Wasm call already running.
- Serialize mutations and views consistently. Permit only one unacknowledged ingestion batch; a producer must await acknowledgement before submitting another, or receive an explicit busy/backpressure error before its buffers are detached. Bound all library-owned queues, including reset/dispose interactions.
- Disposal is idempotent. It terminates owned workers, rejects outstanding operations, and prevents later callbacks from publishing results. Worker startup/runtime failures settle all affected requests and appear in the demo.
- Follow-latest is a controller behavior, independent from retained storage. Panning disables it; an explicit control resumes it. Inspecting an evicted domain produces an explained empty/clipped view rather than silently jumping to the newest data.
- Diagnostics identify requested backend, actual backend and reason (explicit override, existing size threshold, loaded WASM, or WASM unavailable). Cases that do not run a kernel report that fact. Do not call capability detection evidence that a WASM kernel ran or expose raw loader exceptions as diagnostic data.
- Keep global auto-selection unchanged in this milestone. Surface its limitation honestly and measure forced variants on the new caller path. Engine/device calibration, crossover estimates and persistent calibration caches require a subsequent evidence-based decision.
- Generate the large synthetic dataset in the worker. Use a documented deterministic generator and explicit stream rate. The renderer scales x by actual timestamps, not output index, and allocates renderer-specific objects only after reduction.
- Record initialization separately from warmed scenarios. Export per-run samples, source revision, package/browser versions, scenario parameters and actual backend. Measure worker processing, caller round trip and caller-to-render completion separately; frame gaps describe observed behavior, not isolated kernel cost. No telemetry is sent remotely.
- Correct the broad byte-identical SIMD statement and unsupported causal explanations in backend guidance, preserving historical ADR context with a clear correction/addendum rather than silently rewriting historical measurements.

## Testing Decisions

Test externally observable behavior rather than private fields, call order, or class layout. Use existing Vitest/fast-check patterns for session properties, the shared kernel parity harness for actual execution, and the packed-browser workflow for consumer behavior.

- Session behavior: validation is atomic; retention agrees with a simple reference history after wraparound; timestamp/value pairing and order survive reduction; output respects budget; empty/singleton/duplicate/boundary cases are correct; returned buffers remain valid after later session operations; backend overrides and reasons agree with actual execution.
- Worker behavior: real transfer ownership, delayed-response ordering, superseded requests, bounded ingestion, append/view/reset races, startup failures and idempotent disposal. Use deterministic controlled transports for ordering and real browser workers for transport and packaging behavior.
- Demo flow: load, pan, zoom, resize, stream, pause, follow-latest, reset, backend override and keyboard controls. Assert data and current-request identity, not screenshot pixels or timing thresholds on shared CI.
- Bounds: stream beyond retention capacity and issue navigation bursts; verify retained buffers and outstanding requests remain within the stated formulas. Include app-owned source generation and result retention in the scenario accounting. Distinguish these deterministic bounds from garbage-collector-dependent browser heap.
- Performance: run seeded 1M-point scenarios and a steady-state stream after retention fills in Chromium, Firefox and WebKit. Record p50/p95 round-trip/render latencies and frame gaps with raw samples, cold/warm separation and actual backend. Treat a provisional 100 ms p95 interaction target on the recorded development machine as an experiment target, not a portable claim or flaky CI gate. Investigate and document misses before promoting responsiveness claims.
- Required checks: targeted tests during each slice, package type/build checks, formatting/lint, packed-browser integration for shipped exports, and existing repository regression checks appropriate to the final code changes. No tests that merely assert revised documentation text.

## Out of Scope

- Umbrella package, package rename, new renderer framework, or new charting grammar.
- First-class ChartGPU/deck.gl adapter packages; existing examples remain available.
- WebGPU kernels, GPU-resident interoperability, handwritten SIMD, kernel-only pointer APIs, or algorithm redesign.
- Anonymous telemetry collection, hosted benchmark aggregation, device fingerprinting, backend leaderboards, automatic calibration or globally revised backend defaults.
- WebSocket server, generic backend service, MCP/AI features, Parquet ingestion, multiseries alignment, non-finite gap semantics or arbitrary out-of-order streams.
- Repairing or redesigning all existing streaming-statistics/sketch APIs; this session owns paired time-series history and does not revive the deprecated appendAndDownsample function.
- Automatic npm release, production deployment or merging implementation PRs without a separate publication instruction.

## Further Notes

The existing project already has integration examples and a worker transfer example. This milestone connects those into a supported lifecycle and proves the caller-visible bounds. A smaller typed-array result alone is not sufficient evidence of an interactive application.

The backlog was empty when checked. Use GitHub issues in debug-diary-1/vizcrush, with enhancement/documentation labels and ready-for-agent for approved implementation stories. Preserve existing ADRs and package vocabulary; no repository-wide agent configuration scaffolding is needed to implement the feature.

Planning approval covers the proposed module boundaries, behavioral tests and vertical slices. Execution then proceeds in dependency order through focused reviewable PRs. Final merge/release remains separately controlled.
