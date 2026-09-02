# Installation

Install only the packages your application needs. Each algorithm package declares `@vizcrush/core` as a dependency.

## From npm

For time-series downsampling:

```bash
npm install @vizcrush/downsample
```

For a 2D density view:

```bash
npm install @vizcrush/bin
```

Then import the operation directly:

```typescript
import { lttb } from "@vizcrush/downsample";

const result = await lttb(x, y, 1_000);
```

The packages ship ESM, TypeScript declarations, WebAssembly artifacts, and a pure-JavaScript fallback. You do not need Rust to use them.

See the [packages overview](../packages/index.md) to choose a package.

## Browser and runtime requirements

- A modern browser with WebAssembly support
- Node.js 24+ when using vizcrush from Node
- An ESM-aware bundler such as Vite, Rollup, webpack, or Turbopack for browser applications

The JavaScript fallback is used if a WASM module cannot load. Use [Backend Lab](https://debug-diary-1.github.io/vizcrush/examples/backend-lab/) to verify the path that runs in your browser.

## Building from source

Contributors need Rust, the `wasm32-unknown-unknown` target, Node.js 24+, and pnpm 11+:

```bash
git clone https://github.com/debug-diary-1/vizcrush.git
cd vizcrush
corepack enable
pnpm install
pnpm build
pnpm test:all
```

`pnpm build` compiles the Rust crates to WebAssembly and then builds the TypeScript packages.

For the full contributor setup, see [Building from Source](../developer-guide/building.md).

## Troubleshooting

### The app runs on the JavaScript backend

Open the browser console and network panel first. A missing or blocked `.wasm` asset usually means the bundler did not emit the package's dynamically imported WASM module. The JavaScript fallback keeps the call working, so this can otherwise be easy to miss.

The [Backends & Capabilities](backends.md) guide explains how to inspect and force a backend while debugging.

### Node reports an engine mismatch

The repository's development toolchain requires Node.js 24. Use the version pinned in the root `mise.toml`, for example with [mise](https://mise.jdx.dev/) or another version manager.

### A source build cannot find the WASM target

```bash
rustup target add wasm32-unknown-unknown
```

Then rerun `pnpm build`.
