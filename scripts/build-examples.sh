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
# 2. The wasm copy. Each package loads its WASM through a runtime specifier
#    (`new Function("p", "return import(p)")("../wasm/<crate>.js")`) that is
#    deliberately opaque to bundlers, so the module keeps resolving against the
#    package's own `dist/` when consumed from node_modules. Once the code is
#    bundled, that path resolves against the emitted chunk instead. Chunks land
#    in `<example>/assets/`, so `../wasm/` means `<example>/wasm/` and the files
#    have to be there or every WASM path silently falls back to the JS core.
#    Silently is the problem: nothing errors, the examples just quietly stop
#    demonstrating the thing they exist to demonstrate.
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

    # See note 2 above: put every crate's wasm where the bundled runtime
    # import will look for it. Copying all of them costs a little space and
    # removes a per-example dependency list that would rot.
    mkdir -p "$OUT/$name/wasm"
    for wasmdir in packages/*/wasm; do
      [ -d "$wasmdir" ] && cp -R "$wasmdir/." "$OUT/$name/wasm/"
    done

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
