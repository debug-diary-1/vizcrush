# Installation

vizcrush packages aren't published to npm yet. For now, you consume them directly from the monorepo.

## From the monorepo

```bash
git clone git@github.com:debug-diary-1/vizcrush.git
cd vizcrush
pnpm install
pnpm build
```

`pnpm build` runs `pnpm build:wasm` (which compiles the Rust crates to WebAssembly via `cargo build --target wasm32-unknown-unknown --release` plus `wasm-bindgen`) and then `pnpm turbo build` (which compiles all the TypeScript packages with `tsc`).

After this, the packages are usable as workspace dependencies. In any other workspace package or example app, you can `import` them directly:

```typescript
import { init } from "@vizcrush/core";
import { lttb, minMaxLttb } from "@vizcrush/downsample";
import { bin2d, hexbin } from "@vizcrush/bin";
import { buildQuadtree, queryRange } from "@vizcrush/spatial";
```

## Prerequisites

| Tool               | Version                                  | How to install                                                                    |
| ------------------ | ---------------------------------------- | --------------------------------------------------------------------------------- |
| Node.js            | 24+                                      | [nodejs.org](https://nodejs.org/) or `volta install node@24`                      |
| pnpm               | 10+                                      | `corepack enable` (uses the version from `package.json`'s `packageManager` field) |
| Rust               | stable + `wasm32-unknown-unknown` target | `rustup target add wasm32-unknown-unknown`                                        |
| `wasm-bindgen-cli` | matching `wasm-bindgen` version          | `cargo install wasm-bindgen-cli` (only if rebuilding WASM)                        |

If you have [Volta](https://volta.sh/) installed, the repo's `package.json` already pins Node 24, so `cd`'ing in switches automatically.

## Per-package installation (future)

Once vizcrush is published to npm, you'll install only the packages you need:

```bash
# Future — not yet published
pnpm add @vizcrush/core @vizcrush/downsample
```

The package set is intentionally granular so you can pull in only what you use.

## Verifying your install

After `pnpm build`, run the test suites:

```bash
pnpm test           # vitest + cargo tests via Turbo
pnpm test:rust      # cargo tests only
pnpm test:vitest    # JS tests only
pnpm bench          # quick benchmark sanity check
```

If everything passes, you're set. Head to the **[Quickstart](quickstart.md)**.

## Troubleshooting

??? note "`pnpm install` warns about engines"

    `engines.node` requires Node 24 — if you're on 22 or older, install Node 24 (`volta install node@24` or `nvm install 24`). The warning is non-fatal but pnpm and several deps may behave unexpectedly on older versions.

??? note "`Ignored build scripts: esbuild`"

    pnpm 10 sandboxes postinstall scripts by default. The repo's `package.json` already includes:
    ```json
    "pnpm": {
      "onlyBuiltDependencies": ["esbuild"]
    }
    ```
    so a fresh `pnpm install` should not warn. If you see it, run `pnpm approve-builds` once.

??? note "`cargo build --target wasm32-unknown-unknown` fails"

    Make sure you've added the WASM target: `rustup target add wasm32-unknown-unknown`. SIMD intrinsics also require a recent stable toolchain (1.78+).
