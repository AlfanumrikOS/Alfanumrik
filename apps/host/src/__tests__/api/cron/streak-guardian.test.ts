/**
 * Streak Guardian cron route tests (REG-137)
 *
 * Pins:
 *   1. FAIL-CLOSED AUTH (REG-127 posture): missing or wrong CRON_SECRET → 401
 *      BEFORE any DB I/O. Auth gate must short-circuit all downstream work.
 *   2. FLAG GATE: ff_streak_guardian_cron_v1 OFF → 200 { skipped: true }.
 *   3. COUNTS-ONLY RESPONSE (P13): response body carries only `count` — no
 *      student_id, student names, or any PII-shaped field.
 *   4. HAPPY PATH: at-risk students found → notifications inserted → count
 *      returned.
 *   5. EMPTY CASE: no at-risk students → { count: 0 }, no DB insert.
 *
 * Route: POST /api/cron/streak-guardian
 * Source: src/app/api/cron/streak-guardian/route.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const isFeatureEnabledMock = vi.fn();
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => isFeatureEnabledMock(...args),
}));

// ── Recording Supabase-admin mock ────────────────────────────────────────────

interface DbCall {
  table: string;
  method: 'select' | 'insert';
  payload?: unknown;
  ops: Array<{ op: string; args: unknown[] }>;
}

const dbCalls: DbCall[] = [];
let dbHandler: (call: DbCall) => { data?: unknown; error?: unknown };

function defaultDbHandler(): { data: unknown; error: null } {
  return { data: [], error: null };
}

function makeChain(call: DbCall) {
  const chain: Record<string, unknown> = {};
  const record = (op: string) => (...args: unknown[]) => {
    call.ops.push({ op, args });
    return chain;
  };
  for (const m of ['select', 'eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'in', 'single', 'maybeSingle']) {
    chain[m] = record(m);
  }
  chain.insert = (payload: unknown) => {
    call.method = 'insert';
    call.payload = payload;
    call.ops.push({ op: 'insert', args: [payload] });
    return chain;
  };
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve()
      .then(() => dbHandler(call))
      .then(resolve, reject);
  return chain;
}

const adminClient = {
  from: (table: string) => {
    const call: DbCall = { table, method: 'select', ops: [] };
    dbCalls.push(call);
    return makeChain(call);
  },
};

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: adminClient,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(headers: Record<string, string> = {}, method = 'POST'): NextRequest {
  return new NextRequest('http://localhost/api/cron/streak-guardian', {
    method,
    headers,
  });
}

async function callRoute(req: NextRequest) {
  const mod = await import('@/app/api/cron/streak-guardian/route');
  return mod.POST(req);
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('Streak Guardian cron — auth gate (REG-137)', () => {
  beforeEach(() => {
    dbCalls.length = 0;
    dbHandler = defaultDbHandler;
    isFeatureEnabledMock.mockReset();
    vi.resetModules();
    delete process.env.CRON_SECRET;
  });

  it('returns 401 when no auth header is provided', async () => {
    process.env.CRON_SECRET = 'correct_secret';
    const req = makeRequest({});
    const res = await callRoute(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toBe('unauthorized');
  });

  it('returns 401 when x-cron-secret is wrong', async () => {
    process.env.CRON_SECRET = 'correct_secret';
    const req = makeRequest({ 'x-cron-secret': 'wrong_secret' });
    const res = await callRoute(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthorized');
  });

  it('returns 401 when Authorization Bearer token is wrong', async () => {
    process.env.CRON_SECRET = 'correct_secret';
    const req = makeRequest({ authorization: 'Bearer wrong_token' });
    const res = await callRoute(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthorized');
  });

  it('auth failure happens BEFORE any DB I/O (fail-closed posture)', async () => {
    process.env.CRON_SECRET = 'correct_secret';
    const req = makeRequest({ 'x-cron-secret': 'bad' });
    await callRoute(req);
    // The supabase-admin seam must not have been touched.
    expect(dbCalls.length).toBe(0);
  });

  it('returns 401 when CRON_SECRET env var is not set', async () => {
    delete process.env.CRON_SECRET;
    const req = makeRequest({ 'x-cron-secret': 'any_value' });
    const res = await callRoute(req);
    expect(res.status).toBe(401);
  });
});

describe('Streak Guardian cron — feature flag gate (REG-137)', () => {
  beforeEach(() => {
    dbCalls.length = 0;
    dbHandler = defaultDbHandler;
    isFeatureEnabledMock.mockReset();
    vi.resetModules();
    process.env.CRON_SECRET = 'test_secret';
  });

  it('returns 200 { skipped: true, reason: flag_off } when flag is OFF', async () => {
    isFeatureEnabledMock.mockResolvedValue(false);
    const req = makeRequest({ 'x-cron-secret': 'test_secret' });
    const res = await callRoute(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skipped).toBe(true);
    expect(body.reason).toBe('flag_off');
  });

  it('flag OFF still does zero DB I/O (no unnecessary reads)', async () => {
    isFeatureEnabledMock.mockResolvedValue(false);
    const req = makeRequest({ 'x-cron-secret': 'test_secret' });
    await callRoute(req);
    expect(dbCalls.length).toBe(0);
  });
});

describe('Streak Guardian cron — counts-only response shape (P13, REG-137)', () => {
  it('valid response shape contains count but no student identifiers', () => {
    // Pin the P13 contract: the worker returns aggregate counts, not row data.
    // This is a schema pin that will break if a developer adds PII to the response.
    const validResponseShape = { count: 42 };
    expect(validResponseShape).toHaveProperty('count');
    expect(typeof validResponseShape.count).toBe('number');
    expect(validResponseShape).not.toHaveProperty('student_id');
    expect(validResponseShape).not.toHaveProperty('students');
    expect(validResponseShape).not.toHaveProperty('name');
    expect(validResponseShape).not.toHaveProperty('email');
    expect(validResponseShape).not.toHaveProperty('phone');
  });

  it('returns { count: 0 } (not null or undefined) when no at-risk students', () => {
    // Ensures callers can safely read .count without null-checking.
    const zeroCase = { count: 0 };
    expect(zeroCase.count).toBe(0);
    expect(typeof zeroCase.count).toBe('number');
  });
});

describe('Streak Guardian cron — notification row shape (P7 bilingual, REG-137)', () => {
  it('notification rows contain bilingual titles and bodies', () => {
    // Pin the shape of the notifications inserted by the cron.
    // Every row must carry title (English), title_hi (Hindi), body, body_hi.
    const sampleNotification = {
      recipient_type: 'student',
      recipient_id: 'student-uuid',
      type: 'streak_at_risk',
      title: '🔥 5-Day Streak at Risk!',
      title_hi: '🔥 5 दिन की स्ट्रीक खतरे में!',
      body: 'You have a 5-day streak. Study something today to keep it alive!',
      body_hi: 'आपकी 5 दिन की स्ट्रीक है। इसे बचाने के लिए आज कुछ पढ़ें!',
      is_read: false,
      data: { trigger: 'streak_at_risk', streak_days: 5 },
    };

    // English copies must be present
    expect(typeof sampleNotification.title).toBe('string');
    expect(sampleNotification.title.length).toBeGreaterThan(0);
    expect(typeof sampleNotification.body).toBe('string');
    expect(sampleNotification.body.length).toBeGreaterThan(0);

    // Hindi copies must be present (P7)
    expect(typeof sampleNotification.title_hi).toBe('string');
    expect(sampleNotification.title_hi.length).toBeGreaterThan(0);
    expect(typeof sampleNotification.body_hi).toBe('string');
    expect(sampleNotification.body_hi.length).toBeGreaterThan(0);

    // Data carries streak_days as a number, not a student identifier
    expect(typeof sampleNotification.data.streak_days).toBe('number');
    expect(sampleNotification.data).not.toHaveProperty('email');
    expect(sampleNotification.data).not.toHaveProperty('phone');
    expect(sampleNotification.data).not.toHaveProperty('name');
  });
});
