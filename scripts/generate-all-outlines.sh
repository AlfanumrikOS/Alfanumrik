#!/usr/bin/env bash
# scripts/generate-all-outlines.sh
#
# Phase 4.7 — batch driver for scripts/generate-rag-pack.ts.
# Loops through every outline in data/rag-packs/outlines/, runs the
# Claude generator + quality oracle, writes one JSONL pack per outline.
#
# Required env: ANTHROPIC_API_KEY
# Optional env: OUTLINES_GLOB  (default: data/rag-packs/outlines/*.json)
#               OUT_DIR         (default: data/rag-packs/)
#               GEN_MODEL       (default: haiku)
#
# After this completes, manually review each generated JSONL before
# running scripts/ingest-rag-pack.ts to upload to Supabase. P12 gate.

set -euo pipefail

OUTLINES_GLOB="${OUTLINES_GLOB:-data/rag-packs/outlines/*.json}"
OUT_DIR="${OUT_DIR:-data/rag-packs}"
GEN_MODEL="${GEN_MODEL:-haiku}"

if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "ERROR: ANTHROPIC_API_KEY is not set" >&2
  exit 2
fi

shopt -s nullglob
files=( $OUTLINES_GLOB )
if [[ ${#files[@]} -eq 0 ]]; then
  echo "ERROR: no outline files matched '$OUTLINES_GLOB'" >&2
  exit 2
fi

echo "Batch generation: ${#files[@]} outlines, model=$GEN_MODEL"
echo "Output dir:        $OUT_DIR"
echo ""

total_accepted=0
total_rejected=0
failed_outlines=()

for outline in "${files[@]}"; do
  base="$(basename "$outline" .json)"
  # Strip leading 'class06-' style prefix if present and just use the base
  out_path="${OUT_DIR}/generated-${base#generated-}.jsonl"
  echo "==> $outline"
  echo "    -> $out_path"
  if npx tsx scripts/generate-rag-pack.ts \
       --outline "$outline" \
       --out "$out_path" \
       --model "$GEN_MODEL"; then
    echo "    OK"
  else
    rc=$?
    echo "    FAILED (exit $rc)"
    failed_outlines+=("$outline")
  fi
  echo ""
done

echo "==============================================="
echo "Batch generation complete."
echo "Outlines processed: ${#files[@]}"
echo "Failed outlines:    ${#failed_outlines[@]}"
if [[ ${#failed_outlines[@]} -gt 0 ]]; then
  echo "Failed list:"
  for o in "${failed_outlines[@]}"; do
    echo "  - $o"
  done
fi
echo ""
echo "Next steps:"
echo "  1. Manually review each generated *.jsonl in $OUT_DIR"
echo "  2. Run: npx tsx scripts/ingest-rag-pack.ts --pack <path> --dry-run"
echo "  3. Set Supabase env vars and ingest for real"

if [[ ${#failed_outlines[@]} -gt 0 ]]; then
  exit 1
fi
