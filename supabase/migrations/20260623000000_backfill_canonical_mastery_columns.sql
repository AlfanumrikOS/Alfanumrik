-- Migration: 20260623000000_backfill_canonical_mastery_columns.sql
-- Purpose: One-time, idempotent data backfill that makes concept_mastery's
--          canonical numeric posterior live in `mastery_probability` (mirrored
--          by `p_know`), and turns `mastery_level` into the DERIVED categorical
--          band — repairing the historical bug where the BKT writer stored the
--          numeric posterior as TEXT in mastery_level and left
--          mastery_probability / p_know frozen at the 0.1 default.
--
-- Runs BEFORE 20260623000100 (the fixed update_learner_state_post_quiz RPC) so
-- that the new RPC's PRIOR-READ (now COALESCE(cm.mastery_probability, 0.1)) sees
-- the canonical numeric immediately on the first post-fix quiz. Order is by
-- timestamp; this file's timestamp is the earlier one. The two migrations are
-- also effectively order-independent: the RPC only reads canonical, the backfill
-- only repairs existing rows.
--
-- ─── CONTRACT (assessment-approved) ──────────────────────────────────────────
-- Canonical numeric  = mastery_probability (double precision)
-- p_know             = MIRRORS the same posterior
-- mastery_level      = DERIVED band via the CASE below
-- mastery_mean       = NOT TOUCHED (separate concept_id namespace; not a column
--                      on concept_mastery anyway)
--
-- Band CASE (exact, existing vocabulary):
--   attempts = 0          -> 'not_started'
--   prob >= 0.95          -> 'mastered'
--   prob >= 0.70          -> 'proficient'
--   prob >= 0.40          -> 'developing'
--   else                  -> 'beginner'
--
-- ─── TWO ROW CLASSES (verified on linked DB shktyoxqhundlvkiwguu) ─────────────
--   (A) 33 "numeric-as-text" rows: mastery_level matches ^[0-9.]+$ — the true
--       BKT posterior is stranded in mastery_level::text while
--       mastery_probability = p_know = 0.1 (default). THESE ARE THE BUG.
--       Fix: lift the numeric into mastery_probability + p_know, then derive the
--       band into mastery_level.
--   (B) 54 "label" rows: mastery_level is already a category string. On this DB
--       they already carry meaningful mastery_probability (0.20..0.88) with
--       p_know == mastery_probability — i.e. already canonical. The label-branch
--       below only rewrites rows whose mastery_probability is STILL the 0.1
--       default (a never-written placeholder), so it touches 0 of these 54 rows
--       here. It exists to repair such placeholders on OTHER/fresh environments.
--       Their mastery_level is left unchanged. NO row is deleted.
--
-- ─── IDEMPOTENCY ─────────────────────────────────────────────────────────────
--   Branch A guard: WHERE mastery_level ~ '^[0-9.]+$'. After the first run the
--     numeric rows' mastery_level becomes a band label, so they no longer match
--     and are skipped on re-run. The extra IS DISTINCT FROM guard avoids any
--     no-op write churn even within a single run.
--   Branch B guard: WHERE mastery_probability = 0.1 (the placeholder default).
--     After it writes a midpoint the row no longer matches; re-run is a no-op.
--
-- ─── SAFETY / SCOPE ──────────────────────────────────────────────────────────
--   Additive UPDATE on concept_mastery only. No DELETE. No XP / score / session
--   writes (P1/P2/P4 untouched). No schema change -> RLS posture unchanged (P8).
--   mastery_level stays TEXT (P5 unrelated; grades not touched).
--
-- Owner: architect.  Added: 2026-06-23.  Reviewers: assessment, testing, quality.
--
-- ─── Reversible note (manual) ────────────────────────────────────────────────
--   There is no automatic DOWN: the original numeric-in-mastery_level values are
--   preserved losslessly in mastery_probability after the run, so the prior state
--   is reconstructable (mastery_level := mastery_probability::text for the rows
--   this migration converted). Not scripted because the canonical layout is the
--   intended end state.

DO $backfill_canonical_mastery$
BEGIN
  IF to_regclass('public.concept_mastery') IS NULL THEN
    RAISE NOTICE 'concept_mastery absent; skipping canonical-mastery backfill (fresh DB).';
    RETURN;
  END IF;

  -- ── Branch A: numeric-as-text rows (the bug) ──────────────────────────────
  -- Lift the stranded numeric posterior into mastery_probability + p_know, then
  -- derive the categorical band into mastery_level.
  UPDATE public.concept_mastery cm
     SET mastery_probability = cm.mastery_level::double precision,
         p_know              = cm.mastery_level::double precision,
         mastery_level       = CASE
                                 WHEN COALESCE(cm.attempts, 0) = 0 THEN 'not_started'
                                 WHEN cm.mastery_level::double precision >= 0.95 THEN 'mastered'
                                 WHEN cm.mastery_level::double precision >= 0.70 THEN 'proficient'
                                 WHEN cm.mastery_level::double precision >= 0.40 THEN 'developing'
                                 ELSE 'beginner'
                               END,
         updated_at          = now()
   WHERE cm.mastery_level ~ '^[0-9.]+$'
     -- value-idempotent guard: only when the canonical column is not already the
     -- numeric we are about to write (a partially-fixed row is left alone).
     AND cm.mastery_probability IS DISTINCT FROM cm.mastery_level::double precision;

  -- ── Branch B: placeholder label rows (other/fresh envs) ───────────────────
  -- Only repairs label rows whose mastery_probability is STILL the 0.1 default
  -- placeholder; sets prob + p_know to the label midpoint. mastery_level is NOT
  -- changed. On the linked DB this matches 0 rows (label rows already canonical).
  UPDATE public.concept_mastery cm
     SET mastery_probability = CASE cm.mastery_level
                                 WHEN 'mastered'    THEN 0.97
                                 WHEN 'proficient'  THEN 0.82
                                 WHEN 'developing'  THEN 0.55
                                 WHEN 'beginner'    THEN 0.25
                                 WHEN 'familiar'    THEN 0.55
                                 WHEN 'attempted'   THEN 0.25
                                 WHEN 'building'    THEN 0.30
                                 WHEN 'not_started' THEN 0.10
                                 ELSE cm.mastery_probability
                               END,
         p_know              = CASE cm.mastery_level
                                 WHEN 'mastered'    THEN 0.97
                                 WHEN 'proficient'  THEN 0.82
                                 WHEN 'developing'  THEN 0.55
                                 WHEN 'beginner'    THEN 0.25
                                 WHEN 'familiar'    THEN 0.55
                                 WHEN 'attempted'   THEN 0.25
                                 WHEN 'building'    THEN 0.30
                                 WHEN 'not_started' THEN 0.10
                                 ELSE cm.p_know
                               END,
         updated_at          = now()
   WHERE cm.mastery_level !~ '^[0-9.]+$'
     AND cm.mastery_probability = 0.1
     -- never rewrite an unmapped label (ELSE branch is a no-op, but make the
     -- WHERE skip it so re-runs touch 0 rows)
     AND cm.mastery_level IN ('mastered','proficient','developing','beginner',
                              'familiar','attempted','building','not_started');

END $backfill_canonical_mastery$;
