#!/usr/bin/env bash
set -euo pipefail

echo "=== vizcrush full build ==="

# Step 1: Build Rust → WASM+SIMD
echo "--- Step 1: Building WASM ---"
bash scripts/build-wasm.sh

# Step 2: Build TypeScript packages
echo "--- Step 2: Building TypeScript ---"
pnpm turbo build

echo "=== Build complete ==="
