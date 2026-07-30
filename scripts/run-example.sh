#!/usr/bin/env bash
set -euo pipefail

# Run a vizcrush example by name.
# Usage: pnpm example <name>
# Example: pnpm example flow-field
#          pnpm example latency-percentiles

NAME="${1:-}"

if [ -z "$NAME" ]; then
  echo "Usage: pnpm example <name>"
  echo ""
  echo "Available examples:"
  ls -1 examples/*/package.json 2>/dev/null | sed 's|examples/||;s|/package.json||' | grep -v "^catalog$" | sort | column
  exit 1
fi

DIR="examples/$NAME"

if [ ! -d "$DIR" ]; then
  echo "Error: example '$NAME' not found."
  echo ""
  echo "Available examples:"
  ls -1 examples/*/package.json 2>/dev/null | sed 's|examples/||;s|/package.json||' | grep -v "^catalog$" | sort | column
  exit 1
fi

cd "$DIR"
exec pnpm dev
