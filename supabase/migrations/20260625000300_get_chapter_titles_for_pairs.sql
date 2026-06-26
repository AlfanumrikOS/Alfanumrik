-- New RPC: get_chapter_titles_for_pairs
--
-- Single-round-trip lookup of chapter titles for an array of
-- (subject_code, chapter_number) pairs. Used by GET /api/v2/today to surface
-- human-readable chapter names in the Today queue (Bug #3 fix).
--
-- SECURITY INVOKER — reads curriculum_topics (published content, no PII).
-- The student's JWT scopes the read; no cross-student data is possible.
-- Idempotent (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.get_chapter_titles_for_pairs(
  p_pairs jsonb   -- Array of {"s": subject_code_text, "c": chapter_number_int}
)
RETURNS TABLE(
  subject_code   text,
  chapter_number integer,
  title          text,
  title_hi       text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    s.code            AS subject_code,
    ct.chapter_number,
    ct.title,
    ct.title_hi
  FROM curriculum_topics ct
  JOIN subjects s ON s.id = ct.subject_id
  WHERE ct.is_active = true
    AND ct.parent_topic_id IS NULL        -- top-level chapter entries only
    AND (ct.deleted_at IS NULL OR ct.deleted_at > now())
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_pairs) AS pair
      WHERE pair->>'s' = s.code
        AND (pair->>'c')::integer = ct.chapter_number
    )
  ORDER BY s.code, ct.chapter_number;
$$;

GRANT EXECUTE ON FUNCTION public.get_chapter_titles_for_pairs(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_chapter_titles_for_pairs IS
  '2026-06-25: Single-round-trip chapter title lookup for the Today queue. '
  'Takes a jsonb array of {s: subject_code, c: chapter_number} pairs and '
  'returns EN + HI titles from curriculum_topics. SECURITY INVOKER.';
