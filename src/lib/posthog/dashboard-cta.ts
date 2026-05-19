/**
 * Typed wrapper for the `dashboard_cta_clicked` PostHog event.
 *
 * Why a wrapper (not raw `track()` at the call site)?
 *   - The compiler forces every call to pass a valid `section` literal,
 *     so a typo at a brand-new section component becomes a build error
 *     instead of silently splitting funnels in PostHog.
 *   - Caps `destination` to 256 chars before emit — defence against a
 *     buggy caller passing the entire URL with a giant query string.
 *   - Strips any extra properties at the type level — `Pick<>`-shaped so
 *     callers physically cannot pass PII fields.
 *
 * Privacy posture (P13):
 *   The function signature is `Pick<DashboardCtaClickedPayload, ...>`.
 *   A caller cannot pass `email`, `phone`, `student_name`, etc. — those
 *   keys are not in the type. This is layer-1 privacy enforcement;
 *   `redactPII` in src/lib/posthog/server.ts and the
 *   `mask_all_text`/`mask_all_element_attributes` options in
 *   src/lib/posthog/client.ts are defence-in-depth.
 *
 * Bundle: this file is < 1 kB minified. It imports nothing beyond
 * `track` (already on the dashboard payload via PostHogProvider) and a
 * type-only import. No runtime cost beyond the function call.
 */

import { track } from './client';
import type { DashboardCtaClickedPayload } from './types';

/** Hard cap on `destination` length so a runaway query string can't bloat events. */
const DESTINATION_MAX = 256;

/**
 * Fire a `dashboard_cta_clicked` event from any of the seven dashboard
 * section components. Type-safe, PII-free by construction.
 *
 *   trackDashboardCta({
 *     section: 'above_fold_hero',
 *     action: 'primary_cta',
 *     destination: '/quiz',
 *   });
 *
 * The function is fire-and-forget — never awaits, never throws, no-ops
 * silently when PostHog is disabled.
 */
export function trackDashboardCta(
  payload: Pick<DashboardCtaClickedPayload, 'section' | 'action' | 'destination'>,
): void {
  // Hard-cap the destination string. Use a defensive String() coerce in
  // case a caller passes a non-string (TS would catch this at compile time,
  // but runtime data flows can still feed odd shapes via dynamic routes).
  const destination =
    typeof payload.destination === 'string'
      ? payload.destination.slice(0, DESTINATION_MAX)
      : String(payload.destination ?? '').slice(0, DESTINATION_MAX);

  track('dashboard_cta_clicked', {
    section: payload.section,
    action: payload.action,
    destination,
  });
}

/** Public constant — exported so the regression test can assert against it. */
export const DASHBOARD_CTA_DESTINATION_MAX = DESTINATION_MAX;
