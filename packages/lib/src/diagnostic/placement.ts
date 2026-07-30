/**
 * ALFANUMRIK — Diagnostic placement boundaries (PURE, dependency-free leaf).
 *
 * §7.5a/§7.5b of
 * `docs/superpowers/specs/2026-07-29-diagnostic-cold-start-correctness.md`.
 *
 * WHY this is its own module and not a route export:
 *   Next.js 16 App Router route modules may export ONLY the HTTP handlers plus
 *   the fixed segment-config keys (`dynamic`, `revalidate`, `runtime`, …). A
 *   non-handler `export const` on a `route.ts` fails `next build` with
 *   "not assignable to type 'never'". These numbers had been exported from
 *   `/api/diagnostic/complete/route.ts` purely so a test could import them,
 *   which made the route module unbuildable. They live here instead.
 *
 * WHY dependency-free:
 *   The SERVER route and the CLIENT results screen
 *   (`apps/host/src/app/diagnostic/copy.ts` → `page.tsx`) must read the SAME
 *   two numbers. `blueprint.ts` in this directory pulls in `quiz-assembler`,
 *   which is far too heavy for a client bundle (P10). This leaf imports
 *   NOTHING, so both sides can share it at zero bundle cost.
 *
 * Boundaries were recalibrated from 40/70 to 50/80 when the 5/6/4 blueprint
 * landed: the blueprint moves an average student's expected score from ~95% to
 * ~65%, so the old cuts placed nearly everyone at 'hard'. Derived by assessment
 * from the spec's expected-score curve (50% ↔ θ≈−0.85, 80% ↔ θ≈+0.95).
 * Do not change without an assessment review.
 *
 * `mobile/lib/ui/screens/diagnostic/diagnostic_screen.dart` keeps a hand-copied
 * transcription of these same two numbers (Dart cannot import TypeScript). It
 * uses them ONLY to pick an encouragement emoji/colour — the score and the
 * recommendation itself are the server's values verbatim (P1). If these numbers
 * move, tell the mobile agent.
 */

/**
 * Score-percent cuts for `recommended_difficulty`:
 *   score < medium            → 'easy'
 *   medium <= score < hard    → 'medium'
 *   score >= hard             → 'hard'
 */
export const DIAGNOSTIC_PLACEMENT_THRESHOLDS = { medium: 50, hard: 80 } as const;
