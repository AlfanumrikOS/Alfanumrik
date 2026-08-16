/**
 * POST /api/super-admin/sessions — force-logout tier gate.
 *
 * Phase 0 super-admin overhaul (2026-08-16), "force-logout safety" release
 * blocker: the destructive force-logout action (revoke every active session
 * for a user + global GoTrue signOut) was gated at 'support' — the FLOOR of
 * the ADMIN_LEVELS ladder (support < analyst < content_manager < finance <
 * admin < super_admin) — so ANY active admin_users row, regardless of tier,
 * could kick any user off every device. The route now requires 'admin' or
 * higher (`apps/host/src/app/api/super-admin/sessions/route.ts` POST).
 *
 * UPDATED for Phase 1 (2026-08-16, Mission Control overhaul pilot
 * migration): the route now calls `authorizeOperator()` instead of
 * `authorizeAdmin()` — RBAC (user_roles/roles) is the authorization source
 * instead of admin_users.admin_level directly. This file still drives the
 * REAL `authorizeOperator()` (not mocked) through its full tier ladder —
 * GoTrue token verification + RBAC permission lookup — for all 6 operator
 * levels, so the assertion remains "the production hasMinimumLevel
 * comparison denies/allows at the right rank", not merely "the route passed
 * the string 'admin' to a mock". This IS this repo's parity proof that
 * authorizeOperator() ranks/denies/allows identically to authorizeAdmin()
 * on a real pilot route (see also apps/host/src/__tests__/lib/
 * authorize-operator.test.ts for the function-level parity matrix). Only
 * the downstream data seam (`getSupabaseAdmin()`) and the RBAC permission
 * lookup (`getUserPermissions()`) are mocked; GoTrue verification and the
 * hasMinimumLevel rank comparison run for real.
 *
 * GET (list sessions) is intentionally NOT touched here — it stays at
 * 'support' (read-only, metadata-only response) per the route's own
 * documentation; this file only exercises the POST (destructive) gate.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { AdminLevel } from '@alfanumrik/lib/admin-auth';

// ─── Downstream data seam (post-auth-gate only) ──────────────────────────

const revokeSelect = vi.fn();
const signOut = vi.fn();
const insertIdentityEvent = vi.fn();

function makeSupabaseAdminStub() {
  return {
    from: vi.fn((table: string) => {
      if (table === 'user_active_sessions') {
        return {
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn(() => revokeSelect()),
              })),
            })),
          })),
        };
      }
      if (table === 'identity_events') {
        return { insert: insertIdentityEvent };
      }
      throw new Error(`sessions-force-logout-gate.test.ts: unexpected table "${table}"`);
    }),
    auth: { admin: { signOut } },
  };
}

let supabaseAdminStub = makeSupabaseAdminStub();

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => supabaseAdminStub,
}));

// ─── RBAC permission lookup (the authorizeOperator() authorization source) ──
// authorizeOperator() resolves the caller's operator tier from
// getUserPermissions().roles — mocked per-test to the RBAC role matching the
// tier under test (identity map: role name === AdminLevel string, per the
// sync_admin_level_to_rbac_role() trigger in migration 20260816000008).

const getUserPermissions = vi.fn();

vi.mock('@alfanumrik/lib/rbac', () => ({
  getUserPermissions: (...args: unknown[]) => getUserPermissions(...args),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────

const ADMIN_UID = '33333333-3333-4333-8333-333333333333';
const TARGET_UID = '44444444-4444-4444-8444-444444444444';

function postReq(): NextRequest {
  return new NextRequest('http://localhost/api/super-admin/sessions', {
    method: 'POST',
    body: JSON.stringify({ user_id: TARGET_UID }),
    headers: { 'content-type': 'application/json', Authorization: 'Bearer good-token' },
  });
}

/**
 * Drives the REAL authorizeOperator() code path: mocks the GoTrue
 * /auth/v1/user fetch, the best-effort admin_users enrichment fetch
 * authorizeOperator() makes post-authorization, and sets getUserPermissions()
 * to report the caller holding exactly the RBAC role matching `level`. Any
 * other fetch (the fire-and-forget logAdminAudit dual-write) is accepted
 * silently — this test is not about the audit write.
 */
function setupCallerTier(level: AdminLevel) {
  getUserPermissions.mockReset().mockResolvedValue({
    roles: [{ name: level, display_name: level, hierarchy_level: 0 }],
    permissions: [],
  });
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: ADMIN_UID, email: 'admin@x.com' }), { status: 200 });
    }
    if (url.includes('/admin_users')) {
      return new Response(
        JSON.stringify([{ id: 'admin-row-1', name: 'Admin', email: 'admin@x.com' }]),
        { status: 200 },
      );
    }
    // admin_audit_log / audit_logs writes from the fire-and-forget audit call.
    return new Response('', { status: 201 });
  });
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-key';
  supabaseAdminStub = makeSupabaseAdminStub();
  revokeSelect.mockReset().mockResolvedValue({ data: [{ id: 'sess-1' }], error: null });
  signOut.mockReset().mockResolvedValue({ error: null });
  insertIdentityEvent.mockReset().mockResolvedValue({ data: null, error: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/super-admin/sessions — force-logout requires admin tier or higher', () => {
  const belowFloor: AdminLevel[] = ['support', 'analyst', 'content_manager', 'finance'];

  it.each(belowFloor)('returns 403 OPERATOR_INSUFFICIENT_LEVEL for a %s-tier operator', async (level) => {
    setupCallerTier(level);
    const { POST } = await import('@/app/api/super-admin/sessions/route');

    const res = await POST(postReq());

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('OPERATOR_INSUFFICIENT_LEVEL');
    expect(body.required_level).toBe('admin');

    // Denial short-circuits before any session revocation / signOut.
    expect(revokeSelect).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  const atOrAboveFloor: AdminLevel[] = ['admin', 'super_admin'];

  it.each(atOrAboveFloor)('passes the auth gate and revokes sessions for a %s-tier operator', async (level) => {
    setupCallerTier(level);
    const { POST } = await import('@/app/api/super-admin/sessions/route');

    const res = await POST(postReq());

    // Non-vacuity: proves the deny assertions above aren't just "always 403".
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('revoked');
    expect(body.sessions_revoked).toBe(1);

    expect(revokeSelect).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith(TARGET_UID, 'global');
  });

  it('denies a caller with NO operator-tier RBAC role at all (OPERATOR_NOT_FOUND)', async () => {
    getUserPermissions.mockReset().mockResolvedValue({
      roles: [{ name: 'teacher', display_name: 'Teacher', hierarchy_level: 50 }],
      permissions: [],
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/v1/user')) {
        return new Response(JSON.stringify({ id: ADMIN_UID, email: 'admin@x.com' }), { status: 200 });
      }
      return new Response('', { status: 201 });
    });

    const { POST } = await import('@/app/api/super-admin/sessions/route');
    const res = await POST(postReq());

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('OPERATOR_NOT_FOUND');
    expect(revokeSelect).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });
});
