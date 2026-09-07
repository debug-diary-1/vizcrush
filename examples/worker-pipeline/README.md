# Transferable Web Worker pipeline

This example transfers two `Float64Array` buffers to a module worker, runs `lttb` from `@vizcrush/downsample` there, and transfers the reduced buffers back for Canvas rendering. After `postMessage`, the input buffers are detached on the main thread; the UI exposes that fact directly.

Choose automatic, JavaScript, or WebAssembly dispatch before each run. The worker makes one untimed call on the transferred real input before measuring compute, so the warm worker compute value excludes lazy WASM loading. The result reports the requested mode, actual backend, and dispatch reason from the measured call. A forced WebAssembly request can therefore report a JavaScript result with `wasm-unavailable` instead of implying the request was honored.

The full message round trip includes worker startup and the warm-up, while input generation is deliberately excluded. The largest animation-frame gap is one observation from the current run, not a cross-device responsiveness claim. Capability detection describes the environment; these completed-call diagnostics describe what executed.

```bash
pnpm install
pnpm --dir examples/worker-pipeline dev
```
