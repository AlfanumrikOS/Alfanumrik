-- Migration: 20260803120001_protect_ff_foxy_openai_primary_rollout_v1.sql
-- Purpose: Register `ff_foxy_openai_primary_rollout_v1` (seeded by companion
--          migration 20260803120000_seed_ff_foxy_openai_primary_rollout_v1.sql)
--          in public.protected_feature_flags at tier `ai_provider`, so a
--          direct-Postgres/Supabase-Studio mutation is intercepted by the
--          DB guard trigger (trg_protect_feature_flags, migration
--          20260722090100_feature_flags_db_guard_trigger.sql) the same way a
--          console mutation is intercepted by the app-layer registry.
--
-- ─── Architect governance ruling (Task 2, 2026-08-03) ────────────────────────
-- ai-engineer asked whether this flag — which governs what percentage of
-- live student Foxy/ncert-solver/quiz-gen traffic is routed to Claude-primary
-- instead of the already-shipped OpenAI-primary default (REG-332, commit
-- 5e6ffa9f, 2026-08-02) — should be protected at the `ai_provider` tier
-- alongside ff_mol_enabled / ff_grounded_answer_mol_shadow_v1 etc.
--
-- RULING: YES, protect at `ai_provider`. This flag decides which AI provider
-- serves REAL student traffic — precisely the class of risk the ai_provider
-- tier exists to gate (protected-flags.ts's own stated purpose for the tier:
-- "AI provider change: requires explicit CEO approval before any enable").
-- An accidental is_enabled=true / rollout_percentage bump — from the console
-- or a raw SQL UPDATE — would silently shift a slice of live traffic from
-- OpenAI back to Claude: a real behavior, quality, and cost change with no
-- code deploy required to trigger it. That is exactly the single-field
-- footgun class this registry was built to catch after the 2026-07-20
-- console bulk-enable incident.
--
-- NOT reusing the shared AI_PROVIDER reason string verbatim in the TS
-- registry: that constant's wording is scoped to "(MoL program)", which does
-- not describe this flag and would mislead an operator reading the 409
-- response. The TS companion (see OBLIGATION below) must define its own
-- FlagProtection literal at tier 'ai_provider' with a reason specific to
-- this flag, copied verbatim into this migration's `reason` column below.
--
-- Also to be added to EXPECTED_OFF_FLAGS (TS side): the flag is seeded
-- is_enabled=false / rollout_percentage=0, which is its current CEO-approved
-- posture until ops/CEO decide a ramp schedule — the same footprint every
-- other ai_provider-tier flag has today (all five MoL flags are also in
-- EXPECTED_OFF_FLAGS). Mirrors the ff_adaptive_remediation_v1 /
-- ff_whatsapp_bot_v1 precedent: if this is later deliberately ramped up by
-- CEO approval, remove it from EXPECTED_OFF_FLAGS at that time — it stays
-- PROTECTED regardless, so any further change still needs typed
-- confirmation.
--
-- ─── OBLIGATION (pre-first-console-flip; companion TS change — NOT included
--     in this migration; packages/lib/src/flags/protected-flags.ts is
--     outside architect's file ownership per .claude/CLAUDE.md's domain
--     table, same as its sibling feature-flags.ts which is ops-owned /
--     architect-reviewed) ──────────────────────────────────────────────────
-- Per protected-flags.ts's own documented rule ("If you add/remove a
-- PROTECTED_FLAGS entry, add a companion migration updating
-- protected_feature_flags in the SAME change"), this migration is the DB
-- half of that pair. The DB-trigger guard (blocks a raw-SQL mutation) is
-- live the moment this migration applies, regardless of the TS state. The
-- CONSOLE-layer typed-confirmation guard in apps/host/src/app/api/
-- super-admin/feature-flags/route.ts stays BLIND to this flag — an admin
-- could flip it from the super-admin UI with no typed confirmation — until
-- the TS entry lands. Needed, in the same change, before any first flip
-- attempt from the console:
--   (a) packages/lib/src/flags/protected-flags.ts: add a NEW
--       `FlagProtection` literal (tier 'ai_provider'; do NOT reuse the
--       shared AI_PROVIDER constant — its reason text is MoL-program-
--       specific) for `ff_foxy_openai_primary_rollout_v1` in PROTECTED_FLAGS,
--       reason text matching this migration's `reason` column verbatim; and
--       add the flag name to EXPECTED_OFF_FLAGS;
--   (b) apps/host/src/__tests__/lib/flags/protected-flags-registry.test.ts:
--       bump the PROTECTED_FLAGS (76->77) / EXPECTED_OFF_FLAGS (55->56)
--       count pins and extend the EXPECTED_OFF_FLAGS exact-set derivation to
--       include this flag (it is not covered by HONESTY_52 or either
--       existing hardcoded addition/exclusion list);
--   (c) apps/host/src/__tests__/api/super-admin/
--       feature-flags-protected-guardrail.test.ts: add this migration's
--       filename to SEED_MIGRATION_PATHS so the DB/TS parity parser can see
--       this file's protected_feature_flags row (without this, the "every
--       PROTECTED_FLAGS key is seeded" assertion fails on this flag).
-- Flagged to ai-engineer/ops (TS edit) and testing (count-pin + parser-list
-- edits) in the architect task report. NOT applied here — outside
-- supabase/migrations/, outside architect's exclusive ownership.
--
-- ─── Column shape ─────────────────────────────────────────────────────────
-- Mirrors 20260801100500_seed_ff_whatsapp_bot.sql's protected-flag
-- registration block and 20260722090000_protected_feature_flags_registry.sql's
-- INSERT convention: to_regclass-guarded, (flag_name, tier, reason) columns,
-- ON CONFLICT (flag_name) DO UPDATE (this registry's convention — re-running
-- refreshes tier/reason, unlike feature_flags seeds which use DO NOTHING).
--
-- Idempotent. Pure data seed — no schema changes, no new tables, so RLS N/A;
-- protected_feature_flags keeps its existing RLS posture (service-role-only,
-- migration 20260722090000). Additive only.
--
-- Owner: architect (this ruling + DB migration). Reviewers (P14): ai-engineer
-- (TS companion + confirms REG-332/commit provenance), ops (TS companion
-- execution / ramp-schedule ownership going forward), testing (count-pin +
-- SEED_MIGRATION_PATHS updates), quality (build gate).
-- Added: 2026-08-03.
--
-- ─── Reversible (manual DOWN) ─────────────────────────────────────────────
--   DELETE FROM public.protected_feature_flags
--     WHERE flag_name = 'ff_foxy_openai_primary_rollout_v1';
-- Removing this row only removes the DB-trigger guard; the flag itself
-- (seeded by 20260803120000) is unaffected and still resolves to its
-- default-OFF, OpenAI-primary-unchanged no-op state.

DO $foxy_openai_primary_rollout_protect$
BEGIN
  IF to_regclass('public.protected_feature_flags') IS NOT NULL THEN
    INSERT INTO public.protected_feature_flags (flag_name, tier, reason) VALUES
      (
        'ff_foxy_openai_primary_rollout_v1',
        'ai_provider',
        'Foxy OpenAI-primary provider-swap rollback lever (REG-332, commit 5e6ffa9f, 2026-08-02): governs the percentage of live student Foxy/ncert-solver/quiz-gen traffic routed to Claude-primary instead of the shipped OpenAI-primary default. AI provider change affecting real student traffic — requires explicit CEO approval before any enable.'
      )
    ON CONFLICT (flag_name) DO UPDATE
      SET tier = EXCLUDED.tier,
          reason = EXCLUDED.reason;
  ELSE
    RAISE NOTICE 'protected_feature_flags table absent; skipping ff_foxy_openai_primary_rollout_v1 protection registration (fresh DB / out-of-order apply).';
  END IF;
END $foxy_openai_primary_rollout_protect$;

-- ─── Verify (manual, after applying) ──────────────────────────────────────
-- SELECT flag_name, tier FROM protected_feature_flags
--   WHERE flag_name = 'ff_foxy_openai_primary_rollout_v1';
--   -- expect: 1 row, tier = 'ai_provider'.
-- UPDATE feature_flags SET is_enabled = true
--   WHERE flag_name = 'ff_foxy_openai_primary_rollout_v1';  -- direct SQL session
--   -- expect: blocked by trg_protect_feature_flags (20260722090100), once
--   -- both this migration and 20260803120000 have applied.
