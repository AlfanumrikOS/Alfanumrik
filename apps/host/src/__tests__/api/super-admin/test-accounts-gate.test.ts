/**
 * Test-account creation handler tests
 * (Phase 4 / 2026-06-11 — privilege-escalation surface coverage).
 *
 * Pins the gate + audit contract for
 *   src/app/api/super-admin/test-accounts/route.ts
 *
 * This route mints REAL auth users with full sign-in privileges, so it must
 * be super_admin-only and every creation must be audited.
 *
 * Assertions:
 *   1. POST asks authorizeAdmin for 'super_admin'; a below-threshold admin →
 *      403, no auth user created, no audit row.
 *   2. Invalid role (outside student/teacher/parent) → 400 before any user is
 *      created.
 *   3. Missing required fields → 400.
 *   4. Successful creation writes a create_test_account audit row, and the
 *      created user is stamped is_test_account:true in user_metadata so it is
 *      distinguishable from a real account.
 *
 * SECURITY FINDING (reported separately, NOT locked in by a test):
 *   The task brief asked for a DELETE handler scoped to test accounts only.
 *   This route exports NO DELETE — there is no scoped-delete path to assert.
 *   The only deletion here is the inline auth-user CLEANUP when profile
 *   creation fails (it deletes the user it just made). No operator-facing
 *   "delete a test account" endpoint exists. Reported to backend/architect/ops.
 *
 * Mocking style mirrors the fetch-boundary admin routes — authorizeAdmin /
 * logAdminAudit stubbed, global fetch stubbed so Supabase Admin API + PostgREST
 * calls are observable and never hit the network.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const authorizeAdmin = vi.fn();
const logAdminAudit = vi.fn().mockResolvedValue(undefined);

vi.mock('@alfanumrik/lib/admin-auth', async () => {
  const actual = await vi.importActual<typeof import('@alfanumrik/lib/admin-auth')>('@alfanumrik/lib/admin-auth');
  return {
    ...actual,
    authorizeAdmin: (...args: unknown[]) => authorizeAdmin(...args),
    logAdminAudit: (...args: unknown[]) => logAdminAudit(...args),
  };
});

vi.mock('@alfanumrik/lib/crypto/password', () => ({
  generateSecurePassword: () => 'Test-Stub-Password-123!',
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const ADMIN_UID = '22222222-2222-4222-8222-222222222222';
const NEW_USER_ID = '44444444-4444-4444-4444-444444444444';

const AUTH_OK = {
  authorized: true as const,
  userId: ADMIN_UID,
  adminId: 'admin-row-id',
  email: 'admin@test.com',
  name: 'Test Admin',
  adminLevel: 'super_admin',
};

const AUTH_DENIED = () => ({
  authorized: false as const,
  response: NextResponse.json(
    { error: 'This action requires admin level "super_admin" or higher.', code: 'ADMIN_INSUFFICIENT_LEVEL' },
    { status: 403 },
  ),
});

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/super-admin/test-accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://stub.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-service-role-key';
  // Default happy fetch sequence:
  //   1) POST /auth/v1/admin/users → created user
  //   2) POST PostgREST profile insert → representation
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/auth/v1/admin/users')) {
      return Promise.resolve(new Response(JSON.stringify({ id: NEW_USER_ID }), { status: 200 }));
    }
    // profile insert (students / teachers / guardians)
    return Promise.resolve(new Response(JSON.stringify([{ id: 'profile-1' }]), { status: 201 }));
  }) as typeof fetch);
  authorizeAdmin.mockResolvedValue(AUTH_DENIED());
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

// ─── Level gate ───────────────────────────────────────────────────────

describe('test-accounts POST — super_admin gate', () => {
  it('asks authorizeAdmin for super_admin and returns its denial (403), creating no user and no audit', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_DENIED());
    const { POST } = await import('@/app/api/super-admin/test-accounts/route');

    const res = await POST(req({ role: 'student', name: 'Stu', email: 'stu@test.com' }));

    expect(res.status).toBe(403);
    expect(authorizeAdmin.mock.calls[0][1]).toBe('super_admin');
    // No auth user created on denial.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logAdminAudit).not.toHaveBeenCalled();
  });
});

// ─── Input validation ─────────────────────────────────────────────────

describe('test-accounts POST — input validation', () => {
  it('rejects an invalid role with 400 and creates no user', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_OK);
    const { POST } = await import('@/app/api/super-admin/test-accounts/route');

    const res = await POST(req({ role: 'super_admin', name: 'X', email: 'x@test.com' }));

    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logAdminAudit).not.toHaveBeenCalled();
  });

  it('rejects a missing email with 400 and creates no user', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_OK);
    const { POST } = await import('@/app/api/super-admin/test-accounts/route');

    const res = await POST(req({ role: 'student', name: 'X' }));

    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logAdminAudit).not.toHaveBeenCalled();
  });
});

// ─── Happy path: audit + is_test_account stamp ────────────────────────

describe('test-accounts POST — happy path', () => {
  it('creates a test student stamped is_test_account:true and writes a create_test_account audit row', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_OK);
    const { POST } = await import('@/app/api/super-admin/test-accounts/route');

    const res = await POST(req({ role: 'student', name: 'Test Stu', email: 'teststu@test.com' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.auth_user_id).toBe(NEW_USER_ID);
    expect(body.role).toBe('student');

    // The auth user was minted with is_test_account:true so it is
    // distinguishable from a real account (the basis any future scoped
    // delete would rely on).
    const authCreateCall = fetchSpy.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === 'string' && (call[0] as string).includes('/auth/v1/admin/users'),
    );
    expect(authCreateCall).toBeDefined();
    const authBody = JSON.parse((authCreateCall![1] as RequestInit).body as string);
    expect(authBody.user_metadata).toEqual(
      expect.objectContaining({ is_test_account: true, role: 'student' }),
    );

    // Audit row recorded.
    expect(logAdminAudit).toHaveBeenCalledTimes(1);
    const [adminArg, action, entityType, entityId, details] = logAdminAudit.mock.calls[0];
    expect(adminArg).toMatchObject({ userId: ADMIN_UID });
    expect(action).toBe('create_test_account');
    expect(entityType).toBe('students');
    expect(entityId).toBe(NEW_USER_ID);
    expect(details).toEqual(expect.objectContaining({ role: 'student', is_test: true }));
  });
});

// ─── No operator-facing DELETE exists (security finding pin) ───────────

describe('test-accounts route — DELETE surface', () => {
  it('exports no DELETE handler (no scoped test-account deletion endpoint exists)', async () => {
    const mod = await import('@/app/api/super-admin/test-accounts/route');
    // Documents the gap: there is no operator DELETE to scope to test
    // accounts. If a DELETE is added later, it MUST be super_admin-gated,
    // audited, and refuse to delete non-test (real) accounts — and this
    // assertion will fail, forcing the contract test to be written.
    expect((mod as Record<string, unknown>).DELETE).toBeUndefined();
  });
});
