#!/usr/bin/env bash
set -euo pipefail

# Build every runnable Vite example. build-examples.sh discovers directories
# from the filesystem, so a newly added example cannot be missed by a static
# allowlist.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

EXAMPLE_BUILD_OUT="$(mktemp -d "${TMPDIR:-/tmp}/vizcrush-examples.XXXXXX")"
trap 'rm -rf -- "$EXAMPLE_BUILD_OUT"' EXIT

bash scripts/build-examples.sh "$EXAMPLE_BUILD_OUT"

# Examples must run in a fresh clone without an undeclared global command.
if grep -R --include=package.json -n '"dev": "portless ' examples; then
  echo "example dev scripts must invoke vite directly"
  exit 1
fi

# The MCP walkthrough is documentation rather than a Vite application.
required_mcp_files=(
  examples/mcp-demo/README.md
  examples/mcp-demo/mcp-config-claude.json
  examples/mcp-demo/scenarios/trading-dashboard.md
)

for file in "${required_mcp_files[@]}"; do
  if [ ! -f "$file" ]; then
    echo "missing $file"
    exit 1
  fi
done

echo "all runnable examples and MCP walkthrough files passed"
