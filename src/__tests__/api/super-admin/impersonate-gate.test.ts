/**
 * Student impersonation handler tests
 * (Phase 4 / 2026-06-11 — privilege-escalation surface coverage).
 *
 * Pins the gate + session contract for
 *   src/app/api/super-admin/students/[id]/impersonate/route.ts
 *
 * Impersonation lets an admin BECOME a learner — full student-portal PII
 * access. The route's documented contract:
 *   - POST (start) requires 'super_admin'. Even a 'support' admin must not be
 *     able to read PII by impersonating.
 *   - GET (read state) requires 'support'.
 *   - Invalid / non-UUID student id → 400.
 *   - A successful start writes an audit row AND creates an
 *     admin_impersonation_sessions record carrying an expiry (expires_at).
 *   - The GET path only returns a session that is unended AND not expired
 *     (`.is('ended_at', null).gt('expires_at', now)`) — so without an active,
 *     non-expired session row, impersonation cannot proceed.
 *
 * Assertions:
 *   1. POST asks authorizeAdmin for 'super_admin'; on denial returns that exact
 *      response, mints no session, writes no audit.
 *   2. POST with a non-UUID id → 400 before any DB I/O.
 *   3. Successful POST inserts a session, the returned record carries
 *      expires_at (the TTL), and an impersonation_started audit row is written.
 *   4. GET filters on ended_at IS NULL + expires_at > now (the active-session
 *      gate) and reports `active:false` when no row matches.
 *
 * Mocking style mirrors verification-queue-actions.test.ts — chainable
 * supabaseAdmin boundary mock, authorizeAdmin / logAdminAudit at the seam.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const authorizeAdmin = vi.fn();
const logAdminAudit = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/admin-auth', () => ({
  authorizeAdmin: (...args: unknown[]) => authorizeAdmin(...args),
  logAdminAudit: (...args: unknown[]) => logAdminAudit(...args),
  isValidUUID: (s: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
}));

// ─── Chainable Supabase mock ──────────────────────────────────────────
//
// POST flow:
//   .from('students').select('id').eq('id', studentId).single()   → student
//   .from('admin_impersonation_sessions').update({ended_at}).eq().is()  → end prior
//   .from('admin_impersonation_sessions').insert(payload).select(...).single() → new
// GET flow:
//   .from('admin_impersonation_sessions').select(...).eq().eq().is().gt().order().limit()

interface CannedSingle {
  data: unknown;
  error: unknown;
}

let studentSingle: CannedSingle = { data: { id: 'student' }, error: null };
let insertSingle: CannedSingle = { data: null, error: null };
let listResult: CannedSingle = { data: [], error: null };

const insertCalls: Array<{ table: string; payload: unknown }> = [];
const filters: Record<string, unknown[]> = {};

function record(name: string, value: unknown) {
  (filters[name] ??= []).push(value);
}

function makeChainable(table: string) {
  // .single() resolves differently depending on whether an insert preceded it.
  let insertedHere = false;
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn((col: string, val: unknown) => {
      record(`eq:${col}`, val);
      return chain;
    }),
    is: vi.fn((col: string, val: unknown) => {
      record(`is:${col}`, val);
      return chain;
    }),
    gt: vi.fn((col: string, val: unknown) => {
      record(`gt:${col}`, val);
      return chain;
    }),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    update: vi.fn(() => chain),
    insert: vi.fn((payload: unknown) => {
      insertedHere = true;
      insertCalls.push({ table, payload });
      return chain;
    }),
    single: vi.fn(() => {
      if (table === 'students') return Promise.resolve(studentSingle);
      if (insertedHere) return Promise.resolve(insertSingle);
      return Promise.resolve(studentSingle);
    }),
    // Terminal list/update awaits resolve here (GET .limit(), POST end-prior).
    then: (resolve: (r: unknown) => unknown) => Promise.resolve(listResult).then(resolve),
  };
  return chain;
}

const supabaseStub = { from: vi.fn((table: string) => makeChainable(table)) };

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: supabaseStub,
  getSupabaseAdmin: () => supabaseStub,
}));

// ─── Fixtures ─────────────────────────────────────────────────────────

const STUDENT_UUID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ROW_ID = '22222222-2222-4222-8222-222222222222';
const ADMIN_UID = '33333333-3333-4333-8333-333333333333';

const AUTH_OK = {
  authorized: true as const,
  userId: ADMIN_UID,
  adminId: ADMIN_ROW_ID,
  email: 'admin@test.com',
  name: 'Test Admin',
  adminLevel: 'super_admin',
};

const AUTH_DENIED = () => ({
  authorized: false as const,
  response: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
});

function impReq(method: string, id: string): NextRequest {
  return new NextRequest(`http://localhost/api/super-admin/students/${id}/impersonate`, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  insertCalls.length = 0;
  for (const k of Object.keys(filters)) delete filters[k];
  studentSingle = { data: { id: STUDENT_UUID }, error: null };
  insertSingle = { data: null, error: null };
  listResult = { data: [], error: null };
  authorizeAdmin.mockResolvedValue(AUTH_DENIED());
});

// ─── POST start — level gate ──────────────────────────────────────────

describe('POST impersonate — super_admin gate', () => {
  it('asks authorizeAdmin for super_admin and returns its denial (403), minting no session and no audit', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_DENIED());
    const { POST } = await import('@/app/api/super-admin/students/[id]/impersonate/route');

    const res = await POST(impReq('POST', STUDENT_UUID), ctx(STUDENT_UUID));

    expect(res.status).toBe(403);
    expect(authorizeAdmin.mock.calls[0][1]).toBe('super_admin');
    // No session minted, no PII access, no audit on denial.
    expect(supabaseStub.from).not.toHaveBeenCalled();
    expect(insertCalls).toHaveLength(0);
    expect(logAdminAudit).not.toHaveBeenCalled();
  });
});

// ─── POST start — id validation ───────────────────────────────────────

describe('POST impersonate — id validation', () => {
  it('returns 400 for a non-UUID student id before any DB I/O', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_OK);
    const { POST } = await import('@/app/api/super-admin/students/[id]/impersonate/route');

    const res = await POST(impReq('POST', 'not-a-uuid'), ctx('not-a-uuid'));

    expect(res.status).toBe(400);
    expect(supabaseStub.from).not.toHaveBeenCalled();
    expect(insertCalls).toHaveLength(0);
    expect(logAdminAudit).not.toHaveBeenCalled();
  });
});

// ─── POST start — happy path: session + TTL + audit ───────────────────

describe('POST impersonate — happy path', () => {
  it('creates an impersonation session carrying an expiry and writes an impersonation_started audit row', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_OK);
    studentSingle = { data: { id: STUDENT_UUID }, error: null };
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    insertSingle = {
      data: {
        id: 'session-1',
        admin_id: ADMIN_ROW_ID,
        student_id: STUDENT_UUID,
        started_at: new Date().toISOString(),
        expires_at: expiresAt,
        pages_viewed: 0,
        ip_address: '203.0.113.7',
      },
      error: null,
    };

    const { POST } = await import('@/app/api/super-admin/students/[id]/impersonate/route');
    const res = await POST(impReq('POST', STUDENT_UUID), ctx(STUDENT_UUID));

    expect(res.status).toBe(201);
    const body = await res.json();

    // A session row was inserted scoped to this admin + student.
    const insert = insertCalls.find((c) => c.table === 'admin_impersonation_sessions');
    expect(insert).toBeDefined();
    expect(insert!.payload).toEqual(
      expect.objectContaining({ admin_id: ADMIN_ROW_ID, student_id: STUDENT_UUID }),
    );

    // The minted session carries a TTL/expiry — without it the GET gate
    // (`expires_at > now`) could never return it.
    expect(body.session).toEqual(expect.objectContaining({ expires_at: expiresAt }));
    expect(new Date(body.session.expires_at).getTime()).toBeGreaterThan(Date.now());

    // Audit row: WHO impersonated WHOM.
    expect(logAdminAudit).toHaveBeenCalledTimes(1);
    const [adminArg, action, entityType, entityId] = logAdminAudit.mock.calls[0];
    expect(adminArg).toMatchObject({ adminId: ADMIN_ROW_ID });
    expect(action).toBe('impersonation_started');
    expect(entityType).toBe('student');
    expect(entityId).toBe(STUDENT_UUID);
  });

  it('returns 404 (no session minted) when the target student does not exist', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_OK);
    studentSingle = { data: null, error: null };

    const { POST } = await import('@/app/api/super-admin/students/[id]/impersonate/route');
    const res = await POST(impReq('POST', STUDENT_UUID), ctx(STUDENT_UUID));

    expect(res.status).toBe(404);
    expect(insertCalls).toHaveLength(0);
    expect(logAdminAudit).not.toHaveBeenCalled();
  });
});

// ─── GET read state — active-session gate ─────────────────────────────

describe('GET impersonate — active-session gate', () => {
  it('reads only sessions that are unended AND not expired, reporting active:false when none match', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_OK);
    listResult = { data: [], error: null }; // no active session row

    const { GET } = await import('@/app/api/super-admin/students/[id]/impersonate/route');
    const res = await GET(impReq('GET', STUDENT_UUID), ctx(STUDENT_UUID));

    expect(res.status).toBe(200);
    const body = await res.json();

    // Without an active, non-expired session row, impersonation cannot proceed.
    expect(body.active).toBe(false);
    expect(body.session).toBeNull();
    expect(body.remainingSeconds).toBe(0);

    // The route filtered on the active-session predicates.
    expect(filters['is:ended_at']).toContain(null);
    expect(filters['gt:expires_at']).toBeDefined();
    expect(filters['gt:expires_at']!.length).toBeGreaterThan(0);
  });

  it('GET read requires only the "support" level', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_OK);
    const { GET } = await import('@/app/api/super-admin/students/[id]/impersonate/route');
    await GET(impReq('GET', STUDENT_UUID), ctx(STUDENT_UUID));
    expect(authorizeAdmin.mock.calls[0][1]).toBe('support');
  });
});
