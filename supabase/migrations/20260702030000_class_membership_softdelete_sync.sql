-- Migration: 20260702030000_class_membership_softdelete_sync.sql
-- Purpose: TSB-4 AUTO-FIX-SAFE slice (P8). Close the GOING-FORWARD soft-delete
--          divergence between the two class-membership join tables so a
--          de-enrolled student stops being visible to the teacher boundary.
--
-- ─── ADR / CANONICALITY DECLARATION (read this first) ────────────────────────
--   There are two dual class-membership join tables, each with the same natural
--   key (class_id, student_id) + an is_active soft-delete flag:
--     * class_enrollments — written by the school-admin enroll/de-enroll path
--       (src/app/api/school-admin/classes/enrollments/route.ts) and by the
--       self-service enroll/join paths. This is the CANONICAL-BY-INTENT table:
--       the school-admin de-enroll (route.ts:116-120) flips is_active=false HERE.
--     * class_students    — read by the live security boundary. canAccessStudent
--       (src/lib/rbac.ts:331) and the is_teacher_of(uuid) SECURITY DEFINER helper
--       (baseline:9212) resolve a teacher's reachable students through
--       class_students WHERE is_active = true. So class_students is, today, the
--       CANONICAL-BY-ENFORCEMENT table.
--
--   THE LIVE P8 BUG this migration closes:
--     The existing INSERT mirror (migration 20260620000700) keeps the two rosters'
--     row SETS in sync on INSERT (ON CONFLICT DO NOTHING, both directions). But it
--     is INSERT-ONLY. The school-admin de-enroll sets is_active=false on
--     class_enrollments ONLY; nothing propagates that flip to class_students. The
--     de-enrolled student therefore stays is_active=true on class_students and
--     REMAINS VISIBLE to the assigned teacher via canAccessStudent / is_teacher_of.
--     That is the divergence. This migration mirrors the is_active flip in BOTH
--     directions on UPDATE, so a de-enroll (or re-enroll) on either table is
--     reflected on the counterpart row, going forward.
--
--   SCOPE OF THIS SLICE (deliberately narrow — the rest is CEO-gated cleanup):
--     This migration is triggers + comments ONLY. It does NOT:
--       - repoint canAccessStudent / is_teacher_of to read class_enrollments;
--       - add a new teacher RLS policy on class_enrollments;
--       - backfill / reconcile EXISTING divergent rows on prod;
--       - DROP either table.
--     The full consolidation — boundary repoint to the canonical table, a new
--     teacher RLS policy on class_enrollments, a VERIFIED one-time backfill of the
--     already-divergent historical rows, and the eventual DROP of the redundant
--     table — is a SEPARATE, CEO-gated cleanup (TSB-4 cutover). NO DROP HERE.
--
-- ─── RECURSION SAFETY (provably terminating — verify this logic) ─────────────
--   Each AFTER UPDATE OF is_active trigger mirrors NEW.is_active onto the
--   counterpart row. Two independent guards make the round-trip terminate after
--   exactly one bounce:
--     (1) TRIGGER-LEVEL WHEN (OLD.is_active IS DISTINCT FROM NEW.is_active) — the
--         trigger body only runs when is_active actually changed on the source row.
--     (2) ROW-LEVEL WHERE (... AND is_active IS DISTINCT FROM NEW.is_active) — the
--         mirrored UPDATE touches ONLY a counterpart row whose value differs.
--   Walk it: an admin de-enroll flips class_enrollments true→false. Trigger B
--   fires (WHEN true), and function B UPDATEs the matching class_students row
--   (currently true) to false → 1 row changed. That UPDATE fires trigger A on
--   class_students (WHEN true: true→false), and function A attempts to UPDATE
--   class_enrollments back to false — but that row is ALREADY false (it was the
--   originating change), so the row-level "is_active IS DISTINCT FROM NEW.is_active"
--   predicate matches ZERO rows. A zero-row UPDATE fires no AFTER...FOR EACH ROW
--   trigger, so trigger B is NOT re-entered. The cycle stops after one round trip.
--   (Even if a row were hypothetically matched, the WHEN clause would see OLD=NEW
--   and short-circuit.) Symmetric in the other direction. No infinite recursion.
--
-- ─── DELETE-MIRROR DECISION (omitted, on purpose) ────────────────────────────
--   No AFTER DELETE mirror is added. Reasoning:
--     - The only de-enroll path in the product is a SOFT delete (is_active=false
--       on class_enrollments), already covered by the UPDATE mirror above. There
--       is no app path that hard-DELETEs a membership row to de-enroll.
--     - Hard DELETE of membership rows happens only in the data-erasure purger
--       (src/lib/data-erasure-purger.ts + supabase/functions/data-erasure-purger/
--       index.ts). Its CASCADE_ORDER deletes the student's class_students rows by
--       student_id and reports a per-table rows_deleted accounting. A hidden,
--       trigger-driven DELETE of class_enrollments would (a) delete rows the
--       erasure RPC does not count, silently breaking that audit/accounting
--       contract, and (b) be a behavior change beyond the soft-delete divergence
--       this slice is scoped to.
--     - Crucially, a hard DELETE on class_students is FAIL-SAFE for the boundary:
--       it can only REMOVE a student from a teacher's view, never over-grant. So
--       omitting the DELETE mirror introduces no security divergence. Any leftover
--       class_enrollments row after erasure is not read by canAccessStudent /
--       is_teacher_of, carries no PII (class_id + student_id only), and its cleanup
--       belongs to the separate erasure-completeness / TSB-4 cutover work, not to
--       this P8 going-forward sync.
--
-- ─── Scope / safety contract (HARD CONSTRAINTS) ──────────────────────────────
--   - ADDITIVE ONLY. No DROP TABLE/COLUMN, no RLS disable/enable, no policy, FK,
--     column, role, or permission change, no data backfill/reconciliation. The
--     only DROPs are DROP TRIGGER / DROP FUNCTION IF EXISTS immediately followed
--     by a CREATE in the same transaction (idempotent re-create).
--   - The existing INSERT mirror (20260620000700) is left intact and unmodified;
--     these UPDATE mirrors are ADDED ALONGSIDE it.
--   - IDEMPOTENT / replayable: CREATE OR REPLACE FUNCTION; DROP TRIGGER IF EXISTS
--     before CREATE TRIGGER. Safe on PROD, main-staging, CI live-DB, fresh DBs.
--   - SECURITY DEFINER justification (required by architect rules): the mirror
--     must UPDATE the sibling roster table on behalf of whichever role flipped
--     is_active on the source row (school admin / service role on class_enrollments;
--     self-service paths on class_students). Those roles do not necessarily hold an
--     UPDATE policy on the OTHER table, but the source change was already authorized
--     by the source table's own RLS. DEFINER lets the faithful mirror proceed
--     without widening any user-facing UPDATE policy. The functions copy ONLY the
--     is_active boolean from NEW, matched on the (class_id, student_id) natural key
--     (no privilege-escalation surface), and pin search_path.
--
-- Owner: architect. TSB-4 AUTO-FIX-SAFE slice (P8) — going-forward soft-delete sync.

BEGIN;

-- =============================================================================
-- 1. is_active MIRROR TRIGGER FUNCTIONS (SECURITY DEFINER — see header)
-- =============================================================================
-- 1a. class_students.is_active change -> mirror onto class_enrollments.
CREATE OR REPLACE FUNCTION "public"."sync_class_students_active_to_enrollments"()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = 'public','pg_temp'
AS $$
BEGIN
  -- Row-level guard: only touch a counterpart row whose value actually differs.
  -- Combined with the trigger-level WHEN clause this guarantees the reverse-fired
  -- trigger finds zero differing rows -> no UPDATE -> the round trip terminates.
  UPDATE public.class_enrollments
     SET is_active = NEW.is_active
   WHERE class_id   = NEW.class_id
     AND student_id = NEW.student_id
     AND is_active IS DISTINCT FROM NEW.is_active;
  RETURN NEW;
END;
$$;

-- 1b. class_enrollments.is_active change -> mirror onto class_students.
CREATE OR REPLACE FUNCTION "public"."sync_class_enrollments_active_to_students"()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = 'public','pg_temp'
AS $$
BEGIN
  -- Row-level guard (see 1a): mirror only when the counterpart row differs.
  UPDATE public.class_students
     SET is_active = NEW.is_active
   WHERE class_id   = NEW.class_id
     AND student_id = NEW.student_id
     AND is_active IS DISTINCT FROM NEW.is_active;
  RETURN NEW;
END;
$$;

-- =============================================================================
-- 2. AFTER UPDATE OF is_active TRIGGERS (each direction; idempotent re-create)
--    The WHEN clause is the trigger-level recursion guard: the body runs only
--    when is_active actually changed on the source row.
-- =============================================================================
DROP TRIGGER IF EXISTS "trg_sync_class_students_active_to_enrollments" ON "public"."class_students";
CREATE TRIGGER "trg_sync_class_students_active_to_enrollments"
  AFTER UPDATE OF "is_active" ON "public"."class_students"
  FOR EACH ROW
  WHEN (OLD.is_active IS DISTINCT FROM NEW.is_active)
  EXECUTE FUNCTION "public"."sync_class_students_active_to_enrollments"();

DROP TRIGGER IF EXISTS "trg_sync_class_enrollments_active_to_students" ON "public"."class_enrollments";
CREATE TRIGGER "trg_sync_class_enrollments_active_to_students"
  AFTER UPDATE OF "is_active" ON "public"."class_enrollments"
  FOR EACH ROW
  WHEN (OLD.is_active IS DISTINCT FROM NEW.is_active)
  EXECUTE FUNCTION "public"."sync_class_enrollments_active_to_students"();

COMMIT;

-- ─── Verify (manual checks after applying) ───────────────────────────────────
-- 1. De-enroll via class_enrollments mirrors to class_students:
--    UPDATE class_enrollments SET is_active = false
--      WHERE class_id = :c AND student_id = :s;
--    SELECT is_active FROM class_students
--      WHERE class_id = :c AND student_id = :s;   -- expect false (was true)
-- 2. Re-enroll (false -> true) mirrors symmetrically; flipping either table
--    settles the counterpart after exactly one round trip (no trigger storm,
--    statement returns immediately).
-- 3. A no-op UPDATE (is_active unchanged) fires nothing (WHEN false).
