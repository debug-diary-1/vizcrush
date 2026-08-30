# Apache Arrow data pipeline

This example creates an Apache Arrow table, serializes it as an IPC stream, decodes its two `Float64` columns, and passes those typed arrays to `lttb` and `stats`. Canvas renders the bounded result.

It demonstrates format interoperability without claiming a zero-copy decode. The UI names and measures Arrow decode separately from the concurrent vizcrush preprocessing stage. Both kernels make one untimed call on the decoded real input before that stage is measured, excluding lazy WASM loading. The payload is generated locally to keep the example self-contained.

```bash
pnpm --dir examples/arrow-data-pipeline dev
```
