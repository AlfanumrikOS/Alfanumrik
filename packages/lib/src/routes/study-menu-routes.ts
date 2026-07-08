/**
 * Study Menu v2 — Phase 6.4 cleanup.
 *
 * Originally these helpers were flag-gated to support the Day-0 to Day-12
 * rollout. The flag (`ff_study_menu_v2`) was retired in migration
 * 20260603120100_remove_ff_study_menu_v2.sql, so the helpers now always
 * return the v2 (new) URLs. The optional `_flags` parameter is preserved
 * so the 9 existing call sites don't need to be re-touched — they pass
 * `flags` from their parent and the helper ignores it.
 *
 * Companion spec:
 *   docs/superpowers/specs/2026-05-20-study-section-consolidation-design.md
 */

export function reviewRoute(_flags?: Record<string, boolean>): string {
  return '/refresh';
}

export function reviseRoute(_flags?: Record<string, boolean>): string {
  return '/refresh?tab=chapters';
}

export function studyPlanRoute(_flags?: Record<string, boolean>): string {
  return '/exam-prep';
}
