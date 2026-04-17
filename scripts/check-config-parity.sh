#!/usr/bin/env bash
# scripts/check-config-parity.sh
# Ensures src/lib/grounding-config.ts and supabase/functions/grounded-answer/config.ts
# export the same constants with the same values. CI gate for the grounded-answer
# service — divergence means Next.js and Deno sides will disagree on thresholds.
set -eo pipefail

WEB="src/lib/grounding-config.ts"
DENO="supabase/functions/grounded-answer/config.ts"

if [ ! -f "$WEB" ] || [ ! -f "$DENO" ]; then
  echo "Missing config file: $WEB or $DENO"
  exit 1
fi

# Extract exported const name=value pairs (whitespace-normalized)
extract() {
  grep -E '^export const [A-Z_]+\s*=' "$1" | \
    sed -E 's/\s+/ /g' | sort
}

DIFF=$(diff <(extract "$WEB") <(extract "$DENO") || true)
if [ -n "$DIFF" ]; then
  echo "Config parity FAIL — src/lib/grounding-config.ts diverges from supabase/functions/grounded-answer/config.ts:"
  echo "$DIFF"
  exit 1
fi
echo "Config parity OK"