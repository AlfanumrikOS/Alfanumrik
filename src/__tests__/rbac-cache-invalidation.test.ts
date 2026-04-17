import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * F3: RBAC Cache Invalidation Tests
 *
 * After the 2026-04-17 RBAC remediation, the following mutation endpoints
 * MUST call invalidateForSecurityEvent() so that revoked/changed permissions
 * stop being enforced within the cache TTL (not up to 5 minutes later).
 *
 * Covered here:
 *   - POST /api/super-admin/roles          → role.assigned
 *   - DELETE /api/super-admin/roles        → role.revoked
 *   - PATCH /api/v1/admin/roles            → role_permissions_changed (all users)
 *
 * The delegation-token create/revoke paths are covered by
 * rbac-delegation.test.ts.
 *
 * Design:
 *   - Tests the ROUTE handlers end-to-end with mocked admin auth + Supabase.
 *   - Asserts both (a) that invalidateForSecurityEvent is called, and (b)
 *     that failure of the invalidation is best-effort (must not block or
 *     change the response).
 */

// ─── Shared mocks ────────────────────────────────────────────

const authMock = vi.fn();
const logAuditMock = vi.fn();
const invalidateMock = vi.fn();
const fetchMock = vi.fn();

// Admin-auth: both session-based (super-admin routes) and RBAC
// authorizeRequest (v1/admin routes) get the same treatment.
vi.mock('@/lib/admin-auth', () => ({
  authorizeAdmin: (...args: unknown[]) => authMock(...args),
  logAdminAudit: (...args: unknown[]) => logAuditMock(...args),
  supabaseAdminUrl: (table: string, params?: string) => {
    const base = `https://test.supabase.co/rest/v1/${table}`;
    return params ? `${base}?${params}` : base;
  },
  supabaseAdminHeaders: (_prefer?: string) => ({ apikey: 'test-key', Authorization: 'Bearer test-key' }),
}));

const authorizeRequestMock = vi.fn();
const logAuditV1Mock = vi.fn();

vi.mock('@/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => authorizeRequestMock(...args),
  logAudit: (...args: unknown[]) => logAuditV1Mock(...args),
  invalidateForSecurityEvent: (...args: unknown[]) => invalidateMock(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Supabase admin client — minimal chain used by PATCH /api/v1/admin/roles.
interface MockDbResult {
  data: unknown;
  error: { message: string } | null;
}
const supabaseAdminMockState: {
  singleResult: MockDbResult;
  userRolesResult: MockDbResult;
  insertError: { message: string } | null;
} = {
  singleResult: { data: { id: 'role-1', name: 'test_role' }, error: null },
  userRolesResult: { data: [{ auth_user_id: 'u-1' }, { auth_user_id: 'u-2' }], error: null },
  insertError: null,
};

function makeChain(result: () => { data?: unknown; error?: unknown }) {
  const chain: Record<string, unknown> = {};
  const proxy = new Proxy(chain, {
    get(_t, prop) {
      if (prop === 'then') return undefined;
      if (prop === 'data') return result().data;
      if (prop === 'error') return result().error;
      return (..._args: unknown[]) => proxy;
    },
  });
  return proxy;
}

const fromMock = vi.fn((table: string) => {
  if (table === 'user_roles') {
    return makeChain(() => supabaseAdminMockState.userRolesResult);
  }
  if (table === 'roles') {
    return makeChain(() => supabaseAdminMockState.singleResult);
  }
  if (table === 'role_permissions') {
    return makeChain(() => ({ data: null, error: supabaseAdminMockState.insertError }));
  }
  if (table === 'permissions') {
    return makeChain(() => ({ data: [], error: null }));
  }
  return makeChain(() => ({ data: null, error: null }));
});

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: fromMock },
  getSupabaseAdmin: vi.fn(() => ({ from: fromMock })),
}));

vi.mock('@/lib/sanitize', () => ({
  isValidUUID: (_s: string) => true, // permissive for tests
}));

// Global fetch mock for the super-admin route handler (which uses REST directly).
beforeEach(() => {
  vi.clearAllMocks();
  supabaseAdminMockState.singleResult = { data: { id: 'role-1', name: 'test_role' }, error: null };
  supabaseAdminMockState.userRolesResult = { data: [{ auth_user_id: 'u-1' }, { auth_user_id: 'u-2' }], error: null };
  supabaseAdminMockState.insertError = null;
  global.fetch = fetchMock as unknown as typeof fetch;
  invalidateMock.mockResolvedValue(undefined);
});

function jsonRequest(url: string, method: string, body?: unknown): NextRequest {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  return new NextRequest(new URL(url, 'http://localhost'), init as never);
}

// ═══════════════════════════════════════════════════════════
// POST /api/super-admin/roles  (assign role to user)
// ═══════════════════════════════════════════════════════════

describe('F3: POST /api/super-admin/roles invalidates cache', () => {
  it('calls invalidateForSecurityEvent with [auth_user_id] and "role_granted" reason', async () => {
    authMock.mockResolvedValue({
      authorized: true,
      adminId: 'admin-1',
      userId: 'admin-1',
      email: 'admin@test.com',
      name: 'Admin',
    });

    // fetch sequence used by POST handler:
    //   1. query('roles', ...) → find role by name
    //   2. POST /user_roles     → create assignment
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'role-uuid' }]), { status: 200 })) // role lookup
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'assigned' }), { status: 201 })); // insert

    const { POST } = await import('@/app/api/super-admin/roles/route');
    const res = await POST(jsonRequest('http://localhost/api/super-admin/roles', 'POST', {
      auth_user_id: 'user-abc',
      role_name: 'teacher',
    }));

    expect(res.status).toBe(201);

    // Invalidation is fire-and-forget; wait a tick for the promise catch handler.
    await new Promise((r) => setTimeout(r, 0));

    expect(invalidateMock).toHaveBeenCalledWith(['user-abc'], 'role_granted');
  });

  it('still returns 201 even if invalidation rejects (best-effort)', async () => {
    authMock.mockResolvedValue({
      authorized: true,
      adminId: 'admin-1',
      userId: 'admin-1',
      email: 'admin@test.com',
      name: 'Admin',
    });
    invalidateMock.mockRejectedValue(new Error('redis down'));
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'role-uuid' }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'assigned' }), { status: 201 }));

    const { POST } = await import('@/app/api/super-admin/roles/route');
    const res = await POST(jsonRequest('http://localhost/api/super-admin/roles', 'POST', {
      auth_user_id: 'user-abc',
      role_name: 'teacher',
    }));

    // Response is not blocked by the invalidation failure.
    expect(res.status).toBe(201);
    await new Promise((r) => setTimeout(r, 0));
    expect(invalidateMock).toHaveBeenCalled();
  });

  it('does NOT invalidate when the request fails auth', async () => {
    const unauth = new Response('', { status: 401 });
    authMock.mockResolvedValue({ authorized: false, response: unauth });

    const { POST } = await import('@/app/api/super-admin/roles/route');
    const res = await POST(jsonRequest('http://localhost/api/super-admin/roles', 'POST', {
      auth_user_id: 'user-abc',
      role_name: 'teacher',
    }));

    expect(res.status).toBe(401);
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it('does NOT invalidate when role insert fails', async () => {
    authMock.mockResolvedValue({
      authorized: true,
      adminId: 'admin-1',
      userId: 'admin-1',
      email: 'admin@test.com',
      name: 'Admin',
    });
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'role-uuid' }]), { status: 200 }))
      .mockResolvedValueOnce(new Response('duplicate key violates unique constraint', { status: 409 }));

    const { POST } = await import('@/app/api/super-admin/roles/route');
    const res = await POST(jsonRequest('http://localhost/api/super-admin/roles', 'POST', {
      auth_user_id: 'user-abc',
      role_name: 'teacher',
    }));

    expect(res.status).toBe(409);
    await new Promise((r) => setTimeout(r, 0));
    expect(invalidateMock).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════
// DELETE /api/super-admin/roles  (revoke role)
// ═══════════════════════════════════════════════════════════

describe('F3: DELETE /api/super-admin/roles invalidates cache', () => {
  it('calls invalidateForSecurityEvent with the revoked user id and "role_revoked"', async () => {
    authMock.mockResolvedValue({
      authorized: true,
      adminId: 'admin-1',
      userId: 'admin-1',
      email: 'admin@test.com',
      name: 'Admin',
    });

    // DELETE returns the deleted row(s) because `return=representation` is set.
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([{ auth_user_id: 'user-xyz' }]), { status: 200 }),
    );

    const { DELETE } = await import('@/app/api/super-admin/roles/route');
    const res = await DELETE(jsonRequest('http://localhost/api/super-admin/roles', 'DELETE', {
      user_role_id: 'role-assignment-1',
    }));

    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
    expect(invalidateMock).toHaveBeenCalledWith(['user-xyz'], 'role_revoked');
  });

  it('does NOT invalidate when deletion returns no rows (invalid id)', async () => {
    authMock.mockResolvedValue({
      authorized: true,
      adminId: 'admin-1',
      userId: 'admin-1',
      email: 'admin@test.com',
      name: 'Admin',
    });
    // Empty result array => no auth_user_id extracted => no invalidation.
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));

    const { DELETE } = await import('@/app/api/super-admin/roles/route');
    const res = await DELETE(jsonRequest('http://localhost/api/super-admin/roles', 'DELETE', {
      user_role_id: 'missing',
    }));

    // Status should still be 200 (no DB error), but invalidate must not run.
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it('still returns success when invalidation rejects (best-effort)', async () => {
    authMock.mockResolvedValue({
      authorized: true,
      adminId: 'admin-1',
      userId: 'admin-1',
      email: 'admin@test.com',
      name: 'Admin',
    });
    invalidateMock.mockRejectedValue(new Error('cache down'));
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([{ auth_user_id: 'user-xyz' }]), { status: 200 }),
    );

    const { DELETE } = await import('@/app/api/super-admin/roles/route');
    const res = await DELETE(jsonRequest('http://localhost/api/super-admin/roles', 'DELETE', {
      user_role_id: 'role-assignment-1',
    }));

    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
    expect(invalidateMock).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════
// PATCH /api/v1/admin/roles  (update role permissions)
// ═══════════════════════════════════════════════════════════

describe('F3: PATCH /api/v1/admin/roles invalidates all users holding the role', () => {
  it('calls invalidateForSecurityEvent with every user id and "role_permissions_changed"', async () => {
    authorizeRequestMock.mockResolvedValue({
      authorized: true,
      userId: 'admin-1',
      permissions: ['system.manage_roles'],
    });

    // Mock state: role exists, and two users hold it.
    supabaseAdminMockState.singleResult = { data: { id: 'role-1', name: 'editor' }, error: null };
    supabaseAdminMockState.userRolesResult = {
      data: [{ auth_user_id: 'u-1' }, { auth_user_id: 'u-2' }, { auth_user_id: 'u-3' }],
      error: null,
    };

    const { PATCH } = await import('@/app/api/v1/admin/roles/route');
    const res = await PATCH(jsonRequest('http://localhost/api/v1/admin/roles', 'PATCH', {
      role_id: '550e8400-e29b-41d4-a716-446655440000',
      permissions: ['quiz.attempt'],
    }));

    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 10));

    expect(invalidateMock).toHaveBeenCalledWith(
      ['u-1', 'u-2', 'u-3'],
      'role_permissions_changed',
    );
  });

  it('skips invalidation when no users hold the role (empty array)', async () => {
    authorizeRequestMock.mockResolvedValue({
      authorized: true,
      userId: 'admin-1',
      permissions: ['system.manage_roles'],
    });
    supabaseAdminMockState.singleResult = { data: { id: 'role-1', name: 'editor' }, error: null };
    supabaseAdminMockState.userRolesResult = { data: [], error: null };

    const { PATCH } = await import('@/app/api/v1/admin/roles/route');
    const res = await PATCH(jsonRequest('http://localhost/api/v1/admin/roles', 'PATCH', {
      role_id: '550e8400-e29b-41d4-a716-446655440000',
      permissions: [],
    }));

    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it('still returns 200 when the invalidation lookup fails', async () => {
    authorizeRequestMock.mockResolvedValue({
      authorized: true,
      userId: 'admin-1',
      permissions: ['system.manage_roles'],
    });
    supabaseAdminMockState.singleResult = { data: { id: 'role-1', name: 'editor' }, error: null };
    supabaseAdminMockState.userRolesResult = { data: null, error: { message: 'lookup failed' } };

    const { PATCH } = await import('@/app/api/v1/admin/roles/route');
    const res = await PATCH(jsonRequest('http://localhost/api/v1/admin/roles', 'PATCH', {
      role_id: '550e8400-e29b-41d4-a716-446655440000',
      permissions: [],
    }));

    // PATCH success is not coupled to invalidation. The handler logs the error
    // and returns 200 anyway.
    expect(res.status).toBe(200);
  });

  it('does NOT invalidate when unauthorized', async () => {
    const unauth = new Response('', { status: 403 });
    authorizeRequestMock.mockResolvedValue({ authorized: false, errorResponse: unauth });

    const { PATCH } = await import('@/app/api/v1/admin/roles/route');
    const res = await PATCH(jsonRequest('http://localhost/api/v1/admin/roles', 'PATCH', {
      role_id: '550e8400-e29b-41d4-a716-446655440000',
      permissions: ['quiz.attempt'],
    }));

    expect(res.status).toBe(403);
    expect(invalidateMock).not.toHaveBeenCalled();
  });
});