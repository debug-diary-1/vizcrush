# Contributing

We welcome contributions! See the repo's **[CONTRIBUTING.md](https://github.com/debug-diary-1/vizcrush/blob/main/CONTRIBUTING.md)** for the canonical guide; this page is a quick orientation.

## Before you start

- Open an issue to discuss large changes (new packages, breaking API changes, new dependencies). Small fixes — typos, doc improvements, performance tweaks — can go straight to a PR.
- Make sure you can build the project locally — see **[Building from Source](building.md)**.

## Workflow

1. **Fork and branch** — `git checkout -b feature/short-name`
2. **Make changes** — edit code under `crates/`, `packages/`, or `docs/site/docs/`
3. **Test locally**:
   ```bash
   pnpm lint
   pnpm format
   pnpm typecheck
   pnpm test
   pnpm test:rust
   ```
4. **Commit** — clear message, conventional prefixes (`feat:`, `fix:`, `docs:`, `chore:`, `ci:`)
5. **Push and open a PR** — fill in the PR template, link the issue if any

## CI gates

Code-affecting PRs run five CI jobs:

| Job                           | What it checks                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| **Rust Tests**                | `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`, WASM build with `+simd128` |
| **Lint + Format + Typecheck** | `pnpm lint` (oxlint `--deny-warnings`), `pnpm format:check` (oxfmt), `pnpm typecheck`     |
| **TypeScript Build + Test**   | `pnpm turbo build`, `vitest run`                                                          |
| **Performance Regression**    | Run benchmarks, compare to baseline with 75% threshold                                    |
| **Security Audit**            | Audit pnpm and Cargo dependencies                                                         |

Documentation-only PRs instead run formatting, generated-inventory validation, and the VitePress build. The expensive Rust, TypeScript, benchmark, security, and packaged-browser jobs are skipped. Required jobs use job-level conditions so GitHub records a successful skip rather than leaving a required check pending. The lightweight change-scope and documentation checks are also required, so classification or docs-validation failures still block merging.

All required jobs must pass before a PR can merge. CI is intentionally strict — `oxlint --deny-warnings` and `cargo clippy -D warnings` mean even cosmetic warnings block the build.

## Style

- **Rust**: standard `rustfmt`, `clippy::pedantic` not enforced but appreciated
- **TypeScript**: `oxfmt` for formatting, `oxlint` for linting (no ESLint config)
- **No emojis in code or comments** unless they're part of test data
- **Docstrings welcome** but not enforced — focus on clear naming over verbose comments

## Adding a new algorithm

If you're adding to an existing package:

1. Implement the Rust function in `crates/vizcrush-<package>/src/<module>.rs`
2. Add `#[wasm_bindgen]` exports for any function called from JS
3. Add a TypeScript wrapper in `packages/<package>/src/index.ts` with a JS fallback
4. Add tests on both sides (`*_test.rs` in Rust, `index.test.ts` in TS)
5. Update the relevant docs page under `docs/packages/`

If you're adding a whole new package, see **[Packages Layout / Adding a new package](packages.md#adding-a-new-package)**.

## Adding to the docs

The docs site lives in `docs/`. Pages are Markdown processed by [VitePress](https://vitepress.dev/).

```bash
pnpm docs:dev
```

When adding a new page, update `docs/.vitepress/config.mts` if it should appear in the navigation or sidebar.

The docs site is auto-deployed to GitHub Pages on push to `main` via `.github/workflows/docs-deploy.yml`.

## Filing issues

Good bug reports include:

- vizcrush version (commit SHA if building from source)
- Browser / Node version
- Backend (`ctx.backend` from `await init()`)
- A minimal repro (CodeSandbox link or short script)

For performance issues, include:

- Input size (number of points)
- Algorithm name
- Expected vs actual time

## Code of conduct

Be kind. Be patient. Assume good intent. Help others.

## See also

- **[Architecture](architecture.md)**
- **[Building from Source](building.md)**
- **[Packages Layout](packages.md)**
- **Repo [CONTRIBUTING.md](https://github.com/debug-diary-1/vizcrush/blob/main/CONTRIBUTING.md)** for the long form
