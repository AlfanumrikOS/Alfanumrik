-- Migration: 20260622100000_seed_irt_difficulty_proxy.sql
-- Purpose: Give the IRT-proxy ranking path real signal BEFORE per-item 2PL
--          calibration accrues, by seeding question_bank.irt_difficulty from the
--          existing integer `difficulty` band (1/2/3) for UNCALIBRATED items only.
--
-- ─── WHY ──────────────────────────────────────────────────────────────────────
-- The proxy branch of the question selector
--   src/lib/irt/fisher-info.ts::computeSelectionScore (TS twin) and
--   public.select_questions_by_irt_info (SQL RPC, baseline) and
--   the Phase 3 adaptive orchestrator
-- scores an uncalibrated item as:
--     score = 1 / (1 + |theta - irt_difficulty|)
-- Today the vast majority of items have irt_difficulty = 0 and
-- irt_calibration_n = 0 (0 items are 2PL-calibrated). With irt_difficulty
-- uniformly 0, the proxy distance is identical for every item, so the ranking
-- carries NO signal — selection collapses to whatever secondary ordering exists.
--
-- Seeding irt_difficulty from the curated `difficulty` band gives the proxy a
-- coarse-but-real theta-scale anchor (easy=-1, medium=0, hard=+1), so the
-- selector can prefer items near the student's ability until the nightly 2PL
-- calibration (calibrate_irt_parameters / IRT cron) earns per-item (a,b) with
-- irt_calibration_n >= 30 and TAKES OVER (the Fisher-info branch).
--
-- ─── BAND MAPPING ─────────────────────────────────────────────────────────────
--   difficulty 1 (easy)   -> irt_difficulty -1.0
--   difficulty 2 (medium) -> irt_difficulty  0.0
--   difficulty 3 (hard)   -> irt_difficulty +1.0
--   difficulty other/NULL -> irt_difficulty  0.0  (ELSE; e.g. legacy 4/5 bands)
-- All within the chk_irt_difficulty_bounds CHECK ([-4.0, +4.0]).
--
-- ─── GUARD: only seed UNCALIBRATED, never-overwrite-real items ─────────────────
-- WHERE (irt_difficulty IS NULL OR irt_difficulty = 0)   -- only the unseeded/default
--   AND COALESCE(irt_calibration_n, 0) = 0               -- never a 2PL-fitted item
--   AND irt_calibrated IS NOT TRUE                        -- never a calibrated item
-- This triple guard guarantees we NEVER touch:
--   • a 2PL-calibrated item (irt_calibration_n >= 30, real irt_b in irt_difficulty
--     written by the IRT cron), nor
--   • an item already carrying a non-zero proxy/3PL estimate (the prior
--     calibrate_irt_parameters() pass that wrote fractional irt_difficulty values
--     like -1.7..+1.3 — those keep their finer signal; they are skipped because
--     irt_difficulty <> 0).
-- Only rows still at the default irt_difficulty = 0 (or NULL) AND with zero
-- calibration evidence are eligible.
--
-- ─── IDEMPOTENCY (value-stable on re-run) ─────────────────────────────────────
-- This is the subtle part. After the first run:
--   • difficulty 1 rows become irt_difficulty = -1.0  -> NO LONGER match
--     (irt_difficulty IS NULL OR irt_difficulty = 0); they are skipped on re-run.
--   • difficulty 3 rows become irt_difficulty = +1.0  -> likewise skipped on re-run.
--   • difficulty 2 rows are written irt_difficulty = 0.0, which EQUALS the column
--     DEFAULT (0.0), so they STILL match `irt_difficulty = 0` on re-run and get
--     re-UPDATEd. BUT the re-update writes 0.0 over 0.0 — the resulting data is
--     byte-identical. This is value-idempotent: re-running produces no NET data
--     change (no row's stored value differs). The medium band is a harmless,
--     stable no-op write, not a flip-flop. Same reasoning for the ELSE 0.0 bands
--     (legacy difficulty 4/5 and any NULL difficulty).
-- The only non-stable side effect of a re-run is writing the same value back +
-- bumping the row's updated_at trigger (if any fires on no-op updates). To avoid
-- even that churn, the UPDATE excludes rows whose value already matches the target
-- via the `IS DISTINCT FROM` guard below, so a second run touches 0 rows.
--
-- ─── SCOPE / SAFETY ───────────────────────────────────────────────────────────
-- This ONLY affects the RANKING/SELECTION signal (Phase 2 live selection +
-- Phase 3 orchestrator candidate ordering). It does NOT touch:
--   • scoring  (P1: Math.round(correct/total*100) — unrelated to irt_difficulty)
--   • XP       (P2: xp-rules.ts — unrelated)
--   • anti-cheat (P3), atomic submit (P4)
--   • question quality / content (P6: text/options/correct_index/explanation
--     are untouched — only the irt_difficulty scoring anchor changes)
--   • grade format (P5: N/A — no grade column touched)
-- No schema change, no new table -> RLS posture unchanged (question_bank keeps its
-- existing baseline RLS). No DROP. Pure data seed on existing columns.
--
-- Owner: architect.  Added: 2026-06-22.  Reviewers: testing, quality.
--
-- ─── Reversible (manual DOWN) ─────────────────────────────────────────────────
--   UPDATE public.question_bank SET irt_difficulty = 0.0
--    WHERE COALESCE(irt_calibration_n,0) = 0 AND irt_calibrated IS NOT TRUE
--      AND irt_difficulty IN (-1.0, 1.0);   -- reverts the seeded easy/hard anchors
--   (medium band was already 0.0; the IRT cron overwrites seeds once it calibrates.)

DO $seed_irt_difficulty_proxy$
BEGIN
  IF to_regclass('public.question_bank') IS NOT NULL THEN
    UPDATE public.question_bank
       SET irt_difficulty = CASE difficulty
                              WHEN 1 THEN -1.0
                              WHEN 2 THEN  0.0
                              WHEN 3 THEN  1.0
                              ELSE 0.0
                            END
     WHERE (irt_difficulty IS NULL OR irt_difficulty = 0)
       AND COALESCE(irt_calibration_n, 0) = 0
       AND irt_calibrated IS NOT TRUE
       -- value-idempotent: skip rows already at the exact target so a re-run
       -- (and the medium/ELSE 0.0 bands) touch 0 rows instead of writing 0.0 over 0.0.
       AND irt_difficulty IS DISTINCT FROM (CASE difficulty
                                              WHEN 1 THEN -1.0
                                              WHEN 2 THEN  0.0
                                              WHEN 3 THEN  1.0
                                              ELSE 0.0
                                            END);
  ELSE
    RAISE NOTICE 'question_bank table absent; skipping irt_difficulty proxy seed (fresh DB).';
  END IF;
END $seed_irt_difficulty_proxy$;
