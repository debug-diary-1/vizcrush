# Implementation stories: Interactive streaming time-series viewport

Status: proposed for review. Parent: [PRD](streaming-viewport-prd.md).

All slices are AFK implementation work once this breakdown is accepted. Each produces a focused, verifiable PR; this classification does not authorize production deployment, npm release, or merging.

## 1. Explain actual backend execution in a working integration

Type: AFK. Blocked by: none. User stories: 18, 19, 20, 25. Status: done, shipped in PR #65 (commit b22943a) on main.

### What to build

Extend the existing kernel diagnostic result with a stable decision reason, preserve all existing dispatch behavior, and display actual execution in the existing worker integration. Correct backend guidance and add an explicitly scoped historical correction for the SIMD/bandwidth claims. This is independently useful before the new session ships.

### Acceptance criteria

- [x] Explicit JS/WASM, below-threshold auto, successful WASM, and loader-unavailable cases report actual backend and the correct reason.
- [x] Existing public operations and overrides retain their behavior; no engine heuristics or changed global thresholds are introduced.
- [x] The integration reports execution from the completed call rather than init capability output, with accurate timing labels.
- [x] Documentation distinguishes whole-module SIMD from hot-loop SIMD and does not state unmeasured bandwidth saturation as fact.
- [x] Behavior tests cover selection and fallback; targeted integration and type checks pass.

## 2. Explore a bounded static history through a reusable viewport session

Type: AFK. Blocked by: none. User stories: 2, 4, 5, 6, 7, 8, 9.

### What to build

Introduce the time-series session through an explicit downsampling-package subpath and use it in a Canvas viewport example. Load paired history, select a domain, derive a pixel-bound target and preserve timestamp/value pairing. This first slice can execute the session directly while clearly labeling that compute runs in its calling context; the persistent-worker slice follows before the example becomes the promoted adoption path.

### Acceptance criteria

- [ ] Fixed capacity and maximum output budget are validated and observable; oversized valid history retains the newest capacity points.
- [ ] Invalid arrays, coordinates and ordering fail atomically. Duplicate timestamps keep stable order.
- [ ] Inclusive viewport selection and edge-neighbor treatment respect a total output bound, including zero-width, empty, singleton and tiny-budget cases.
- [ ] Returned results remain valid after subsequent requests and are rendered using timestamp-based x coordinates.
- [ ] Pan, zoom and resize work on a deterministic million-point series; session behavior has reference/property tests.
- [ ] Documentation describes the input contract, numerical behavior and calling-context limitation.

## 3. Keep the viewport session resident in a persistent worker

Type: AFK. Blocked by: stories 1 and 2. User stories: 1, 3, 11, 13, 19, 23.

### What to build

Add a worker client/host pair for the session and migrate the viewport example to it. Generate initial demo data in the worker, retain source history there, and return only reduced arrays and diagnostics. Keep the worker entry in the consuming app so production bundlers can discover it.

### Acceptance criteria

- [ ] Load/view/dispose use one long-lived session and worker; repeated views do not resend raw history or create a new worker.
- [ ] Safe-copy input and opt-in transfer have documented ownership; dedicated-buffer restrictions are checked before detachment.
- [ ] Requests have identities and settle on success, worker startup/runtime failure and idempotent disposal.
- [ ] At this stage, a busy transport explicitly rejects overlapping operations rather than collecting an unbounded queue.
- [ ] Worker failures are visible; the library does not silently execute on the main thread.
- [ ] A packed consumer loads the worker and actual WASM/JS paths in Chromium, Firefox and WebKit.

## 4. Keep rapid navigation correct with bounded latest-request scheduling

Type: AFK. Blocked by: story 3. User stories: 6, 7, 10, 12, 13, 26.

### What to build

Make pan/zoom/resize robust under rapid input by coalescing viewport requests in the worker client and applying only results that match the current generation and viewport request. Add accessible navigation controls to the same demo.

### Acceptance criteria

- [ ] There is at most one outstanding worker request and one replaceable latest pending viewport; superseded callers settle explicitly.
- [ ] Controlled out-of-order/delayed results cannot overwrite the newest requested view, including reset and disposal races.
- [ ] A running synchronous kernel is not advertised as preemptively cancelled; obsolete results are suppressed safely.
- [ ] Pointer and keyboard controls can issue bursts without accumulating unbounded work or requiring page reload.
- [ ] Tests cover lifecycle/ordering behavior and browser integration, including reset during an in-flight operation.

## 5. Append a live stream with bounded retention and explicit backpressure

Type: AFK. Blocked by: story 4. User stories: 4, 14, 15, 16, 17, 21.

### What to build

Extend the same session and demo with ordered batch ingestion, fixed-capacity circular history, bounded pending ingestion, follow-latest and historical inspection. Show retained points, accounted buffer bytes and stream progress.

### Acceptance criteria

- [ ] Appending beyond capacity evicts the oldest paired points; wraparound agrees with a reference sequence and invalid batches never partially mutate state.
- [ ] Only one ingestion batch can be unacknowledged; a busy producer receives explicit backpressure before input ownership changes.
- [ ] Source/scratch/pending/output accounting stays within documented bounds independent of total samples ingested; result allocation is bounded rather than claimed absent.
- [ ] Continuous appends do not starve all rendering. Responses identify source revision while respecting current viewport and generation.
- [ ] Follow-latest, pan-away, pause/resume, reset and inspection of evicted ranges have documented visible outcomes.
- [ ] A deterministic stream runs beyond retention capacity and concurrent navigation remains correct in browser tests.

## 6. Publish a measured, copyable adoption workflow

Type: AFK. Blocked by: story 5. User stories: 20, 21, 22, 23, 24, 26.

### What to build

Finish the flagship example, add a repeatable local scenario/export path, and make the validated workflow the documentation/gallery entry point for large streaming time series. Keep measurements scoped to the actual public worker-and-renderer path.

### Acceptance criteria

- [ ] The complete scenario covers million-point initialization, viewport bursts, resize and streaming after retention fills.
- [ ] Exported results retain raw samples, cold/warm labels, scenario parameters, environment/source identifiers and actual backend.
- [ ] Worker compute, round trip, render completion and observed frame gaps are separate measurements; retained-buffer accounting is not presented as total browser heap.
- [ ] JS and WASM scenarios are compared on the same input with numerical checks; no universal crossover or stable-frame-rate claim is inferred.
- [ ] Packed artifacts and complete demo flows pass in Chromium, Firefox and WebKit; shared CI asserts correctness/bounds rather than fragile absolute latency thresholds.
- [ ] The adoption guide includes install, worker entry, typed-array ownership, producer backpressure, lifecycle cleanup and renderer integration, with public examples matching the implementation.
- [ ] Full relevant repository checks pass and any performance target miss is documented with retained evidence before adoption claims are promoted.

## Execution order and review

Implement story 1, then 2, then 3, 4, 5 and 6. Stories 1 and 2 are independent but will be executed sequentially unless parallel implementation is requested. Use a planning parent issue and publish child issues in dependency order with ready-for-agent plus enhancement/documentation labels. Link each implementation PR to its story and record validation in its description. Keep the parent open until the user accepts the delivered milestone.

A first implementation can begin as soon as the proposed modules, behavioral tests and slices are accepted. No second product-scope interview is needed.
