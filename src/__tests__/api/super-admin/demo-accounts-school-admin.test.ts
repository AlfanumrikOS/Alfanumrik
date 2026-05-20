/**
 * POST /api/super-admin/demo-accounts — school_admin error-envelope contract.
 *
 * Pins the hardened error surface added when provisionDemoSchool() was
 * refactored to return a discriminated ProvisionResult union (instead of
 * collapsing every failure into a generic `profile_failed`):
 *
 *   - happy path: school_admins POST body stamps role='institution_admin'
 *     and the route returns { success: true, data: { school_id, ... } }.
 *   - schools INSERT 500 → response code `school_insert_failed` (HTTP 400)
 *     with `details`; auth user rollback fires; school_admins INSERT never
 *     runs.
 *   - schools INSERT returns [] → response code `school_id_missing` (HTTP
 *     400); auth user rollback fires.
 *   - school_admins INSERT 500 → response code `profile_failed` (HTTP 400)
 *     with school_admins in the message + truncated body in details; auth
 *     user rollback fires.
 *
 * (school_subscriptions non-blocking branch omitted to stay within the
 * 200-line cap — handled via the default 200/[] fetch fallback in beforeEach;
 * the happy path implicitly exercises that subscription's POST succeeds.)
 *
 * Mocking pattern mirrors src/__tests__/api/super-admin/institutions-pause.test.ts.
 * Only the admin-auth gate and global fetch are mocked. crypto/password and
 * validation run real per the testing contract.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── admin-auth mock (hoisted before route import) ─────────────────────

const authorizeAdmin = vi.fn();
const logAdminAudit = vi.fn();

vi.mock('@/lib/admin-auth', () => ({
  authorizeAdmin: (...args: unknown[]) => authorizeAdmin(...args),
  logAdminAudit: (...args: unknown[]) => logAdminAudit(...args),
  isValidUUID: (s: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
  supabaseAdminUrl: (table: string, params?: string) =>
    `https://stub.supabase.co/rest/v1/${table}${params ? `?${params}` : ''}`,
  supabaseAdminHeaders: (extra?: string) => ({
    apikey: 'stub',
    Authorization: 'Bearer stub',
    'Content-Type': 'application/json',
    ...(extra ? { Prefer: extra } : {}),
  }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── fetch capture ─────────────────────────────────────────────────────

interface FetchCall { url: string; method: string; body: unknown; init: RequestInit | undefined; }
let fetchCalls: FetchCall[] = [];
// Per-URL/method response queue. A queue is keyed by `${method} ${urlSubstring}`.
// Calls that don't match a queued response get a default `{ ok: true, status: 200, body: [] }`.
type CannedResponse = { ok: boolean; status: number; body: unknown };
let queues: Map<string, CannedResponse[]> = new Map();
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

function enqueue(matcher: string, response: CannedResponse) {
  const existing = queues.get(matcher) ?? [];
  existing.push(response);
  queues.set(matcher, existing);
}

beforeEach(() => {
  fetchCalls = [];
  queues = new Map();
  authorizeAdmin.mockReset();
  logAdminAudit.mockReset();

  authorizeAdmin.mockResolvedValue({
    authorized: true,
    userId: 'test-admin-uuid',
    adminId: 'admin-1',
    email: 'ops@alfanumrik.com',
    name: 'Test Ops',
    adminLevel: 'super_admin',
  });
  logAdminAudit.mockResolvedValue(undefined);

  // Required by getSupabaseConfig() inside the route (it reads process.env
  // directly, not through the admin-auth helper, so we set them here).
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://stub.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-service-role-key';

  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL | Request).toString();
    const method = (init?.method || 'GET').toUpperCase();
    let body: unknown = undefined;
    if (init?.body) {
      try { body = JSON.parse(String(init.body)); } catch { body = init.body; }
    }
    fetchCalls.push({ url, method, body, init });
    // Find first matching queued response (longest matcher wins so a more
    // specific match like `POST schools` beats a generic `POST *`).
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
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

import { POST } from '@/app/api/super-admin/demo-accounts/route';

const SCHOOL_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_AUTH_USER_ID = '22222222-2222-4222-8222-222222222222';
const SCHOOL_ADMIN_PROFILE_ID = '33333333-3333-4333-8333-333333333333';
const DEMO_ACCOUNT_ID = '44444444-4444-4444-8444-444444444444';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/super-admin/demo-accounts', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

const SCHOOL_ADMIN_BODY = {
  role: 'school_admin',
  name: 'Demo Principal',
  email: 'demo.principal@alfanumrik.demo',
};

describe('POST /api/super-admin/demo-accounts — school_admin error envelope', () => {
  it('happy path: stamps role=institution_admin and returns success with school_id', async () => {
    // 1. auth user create (creates the admin's user)
    enqueue('POST auth/v1/admin/users', { ok: true, status: 200, body: { id: ADMIN_AUTH_USER_ID } });
    // 2. schools INSERT
    enqueue('POST /rest/v1/schools', { ok: true, status: 200, body: [{ id: SCHOOL_ID }] });
    // 3. school_subscriptions INSERT (best-effort — default 200/[] is fine)
    // 4-6. 3 seed students each: POST auth user (then default 200/[] for the
    //     students INSERT and subscription PATCH/POST). Default fetch shape
    //     handles those non-asserted paths.
    // 7. school_admins POST — RETURNED with profile id
    enqueue('POST /rest/v1/school_admins', { ok: true, status: 200, body: [{ id: SCHOOL_ADMIN_PROFILE_ID }] });
    // 8. demo_accounts POST — returns registry row id
    enqueue('POST /rest/v1/demo_accounts', { ok: true, status: 200, body: [{ id: DEMO_ACCOUNT_ID }] });

    const res = await POST(makeRequest(SCHOOL_ADMIN_BODY));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toMatchObject({
      auth_user_id: ADMIN_AUTH_USER_ID,
      school_id: SCHOOL_ID,
      profile_id: SCHOOL_ADMIN_PROFILE_ID,
      demo_account_id: DEMO_ACCOUNT_ID,
      role: 'school_admin',
      email: SCHOOL_ADMIN_BODY.email,
    });

    // school_admins INSERT payload must explicitly stamp role='institution_admin'
    const adminInsert = fetchCalls.find(
      (c) => c.method === 'POST' && c.url.includes('/rest/v1/school_admins'),
    );
    expect(adminInsert).toBeTruthy();
    expect(adminInsert!.body).toMatchObject({
      auth_user_id: ADMIN_AUTH_USER_ID,
      name: SCHOOL_ADMIN_BODY.name,
      email: SCHOOL_ADMIN_BODY.email,
      role: 'institution_admin',
      school_id: SCHOOL_ID,
      is_demo: true,
    });

    // No auth-user DELETE should fire on the happy path
    const rollback = fetchCalls.find(
      (c) => c.method === 'DELETE' && c.url.includes(`/auth/v1/admin/users/${ADMIN_AUTH_USER_ID}`),
    );
    expect(rollback).toBeUndefined();
  });

  it('returns login_url + login_instructions in response for school_admin role', async () => {
    // Same happy-path mock sequence as the test above — exercises the
    // loginRoutingForRole() switch added 2026-05-20 so demo modals / Slack
    // DMs / ops emails can route operators to /login (not /super-admin/login)
    // for school_admin creds.
    enqueue('POST auth/v1/admin/users', { ok: true, status: 200, body: { id: ADMIN_AUTH_USER_ID } });
    enqueue('POST /rest/v1/schools', { ok: true, status: 200, body: [{ id: SCHOOL_ID }] });
    enqueue('POST /rest/v1/school_admins', { ok: true, status: 200, body: [{ id: SCHOOL_ADMIN_PROFILE_ID }] });
    enqueue('POST /rest/v1/demo_accounts', { ok: true, status: 200, body: [{ id: DEMO_ACCOUNT_ID }] });

    const res = await POST(makeRequest(SCHOOL_ADMIN_BODY));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.login_url).toBe('/login');
    expect(typeof json.data.login_instructions).toBe('string');
    expect(json.data.login_instructions).toContain('/login');
    expect(json.data.login_instructions).toContain('/school-admin');
  });

  it('returns school_insert_failed when schools INSERT rejects (rollback fires, school_admins never called)', async () => {
    enqueue('POST auth/v1/admin/users', { ok: true, status: 200, body: { id: ADMIN_AUTH_USER_ID } });
    enqueue('POST /rest/v1/schools', { ok: false, status: 500, body: { message: 'duplicate key violates unique constraint "schools_name_key"' } });

    const res = await POST(makeRequest(SCHOOL_ADMIN_BODY));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toMatchObject({
      success: false,
      code: 'school_insert_failed',
      message: 'Failed to provision demo school',
    });
    expect(json.details).toEqual(expect.any(String));
    expect(json.details.length).toBeGreaterThan(0);

    // Rollback DELETE on the auth user fires
    const rollback = fetchCalls.find(
      (c) => c.method === 'DELETE' && c.url.includes(`/auth/v1/admin/users/${ADMIN_AUTH_USER_ID}`),
    );
    expect(rollback).toBeTruthy();

    // school_admins INSERT must NOT have been called
    const adminInsert = fetchCalls.find(
      (c) => c.method === 'POST' && c.url.includes('/rest/v1/school_admins'),
    );
    expect(adminInsert).toBeUndefined();
  });

  it('returns school_id_missing when schools INSERT returns an empty array (rollback fires)', async () => {
    enqueue('POST auth/v1/admin/users', { ok: true, status: 200, body: { id: ADMIN_AUTH_USER_ID } });
    enqueue('POST /rest/v1/schools', { ok: true, status: 200, body: [] }); // empty — no id

    const res = await POST(makeRequest(SCHOOL_ADMIN_BODY));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toMatchObject({
      success: false,
      code: 'school_id_missing',
      message: 'Failed to provision demo school',
    });

    const rollback = fetchCalls.find(
      (c) => c.method === 'DELETE' && c.url.includes(`/auth/v1/admin/users/${ADMIN_AUTH_USER_ID}`),
    );
    expect(rollback).toBeTruthy();
  });

  it('returns profile_failed when school_admins INSERT rejects (rollback fires, details truncated)', async () => {
    enqueue('POST auth/v1/admin/users', { ok: true, status: 200, body: { id: ADMIN_AUTH_USER_ID } });
    enqueue('POST /rest/v1/schools', { ok: true, status: 200, body: [{ id: SCHOOL_ID }] });
    // The DB trigger / RLS error that the operator sees in the real bug:
    const triggerError = 'ERROR: insert or update on table "school_admins" violates foreign key constraint "school_admins_school_id_fkey"\nDETAIL: Key (school_id)=(' + SCHOOL_ID + ') is not present in table "schools".';
    enqueue('POST /rest/v1/school_admins', { ok: false, status: 500, body: { message: triggerError } });

    const res = await POST(makeRequest(SCHOOL_ADMIN_BODY));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.code).toBe('profile_failed');
    expect(json.message).toMatch(/school_admins/);
    // details is the truncated PostgREST body (slice(0, 280))
    expect(typeof json.details).toBe('string');
    expect(json.details.length).toBeGreaterThan(0);
    expect(json.details.length).toBeLessThanOrEqual(280);

    // Auth user rollback fires
    const rollback = fetchCalls.find(
      (c) => c.method === 'DELETE' && c.url.includes(`/auth/v1/admin/users/${ADMIN_AUTH_USER_ID}`),
    );
    expect(rollback).toBeTruthy();
  });

  it('logs (does not fail) when school_subscriptions INSERT rejects mid-flow', async () => {
    enqueue('POST auth/v1/admin/users', { ok: true, status: 200, body: { id: ADMIN_AUTH_USER_ID } });
    enqueue('POST /rest/v1/schools', { ok: true, status: 200, body: [{ id: SCHOOL_ID }] });
    // sub failure → non-blocking
    enqueue('POST /rest/v1/school_subscriptions', { ok: false, status: 500, body: { message: 'plan_code not allowed' } });
    enqueue('POST /rest/v1/school_admins', { ok: true, status: 200, body: [{ id: SCHOOL_ADMIN_PROFILE_ID }] });
    enqueue('POST /rest/v1/demo_accounts', { ok: true, status: 200, body: [{ id: DEMO_ACCOUNT_ID }] });

    const res = await POST(makeRequest(SCHOOL_ADMIN_BODY));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.school_id).toBe(SCHOOL_ID);

    // The route logs the sub failure via console.error (non-blocking branch).
    const sawSubLog = consoleErrorSpy.mock.calls.some((call: unknown[]) =>
      String(call[0]).includes('school_subscriptions INSERT failed (non-blocking)'),
    );
    expect(sawSubLog).toBe(true);
  });
});
