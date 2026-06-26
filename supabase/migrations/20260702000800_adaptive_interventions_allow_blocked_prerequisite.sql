-- Migration: 20260702000800_adaptive_interventions_allow_blocked_prerequisite.sql
-- Purpose: Slice 1 (Digital Twin) — Phase A Loop D (blocked prerequisite). Widen the
--          `adaptive_interventions.trigger_signal` CHECK so the SAME state-machine
--          substrate (built by 20260619000200, extended by 20260619000500) also
--          carries the new Loop D signal 'blocked_prerequisite'. This is the ONLY
--          schema-semantics change Loop D requires: no new table, no new index, no
--          new column, no RLS change. One additive CHECK widening.
--
-- Source: Loop D signal value introduced by the assessment agent in
--         src/lib/learn/adaptive-loops-rules.ts ('blocked_prerequisite', Loop D).
--
-- ─── What changes (additive only — P8 unaffected, no data loss) ──────────────
--   trigger_signal CHECK: widen the IN-list from
--       {'mastery_cliff','inactivity','at_risk_concentration'}   (after 20260619000500)
--     to
--       {'mastery_cliff','inactivity','at_risk_concentration','blocked_prerequisite'}.
--   Loop D rows use 'blocked_prerequisite'. All existing Loop A/B/C rows stay valid
--   — strictly additive, no value removed.
--
-- ─── chapter_number CHECK: intentionally LEFT AS-IS (no change) ───────────────
--   Loop D is chapter-scoped: it uses the DEPENDENT chapter number, which is a real
--   curriculum chapter (>= 1) — see src/lib/learn/adaptive-loops-rules.ts where the
--   Loop D dedupe keys on `dependentChapterNumber`. The existing
--   `adaptive_interventions_chapter_number_chk` CHECK (chapter_number >= 0), relaxed
--   by 20260619000500 for Loop B's sentinel 0, already admits Loop D's >= 1 values.
--   No chapter_number constraint change is needed or made by this migration.
--
-- ─── Idempotency + EXACT name pin (same pattern as 20260619000500) ────────────
--   Postgres has no ALTER CHECK; the idempotent pattern is DROP-then-ADD. The
--   trigger_signal CHECK currently carries the NAMED handle installed by
--   20260619000500: adaptive_interventions_trigger_signal_chk. To stay robust across
--   envs (fresh DB, CI live-DB, DR restore) this block BOTH:
--     (1) looks up the ACTUAL CHECK at APPLY time by SEMANTIC definition via
--         pg_get_constraintdef (any CHECK referencing trigger_signal that is NOT our
--         own new widened replacement) and drops whatever it finds; AND
--     (2) defensively DROP ... IF EXISTS the known prior auto-name AND the canonical
--         named handle.
--   It then re-adds the widened NAMED replacement under the same stable handle. The
--   whole block is fully re-runnable (DROP ... IF EXISTS + a guarded ADD that no-ops
--   via the duplicate_object handler when the widened constraint is already present).
--
-- No DROP TABLE / DROP COLUMN. No data rewrite. Owner: architect.

BEGIN;

-- ─── Widen the trigger_signal CHECK to also allow 'blocked_prerequisite' ──────
DO $allow_blocked_prerequisite$
DECLARE
  v_conname text;
BEGIN
  -- Look up the ACTUAL constraint by semantic definition: a CHECK (contype='c')
  -- on adaptive_interventions whose definition references trigger_signal. This is
  -- name-agnostic — it finds whatever the constraint is named on THIS environment.
  -- Exclude our own widened replacement so an idempotent re-run does not drop+miss.
  FOR v_conname IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.adaptive_interventions'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%trigger_signal%'
      AND con.conname <> 'adaptive_interventions_trigger_signal_chk'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.adaptive_interventions DROP CONSTRAINT %I',
      v_conname
    );
  END LOOP;

  -- Defensive belt-and-suspenders: drop the original auto-name and the canonical
  -- named handle so a partial/aborted prior run leaves no stale narrower CHECK.
  -- DROP ... IF EXISTS is a no-op when absent.
  ALTER TABLE public.adaptive_interventions
    DROP CONSTRAINT IF EXISTS adaptive_interventions_trigger_signal_check;
  ALTER TABLE public.adaptive_interventions
    DROP CONSTRAINT IF EXISTS adaptive_interventions_trigger_signal_chk;

  -- Add the widened, NAMED replacement (preserves ALL Loop A/B/C values; adds D).
  -- Wrapped so a concurrent/duplicate add is a benign no-op, keeping the migration
  -- fully re-runnable.
  BEGIN
    ALTER TABLE public.adaptive_interventions
      ADD CONSTRAINT adaptive_interventions_trigger_signal_chk
      CHECK (trigger_signal IN (
        'mastery_cliff',
        'inactivity',
        'at_risk_concentration',
        'blocked_prerequisite'
      ));
  EXCEPTION
    WHEN duplicate_object THEN
      NULL; -- already present (re-run); nothing to do
  END;
END $allow_blocked_prerequisite$;

-- ─── Documentation comment refresh (additive metadata) ───────────────────────
COMMENT ON COLUMN public.adaptive_interventions.trigger_signal IS
  'Which Pulse/Twin signal opened this intervention cycle: '
  '''mastery_cliff'' (Loop A), ''inactivity'' (Loop B), '
  '''at_risk_concentration'' (Loop C), ''blocked_prerequisite'' (Loop D — '
  'Digital Twin Slice 1). CHECK widened additively by 20260702000800 (was the '
  'A/B/C set in 20260619000500).';

COMMIT;

-- ─── Verify (manual check after applying) ────────────────────────────────────
-- SELECT conname, pg_get_constraintdef(oid) AS def
--   FROM pg_constraint
--  WHERE conrelid = 'public.adaptive_interventions'::regclass AND contype = 'c'
--  ORDER BY conname;
--   Expected (post-migration), among others:
--     adaptive_interventions_trigger_signal_chk
--       CHECK (trigger_signal IN ('mastery_cliff','inactivity',
--                                 'at_risk_concentration','blocked_prerequisite'))
--     adaptive_interventions_chapter_number_chk
--       CHECK (chapter_number >= 0)   -- UNCHANGED by this migration
