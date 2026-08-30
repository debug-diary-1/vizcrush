# Transferable Web Worker pipeline

This example transfers two `Float64Array` buffers to a module worker, runs `lttb` from `@vizcrush/downsample` there, and transfers the reduced buffers back for Canvas rendering. After `postMessage`, the input buffers are detached on the main thread; the UI exposes that fact directly.

The worker makes one untimed call on the transferred real input before measuring compute, so the compute value excludes lazy WASM loading. The full message round trip includes that warm-up, while input generation is deliberately excluded. The largest animation-frame gap is one observation from the current run, not a cross-device responsiveness claim.

```bash
pnpm install
pnpm --dir examples/worker-pipeline dev
```
