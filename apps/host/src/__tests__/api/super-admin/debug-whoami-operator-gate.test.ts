/**
 * POST /api/super-admin/debug/whoami — operator auth gate.
 *
 * Phase 1 pilot migration off authorizeAdmin() (2026-08-16, Mission Control
 * overhaul): the session-based `super_admin` auth path now calls
 * authorizeOperator() instead of authorizeAdmin(). The env-gated
 * `x-debug-secret` bypass (CEO decision #5, Phase 0) is UNTOUCHED — this
 * file pins that the two paths still compose correctly: a denied
 * authorizeOperator() result is NOT overridden by an invalid/absent secret,
 * and (in production, where the secret bypass is dead) authorizeOperator()
 * is the ONLY path to a 200.
 *
 * Gate-only scope (mirrors rbac-elevation.test.ts): mocks authorizeOperator()
 * itself rather than driving RBAC end-to-end (that parity coverage lives in
 * apps/host/src/__tests__/lib/authorize-operator.test.ts and the sessions
 * pilot-route test). This file proves the ROUTE composes the gate correctly,
 * not that authorizeOperator()'s internal rank logic is correct.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const authorizeOperator = vi.fn();
const logAdminAudit = vi.fn().mockResolvedValue(undefined);

vi.mock('@alfanumrik/lib/admin-auth', () => ({
  authorizeOperator: (...args: unknown[]) => authorizeOperator(...args),
  logAdminAudit: (...args: unknown[]) => logAdminAudit(...args),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function postReq(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/super-admin/debug/whoami', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const denyOperator = {
  authorized: false,
  response: NextResponse.json({ error: 'forbidden', code: 'OPERATOR_INSUFFICIENT_LEVEL' }, { status: 403 }),
};

beforeEach(() => {
  authorizeOperator.mockReset();
  logAdminAudit.mockClear();
  delete process.env.VERCEL_ENV;
  process.env.NODE_ENV = 'production';
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.VERCEL_ENV;
});

describe('POST /api/super-admin/debug/whoami — authorizeOperator gate (production)', () => {
  it('calls authorizeOperator with the super_admin floor', async () => {
    authorizeOperator.mockResolvedValue(denyOperator);
    const { POST } = await import('@/app/api/super-admin/debug/whoami/route');

    await POST(postReq({ email: 'someone@x.com' }));

    expect(authorizeOperator).toHaveBeenCalledTimes(1);
    expect((authorizeOperator.mock.calls[0] as unknown[])[1]).toBe('super_admin');
  });

  it('denies (returns the authorizeOperator 403) when the operator gate fails and no debug secret is available in production', async () => {
    authorizeOperator.mockResolvedValue(denyOperator);
    const { POST } = await import('@/app/api/super-admin/debug/whoami/route');

    const res = await POST(postReq({ email: 'someone@x.com' }, { 'x-debug-secret': 'anything' }));

    // In production, isDebugSecretBypassAllowed() is false, so the secret
    // header is never even read — the authorizeOperator denial stands.
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('OPERATOR_INSUFFICIENT_LEVEL');
  });

  it('proceeds past the gate (does not short-circuit to 401/403) when authorizeOperator authorizes', async () => {
    authorizeOperator.mockResolvedValue({
      authorized: true,
      userId: 'u-op-1',
      adminId: 'admin-op-1',
      email: 'op@x.com',
      name: 'Op',
      adminLevel: 'super_admin',
    });
    // Stub the downstream GoTrue admin-user lookup + fire-and-forget audit
    // write so this gate-only test never makes a real network call. The
    // route's own try/catch treats "no user found" as a 200 with
    // auth_user: null — the point here is purely that the gate didn't block.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ users: [] }), { status: 200 }),
    );
    const { POST } = await import('@/app/api/super-admin/debug/whoami/route');

    const res = await POST(postReq({ email: 'not-an-existing-user@x.com' }));

    // Auth gate passed — the route moved on to body validation / lookups
    // rather than short-circuiting with an auth-gate status.
    expect(res.status).not.toBe(401);
    expect([400, 403]).not.toContain(res.status);
  });
});
