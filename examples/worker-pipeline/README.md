# Transferable Web Worker pipeline

This example transfers two `Float64Array` buffers to a module worker, runs `lttb` from `@vizcrush/downsample` there, and transfers the reduced buffers back for Canvas rendering. After `postMessage`, the input buffers are detached on the main thread; the UI exposes that fact directly.

The displayed timings separate worker compute from the full message round trip. The largest animation-frame gap is one observation from the current run, not a cross-device responsiveness claim. Input generation is deliberately excluded from the round-trip timer.

```bash
pnpm install
pnpm --dir examples/worker-pipeline dev
```
