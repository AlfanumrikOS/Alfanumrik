/**
 * POST /api/super-admin/login — USE_STANDARD_LOGIN redirect-suggestion contract.
 *
 * When a caller authenticates successfully but is NOT in admin_users AND IS
 * in a non-admin profile table (school_admins / teachers / guardians /
 * students), the route now returns 403 with `code: 'USE_STANDARD_LOGIN'`
 * plus `suggested_login_url` + `detected_role` so the login UI can redirect
 * the operator to /login instead of bouncing them with the generic
 * "not an authorized administrator" message. (Phase G follow-up 2026-05-20.)
 *
 * Mocking pattern mirrors demo-accounts-school-admin.test.ts: admin-auth +
 * admin-login-throttle stubbed, global fetch scripted via a per-URL queue.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── module mocks (hoisted before route import) ────────────────────────

const logAdminAuditByUserId = vi.fn();

vi.mock('@alfanumrik/lib/admin-auth', () => ({
  logAdminAuditByUserId: (...args: unknown[]) => logAdminAuditByUserId(...args),
  supabaseAdminUrl: (table: string, params?: string) =>
    `https://stub.supabase.co/rest/v1/${table}${params ? `?${params}` : ''}`,
  supabaseAdminHeaders: (extra?: string) => ({
    apikey: 'stub',
    Authorization: 'Bearer stub',
    'Content-Type': 'application/json',
    ...(extra ? { Prefer: extra } : {}),
  }),
}));

vi.mock('@alfanumrik/lib/admin-login-throttle', () => ({
  checkLockout: vi.fn().mockResolvedValue({ locked: false, attemptsInWindow: 0, windowMinutes: 15 }),
  recordLoginAttempt: vi.fn().mockResolvedValue(undefined),
  LOCKOUT_CONSTANTS: { WINDOW_MIN: 15, THRESHOLD: 5 },
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── fetch capture ─────────────────────────────────────────────────────

interface FetchCall { url: string; method: string; body: unknown; }
let fetchCalls: FetchCall[] = [];
type CannedResponse = { ok: boolean; status: number; body: unknown };
let queues: Map<string, CannedResponse[]> = new Map();

function enqueue(matcher: string, response: CannedResponse) {
  const existing = queues.get(matcher) ?? [];
  existing.push(response);
  queues.set(matcher, existing);
}

const AUTH_USER_ID = '99999999-9999-4999-8999-999999999999';

beforeEach(() => {
  fetchCalls = [];
  queues = new Map();
  logAdminAuditByUserId.mockReset();
  logAdminAuditByUserId.mockResolvedValue(undefined);

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://stub.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'stub-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-service-role-key';

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL | Request).toString();
    const method = (init?.method || 'GET').toUpperCase();
    let body: unknown = undefined;
    if (init?.body) {
      try { body = JSON.parse(String(init.body)); } catch { body = init.body; }
    }
    fetchCalls.push({ url, method, body });
    let chosen: CannedResponse | undefined;
    let chosenKey: string | undefined;
    for (const [key, list] of queues.entries()) {
      const [m, urlPart] = key.split(' ', 2);
      if (m === method && url.includes(urlPart) && list.length > 0) {
        if (!chosenKey || key.length > chosenKey.length) {
          chosen = list[0];
          chosenKey = key;
        }
      }
    }
    if (chosen && chosenKey) {
      queues.get(chosenKey)!.shift();
    } else {
      chosen = { ok: true, status: 200, body: [] };
    }
    return new Response(JSON.stringify(chosen.body), { status: chosen.status });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

import { POST } from '@/app/api/super-admin/login/route';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/super-admin/login', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.7' },
  });
}

const LOGIN_BODY = { email: 'demo.principal@alfanumrik.demo', password: 'Demo-secret-123' };

describe('POST /api/super-admin/login — USE_STANDARD_LOGIN redirect-suggestion', () => {
  it('returns USE_STANDARD_LOGIN with /school-admin suggestion when caller is a school_admin', async () => {
    // 1. Supabase Auth password-grant succeeds
    enqueue('POST /auth/v1/token', { ok: true, status: 200, body: { access_token: 'tok', refresh_token: 'rtk', user: { id: AUTH_USER_ID, email: LOGIN_BODY.email } } });
    // 2. admin_users lookup → empty (not a platform admin)
    enqueue('GET /rest/v1/admin_users', { ok: true, status: 200, body: [] });
    // 3. school_admins lookup → match (this is the demo school_admin operator)
    enqueue('GET /rest/v1/school_admins', { ok: true, status: 200, body: [{ id: 'sa-uuid' }] });

    const res = await POST(makeRequest(LOGIN_BODY));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.code).toBe('USE_STANDARD_LOGIN');
    expect(json.suggested_login_url).toBe('/login');
    expect(json.detected_role).toBe('school_admin');
  });

  it('returns USE_STANDARD_LOGIN with detected_role=teacher when caller is a teacher', async () => {
    enqueue('POST /auth/v1/token', { ok: true, status: 200, body: { access_token: 'tok', refresh_token: 'rtk', user: { id: AUTH_USER_ID, email: LOGIN_BODY.email } } });
    enqueue('GET /rest/v1/admin_users', { ok: true, status: 200, body: [] });
    enqueue('GET /rest/v1/school_admins', { ok: true, status: 200, body: [] });
    enqueue('GET /rest/v1/teachers', { ok: true, status: 200, body: [{ id: 'teacher-uuid' }] });

    const res = await POST(makeRequest(LOGIN_BODY));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.code).toBe('USE_STANDARD_LOGIN');
    expect(json.suggested_login_url).toBe('/login');
    expect(json.detected_role).toBe('teacher');
  });

  it('falls back to generic ADMIN_NOT_FOUND when caller exists in auth but no profile table matches', async () => {
    enqueue('POST /auth/v1/token', { ok: true, status: 200, body: { access_token: 'tok', refresh_token: 'rtk', user: { id: AUTH_USER_ID, email: LOGIN_BODY.email } } });
    enqueue('GET /rest/v1/admin_users', { ok: true, status: 200, body: [] });
    enqueue('GET /rest/v1/school_admins', { ok: true, status: 200, body: [] });
    enqueue('GET /rest/v1/teachers', { ok: true, status: 200, body: [] });
    enqueue('GET /rest/v1/guardians', { ok: true, status: 200, body: [] });
    enqueue('GET /rest/v1/students', { ok: true, status: 200, body: [] });

    const res = await POST(makeRequest(LOGIN_BODY));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.code).toBe('ADMIN_NOT_FOUND');
    expect(json.suggested_login_url).toBeUndefined();
    expect(json.detected_role).toBeUndefined();
  });
});
