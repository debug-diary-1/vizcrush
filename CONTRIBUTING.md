# Contributing to vizcrush

Thanks for your interest in contributing! This guide covers everything you need to get started.

## Prerequisites

- **Rust 1.94.1** — `rustup toolchain install 1.94.1`
- **wasm32 target** — `rustup target add --toolchain 1.94.1 wasm32-unknown-unknown`
- **Node.js 24+** (see `engines` in `package.json`)
- **pnpm 10+** — `npm install -g pnpm`
- **wasm-bindgen-cli 0.2.115** (optional, for WASM builds) — `cargo install wasm-bindgen-cli --version 0.2.115 --locked`

## Project Structure

```
vizcrush/
├── crates/           # Rust crates (core algorithms)
│   ├── vizcrush-core/        # Shared bounds-finding
│   ├── vizcrush-downsample/  # LTTB, MinMaxLTTB, M4, LTOB
│   ├── vizcrush-bin/         # Histogram, bin2d, hexbin
│   ├── vizcrush-bin3d/       # 3D voxel grid binning
│   ├── vizcrush-aggregate/   # Stats, streaming, quantile sketches
│   ├── vizcrush-spatial/     # Quadtree, hash grid, Morton (kd-tree: unwired)
│   ├── vizcrush-spatial3d/   # Octree, frustum culling
│   ├── vizcrush-transform/   # Sort, normalize, filter
│   └── vizcrush-ai/          # Anomaly, changepoint, shape, summarize
├── packages/         # TypeScript packages (bindings + MCP)
│   ├── core/         # @vizcrush/core — init, detect, backend selection
│   ├── downsample/   # @vizcrush/downsample — TS bindings
│   ├── bin/          # @vizcrush/bin — TS bindings
│   ├── bin3d/        # @vizcrush/bin3d — TS bindings
│   ├── spatial/      # @vizcrush/spatial — TS bindings
│   ├── spatial3d/    # @vizcrush/spatial3d — TS bindings
│   ├── aggregate/    # @vizcrush/aggregate — TS bindings
│   ├── transform/    # @vizcrush/transform — TS bindings
│   ├── ai/           # @vizcrush/ai — AI features (pure TS)
│   ├── react/        # @vizcrush/react — React hooks
│   └── mcp-server/   # @vizcrush/mcp-server — MCP server
├── benchmarks/       # Performance benchmark suite
├── examples/         # Integration examples
└── scripts/          # Build scripts
```

## Development Workflow

```bash
# Clone and install
git clone https://github.com/debug-diary-1/vizcrush.git
cd vizcrush
pnpm install

# Run Rust tests
cargo test --workspace

# Build TypeScript packages
pnpm turbo build

# Run TypeScript tests
npx vitest run

# Run benchmarks
node --experimental-vm-modules benchmarks/dist/runner.js
```

## Adding a New Algorithm

1. **Rust implementation** in the appropriate crate under `crates/`
2. **Add tests** in the same file with `#[cfg(test)]` module
3. **Export via `wasm_bindgen`** for WASM binding
4. **TypeScript binding** in the corresponding `packages/*/src/index.ts`
5. **JS fallback** for when WASM isn't loaded
6. **Vitest tests** in `packages/*/src/index.test.ts`
7. **MCP tool** (if user-facing) in `packages/mcp-server/src/tools/`

## Testing

We maintain two test suites:

- **Rust tests** (`cargo test --workspace`) — algorithm correctness, edge cases, SIMD parity
- **Vitest tests** (`npx vitest run`) — TS binding correctness, JS fallbacks, property-based testing

Property-based tests use [fast-check](https://github.com/dubzzz/fast-check) to verify invariants across random inputs.

### Dependency updates

The workspace centralizes npm versions in the pnpm catalog. Review npm updates manually and regenerate the lockfile with pnpm 11.25.0; Dependabot npm updates are disabled because its catalog output is not frozen-lockfile compatible. Every dependency PR must pass:

```bash
pnpm install --frozen-lockfile
pnpm check:dependency-policy
```

### Running specific tests

```bash
# Single Rust crate
cargo test -p vizcrush-downsample

# Single TS package
npx vitest run packages/downsample/
```

## Performance

Code-affecting PRs are checked against the benchmark baseline. CI fails on a >75% regression — the loose threshold absorbs CI-runner noise; run locally for precise numbers. Documentation-only PRs skip the benchmark.

```bash
# Run benchmarks
node --experimental-vm-modules benchmarks/dist/runner.js

# Save new baseline (after intentional changes)
node --experimental-vm-modules benchmarks/dist/runner.js --save-baseline
```

## Code Style

- **Rust**: `cargo fmt` + `cargo clippy`
- **TypeScript**: Standard TypeScript strict mode
- No unnecessary abstractions — keep algorithms tight and direct
- Every public function needs a doc comment
- Interleaved `[x0, y0, x1, y1, ...]` format for cross-WASM-boundary efficiency

## Pull Requests

1. Fork and create a feature branch
2. Write tests for new functionality
3. Ensure `cargo test --workspace` and `npx vitest run` pass
4. Run benchmarks if touching hot paths
5. Keep PRs focused — one feature/fix per PR

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
