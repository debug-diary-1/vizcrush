# vizcrush examples

The gallery contains two deliberately labeled kinds of runnable demos:

- **Uses vizcrush** — imports a published `@vizcrush/*` API and demonstrates an integration pattern.
- **Graphics demo** — explores an adjacent browser rendering technique without presenting it as a vizcrush API.

Browse the [live gallery](https://debug-diary-1.github.io/vizcrush/examples/) or use this path through the repository:

| Start with                                        | What it teaches                                                      |
| ------------------------------------------------- | -------------------------------------------------------------------- |
| [`backend-lab`](./backend-lab/)                   | How backend selection and JS/WASM performance behave in your browser |
| [`financial-timeseries`](./financial-timeseries/) | How to reduce a million-point series while preserving spikes         |
| [`chartgpu-integration`](./chartgpu-integration/) | How to feed LTTB and `bin2d` output into Chart.js                    |
| [`d3-large-scatter`](./d3-large-scatter/)         | How to combine D3 rendering with vizcrush spatial queries            |
| [`threejs-integration`](./threejs-integration/)   | How to use an octree to cull a large Three.js point cloud            |
| [`streaming-dashboard`](./streaming-dashboard/)   | How to combine rolling statistics with LTTB in a live view           |

## Run locally

From the repository root:

```sh
pnpm install
pnpm build:wasm
pnpm examples
```

To work on one example, run its ordinary Vite development script:

```sh
pnpm --dir examples/financial-timeseries dev
```

Build every runnable example with `pnpm test:examples`.

## Adding an example

Keep the promise visible and verifiable:

1. Import the vizcrush API named by the gallery card. If the demo only explores an adjacent rendering technique, mark it as a graphics demo instead.
2. Explain the data flow and the reduction in work, not just the visual result.
3. Use an ordinary `vite` development script so the example works in a fresh clone.
4. Ensure `pnpm test:examples` discovers and builds it.
