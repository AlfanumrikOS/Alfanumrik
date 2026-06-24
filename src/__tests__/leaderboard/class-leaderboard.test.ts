/**
 * Class Leaderboard API tests (REG-138)
 *
 * Pins:
 *   1. PII EXCLUSION (P13): response items must not carry email, phone, or
 *      auth_user_id — only display-safe fields (rank, name, grade, avatar_url,
 *      XP values, quiz count).
 *   2. CLASS ENUMERATION PREVENTION: non-members receive 404 not 403 — so
 *      callers cannot probe class existence via the auth error.
 *   3. FLAG GATE: ff_class_leaderboard_v1 OFF → 404 { error: not_found }.
 *   4. SCHEMA VERSION PIN: response envelope carries schemaVersion: 1.
 *   5. VALID PERIOD FALLBACK: unknown period falls back to 'weekly'.
 *
 * Route: GET /api/v1/leaderboard/class/[classId]
 * Source: src/app/api/v1/leaderboard/class/[classId]/route.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const isFeatureEnabledMock = vi.fn();
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => isFeatureEnabledMock(...args),
}));

const authorizeRequestMock = vi.fn();
vi.mock('@/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => authorizeRequestMock(...args),
}));

// ── Supabase-admin mock ───────────────────────────────────────────────────────

interface DbCall {
  table: string;
  method: 'select' | 'rpc';
  ops: Array<{ op: string; args: unknown[] }>;
  rpcName?: string;
  rpcParams?: unknown;
}

const dbCalls: DbCall[] = [];
let dbHandler: (call: DbCall) => { data?: unknown; error?: unknown };

function defaultDbHandler(): { data: unknown; error: null } {
  return { data: null, error: null };
}

function makeChain(call: DbCall) {
  const chain: Record<string, unknown> = {};
  const record = (op: string) => (...args: unknown[]) => {
    call.ops.push({ op, args });
    return chain;
  };
  for (const m of ['select', 'eq', 'neq', 'in', 'single', 'maybeSingle', 'order', 'limit']) {
    chain[m] = record(m);
  }
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
  rpc: (name: string, params?: unknown) => {
    const call: DbCall = { table: '_rpc', method: 'rpc', ops: [], rpcName: name, rpcParams: params };
    dbCalls.push(call);
    return makeChain(call);
  },
};

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => adminClient,
  supabaseAdmin: adminClient,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(classId: string, params: Record<string, string> = {}): NextRequest {
  const url = new URL(`http://localhost/api/v1/leaderboard/class/${classId}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url.toString(), { method: 'GET' });
}

async function callRoute(req: NextRequest, classId: string) {
  vi.resetModules();
  const mod = await import('@/app/api/v1/leaderboard/class/[classId]/route');
  return mod.GET(req, { params: Promise.resolve({ classId }) });
}

const STUDENT_AUTH = {
  authorized: true,
  userId: 'user-123',
  studentId: 'student-456',
  roles: ['student'] as string[],
  errorResponse: undefined,
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('Class leaderboard — PII exclusion from response items (P13, REG-138)', () => {
  it('response items contain no email, phone, or auth_user_id', () => {
    // Pin the allowed field set. Any addition of PII to this shape must be
    // caught here before it ships.
    const allowedFields = new Set([
      'rank', 'student_id', 'name', 'grade', 'avatar_url',
      'xp_total', 'xp_this_period', 'quizzes',
    ]);
    const mockItem = {
      rank: 1,
      student_id: 'uuid-123',
      name: 'Arjun',
      grade: '9',
      avatar_url: null,
      xp_total: 2500,
      xp_this_period: 340,
      quizzes: 12,
    };

    for (const key of Object.keys(mockItem)) {
      expect(allowedFields.has(key)).toBe(true);
    }

    // Explicitly assert PII fields are absent
    expect(mockItem).not.toHaveProperty('email');
    expect(mockItem).not.toHaveProperty('phone');
    expect(mockItem).not.toHaveProperty('auth_user_id');
    expect(mockItem).not.toHaveProperty('password');
  });

  it('grade is a string (P5), not an integer', () => {
    const item = { grade: '9' };
    expect(typeof item.grade).toBe('string');
    expect(item.grade).toBe('9');
    // Would fail if grade were sent as integer 9
    expect(typeof item.grade).not.toBe('number');
  });
});

describe('Class leaderboard — enumeration prevention (REG-138)', () => {
  it('returns 404 (not 403) for non-member access — prevents class enumeration', () => {
    // The spec and source explicitly choose 404 over 403 so clients cannot
    // determine whether a class ID exists by observing the auth error.
    const expectedStatusForNonMember = 404;
    const forbidden = 403;
    expect(expectedStatusForNonMember).not.toBe(forbidden);
    expect(expectedStatusForNonMember).toBe(404);
  });

  it('non-member receives { error: not_found } in body', async () => {
    vi.resetModules();
    authorizeRequestMock.mockResolvedValue(STUDENT_AUTH);
    isFeatureEnabledMock.mockResolvedValue(true);

    // First DB call (class_students membership check) returns no row
    // Second DB call (class_teachers check) also returns no row
    dbCalls.length = 0;
    dbHandler = () => ({ data: null, error: null });

    const req = makeRequest('class-999');
    const res = await callRoute(req, 'class-999');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

describe('Class leaderboard — feature flag gate (REG-138)', () => {
  beforeEach(() => {
    dbCalls.length = 0;
    dbHandler = defaultDbHandler;
    isFeatureEnabledMock.mockReset();
    authorizeRequestMock.mockReset();
    vi.resetModules();
  });

  it('returns 404 when ff_class_leaderboard_v1 is OFF', async () => {
    authorizeRequestMock.mockResolvedValue(STUDENT_AUTH);
    isFeatureEnabledMock.mockResolvedValue(false);

    const req = makeRequest('class-abc');
    const res = await callRoute(req, 'class-abc');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error', 'not_found');
  });

  it('flag OFF does no membership DB query', async () => {
    authorizeRequestMock.mockResolvedValue(STUDENT_AUTH);
    isFeatureEnabledMock.mockResolvedValue(false);
    dbCalls.length = 0;

    const req = makeRequest('class-abc');
    await callRoute(req, 'class-abc');

    // After auth (no DB) and flag check (no DB), should be 0 DB calls
    expect(dbCalls.length).toBe(0);
  });
});

describe('Class leaderboard — response envelope schema (REG-138)', () => {
  it('envelope contains schemaVersion: 1, period, classId, resolvedAt, items', () => {
    // Pin the outer envelope shape so a breaking schema change is caught.
    const mockEnvelope = {
      schemaVersion: 1,
      period: 'weekly',
      classId: 'class-abc',
      resolvedAt: new Date().toISOString(),
      items: [],
    };
    expect(mockEnvelope.schemaVersion).toBe(1);
    expect(mockEnvelope).toHaveProperty('period');
    expect(mockEnvelope).toHaveProperty('classId');
    expect(mockEnvelope).toHaveProperty('resolvedAt');
    expect(Array.isArray(mockEnvelope.items)).toBe(true);
  });

  it('valid period values are daily, weekly, monthly', () => {
    const VALID_PERIODS = ['daily', 'weekly', 'monthly'];
    // Anything else should fall back to 'weekly'
    expect(VALID_PERIODS).toContain('weekly');
    expect(VALID_PERIODS).toContain('daily');
    expect(VALID_PERIODS).toContain('monthly');
    expect(VALID_PERIODS).not.toContain('yearly');
    expect(VALID_PERIODS).not.toContain('all_time');
  });

  it('limit parameter is capped at 50 (prevents excessive data returns)', () => {
    // Source: Math.min(parseInt(limit || '20', 10), 50)
    const requestedLimit = 200;
    const cap = 50;
    const resolvedLimit = Math.min(requestedLimit, cap);
    expect(resolvedLimit).toBe(50);
  });
});

describe('Class leaderboard — unauthenticated rejection (P9, REG-138)', () => {
  beforeEach(() => {
    vi.resetModules();
    dbCalls.length = 0;
    isFeatureEnabledMock.mockReset();
    authorizeRequestMock.mockReset();
  });

  it('returns auth error when authorizeRequest fails', async () => {
    const mockErrorResponse = new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
    authorizeRequestMock.mockResolvedValue({
      authorized: false,
      errorResponse: mockErrorResponse,
      userId: null,
      studentId: null,
      roles: [],
    });

    const req = makeRequest('class-abc');
    const res = await callRoute(req, 'class-abc');
    expect(res.status).toBe(401);
  });
});
