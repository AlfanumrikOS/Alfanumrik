-- Backfill script: Enrich concept_explanation chunks with topic/bloom/concept
-- Run via Supabase SQL Editor or psql — NOT a migration (data operation only).
--
-- Problem: 8,880 chunks have chunk_type = 'concept_explanation' but topic,
-- concept, and bloom_level are all NULL. This limits RAG filtering.
--
-- Approach:
--   1. topic <- chapter_title (the chapter IS the topic for these chunks)
--   2. bloom_level <- 'understand' (concept explanations are primarily
--      comprehension-level content; without content_layer column we default
--      to the most representative Bloom's level for explanatory text)
--   3. concept <- first line of chunk_text (rough heuristic, better than NULL)

-- ── 1. Populate topic from chapter_title ─────────────────────────────────────
UPDATE rag_content_chunks
SET topic = chapter_title
WHERE topic IS NULL
  AND chunk_type = 'concept_explanation'
  AND chapter_title IS NOT NULL
  AND chapter_title != '';

-- ── 2. Populate bloom_level ──────────────────────────────────────────────────
-- Without a content_layer column, we assign 'understand' as the default for
-- concept explanations (they explain ideas, which maps to Bloom's "understand").
-- The 1,492 paragraph/question chunks already have bloom_level set by the
-- ingestion pipeline.
UPDATE rag_content_chunks
SET bloom_level = 'understand'
WHERE bloom_level IS NULL
  AND chunk_type = 'concept_explanation';

-- ── 3. Populate concept from first line of chunk_text ────────────────────────
-- Extract the first non-empty line, strip leading numbering, truncate to 100 chars.
UPDATE rag_content_chunks
SET concept = LEFT(
  TRIM(
    REGEXP_REPLACE(
      SPLIT_PART(chunk_text, E'\n', 1),
      '^\d+[\.\)]\s*', ''
    )
  ), 100)
WHERE concept IS NULL
  AND chunk_type = 'concept_explanation'
  AND chunk_text IS NOT NULL
  AND chunk_text != '';

-- ── Verification query ───────────────────────────────────────────────────────
-- Run after the updates to confirm coverage:
SELECT
  COUNT(*) AS total,
  COUNT(topic) AS with_topic,
  COUNT(bloom_level) AS with_bloom,
  COUNT(concept) AS with_concept,
  ROUND(100.0 * COUNT(topic) / NULLIF(COUNT(*), 0), 1) AS topic_pct,
  ROUND(100.0 * COUNT(bloom_level) / NULLIF(COUNT(*), 0), 1) AS bloom_pct,
  ROUND(100.0 * COUNT(concept) / NULLIF(COUNT(*), 0), 1) AS concept_pct
FROM rag_content_chunks
WHERE chunk_type = 'concept_explanation';