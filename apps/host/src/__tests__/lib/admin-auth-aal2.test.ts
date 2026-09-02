/**
 * admin-auth.ts — P1-10 AAL2 enforcement gate (ff_admin_aal2_enforcement_v1).
 *
 * Covers the flag-ON path specifically. admin-auth.test.ts pins the
 * flag-OFF default (byte-identical to pre-P1-10 behavior) across its whole
 * existing suite; this file is the dedicated coverage for what changes once
 * the flag is flipped on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const _isFeatureEnabled = vi.fn();
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => _isFeatureEnabled(...args),
}));

import { authorizeAdmin } from '@alfanumrik/lib/admin-auth';

/** Builds a syntactically-valid (unsigned) 3-part JWT string carrying the given payload claims — enough for readAalClaimFromVerifiedToken's own base64url decode, which never checks the signature (GoTrue already did, before this helper is ever called). */
function fakeJwt(payload: Record<string, unknown>): string {
  const b64url = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.fakesignature`;
}

function reqWith(headers: Record<string, string>): NextRequest {
  return new NextRequest('https://example.com/api/super-admin/foo', { headers });
}

function mockGoTrueAndAdminLookup(token: string, adminLevel: string) {
  vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'u-1', email: 'a@x.com' }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify([{
      id: 'admin-id-1', name: 'Alice', email: 'admin@x.com', admin_level: adminLevel,
    }]), { status: 200 }));
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-key';
  _isFeatureEnabled.mockReset();
});

describe('authorizeAdmin — AAL2 enforcement (flag ON)', () => {
  it('denies admin_level "admin" with only aal1 — ADMIN_MFA_REQUIRED, 403, points to the enrollment page', async () => {
    _isFeatureEnabled.mockResolvedValue(true);
    const token = fakeJwt({ sub: 'u-1', aal: 'aal1' });
    mockGoTrueAndAdminLookup(token, 'admin');

    const r = await authorizeAdmin(reqWith({ Authorization: `Bearer ${token}` }), 'support');
    expect(r.authorized).toBe(false);
    if (!r.authorized) {
      expect(r.response.status).toBe(403);
      const body = await r.response.json();
      expect(body.code).toBe('ADMIN_MFA_REQUIRED');
      expect(body.enroll_url).toBe('/super-admin/enroll-mfa');
    }
  });

  it('denies admin_level "super_admin" with NO aal claim at all', async () => {
    _isFeatureEnabled.mockResolvedValue(true);
    const token = fakeJwt({ sub: 'u-1' }); // no aal claim
    mockGoTrueAndAdminLookup(token, 'super_admin');

    const r = await authorizeAdmin(reqWith({ Authorization: `Bearer ${token}` }), 'support');
    expect(r.authorized).toBe(false);
    if (!r.authorized) {
      const body = await r.response.json();
      expect(body.code).toBe('ADMIN_MFA_REQUIRED');
    }
  });

  it('authorizes admin_level "admin" with a verified aal2 session', async () => {
    _isFeatureEnabled.mockResolvedValue(true);
    const token = fakeJwt({ sub: 'u-1', aal: 'aal2' });
    mockGoTrueAndAdminLookup(token, 'admin');

    const r = await authorizeAdmin(reqWith({ Authorization: `Bearer ${token}` }), 'support');
    expect(r.authorized).toBe(true);
  });

  it('does NOT gate admin_level below "admin" (e.g. support) on aal2, even with the flag ON', async () => {
    _isFeatureEnabled.mockResolvedValue(true);
    const token = fakeJwt({ sub: 'u-1', aal: 'aal1' });
    mockGoTrueAndAdminLookup(token, 'support');

    const r = await authorizeAdmin(reqWith({ Authorization: `Bearer ${token}` }), 'support');
    expect(r.authorized).toBe(true);
    // The flag is never even consulted for a sub-admin level — hasMinimumLevel
    // gates the isFeatureEnabled call itself.
    expect(_isFeatureEnabled).not.toHaveBeenCalled();
  });

  it('does not deny on aal2 when the flag resolves OFF, even for super_admin with aal1', async () => {
    _isFeatureEnabled.mockResolvedValue(false);
    const token = fakeJwt({ sub: 'u-1', aal: 'aal1' });
    mockGoTrueAndAdminLookup(token, 'super_admin');

    const r = await authorizeAdmin(reqWith({ Authorization: `Bearer ${token}` }), 'support');
    expect(r.authorized).toBe(true);
  });
});
