import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { logger } from '@alfanumrik/lib/logger';

/**
 * GET /api/super-admin/oracle-health
 *
 * Oracle health time-series for the super-admin observability panel
 * (Marking-Authenticity Phase 6.18, Panel 2). Proxies the PostHog Insights
 * HogQL API server-side so the PostHog Personal API Key never reaches a
 * browser.
 *
 * Auth: `super_admin.access` — same permission code used by every other
 * super-admin route. No new RBAC permission introduced.
 *
 * Why server-side proxy?
 *   The PostHog Personal API Key has read access to every event in the
 *   project. It MUST never be exposed to a browser (P13 + general secrets
 *   hygiene). We therefore call PostHog from the Vercel Node runtime with
 *   the key from `process.env.POSTHOG_PERSONAL_API_KEY` and return only the
 *   aggregated rows.
 *
 * Caching
 *   - Route-level: `revalidate = 300` so Vercel can cache the rendered JSON
 *     for 5 minutes between identical query strings (this endpoint takes no
 *     query params today).
 *   - In-process: a tiny LRU keyed by the 5-minute time-window bucket.
 *     Protects against burst traffic if the operator dashboard polls
 *     aggressively or several admins land on the page simultaneously. Cache
 *     entries are pure aggregates — no PII.
 *
 * Failure modes
 *   - Env unset → 503 `posthog_not_configured`. Ops needs to set the env var.
 *   - PostHog 4xx/5xx → 502 with the upstream status code only. Upstream
 *     body is intentionally NOT echoed — could leak.
 *   - PostHog timeout / network error → 502 `posthog_unreachable`.
 *
 * Alert rule
 *   `alert = true` if any hour bucket has reject_rate > 0.20 (20%). Surfaces
 *   regression in the oracle gate (legitimate questions being rejected).
 */

export const runtime = 'nodejs';
export const revalidate = 300;

const POSTHOG_PROJECT_ID = '159341'; // "Default project" — see CLAUDE.md MCP block
const REJECT_RATE_ALERT_THRESHOLD = 0.2; // 20%
const TIME_WINDOW_BUCKET_MS = 5 * 60 * 1000; // 5 min — same as `revalidate`
const UPSTREAM_TIMEOUT_MS = 10_000; // PostHog HogQL is usually <2s, give it slack
const LRU_MAX_ENTRIES = 16; // cheap upper bound

interface HourlyRow {
  hour: string;
  reject_rate: number;
  ambiguous_rate: number;
  total_events: number;
}

interface ResponsePayload {
  hourly: HourlyRow[];
  alert: boolean;
  alert_reason: string | null;
  cached: boolean;
  cached_at: string | null;
}

// ─── In-process LRU keyed by 5-minute bucket ───────────────────────────────
// We key by `Math.floor(now / TIME_WINDOW_BUCKET_MS)` so each instance keeps
// at most one entry per 5-minute bucket. This is purely defence-in-depth
// against a thundering-herd; Vercel ISR is the primary cache.

interface CacheEntry {
  payload: Omit<ResponsePayload, 'cached' | 'cached_at'>;
  cachedAt: number;
}

const _cache = new Map<number, CacheEntry>();

function cacheGet(bucket: number): CacheEntry | null {
  const e = _cache.get(bucket);
  return e ?? null;
}

function cacheSet(bucket: number, entry: CacheEntry): void {
  _cache.set(bucket, entry);
  if (_cache.size > LRU_MAX_ENTRIES) {
    // Evict oldest (Map preserves insertion order).
    const firstKey = _cache.keys().next().value;
    if (firstKey !== undefined) _cache.delete(firstKey);
  }
}

// ─── HogQL query (last 7 days, hourly bucketed) ────────────────────────────
//
// Note: we count both events in the denominator for both rates, but the
// "ambiguous_rate" denominator semantically should be "evaluations" only.
// The runbook spec uses `count()` so we honour that — the frontend can
// re-derive a tighter ratio if it wants, since `total_events` is exposed.

const HOGQL_QUERY = `
SELECT
  toStartOfHour(timestamp) AS hour,
  countIf(event = 'foxy_oracle_blocked') / nullIf(countIf(event IN ('foxy_practice_question_emitted', 'foxy_oracle_blocked')), 0) AS reject_rate,
  countIf(event = 'foxy_oracle_blocked' AND properties.verdict = 'AMBIGUOUS') / nullIf(count(), 0) AS ambiguous_rate,
  count() AS total_events
FROM events
WHERE event IN ('foxy_oracle_blocked', 'foxy_practice_question_emitted')
  AND timestamp > now() - interval 7 day
GROUP BY hour
ORDER BY hour DESC
`.trim();

interface PostHogQueryResponse {
  results?: unknown[][];
  columns?: string[];
}

function getPostHogHost(): string {
  const raw =
    process.env.POSTHOG_HOST ||
    process.env.NEXT_PUBLIC_POSTHOG_HOST ||
    'https://us.posthog.com';
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
  if (v instanceof Date) return v.toISOString();
  if (v == null) return '';
  return String(v);
}

async function fetchOracleHealthFromPostHog(): Promise<
  Omit<ResponsePayload, 'cached' | 'cached_at'>
> {
  const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;
  // Caller already checked, but defensive: never make a fetch without a key.
  if (!apiKey) {
    throw new PostHogError(503, 'posthog_not_configured');
  }

  const host = getPostHogHost();
  const url = `${host}/api/projects/${POSTHOG_PROJECT_ID}/query/`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);

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
      signal: ctrl.signal,
    });
  } catch (err) {
    // Log without the key. Logger redacts standard PII keys; we never put
    // the key into the message.
    logger.warn('oracle_health.posthog_unreachable', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw new PostHogError(502, 'posthog_unreachable');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // Drain body so the connection can be reused, but DO NOT echo it —
    // PostHog error bodies have been observed to include the request URL
    // and other context that we don't want round-tripping.
    void res.text().catch(() => {});
    logger.warn('oracle_health.posthog_upstream_error', {
      status: res.status,
    });
    throw new PostHogError(502, 'posthog_upstream_error', {
      upstream_status: res.status,
    });
  }

  let body: PostHogQueryResponse;
  try {
    body = (await res.json()) as PostHogQueryResponse;
  } catch (err) {
    logger.warn('oracle_health.posthog_parse_error', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw new PostHogError(502, 'posthog_parse_error');
  }

  const rows = Array.isArray(body.results) ? body.results : [];
  const columns = Array.isArray(body.columns) ? body.columns : [];

  // Defensive column-name lookup — PostHog occasionally reorders.
  const idx = (name: string): number => columns.indexOf(name);
  const hourIdx = idx('hour');
  const rejectIdx = idx('reject_rate');
  const ambIdx = idx('ambiguous_rate');
  const totalIdx = idx('total_events');

  const hourly: HourlyRow[] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    // If columns weren't returned, fall back to positional ordering matching
    // the SELECT list above.
    const get = (named: number, positional: number): unknown =>
      named >= 0 ? row[named] : row[positional];
    hourly.push({
      hour: safeString(get(hourIdx, 0)),
      reject_rate: safeNumber(get(rejectIdx, 1)),
      ambiguous_rate: safeNumber(get(ambIdx, 2)),
      total_events: Math.floor(safeNumber(get(totalIdx, 3))),
    });
  }

  // ── Alert rule ────────────────────────────────────────────────────────
  let alert = false;
  let alert_reason: string | null = null;
  for (const h of hourly) {
    if (h.total_events > 0 && h.reject_rate > REJECT_RATE_ALERT_THRESHOLD) {
      alert = true;
      alert_reason = `reject_rate ${(h.reject_rate * 100).toFixed(1)}% exceeded threshold ${(REJECT_RATE_ALERT_THRESHOLD * 100).toFixed(0)}% in hour ${h.hour}`;
      break;
    }
  }

  return { hourly, alert, alert_reason };
}

class PostHogError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: string,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = 'PostHogError';
  }
}

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'super_admin.access');
  if (!auth.authorized) return auth.errorResponse!;

  const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'posthog_not_configured' },
      { status: 503 },
    );
  }

  const nowMs = Date.now();
  const bucket = Math.floor(nowMs / TIME_WINDOW_BUCKET_MS);
  const cached = cacheGet(bucket);

  if (cached) {
    const payload: ResponsePayload = {
      ...cached.payload,
      cached: true,
      cached_at: new Date(cached.cachedAt).toISOString(),
    };
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'private, max-age=0, s-maxage=300',
      },
    });
  }

  try {
    const fresh = await fetchOracleHealthFromPostHog();
    cacheSet(bucket, { payload: fresh, cachedAt: nowMs });
    const payload: ResponsePayload = {
      ...fresh,
      cached: false,
      cached_at: null,
    };
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'private, max-age=0, s-maxage=300',
      },
    });
  } catch (err) {
    if (err instanceof PostHogError) {
      // 503 if config issue, 502 if upstream issue. Echo only the status
      // code from upstream — never the body.
      return NextResponse.json(
        { error: err.code, ...err.extra },
        { status: err.httpStatus },
      );
    }
    logger.warn('oracle_health.unexpected', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: 'internal_error' },
      { status: 500 },
    );
  }
}
