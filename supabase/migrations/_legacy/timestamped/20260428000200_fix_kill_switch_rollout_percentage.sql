-- Migration: 20260428000200_fix_kill_switch_rollout_percentage.sql
-- Purpose: Fix operational kill-switch and grounded-AI flags that were
--          seeded with rollout_percentage = 0 (column default), causing
--          isFeatureEnabled() to return false even when is_enabled = true.
--
-- Background:
--   `src/lib/feature-flags.ts:126-132` returns false for any flag where
--   `rollout_percentage <= 0`, regardless of `is_enabled`. The launch
--   migration `20260425160000_p0_launch_kill_switches_and_expiry_rpc.sql`
--   inserted `ai_usage_global` and `razorpay_payments` without setting
--   `rollout_percentage`, so they took the column default of 0. This
--   caused EVERY production Foxy request to trip the `ai_usage_global`
--   kill-switch path on `route.ts:818` and return 503 to authenticated
--   students with the message "Foxy is temporarily unavailable. Please
--   try again in a minute."
--
--   The same bug silently disabled `ff_grounded_ai_enabled` and
--   `ff_grounded_ai_foxy`, so even after the kill-switch was bypassed
--   the route would have fallen back to legacy `foxy-tutor`.
--
-- Fix:
--   Force `rollout_percentage = 100` on the four operational flags that
--   are meant to be globally on whenever `is_enabled = true`. Idempotent.
--
-- Note:
--   Seven other flags (`adaptive_post_quiz`, `foxy_cognitive_engine`,
--   `foxy_diagram_rendering`, `improvement_*`, `quiz_assembler_v2`) are
--   in the same contradictory state but may be intentional staged
--   rollouts; those are intentionally NOT touched here. Operators should
--   audit them in the super-admin console and either set
--   `is_enabled = false` (to disable cleanly) or
--   `rollout_percentage > 0` (to enable for some users).

UPDATE feature_flags
SET rollout_percentage = 100,
    updated_at         = now()
WHERE flag_name IN (
        'ai_usage_global',          -- global LLM kill switch (P12)
        'razorpay_payments',        -- global payment kill switch (P11)
        'ff_grounded_ai_enabled',   -- grounded-answer pipeline master toggle
        'ff_grounded_ai_foxy'       -- per-route Foxy → grounded-answer toggle
      )
  AND is_enabled = true
  AND (rollout_percentage IS NULL OR rollout_percentage < 100);

-- Audit hint for ops: any flag where (is_enabled = true AND
-- rollout_percentage <= 0) is contradictory. Run this on demand:
--
--   SELECT flag_name FROM feature_flags
--   WHERE is_enabled = true
--     AND (rollout_percentage IS NULL OR rollout_percentage <= 0);
