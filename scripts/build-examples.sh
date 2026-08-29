#!/usr/bin/env bash
#
# Builds every example into one static gallery.
#
# The gallery has existed as a local-only thing since the beginning: `pnpm
# examples` serves it, and nobody who has not cloned the repo can see any of it.
# This produces a directory that can be uploaded as-is.
#
# Two things here are not obvious.
#
# 1. `--target esnext`. Two examples use top-level await, which Vite's default
#    build target (chrome87/es2020) rejects. Every browser that can run our
#    WASM can run top-level await, so raising the target is correct rather than
#    a workaround.
#
# 2. No wasm copying. The packages self-reference their own `./wasm/*` export
#    with a plain `import()`, so bundlers resolve the wasm-bindgen glue as a
#    module and emit the `.wasm` themselves as a hashed asset. This script used
#    to copy `packages/*/wasm/` into every example because the old loader hid
#    its specifier from bundlers and the WASM path silently fell back to the JS
#    core without it.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/docs/.vitepress/dist/examples}"

cd "$ROOT"

echo "building examples into $OUT"
rm -rf "$OUT"
mkdir -p "$OUT"

built=0
failed=0
failures=""

for dir in examples/*/; do
  name="$(basename "$dir")"
  [ "$name" = "node_modules" ] && continue
  [ -f "$dir/index.html" ] || continue

  if (cd "$dir" && npx vite build --base=./ --target=esnext --logLevel=error) >/tmp/vizcrush-example-build.log 2>&1; then
    mkdir -p "$OUT/$name"
    cp -R "$dir/dist/." "$OUT/$name/"

    built=$((built + 1))
    printf '  ok   %s\n' "$name"
  else
    failed=$((failed + 1))
    failures="$failures $name"
    printf '  FAIL %s\n' "$name"
    grep -vE '^\s+at ' /tmp/vizcrush-example-build.log | tail -4 | sed 's/^/       /'
  fi
done

# The gallery index links to ./<name>/, so it belongs at the root of the output.
cp examples/index.html "$OUT/index.html"

echo
echo "built $built example(s), $failed failed"
if [ "$failed" -ne 0 ]; then
  echo "failed:$failures"
  exit 1
fi
