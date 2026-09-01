-- Migration: 20260901160000_seed_ff_grounding_check_confidence_gate.sql
-- Purpose: seed ff_grounding_check_confidence_gate_v1 fully OFF.
--
-- Gates the strict-mode grounding-check CONFIDENCE GATE
-- (supabase/functions/grounded-answer/_grounding-gate-flag.ts). When ON, the
-- second Anthropic fact-check call is SKIPPED for answers whose retrieval
-- similarity already clears GROUNDING_GATE_MIN_COSINE (default 0.75).
--
-- ─── Why this exists ─────────────────────────────────────────────────────────
--
--   Measured 2026-09-01 from mol_request_logs: task_type='grounding_check'
--   averaged 6,213 input tokens to produce 56 output tokens and accounted for
--   63% of that day's total AI spend across every surface — a larger line item
--   than answer generation itself.
--
-- ─── Why it is seeded OFF and must stay OFF until reviewed ───────────────────
--
--   This RELAXES A P12 AI-SAFETY RAIL. Strict mode exists to guarantee that a
--   served answer is supported by the retrieved chunks; skipping the check
--   trades part of that guarantee for money. That is a product decision, not
--   an ops one.
--
--   Per the P14 review chain for AI tutor behaviour, enabling it requires
--   ai-engineer + assessment + testing sign-off, and the threshold should be
--   backed by MEASURED pass rates — i.e. evidence of what fraction of checks
--   above 0.75 cosine actually return "pass" today. Until that measurement
--   exists, any threshold is a guess, and a guess that silently serves
--   ungrounded answers to students is the failure mode P12 was written for.
--
--   Suggested ramp: enable, watch grounded_ai_traces.grounding_pass_ratio and
--   the foxy_quality_scores rubric for a regression, then widen the threshold
--   downward only if both hold.
--
--   Default-OFF contract: is_enabled = FALSE, rollout_percentage = 0. The code
--   is additionally fail-CLOSED — a missing row, an unreadable flag, or an
--   absent similarity signal all leave the grounding check RUNNING. The
--   expensive, safe path is the fallback in every direction.
--
-- Idempotent (ON CONFLICT DO NOTHING so a later deliberate flip is never
-- reverted by a re-run), guarded with to_regclass. Pure data seed: no schema
-- change, no new table, RLS N/A.

DO $seed_ff_grounding_check_confidence_gate$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN

    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'ff_grounding_check_confidence_gate_v1', false, 0,
      'Skips the strict-mode grounding-check LLM call when top cosine similarity >= GROUNDING_GATE_MIN_COSINE (default 0.75). Cost control: grounding_check was 63% of AI spend on 2026-09-01 (6,213 input tokens for a 56-token verdict). RELAXES A P12 SAFETY RAIL — seeded OFF; enabling needs ai-engineer + assessment + testing sign-off and a threshold backed by measured pass rates. Code is fail-closed: any error or missing signal runs the check.',
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO NOTHING;

  END IF;
END
$seed_ff_grounding_check_confidence_gate$;
