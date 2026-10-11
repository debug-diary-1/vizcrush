# vizcrush

Rust compute kernels compiled to WASM, published as eleven `@vizcrush/*` npm
packages with a JS fallback behind every kernel.

`docs/developer-guide/building.md` has the command list; `CONTRIBUTING.md` has
the workflow. Checks run as `pnpm lint`, `pnpm typecheck`, `pnpm test`.

## Traps the tree does not confess

- **`pnpm build` dirties a tracked file.** `scripts/build-wasm.sh` rewrites
  `.supplychainshield/wasm-manifest.json`, which is committed and which no CI job
  verifies. Restore it after building unless you rebuilt WASM deliberately.
- **Pushing a `v*` tag publishes to npm.** `.github/workflows/release.yml` claims
  publish rights through OIDC, so there is no token to withhold and no dry run.
  Never run `npm publish` by hand.
- **`origin` is public.** Anything pushed is published.

## Conventions

Commits and pull requests carry no AI attribution.
