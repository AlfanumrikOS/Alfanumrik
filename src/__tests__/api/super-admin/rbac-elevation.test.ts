/**
 * RBAC elevation pin — the 8 most security-critical super-admin handlers
 * MUST call `authorizeAdmin(request, 'super_admin')` (not the default
 * 'support' floor). If any future refactor accidentally drops the
 * 'super_admin' argument, a support-tier admin could call these routes
 * directly and either escalate privileges (roles, admin_users) or move
 * money/tenants (billing, provision, pause, resume).
 *
 * Strategy: mock authorizeAdmin to deny, invoke the handler, assert
 *   (a) the response is the one authorizeAdmin returned (status 403), and
 *   (b) authorizeAdmin was called with 'super_admin' as the second arg.
 *
 * Scope intentionally tight — this file pins the gate, not behavior. The
 * happy path / business-logic tests live in dedicated files
 * (institutions-pause.test.ts, institutions-delete.test.ts, etc.).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const authorizeAdmin = vi.fn();

vi.mock('@/lib/admin-auth', () => ({
  authorizeAdmin: (...args: unknown[]) => authorizeAdmin(...args),
  logAdminAudit: vi.fn().mockResolvedValue(undefined),
  isValidUUID: (s: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
  supabaseAdminUrl: (table: string, params?: string) =>
    `https://stub.supabase.co/rest/v1/${table}${params ? `?${params}` : ''}`,
  supabaseAdminHeaders: () => ({ apikey: 'stub', Authorization: 'Bearer stub' }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/rbac', () => ({ invalidateForSecurityEvent: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => {
  authorizeAdmin.mockReset();
  authorizeAdmin.mockResolvedValue({
    authorized: false,
    response: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
  });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://stub.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub';
  // No fetch should fire when the gate denies — but provide a stub so any
  // accidental call is observable in fetchCalls rather than a network error.
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', { status: 200 }));
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

const UUID = '11111111-1111-4111-8111-111111111111';

function req(url: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: body !== undefined ? JSON.stringify(body) : null,
    headers: { 'content-type': 'application/json' },
  });
}

describe('super-admin routes require super_admin level (privilege-escalation gate)', () => {
  it('POST /api/super-admin/roles rejects support-tier admin', async () => {
    const { POST } = await import('@/app/api/super-admin/roles/route');
    const res = await POST(req('/api/super-admin/roles', 'POST', { auth_user_id: UUID, role_name: 'super_admin' }));
    expect(res.status).toBe(403);
    expect((authorizeAdmin.mock.calls[0] as unknown[])[1]).toBe('super_admin');
  });

  it('DELETE /api/super-admin/roles rejects support-tier admin', async () => {
    const { DELETE } = await import('@/app/api/super-admin/roles/route');
    const res = await DELETE(req('/api/super-admin/roles', 'DELETE', { user_role_id: UUID }));
    expect(res.status).toBe(403);
    expect((authorizeAdmin.mock.calls[0] as unknown[])[1]).toBe('super_admin');
  });

  it('PATCH /api/super-admin/users rejects support-tier admin', async () => {
    const { PATCH } = await import('@/app/api/super-admin/users/route');
    const res = await PATCH(req('/api/super-admin/users', 'PATCH', { user_id: UUID, table: 'students', updates: { is_active: false } }));
    expect(res.status).toBe(403);
    expect((authorizeAdmin.mock.calls[0] as unknown[])[1]).toBe('super_admin');
  });

  it('POST /api/super-admin/institutions/provision rejects support-tier admin', async () => {
    const { POST } = await import('@/app/api/super-admin/institutions/provision/route');
    const res = await POST(req('/api/super-admin/institutions/provision', 'POST', { name: 'Test School' }));
    expect(res.status).toBe(403);
    expect((authorizeAdmin.mock.calls[0] as unknown[])[1]).toBe('super_admin');
  });

  it('PATCH /api/super-admin/institutions/billing rejects support-tier admin', async () => {
    const { PATCH } = await import('@/app/api/super-admin/institutions/billing/route');
    const res = await PATCH(req('/api/super-admin/institutions/billing', 'PATCH', { school_id: UUID, seats_purchased: 100 }));
    expect(res.status).toBe(403);
    expect((authorizeAdmin.mock.calls[0] as unknown[])[1]).toBe('super_admin');
  });

  it('POST /api/super-admin/institutions/[id]/pause rejects support-tier admin', async () => {
    const { POST } = await import('@/app/api/super-admin/institutions/[id]/pause/route');
    const res = await POST(
      req(`/api/super-admin/institutions/${UUID}/pause`, 'POST', { reason: 'long enough reason', expectedSchoolName: 'X' }),
      { params: Promise.resolve({ id: UUID }) },
    );
    expect(res.status).toBe(403);
    expect((authorizeAdmin.mock.calls[0] as unknown[])[1]).toBe('super_admin');
  });

  it('POST /api/super-admin/institutions/[id]/resume rejects support-tier admin', async () => {
    const { POST } = await import('@/app/api/super-admin/institutions/[id]/resume/route');
    const res = await POST(
      req(`/api/super-admin/institutions/${UUID}/resume`, 'POST', { expectedSchoolName: 'X' }),
      { params: Promise.resolve({ id: UUID }) },
    );
    expect(res.status).toBe(403);
    expect((authorizeAdmin.mock.calls[0] as unknown[])[1]).toBe('super_admin');
  });

  it('DELETE /api/super-admin/institutions rejects support-tier admin', async () => {
    const { DELETE } = await import('@/app/api/super-admin/institutions/route');
    const res = await DELETE(req(`/api/super-admin/institutions?id=${UUID}`, 'DELETE'));
    expect(res.status).toBe(403);
    expect((authorizeAdmin.mock.calls[0] as unknown[])[1]).toBe('super_admin');
  });
});
