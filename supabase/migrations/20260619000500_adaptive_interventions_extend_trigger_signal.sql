-- Migration: 20260619000500_adaptive_interventions_extend_trigger_signal.sql
-- Purpose: Phase A Loops B (inactivity) & C (at-risk concentration) — extend the
--          `adaptive_interventions` table (built by 20260619000200) so the SAME
--          state-machine substrate carries the two remaining Pulse signals. This
--          is the ONLY schema-semantics change Loops B/C require: no new table,
--          no new index, no new column, no RLS change. Two additive CHECK widenings.
--
-- Spec: docs/superpowers/specs/2026-06-13-phase-a-loops-b-c-design.md
--       (Section 5.2 "Migration — extend two CHECK constraints"; Decisions B-/C-/X-).
--
-- ─── What changes (additive only — P8 unaffected, no data loss) ──────────────
--   (a) trigger_signal CHECK: widen the IN-list from {'mastery_cliff'} to
--       {'mastery_cliff','inactivity','at_risk_concentration'}. Loop B rows use
--       'inactivity'; Loop C rows use 'at_risk_concentration'. Existing
--       'mastery_cliff' rows (Loop A) stay valid — strictly additive.
--   (b) chapter_number CHECK: relax `> 0` to `>= 0`. Loop B is NOT chapter-scoped
--       and uses a sentinel triple (subject_code='_inactivity', chapter_number=0)
--       to fit the existing one-active partial unique index without a schema
--       change. chapter_number=0 is reserved for Loop B only.
--
-- ─── Sentinel-vs-real-chapter collision safety (spec Section 5.2 / Risk) ─────
--   * Real curriculum chapters are ALWAYS >= 1. Loop A (mastery_cliff) and Loop C
--     (at_risk_concentration) always use a real chapter (>= 1).
--   * chapter_number = 0 is RESERVED for Loop B's sentinel row only.
--   * Loop B's pseudo-subject '_inactivity' is lowercase (passes the existing
--     adaptive_interventions_subject_lower CHECK: subject_code = lower(subject_code))
--     and can never collide with a real subject code (no real CBSE subject is
--     literally '_inactivity').
--   * Therefore the existing one-active partial unique index
--     (student_id, subject_code, chapter_number) WHERE status='active'
--     NATURALLY partitions Loop B's (student,'_inactivity',0) triple away from any
--     Loop A/C real-chapter triple — a student can be "inactive" (one row) AND have
--     a mastery_cliff or concentration row on a real chapter simultaneously without
--     index collision. The cooldown index
--     (student_id, subject_code, chapter_number, resolved_at) likewise partitions
--     Loop B terminal rows from A/C terminal rows.
--   * Widening `> 0` to `>= 0` (rather than reusing a real-but-arbitrary chapter for
--     Loop B) is the clean choice: an arbitrary real chapter WOULD let an inactivity
--     row collide with a real-chapter A/C row on the one-active index. The sentinel
--     avoids that entirely.
--
-- ─── Idempotency + EXACT name pin (spec Section 5.2 "Constraint name pin") ────
--   Postgres has no ALTER CHECK; the idempotent pattern is DROP-then-ADD. The two
--   CHECKs being widened were created INLINE (column-level, UNNAMED) in
--   20260619000200, so Postgres auto-named them `<table>_<column>_check`:
--     adaptive_interventions_trigger_signal_check   (trigger_signal IN ('mastery_cliff'))
--     adaptive_interventions_chapter_number_check   (chapter_number > 0)
--
--   EXACT NAMES VERIFIED AGAINST PROD (project shktyoxqhundlvkiwguu "Alfanumrik
--   Adaptive Learning OS", 2026-06-13) via the sanctioned read-only Management-API
--   path `supabase db query --linked`. At verification time the
--   adaptive_interventions TABLE DID NOT YET EXIST ON PROD: 20260619000200..400
--   (Loop A) are merged to main (PR #1018) but the latest migration APPLIED on
--   prod is 20260619000100 — Loop A + this Loops-B/C set all deploy together in
--   the next `db push`, so 20260619000200 CREATES the auto-named CHECKs immediately
--   BEFORE this file (000500) rewrites them, in the same push, on every target.
--   The names are therefore deterministic-by-DDL, not yet observable. To PROVE the
--   exact auto-naming on the prod Postgres instance, three EXISTING prod tables
--   with the identical inline-column-CHECK shape were queried live and returned
--   `<table>_<column>_check` with no numeric suffix:
--       cbse_syllabus  chapter_number > 0   -> cbse_syllabus_chapter_number_check
--       foxy_sessions  mode IN (...)         -> foxy_sessions_mode_check
--       audit_logs     status IN (...)       -> audit_logs_status_check
--   So 20260619000200 will name the two target CHECKs
--   adaptive_interventions_{trigger_signal,chapter_number}_check on every env.
--
--   The migration nonetheless does NOT trust ONLY a hard-coded name. To stay
--   ROBUST across envs where the auto-name could differ (a fresh DB from a
--   different DDL ordering, a CI live-DB project, a DR restore, or a future
--   Postgres that disambiguates a collision with a numeric suffix), it BOTH:
--     (1) looks up the ACTUAL constraint at APPLY time by SEMANTIC definition via
--         pg_get_constraintdef (the CHECK referencing the target column, excluding
--         our own new named replacement) and drops whatever it finds; AND
--     (2) defensively DROP ... IF EXISTS the verified literal auto-name AND the new
--         canonical name.
--   It then adds a NAMED replacement so future extensions have a stable handle.
--   The whole block is fully re-runnable (DROP ... IF EXISTS + a guarded ADD that
--   no-ops via the duplicate_object handler if the new named constraint is already
--   present). Combining the verified literal-name drop with the lookup-by-
--   definition drop is belt-and-suspenders: it cannot no-op-miss the old CHECK on
--   ANY env, which is the failure mode the spec warns against.
--
-- No DROP TABLE / DROP COLUMN. No data rewrite. Owner: architect.
-- Companion seed: 20260619000600_seed_ff_adaptive_loops_bc_v1.sql (flag, default OFF).

BEGIN;

-- ─── (a) Widen the trigger_signal CHECK ──────────────────────────────────────
-- Target: the column-level CHECK on trigger_signal (originally IN ('mastery_cliff')).
DO $extend_trigger_signal$
DECLARE
  v_conname text;
BEGIN
  -- Look up the ACTUAL constraint by semantic definition: a CHECK (contype='c')
  -- on adaptive_interventions whose definition references trigger_signal. This is
  -- name-agnostic — it finds whatever Postgres auto-named it on THIS environment.
  -- Guard: only the trigger_signal IN-list constraint (exclude the named
  -- subject_lower / status / escalated_to CHECKs, which never mention trigger_signal).
  FOR v_conname IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.adaptive_interventions'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%trigger_signal%'
      -- Never drop our own widened replacement if a previous run already added it
      -- with the canonical new name AND the full new IN-list (idempotent re-run).
      AND con.conname <> 'adaptive_interventions_trigger_signal_chk'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.adaptive_interventions DROP CONSTRAINT %I',
      v_conname
    );
  END LOOP;

  -- Defensive belt-and-suspenders: drop the well-known literal auto-name and the
  -- new canonical name (so a partial/aborted prior run leaves no stale narrow
  -- CHECK behind). DROP ... IF EXISTS is a no-op when absent.
  ALTER TABLE public.adaptive_interventions
    DROP CONSTRAINT IF EXISTS adaptive_interventions_trigger_signal_check;
  ALTER TABLE public.adaptive_interventions
    DROP CONSTRAINT IF EXISTS adaptive_interventions_trigger_signal_chk;

  -- Add the widened, NAMED replacement. Wrapped so a concurrent/duplicate add is
  -- a benign no-op (duplicate_object), keeping the whole migration re-runnable.
  BEGIN
    ALTER TABLE public.adaptive_interventions
      ADD CONSTRAINT adaptive_interventions_trigger_signal_chk
      CHECK (trigger_signal IN ('mastery_cliff', 'inactivity', 'at_risk_concentration'));
  EXCEPTION
    WHEN duplicate_object THEN
      NULL; -- already present (re-run); nothing to do
  END;
END $extend_trigger_signal$;

-- ─── (b) Relax the chapter_number CHECK (> 0  →  >= 0) ────────────────────────
-- Required ONLY for Loop B's chapter_number=0 sentinel. Loop A/C real chapters
-- are >= 1, so this never weakens A/C invariants (a real-chapter row could never
-- have been 0 before, and nothing writes 0 except Loop B's sentinel).
DO $relax_chapter_number$
DECLARE
  v_conname text;
BEGIN
  -- Find the CHECK on chapter_number by semantic definition (name-agnostic).
  FOR v_conname IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.adaptive_interventions'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%chapter_number%'
      AND con.conname <> 'adaptive_interventions_chapter_number_chk'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.adaptive_interventions DROP CONSTRAINT %I',
      v_conname
    );
  END LOOP;

  ALTER TABLE public.adaptive_interventions
    DROP CONSTRAINT IF EXISTS adaptive_interventions_chapter_number_check;
  ALTER TABLE public.adaptive_interventions
    DROP CONSTRAINT IF EXISTS adaptive_interventions_chapter_number_chk;

  BEGIN
    ALTER TABLE public.adaptive_interventions
      ADD CONSTRAINT adaptive_interventions_chapter_number_chk
      CHECK (chapter_number >= 0);
  EXCEPTION
    WHEN duplicate_object THEN
      NULL; -- already present (re-run); nothing to do
  END;
END $relax_chapter_number$;

-- ─── Documentation comment refresh (additive metadata) ───────────────────────
COMMENT ON COLUMN public.adaptive_interventions.trigger_signal IS
  'Which Pulse signal opened this intervention cycle: '
  '''mastery_cliff'' (Loop A), ''inactivity'' (Loop B), '
  '''at_risk_concentration'' (Loop C). CHECK widened additively by '
  '20260619000500 (was mastery_cliff-only in 20260619000200).';

COMMENT ON COLUMN public.adaptive_interventions.chapter_number IS
  'Curriculum chapter (integer, NOT a grade — P5 is N/A here). Real chapters are '
  '>= 1. The reserved sentinel value 0 is used ONLY by Loop B inactivity rows '
  '(paired with subject_code=''_inactivity'') so the queue-less inactivity '
  'intervention fits the existing (student, subject_code, chapter_number) one-'
  'active partial unique index without a schema change. CHECK relaxed from > 0 '
  'to >= 0 by 20260619000500.';

COMMIT;

-- ─── Verify (manual check after applying) ────────────────────────────────────
-- SELECT conname, pg_get_constraintdef(oid) AS def
--   FROM pg_constraint
--  WHERE conrelid = 'public.adaptive_interventions'::regclass AND contype = 'c'
--  ORDER BY conname;
--   Expected (post-migration), among others:
--     adaptive_interventions_trigger_signal_chk
--       CHECK (trigger_signal IN ('mastery_cliff','inactivity','at_risk_concentration'))
--     adaptive_interventions_chapter_number_chk
--       CHECK (chapter_number >= 0)
--   (the original auto-named *_check variants are gone; subject_lower / status /
--    escalated_to CHECKs are untouched).
