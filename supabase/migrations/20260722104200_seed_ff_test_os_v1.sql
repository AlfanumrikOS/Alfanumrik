-- Seed: ff_test_os_v1 (Alfa OS Exam Briefing hub launch — Master Action Plan 2.4)
-- Presentation-only wrapper over the EXISTING exam_configs + exam_chapters read and
-- exam runtime (/exams/mock/[paperId], /quiz?mode=exam). The "Start an exam" front
-- door. No exam-timing / scoring / anti-cheat / schema change rides on this flag.
--
-- DISTINCT from the LIVE /exam-prep "Exam Sprint" surface (Study Menu v2, REG-69) —
-- /exam-briefing is a separate additive route and does not touch it.
--
-- Seeded OFF / launch-ready. The Exam Briefing shell is FINISHED, tested, and
-- nav-wired: its nav entries in packages/ui/src/navigation/nav-config.ts carry a
-- `flagName: 'ff_test_os_v1'` field that isItemVisibleForFlags() respects, so with
-- this flag OFF the new "Exam Briefing" entry simply does NOT appear (no 404-route
-- exposure). This seed establishes the flag as a visible, auditable, flippable row
-- — it does NOT go live.
--
-- Go-live is a DELIBERATE, SEPARATE activation the user approves — either an
-- operator flipping this flag via the admin_flip_feature_flag RPC, or a follow-up
-- activation migration. That flip is a PRODUCT DECISION: it auto-exposes a brand-
-- new user-facing surface to every student AND creates v1↔v2 nav duplication (the
-- new /exam-briefing "Start an exam" front door alongside the existing exam
-- entries), so the replace-vs-coexist nav cleanup is part of the same decision.
-- This mirrors the sibling presentation-flag precedent (ff_engagement_dashboard_v1,
-- ff_foxy_os_v1 — both SEEDED OFF, activated later).
--
-- The client read path (getFeatureFlags in packages/lib/src/supabase.ts) gates on
-- is_enabled only (it ignores rollout_percentage); rollout_percentage=0 pairs with
-- is_enabled=false so the server isFeatureEnabled path also stays OFF. NULL
-- target_* = global. REG-125 seed-shape conformance.
--
-- Fully idempotent + defensive: guarded so it no-ops if feature_flags is absent, and
-- ON CONFLICT DO NOTHING so a later operator ON is never clobbered back OFF by a re-run.
--
-- DOWN (manual): DELETE FROM feature_flags WHERE flag_name = 'ff_test_os_v1';

DO $block$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    ) VALUES (
      'ff_test_os_v1', false, 0,
      'Alfa OS pre-test Exam Briefing hub at /exam-briefing — upcoming exams, per-exam readiness briefing, display-only predicted-score estimate, weak-chapter focus, time/pace estimate, and a Start CTA into the existing exam runtime (/exams/mock/[paperId] or /quiz?mode=exam). Presentation only; no exam-timing/scoring/XP/schema change. Distinct from the live /exam-prep Exam Sprint (REG-69).',
      NULL, NULL, NULL, now(), now()
    ) ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_test_os_v1 seed (fresh DB).';
  END IF;
END $block$;
