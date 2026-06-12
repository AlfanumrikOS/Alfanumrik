-- Migration: 20260606000000_phase5_phase6_python_flags.sql
-- Purpose: Seed the four Phase 5/6 Python-cutover rollout flags
--          (ff_python_ncert_solver_v1, ff_python_cme_engine_v1,
--           ff_python_foxy_tutor_v1, ff_python_quiz_generator_v1).
--
-- ─── REWRITTEN 2026-06-12 (staging-sync unblock) ──────────────────────────────
-- The original body ran:
--   INSERT INTO public.feature_flags (name, description, enabled, metadata) ...
--   ON CONFLICT (name) DO UPDATE ...
-- but the canonical feature_flags shape (pg_dump prod baseline
-- 00000000000000_baseline_from_prod.sql, ~line 11212) has NO `name` or
-- `enabled` columns — the table uses `flag_name` (UNIQUE via
-- feature_flags_flag_name_key) + `is_enabled` + `rollout_percentage` +
-- `metadata`. Every other root migration (20260603*, 20260609*, 20260611*,
-- 20260619*) and the runtime reader (supabase/functions/_shared/mol/
-- feature-flag.ts → getFlagEnvelope, selects flag_name/is_enabled/metadata)
-- use the canonical shape. Result: this file failed on staging with
-- `column "name" of relation "feature_flags" does not exist` (42703) and
-- blocked the entire "Sync Migrations to Staging" pipeline at statement 0
-- (GitHub run 27425591787 and 5+ predecessors).
--
-- Root cause + reconciliation scope: docs/runbooks/schema-reproducibility-debt.md
-- (§2.3 — the current staging wall). Per that runbook the chain must converge
-- on ONE canonical shape; this rewrite picks the committed flag_name/is_enabled
-- shape, with a defensive legacy branch in case any environment was reshaped
-- out-of-band to name/enabled (the runbook's hypothesis for how prod may have
-- absorbed the original SQL via MCP).
--
-- Edit-safety: `supabase db push` skips versions already recorded in
-- supabase_migrations.schema_migrations, so environments that already recorded
-- 20260606000000 never re-execute this body. Environments where it is pending
-- (staging, fresh DBs, prod-if-unrecorded) execute the adaptive body below,
-- which succeeds on either shape and is a pure no-op when the rows exist.
--
-- Semantics preserved from the original intent — flags exist, ZERO traffic:
--   * metadata.enabled=false, metadata.kill_switch=false, metadata.rollout_pct=0
--   * is_enabled=false / rollout_percentage=0 on the canonical columns
--   This matches the uniform default-OFF posture of every other ff_python_*
--   seed (20260603170000, 20260609100000..160000) and the proxy precedence in
--   supabase/functions/_shared/python-ai-proxy.ts (metadata.enabled boolean
--   wins; absent → is_enabled column; PYTHON_AI_BASE_URL empty = architect
--   kill regardless). The original file set its `enabled` column true with
--   rollout_pct=0 — also zero traffic; the OFF/OFF posture here is strictly
--   safer and is what the ops ramp playbook (docs/PYTHON_AI_OPERATIONS.md)
--   already assumes for the sibling flags.
--   ON CONFLICT/NOT-EXISTS semantics are DO-NOTHING (the original DO UPDATE
--   would have clobbered an ops-bumped rollout_pct back to 0 on re-apply —
--   unacceptable on prod, so it was dropped deliberately).
--
-- Rollout strategy (unchanged):
--   1. Deploy Python services to Cloud Run
--   2. Wire PYTHON_AI_BASE_URL env var on the Edge Function
--   3. Gradually increase metadata.rollout_pct via Admin Dashboard or raw SQL
--   4. If issues occur, set metadata.kill_switch=true OR empty PYTHON_AI_BASE_URL
--
-- Idempotent. No schema changes. Pure data seed. No new tables → RLS N/A.
-- DOWN (manual):
--   DELETE FROM public.feature_flags WHERE flag_name IN
--     ('ff_python_ncert_solver_v1','ff_python_cme_engine_v1',
--      'ff_python_foxy_tutor_v1','ff_python_quiz_generator_v1');
--   (or WHERE name IN (...) on a legacy-shaped environment)
-- A missing flag resolves to "do not proxy" in python-ai-proxy.ts, so deletion
-- is silent on the user experience.

DO $python_flags$
DECLARE
  v_has_flag_name boolean;
  v_has_name      boolean;
BEGIN
  -- Fresh-DB / out-of-order guard (same pattern as 20260619000000).
  IF to_regclass('public.feature_flags') IS NULL THEN
    RAISE NOTICE 'feature_flags table absent; skipping Phase 5/6 python flag seed (fresh DB).';
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'feature_flags'
      AND column_name = 'flag_name'
  ) INTO v_has_flag_name;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'feature_flags'
      AND column_name = 'name'
  ) INTO v_has_name;

  IF v_has_flag_name THEN
    -- Canonical shape (prod baseline + every other root migration).
    -- ON CONFLICT (flag_name) is backed by feature_flags_flag_name_key
    -- (baseline ~line 15364).
    INSERT INTO public.feature_flags (
      flag_name, description, is_enabled, rollout_percentage, metadata, created_at, updated_at
    ) VALUES
    (
      'ff_python_ncert_solver_v1',
      'Phase 5 Python cutover for ncert-solver. When enabled, the Supabase Edge function forwards to Cloud Run ai-services /v1/ncert-solver instead of running the legacy TS path. Default OFF until architect wires PYTHON_AI_BASE_URL.',
      false,
      0,
      jsonb_build_object('enabled', false, 'kill_switch', false, 'rollout_pct', 0, 'phase', 'phase_5', 'function', 'ncert-solver'),
      now(),
      now()
    ),
    (
      'ff_python_cme_engine_v1',
      'Phase 5 Python cutover for cme-engine. When enabled, the Supabase Edge function forwards to Cloud Run ai-services /v1/cme-engine instead of running the legacy TS path. Default OFF until architect wires PYTHON_AI_BASE_URL.',
      false,
      0,
      jsonb_build_object('enabled', false, 'kill_switch', false, 'rollout_pct', 0, 'phase', 'phase_5', 'function', 'cme-engine'),
      now(),
      now()
    ),
    (
      'ff_python_foxy_tutor_v1',
      'Phase 6 Python cutover for foxy-tutor. When enabled, the Supabase Edge function forwards to Cloud Run ai-services /v1/foxy-tutor instead of running the legacy TS path. Default OFF until architect wires PYTHON_AI_BASE_URL.',
      false,
      0,
      jsonb_build_object('enabled', false, 'kill_switch', false, 'rollout_pct', 0, 'phase', 'phase_6', 'function', 'foxy-tutor'),
      now(),
      now()
    ),
    (
      'ff_python_quiz_generator_v1',
      'Phase 6 Python cutover for quiz-generator. When enabled, the Supabase Edge function forwards to Cloud Run ai-services /v1/quiz-generator instead of running the legacy TS path. Default OFF until architect wires PYTHON_AI_BASE_URL.',
      false,
      0,
      jsonb_build_object('enabled', false, 'kill_switch', false, 'rollout_pct', 0, 'phase', 'phase_6', 'function', 'quiz-generator'),
      now(),
      now()
    )
    ON CONFLICT (flag_name) DO NOTHING;

  ELSIF v_has_name THEN
    -- Legacy / out-of-band shape (name + enabled). Reachable only on an
    -- environment whose feature_flags was reshaped outside the committed
    -- chain (schema-reproducibility-debt.md §2.3 hypothesis). Uses
    -- WHERE NOT EXISTS instead of ON CONFLICT so it does not depend on a
    -- unique constraint over `name` existing. PL/pgSQL only plans a branch
    -- when it executes, so these column references are safe on the
    -- canonical shape above.
    INSERT INTO public.feature_flags (name, description, enabled, metadata)
    SELECT v.flag, v.descr, false,
           jsonb_build_object('enabled', false, 'kill_switch', false, 'rollout_pct', 0)
    FROM (VALUES
      ('ff_python_ncert_solver_v1',
       'Phase 5 Python cutover for ncert-solver. When enabled, the Supabase Edge function forwards to Cloud Run ai-services /v1/ncert-solver instead of running the legacy TS path. Default OFF until architect wires PYTHON_AI_BASE_URL.'),
      ('ff_python_cme_engine_v1',
       'Phase 5 Python cutover for cme-engine. When enabled, the Supabase Edge function forwards to Cloud Run ai-services /v1/cme-engine instead of running the legacy TS path. Default OFF until architect wires PYTHON_AI_BASE_URL.'),
      ('ff_python_foxy_tutor_v1',
       'Phase 6 Python cutover for foxy-tutor. When enabled, the Supabase Edge function forwards to Cloud Run ai-services /v1/foxy-tutor instead of running the legacy TS path. Default OFF until architect wires PYTHON_AI_BASE_URL.'),
      ('ff_python_quiz_generator_v1',
       'Phase 6 Python cutover for quiz-generator. When enabled, the Supabase Edge function forwards to Cloud Run ai-services /v1/quiz-generator instead of running the legacy TS path. Default OFF until architect wires PYTHON_AI_BASE_URL.')
    ) AS v(flag, descr)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.feature_flags ff WHERE ff.name = v.flag
    );

  ELSE
    RAISE NOTICE 'feature_flags has neither flag_name nor name column; skipping Phase 5/6 python flag seed.';
  END IF;
END $python_flags$;
