# Security Policy

## Supported Versions

| Version                                      | Supported |
| -------------------------------------------- | --------- |
| Latest release of each `@vizcrush/*` package | ✅        |
| Older releases                               | ❌        |

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

Please report security issues privately via GitHub's vulnerability reporting:
[github.com/debug-diary-1/vizcrush/security/advisories/new](https://github.com/debug-diary-1/vizcrush/security/advisories/new)
(repository **Security** tab → **Report a vulnerability**). Include:

1. Description of the vulnerability
2. Steps to reproduce
3. Potential impact
4. Suggested fix (if any)

You can expect an acknowledgment within a few days. This is a
single-maintainer project, so please allow reasonable time for a fix before
public disclosure.

## Scope

The following components are in scope:

- **@vizcrush/mcp-server** — MCP tool handlers, HTTP transport, file input
- **@vizcrush/core** — WASM loading, backend capability detection
- **All @vizcrush/\* packages** — data processing algorithms
- **CI/CD pipeline** — GitHub Actions workflows, npm publishing
- **WASM artifacts** — binary integrity, build pipeline

## Security Measures

- GitHub Actions are SHA-pinned (not tag-based)
- npm packages are published with SLSA provenance attestation
- WASM artifacts are checksummed via `.supplychainshield/wasm-manifest.json`
- MCP HTTP server supports bearer token authentication
- File access in MCP tools is restricted to allowed directories
- Dependencies are audited via `pnpm audit` and `cargo audit` in CI
