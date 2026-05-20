-- Remove ff_revise_route_v1 — subsumed by ff_study_menu_v2 work, no longer
-- referenced by any code path after Phase 6.4. Safe to drop.
-- Companion spec: docs/superpowers/specs/2026-05-20-study-section-consolidation-design.md

BEGIN;
DELETE FROM public.feature_flags WHERE flag_name = 'ff_revise_route_v1';
COMMIT;
