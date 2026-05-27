#!/usr/bin/env bash
# scripts/check-config-parity.sh
# Ensures src/lib/grounding-config.ts and supabase/functions/grounded-answer/config.ts export the same constants.
set -e

WEB="src/lib/grounding-config.ts"
DENO="supabase/functions/grounded-answer/config.ts"

if [ ! -f "$WEB" ] || [ ! -f "$DENO" ]; then
  exit 1
fi

extract() {
  grep -E '^export const [A-Z_]+[[:space:]]*=' "$1" | sed -E 's/[[:space:]]+/ /g' | sort
}

DIFF=$(diff <(extract "$WEB") <(extract "$DENO") || true)
if [ -n "$DIFF" ]; then
  echo "Config parity FAIL — $WEB diverges from $DENO:"
  echo "$DIFF"
  exit 1
fi

echo "Config parity OK"