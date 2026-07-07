/**
 * DELETE /api/super-admin/institutions — soft/hard tenant delete contract.
 *
 * Pins the two-step ramp added by the institutions DELETE handler:
 *
 *   1. Soft delete (?id=<uuid>): PATCH writes deleted_at + is_active=false
 *      and audits `soft_delete_school`. Refuses if the row is already
 *      soft-deleted (operator probably meant ?force=true).
 *   2. Hard delete (?id=<uuid>&force=true): only allowed when the row is
 *      ALREADY soft-deleted. Hard-deleting a live row returns 400 with an
 *      actionable error ("soft-delete first, then re-run with ?force=true").
 *      This is the load-bearing safety check — drop it and a single
 *      misclick can cascade-nuke a live tenant's students/subscriptions.
 *   3. Validates the id query param: missing or non-UUID → 400.
 *   4. 404 when the school does not exist.
 *
 * Mocking style mirrors src/__tests__/api/super-admin/institutions-pause.test.ts.
 * Auth is mocked authorized (super_admin) — the gate itself is pinned in
 * rbac-elevation.test.ts.
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

interface FetchCall { url: string; method: string; body: unknown; init: RequestInit | undefined; }
let fetchCalls: FetchCall[] = [];
let fetchResponses: Array<{ ok: boolean; status: number; body: unknown }> = [];

beforeEach(() => {
  fetchCalls = [];
  fetchResponses = [];
  authorizeAdmin.mockReset();
  logAdminAudit.mockReset();

  authorizeAdmin.mockResolvedValue({
    authorized: true,
    userId: 'auth-user-1',
    adminId: 'admin-1',
    email: 'ops@alfanumrik.com',
    name: 'Ops',
    adminLevel: 'super_admin',
  });
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
    fetchCalls.push({ url, method, body, init });
    const r = fetchResponses.shift() ?? { ok: true, status: 200, body: [] };
    return new Response(JSON.stringify(r.body), { status: r.status });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

import { DELETE } from '@/app/api/super-admin/institutions/route';

const SCHOOL_ID = '11111111-1111-4111-8111-111111111111';
const SCHOOL_NAME = 'Delhi Public School';

function makeRequest(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, { method: 'DELETE' });
}

describe('DELETE /api/super-admin/institutions', () => {
  it('400 when id query param is missing', async () => {
    const res = await DELETE(makeRequest('/api/super-admin/institutions'));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/id/i);
    // No DB lookup should fire when validation fails up-front.
    expect(fetchCalls).toHaveLength(0);
    expect(logAdminAudit).not.toHaveBeenCalled();
  });

  it('400 when id is not a valid UUID', async () => {
    const res = await DELETE(makeRequest('/api/super-admin/institutions?id=not-a-uuid'));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/id/i);
    expect(fetchCalls).toHaveLength(0);
    expect(logAdminAudit).not.toHaveBeenCalled();
  });

  it('200 soft-delete happy path: writes deleted_at + is_active=false and audits soft_delete_school', async () => {
    // 1st fetch: lookup — row exists, not yet soft-deleted.
    fetchResponses.push({
      ok: true,
      status: 200,
      body: [{ id: SCHOOL_ID, name: SCHOOL_NAME, is_active: true, deleted_at: null }],
    });
    // 2nd fetch: PATCH soft-delete — returns the updated row.
    fetchResponses.push({
      ok: true,
      status: 200,
      body: [{ id: SCHOOL_ID, deleted_at: 'set-by-server', is_active: false }],
    });

    const res = await DELETE(makeRequest(`/api/super-admin/institutions?id=${SCHOOL_ID}`));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({ id: SCHOOL_ID, mode: 'soft' });
    expect(typeof body.data.deleted_at).toBe('string');

    // PATCH payload must carry deleted_at + is_active=false.
    const patch = fetchCalls.find((c) => c.method === 'PATCH');
    expect(patch).toBeTruthy();
    expect(patch!.body).toMatchObject({ is_active: false });
    expect(typeof (patch!.body as Record<string, unknown>).deleted_at).toBe('string');

    expect(logAdminAudit).toHaveBeenCalledWith(
      expect.anything(),
      'soft_delete_school',
      'schools',
      SCHOOL_ID,
      expect.objectContaining({ school_name: SCHOOL_NAME }),
    );

    // No hard DELETE should fire on the soft path.
    expect(fetchCalls.find((c) => c.method === 'DELETE')).toBeUndefined();
  });

  it('404 when the school does not exist', async () => {
    // Lookup returns empty.
    fetchResponses.push({ ok: true, status: 200, body: [] });

    const res = await DELETE(makeRequest(`/api/super-admin/institutions?id=${SCHOOL_ID}`));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toMatch(/not found/i);
    // Only the lookup fired; no PATCH or DELETE.
    expect(fetchCalls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
    expect(fetchCalls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
    expect(logAdminAudit).not.toHaveBeenCalled();
  });

  it('200 hard-delete on already soft-deleted row: cascades and audits hard_delete_school', async () => {
    // 1st fetch: lookup — row is already soft-deleted (deleted_at is non-null).
    fetchResponses.push({
      ok: true,
      status: 200,
      body: [{ id: SCHOOL_ID, name: SCHOOL_NAME, is_active: false, deleted_at: '2026-05-19T00:00:00Z' }],
    });
    // 2nd fetch: DELETE hard — returns minimal.
    fetchResponses.push({ ok: true, status: 200, body: [] });

    const res = await DELETE(makeRequest(`/api/super-admin/institutions?id=${SCHOOL_ID}&force=true`));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({ id: SCHOOL_ID, mode: 'hard' });

    // A real DELETE must fire (not just a PATCH).
    const hardDelete = fetchCalls.find((c) => c.method === 'DELETE');
    expect(hardDelete).toBeTruthy();
    expect(hardDelete!.url).toContain(`id=eq.${SCHOOL_ID}`);

    expect(logAdminAudit).toHaveBeenCalledWith(
      expect.anything(),
      'hard_delete_school',
      'schools',
      SCHOOL_ID,
      expect.objectContaining({
        school_name: SCHOOL_NAME,
        previous_soft_deleted_at: '2026-05-19T00:00:00Z',
      }),
    );
  });

  it('400 when force=true on a school that is NOT yet soft-deleted (actionable error)', async () => {
    // Lookup: row exists and is live (deleted_at: null).
    fetchResponses.push({
      ok: true,
      status: 200,
      body: [{ id: SCHOOL_ID, name: SCHOOL_NAME, is_active: true, deleted_at: null }],
    });

    const res = await DELETE(makeRequest(`/api/super-admin/institutions?id=${SCHOOL_ID}&force=true`));
    const body = await res.json();

    expect(res.status).toBe(400);
    // Actionable error: tells the operator to soft-delete first.
    expect(body.error).toMatch(/soft-delete first/i);

    // No DELETE or PATCH should fire — the safety check must block before any
    // destructive call.
    expect(fetchCalls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
    expect(fetchCalls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
    expect(logAdminAudit).not.toHaveBeenCalled();
  });
});
