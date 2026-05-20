/**
 * GET /api/super-admin/alfabot/stats tests (AlfaBot PR 4).
 *
 * Pins the contract for the super-admin dashboard stats endpoint:
 *   - 401 when unauthorized
 *   - 200 with the expected payload shape on the happy path
 *   - 60s memo cache: a second call within the TTL doesn't re-query Supabase
 *   - $ cap reads from ALFABOT_DAILY_USD_CAP env override
 *   - cost estimation uses the gpt-4o-mini per-million-token rates
 *
 * P13 contract is exercised implicitly — the response shape this test pins
 * NEVER contains email/phone/name/IP/message content.
 *
 * Mocking pattern mirrors the other super-admin route tests in this dir —
 * a chainable Supabase mock that branches by table name and yields
 * per-table results set up in beforeEach.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── admin-auth mock ────────────────────────────────────────────────────────
const _authorizeAdmin = vi.fn();
vi.mock('@/lib/admin-auth', () => ({
  authorizeAdmin: (...args: unknown[]) => _authorizeAdmin(...args),
  logAdminAudit: vi.fn(),
}));

function setAuthorized() {
  _authorizeAdmin.mockResolvedValue({
    authorized: true,
    userId: 'admin-uuid',
    adminId: 'admin-id',
    email: 'ops@alfanumrik.com',
    name: 'Test Ops',
    adminLevel: 'super_admin',
  });
}

function setUnauthorized() {
  _authorizeAdmin.mockResolvedValue({
    authorized: false,
    response: new Response(JSON.stringify({ error: 'Please log in.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }),
  });
}

// ─── logger mock ────────────────────────────────────────────────────────────
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── supabaseAdmin mock ─────────────────────────────────────────────────────
// We track from-table call counts so the cache test can assert that the
// second invocation doesn't hit any table.

const tableResults: Record<string, { data: unknown; error: unknown }> = {
  alfabot_sessions: { data: [], error: null },
  alfabot_messages: { data: [], error: null },
  alfabot_leads: { data: [], error: null },
  audit_logs: { data: [], error: null },
  alfabot_denylist: { data: [], error: null },
};

let fromCallsByTable: Record<string, number> = {};

function resetTableResults() {
  for (const k of Object.keys(tableResults)) {
    tableResults[k] = { data: [], error: null };
  }
  fromCallsByTable = {};
}

function setResult(table: string, data: unknown, error: unknown = null) {
  tableResults[table] = { data, error };
}

function makeChain(table: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.gte = vi.fn(() => chain);
  chain.lte = vi.fn(() => chain);
  chain.lt = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.is = vi.fn(() => chain);
  chain.not = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(() => Promise.resolve(tableResults[table] ?? { data: null, error: null }));
  chain.then = (resolve: (r: unknown) => unknown) => {
    const result = tableResults[table] ?? { data: [], error: null };
    return Promise.resolve(result).then(resolve);
  };
  return chain;
}

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      fromCallsByTable[table] = (fromCallsByTable[table] ?? 0) + 1;
      return makeChain(table);
    }),
  },
}));

// ─── Test bench ─────────────────────────────────────────────────────────────

function buildRequest(): NextRequest {
  return new NextRequest('http://localhost/api/super-admin/alfabot/stats');
}

beforeEach(async () => {
  vi.clearAllMocks();
  resetTableResults();
  // Ensure the module-level cache doesn't leak across tests.
  delete process.env.ALFABOT_DAILY_USD_CAP;
  const mod = await import('@/app/api/super-admin/alfabot/stats/route');
  mod._clearStatsCache();
});

// ─── 1. Auth ────────────────────────────────────────────────────────────────

describe('GET /api/super-admin/alfabot/stats: auth', () => {
  it('returns 401 when authorizeAdmin denies', async () => {
    setUnauthorized();
    const { GET } = await import('@/app/api/super-admin/alfabot/stats/route');
    const res = await GET(buildRequest());
    expect(res.status).toBe(401);
    // No table queries should have happened on the unauth path.
    expect(fromCallsByTable.alfabot_sessions ?? 0).toBe(0);
  });

  it('asks authorizeAdmin for the `support` level (read-only)', async () => {
    setAuthorized();
    const { GET } = await import('@/app/api/super-admin/alfabot/stats/route');
    await GET(buildRequest());
    expect(_authorizeAdmin).toHaveBeenCalledWith(expect.anything(), 'support');
  });
});

// ─── 2. Empty / cold-start ──────────────────────────────────────────────────

describe('GET /api/super-admin/alfabot/stats: empty / cold-start', () => {
  it('200 with zeroed counts when no rows exist anywhere', async () => {
    setAuthorized();
    const { GET } = await import('@/app/api/super-admin/alfabot/stats/route');
    const res = await GET(buildRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.today).toEqual({
      sessions: 0,
      messages: 0,
      spendUsd: 0,
      rateLimitHitPct: 0,
      degradedMessages: 0,
    });
    expect(body.data.empty).toBe(true);
    expect(body.data.cap.dailyUsdCap).toBe(20); // default
    expect(body.data.cap.percentUsed).toBe(0);
    expect(body.data.abuse.blockedToday).toBe(0);
    expect(body.data.abuse.denylistSize).toBe(0);
    expect(body.data.leads).toEqual({
      today: 0,
      last7d: 0,
      last30d: 0,
      byAudience: { parent: 0, student: 0, teacher: 0, school: 0 },
      webhookDeliveredPct: 0,
    });
    expect(body.data.latency.p50ms).toBeNull();
    expect(body.data.latency.p95ms).toBeNull();
    expect(body.data.latency.model).toBe('gpt-4o-mini');
    expect(body.data.audienceMix).toEqual({ parent: 0, student: 0, teacher: 0, school: 0 });
    expect(body.data.langMix).toEqual({ en: 0, hi: 0 });
    expect(Array.isArray(body.data.trend30d)).toBe(true);
    expect(body.data.trend30d.length).toBe(30);
  });

  it('response shape never contains PII keys', async () => {
    setAuthorized();
    const { GET } = await import('@/app/api/super-admin/alfabot/stats/route');
    const res = await GET(buildRequest());
    const body = await res.json();
    const flat = JSON.stringify(body);
    // P13: stats response must not surface any PII fields.
    expect(flat).not.toMatch(/"email"\s*:/);
    expect(flat).not.toMatch(/"phone"\s*:/);
    // The audience-mix object happens to have a 'parent' KEY; reject only
    // a literal name field by guarding for `"name":"` (string value) which
    // would indicate a leaked person name.
    expect(flat).not.toMatch(/"name"\s*:\s*"/);
    expect(flat).not.toMatch(/"ip_address"\s*:/);
  });
});

// ─── 3. Happy path with data ────────────────────────────────────────────────

describe('GET /api/super-admin/alfabot/stats: happy path', () => {
  it('aggregates sessions, messages and leads into rolled-up counts', async () => {
    setAuthorized();
    const todayStartIso = (() => {
      const d = new Date();
      d.setUTCHours(0, 0, 0, 0);
      return d.toISOString();
    })();

    setResult('alfabot_sessions', [
      {
        id: 's1',
        audience: 'parent',
        lang: 'en',
        last_message_at: todayStartIso,
        created_at: todayStartIso,
        message_count: 4,
        rate_limit_hit: false,
      },
      {
        id: 's2',
        audience: 'student',
        lang: 'hi',
        last_message_at: todayStartIso,
        created_at: todayStartIso,
        message_count: 2,
        rate_limit_hit: true,
      },
    ]);
    setResult('alfabot_messages', [
      {
        session_id: 's1',
        role: 'assistant',
        tokens_used: 250,
        latency_ms: 1200,
        degraded_mode: false,
        model: 'gpt-4o-mini',
        created_at: todayStartIso,
      },
      {
        session_id: 's1',
        role: 'user',
        tokens_used: null,
        latency_ms: null,
        degraded_mode: false,
        model: null,
        created_at: todayStartIso,
      },
    ]);
    setResult('alfabot_leads', [
      { audience: 'parent', webhook_delivered_at: '2026-05-19T10:00:00Z', created_at: todayStartIso },
    ]);
    setResult('audit_logs', [
      {
        action: 'alfabot.abuse_blocked',
        created_at: todayStartIso,
        details: { reason: 'prompt_injection' },
      },
      {
        action: 'alfabot.abuse_blocked',
        created_at: todayStartIso,
        details: { reason: 'url_in_message' },
      },
    ]);
    setResult('alfabot_denylist', [{ anon_id: 'banned-1' }]);

    const { GET } = await import('@/app/api/super-admin/alfabot/stats/route');
    const res = await GET(buildRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.today.sessions).toBe(2);
    expect(body.data.today.messages).toBe(2);
    // 250 tokens * $0.60 / 1M = $0.00015 → rounded to 4dp (FP-tolerant)
    // we accept either 0.0001 or 0.0002 since Math.round on 1.499999... can
    // land either way depending on the underlying float representation.
    expect(body.data.today.spendUsd).toBeGreaterThan(0);
    expect(body.data.today.spendUsd).toBeLessThanOrEqual(0.0003);
    expect(body.data.today.rateLimitHitPct).toBe(50); // 1 / 2 sessions
    expect(body.data.abuse.blockedToday).toBe(2);
    expect(body.data.abuse.denylistSize).toBe(1);
    expect(body.data.abuse.topReasons).toEqual([
      { reason: 'prompt_injection', count: 1 },
      { reason: 'url_in_message', count: 1 },
    ]);
    expect(body.data.leads.today).toBe(1);
    expect(body.data.leads.byAudience.parent).toBe(1);
    expect(body.data.leads.webhookDeliveredPct).toBe(100);
    expect(body.data.langMix).toEqual({ en: 1, hi: 1 });
    expect(body.data.audienceMix.parent).toBe(1);
    expect(body.data.audienceMix.student).toBe(1);
    expect(body.data.empty).toBe(false);
  });

  it('p50 / p95 latency: pulled from assistant rows in the last 24h', async () => {
    setAuthorized();
    const now = new Date().toISOString();
    setResult('alfabot_messages', [
      { session_id: 's', role: 'assistant', tokens_used: 100, latency_ms: 800, degraded_mode: false, model: 'gpt-4o-mini', created_at: now },
      { session_id: 's', role: 'assistant', tokens_used: 100, latency_ms: 1200, degraded_mode: false, model: 'gpt-4o-mini', created_at: now },
      { session_id: 's', role: 'assistant', tokens_used: 100, latency_ms: 1600, degraded_mode: false, model: 'gpt-4o-mini', created_at: now },
      { session_id: 's', role: 'assistant', tokens_used: 100, latency_ms: 2400, degraded_mode: false, model: 'gpt-4o-mini', created_at: now },
      { session_id: 's', role: 'user', tokens_used: null, latency_ms: null, degraded_mode: false, model: null, created_at: now },
    ]);
    const { GET } = await import('@/app/api/super-admin/alfabot/stats/route');
    const res = await GET(buildRequest());
    const body = await res.json();
    // user row's latency is ignored
    expect(body.data.latency.samples).toBe(4);
    // p50 of [800,1200,1600,2400] = index 2 = 1600
    expect(body.data.latency.p50ms).toBe(1600);
    // p95 of [800,1200,1600,2400] hits the last sample = 2400
    expect(body.data.latency.p95ms).toBe(2400);
  });
});

// ─── 4. Cost cap ────────────────────────────────────────────────────────────

describe('GET /api/super-admin/alfabot/stats: cost cap', () => {
  it('uses ALFABOT_DAILY_USD_CAP env when set', async () => {
    process.env.ALFABOT_DAILY_USD_CAP = '50';
    setAuthorized();
    const { GET } = await import('@/app/api/super-admin/alfabot/stats/route');
    const res = await GET(buildRequest());
    const body = await res.json();
    expect(body.data.cap.dailyUsdCap).toBe(50);
  });

  it('falls back to 20 USD when env is missing or invalid', async () => {
    process.env.ALFABOT_DAILY_USD_CAP = 'not-a-number';
    setAuthorized();
    const { GET } = await import('@/app/api/super-admin/alfabot/stats/route');
    const res = await GET(buildRequest());
    const body = await res.json();
    expect(body.data.cap.dailyUsdCap).toBe(20);
  });
});

// ─── 5. 60s memo cache ──────────────────────────────────────────────────────

describe('GET /api/super-admin/alfabot/stats: cache', () => {
  it('second call within 60s does not re-query Supabase', async () => {
    setAuthorized();
    const { GET, _clearStatsCache } = await import('@/app/api/super-admin/alfabot/stats/route');
    _clearStatsCache();

    const res1 = await GET(buildRequest());
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.cached).toBe(false);

    const callsAfterFirst = { ...fromCallsByTable };

    // Second call should be served from memo — no new from() calls.
    const res2 = await GET(buildRequest());
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.cached).toBe(true);

    // The from() call counts should be unchanged for every AlfaBot table.
    for (const t of ['alfabot_sessions', 'alfabot_messages', 'alfabot_leads', 'audit_logs', 'alfabot_denylist']) {
      expect(fromCallsByTable[t] ?? 0).toBe(callsAfterFirst[t] ?? 0);
    }
  });
});
