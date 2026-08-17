# Building from Source

Everything you need to build vizcrush locally — Rust crates → WASM → TypeScript packages → tests → benchmarks.

## Prerequisites

| Tool                    | Version                                      | How                                                                                                            |
| ----------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Node.js                 | 24+                                          | `volta install node@24` (recommended) or `nvm install 24`                                                      |
| pnpm                    | 10.33+                                       | `corepack enable` (auto-installs the version pinned in `package.json`)                                         |
| Rust toolchain          | stable, with `wasm32-unknown-unknown` target | `rustup default stable && rustup target add wasm32-unknown-unknown`                                            |
| `wasm-bindgen-cli`      | matching `wasm-bindgen` version              | `cargo install wasm-bindgen-cli`                                                                               |
| `wasm-opt` _(optional)_ | latest                                       | `brew install binaryen` or download from [binaryen releases](https://github.com/WebAssembly/binaryen/releases) |

If you're on macOS with Volta installed, the repo's `package.json` pins Node 24 automatically — `cd`'ing into the repo switches your shell to the right version.

## First-time setup

```bash
git clone git@github.com:debug-diary-1/vizcrush.git
cd vizcrush
pnpm install
pnpm build
```

`pnpm build` runs:

1. `pnpm build:wasm` — `bash scripts/build-wasm.sh`, which compiles each Rust crate to WASM and runs `wasm-bindgen` to generate the JS loader + TypeScript declarations
2. `pnpm turbo build` — runs `tsc` (or each package's `build` script) in dependency order via Turborepo

After `pnpm build`, every package's `dist/` and `wasm/` directories are populated and you can `import` from them or run any example app.

## Common scripts

From the monorepo root:

```bash
# Build everything
pnpm build               # Rust → WASM → TypeScript

# Build only the Rust → WASM step
pnpm build:wasm          # bash scripts/build-wasm.sh

# Lint & format
pnpm lint                # oxlint --deny-warnings
pnpm format              # oxfmt (apply)
pnpm format:check        # oxfmt --check

# Typecheck
pnpm typecheck           # tsc --noEmit per package

# Tests
pnpm test                # turbo test (vitest + cargo via per-package scripts)
pnpm test:rust           # cargo test --workspace
pnpm test:vitest         # vitest run
pnpm test:all            # Rust + JS together
pnpm test:examples       # bash scripts/test-examples.sh

# Benchmarks
pnpm bench               # vizcrush-benchmarks run bench
```

## Building only the Rust workspace

If you're iterating on a single crate, skip the JS build entirely:

```bash
cd crates/vizcrush-downsample
cargo test                                    # quick unit tests
cargo build --release --target wasm32-unknown-unknown  # build WASM
```

To match the `+simd128` flag the build script passes (note: per ADR 0002 the output is byte-identical to a scalar build — there are no SIMD intrinsics in the code):

```bash
RUSTFLAGS="-C target-feature=+simd128" \
  cargo build --release --target wasm32-unknown-unknown
```

This is exactly what `scripts/build-wasm.sh` runs under the hood, plus the `wasm-bindgen` post-step to generate the JS loader.

## Building only one TypeScript package

```bash
cd packages/downsample
pnpm build                # tsc
pnpm typecheck            # tsc --noEmit
```

Turbo's caching means subsequent root-level `pnpm build` calls will skip this package as long as its inputs haven't changed.

## Running an example

```bash
pnpm install && pnpm build  # one-time
cd examples/streaming-dashboard
pnpm dev                    # starts vite at http://localhost:5173
```

Each example is wired through the pnpm workspace, so vizcrush packages resolve directly to the local sources — no `npm link` needed.

## Running benchmarks

```bash
pnpm bench
```

This runs `benchmarks/dist/runner.js` which:

1. Generates synthetic time series and scatter datasets at 100K / 500K / 1M sizes
2. Times every algorithm (LTTB, bin2d, stats, sort, …)
3. Compares against `benchmarks/benchmark-baseline.json` and exits non-zero if any metric is more than 50% slower than baseline

To capture a new baseline (e.g. after a hardware change):

```bash
node --experimental-vm-modules benchmarks/dist/runner.js --save-baseline
```

CI uses a separate workflow (`.github/workflows/bench-baseline.yml`) that uploads the baseline as an artifact for review before committing.

## Cleaning

```bash
# Nuke node_modules and rebuild
rm -rf node_modules pnpm-lock.yaml
pnpm install

# Nuke Rust target dir
cargo clean

# Nuke generated WASM artifacts
rm -rf packages/*/wasm/
pnpm build:wasm
```

## Docs site (this site)

```bash
cd docs/site
python3 -m venv .venv
source .venv/bin/activate.fish    # or .venv/bin/activate for bash/zsh
pip install -r requirements.txt
mkdocs serve                       # http://127.0.0.1:8000
```

The site auto-rebuilds on every Markdown change. To produce a static build:

```bash
mkdocs build --strict --site-dir _site
```

CI runs the same `mkdocs build --strict` and deploys to GitHub Pages on push to `main`.

## Troubleshooting

??? note "`cargo build --target wasm32-unknown-unknown` fails"
Run `rustup target add wasm32-unknown-unknown` to install the target. The `+simd128` target feature also requires Rust 1.78+.

??? note "`wasm-bindgen` version mismatch"
`cargo install wasm-bindgen-cli` installs the latest, but your `Cargo.lock` may pin an older version. Match them: `cargo install wasm-bindgen-cli --version <X.Y.Z>` where `<X.Y.Z>` is the version from `Cargo.lock`.

??? note "`pnpm install` warns about engines"
`engines.node` requires Node 24. Install Node 24 (`volta install node@24` or `nvm install 24`). The warning is non-fatal but several deps assume Node 24+.

??? note "`Ignored build scripts: esbuild`"
pnpm 10 sandboxes postinstall scripts by default. The repo's `package.json` includes `pnpm.onlyBuiltDependencies: ["esbuild"]` so a fresh install should not warn. If you see it, run `pnpm approve-builds` once.

## See also

- **[Architecture](architecture.md)** — what gets built and why
- **[Contributing](contributing.md)** — workflow for submitting changes
