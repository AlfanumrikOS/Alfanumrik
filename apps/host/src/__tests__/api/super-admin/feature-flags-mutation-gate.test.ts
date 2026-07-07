/**
 * Feature-flags route authorization + mutation contract tests
 * (Phase 4 / 2026-06-11 — privilege-escalation surface coverage).
 *
 * Pins the level gate and audit contract for
 *   src/app/api/super-admin/feature-flags/route.ts
 *
 * A feature flag gates platform-wide rollout. Flipping one can turn a
 * dormant kill-switch on for every user. The route's documented contract:
 *   - GET requires the LOWER 'support' level (reading the list is safe).
 *   - POST / PATCH / DELETE require 'super_admin' (a below-threshold admin
 *     → 403, no flag change).
 *   - A successful mutation writes an audit row via logAdminAudit.
 *   - Invalid payload (bad rollout_percentage / target_roles) → 400.
 *
 * Assertions:
 *   1. GET asks authorizeAdmin for 'support'; PATCH/POST/DELETE ask for
 *      'super_admin'. (Pins the level argument so a future refactor can't
 *      silently drop it.)
 *   2. When the gate denies, the handler returns the exact denial response
 *      and writes no audit row / fires no DB mutation.
 *   3. A successful PATCH writes a feature_flag.updated audit row.
 *   4. Bad rollout_percentage (>100) and bad target_roles (not an array) → 400,
 *      no DB mutation, no audit.
 *
 * Mocking style mirrors the fetch-boundary admin routes — authorizeAdmin /
 * logAdminAudit stubbed at the module seam, global fetch stubbed so the
 * route's supabaseAdminUrl/Headers PostgREST calls are observable and never
 * hit the network. Zod validation (@alfanumrik/lib/validation) is intentionally NOT
 * mocked so the real 400 boundary is exercised.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const authorizeAdmin = vi.fn();
const logAdminAudit = vi.fn().mockResolvedValue(undefined);

vi.mock('@alfanumrik/lib/admin-auth', async () => {
  // Keep the real supabaseAdminUrl/Headers + isValidUUID so the route builds
  // realistic PostgREST URLs; only the auth + audit seams are stubbed.
  const actual = await vi.importActual<typeof import('@alfanumrik/lib/admin-auth')>('@alfanumrik/lib/admin-auth');
  return {
    ...actual,
    authorizeAdmin: (...args: unknown[]) => authorizeAdmin(...args),
    logAdminAudit: (...args: unknown[]) => logAdminAudit(...args),
  };
});

vi.mock('@alfanumrik/lib/feature-flags', () => ({
  invalidateFlagCache: vi.fn(),
}));

const logOpsEvent = vi.fn().mockResolvedValue(undefined);
vi.mock('@alfanumrik/lib/ops-events', () => ({
  logOpsEvent: (...args: unknown[]) => logOpsEvent(...args),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const FLAG_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_UID = '22222222-2222-4222-8222-222222222222';

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

function req(method: string, body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/super-admin/feature-flags', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : null,
  });
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://stub.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-service-role-key';
  // Default fetch: an empty-but-OK PostgREST response. Per-test overrides
  // below queue specific bodies for the read-then-write sequence.
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response('[]', { status: 200, headers: { 'content-range': '0-0/0' } }),
  );
  authorizeAdmin.mockResolvedValue(AUTH_DENIED());
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

// ─── Level gate: which level each method demands ──────────────────────

describe('feature-flags — authorizeAdmin level gate', () => {
  it('GET requires only the "support" level (reading the flag list is safe)', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_OK);
    const { GET } = await import('@/app/api/super-admin/feature-flags/route');
    await GET(req('GET'));
    expect(authorizeAdmin.mock.calls[0][1]).toBe('support');
  });

  it('POST requires the "super_admin" level', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_DENIED());
    const { POST } = await import('@/app/api/super-admin/feature-flags/route');
    const res = await POST(req('POST', { name: 'ff_demo', enabled: true }));
    expect(res.status).toBe(403);
    expect(authorizeAdmin.mock.calls[0][1]).toBe('super_admin');
  });

  it('PATCH requires the "super_admin" level', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_DENIED());
    const { PATCH } = await import('@/app/api/super-admin/feature-flags/route');
    const res = await PATCH(req('PATCH', { id: FLAG_ID, updates: { enabled: true } }));
    expect(res.status).toBe(403);
    expect(authorizeAdmin.mock.calls[0][1]).toBe('super_admin');
  });

  it('DELETE requires the "super_admin" level', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_DENIED());
    const { DELETE } = await import('@/app/api/super-admin/feature-flags/route');
    const res = await DELETE(req('DELETE', { id: FLAG_ID }));
    expect(res.status).toBe(403);
    expect(authorizeAdmin.mock.calls[0][1]).toBe('super_admin');
  });
});

// ─── Denial → no mutation, no audit ───────────────────────────────────

describe('feature-flags — below-threshold admin cannot mutate', () => {
  it('PATCH denial returns 403, fires no DB write, writes no audit row', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_DENIED());
    const { PATCH } = await import('@/app/api/super-admin/feature-flags/route');

    const res = await PATCH(req('PATCH', { id: FLAG_ID, updates: { enabled: true } }));

    expect(res.status).toBe(403);
    // The gate short-circuits before any PostgREST call.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logAdminAudit).not.toHaveBeenCalled();
  });
});

// ─── Successful mutation writes an audit row ──────────────────────────

describe('feature-flags — successful PATCH writes an audit row', () => {
  it('updates the flag and records feature_flag.updated via logAdminAudit', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_OK);

    // Sequence the route's fetch calls:
    //   1) previous-state read  → one flag row
    //   2) PATCH write          → updated representation (non-empty array)
    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ flag_name: 'ff_demo', is_enabled: false }]), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: FLAG_ID, flag_name: 'ff_demo', is_enabled: true }]), { status: 200 }),
      );

    const { PATCH } = await import('@/app/api/super-admin/feature-flags/route');
    const res = await PATCH(req('PATCH', { id: FLAG_ID, updates: { enabled: true } }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    expect(logAdminAudit).toHaveBeenCalledTimes(1);
    const [adminArg, action, entityType, entityId] = logAdminAudit.mock.calls[0];
    expect(adminArg).toMatchObject({ userId: ADMIN_UID });
    expect(action).toBe('feature_flag.updated');
    expect(entityType).toBe('feature_flags');
    expect(entityId).toBe(FLAG_ID);
  });
});

// ─── Invalid payload → 400 (real Zod boundary) ────────────────────────

describe('feature-flags — invalid mutation payload → 400', () => {
  it('rejects a rollout_percentage above 100 with 400 and no DB write / audit', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_OK);
    const { PATCH } = await import('@/app/api/super-admin/feature-flags/route');

    const res = await PATCH(req('PATCH', { id: FLAG_ID, updates: { rollout_percentage: 150 } }));

    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logAdminAudit).not.toHaveBeenCalled();
  });

  it('rejects a non-array target_roles with 400 and no DB write / audit', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_OK);
    const { PATCH } = await import('@/app/api/super-admin/feature-flags/route');

    const res = await PATCH(
      req('PATCH', { id: FLAG_ID, updates: { target_roles: 'student' } }),
    );

    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logAdminAudit).not.toHaveBeenCalled();
  });

  it('rejects a non-UUID flag id with 400', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_OK);
    const { PATCH } = await import('@/app/api/super-admin/feature-flags/route');

    const res = await PATCH(req('PATCH', { id: 'not-a-uuid', updates: { enabled: true } }));

    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logAdminAudit).not.toHaveBeenCalled();
  });
});
