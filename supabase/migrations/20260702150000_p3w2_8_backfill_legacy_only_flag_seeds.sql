-- Migration: 20260702150000_p3w2_8_backfill_legacy_only_flag_seeds.sql
-- Purpose: Phase 3 Wave 2 #8 (S2, P11-adjacent). Backfill the 4 feature-flag
--          rows that were ONLY ever seeded under supabase/migrations/_legacy/
--          — a directory `supabase db push` never applies (root-migrations-only
--          convention; see docs/audit/2026-07-02-discovery/03-data-infra.md).
--
--   Confirmed by Phase 2 validation audit
--   docs/audit/2026-07-02-validation/11-api-contracts.md (C-1, finding #4):
--   `ff_atomic_subscription_activation` (the P11 payment-fallback kill switch),
--   `ff_irt_question_selection`, `ff_foxy_streaming`, and `ff_rag_mmr_diversity`
--   are read live in application code but their seed migrations live only
--   under `_legacy/timestamped/`. The canonical `feature_flags` table's
--   `is_enabled` column DEFAULT is `false` (baseline
--   00000000000000_baseline_from_prod.sql ~line 11215) and there is NO row for
--   any of these 4 flags at root — confirmed by grep against the baseline file.
--   So any FRESH environment (new staging, DR restore, CI live-DB test) that
--   only ever applies root migrations gets these 4 flags at column-default
--   (is_enabled=false, missing row -> isFeatureEnabled() resolves false per
--   src/lib/feature-flags.ts:97) instead of their INTENDED seeded state —
--   most notably `ff_atomic_subscription_activation`, whose intended state is
--   `true` (P11 atomic-fallback path enabled by default).
--
--   Prod itself is unaffected: the baseline is a pg_dump of prod, and the
--   audit's own limitation note (C-1, line ~74) says prod likely already
--   carries these rows from when the _legacy migrations WERE applied
--   historically, before the Section 10 archive cleanup. This migration must
--   never overwrite whatever value prod (or any already-seeded environment)
--   currently carries — ON CONFLICT (flag_name) DO NOTHING guarantees that.
--   It exists purely to backfill environments where the row was never created.
--
-- ─── Flags backfilled (values verbatim from their _legacy seed migrations) ───
--
--   1. ff_atomic_subscription_activation  is_enabled=true,  rollout=0 (col default)
--      Source: _legacy/timestamped/20260425140500_ff_atomic_subscription_activation.sql
--      P11 kill switch for the Razorpay webhook's atomic_subscription_activation
--      fallback. When enabled (intended default), the webhook falls back to the
--      atomic RPC on primary-RPC failure instead of returning 503 immediately.
--
--   2. ff_irt_question_selection  is_enabled=false, rollout_percentage=100
--      Source: _legacy/timestamped/20260428000600_select_questions_by_irt_info.sql
--      Phase 4 IRT Fisher-info question selection. Default OFF until ops
--      confirms nightly IRT calibration has populated enough (irt_a, irt_b).
--
--   3. ff_foxy_streaming  is_enabled=false, rollout=0 (col default)
--      Source: _legacy/timestamped/20260429000000_p1_foxy_streaming_flag.sql
--      SSE streaming for /api/foxy. Default OFF (blocking JSON response).
--
--   4. ff_rag_mmr_diversity  is_enabled=true, rollout_percentage=100
--      Source: _legacy/timestamped/20260428120000_ff_rag_mmr_diversity.sql
--      Maximal Marginal Relevance re-ordering in the grounded-answer RAG
--      pipeline. Default ON — validated against the NCERT eval set; the flag
--      is a rollback safety valve, not an experiment gate.
--
-- ─── Column shape ──────────────────────────────────────────────────────────
-- Mirrors the established root flag-seed precedent verbatim (REG-125 canonical
-- shape: explicit column list led by flag_name, ON CONFLICT (flag_name) DO
-- NOTHING, never DO UPDATE — see 20260619000600_seed_ff_adaptive_loops_bc_v1.sql).
-- Descriptions are the exact text from each flag's _legacy seed for audit
-- traceability. Scoping arrays left NULL (no role/env/institution narrowing) —
-- unchanged from the _legacy originals, which did not set them either.
--
-- Idempotent: guarded by `to_regclass('public.feature_flags')` for fresh-DB /
-- out-of-order apply safety, and each INSERT is `ON CONFLICT (flag_name) DO
-- NOTHING` (backed by the feature_flags_flag_name_key unique constraint) so
-- re-running this file is a no-op, and it can NEVER clobber a value an
-- operator or a previously-applied _legacy migration already set. No schema
-- changes. Pure data seed. No new tables -> RLS N/A.
--
-- Owner: architect. Added: 2026-07-02 (Phase 3 Wave 2 #8).
--
-- ─── Reversible (manual DOWN) ──────────────────────────────────────────────
--   DELETE FROM feature_flags WHERE flag_name IN (
--     'ff_atomic_subscription_activation', 'ff_irt_question_selection',
--     'ff_foxy_streaming', 'ff_rag_mmr_diversity'
--   );
-- A missing flag resolves to OFF app-side, so deleting these rows on an
-- environment that has NOT customized them is a silent no-behavior-change
-- revert. On an environment where an operator has since flipped one of these
-- (e.g. flipped ff_irt_question_selection on after calibration), deleting the
-- row would regress that environment to OFF — check current values first.

DO $p3w2_8_flag_backfill$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN

    INSERT INTO public.feature_flags (
      flag_name,
      is_enabled,
      description,
      target_roles,
      target_environments,
      target_institutions,
      created_at,
      updated_at
    )
    VALUES (
      'ff_atomic_subscription_activation',
      true,
      'Kill-switch for the Phase 0g.2 atomic_subscription_activation fallback in the Razorpay webhook. When disabled, the webhook returns 503 immediately on primary RPC failure (forcing Razorpay retries) instead of attempting the atomic fallback. Default: enabled. Backfilled at root 2026-07-02 (Phase 3 Wave 2 #8) — originally seeded only under _legacy/timestamped/20260425140500_ff_atomic_subscription_activation.sql, which supabase db push never applies.',
      NULL,
      NULL,
      NULL,
      now(),
      now()
    )
    ON CONFLICT (flag_name) DO NOTHING;

    INSERT INTO public.feature_flags (
      flag_name,
      is_enabled,
      rollout_percentage,
      description,
      target_roles,
      target_environments,
      target_institutions,
      created_at,
      updated_at
    )
    VALUES (
      'ff_irt_question_selection',
      false,
      100,
      'Phase 4 IRT-info question selection. When enabled, the quiz-generator Edge Function calls select_questions_by_irt_info() instead of the legacy difficulty-bucket flow. Default OFF -- flip after the nightly IRT calibration cron has populated (irt_a, irt_b) on enough items that selection_path = ''fisher_info'' is the dominant code. Backfilled at root 2026-07-02 (Phase 3 Wave 2 #8) — originally seeded only under _legacy/timestamped/20260428000600_select_questions_by_irt_info.sql, which supabase db push never applies.',
      NULL,
      NULL,
      NULL,
      now(),
      now()
    )
    ON CONFLICT (flag_name) DO NOTHING;

    INSERT INTO public.feature_flags (
      flag_name,
      is_enabled,
      description,
      target_roles,
      target_environments,
      target_institutions,
      created_at,
      updated_at
    )
    VALUES (
      'ff_foxy_streaming',
      false,
      'Serve Foxy responses via SSE streaming (Anthropic streaming -> /api/foxy -> browser). When OFF, /api/foxy returns blocking JSON as before. Per-user opt-out via localStorage.alfanumrik_foxy_stream = "0". Backfilled at root 2026-07-02 (Phase 3 Wave 2 #8) — originally seeded only under _legacy/timestamped/20260429000000_p1_foxy_streaming_flag.sql, which supabase db push never applies.',
      NULL,
      NULL,
      NULL,
      now(),
      now()
    )
    ON CONFLICT (flag_name) DO NOTHING;

    INSERT INTO public.feature_flags (
      flag_name,
      is_enabled,
      rollout_percentage,
      description,
      target_roles,
      target_environments,
      target_institutions,
      created_at,
      updated_at
    )
    VALUES (
      'ff_rag_mmr_diversity',
      true,
      100,
      'Phase 2.B Win 2 -- apply Maximal Marginal Relevance (lambda=0.7) over the reranked top-N chunks in grounded-answer to penalise redundant context. Pure in-memory reorder; no extra API calls. When disabled, the pipeline returns Voyage rerank-2 ordering as before. Rollback: set is_enabled=false. Backfilled at root 2026-07-02 (Phase 3 Wave 2 #8) — originally seeded only under _legacy/timestamped/20260428120000_ff_rag_mmr_diversity.sql, which supabase db push never applies.',
      NULL,
      NULL,
      NULL,
      now(),
      now()
    )
    ON CONFLICT (flag_name) DO NOTHING;

  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping legacy-only flag backfill (fresh DB, table not yet created).';
  END IF;
END $p3w2_8_flag_backfill$;
