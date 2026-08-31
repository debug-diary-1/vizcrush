# Backends & Capabilities

vizcrush picks its compute backend at runtime. You usually don't have to think about it — `init()` and the algorithm functions do the right thing — but knowing how the selection works helps when you're debugging performance or planning around browser support.

## The two backends

| Backend    | What it is                         | When it's chosen                                               | Relative speed                                                                                                                        |
| ---------- | ---------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **`wasm`** | WebAssembly build of the Rust core | WebAssembly is available (essentially everywhere modern)       | Engine- and version-dependent: ~1.1× faster in Chromium 149+ (was ~4× through 148); comparable to slower in Firefox/WebKit (ADR 0003) |
| **`js`**   | Pure JavaScript core               | WASM unavailable (very old browsers / restricted environments) | Comparable — often faster in Firefox/Safari, and no cold-start module load                                                            |

A single WASM binary is built for every crate, so there is no separate scalar-WASM or `wasm-simd` path. (The build passes `+simd128`, but the output is byte-identical to a scalar build, so SIMD contributes no speedup today — see ADR 0002.) The selection is feature detection alone — there's no benchmarking. `webgpu` is not a selectable default backend. One operation — `bin2d` — has an opt-in WebGPU compute path (below); the other `.wgsl` files in `src/shaders/` remain unwired drafts.

## Opt-in WebGPU for bin2d

`bin2d` accepts `{ backend: "webgpu" }` to run its wired WGSL compute shader. It is a request, not a guarantee: when WebGPU is unavailable (no `navigator.gpu`, device denied or lost, degenerate or oversized input) the call silently falls back to the wasm/js kernel, and it is **never auto-selected**. Measured end-to-end (f64→f32 rebase + upload + dispatch + readback) it is roughly 15× _slower_ than WASM at every tested size on Apple Silicon/Metal — see ADR 0004 for the numbers and when that might change. Inputs are rebased against the range minimum in f64 before narrowing to f32, so bin assignment survives epoch-scale values; counts can differ from the f64 cores by at most a few boundary-adjacent points, and edges are always f64.

```typescript
import { bin2d } from "@vizcrush/bin";

const result = await bin2d(x, y, { xBins: 256, yBins: 256 }, { backend: "webgpu" });
```

## How `init()` chooses

```typescript
import { init } from "@vizcrush/core";

const ctx = await init();
console.log(ctx.backend);
// "wasm" | "js"
```

Internally, `init()`:

1. Calls `detectCapabilities()` to probe the runtime
2. Calls `selectBackend(capabilities)` — `"wasm"` if WebAssembly is available, else `"js"`
3. Returns `{ backend, capabilities }`

## Inspecting capabilities directly

```typescript
import { detectCapabilities } from "@vizcrush/core";

const caps = await detectCapabilities();
// {
//   webgpu: boolean,            // navigator.gpu present + adapter requestable
//   wasmSimd: boolean,          // WebAssembly.validate(<simd module>)
//   wasm: boolean,              // typeof WebAssembly !== "undefined"
//   sharedArrayBuffer: boolean, // crossOriginIsolated && SharedArrayBuffer in globalThis
// }
```

These are raw environment probes, reported for your own diagnostics. Only `wasm` decides the selected backend; the others are informational.

## Per-call backend override

Algorithm functions accept a `KernelCallOptions` to force a path for a single call, regardless of what `init()` would pick:

```typescript
import { bin2d } from "@vizcrush/bin";

// Force the pure-JS core (useful for benchmarking or debugging parity)
const result = await bin2d(x, y, { xBins: 256, yBins: 256 }, { backend: "js" });
```

Valid values: `"auto"` (default — run the JS core below a small size threshold, otherwise WASM), `"wasm"` (force WASM, falling back to JS only if the module is genuinely absent), `"js"` (force the pure-JS core).

## Typed arrays at the WASM boundary

vizcrush APIs operate on `Float64Array` (and `Uint32Array` for indices). `wasm-bindgen` bulk-copies input into WebAssembly linear memory. Typed arrays avoid per-element boxing, but a one-shot call still crosses a copying boundary. See [ADR 0001](../adr/0001-no-wasm-heap-marshalling-optimization.md).

## Browser support matrix

As of early 2026:

| Browser            | WebAssembly | Notes |
| ------------------ | ----------- | ----- |
| Chrome 113+        | ✅          |       |
| Edge 113+          | ✅          |       |
| Firefox 117+       | ✅          |       |
| Safari 17+ (macOS) | ✅          |       |
| Safari iOS 17+     | ✅          |       |

For server-side or Node usage:

- **Node 24+** — WebAssembly ✅. The `js` fallback also works for tests.
- **Deno 1.40+** — WebAssembly ✅.

## Choosing what to ship

- **Default (recommended):** call `init()` (or just use the algorithm functions), trust the backend selection, write your code once.
- **Force a path per call:** pass `{ backend: "js" | "wasm" | "auto" }` as the trailing `KernelCallOptions` argument.

## See also

- **[@vizcrush/core](../packages/core.md)** — the package that houses `init()`, `detectCapabilities()`, `selectBackend()`
- **[Architecture](../developer-guide/architecture.md)** — how the WASM artifacts are built
