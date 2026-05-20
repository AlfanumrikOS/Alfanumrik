/**
 * GET /api/super-admin/alfabot/stats
 *
 * Aggregated operational metrics for the AlfaBot super-admin dashboard
 * (PR 4 of the AlfaBot feature). Returns:
 *   - today's session / message volume, USD spend, rate-limit-hit %, degraded count
 *   - daily $ cap vs current spend (yellow/red bands computed client-side)
 *   - abuse counters (blocked today, denylist size, top 5 reasons)
 *   - lead funnel (today / 7d / 30d) — only the COUNTS, never PII
 *   - p50 / p95 assistant latency (last 24h)
 *   - audience + lang mix (last 7d)
 *   - 30-day trend (sessions, messages, USD spend per day)
 *
 * Auth: `authorizeAdmin(request, 'support')` — read-only operational view.
 * P13: response contains COUNTS and timestamps only. No email/phone/name/IP
 *      from leads or sessions. No message content.
 *
 * Caching: 60-second in-memory memo per process. The dashboard reloads
 * every 30s in normal use; the memo avoids hammering Supabase from multi-tab
 * admin sessions and gives the page sub-100ms latency on warm hits.
 *
 * Owner: ops
 * Reviewers: backend (query implementation), architect (PII review), testing
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import {
  estimateCostUsd,
  estimateCostUsdFromTotal,
  getAlfabotDailyUsdCap,
} from '@/lib/alfabot/pricing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ─── Memo cache (60s TTL) ────────────────────────────────────────────────────

interface CachedPayload {
  body: StatsResponse;
  expiresAt: number;
}

let _cached: CachedPayload | null = null;

/**
 * Test hook — clear the in-process memo. Production code paths never call
 * this; tests import it to keep cases independent.
 */
export function _clearStatsCache(): void {
  _cached = null;
}

// ─── Response shape ──────────────────────────────────────────────────────────

interface BucketRollup {
  sessions: number;
  messages: number;
  spendUsd: number;
}

interface TrendDay extends BucketRollup {
  day: string; // YYYY-MM-DD UTC
}

interface AudienceMix {
  parent: number;
  student: number;
  teacher: number;
  school: number;
}

interface LangMix {
  en: number;
  hi: number;
}

interface LeadsFunnel {
  today: number;
  last7d: number;
  last30d: number;
  byAudience: AudienceMix;
  webhookDeliveredPct: number; // 0..100, of last30d
}

interface AbuseSnapshot {
  blockedToday: number;
  denylistSize: number;
  topReasons: Array<{ reason: string; count: number }>;
}

interface LatencySnapshot {
  p50ms: number | null;
  p95ms: number | null;
  model: string;
  samples: number;
}

interface CostSnapshot {
  dailyUsdCap: number;
  percentUsed: number; // 0..1
}

export interface StatsResponse {
  generatedAt: string;
  today: {
    sessions: number;
    messages: number;
    spendUsd: number;
    rateLimitHitPct: number; // 0..100
    degradedMessages: number;
  };
  cap: CostSnapshot;
  abuse: AbuseSnapshot;
  leads: LeadsFunnel;
  latency: LatencySnapshot;
  audienceMix: AudienceMix;
  langMix: LangMix;
  trend30d: TrendDay[];
  /**
   * True when no rows are present anywhere — the dashboard renders an
   * empty-state hint rather than an error.
   */
  empty: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function startOfTodayUtc(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 3600 * 1000).toISOString();
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function percentile(samples: number[], p: number): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[idx]);
}

function emptyAudienceMix(): AudienceMix {
  return { parent: 0, student: 0, teacher: 0, school: 0 };
}

function bumpAudience(mix: AudienceMix, audience: string | null | undefined): void {
  if (audience === 'parent' || audience === 'student' || audience === 'teacher' || audience === 'school') {
    mix[audience] += 1;
  }
}

// ─── Aggregation pipeline ────────────────────────────────────────────────────

interface SessionRow {
  id: string;
  audience: string;
  lang: string;
  last_message_at: string;
  created_at: string;
  message_count: number | null;
  rate_limit_hit: boolean | null;
}

interface MessageRow {
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  tokens_used: number | null;
  latency_ms: number | null;
  degraded_mode: boolean | null;
  model: string | null;
  created_at: string;
}

interface LeadRow {
  audience: string;
  webhook_delivered_at: string | null;
  created_at: string;
}

interface AuditRow {
  action: string;
  created_at: string;
  details: Record<string, unknown> | null;
}

interface DenylistRow {
  anon_id: string;
}

async function buildStats(): Promise<StatsResponse> {
  const since30d = isoDaysAgo(30);
  const since7d = isoDaysAgo(7);
  const since24h = isoDaysAgo(1);
  const since30dUtc = startOfTodayUtc(); // today bucket

  // ── 1. Sessions last 30d ──
  const { data: sessionRows, error: sessionErr } = await supabaseAdmin
    .from('alfabot_sessions')
    .select('id, audience, lang, last_message_at, created_at, message_count, rate_limit_hit')
    .gte('last_message_at', since30d);
  if (sessionErr) {
    logger.error('super-admin.alfabot-stats: sessions fetch failed', {
      error: sessionErr.message,
    });
    throw new Error(`sessions_fetch_failed: ${sessionErr.message}`);
  }
  const sessions = (sessionRows ?? []) as SessionRow[];

  // ── 2. Messages last 30d (assistant only for spend; both for volume) ──
  const { data: messageRows, error: msgErr } = await supabaseAdmin
    .from('alfabot_messages')
    .select('session_id, role, tokens_used, latency_ms, degraded_mode, model, created_at')
    .gte('created_at', since30d);
  if (msgErr) {
    logger.error('super-admin.alfabot-stats: messages fetch failed', {
      error: msgErr.message,
    });
    throw new Error(`messages_fetch_failed: ${msgErr.message}`);
  }
  const messages = (messageRows ?? []) as MessageRow[];

  // ── 3. Leads last 30d ──
  const { data: leadRows, error: leadErr } = await supabaseAdmin
    .from('alfabot_leads')
    .select('audience, webhook_delivered_at, created_at')
    .gte('created_at', since30d);
  if (leadErr) {
    logger.error('super-admin.alfabot-stats: leads fetch failed', { error: leadErr.message });
    throw new Error(`leads_fetch_failed: ${leadErr.message}`);
  }
  const leads = (leadRows ?? []) as LeadRow[];

  // ── 4. Audit logs (abuse + today's spend cross-check) ──
  // We pull abuse_blocked entries for today only (cheap), and the count of
  // alfabot.respond for cross-checking — but the dashboard uses the
  // alfabot_messages roll-up as the canonical volume source.
  const { data: auditRows, error: auditErr } = await supabaseAdmin
    .from('audit_logs')
    .select('action, created_at, details')
    .in('action', ['alfabot.abuse_blocked', 'alfabot.upstream_failed'])
    .gte('created_at', since24h);
  if (auditErr) {
    logger.warn('super-admin.alfabot-stats: audit fetch failed (non-fatal)', {
      error: auditErr.message,
    });
  }
  const audits = (auditRows ?? []) as AuditRow[];

  // ── 5. Denylist size ──
  const { data: denylistRows, error: denyErr } = await supabaseAdmin
    .from('alfabot_denylist')
    .select('anon_id');
  if (denyErr) {
    logger.warn('super-admin.alfabot-stats: denylist fetch failed (non-fatal)', {
      error: denyErr.message,
    });
  }
  const denylist = (denylistRows ?? []) as DenylistRow[];

  // ── Compute per-day rollups ──
  const trendMap = new Map<string, BucketRollup>();
  for (let i = 0; i < 30; i++) {
    const key = dayKey(isoDaysAgo(i));
    trendMap.set(key, { sessions: 0, messages: 0, spendUsd: 0 });
  }

  for (const s of sessions) {
    const k = dayKey(s.last_message_at);
    const bucket = trendMap.get(k);
    if (bucket) bucket.sessions += 1;
  }

  // Total spend today + 30d trend spend (assistant rows only — user rows have
  // no token usage). Cost estimated from token totals using the per-model
  // pricing table. When tokens_used is split client-side, callers should
  // populate input/output separately; here we charge the conservative path.
  let spendToday = 0;
  let messagesToday = 0;
  let degradedToday = 0;
  const todayKey = dayKey(since30dUtc);

  for (const m of messages) {
    const k = dayKey(m.created_at);
    const bucket = trendMap.get(k);
    if (bucket) bucket.messages += 1;

    if (m.role === 'assistant') {
      // We don't have split input/output on alfabot_messages — fall back to
      // total tokens, biased pessimistically toward the output rate.
      const cost = estimateCostUsdFromTotal(
        m.model ?? 'gpt-4o-mini',
        m.tokens_used ?? 0,
      );
      if (bucket) bucket.spendUsd += cost;
      if (k === todayKey) {
        spendToday += cost;
        if (m.degraded_mode) degradedToday += 1;
      }
    }
    if (k === todayKey) messagesToday += 1;
  }

  // Round daily spend to 4 decimals (≈ $0.0001 = 0.01¢) for readability.
  for (const v of trendMap.values()) v.spendUsd = Math.round(v.spendUsd * 10_000) / 10_000;
  spendToday = Math.round(spendToday * 10_000) / 10_000;

  const trend30d: TrendDay[] = Array.from(trendMap.entries())
    .map(([day, rollup]) => ({ day, ...rollup }))
    .sort((a, b) => a.day.localeCompare(b.day));

  // ── Today's session / rate-limit metrics ──
  let sessionsToday = 0;
  let rateLimitHitsToday = 0;
  for (const s of sessions) {
    if (dayKey(s.last_message_at) === todayKey) {
      sessionsToday += 1;
      if (s.rate_limit_hit) rateLimitHitsToday += 1;
    }
  }
  const rateLimitHitPct =
    sessionsToday > 0 ? Math.round((rateLimitHitsToday / sessionsToday) * 1000) / 10 : 0;

  // ── Cost cap ──
  const dailyUsdCap = getAlfabotDailyUsdCap();
  const percentUsed = dailyUsdCap > 0 ? spendToday / dailyUsdCap : 0;

  // ── Abuse counters ──
  const abuseToday = audits.filter(
    (a) => a.action === 'alfabot.abuse_blocked' && dayKey(a.created_at) === todayKey,
  );
  const reasonTally = new Map<string, number>();
  for (const a of abuseToday) {
    const reason = (a.details?.reason as string) ?? 'unknown';
    reasonTally.set(reason, (reasonTally.get(reason) ?? 0) + 1);
  }
  const topReasons = Array.from(reasonTally.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));

  // ── Lead funnel ──
  let leadsToday = 0;
  let leads7 = 0;
  const leadAudienceMix = emptyAudienceMix();
  let webhookDelivered = 0;
  for (const l of leads) {
    const dk = dayKey(l.created_at);
    if (dk === todayKey) leadsToday += 1;
    if (l.created_at >= since7d) leads7 += 1;
    bumpAudience(leadAudienceMix, l.audience);
    if (l.webhook_delivered_at) webhookDelivered += 1;
  }
  const webhookDeliveredPct =
    leads.length > 0 ? Math.round((webhookDelivered / leads.length) * 1000) / 10 : 0;

  // ── Latency (last 24h, assistant rows only, model=gpt-4o-mini canonical) ──
  const recentLatencies = messages
    .filter(
      (m) =>
        m.role === 'assistant' &&
        m.created_at >= since24h &&
        typeof m.latency_ms === 'number' &&
        m.latency_ms > 0,
    )
    .map((m) => m.latency_ms as number);

  const latency: LatencySnapshot = {
    p50ms: percentile(recentLatencies, 50),
    p95ms: percentile(recentLatencies, 95),
    model: 'gpt-4o-mini',
    samples: recentLatencies.length,
  };

  // ── Audience + lang mix (last 7d sessions) ──
  const audienceMix = emptyAudienceMix();
  const langMix: LangMix = { en: 0, hi: 0 };
  for (const s of sessions) {
    if (s.last_message_at < since7d) continue;
    bumpAudience(audienceMix, s.audience);
    if (s.lang === 'en' || s.lang === 'hi') langMix[s.lang] += 1;
  }

  // ── Empty state ──
  const empty = sessions.length === 0 && messages.length === 0 && leads.length === 0;

  return {
    generatedAt: new Date().toISOString(),
    today: {
      sessions: sessionsToday,
      messages: messagesToday,
      spendUsd: spendToday,
      rateLimitHitPct,
      degradedMessages: degradedToday,
    },
    cap: {
      dailyUsdCap,
      percentUsed: Math.round(percentUsed * 1000) / 1000,
    },
    abuse: {
      blockedToday: abuseToday.length,
      denylistSize: denylist.length,
      topReasons,
    },
    leads: {
      today: leadsToday,
      last7d: leads7,
      last30d: leads.length,
      byAudience: leadAudienceMix,
      webhookDeliveredPct,
    },
    latency,
    audienceMix,
    langMix,
    trend30d,
    empty,
  };
}

// ─── Route handler ───────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await authorizeAdmin(request, 'support');
  if (!auth.authorized) return auth.response;

  try {
    const now = Date.now();
    if (_cached && _cached.expiresAt > now) {
      return NextResponse.json({ success: true, data: _cached.body, cached: true });
    }

    const body = await buildStats();
    _cached = { body, expiresAt: now + 60_000 };
    return NextResponse.json({ success: true, data: body, cached: false });
  } catch (err) {
    logger.error('super-admin.alfabot-stats: unhandled error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL' },
      { status: 500 },
    );
  }
}

// Internal export for tests.
export { estimateCostUsd as _estimateCostUsd };
