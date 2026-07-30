#!/usr/bin/env bash
set -euo pipefail

# Test all examples by installing deps and running a type-check build.
# Does NOT start dev servers — just verifies they can build.

EXAMPLES=(
  financial-timeseries
  iot-heatmap
  streaming-dashboard
  chartgpu-integration
  d3-large-scatter
)

PASS=0
FAIL=0

for example in "${EXAMPLES[@]}"; do
  dir="examples/${example}"
  echo ""
  echo "=== Testing ${example} ==="

  if [ ! -f "${dir}/package.json" ]; then
    echo "  SKIP — no package.json"
    continue
  fi

  cd "${dir}"

  # Install deps (link workspace packages)
  if pnpm install --no-frozen-lockfile 2>&1 | tail -1; then
    echo "  ✓ install"
  else
    echo "  ✗ install failed"
    FAIL=$((FAIL + 1))
    cd ../..
    continue
  fi

  # Build (vite build)
  if pnpm build 2>&1 | tail -3; then
    echo "  ✓ build"
    PASS=$((PASS + 1))
  else
    echo "  ✗ build failed"
    FAIL=$((FAIL + 1))
  fi

  cd ../..
done

# MCP demo — no build, just check files exist
echo ""
echo "=== Testing mcp-demo ==="
for f in examples/mcp-demo/README.md examples/mcp-demo/mcp-config-claude.json examples/mcp-demo/scenarios/trading-dashboard.md; do
  if [ -f "$f" ]; then
    echo "  ✓ ${f}"
  else
    echo "  ✗ ${f} missing"
    FAIL=$((FAIL + 1))
  fi
done
PASS=$((PASS + 1))

echo ""
echo "==================================="
echo "Results: ${PASS} passed, ${FAIL} failed"
if [ ${FAIL} -gt 0 ]; then
  exit 1
fi
