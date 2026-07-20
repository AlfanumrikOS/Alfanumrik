import { redirect } from 'next/navigation';

/**
 * Redirect stub — Phase 3 super-admin IA repair (2026-07-20).
 *
 * /super-admin/alerts and /super-admin/observability/rules were BOTH titled
 * "Alert Rules". The observability page is the canonical one in the 7-section
 * IA (System Health → Alert Rules), so this route redirects there. It keeps a
 * redirect (instead of being deleted like the other stubs) because it WAS in
 * the pre-Phase-3 nav and may be bookmarked by operators.
 *
 * NOTE (flagged for ops review): the page removed here was not a pure title
 * duplicate — it was a school-scoped alert-rule CRUD UI over the separate
 * /api/super-admin/alerts API (rule types: error_rate, engagement_drop,
 * payment_failure, ai_budget, seat_limit). That API now has no UI surface.
 * The full page implementation is recoverable from git history at
 * apps/host/src/app/super-admin/alerts/page.tsx (pre-2026-07-20).
 */
export default function SuperAlertsPage() {
  redirect('/super-admin/observability/rules');
}
