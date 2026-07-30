#!/usr/bin/env bash
set -euo pipefail

echo "==> Building Rust crates to WASM+SIMD..."

# Ensure wasm32 target is installed
rustup target add wasm32-unknown-unknown 2>/dev/null || true

# Build all crates targeting WASM with SIMD128
RUSTFLAGS="-C target-feature=+simd128" cargo build \
  --target wasm32-unknown-unknown \
  --release \
  --workspace

echo "==> WASM build complete."

# Check if wasm-bindgen CLI is available
if ! command -v wasm-bindgen &> /dev/null; then
  echo "==> wasm-bindgen-cli not found. Install with: cargo install wasm-bindgen-cli"
  echo "    Skipping bindgen step."
  exit 0
fi

# wasm-opt (binaryen) is required: it shrinks the shipped binaries ~10-12%
# (faster download/parse). Fail loudly rather than silently skip — a silent
# skip is how we shipped un-optimized binaries for months (see docs/adr/0002).
# Opt out explicitly with SKIP_WASM_OPT=1 if you really must.
if [ "${SKIP_WASM_OPT:-0}" != "1" ] && ! command -v wasm-opt &> /dev/null; then
  echo "ERROR: wasm-opt (binaryen) not found." >&2
  echo "  Install it:  brew install binaryen   (or your platform's package manager)" >&2
  echo "  Or skip the optimization step explicitly:  SKIP_WASM_OPT=1 pnpm build:wasm" >&2
  exit 1
fi

WASM_DIR="target/wasm32-unknown-unknown/release"

# Crate name → package directory mapping
# Using parallel arrays for bash 3 compatibility (macOS default)
# vizcrush_core is deliberately absent: it's a plain Rust utility crate
# (rlib only, no #[wasm_bindgen] surface) that the crates below compile in
# as a normal dependency — it has nothing to bindgen on its own.
CRATES=(
  vizcrush_downsample
  vizcrush_bin
  vizcrush_bin3d
  vizcrush_aggregate
  vizcrush_transform
  vizcrush_spatial
  vizcrush_spatial3d
)
PACKAGES=(
  downsample
  bin
  bin3d
  aggregate
  transform
  spatial
  spatial3d
)

for i in "${!CRATES[@]}"; do
  crate="${CRATES[$i]}"
  pkg="${PACKAGES[$i]}"
  wasm_file="${WASM_DIR}/${crate}.wasm"

  if [ -f "$wasm_file" ]; then
    echo "==> Generating bindings for ${crate} → packages/${pkg}/wasm/"
    mkdir -p "packages/${pkg}/wasm"

    # Size-optimize with binaryen. `-all` enables every wasm feature rustc
    # emits (bulk-memory, nontrapping-float-to-int, sign-ext, simd128, …);
    # without it wasm-opt fails validation on `memory.copy` / `i32.trunc_sat_*`.
    # Note: this is a SIZE optimization — benchmarks show no runtime/SIMD gain
    # for these branch-heavy algorithms (docs/adr/0002).
    if [ "${SKIP_WASM_OPT:-0}" != "1" ]; then
      wasm-opt -O3 -all "$wasm_file" -o "$wasm_file.opt"
      mv "$wasm_file.opt" "$wasm_file"
    fi

    wasm-bindgen \
      --target web \
      --out-dir "packages/${pkg}/wasm/" \
      "$wasm_file"
  else
    echo "==> Warning: ${wasm_file} not found, skipping ${crate}"
  fi
done

echo "==> WASM bindgen complete."

# Generate WASM integrity manifest
echo "==> Generating WASM integrity manifest..."
MANIFEST=".supplychainshield/wasm-manifest.json"
mkdir -p .supplychainshield

echo '{' > "$MANIFEST"
echo '  "generated_at": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",' >> "$MANIFEST"
echo '  "artifacts": {' >> "$MANIFEST"

FIRST=true
for pkg_dir in packages/*/wasm; do
  if [ -d "$pkg_dir" ]; then
    for wasm_file in "$pkg_dir"/*.wasm; do
      if [ -f "$wasm_file" ]; then
        HASH=$(shasum -a 256 "$wasm_file" | cut -d' ' -f1)
        if [ "$FIRST" = true ]; then
          FIRST=false
        else
          echo ',' >> "$MANIFEST"
        fi
        printf '    "%s": "sha256:%s"' "$wasm_file" "$HASH" >> "$MANIFEST"
      fi
    done
  fi
done

echo '' >> "$MANIFEST"
echo '  }' >> "$MANIFEST"
echo '}' >> "$MANIFEST"

echo "==> WASM manifest written to $MANIFEST"
