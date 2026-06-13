-- Migration: 20260619000400_teacher_remediation_dedupe_index.sql
-- Purpose: Phase A Loop A (adaptive remediation) Round 2 hardening — DB-level
--          dedupe backstop on public.teacher_remediation_assignments so that
--          Loop A escalation retries (and teacher-route check-then-insert
--          races) can never accumulate duplicate OPEN ('assigned') assignment
--          rows for the same student × class × chapter.
--
-- Spec:    docs/superpowers/specs/2026-06-12-phase-a-loop-a-adaptive-remediation-design.md (§7 escalation mapping)
-- Runbook: docs/runbooks/adaptive-remediation-rollout.md
-- Table:   created by 20260613000004_teacher_remediation_assignments.sql
--          (always applied earlier in the chain — no existence guard needed).
--
-- ─── Why a COALESCE expression index, not naive UNIQUE (student_id, class_id, chapter_id) ─
-- chapter_id is NULLABLE by design (20260613000004: "general" remediation for
-- alert-driven assignments / unmapped chapters), and Postgres UNIQUE treats
-- NULLs as DISTINCT — the naive index would happily accept unlimited duplicate
-- open general-remediation rows for the same (student, class). COALESCE-ing
-- chapter_id to the RFC 4122 *nil* UUID buckets every NULL chapter into one
-- key. The nil UUID can never collide with a real curriculum_topics.id: those
-- are gen_random_uuid() (UUIDv4 — version/variant bits are never all zero).
--
-- A single expression index was chosen over the two-partial-index alternative
-- (one WHERE chapter_id IS NOT NULL, one WHERE chapter_id IS NULL) because it
-- gives the Loop A cron worker exactly ONE inferable ON CONFLICT arbiter for
-- its idempotent escalation insert:
--
--   INSERT ... ON CONFLICT (student_id, class_id,
--     COALESCE(chapter_id, '00000000-0000-0000-0000-000000000000'::uuid))
--     WHERE status = 'assigned'
--   DO NOTHING
--
-- Two partial indexes would force nullness-dependent conflict targets in the
-- worker (a different ON CONFLICT clause per branch) — needless complexity.
--
-- ─── Scope notes (deliberate) ────────────────────────────────────────────────
-- * WHERE status = 'assigned' only. 'in_progress' is teacher-acknowledged
--   (human-owned) and excluded on purpose; escalation retries always insert
--   status = 'assigned', so the retry-duplicate case this index exists for is
--   fully covered. The teacher route's app-level pre-check additionally treats
--   'in_progress' as open (broader, first line of defense).
-- * teacher_id is NOT in the key. A second teacher of the same class
--   re-flagging the same student × chapter is the same duplicate signal to the
--   student. NOTE for backend (flagged in review): the teacher route's
--   idempotency pre-check (src/app/api/teacher/remediation/route.ts) is keyed
--   per-teacher and will not see a colleague's open row, so its INSERT can now
--   surface unique_violation (23505) on that cross-teacher path — handle 23505
--   as the idempotent-success path (or widen the pre-check). The common
--   single-teacher path is unaffected.
--
-- ─── Pre-existing duplicate tolerance (required before any UNIQUE index) ─────
-- Two possible writers of 'assigned' rows:
--   1. Loop A escalation (cron worker): UNRELEASED — ff_adaptive_remediation_v1
--      was seeded OFF (is_enabled=false, rollout_percentage=0) in
--      20260619000300 and has never been ON in prod, so zero escalation-origin
--      rows (let alone duplicates) can exist.
--   2. Teacher route (Phase 3A, /api/teacher/remediation): LIVE and not
--      flag-gated. Its idempotency guard is a non-atomic check-then-insert
--      keyed per-teacher — duplicates from request races or two teachers of
--      the same class CANNOT be ruled out.
-- Therefore this migration resolves duplicates BEFORE creating the index:
-- keep the OLDEST row of each duplicate group (first signal wins — matches the
-- route's "return the existing open row" idempotent semantics) and transition
-- the rest to status='dismissed' + resolved_at=now(). 'dismissed' is the
-- established ops-resolution terminal state (hard-stop precedent in
-- docs/runbooks/adaptive-remediation-rollout.md); rows are KEPT for the audit
-- trail, never deleted. The UPDATE is a no-op when no duplicates exist.
--
-- ─── Locking ─────────────────────────────────────────────────────────────────
-- SHARE ROW EXCLUSIVE is taken up front so the duplicate cleanup and the
-- unique-index build are atomic against concurrent writes (no new duplicate
-- can land between the UPDATE and the CREATE UNIQUE INDEX, which would fail
-- the build). Concurrent reads are unaffected. The table is weeks old and
-- small (Phase 3A); the write-block window is negligible.
--
-- Idempotent: CREATE UNIQUE INDEX IF NOT EXISTS; the cleanup is a no-op on
-- re-run (rn > 1 over status='assigned' finds nothing once deduped).
-- Additive-only: no DROP, no column changes, no RLS/policy changes, no new
-- table (RLS posture of 20260613000004 untouched — P8 unaffected).

BEGIN;

LOCK TABLE public.teacher_remediation_assignments IN SHARE ROW EXCLUSIVE MODE;

-- ─── 1. Resolve pre-existing duplicate open assignments ──────────────────────
-- Keep the oldest row per (student_id, class_id, chapter_id-bucket) group;
-- dismiss the rest. Logged via RAISE NOTICE so the apply output records how
-- many rows (if any) were touched.
DO $dedupe$
DECLARE
  v_dismissed integer := 0;
BEGIN
  WITH ranked AS (
    SELECT id,
           row_number() OVER (
             PARTITION BY student_id, class_id,
                          COALESCE(chapter_id, '00000000-0000-0000-0000-000000000000'::uuid)
             ORDER BY created_at ASC, id ASC
           ) AS rn
      FROM public.teacher_remediation_assignments
     WHERE status = 'assigned'
  ),
  dismissed AS (
    UPDATE public.teacher_remediation_assignments t
       SET status      = 'dismissed',
           resolved_at = now()
      FROM ranked r
     WHERE t.id = r.id
       AND r.rn > 1
    RETURNING t.id
  )
  SELECT count(*) INTO v_dismissed FROM dismissed;

  IF v_dismissed > 0 THEN
    RAISE NOTICE 'teacher_remediation_dedupe_index: dismissed % duplicate open assignment row(s); kept the oldest row of each (student, class, chapter) group', v_dismissed;
  ELSE
    RAISE NOTICE 'teacher_remediation_dedupe_index: no duplicate open assignments found; nothing to clean up';
  END IF;
END $dedupe$;

-- ─── 2. Dedupe backstop index ────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_teacher_remediation_assignments_open_dedupe
  ON public.teacher_remediation_assignments (
    student_id,
    class_id,
    (COALESCE(chapter_id, '00000000-0000-0000-0000-000000000000'::uuid))
  )
  WHERE status = 'assigned';

COMMENT ON INDEX public.uq_teacher_remediation_assignments_open_dedupe IS
  'At most one OPEN (status=assigned) remediation assignment per student x '
  'class x chapter. NULL chapter_id (general remediation) is bucketed via '
  'COALESCE to the RFC 4122 nil UUID (cannot collide with gen_random_uuid() '
  'v4 ids). Backstops Loop A escalation retries and teacher-route races. '
  'ON CONFLICT arbiter: (student_id, class_id, COALESCE(chapter_id, '
  '''00000000-0000-0000-0000-000000000000''::uuid)) WHERE status = ''assigned''.';

COMMIT;

-- ─── Verify (manual check after applying) ────────────────────────────────────
-- 1. Index exists with the expected definition:
--    SELECT indexdef FROM pg_indexes
--     WHERE indexname = 'uq_teacher_remediation_assignments_open_dedupe';
-- 2. No surviving duplicate open groups (expect 0 rows):
--    SELECT student_id, class_id,
--           COALESCE(chapter_id, '00000000-0000-0000-0000-000000000000'::uuid) AS chapter_bucket,
--           count(*)
--      FROM public.teacher_remediation_assignments
--     WHERE status = 'assigned'
--     GROUP BY 1, 2, 3
--    HAVING count(*) > 1;
-- 3. Cleanup audit (rows dismissed by this migration, if any):
--    SELECT id, student_id, class_id, chapter_id, resolved_at
--      FROM public.teacher_remediation_assignments
--     WHERE status = 'dismissed' AND resolved_at IS NOT NULL
--     ORDER BY resolved_at DESC LIMIT 20;
