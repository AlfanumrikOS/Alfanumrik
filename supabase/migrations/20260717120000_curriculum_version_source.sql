-- Migration: 20260717120000_curriculum_version_source.sql
-- Purpose: Monotonic, per-scope curriculum-content version source for the mobile
--          offline cache. Powers GET /api/v2/curriculum-version (route built
--          separately by backend against the contract documented below).
--
-- WHY: The Flutter Learn cache keys content by (subject_code, grade) — cache keys
--      `chapters_<subject>_<grade>`, `topics_<chapterId>`, `topic_<topicId>` — and
--      today uses a blind 5-minute TTL with no version anchor. The client will poll
--      a cheap per-scope version and: server > local -> purge+refetch that scope;
--      equal -> serve cache instantly; offline -> serve cache within a 7-day stale
--      window. So each scope's version MUST be monotonic (never move backward) and
--      reflect edits AND deletes to the content the client caches.
--
-- CONTENT SOURCES the mobile Learn cache reflects (verified against the live code
-- paths, 2026-07-17):
--   1. curriculum_topics  -> the subjects->chapters->topics tree
--      (apps/host/src/app/api/v2/learn/curriculum/route.ts via
--       getActiveTopicsForSubjects: WHERE subject_id IN (...) AND grade = <g> AND is_active).
--   2. rag_content_chunks  -> the NCERT concept prose per chapter
--      (apps/host/src/app/api/v2/learn/concept/route.ts via fetchChapterContent;
--       canonical catalog scoping columns are subject_code + grade_short, per
--       cbse_syllabus_rag_ready() and idx_rag_chunks_catalog_join).
--
-- MONOTONICITY MODEL (survives edits AND deletes):
--   version(subject_code, grade) =
--     floor(epoch from GREATEST(
--        max(curriculum_topics.updated_at over the scope, ALL rows),
--        max(rag_content_chunks.updated_at over the scope, ALL rows),
--        delete-watermark high-water epoch for the scope))
--   * Inserts move the version forward (new rows default updated_at = now()).
--   * Edits + SOFT deletes move it forward: this migration adds a BEFORE UPDATE
--     updated_at trigger to curriculum_topics (its soft-delete path,
--     `UPDATE curriculum_topics SET is_active=false` in the internal admin content
--     route, did NOT set updated_at — verified — so updated_at was NOT reliably
--     bumped; the trigger closes that gap). rag_content_chunks already has a
--     reliable BEFORE UPDATE updated_at trigger (set_updated_at).
--   * The aggregation is is_active-AGNOSTIC (all rows, not just active ones). A
--     soft delete flips is_active while bumping updated_at forward, so the row stays
--     in the max() and the version advances — a WHERE is_active=true aggregation
--     would instead drop the row and could move the max backward.
--   * HARD deletes are the only operation that can lower max(updated_at) (the
--     max-holder row disappears). Hard deletes DO happen on rag_content_chunks
--     (re-ingest pipeline / tests). The per-scope delete watermark below captures
--     them: an AFTER DELETE trigger bumps the scope's high-water to now(); GREATEST
--     then keeps the version >= its pre-delete value AND advances it, so the client
--     purges the deleted content. Result: provably non-decreasing under insert,
--     update, soft delete, and hard delete.
--
-- P5: grades are strings "6".."12" everywhere. P8: the one new table has RLS enabled
--     with policies in this same migration. Additive only — no DROP.

-- ============================================================================
-- 1. Delete-watermark table (per-scope high-water mark)
-- ============================================================================
-- Global content-infra metadata: one row per '<subject_code>::<grade>' scope,
-- holding the highest unix-epoch (seconds) ever observed at a hard delete in that
-- scope. NO per-user rows, NO PII (scope keys + epoch ints only).
CREATE TABLE IF NOT EXISTS public.curriculum_version_watermark (
  scope_key   text        PRIMARY KEY,          -- '<subject_code>::<grade>'
  hw_epoch    bigint      NOT NULL DEFAULT 0,    -- monotonic high-water (unix seconds)
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.curriculum_version_watermark IS
  'Per-scope (<subject_code>::<grade>) delete high-water mark for the monotonic '
  'curriculum-version source (get_curriculum_versions). Captures hard deletes so a '
  'scope version cannot move backward when the max(updated_at) row disappears. '
  'Global content-infra metadata: no per-user rows, no PII. The standard four-pattern '
  '(student/parent/teacher/admin) RLS does not apply — the tightest correct posture is '
  'service_role-only; the version RPC reads it via SECURITY DEFINER.';

-- P8: RLS enabled + policy in the same migration.
ALTER TABLE public.curriculum_version_watermark ENABLE ROW LEVEL SECURITY;

-- Service role only (write path = table triggers running definer-side; read path =
-- the SECURITY DEFINER RPC). No anon/authenticated policy: clients never touch this
-- table directly, they get version ints from the RPC.
DROP POLICY IF EXISTS "cvw_service_all" ON public.curriculum_version_watermark;
CREATE POLICY "cvw_service_all" ON public.curriculum_version_watermark
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- 2. Reliable updated_at on curriculum_topics (close the soft-delete gap)
-- ============================================================================
-- Reuses the existing hardened public.update_updated_at_column() (BEGIN NEW.updated_at
-- = now(); RETURN NEW). Fires on EVERY update, so is_active/deleted_at flips and
-- content edits that omit updated_at now advance the version. rag_content_chunks
-- already has an equivalent trigger (set_updated_at); no change needed there.
DROP TRIGGER IF EXISTS trg_curriculum_topics_updated_at ON public.curriculum_topics;
CREATE TRIGGER trg_curriculum_topics_updated_at
  BEFORE UPDATE ON public.curriculum_topics
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- 3. Indexes for fast, index-only max(updated_at) per scope
-- ============================================================================
-- Both lead with the grade column so the "all subjects for a grade" poll and the
-- "subject-filtered" poll are both index-served; updated_at is trailing so max() is
-- index-only. Unfiltered (is_active-agnostic) to match the monotonic aggregation.
CREATE INDEX IF NOT EXISTS idx_ct_version_src
  ON public.curriculum_topics (grade, subject_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_rag_version_src
  ON public.rag_content_chunks (grade_short, subject_code, updated_at DESC)
  WHERE subject_code IS NOT NULL AND grade_short IS NOT NULL;

-- ============================================================================
-- 4. Delete-watermark triggers (statement-level, transition-table, bulk-safe)
-- ============================================================================
-- SECURITY DEFINER: the watermark table is service_role-only (RLS). Deletes on the
-- content tables are admin/service_role-only today, but DEFINER guarantees the
-- watermark write always succeeds regardless of the deleting role, so the trigger
-- can never block a content delete. No user input is interpolated (values are now()
-- + catalog joins), so DEFINER carries no injection surface. Statement-level with a
-- transition table collapses a bulk delete (e.g. re-ingest of a chapter's chunks)
-- into one UPSERT per distinct scope.

CREATE OR REPLACE FUNCTION public.bump_curriculum_watermark_rag_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.curriculum_version_watermark (scope_key, hw_epoch, updated_at)
  SELECT d.subject_code || '::' || d.grade_short,
         floor(extract(epoch FROM now()))::bigint,
         now()
  FROM deleted_rows d
  WHERE d.subject_code IS NOT NULL
    AND d.grade_short IS NOT NULL
  GROUP BY d.subject_code, d.grade_short
  ON CONFLICT (scope_key) DO UPDATE
    SET hw_epoch   = GREATEST(public.curriculum_version_watermark.hw_epoch, EXCLUDED.hw_epoch),
        updated_at = now();
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_rag_content_chunks_del_watermark ON public.rag_content_chunks;
CREATE TRIGGER trg_rag_content_chunks_del_watermark
  AFTER DELETE ON public.rag_content_chunks
  REFERENCING OLD TABLE AS deleted_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.bump_curriculum_watermark_rag_delete();

CREATE OR REPLACE FUNCTION public.bump_curriculum_watermark_ct_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.curriculum_version_watermark (scope_key, hw_epoch, updated_at)
  SELECT s.code || '::' || d.grade,
         floor(extract(epoch FROM now()))::bigint,
         now()
  FROM deleted_rows d
  JOIN public.subjects s ON s.id = d.subject_id
  WHERE d.grade IS NOT NULL
  GROUP BY s.code, d.grade
  ON CONFLICT (scope_key) DO UPDATE
    SET hw_epoch   = GREATEST(public.curriculum_version_watermark.hw_epoch, EXCLUDED.hw_epoch),
        updated_at = now();
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_curriculum_topics_del_watermark ON public.curriculum_topics;
CREATE TRIGGER trg_curriculum_topics_del_watermark
  AFTER DELETE ON public.curriculum_topics
  REFERENCING OLD TABLE AS deleted_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.bump_curriculum_watermark_ct_delete();

-- ============================================================================
-- 5. The read RPC: get_curriculum_versions(p_grade, p_subject_codes)
-- ============================================================================
-- Returns { "as_of": <iso8601 UTC>, "scopes": { "<subject_code>-<grade>": <int>, ... } }.
--   * Value = monotonic unix-epoch seconds (fits a JS safe integer).
--   * "No content on server" for a requested scope = 0 (only ever 0 for a scope that
--     never had content — once content exists, deletes bump the watermark so it stays > 0).
--   * p_subject_codes = NULL -> all subjects that have content for the grade (empty
--     scopes omitted to keep the app-start poll tiny). p_subject_codes given -> every
--     requested code is echoed (0 when it has no content), so the client always gets a
--     definitive answer per requested scope.
--
-- SECURITY DEFINER justification (required): reads global, non-PII content-catalog
-- metadata (the same public reference data already exposed by get_available_subjects
-- and the /learn read paths) and the service_role-only watermark table, returning ONLY
-- integer version numbers + a timestamp. Definer rights are needed to read the
-- service_role-only watermark and to aggregate over all rows (incl. is_active=false)
-- for monotonicity, without exposing any row content. No user input is interpolated;
-- p_grade is validated to the P5 set. RBAC (which caller may poll) is enforced by the
-- HTTP route, not here.
CREATE OR REPLACE FUNCTION public.get_curriculum_versions(
  p_grade         text,
  p_subject_codes text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grade  text        := btrim(coalesce(p_grade, ''));
  v_now    timestamptz := now();
  v_as_of  text        := to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  v_scopes jsonb;
BEGIN
  -- P5: grade is a string "6".."12". A version poll must never 500 the mobile
  -- client, so an out-of-range grade returns an empty scope map, not an error.
  IF v_grade NOT IN ('6','7','8','9','10','11','12') THEN
    RETURN jsonb_build_object('as_of', v_as_of, 'scopes', '{}'::jsonb);
  END IF;

  WITH req AS (
    -- Requested subject codes: the explicit list, or every subject when NULL.
    SELECT c.code
    FROM unnest(p_subject_codes) AS c(code)
    WHERE p_subject_codes IS NOT NULL
    UNION
    SELECT s.code
    FROM public.subjects s
    WHERE p_subject_codes IS NULL
  ),
  ct AS (
    SELECT s.code AS code,
           floor(extract(epoch FROM max(t.updated_at)))::bigint AS epoch
    FROM public.curriculum_topics t
    JOIN public.subjects s ON s.id = t.subject_id
    WHERE t.grade = v_grade
      AND (p_subject_codes IS NULL OR s.code = ANY (p_subject_codes))
    GROUP BY s.code
  ),
  rag AS (
    SELECT r.subject_code AS code,
           floor(extract(epoch FROM max(r.updated_at)))::bigint AS epoch
    FROM public.rag_content_chunks r
    WHERE r.grade_short = v_grade
      AND r.subject_code IS NOT NULL
      AND (p_subject_codes IS NULL OR r.subject_code = ANY (p_subject_codes))
    GROUP BY r.subject_code
  ),
  merged AS (
    SELECT req.code,
           GREATEST(
             COALESCE(ct.epoch, 0),
             COALESCE(rag.epoch, 0),
             COALESCE(w.hw_epoch, 0)
           ) AS version
    FROM req
    LEFT JOIN ct  ON ct.code  = req.code
    LEFT JOIN rag ON rag.code = req.code
    LEFT JOIN public.curriculum_version_watermark w
           ON w.scope_key = req.code || '::' || v_grade
  )
  SELECT jsonb_object_agg(m.code || '-' || v_grade, m.version)
  INTO v_scopes
  FROM merged m
  -- Explicit request -> echo every code (0 = no content); all-subjects poll -> omit empties.
  WHERE p_subject_codes IS NOT NULL OR m.version > 0;

  RETURN jsonb_build_object('as_of', v_as_of, 'scopes', COALESCE(v_scopes, '{}'::jsonb));
END;
$$;

COMMENT ON FUNCTION public.get_curriculum_versions(text, text[]) IS
  'Monotonic per-scope curriculum-content version source for the mobile offline cache. '
  'Returns { as_of, scopes: { "<subject_code>-<grade>": <unix-epoch-seconds int> } } over '
  'curriculum_topics + rag_content_chunks, guarded against deletes by '
  'curriculum_version_watermark. See migration 20260717120000 for the full model. '
  'Consumed by GET /api/v2/curriculum-version.';

-- Client-facing read RPC (called on app-start behind auth). Not anon.
GRANT EXECUTE ON FUNCTION public.get_curriculum_versions(text, text[]) TO authenticated, service_role;
