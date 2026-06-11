/**
 * Shared types and helpers for the GET /api/learner/revise-stack route and
 * its tests.
 *
 * Extracted out of the route file because Next.js 16 forbids route files from
 * exporting anything other than HTTP handlers (GET/POST/...) and route config
 * (`dynamic`, `revalidate`, ...). The route imports `modalityForMastery`,
 * `ReviseStackItem`, and `ReviseStackResponse` from here; the route's test
 * imports `modalityForMastery` from here too.
 *
 * NOTE: resolve-next-action.ts keeps its OWN private (non-exported)
 * `modalityForMastery` copy with identical 0.85 / 0.70 thresholds. That one is
 * assessment-owned and intentionally left untouched; a future DRY pass could
 * collapse the two into this single source.
 */

export interface ReviseStackItem {
  subjectCode: string;
  chapterNumber: number;
  mastery: number;
  daysSinceLastTouch: number;
  recommendedModality: 'read' | 'explainer' | 'worked-example';
  url: string;
}

export interface ReviseStackResponse {
  schemaVersion: 1;
  resolvedAt: string;
  items: ReviseStackItem[];
}

/** Modality picker — same thresholds as the resolver's single-action
 *  decision in resolve-next-action.ts. */
export function modalityForMastery(
  mastery: number,
): 'read' | 'explainer' | 'worked-example' {
  if (mastery >= 0.85) return 'worked-example';
  if (mastery >= 0.7) return 'explainer';
  return 'read';
}
