/**
 * Sentry admin-side events query (Phase E.6 follow-up).
 *
 * Server-only helper that powers the `errors_24h` column on
 * `/super-admin/health`. Calls Sentry's organization events API,
 * filtered by the `school_id` tag that `setSentrySchoolContext()` in
 * `src/lib/sentry/school-context.ts` attaches per request (shipped in
 * PR #811), and groups results by school.
 *
 * ─── Failure modes (degraded paths) ───────────────────────────────
 *
 * This is observability glue — it must NEVER throw or crash the
 * caller. Every recoverable error returns `{ ok: false, reason }` and
 * the caller (the super-admin BFF) falls back to rendering `'—'` plus
 * an operator-facing banner that names the reason.
 *
 *   - no_token    → Any of SENTRY_AUTH_TOKEN / SENTRY_ORG_SLUG /
 *                   SENTRY_PROJECT_SLUG missing. Most local dev hits
 *                   this path. We log `sentry_admin_query_degraded`
 *                   at INFO exactly once per call (not per school).
 *   - http_error  → Sentry returned a non-2xx (likely 401/403 stale
 *                   token, 429 rate-limit, or 5xx).
 *   - timeout     → AbortController fired at 10s. Sentry's events
 *                   endpoint can be slow when org-wide.
 *   - parse_error → Response body wasn't the shape we expected.
 *                   Most likely cause: Sentry API contract drift.
 *
 * ─── ADR-005 compliance ───────────────────────────────────────────
 *
 * Pure read-only BFF helper. Zero state-event writes. No imports of
 * `@/lib/state/events/registry` or `@/lib/state/journey/journey`.
 *
 * ─── Sentry API reference ─────────────────────────────────────────
 *
 *   GET https://sentry.io/api/0/organizations/{org_slug}/events/
 *
 *   Documented at https://docs.sentry.io/api/discover/query-discover-events/
 *
 * We use the "Discover events" shape with a `groupBy`-like field set:
 *   field=tags[school_id]      ← grouping key surfaces in each row
 *   field=count()              ← per-group event count
 *   query=event.type:error tags[school_id]:[<id1>,<id2>,...]
 *   statsPeriod=24h
 *   project=<numeric or slug>  (Sentry accepts the project SLUG via
 *                              `project=<slug>` — see SENTRY_PROJECT_SLUG)
 *
 * The `tags[school_id]:[v1,v2]` list filter is Sentry's standard
 * "in-set" syntax for tag-value filtering. Empty matches return
 * an empty `data` array rather than a 4xx.
 */

import { logger } from '@/lib/logger';

/** Map of school_id → 24h error count; `ok=false` means degraded. */
export interface SentryEventCountResult {
  /** Map of school_id -> error count for the last 24h. Missing keys mean zero. */
  counts: Map<string, number>;
  /** True when Sentry was queried successfully; false when degraded. */
  ok: boolean;
  /** When ok=false, a short reason string for the UI/log. */
  reason?: 'no_token' | 'http_error' | 'timeout' | 'parse_error';
}

/** Sentry events API timeout — generous because org-wide queries can be slow. */
const SENTRY_FETCH_TIMEOUT_MS = 10_000;

/**
 * Discover-events row shape we expect when grouping by `tags[school_id]`.
 *
 * Sentry's response wraps rows in `{ data: [...] }`. Each row keys the
 * grouping field by the literal string `'tags[school_id]'` and the
 * count by `'count()'`. We narrow to `unknown` at the parse boundary
 * and validate row-by-row to survive contract drift.
 */
interface SentryDiscoverRow {
  'tags[school_id]'?: unknown;
  'count()'?: unknown;
}

interface SentryDiscoverResponse {
  data?: unknown;
}

/**
 * Fetch per-school error counts from Sentry for the last 24h.
 *
 * @param schoolIds  School UUIDs to scope the query to. Empty array
 *   short-circuits to `{ ok: true, counts: new Map() }` — no point
 *   round-tripping Sentry for zero schools.
 *
 * @returns A `SentryEventCountResult`. Never throws. When the env
 *   vars are missing the result is `{ ok: false, reason: 'no_token' }`.
 *   The caller is expected to render `'—'` for any school whose id
 *   isn't a key in `counts` (the schools-with-zero-errors case looks
 *   the same as the schools-Sentry-doesn't-know-about case; both are
 *   correctly displayed as `0`).
 */
export async function fetchSentryEventCountsBySchool(
  schoolIds: string[],
): Promise<SentryEventCountResult> {
  // Empty input is a happy-path no-op: don't burn a Sentry quota slot.
  if (schoolIds.length === 0) {
    return { counts: new Map(), ok: true };
  }

  const token = process.env.SENTRY_AUTH_TOKEN;
  const orgSlug = process.env.SENTRY_ORG_SLUG;
  const projectSlug = process.env.SENTRY_PROJECT_SLUG;

  // ── Degraded: missing config ────────────────────────────────────
  //
  // Local dev and most preview deploys land here. We log at INFO
  // (not WARN) because the UI degrades gracefully and operators
  // already see a banner. WARN/ERROR would be noisy and crying-wolf.
  if (!token || !orgSlug || !projectSlug) {
    logger.info('sentry_admin_query_degraded', {
      reason: 'no_token',
      has_token: Boolean(token),
      has_org_slug: Boolean(orgSlug),
      has_project_slug: Boolean(projectSlug),
    });
    return { counts: new Map(), ok: false, reason: 'no_token' };
  }

  // ── Build the Discover query ────────────────────────────────────
  //
  // Sentry's tag in-set syntax: `tags[k]:[v1,v2]` — note that
  // Sentry's parser does NOT want quotes around UUIDs (UUIDs have
  // no spaces or special chars). We URL-encode the whole `query`
  // param via URLSearchParams.
  const tagFilter = `tags[school_id]:[${schoolIds.join(',')}]`;
  const params = new URLSearchParams();
  params.set('query', `event.type:error ${tagFilter}`);
  params.append('field', 'tags[school_id]');
  params.append('field', 'count()');
  params.set('statsPeriod', '24h');
  params.set('project', projectSlug);
  params.set('per_page', '100');

  const url = `https://sentry.io/api/0/organizations/${encodeURIComponent(
    orgSlug,
  )}/events/?${params.toString()}`;

  // ── Fire, with timeout ──────────────────────────────────────────
  const controller = new AbortController();
  const timeoutHandle = setTimeout(
    () => controller.abort(),
    SENTRY_FETCH_TIMEOUT_MS,
  );

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutHandle);
    // AbortController.abort() rejects the fetch with a DOMException
    // whose name is 'AbortError'. Anything else is also a network
    // failure but we report it under the same operator-facing bucket
    // because the remediation (retry on next refresh) is identical.
    const aborted = err instanceof Error && err.name === 'AbortError';
    logger.warn('sentry_admin_query_failed', {
      reason: aborted ? 'timeout' : 'http_error',
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      counts: new Map(),
      ok: false,
      reason: aborted ? 'timeout' : 'http_error',
    };
  }
  clearTimeout(timeoutHandle);

  // ── HTTP error ──────────────────────────────────────────────────
  if (!res.ok) {
    logger.warn('sentry_admin_query_failed', {
      reason: 'http_error',
      status: res.status,
    });
    return { counts: new Map(), ok: false, reason: 'http_error' };
  }

  // ── Parse + validate ────────────────────────────────────────────
  let parsed: SentryDiscoverResponse;
  try {
    parsed = (await res.json()) as SentryDiscoverResponse;
  } catch (err) {
    logger.warn('sentry_admin_query_failed', {
      reason: 'parse_error',
      error: err instanceof Error ? err.message : String(err),
    });
    return { counts: new Map(), ok: false, reason: 'parse_error' };
  }

  if (!Array.isArray(parsed.data)) {
    logger.warn('sentry_admin_query_failed', {
      reason: 'parse_error',
      detail: 'data_not_array',
    });
    return { counts: new Map(), ok: false, reason: 'parse_error' };
  }

  const counts = new Map<string, number>();
  for (const raw of parsed.data) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as SentryDiscoverRow;
    const schoolId = row['tags[school_id]'];
    const count = row['count()'];
    // Defensive: Sentry occasionally returns the grouping value as a
    // bare number or null when a row's tag is missing. We only count
    // rows that actually identify a school.
    if (typeof schoolId !== 'string' || schoolId.length === 0) continue;
    const numericCount =
      typeof count === 'number'
        ? count
        : typeof count === 'string'
          ? Number(count)
          : NaN;
    if (!Number.isFinite(numericCount)) continue;
    counts.set(schoolId, (counts.get(schoolId) ?? 0) + numericCount);
  }

  return { counts, ok: true };
}
