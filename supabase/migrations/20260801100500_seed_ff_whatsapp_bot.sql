-- Migration: 20260801100500_seed_ff_whatsapp_bot.sql
-- Purpose: WhatsApp study bot — feature-flag seeds. Seeds the 11 ff_whatsapp_*
--          flags, ALL default OFF (is_enabled = false, rollout_percentage = 0),
--          so every bot surface is visible/auditable/flippable from the
--          super-admin console while remaining completely inert. Also registers
--          the two highest-blast-radius flags (ff_whatsapp_bot_v1,
--          ff_whatsapp_alarm_template) in public.protected_feature_flags so a
--          direct-Postgres/Studio mutation is intercepted by the DB guard
--          trigger (20260722090100) and they can only be flipped via
--          admin_flip_feature_flag.
--
-- ─── Default-OFF contract ─────────────────────────────────────────────────────
-- The read path (isFeatureEnabled) returns false for both is_enabled = false
-- AND rollout_percentage <= 0, so seeding these rows is a ZERO-behavior
-- change. Flipping any ff_whatsapp_* flag ON in production requires explicit
-- CEO action via admin_flip_feature_flag, per flag, per rollout step
-- (standing approval gate in the approved plan — NOT blanket-approved).
--
-- ─── Column shape (REG-125) ───────────────────────────────────────────────────
-- Mirrors 20260724120000_seed_ff_model_gateway_v1.sql: DO $tag$ block with a
-- defensive to_regclass guard (no-ops cleanly on a fresh DB / out-of-order
-- apply so live-DB CI and preview branches never fail), explicit column list
-- with flag_name first, ON CONFLICT (flag_name) DO NOTHING (never DO UPDATE
-- for flag seeds — an operator's later state must not be clobbered by a
-- re-run). One deliberate divergence from the model-gateway seed, as
-- specified by the plan: target_environments = ARRAY['production','staging']
-- (this feature is env-scoped from day one); target_roles /
-- target_institutions stay NULL. The global is_enabled=false / rollout=0
-- double gate is what holds every flag OFF.
--
-- protected_feature_flags rows follow 20260722090000's pattern: to_regclass-
-- guarded, tier + reason columns, ON CONFLICT (flag_name) DO UPDATE (that
-- registry's convention — re-running refreshes tier/reason).
--
-- ─── DB⊃TS registry drift: was DELIBERATE at seed time — CLOSED 2026-07-30 ───
-- [Historical, as filed] The TS registry (packages/lib/src/flags/
-- protected-flags.ts) intentionally OMITTED these two flags at seed time, and
-- NO test flagged the drift: the DB<->TS parity suite
-- (apps/host/src/__tests__/api/super-admin/
-- feature-flags-protected-guardrail.test.ts) parsed ONLY migration
-- 20260722090000, so rows seeded HERE were structurally invisible to it; and
-- protected-flags-registry.test.ts count-pinned the TS registry at 74 flags /
-- EXPECTED_OFF_FLAGS at 54, parsed from 20260720110000. The drift direction
-- was SAFE (fail-closed): the DB guard trigger (20260722090100) blocks any
-- enable transition on these flags without the app.protected_flag_ack GUC,
-- and because the TS registry omitted them the super-admin console never
-- routed them through admin_flip_feature_flag — so they could not be enabled
-- from the console at all until the companion landed.
--
-- OBLIGATION (pre-first-flip; architect-reviewed companion — ALL THREE
-- together): ✅ FULFILLED 2026-07-30 (ops companion change, BEFORE any first
-- flip of either flag):
--   (a) DONE — both flags added to PROTECTED_FLAGS + EXPECTED_OFF_FLAGS in
--       protected-flags.ts (tier 'staged_rollout', reasons mirroring this
--       seed's protected_feature_flags rows);
--   (b) DONE — count pins bumped 74→76 (PROTECTED_FLAGS) and 54→56
--       (EXPECTED_OFF_FLAGS) in protected-flags-registry.test.ts (that test
--       now also parses THIS file's protected_feature_flags block); the
--       flag-posture-canary watched-set pin followed 55→57;
--   (c) DONE — the parity test's parser was generalized to a seed-file LIST
--       aggregating protected_feature_flags rows from BOTH 20260722090000
--       AND this file (neither already-applied migration edited in place).
--       (c) was load-bearing and non-obvious: step (a) without (c) FAILS the
--       "every PROTECTED_FLAGS key is seeded" assertion, because the parser
--       could not see this file's rows.
-- Both flags are now console-guarded (typed-confirmation, 409 FLAG_PROTECTED),
-- DB-trigger-guarded, and nightly-posture-canary watched.
--
-- Idempotent. Pure data seed — no schema changes, no new tables, so RLS N/A;
-- feature_flags and protected_feature_flags keep their existing posture.
-- Additive only.
--
-- Owner: architect. Added: 2026-08-01 (WhatsApp bot plan, migration 6 of 7 —
-- filed early per the approved build order: flags land before any code path
-- that reads them).
-- Plan: plan-alfanumrik-whatsapp-bot-mighty-frost.md (Migrations table, row 6;
-- "Feature flags" section for the per-flag semantics).
--
-- ─── Rollback (MANUAL ONLY — never auto-run) ─────────────────────────────────
--   DELETE FROM public.protected_feature_flags
--     WHERE flag_name IN ('ff_whatsapp_bot_v1','ff_whatsapp_alarm_template');
--   DELETE FROM public.feature_flags WHERE flag_name LIKE 'ff_whatsapp_%';
-- The application resolves a missing flag to OFF, so deletion is silent on
-- the production experience.

DO $whatsapp_flags$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN
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
    VALUES
      (
        'ff_whatsapp_bot_v1',
        false, 0,
        'WhatsApp bot MASTER kill switch: when OFF the webhook still 200s and dedupes inbound events but ALL processing and ALL outbound sends stop. Protected flag — flip only via admin_flip_feature_flag with CEO approval. Default off.',
        NULL, ARRAY['production','staging']::text[], NULL, now(), now()
      ),
      (
        'ff_whatsapp_inbound_webhook',
        false, 0,
        'WhatsApp inbound webhook processing (GET verify + POST HMAC + dedupe insert) — Phase 1 observation seam, no product behavior. Default off.',
        NULL, ARRAY['production','staging']::text[], NULL, now(), now()
      ),
      (
        'ff_whatsapp_daily6',
        false, 0,
        'WhatsApp Daily 6 practice loop (interactive-list quiz from the student''s own practice queue; zero LLM cost). Default off.',
        NULL, ARRAY['production','staging']::text[], NULL, now(), now()
      ),
      (
        'ff_whatsapp_doubt',
        false, 0,
        'WhatsApp text doubt-solving (NCERT-grounded Socratic ladder; the per-turn LLM spend surface, quota-capped per plan). Default off.',
        NULL, ARRAY['production','staging']::text[], NULL, now(), now()
      ),
      (
        'ff_whatsapp_doubt_cache',
        false, 0,
        'WhatsApp doubt semantic cache (3-tier: exact/semantic/canonical) — exists to MEASURE true hit rate vs direct generation, not a rollout gate. Default off.',
        NULL, ARRAY['production','staging']::text[], NULL, now(), now()
      ),
      (
        'ff_whatsapp_ocr',
        false, 0,
        'WhatsApp image doubt intake via OCR (media fetched, OCRed, bytes discarded — never persisted; per-plan whatsapp_ocr quota). Default off.',
        NULL, ARRAY['production','staging']::text[], NULL, now(), now()
      ),
      (
        'ff_whatsapp_notebook',
        false, 0,
        'WhatsApp Mistake Notebook (top-3 open misconceptions, spaced retest, close after 2 correct >=48h apart; zero LLM cost). Default off.',
        NULL, ARRAY['production','staging']::text[], NULL, now(), now()
      ),
      (
        'ff_whatsapp_board_sprint',
        false, 0,
        'WhatsApp Board Sprint for grades 10/12 (syllabus-coverage re-weighting from ~90 days out + weekly timed set via web deep link). Default off.',
        NULL, ARRAY['production','staging']::text[], NULL, now(), now()
      ),
      (
        'ff_whatsapp_parent_weekly',
        false, 0,
        'WhatsApp Parent Sunday Note (one utility template per week to the linked guardian; quiet-hours and daily-cap gated). Default off.',
        NULL, ARRAY['production','staging']::text[], NULL, now(), now()
      ),
      (
        'ff_whatsapp_alarm_template',
        false, 0,
        'WhatsApp daily alarm utility template (the ONE paid template per day, suppressed when a free window is open) — the number-quality-rating risk surface; protected flag, staged 5/25/100 percent with quality monitoring. Default off.',
        NULL, ARRAY['production','staging']::text[], NULL, now(), now()
      ),
      (
        'ff_whatsapp_cost_governor',
        false, 0,
        'WhatsApp per-plan usage caps via check_and_record_usage (whatsapp_doubt / whatsapp_ocr / whatsapp_daily6; degrade-to-app-deep-link, never hard-block) — ships in shadow/log-only first. Default off.',
        NULL, ARRAY['production','staging']::text[], NULL, now(), now()
      )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_whatsapp_* seeds (fresh DB).';
  END IF;
END $whatsapp_flags$;

-- ─── Protected-flag registration ─────────────────────────────────────────────
-- DB-layer guardrail (20260722090000/20260722090100): a direct Postgres /
-- Studio UPDATE of these two flags is blocked by the BEFORE UPDATE trigger;
-- they can only be flipped via the admin_flip_feature_flag RPC.

DO $whatsapp_protected$
BEGIN
  IF to_regclass('public.protected_feature_flags') IS NOT NULL THEN
    INSERT INTO public.protected_feature_flags (flag_name, tier, reason) VALUES
      (
        'ff_whatsapp_bot_v1',
        'staged_rollout',
        'WhatsApp bot MASTER kill switch (default-OFF, CEO-gated staged rollout per the approved 2026-07-29 plan). Enabling activates all inbound processing and outbound sends for the channel; flipping requires an approved per-phase rollout step via admin_flip_feature_flag.'
      ),
      (
        'ff_whatsapp_alarm_template',
        'staged_rollout',
        'The only recurring PAID WhatsApp template send (daily alarm). Premature or bulk enable spends real money per recipient per day AND risks the WhatsApp number''s quality rating (block-rate driven; a drop to RED permanently damages the channel). Staged 5/25/100 percent with quality monitoring; flip only via admin_flip_feature_flag.'
      )
    ON CONFLICT (flag_name) DO UPDATE
      SET tier = EXCLUDED.tier,
          reason = EXCLUDED.reason;
  ELSE
    RAISE NOTICE 'protected_feature_flags table absent; skipping WhatsApp protected-flag registration (fresh DB).';
  END IF;
END $whatsapp_protected$;

-- ─── Verify (manual, after applying) ─────────────────────────────────────────
-- 1. SELECT flag_name, is_enabled, rollout_percentage, target_environments
--      FROM feature_flags WHERE flag_name LIKE 'ff_whatsapp_%' ORDER BY flag_name;
--    -- expect: 11 rows, all (false, 0, {production,staging}).
-- 2. SELECT flag_name, tier FROM protected_feature_flags
--      WHERE flag_name LIKE 'ff_whatsapp_%';
--    -- expect: 2 rows (ff_whatsapp_bot_v1, ff_whatsapp_alarm_template),
--    --         both staged_rollout.
-- 3. UPDATE feature_flags SET is_enabled = true
--      WHERE flag_name = 'ff_whatsapp_bot_v1';  -- as a direct SQL session
--    -- expect: blocked by trg_protect_feature_flags (20260722090100).
