-- Migration: 20260805100300_update_ff_irt_protected_reason.sql
-- Purpose: Foxy North-Star Phase 0 item F9 — the protected_feature_flags
--   reason for ff_irt_question_selection (seeded by the applied
--   20260722090000, which is never edited in place) says "Do not enable
--   until calibration data exists", but the nightly Vercel cron
--   /api/cron/irt-calibrate (02:50 UTC, pinned by REG-44) HAS been writing
--   question_bank.irt_a/irt_b — calibration data DOES exist. Replace the
--   self-contradictory text with the accurate enablement criteria. UPDATE
--   only — no tier change, no posture change (flag stays OFF/0%), no
--   schema change. Companion TS edit in the same change set:
--   packages/lib/src/flags/protected-flags.ts (IRT_DORMANT reason).
--
-- Parity note: the DB/TS registry parity suite
--   (feature-flags-protected-guardrail.test.ts) compares flag_name + tier
--   only, parsed from the INSERT seed files — a reason-text UPDATE in a new
--   migration is invisible to it by design and breaks nothing.
--
-- Idempotent: plain UPDATE keyed by flag_name; re-running rewrites the same
-- value. No-op if the row is absent (fresh DBs get it from 20260722090000,
-- which sorts earlier in the chain).

UPDATE public.protected_feature_flags
SET reason = 'Calibration runs nightly (irt-calibrate cron). Enable only after the Phase-3 shadow evaluation gate passes (see docs/superpowers/specs/2026-08-05-foxy-north-star-alignment-design.md, E2) — cohort rollout with kill switch.'
WHERE flag_name = 'ff_irt_question_selection';
