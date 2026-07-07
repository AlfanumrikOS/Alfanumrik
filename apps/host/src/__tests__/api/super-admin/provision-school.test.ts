/**
 * POST /api/super-admin/institutions/provision — school provisioning route.
 *
 * Pins the rewritten route (src/app/api/super-admin/institutions/provision/route.ts):
 *
 *   - Happy path: provision_school RPC succeeds + admin invite succeeds
 *     → 201 with { admin_invite_sent: true }
 *
 *   - Degradation path: RPC succeeds + admin invite fails
 *     → still 201 (NOT 500) with { admin_invite_sent: false, warn: "admin_invite_failed" }
 *     This is the P15 principle: the school row is already committed; a failed
 *     admin invite must never roll back or 500 the successful provision.
 *
 *   - RPC failure: provision_school RPC returns an error
 *     → 500 with { success: false } (school was NOT created)
 *
 *   - Missing required fields: no name / blank name → 400
 *
 *   - Auth gate: non-super-admin → 403, no RPC called
 *
 * Mocking style mirrors plan-change-atomicity.test.ts (supabaseAdmin.rpc mock)
 * and institutions-admins-route.test.ts (authorizeAdmin function mock).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Module mocks (hoisted before route import) ────────────────────────────

const authorizeAdmin = vi.fn();
const logAdminAudit = vi.fn();

vi.mock('@alfanumrik/lib/admin-auth', () => ({
  authorizeAdmin: (...args: unknown[]) => authorizeAdmin(...args),
  logAdminAudit: (...args: unknown[]) => logAdminAudit(...args),
}));

// supabaseAdmin.rpc — the route calls this directly (named export, not getSupabaseAdmin).
const rpcMock = vi.fn();

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

// establishPrincipalAdmin — toggled per test.
const establishPrincipalAdmin = vi.fn();

vi.mock('@alfanumrik/lib/school-provisioning', () => ({
  // normalizeSlug is used in the route to derive baseSlug before calling the RPC.
  // Use the real function shape so the slug-validation branch works correctly.
  normalizeSlug: (name: string): string =>
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, ''),
  establishPrincipalAdmin: (...args: unknown[]) => establishPrincipalAdmin(...args),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST } from '@/app/api/super-admin/institutions/provision/route';

// ── Constants ──────────────────────────────────────────────────────────────

const SCHOOL_ID = '00000000-0000-0000-0000-000000000001';
const SLUG = 'delhi-public-school';
const SUBDOMAIN = 'delhi-public-school.alfanumrik.com';
const INVITE_CODE = 'ABCD1234';

/** Valid RPC result — returned as the first element of an array (Supabase rpc returns data). */
const RPC_SUCCESS_DATA = {
  school_id: SCHOOL_ID,
  slug: SLUG,
  invite_code: INVITE_CODE,
  subdomain: SUBDOMAIN,
};

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/super-admin/institutions/provision', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function authOk() {
  authorizeAdmin.mockResolvedValue({
    authorized: true,
    userId: 'super-1',
    adminId: 'admin-1',
    email: 'ops@alfanumrik.com',
    adminLevel: 'super',
  });
}

function authDenied() {
  authorizeAdmin.mockResolvedValue({
    authorized: false,
    response: new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
  });
}

// ── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  authorizeAdmin.mockReset();
  logAdminAudit.mockReset();
  rpcMock.mockReset();
  establishPrincipalAdmin.mockReset();

  authOk();
  logAdminAudit.mockResolvedValue(undefined);

  // Default RPC: succeeds.
  rpcMock.mockResolvedValue({ data: RPC_SUCCESS_DATA, error: null });

  // Default admin invite: succeeds.
  establishPrincipalAdmin.mockResolvedValue({
    linked: true,
    authUserId: 'auth-1',
    schoolAdminId: 'sa-1',
    claimToken: 'raw-claim-token',
  });
});

afterEach(() => vi.clearAllMocks());

// ── Test suites ────────────────────────────────────────────────────────────

describe('POST /api/super-admin/institutions/provision — auth gate (P9)', () => {
  it('rejects non-super-admin with 403 and never calls the RPC', async () => {
    authDenied();
    const res = await POST(makeRequest({ name: 'Delhi Public School' }));
    expect(res.status).toBe(403);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('passes super_admin level to authorizeAdmin', async () => {
    await POST(makeRequest({ name: 'Delhi Public School' }));
    expect(authorizeAdmin).toHaveBeenCalledWith(expect.anything(), 'super_admin');
  });
});

describe('POST /api/super-admin/institutions/provision — input validation', () => {
  it('returns 400 when name is absent', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('returns 400 when name is an empty string', async () => {
    const res = await POST(makeRequest({ name: '' }));
    expect(res.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('returns 400 when name is whitespace-only', async () => {
    const res = await POST(makeRequest({ name: '   ' }));
    expect(res.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('returns 400 when name produces an empty slug (all non-alphanumeric chars)', async () => {
    // "..." normalizes to "" — the route guards this with its own 400.
    const res = await POST(makeRequest({ name: '...' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/super-admin/institutions/provision — happy path', () => {
  it('returns 201 with full data when RPC and admin invite both succeed', async () => {
    const res = await POST(
      makeRequest({
        name: 'Delhi Public School',
        admin_email: 'principal@dps.example.in',
        admin_name: 'Anita Verma',
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.school_id).toBe(SCHOOL_ID);
    expect(body.data.slug).toBe(SLUG);
    expect(body.data.subdomain).toBe(SUBDOMAIN);
    expect(body.data.invite_code).toBe(INVITE_CODE);
    expect(body.data.admin_invite_sent).toBe(true);
    // No warn flag on the happy path.
    expect(body.data.warn).toBeUndefined();
  });

  it('calls provision_school RPC with normalized slug and provided params', async () => {
    await POST(
      makeRequest({
        name: 'Delhi Public School',
        board: 'CBSE',
        city: 'Delhi',
        state: 'Delhi',
        plan: 'trial',
        seats: 100,
      }),
    );
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [rpcName, rpcArgs] = rpcMock.mock.calls[0];
    expect(rpcName).toBe('provision_school');
    expect(rpcArgs.p_name).toBe('Delhi Public School');
    expect(rpcArgs.p_slug).toBe('delhi-public-school');
    expect(rpcArgs.p_board).toBe('CBSE');
    expect(rpcArgs.p_plan).toBe('trial');
    expect(rpcArgs.p_seats).toBe(100);
  });

  it('returns 201 with admin_invite_sent:true even when admin_email is absent (no invite attempted)', async () => {
    // When no admin_email is provided, admin invite is skipped entirely —
    // admin_invite_sent stays false (the invite was not attempted, not failed).
    const res = await POST(makeRequest({ name: 'Delhi Public School' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.admin_invite_sent).toBe(false);
    expect(body.data.warn).toBeUndefined();
    expect(establishPrincipalAdmin).not.toHaveBeenCalled();
  });

  it('writes a school.provisioned audit log (P13 — no PII checked separately)', async () => {
    await POST(makeRequest({ name: 'Delhi Public School', admin_email: 'p@ex.com' }));
    expect(logAdminAudit).toHaveBeenCalledTimes(1);
    const [, action, entityType, entityId] = logAdminAudit.mock.calls[0];
    expect(action).toBe('school.provisioned');
    expect(entityType).toBe('school');
    expect(entityId).toBe(SCHOOL_ID);
  });
});

describe('POST /api/super-admin/institutions/provision — degradation path (P15)', () => {
  it('returns 201 (NOT 500) with warn:"admin_invite_failed" when admin invite returns linked:false', async () => {
    establishPrincipalAdmin.mockResolvedValue({
      linked: false,
      authUserId: null,
      schoolAdminId: null,
      claimToken: null,
    });

    const res = await POST(
      makeRequest({
        name: 'Delhi Public School',
        admin_email: 'principal@dps.example.in',
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    // School was created — these fields must be present.
    expect(body.data.school_id).toBe(SCHOOL_ID);
    expect(body.data.slug).toBe(SLUG);
    expect(body.data.invite_code).toBe(INVITE_CODE);
    // Admin invite fields.
    expect(body.data.admin_invite_sent).toBe(false);
    expect(body.data.warn).toBe('admin_invite_failed');
  });

  it('returns 201 (NOT 500) with warn:"admin_invite_failed" when admin invite throws', async () => {
    establishPrincipalAdmin.mockRejectedValue(new Error('auth service unavailable'));

    const res = await POST(
      makeRequest({
        name: 'Delhi Public School',
        admin_email: 'principal@dps.example.in',
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.school_id).toBe(SCHOOL_ID);
    expect(body.data.admin_invite_sent).toBe(false);
    expect(body.data.warn).toBe('admin_invite_failed');
  });

  it('the RPC is still called when admin invite fails — school IS created', async () => {
    establishPrincipalAdmin.mockResolvedValue({
      linked: false,
      authUserId: null,
      schoolAdminId: null,
      claimToken: null,
    });
    await POST(
      makeRequest({ name: 'Delhi Public School', admin_email: 'p@dps.example.in' }),
    );
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/super-admin/institutions/provision — RPC failure', () => {
  it('returns 500 when the provision_school RPC returns an error', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'duplicate key value violates unique constraint "schools_slug_key"' },
    });

    const res = await POST(makeRequest({ name: 'Delhi Public School' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('returns 500 when the RPC returns null data with no error', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    const res = await POST(makeRequest({ name: 'Delhi Public School' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('does not call establishPrincipalAdmin when the RPC fails', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'db error' },
    });
    await POST(makeRequest({ name: 'Delhi Public School', admin_email: 'p@dps.in' }));
    expect(establishPrincipalAdmin).not.toHaveBeenCalled();
  });

  it('does not write an audit log when the RPC fails', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'db error' } });
    await POST(makeRequest({ name: 'Delhi Public School' }));
    expect(logAdminAudit).not.toHaveBeenCalled();
  });
});

describe('POST /api/super-admin/institutions/provision — response shape (P13)', () => {
  it('response body never contains admin email or auth user id', async () => {
    const res = await POST(
      makeRequest({
        name: 'Delhi Public School',
        admin_email: 'principal@dps.example.in',
        admin_name: 'Anita Verma',
      }),
    );
    const text = await res.text();
    expect(text).not.toContain('principal@dps.example.in');
    expect(text).not.toContain('auth-1');
  });
});
