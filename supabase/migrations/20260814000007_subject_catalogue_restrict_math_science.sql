-- Migration: 20260814000007_subject_catalogue_restrict_math_science.sql
-- Phase 3 / M1 — Server-authoritative allowed-subject policy: catalogue layer.
--
-- Purpose
--   Restrict the *readable* subject catalogue to the CEO-locked KEEP-SET:
--     math, science, physics, chemistry, biology
--   Everything else in public.subjects is flipped is_active = FALSE.
--
-- WHY "NOT IN (keep-set)" AND NEVER "IN (removal-list)"
--   public.subjects contains MORE codes than supabase/seed.sql declares.
--   20260528000010_extend_g11_12_stream_subjects_cbse.sql maps
--   informatics_practices, health_fitness, psychology, fine_arts, sociology
--   and home_science, and its header states those rows are already present
--   and active in public.subjects (inserted on prod out of band, absent from
--   seed.sql). An enumerated removal list would silently leave 6+ subjects
--   live. The keep-set is declared exactly ONCE in this file, in the `keep`
--   CTE below, and the whole restriction is a single statement so the set
--   cannot drift within the file.
--
-- WHAT is_active DOES AND DOES NOT DO
--   is_active gates READS only (get_available_subjects / _v2 both end with
--   `WHERE sub.is_active`). It does NOT gate writes: enforce_subject_enrollment()
--   checks grade_subject_map + plan_subject_access and never joins is_active,
--   so a direct INSERT of a deactivated subject still succeeds today. That
--   hole is closed by M5 (20260814000010). get_subject_violations() likewise
--   ignores is_active, so until M6 (20260814000011) lands it reports zero
--   violations while violations are real — do NOT use it as the verification
--   signal before M6 is applied.
--
-- ROLLBACK SOURCE OF TRUTH
--   The single admin_audit_log row written by this migration, action
--   'subject.catalogue.restricted_to_math_science', carries
--   details->>'deactivated' (text[]) — the exact list this run flipped off,
--   and details->>'reactivated' — keep-set codes this run healed back on.
--   To roll back: UPDATE public.subjects SET is_active = TRUE WHERE code =
--   ANY(<deactivated array from that row>), and set the 'reactivated' codes
--   back to FALSE. No other artifact records the pre-change state.
--
-- ⚠️ PRICING CONSEQUENCE — M3 (plan_subject_access) IS DELIBERATELY NOT WRITTEN
--   plan_subject_access today grants, among the keep-set:
--     free      → math, science          (physics/chemistry/biology NOT granted)
--     starter   → math, science          (physics/chemistry/biology NOT granted)
--     pro       → math, science, physics, chemistry, biology
--     unlimited → math, science, physics, chemistry, biology
--   and subscription_plans.max_subjects is free=2, starter=4, pro/unlimited=NULL.
--   After M2 removes `science` from grades 11-12 (there is no `science` row at
--   11-12 — the UI presents physics+chemistry+biology as ONE "Science" choice),
--   a grade 11-12 student on free or starter is left with EXACTLY ONE unlocked
--   subject: math. Fixing that means granting physics/chemistry/biology to
--   free/starter, which is a PRICING CHANGE and requires explicit CEO approval.
--   M3 is therefore ON HOLD and intentionally absent from this migration set.
--   Do not let this be forgotten: grades 6-10 are unaffected (math + science
--   are both granted on every plan); the gap is grades 11-12 only.
--
-- Idempotency
--   Single statement. Both UPDATE branches are guarded by
--   `is_active IS DISTINCT FROM <target>` so a second run matches zero rows
--   (IS DISTINCT FROM also handles the NULL case — subjects.is_active is a
--   nullable boolean with DEFAULT true). The audit INSERT is gated on
--   EXISTS over those two RETURNING sets, so a no-op re-run writes no second
--   audit row and the rollback row stays unique and authoritative.
--   The two UPDATEs touch provably disjoint row sets (code NOT IN keep vs
--   code IN keep), so no row is modified twice inside one statement.
--
-- Non-destructive: no DROP, no row deletion. question_bank_subject_fk and
-- plan_subject_access_subject_code_fkey reference subjects(code), not active
-- subjects, so flipping is_active violates nothing and no content row
-- (question_bank / cbse_syllabus / rag_content_chunks) is touched.

BEGIN;

WITH keep(code) AS (
  VALUES ('math'), ('science'), ('physics'), ('chemistry'), ('biology')
),
deactivated AS (
  UPDATE public.subjects s
     SET is_active = FALSE
   WHERE s.code NOT IN (SELECT k.code FROM keep k)
     AND s.is_active IS DISTINCT FROM FALSE
  RETURNING s.code
),
reactivated AS (
  -- Self-heal: any keep-set code that is currently inactive (or NULL) is
  -- switched back on. Guards against a prior partial restriction or an
  -- out-of-band ops flip leaving e.g. biology dark.
  UPDATE public.subjects s
     SET is_active = TRUE
   WHERE s.code IN (SELECT k.code FROM keep k)
     AND s.is_active IS DISTINCT FROM TRUE
  RETURNING s.code
)
INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
SELECT
  NULL,
  'subject.catalogue.restricted_to_math_science',
  'system',
  NULL,
  jsonb_build_object(
    'deactivated', COALESCE((SELECT array_agg(d.code ORDER BY d.code) FROM deactivated d), ARRAY[]::TEXT[]),
    'reactivated', COALESCE((SELECT array_agg(r.code ORDER BY r.code) FROM reactivated r), ARRAY[]::TEXT[]),
    'kept',        (SELECT array_agg(k.code ORDER BY k.code) FROM keep k),
    'migration',   '20260814000007_subject_catalogue_restrict_math_science',
    'applied_at',  now()
  ),
  now()
WHERE EXISTS (SELECT 1 FROM deactivated)
   OR EXISTS (SELECT 1 FROM reactivated);

COMMIT;
