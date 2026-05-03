-- Migration: 20260403720000_backfill_diagram_registry.sql
-- Purpose: Two-step backfill for diagram data.
--   Step 1: Insert canonical diagram records into ncert_diagram_registry from
--           rag_content_chunks rows where content_type='diagram' and media_url IS NOT NULL.
--           Diagram key format: g{grade_num}_{subject_slug}_ch{chapter_padded}_d{seq}
--           e.g. "g7_science_ch01_d1"
--   Step 2: Set rag_content_chunks.diagram_id by joining on media_url + grade + subject + chapter_number.
--
-- Both steps are idempotent:
--   Step 1: ON CONFLICT (grade, subject, chapter_number, diagram_key) DO NOTHING
--   Step 2: WHERE diagram_id IS NULL guard


-- ============================================================================
-- Step 1: Insert canonical diagram records into ncert_diagram_registry
-- ============================================================================

DO $$
DECLARE
  v_inserted INTEGER;
BEGIN

  INSERT INTO ncert_diagram_registry (
    grade,
    subject,
    chapter_number,
    diagram_key,
    title,
    description,
    file_url,
    page_number,
    related_concepts,
    syllabus_version,
    source,
    is_active
  )
  -- Deduplicate: one canonical row per media_url, choosing the chunk with the
  -- lowest chunk_index (then lowest id) as the representative row.
  WITH deduped AS (
    SELECT DISTINCT ON (rcc.media_url)
      regexp_replace(rcc.grade, '[^0-9]', '', 'g')         AS p5_grade,
      rcc.subject,
      rcc.chapter_number,
      rcc.media_url,
      rcc.media_description,
      rcc.topic,
      rcc.chapter_title,
      rcc.page_number
    FROM rag_content_chunks rcc
    WHERE rcc.content_type = 'diagram'
      AND rcc.media_url IS NOT NULL
      AND rcc.is_active = true
    ORDER BY rcc.media_url,
             rcc.chunk_index ASC NULLS LAST,
             rcc.id ASC
  ),
  -- Assign per-chapter sequence numbers over the full deduplicated result set.
  -- ROW_NUMBER() must see all rows at once; a LATERAL join would only see one
  -- outer row per invocation and would always return seq = 1.
  with_seq AS (
    SELECT *,
      ROW_NUMBER() OVER (
        PARTITION BY p5_grade, subject, chapter_number
        ORDER BY media_url ASC
      ) AS seq
    FROM deduped
  )
  SELECT
    p5_grade,
    subject,           -- already in full-name format (e.g. "Science") from rag_content_chunks
    chapter_number,
    -- Stable key: g{grade}_{subject_slug}_ch{chapter_0-padded}_d{seq}
    'g' || p5_grade
      || '_' || lower(replace(replace(subject, ' ', '_'), '-', '_'))
      || '_ch' || lpad(chapter_number::text, 2, '0')
      || '_d' || seq                                        AS diagram_key,
    -- Title: prefer media_description, fall back to chapter_title + " diagram"
    COALESCE(NULLIF(trim(media_description), ''),
             COALESCE(NULLIF(trim(chapter_title), ''), 'Diagram')
               || ' diagram')                               AS title,
    media_description                                       AS description,
    media_url                                               AS file_url,
    page_number,
    -- related_concepts: wrap topic in array, drop NULLs
    ARRAY_REMOVE(ARRAY[topic], NULL)::text[]                AS related_concepts,
    '2025-26'                                               AS syllabus_version,
    'NCERT'                                                 AS source,
    true                                                    AS is_active
  FROM with_seq
  ON CONFLICT (grade, subject, chapter_number, diagram_key) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RAISE NOTICE '[20260403720000] backfill_diagram_registry step 1: % rows inserted into ncert_diagram_registry', v_inserted;
END;
$$;


-- ============================================================================
-- Step 2: Update rag_content_chunks.diagram_id
-- ============================================================================

DO $$
DECLARE
  v_updated INTEGER;
BEGIN

  UPDATE rag_content_chunks rcc
  SET diagram_id = ndr.id
  FROM ncert_diagram_registry ndr
  WHERE rcc.diagram_id IS NULL                        -- idempotent: only unset rows
    AND rcc.content_type = 'diagram'
    AND rcc.media_url IS NOT NULL
    AND rcc.media_url = ndr.file_url
    AND regexp_replace(rcc.grade, '[^0-9]', '', 'g') = ndr.grade
    AND rcc.subject = ndr.subject
    AND rcc.chapter_number = ndr.chapter_number;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RAISE NOTICE '[20260403720000] backfill_diagram_registry step 2: % rag_content_chunks rows updated with diagram_id', v_updated;
END;
$$;


-- ============================================================================
-- End of migration: 20260403720000_backfill_diagram_registry.sql
--
-- Tables modified:
--   ncert_diagram_registry — rows inserted (idempotent via ON CONFLICT DO NOTHING)
--   rag_content_chunks     — diagram_id column backfilled (idempotent via IS NULL guard)
-- RLS: no change (tables and policies already exist from migration 20260403700000)
-- New tables: none
-- New RPCs: none
-- Diagram key format: g{grade}_{subject_slug}_ch{chapter_padded}_d{seq}
--   example: g7_science_ch01_d1, g7_science_ch01_d2
-- Idempotent: yes (ON CONFLICT DO NOTHING + WHERE diagram_id IS NULL)
-- ============================================================================
