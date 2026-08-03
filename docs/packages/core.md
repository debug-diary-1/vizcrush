# @vizcrush/core

The entry point. `@vizcrush/core` initializes the library, detects what the runtime can do, picks the compute backend, and exposes the kernel machinery the algorithm packages build on.

You only need to call `init()` once per page — most other packages call it implicitly the first time you use them.

## Install & import

```typescript
import { init, detectCapabilities, selectBackend } from "@vizcrush/core";
```

## `init()`

```typescript
const ctx = await init();
// {
//   backend: "wasm" | "js",   // the path that actually runs
//   capabilities: {
//     webgpu: boolean,        // raw probes, for reporting only
//     wasmSimd: boolean,
//     wasm: boolean,
//     sharedArrayBuffer: boolean,
//   },
// }
```

`backend` is `"wasm"` when WebAssembly is available and `"js"` otherwise. The `capabilities` object still reports the raw WebGPU/SIMD/SharedArrayBuffer probes, but a single SIMD-enabled WASM binary is always built, so those probes do not name distinct selectable backends. (The opt-in WebGPU path on `@vizcrush/bin`’s bin2d is requested per call, not selected here — ADR 0004.)

## `detectCapabilities()`

Probe the runtime without committing to a backend:

```typescript
const caps = await detectCapabilities();
if (!caps.wasm) {
  console.warn("WebAssembly unavailable — vizcrush will run on the pure-JS core");
}
```

Note that `webgpu`, `wasmSimd`, and `sharedArrayBuffer` are informational probes only — they never change which backend runs. In particular, the shipped WASM binary is identical whether or not the engine supports SIMD (see ADR 0002).

Detection is cheap and runs the same checks as `init()` internally. Use it if you want to gate UI features on backend availability before committing to load any algorithms.

## `selectBackend(capabilities)`

Pick the best backend from a capability set:

```typescript
const backend = selectBackend(caps);
// "wasm" if caps.wasm, else "js"
```

You rarely need this directly — `init()` does it for you. It's exported so you can audit the selection.

## Typed arrays cross WASM with no copy

vizcrush APIs operate on `Float64Array` (and `Uint32Array` for indices). `wasm-bindgen` passes these as direct memory views, so there is no per-element marshaling at the JS↔WASM boundary — that is the zero-copy story, and it requires no special API. Just pass typed arrays (not plain `number[]`, which forces a per-element conversion).

## Type re-exports

For convenience, `@vizcrush/core` re-exports the result types used by other packages:

```typescript
import type {
  Backend,
  Capabilities,
  GpuComputeContext,
  DownsampleResult,
  BinResult,
  Bin2dResult,
  StatsResult,
} from "@vizcrush/core";
```

Each of those is just a typed-array shape (e.g. `DownsampleResult = Float64Array`, `BinResult = { counts: Uint32Array; edges: Float64Array }`).

## When to call `init()`

- **In a top-level module** for vanilla apps: `await init()` once at startup, then call algorithm packages without worrying about backend.
- **In a React app**: use the [`useGpuCompute` hook](../user-guide/react.md) — it caches the context across renders.
- **In a Node script**: same as vanilla apps — Node supports WebAssembly, so the backend will be `wasm`.

## See also

- **[Backends & Capabilities](../user-guide/backends.md)** — selection rules and how to override per call
- **[useGpuCompute hook](../user-guide/react.md#usegpucompute)** — React wrapper
