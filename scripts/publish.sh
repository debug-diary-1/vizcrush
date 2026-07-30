#!/usr/bin/env bash
set -euo pipefail

echo "=== Publishing vizcrush v1.0.0 ==="

# Build first
bash scripts/build-all.sh

# Publish order matters — dependencies first
PACKAGES=(
  core
  downsample
  bin
  bin3d
  aggregate
  transform
  spatial
  spatial3d
  ai
  react
  mcp-server
)

for pkg in "${PACKAGES[@]}"; do
  echo ""
  echo "--- Publishing @vizcrush/${pkg} ---"
  cd "packages/${pkg}"
  pnpm publish --access public --no-git-checks --provenance
  cd ../..
done

echo ""
echo "=== All 11 packages published ==="
echo ""
echo "Install with: npm install @vizcrush/core @vizcrush/downsample"
echo "MCP server:   npx @vizcrush/mcp-server"
