-- Seed: ff_practice_os_v1 (Alfa OS Practice Center launch — Master Action Plan 2.4)
-- Presentation-only wrapper over the EXISTING /quiz engine + GET /api/practice/history.
--
-- Seeded OFF / launch-ready. The Practice Center shell is FINISHED, tested, and
-- nav-wired: its nav entries in packages/ui/src/navigation/nav-config.ts carry a
-- `flagName: 'ff_practice_os_v1'` field that isItemVisibleForFlags() respects, so
-- with this flag OFF the new "Practice Center" entry simply does NOT appear (no
-- 404-route exposure). This seed establishes the flag as a visible, auditable,
-- flippable row — it does NOT go live.
--
-- Go-live is a DELIBERATE, SEPARATE activation the user approves — either an
-- operator flipping this flag via the admin_flip_feature_flag RPC, or a follow-up
-- activation migration. That flip is a PRODUCT DECISION: it auto-exposes a brand-
-- new user-facing surface to every student AND creates v1↔v2 nav duplication, so
-- the replace-vs-coexist cleanup of the existing v1 /quiz surface is part of the
-- same decision. This mirrors the sibling presentation-flag precedent
-- (ff_engagement_dashboard_v1, ff_foxy_os_v1 — both SEEDED OFF, activated later).
--
-- The client read path (getFeatureFlags in packages/lib/src/supabase.ts) gates on
-- is_enabled only (it ignores rollout_percentage); rollout_percentage=0 pairs with
-- is_enabled=false so the server isFeatureEnabled path also stays OFF. NULL
-- target_* = global (all roles / environments / institutions). REG-125 seed-shape
-- conformance.
--
-- Fully idempotent + defensive: guarded so it no-ops cleanly if feature_flags does
-- not yet exist (fresh DB / out-of-order apply), and ON CONFLICT DO NOTHING so an
-- operator who later flips it ON is never clobbered back OFF by a re-run.
--
-- DOWN (manual): DELETE FROM feature_flags WHERE flag_name = 'ff_practice_os_v1';

DO $block$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    ) VALUES (
      'ff_practice_os_v1', false, 0,
      'Alfa OS Practice Center at /practice — v2 practice hub (sessions-this-week ring, Quick-Start into the existing /quiz engine, weak-topic launchers, due-for-practice nudge, recent history, avg-score/error/Bloom insights) over GET /api/practice/history. Presentation only; no scoring/XP/anti-cheat/schema change.',
      NULL, NULL, NULL, now(), now()
    ) ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_practice_os_v1 seed (fresh DB).';
  END IF;
END $block$;
