# Backends & Capabilities

vizcrush picks its compute backend at runtime. You usually don't have to think about it — `init()` and the algorithm functions do the right thing — but knowing how the selection works helps when you're debugging performance or planning around browser support.

## The two backends

| Backend    | What it is                         | When it's chosen                                               | Relative speed                                                               |
| ---------- | ---------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **`wasm`** | WebAssembly build of the Rust core | WebAssembly is available (essentially everywhere modern)       | ~4× faster in Chromium/V8; comparable to slower in Firefox/WebKit (ADR 0003) |
| **`js`**   | Pure JavaScript core               | WASM unavailable (very old browsers / restricted environments) | Comparable — often faster in Firefox/Safari, and no cold-start module load   |

A single WASM binary is built for every crate, so there is no separate scalar-WASM or `wasm-simd` path. (The build passes `+simd128`, but the output is byte-identical to a scalar build, so SIMD contributes no speedup today — see ADR 0002.) No WebGPU compute path is wired into the algorithm packages, so `webgpu` is not a selectable backend — the `.wgsl` files in some packages' `src/shaders/` are unwired drafts.

The selection is feature detection alone — there's no benchmarking.

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

## Typed arrays cross WASM with no copy

vizcrush APIs operate on `Float64Array` (and `Uint32Array` for indices). `wasm-bindgen` passes these as direct memory views, so there is no per-element marshaling at the JS↔WASM boundary. That's the zero-copy story, and it needs no special API — just pass typed arrays rather than plain `number[]`.

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
