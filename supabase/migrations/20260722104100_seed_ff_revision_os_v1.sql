-- Seed: ff_revision_os_v1 (Alfa OS Revision Center launch — Master Action Plan 2.4)
-- Presentation-only wrapper over the EXISTING spaced-repetition state + GET
-- /api/revision/overview, handing off to the existing /refresh?tab=flashcards
-- session. No mastery / SM-2 / schema change rides on this flag.
--
-- Seeded OFF / launch-ready. The Revision Center shell is FINISHED, tested, and
-- nav-wired: its nav entries in packages/ui/src/navigation/nav-config.ts carry a
-- `flagName: 'ff_revision_os_v1'` field that isItemVisibleForFlags() respects, so
-- with this flag OFF the new "Revision Center" entry simply does NOT appear (no
-- 404-route exposure). This seed establishes the flag as a visible, auditable,
-- flippable row — it does NOT go live.
--
-- Go-live is a DELIBERATE, SEPARATE activation the user approves — either an
-- operator flipping this flag via the admin_flip_feature_flag RPC, or a follow-up
-- activation migration. That flip is a PRODUCT DECISION: it auto-exposes a brand-
-- new user-facing surface to every student AND creates v1↔v2 nav duplication, so
-- the replace-vs-coexist cleanup of the existing v1 /refresh surface is part of the
-- same decision. This mirrors the sibling presentation-flag precedent
-- (ff_engagement_dashboard_v1, ff_foxy_os_v1 — both SEEDED OFF, activated later).
--
-- The client read path (getFeatureFlags in packages/lib/src/supabase.ts) gates on
-- is_enabled only (it ignores rollout_percentage); rollout_percentage=0 pairs with
-- is_enabled=false so the server isFeatureEnabled path also stays OFF. NULL
-- target_* = global. REG-125 seed-shape conformance.
--
-- Fully idempotent + defensive: guarded so it no-ops if feature_flags is absent, and
-- ON CONFLICT DO NOTHING so a later operator ON is never clobbered back OFF by a re-run.
--
-- DOWN (manual): DELETE FROM feature_flags WHERE flag_name = 'ff_revision_os_v1';

DO $block$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    ) VALUES (
      'ff_revision_os_v1', false, 0,
      'Alfa OS Revision Center at /revision — v2 spaced-repetition hub (overdue/due-today/upcoming buckets, 7-day schedule, per-subject load, total-due ring) over GET /api/revision/overview; Start CTA hands off to the existing /refresh flashcard session. Presentation only; no mastery/scoring/XP/schema change.',
      NULL, NULL, NULL, now(), now()
    ) ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_revision_os_v1 seed (fresh DB).';
  END IF;
END $block$;
