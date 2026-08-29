# Streaming dashboard

This example combines two bounded views of a simulated metric stream:

- `streamingStats(20_000)` maintains rolling mean, min, max, and standard deviation.
- `lttbSync(..., 400)` reduces the current 20,000-value window before rendering it.

The input is simulated in the browser so the example runs without a server. Replace `ingestBatch()` with a WebSocket handler in an application; the accumulator and downsampling seam stays the same.

Run it from the repository root:

```sh
pnpm --dir examples/streaming-dashboard dev
```
