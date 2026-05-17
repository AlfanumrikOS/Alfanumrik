/**
 * Phase H.5 (Super-Admin Production-Readiness Plan, 2026-05-17)
 *
 * GET /api/super-admin/analytics/posthog-summary
 *
 * Server-side proxy for PostHog HogQL analytics, complementing the existing
 * /api/super-admin/analytics route (which counts DB rows). The Supabase
 * counts answer "how many quizzes were submitted last 7 days"; this route
 * answers product-analytics questions: who came back, what they did, where
 * the funnel leaks.
 *
 * Same pattern as oracle-health (POSTHOG_PERSONAL_API_KEY stays server-side,
 * 5-minute in-process LRU on top of Vercel ISR, structured 502/503 errors
 * for degradation paths).
 *
 * Response shape:
 *   {
 *     dau_7d:        [{ date: 'YYYY-MM-DD', users: N }, ...],
 *     wau_4w:        [{ week_start: 'YYYY-MM-DD', users: N }, ...],
 *     mau_30d:       N,
 *     top_events_24h:[{ event: 'foxy_message_sent', count: N }, ...],
 *     cached: bool,
 *     cached_at: ISO | null
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin } from '@/lib/admin-auth';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const revalidate = 300;

const POSTHOG_PROJECT_ID = '159341';
const TIME_WINDOW_BUCKET_MS = 5 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 10_000;
const LRU_MAX_ENTRIES = 8;

interface DauRow { date: string; users: number }
interface WauRow { week_start: string; users: number }
interface TopEventRow { event: string; count: number }

interface AnalyticsSummary {
  dau_7d: DauRow[];
  wau_4w: WauRow[];
  mau_30d: number;
  top_events_24h: TopEventRow[];
}

interface ResponsePayload extends AnalyticsSummary {
  cached: boolean;
  cached_at: string | null;
}

interface CacheEntry { payload: AnalyticsSummary; cachedAt: number }
const _cache = new Map<number, CacheEntry>();

function cacheGet(bucket: number): CacheEntry | null {
  return _cache.get(bucket) ?? null;
}
function cacheSet(bucket: number, entry: CacheEntry): void {
  _cache.set(bucket, entry);
  if (_cache.size > LRU_MAX_ENTRIES) {
    const firstKey = _cache.keys().next().value;
    if (firstKey !== undefined) _cache.delete(firstKey);
  }
}

function getPostHogHost(): string {
  const raw = process.env.POSTHOG_HOST || process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.posthog.com';
  return raw.replace(/\/+$/, '');
}

function safeNumber(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') { const n = Number(v); if (Number.isFinite(n)) return n; }
  return 0;
}

function safeString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString();
  if (v == null) return '';
  return String(v);
}

// HogQL queries — one per dimension. Kept minimal so a degradation in any
// single query doesn't take the whole route down (each one wrapped in a
// try/catch and aggregated at the end).
const QUERIES = {
  dau_7d: `
    SELECT
      toDate(timestamp) AS date,
      count(DISTINCT distinct_id) AS users
    FROM events
    WHERE timestamp > now() - interval 7 day
    GROUP BY date
    ORDER BY date ASC
  `.trim(),
  wau_4w: `
    SELECT
      toMonday(timestamp) AS week_start,
      count(DISTINCT distinct_id) AS users
    FROM events
    WHERE timestamp > now() - interval 28 day
    GROUP BY week_start
    ORDER BY week_start ASC
  `.trim(),
  mau_30d: `
    SELECT count(DISTINCT distinct_id) AS users
    FROM events
    WHERE timestamp > now() - interval 30 day
  `.trim(),
  top_events_24h: `
    SELECT event, count() AS count
    FROM events
    WHERE timestamp > now() - interval 24 hour
    GROUP BY event
    ORDER BY count DESC
    LIMIT 10
  `.trim(),
};

class PostHogError extends Error {
  constructor(public readonly httpStatus: number, public readonly code: string) {
    super(code);
    this.name = 'PostHogError';
  }
}

async function runHogQL(query: string): Promise<{ results: unknown[][]; columns: string[] }> {
  const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;
  if (!apiKey) throw new PostHogError(503, 'posthog_not_configured');

  const host = getPostHogHost();
  const url = `${host}/api/projects/${POSTHOG_PROJECT_ID}/query/`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
      signal: ctrl.signal,
    });
  } catch (err) {
    logger.warn('analytics_posthog.unreachable', { error: err instanceof Error ? err.message : String(err) });
    throw new PostHogError(502, 'posthog_unreachable');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    void res.text().catch(() => {});
    logger.warn('analytics_posthog.upstream_error', { status: res.status });
    throw new PostHogError(502, 'posthog_upstream_error');
  }

  const body = (await res.json().catch(() => null)) as { results?: unknown[][]; columns?: string[] } | null;
  if (!body || !Array.isArray(body.results)) {
    throw new PostHogError(502, 'posthog_parse_error');
  }
  return { results: body.results, columns: Array.isArray(body.columns) ? body.columns : [] };
}

async function fetchSummary(): Promise<AnalyticsSummary> {
  // Fire all 4 in parallel
  const [dauR, wauR, mauR, topR] = await Promise.allSettled([
    runHogQL(QUERIES.dau_7d),
    runHogQL(QUERIES.wau_4w),
    runHogQL(QUERIES.mau_30d),
    runHogQL(QUERIES.top_events_24h),
  ]);

  // DAU
  const dau_7d: DauRow[] = [];
  if (dauR.status === 'fulfilled') {
    for (const row of dauR.value.results) {
      if (!Array.isArray(row)) continue;
      dau_7d.push({ date: safeString(row[0]).slice(0, 10), users: safeNumber(row[1]) });
    }
  }

  // WAU
  const wau_4w: WauRow[] = [];
  if (wauR.status === 'fulfilled') {
    for (const row of wauR.value.results) {
      if (!Array.isArray(row)) continue;
      wau_4w.push({ week_start: safeString(row[0]).slice(0, 10), users: safeNumber(row[1]) });
    }
  }

  // MAU (single scalar)
  let mau_30d = 0;
  if (mauR.status === 'fulfilled' && mauR.value.results[0] && Array.isArray(mauR.value.results[0])) {
    mau_30d = safeNumber(mauR.value.results[0][0]);
  }

  // Top events
  const top_events_24h: TopEventRow[] = [];
  if (topR.status === 'fulfilled') {
    for (const row of topR.value.results) {
      if (!Array.isArray(row)) continue;
      top_events_24h.push({ event: safeString(row[0]), count: Math.floor(safeNumber(row[1])) });
    }
  }

  return { dau_7d, wau_4w, mau_30d, top_events_24h };
}

export async function GET(request: NextRequest) {
  // Phase G.1: read-only product analytics; support level OK.
  const auth = await authorizeAdmin(request, 'support');
  if (!auth.authorized) return auth.response;

  if (!process.env.POSTHOG_PERSONAL_API_KEY) {
    return NextResponse.json(
      { error: 'posthog_not_configured', code: 'POSTHOG_NOT_CONFIGURED' },
      { status: 503 },
    );
  }

  const nowMs = Date.now();
  const bucket = Math.floor(nowMs / TIME_WINDOW_BUCKET_MS);
  const cached = cacheGet(bucket);
  if (cached) {
    const payload: ResponsePayload = { ...cached.payload, cached: true, cached_at: new Date(cached.cachedAt).toISOString() };
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'private, max-age=0, s-maxage=300' } });
  }

  try {
    const fresh = await fetchSummary();
    cacheSet(bucket, { payload: fresh, cachedAt: nowMs });
    const payload: ResponsePayload = { ...fresh, cached: false, cached_at: null };
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'private, max-age=0, s-maxage=300' } });
  } catch (err) {
    if (err instanceof PostHogError) {
      return NextResponse.json({ error: err.code, code: err.code }, { status: err.httpStatus });
    }
    logger.warn('analytics_posthog.unexpected', { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: 'internal_error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
