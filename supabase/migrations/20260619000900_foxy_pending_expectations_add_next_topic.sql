-- Migration: 20260619000900_foxy_pending_expectations_add_next_topic.sql
-- Purpose: ADDITIVELY widen the expectation_kind CHECK constraint on
--          public.foxy_pending_expectations to also allow 'next_topic', so the
--          Part-2 topic-progression work (durable next-topic expectation,
--          plan Part 2C) can persist a 'next_topic' row. No data change, no RLS
--          change, no new table/column/index.
--
-- ─── Background ───────────────────────────────────────────────────────────────
-- foxy_pending_expectations was created in 20260528000013 with an INLINE
-- (Postgres-auto-named) CHECK on expectation_kind:
--   CHECK (expectation_kind IN
--          ('mcq','open','recall','solve','explain','choose_topic'))
-- Postgres names an unnamed inline column CHECK
-- `<table>_<column>_check`, i.e.
--   foxy_pending_expectations_expectation_kind_check
-- Part 2C adds a sixth-plus kind, 'next_topic' — Foxy proactively teaches the
-- next topic in the chapter sequence and the open expectation tracks that the
-- student is mid-progression. The "Got it" learning-action MUST NOT close a
-- 'next_topic' / 'choose_topic' expectation (route guard, plan Part 2C); the
-- DB CHECK only needs to ADMIT the new value.
--
-- ─── Why a CHECK widening is the ONLY schema change needed for progression ────
-- expectation_kind is a free TEXT column gated solely by this CHECK. The new
-- value rides on the EXISTING columns (expectation_text, expectation_meta jsonb,
-- topic_id -> curriculum_topics, status lifecycle 'open'/'answered'/...). No new
-- column, table, index, or RLS policy is required: the student-own SELECT policy
-- and the service-role write path are kind-agnostic, and the existing
-- (session_id, status) WHERE status='open' partial index already covers the
-- next_topic read. Confirmed: no other schema change is needed for Part 2.
--
-- ─── Idempotent + to_regclass-guarded ─────────────────────────────────────────
-- Guarded so it no-ops cleanly if the table does not yet exist (fresh DB /
-- out-of-order apply). Drop-then-recreate the named constraint: DROP CONSTRAINT
-- IF EXISTS (covers both the auto-name and a prior run of this migration's
-- explicit name), then ADD a single explicit named constraint with the widened
-- value set. Safe to re-run: re-running drops the explicit constraint added by
-- the prior run and re-adds the identical one. The widened set is a strict
-- SUPERSET of the original, so EVERY existing row already satisfies it — the
-- ADD CONSTRAINT validation cannot fail on existing data.
--
-- ─── Non-disturbance ──────────────────────────────────────────────────────────
-- No data is read or written. No RLS posture change. No trigger / function /
-- index change. The widened CHECK is purely permissive (adds one allowed value),
-- so application behavior is unchanged until the Part-2 writer (gated by the
-- SEPARATE ff_foxy_pending_expectations_v1 flag, 20260528000013) starts emitting
-- 'next_topic' rows. This migration alone is a zero-behavior change.
--
-- Owner: architect (this widening) + backend (next_topic extract/inject in
--        /api/foxy + the learning-action guard) + ai-engineer (progression
--        directive) + assessment (progression pedagogy) — downstream.
-- Added: 2026-06-14
--
-- ─── Reversible (manual DOWN — only if NO 'next_topic' rows exist) ────────────
--   ALTER TABLE public.foxy_pending_expectations
--     DROP CONSTRAINT IF EXISTS foxy_pending_expectations_expectation_kind_check;
--   ALTER TABLE public.foxy_pending_expectations
--     ADD CONSTRAINT foxy_pending_expectations_expectation_kind_check
--     CHECK (expectation_kind IN ('mcq','open','recall','solve','explain','choose_topic'));
--   -- (narrowing back fails if any row already has expectation_kind='next_topic')

DO $foxy_next_topic$
BEGIN
  IF to_regclass('public.foxy_pending_expectations') IS NOT NULL THEN
    -- Drop the existing CHECK (auto-named by 20260528000013, or the explicit
    -- name from a prior run of this migration — IF EXISTS covers both).
    ALTER TABLE public.foxy_pending_expectations
      DROP CONSTRAINT IF EXISTS foxy_pending_expectations_expectation_kind_check;

    -- Re-add with the widened, strict-superset value set (adds 'next_topic').
    ALTER TABLE public.foxy_pending_expectations
      ADD CONSTRAINT foxy_pending_expectations_expectation_kind_check
      CHECK (
        expectation_kind IN (
          'mcq',
          'open',
          'recall',
          'solve',
          'explain',
          'choose_topic',
          'next_topic'
        )
      );

    -- Forensic comment (inside the guard so a fresh DB without the table
    -- never errors on a COMMENT against a non-existent constraint).
    COMMENT ON CONSTRAINT foxy_pending_expectations_expectation_kind_check
      ON public.foxy_pending_expectations IS
      'Allowed expectation_kind values. Widened 2026-06-14 (20260619000900) to add ''next_topic'' for Part-2 chapter-topic progression (durable next-topic expectation). Strict superset of the original 20260528000013 set; no data change. Writer gated by ff_foxy_pending_expectations_v1.';
  ELSE
    RAISE NOTICE 'foxy_pending_expectations table absent; skipping next_topic CHECK widening (fresh DB).';
  END IF;
END $foxy_next_topic$;
