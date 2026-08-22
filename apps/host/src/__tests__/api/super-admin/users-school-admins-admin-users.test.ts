/**
 * PATCH /api/super-admin/users — school_admins + admin_users branches.
 *
 * Pins the two foot-gun guards layered on top of the standard suspend/
 * restore/plan-change flow:
 *
 *   1. school_admins reassignment: target school_id must exist (not
 *      soft-deleted) BEFORE the school_admins row is rewritten. Skipping
 *      this check silently orphans the admin's RLS access.
 *   2. admin_users self-edit guard: caller cannot change THEIR OWN
 *      admin_level. Returns 400 with a "have another super_admin do it"
 *      message so a super_admin can't accidentally demote themselves and
 *      lose access to the platform.
 *   3. admin_users peer demotion: a super_admin caller CAN change another
 *      super_admin's level (the route's super_admin gate already covers
 *      this — the secondary `auth.adminLevel !== 'super_admin'` guard at
 *      line 162 only triggers when the gate is loosened). Pinning the
 *      success path here so any future re-tightening is intentional, not
 *      drift.
 *
 * Auth is mocked super_admin throughout — the gate itself is pinned in
 * rbac-elevation.test.ts.
 *
 * Mocking style mirrors src/__tests__/api/super-admin/institutions-pause.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const authorizeAdmin = vi.fn();
const logAdminAudit = vi.fn();

vi.mock('@alfanumrik/lib/admin-auth', () => ({
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

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

interface FetchCall { url: string; method: string; body: unknown; }
let fetchCalls: FetchCall[] = [];
let fetchResponses: Array<{ ok: boolean; status: number; body: unknown }> = [];

beforeEach(() => {
  fetchCalls = [];
  fetchResponses = [];
  authorizeAdmin.mockReset();
  logAdminAudit.mockReset();
  logAdminAudit.mockResolvedValue(undefined);

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://stub.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub';

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL | Request).toString();
    const method = (init?.method || 'GET').toUpperCase();
    let body: unknown = undefined;
    if (init?.body) {
      try { body = JSON.parse(String(init.body)); } catch { body = init.body; }
    }
    fetchCalls.push({ url, method, body });
    const r = fetchResponses.shift() ?? { ok: true, status: 200, body: [] };
    return new Response(JSON.stringify(r.body), { status: r.status });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

import { PATCH } from '@/app/api/super-admin/users/route';

const SELF_AUTH_USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_ADMIN_ROW_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER_ADMIN_AUTH_USER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SELF_ADMIN_ROW_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SCHOOL_ADMIN_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const SCHOOL_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/super-admin/users', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function authAsSuperAdmin(): void {
  authorizeAdmin.mockResolvedValue({
    authorized: true,
    userId: SELF_AUTH_USER_ID,
    adminId: 'admin-row-self',
    email: 'ops@alfanumrik.com',
    name: 'Self Super Admin',
    adminLevel: 'super_admin',
  });
}

describe('PATCH /api/super-admin/users — school_admins + admin_users branches', () => {
  it('school_admins reassignment: verifies target school exists before updating', async () => {
    authAsSuperAdmin();
    // 1st fetch: schools lookup — target school exists (not soft-deleted).
    fetchResponses.push({ ok: true, status: 200, body: [{ id: SCHOOL_ID }] });
    // 2nd fetch: PATCH school_admins — minimal return.
    fetchResponses.push({ ok: true, status: 200, body: [] });

    const res = await PATCH(makeRequest({
      table: 'school_admins',
      user_id: SCHOOL_ADMIN_ID,
      updates: { school_id: SCHOOL_ID },
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);

    // First call must be the schools existence check, second the actual PATCH.
    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[0].url).toContain('/schools');
    expect(fetchCalls[0].url).toContain(`id=eq.${SCHOOL_ID}`);
    expect(fetchCalls[0].url).toContain('deleted_at=is.null');
    expect(fetchCalls[0].method).toBe('GET');

    expect(fetchCalls[1].method).toBe('PATCH');
    expect(fetchCalls[1].url).toContain('/school_admins');
    expect(fetchCalls[1].url).toContain(`id=eq.${SCHOOL_ADMIN_ID}`);
    expect(fetchCalls[1].body).toMatchObject({ school_id: SCHOOL_ID });

    expect(logAdminAudit).toHaveBeenCalledWith(
      expect.anything(),
      'school_admin.reassigned',
      'school_admins',
      SCHOOL_ADMIN_ID,
      expect.objectContaining({ updates: expect.objectContaining({ school_id: SCHOOL_ID }) }),
    );
  });

  it('admin_users self-edit guard: caller changing OWN admin_level returns 400', async () => {
    authAsSuperAdmin();
    // 1st fetch: admin_users lookup — target row's auth_user_id matches the caller.
    fetchResponses.push({
      ok: true,
      status: 200,
      body: [{ id: SELF_ADMIN_ROW_ID, auth_user_id: SELF_AUTH_USER_ID, admin_level: 'super_admin' }],
    });

    const res = await PATCH(makeRequest({
      table: 'admin_users',
      user_id: SELF_ADMIN_ROW_ID,
      updates: { admin_level: 'admin' },
    }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/another super_admin/i);

    // Only the lookup fired; the PATCH must NOT run.
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].method).toBe('GET');
    expect(fetchCalls[0].url).toContain('/admin_users');
    expect(logAdminAudit).not.toHaveBeenCalled();
  });

  it('admin_users peer demotion: super_admin caller CAN change another super_admin\'s level', async () => {
    // The route's own super_admin gate is already covered in rbac-elevation
    // .test.ts. The defense-in-depth check at line 162 only blocks the
    // mutation when caller is NOT super_admin — so a super_admin demoting
    // another super_admin proceeds. This test pins that, so any future
    // re-tightening is intentional.
    authAsSuperAdmin();
    // 1st fetch: admin_users lookup — target is a DIFFERENT super_admin row.
    fetchResponses.push({
      ok: true,
      status: 200,
      body: [{ id: OTHER_ADMIN_ROW_ID, auth_user_id: OTHER_ADMIN_AUTH_USER_ID, admin_level: 'super_admin' }],
    });
    // 2nd fetch: PATCH admin_users.
    fetchResponses.push({ ok: true, status: 200, body: [] });

    const res = await PATCH(makeRequest({
      table: 'admin_users',
      user_id: OTHER_ADMIN_ROW_ID,
      updates: { admin_level: 'admin' },
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);

    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[1].method).toBe('PATCH');
    expect(fetchCalls[1].url).toContain('/admin_users');
    expect(fetchCalls[1].url).toContain(`id=eq.${OTHER_ADMIN_ROW_ID}`);
    expect(fetchCalls[1].body).toMatchObject({ admin_level: 'admin' });

    expect(logAdminAudit).toHaveBeenCalledWith(
      expect.anything(),
      'admin.level_changed',
      'admin_users',
      OTHER_ADMIN_ROW_ID,
      expect.objectContaining({ updates: expect.objectContaining({ admin_level: 'admin' }) }),
    );
  });
});
