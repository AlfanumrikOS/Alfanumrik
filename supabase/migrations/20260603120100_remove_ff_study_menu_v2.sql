-- Remove ff_study_menu_v2 — Phase 6.4 makes the new menu (Library /
-- Refresh / Exam Sprint) the unconditional default. Flag no longer
-- branches any code; safe to drop.
-- Companion spec: docs/superpowers/specs/2026-05-20-study-section-consolidation-design.md

BEGIN;
DELETE FROM public.feature_flags WHERE flag_name = 'ff_study_menu_v2';
COMMIT;
