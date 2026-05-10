-- Add grounded_from_chunks to grounded_ai_traces.
--
-- Why: grounded_ai_traces.grounded is the API-shape discriminator
-- (true = answer returned, false = abstain). It does NOT mean "the answer
-- was actually produced from retrieved NCERT chunks". For 30 days post-2026-04
-- 287 / 309 foxy traces (93%) had grounded=true with chunk_count=0 — the
-- service answered from "general CBSE knowledge" but the trace claimed
-- grounded success. This led every dashboard, alert, and post-mortem to
-- silently miss the broken-RAG bug ultimately fixed in PR #692.
--
-- groundedFromChunks already exists on the GroundedResponse wire shape
-- (Phase 0 Fix 0.5) — this migration backs it with a persistent column so
-- analytics can finally distinguish "Claude succeeded" from "Claude
-- succeeded WITH grounding". Audit 2026-05-10.

ALTER TABLE grounded_ai_traces
  ADD COLUMN IF NOT EXISTS grounded_from_chunks BOOLEAN;

COMMENT ON COLUMN grounded_ai_traces.grounded_from_chunks IS
  'True when the answer was actually produced from retrieved NCERT chunks '
  'in either strict mode (grounding-check passed) or soft mode (chunks '
  'present and no general-knowledge escape prefix). False when soft mode '
  'fell back to general knowledge OR no chunks were retrieved. NULL on '
  'rows from before this column was added (2026-05-16) and on abstain '
  'rows (no answer to evaluate). Prefer this over `grounded` for true '
  'citation-backed answer rate metrics.';

-- Backfill: rows without chunks cannot have been grounded-from-chunks.
-- This converts the most-misleading historical data point (287 false-
-- positive grounded traces) from NULL to FALSE so dashboards correct
-- themselves immediately rather than after 30 days of new traffic.
UPDATE grounded_ai_traces
SET grounded_from_chunks = FALSE
WHERE chunk_count = 0
  AND grounded = TRUE
  AND grounded_from_chunks IS NULL;
