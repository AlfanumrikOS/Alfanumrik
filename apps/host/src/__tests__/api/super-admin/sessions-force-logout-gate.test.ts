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
 * Unlike the sibling `rbac-elevation.test.ts` / `mutation-gate-pins.test.ts`
 * gate-pin files, this test drives the REAL `authorizeAdmin()` (not mocked)
 * through its full tier ladder — GoTrue token verification + admin_users
 * lookup — for all 6 admin levels, so the assertion is "the production
 * hasMinimumLevel comparison denies/allows at the right rank", not merely
 * "the route passed the string 'admin' to a mock". Only the downstream
 * data seam (`getSupabaseAdmin()`) is mocked, since session revocation is
 * out of scope for an auth-gate test.
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
 * Drives the REAL authorizeAdmin() code path: mocks only the two fetch
 * calls it makes (GoTrue /auth/v1/user, then the admin_users REST lookup),
 * returning `adminLevel` for the caller. Any other fetch (the fire-and-
 * forget logAdminAudit dual-write) is accepted silently — this test is not
 * about the audit write.
 */
function mockFetchForLevel(adminLevel: AdminLevel) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: ADMIN_UID, email: 'admin@x.com' }), { status: 200 });
    }
    if (url.includes('/admin_users')) {
      return new Response(
        JSON.stringify([{ id: 'admin-row-1', name: 'Admin', email: 'admin@x.com', admin_level: adminLevel }]),
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

  it.each(belowFloor)('returns 403 ADMIN_INSUFFICIENT_LEVEL for a %s-tier admin', async (level) => {
    mockFetchForLevel(level);
    const { POST } = await import('@/app/api/super-admin/sessions/route');

    const res = await POST(postReq());

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('ADMIN_INSUFFICIENT_LEVEL');
    expect(body.required_level).toBe('admin');

    // Denial short-circuits before any session revocation / signOut.
    expect(revokeSelect).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  const atOrAboveFloor: AdminLevel[] = ['admin', 'super_admin'];

  it.each(atOrAboveFloor)('passes the auth gate and revokes sessions for a %s-tier admin', async (level) => {
    mockFetchForLevel(level);
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
});
