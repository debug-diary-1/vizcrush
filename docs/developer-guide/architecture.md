# Architecture

vizcrush is a **hybrid Rust + TypeScript monorepo**. Algorithms live in Rust crates that compile to WebAssembly with `wasm-bindgen`; thin TypeScript packages wrap the WASM modules with async APIs and a JavaScript fallback. The only WebGPU compute path is bin2d's opt-in one — measured slower than WASM (ADR 0004); ADR 0002/0003 explain why GPU/SIMD are not default paths, and `VIZCRUSH_SPEC.md`'s header note covers what the original vision document got wrong about this.

## Pipeline overview

<iframe src="/vizcrush/workflow.html" style="width:100%;height:520px;border:none;border-radius:12px;" loading="lazy"></iframe>

## High-level layout

```
vizcrush/
├── crates/                       Rust workspace — algorithms compiled to WASM
│   ├── vizcrush-core/            Shared bounds-finding (used by bin/bin3d/spatial/spatial3d)
│   ├── vizcrush-downsample/      LTTB, MinMaxLTTB, M4, LTOB
│   ├── vizcrush-aggregate/       Welford, percentile (exact), streaming, sketches (t-digest: unwired)
│   ├── vizcrush-transform/       Sort, normalize, filter
│   ├── vizcrush-bin/             1D, 2D, hex binning
│   ├── vizcrush-bin3d/           3D voxel binning
│   ├── vizcrush-spatial/         Quadtree, hash grid (k-d tree: unwired)
│   ├── vizcrush-spatial3d/       Octree, frustum culling
│   └── vizcrush-ai/              Anomaly, autoOpt, shape (planned — packages/ai ships pure JS instead)
│
├── packages/                     TypeScript workspace — bindings + servers
│   ├── core/                     init(), backend selection, the WASM/JS dispatch kernel
│   ├── downsample/               @vizcrush/downsample
│   ├── aggregate/                @vizcrush/aggregate
│   ├── transform/                @vizcrush/transform
│   ├── bin/                      @vizcrush/bin (+ WGSL shaders)
│   ├── bin3d/                    @vizcrush/bin3d
│   ├── spatial/                  @vizcrush/spatial
│   ├── spatial3d/                @vizcrush/spatial3d
│   ├── ai/                       @vizcrush/ai (pure JS today)
│   ├── react/                    @vizcrush/react — hooks
│   └── mcp-server/               @vizcrush/mcp-server — MCP server
│
├── benchmarks/                   Performance regression suite
├── examples/                     14 runnable example apps
├── scripts/                      Build/publish/test bash scripts
└── .github/workflows/            CI: build, lint, test, bench, deploy docs
```

The two layers are deliberately decoupled:

- The **Rust workspace** is a normal Cargo workspace. You can `cargo test` or `cargo bench` it without touching JavaScript at all.
- The **TypeScript workspace** is a pnpm + Turbo monorepo. Each package has its own `package.json`, `tsconfig.json`, and `src/`.

Connecting them is `wasm-bindgen` — Rust functions tagged with `#[wasm_bindgen]` get JS bindings auto-generated, and the TypeScript packages just `import` the resulting `.js` + `.d.ts` from `packages/<name>/wasm/`.

## Build pipeline

```
                  ┌────────────────────────────────────────────────┐
                  │                Rust workspace                  │
                  │  cargo build --target wasm32-unknown-unknown   │
                  │           --release  (with +simd128)           │
                  └─────────────────┬──────────────────────────────┘
                                    │  *.wasm artifacts
                                    ▼
                  ┌────────────────────────────────────────────────┐
                  │             wasm-bindgen --target web          │
                  │   (writes .js loader + .d.ts to packages/*/wasm/) │
                  └─────────────────┬──────────────────────────────┘
                                    │  ESM modules per package
                                    ▼
                  ┌────────────────────────────────────────────────┐
                  │                 pnpm turbo build               │
                  │  (per-package tsc → packages/*/dist/)          │
                  └────────────────────────────────────────────────┘
```

This is run by `pnpm build` from the monorepo root, which is just:

```bash
pnpm build:wasm     # bash scripts/build-wasm.sh
pnpm turbo build    # tsc per package
```

`scripts/build-wasm.sh` is the source of truth for the Rust → WASM step. It compiles each crate, runs `wasm-bindgen`, and (optionally) `wasm-opt` for size optimization. The output goes to `packages/<name>/wasm/` which is **gitignored** — WASM artifacts are built locally or in CI, never committed.

## Runtime backend selection

At runtime, `init()` from `@vizcrush/core` probes the environment and picks the best compute path:

```
                     ┌──────────────┐
                     │   init()     │
                     └──────┬───────┘
                            │
                ┌───────────▼───────────┐
                │  detectCapabilities() │
                └───────────┬───────────┘
                            │
              ┌─────────────▼─────────────┐
              │     selectBackend()       │
              │                           │
              │  WebAssembly? ────── yes ─┼──► wasm
              │     │ no                  │
              │     └─────────────────────┼──► js
              └───────────────────────────┘
```

Each algorithm package then dispatches to WASM when the module is loaded, and to the inline JS fallback otherwise. WGSL shaders live alongside the TypeScript source in `packages/<name>/src/shaders/*.wgsl`; bin2d's is wired to an opt-in WebGPU path (ADR 0004), the rest are unwired drafts. The JS fallback is implemented inline in TypeScript to keep the package self-contained.

See the [Backends & Capabilities](../user-guide/backends.md) user guide for the selection logic and how to override per call.

## Why typed arrays everywhere

Every public API takes and returns `Float64Array` (data) or `Uint32Array` (indices). This is intentional:

- **Zero-copy across JS↔WASM** — `wasm-bindgen` passes typed arrays as direct memory views, no per-element marshaling
- **Cache-friendly inner loops** — contiguous memory keeps the Rust inner loops tight
- **Drop-in friendly** — most charting libraries (ChartGPU, Chart.js, D3, Three.js) already consume typed arrays

The cost is that you can't pass plain `number[]`. The benefit is that vizcrush avoids per-element marshaling and keeps the inner loops cache-friendly. This trade-off shows up everywhere — interleaved `[x, y]` results, `Uint32Array` index returns, etc.

## Why a separate Rust crate per package

Each TypeScript package has a 1:1 corresponding Rust crate. They could in principle share a single mega-crate, but separating them gives:

- **Smaller WASM bundles per package** — `@vizcrush/downsample`'s WASM doesn't include octree code
- **Independent versioning** — packages can ship at different rates
- **Faster Cargo builds** — touching the LTTB code doesn't invalidate the spatial cache

The cost is some duplication in `Cargo.toml` boilerplate, which is mostly handled by the workspace inheritance.

## Where the AI features live

The `@vizcrush/ai` package is **pure JavaScript today**. It's intentionally separate from the Rust crates because:

- The algorithms (MAD, CUSUM, linear regression, autocorrelation, cosine similarity) are short and don't benefit much from SIMD
- Pure JS works in environments where WASM is unavailable
- It can be loaded eagerly by an LLM agent that doesn't have a WASM runtime

A `vizcrush-ai` Rust crate exists in `crates/` as a placeholder for future Rust/WASM implementations of the heavier features (e.g. shape vectors over very large datasets).

## CI pipeline

`.github/workflows/ci.yml` runs on every PR:

| Job                           | What it does                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| **Rust Tests**                | `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`, build WASM with `+simd128` |
| **Lint + Format + Typecheck** | `pnpm lint` (oxlint `--deny-warnings`), `pnpm format:check` (oxfmt), `pnpm typecheck`     |
| **TypeScript Build + Test**   | `pnpm turbo build`, `vitest run`                                                          |
| **Performance Regression**    | Run benchmarks, compare to `benchmarks/benchmark-baseline.json` (50% threshold)           |

Plus `.github/workflows/docs-deploy.yml` deploys this site to GitHub Pages when `docs/site/**` changes on `main`.

## See also

- **[Building from Source](building.md)** — full local build setup
- **[Packages Layout](packages.md)** — file structure inside a package
- **[VIZCRUSH_SPEC.md](https://github.com/pallavL01/vizcrush/blob/main/VIZCRUSH_SPEC.md)** — full functional spec
