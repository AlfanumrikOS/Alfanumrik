/**
 * Sentry per-request school-context tagging.
 *
 * Tags the current Sentry scope with `school_id`, `school_slug`, and
 * `school_plan` from the resolved tenant context. Operators can then
 * filter Sentry events in the UI by `school_id:<uuid>` to triage
 * per-tenant errors, and a future Sentry API integration in the
 * super-admin health dashboard (Phase E.6 follow-up) can count
 * errors_24h per school.
 *
 * Sentry scopes in Next.js are request-scoped by default — each
 * incoming request gets a fresh scope, so tags don't leak across
 * requests. Calling this multiple times in a request is idempotent.
 *
 * Safe across all runtimes:
 *   - Edge (proxy.ts)         ✓
 *   - Node (API routes)        ✓
 *   - Browser (client)         ✓ — typically only server-side calls it
 *
 * If Sentry isn't initialized (no DSN), `setTag` is a no-op.
 */

import * as Sentry from '@sentry/nextjs';
import type { TenantContext } from '@alfanumrik/lib/types';

/**
 * Tag the current Sentry scope with school context from a resolved
 * tenant. When ctx has no schoolId we leave the scope untouched —
 * each request gets a fresh scope anyway, so nothing to clear.
 *
 * Wrapped in try/catch so a Sentry library error never breaks the
 * caller — this is request-path code on every tenant-aware API route.
 */
export function setSentrySchoolContext(ctx: TenantContext): void {
  try {
    if (!ctx.schoolId) return;
    Sentry.setTag('school_id', ctx.schoolId);
    if (ctx.schoolSlug) Sentry.setTag('school_slug', ctx.schoolSlug);
    if (ctx.plan) Sentry.setTag('school_plan', ctx.plan);
  } catch {
    // Best-effort observability — a Sentry library failure must not
    // cascade into 500s on the request path.
  }
}
