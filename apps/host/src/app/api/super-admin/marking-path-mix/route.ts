import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { logger } from '@alfanumrik/lib/logger';

/**
 * GET /api/super-admin/marking-path-mix
 *
 * Marking-Authenticity Item 6 — replaces the "Coming soon" placeholder on
 * `/super-admin/learning`. Proxies a PostHog HogQL query that buckets the
 * last 7 days of `quiz_graded` events by `properties.marking_path` and
 * returns the cutover-progress mix so operators can see at a glance how
 * close we are to the 100%-on-`oracle_v2` target.
 *
 * Why a server-side proxy?
 *   The PostHog Personal API Key has read access to every event in the
 *   project. It MUST never reach a browser (P13 + general secrets
 *   hygiene). We therefore call PostHog from the Vercel Node runtime
 *   with the key from `process.env.POSTHOG_API_KEY` and return only the
 *   per-path aggregate. No PII flows through this endpoint.
 *
 * ─── Failure modes (graceful degradation) ───────────────────────────
 *
 * This is observability glue — it must NEVER throw or crash the caller.
 * Every recoverable error returns `{ ok: false, reason, mix: null }`
 * with HTTP 200 so the frontend can render an operator-facing banner
 * (mirrors the `errors_24h_degraded` pattern from /super-admin/health
 * shipped in Phase E.6). Reasons:
 *
 *   - no_token    → Any of POSTHOG_API_KEY / POSTHOG_HOST /
 *                   POSTHOG_PROJECT_ID missing. Local dev hits this.
 *                   Logged at INFO once per request (not WARN — UI
 *                   already degrades visibly and ops sees a banner).
 *   - http_error  → PostHog returned a non-2xx (likely 401/403 stale
 *                   key, 429 rate-limit, or 5xx). Body is NOT echoed —
 *                   PostHog error bodies have been seen to include
 *                   request URLs we don't want round-tripping.
 *   - timeout     → AbortController fired at 10s. HogQL is usually
 *                   sub-2s but org-wide scans can spike.
 *   - parse_error → Response body wasn't the shape we expected. Most
 *                   likely cause: PostHog API contract drift.
 *
 * Auth: `super_admin.access` — same permission code used by every
 * other super-admin route. No new RBAC permission introduced.
 *
 * Caching
 *   - Route-level: `revalidate = 300` so Vercel can cache the rendered
 *     JSON for 5 minutes between identical query strings.
 *   - Cache-Control: `s-maxage=300` so CDN intermediaries respect the
 *     same 5-minute freshness. Multiple operator refreshes don't hammer
 *     PostHog.
 *
 * ─── ADR-005 compliance ─────────────────────────────────────────────
 *
 * Pure read-only BFF endpoint. Zero state-event writes. No imports of
 * `@alfanumrik/lib/state/events/registry` or `@alfanumrik/lib/state/journey/journey`. The
 * data source (PostHog) is upstream of the spine; we project from it,
 * we never write to it.
 */

export const runtime = 'nodejs';
export const revalidate = 300;

// ─── Constants ──────────────────────────────────────────────────────

/** PostHog HogQL is usually <2s; give it slack for org-wide windows. */
const UPSTREAM_TIMEOUT_MS = 10_000;

/** Time window for the mix aggregate. 7d matches the runbook target. */
const WINDOW_DAYS = 7;

/**
 * HogQL query. Counts `quiz_graded` events grouped by the
 * `marking_path` property over the last 7 days, ordered desc by count
 * so the dominant path lands at the top. Paths we expect to see:
 *
 *   - oracle_v2          (target: 100%)
 *   - oracle_v1_legacy   (deprecation in flight)
 *   - client_fallback    (deprecation in flight)
 *   - foxy_freetext      (deprecation in flight)
 *
 * Anything else lands in an "unknown" bucket via the COALESCE so we
 * still surface forward-compat traffic.
 */
const HOGQL_QUERY = `
SELECT
  coalesce(properties.marking_path, 'unknown') AS path,
  count() AS n
FROM events
WHERE event = 'quiz_graded'
  AND timestamp > now() - interval ${WINDOW_DAYS} day
GROUP BY path
ORDER BY n DESC
`.trim();

// ─── Types ──────────────────────────────────────────────────────────

export interface MarkingPathMixRow {
  path: string;
  count: number;
  percent: number;
}

export type MarkingPathMixReason =
  | 'no_token'
  | 'http_error'
  | 'timeout'
  | 'parse_error';

export interface MarkingPathMixResponse {
  ok: boolean;
  mix: MarkingPathMixRow[] | null;
  window_days: number;
  fetched_at: string;
  reason?: MarkingPathMixReason;
}

interface PostHogQueryResponse {
  results?: unknown[][];
  columns?: string[];
}

// ─── Helpers ────────────────────────────────────────────────────────

function getPostHogHost(): string {
  const raw =
    process.env.POSTHOG_HOST ||
    process.env.NEXT_PUBLIC_POSTHOG_HOST ||
    'https://app.posthog.com';
  // Strip trailing slash so URL composition is stable.
  return raw.replace(/\/+$/, '');
}

function safeNumber(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function safeString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v == null) return 'unknown';
  return String(v);
}

/** Build a degraded response. Centralised so the shape never drifts. */
function degraded(
  reason: MarkingPathMixReason,
): MarkingPathMixResponse {
  return {
    ok: false,
    mix: null,
    window_days: WINDOW_DAYS,
    fetched_at: new Date().toISOString(),
    reason,
  };
}

// ─── PostHog fetch ──────────────────────────────────────────────────

async function fetchMarkingPathMixFromPostHog(): Promise<MarkingPathMixResponse> {
  const apiKey = process.env.POSTHOG_API_KEY;
  const projectId = process.env.POSTHOG_PROJECT_ID;
  // POSTHOG_HOST is technically optional (we default to app.posthog.com),
  // but the task spec lists it as required for "configured" — so we
  // treat missing host as a no_token case to keep ops in control.
  const hostEnv = process.env.POSTHOG_HOST;

  if (!apiKey || !projectId || !hostEnv) {
    // INFO not WARN: this is the expected dev/preview state, not an
    // incident. The UI degrades visibly with an operator banner.
    logger.info('marking_path_mix.posthog_not_configured', {
      reason: 'no_token',
      has_api_key: Boolean(apiKey),
      has_host: Boolean(hostEnv),
      has_project_id: Boolean(projectId),
    });
    return degraded('no_token');
  }

  const host = getPostHogHost();
  const url = `${host}/api/projects/${encodeURIComponent(projectId)}/query/`;

  // ── Fire, with timeout ──────────────────────────────────────────
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query: { kind: 'HogQLQuery', query: HOGQL_QUERY },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    // AbortController.abort() rejects fetch with an error whose .name
    // is 'AbortError'. Network failures and DNS errors land in the
    // generic http_error bucket — same remediation (retry next poll).
    const aborted = err instanceof Error && err.name === 'AbortError';
    logger.warn('marking_path_mix.posthog_fetch_failed', {
      reason: aborted ? 'timeout' : 'http_error',
      error: err instanceof Error ? err.message : String(err),
    });
    return degraded(aborted ? 'timeout' : 'http_error');
  }
  clearTimeout(timer);

  // ── HTTP error ──────────────────────────────────────────────────
  if (!res.ok) {
    // Drain body so the connection can be reused, but DO NOT echo it.
    void res.text().catch(() => {});
    logger.warn('marking_path_mix.posthog_upstream_error', {
      reason: 'http_error',
      status: res.status,
    });
    return degraded('http_error');
  }

  // ── Parse + validate ────────────────────────────────────────────
  let parsed: PostHogQueryResponse;
  try {
    parsed = (await res.json()) as PostHogQueryResponse;
  } catch (err) {
    logger.warn('marking_path_mix.posthog_parse_error', {
      reason: 'parse_error',
      error: err instanceof Error ? err.message : String(err),
    });
    return degraded('parse_error');
  }

  if (!Array.isArray(parsed.results)) {
    logger.warn('marking_path_mix.posthog_parse_error', {
      reason: 'parse_error',
      detail: 'results_not_array',
    });
    return degraded('parse_error');
  }

  // ── Build per-path counts ───────────────────────────────────────
  const columns = Array.isArray(parsed.columns) ? parsed.columns : [];
  const pathIdx = columns.indexOf('path');
  const countIdx = columns.indexOf('n');

  interface Bucket {
    path: string;
    count: number;
  }
  const buckets: Bucket[] = [];
  let total = 0;
  for (const row of parsed.results) {
    if (!Array.isArray(row)) continue;
    // Fall back to positional indices if columns weren't returned.
    const rawPath = pathIdx >= 0 ? row[pathIdx] : row[0];
    const rawCount = countIdx >= 0 ? row[countIdx] : row[1];
    const path = safeString(rawPath);
    const count = Math.max(0, Math.floor(safeNumber(rawCount)));
    if (count <= 0) continue;
    buckets.push({ path, count });
    total += count;
  }

  // ── Compute percentages ─────────────────────────────────────────
  // Two-pass: compute floor-rounded percentages, then route the
  // rounding remainder to the largest bucket so the column sums to
  // exactly 100 (operators get cranky when "all paths" reads "99.9%").
  let mix: MarkingPathMixRow[] = [];
  if (total > 0) {
    mix = buckets.map((b) => ({
      path: b.path,
      count: b.count,
      // Two decimal places — round half-up to limit drift, then we
      // patch the largest row below to make the column sum to 100.
      percent: Math.round((b.count / total) * 10_000) / 100,
    }));
    const sum = mix.reduce((s, r) => s + r.percent, 0);
    if (mix.length > 0 && sum !== 100) {
      // Adjust the largest bucket by the residual. Residual is tiny
      // (at most a few hundredths) so this won't hide signal.
      let largestIdx = 0;
      for (let i = 1; i < mix.length; i++) {
        if (mix[i].count > mix[largestIdx].count) largestIdx = i;
      }
      mix[largestIdx] = {
        ...mix[largestIdx],
        percent: Math.round((mix[largestIdx].percent + (100 - sum)) * 100) / 100,
      };
    }
  }

  return {
    ok: true,
    mix,
    window_days: WINDOW_DAYS,
    fetched_at: new Date().toISOString(),
  };
}

// ─── Route handler ──────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'super_admin.access');
  if (!auth.authorized) return auth.errorResponse!;

  const payload = await fetchMarkingPathMixFromPostHog();
  return NextResponse.json(payload, {
    headers: {
      // 5 min CDN cache so dashboard refreshes don't hammer PostHog.
      // `private` keeps it off shared caches; `s-maxage` lets Vercel
      // edge cache it for 5 minutes per-route.
      'Cache-Control': 'private, max-age=0, s-maxage=300',
    },
  });
}
