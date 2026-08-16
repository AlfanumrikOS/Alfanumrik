/**
 * authorizeOperator() — unit tests.
 *
 * Phase 1 of the CEO-authorized super-admin Mission Control overhaul
 * (2026-08-16): authorizeOperator() is the RBAC-backed eventual replacement
 * for authorizeAdmin(). Same call-site shape, same 6-tier floor semantics
 * (support < analyst < content_manager < finance < admin < super_admin),
 * but resolved from RBAC (user_roles/roles via getUserPermissions()) instead
 * of admin_users.admin_level directly.
 *
 * This file is the release-blocker "privilege-sync" / "authorizeOperator
 * parity" regression coverage: it proves —
 *   (b) authorizeOperator() ranks/denies/allows EXACTLY like hasMinimumLevel
 *       (the same comparison authorizeAdmin() uses) across the full 6x6
 *       tier matrix — a parity test: same (have, need) pairs, same verdicts.
 *   - the rank comparison is scoped to ONLY the 6 reserved operator-tier
 *     role names, never the shared `roles.hierarchy_level` column (which
 *     also covers non-operator roles like reviewer=58, institution_admin=70
 *     that must NEVER satisfy an operator floor).
 *   - identity resolution (Bearer/cookie candidates, GoTrue verification,
 *     config-missing failures) mirrors authorizeAdmin()'s behavior with
 *     OPERATOR_-prefixed codes.
 *   - admin_users enrichment is best-effort / non-authoritative: a caller
 *     with an RBAC operator-tier role but NO admin_users row is still
 *     authorized (supported case under the "RBAC is sole authority" mandate).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const getUserPermissions = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({
  getUserPermissions: (...args: unknown[]) => getUserPermissions(...args),
}));

import {
  authorizeOperator,
  hasMinimumLevel,
  ADMIN_LEVELS,
  type AdminLevel,
} from '@alfanumrik/lib/admin-auth';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-key';
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = ORIGINAL_ENV;
});

function reqWith(headers: Record<string, string>): NextRequest {
  return new NextRequest('https://example.com/api/super-admin/foo', { headers });
}

function mockGoTrueUser(id = 'u-1', email = 'op@x.com') {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) {
      return new Response(JSON.stringify({ id, email }), { status: 200 });
    }
    if (url.includes('/admin_users')) {
      // No matching admin_users row by default — proves enrichment is optional.
      return new Response(JSON.stringify([]), { status: 200 });
    }
    return new Response('', { status: 201 });
  });
}

function rolesFor(level: AdminLevel) {
  return { roles: [{ name: level, display_name: level, hierarchy_level: 0 }], permissions: [] };
}

// ─── Config / identity failures (parity with authorizeAdmin's shapes) ────

describe('authorizeOperator — config and identity resolution', () => {
  it('returns 500 when NEXT_PUBLIC_SUPABASE_URL is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const r = await authorizeOperator(reqWith({}), 'support');
    expect(r.authorized).toBe(false);
    if (!r.authorized) expect(r.response.status).toBe(500);
  });

  it('returns 500 when SUPABASE_SERVICE_ROLE_KEY is missing', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const r = await authorizeOperator(reqWith({}), 'support');
    expect(r.authorized).toBe(false);
    if (!r.authorized) expect(r.response.status).toBe(500);
  });

  it('returns 401 OPERATOR_NO_TOKEN when no Authorization header and no auth cookie', async () => {
    const r = await authorizeOperator(reqWith({}), 'support');
    expect(r.authorized).toBe(false);
    if (!r.authorized) {
      expect(r.response.status).toBe(401);
      const body = await r.response.json();
      expect(body.code).toBe('OPERATOR_NO_TOKEN');
    }
  });

  it('returns 401 OPERATOR_SESSION_EXPIRED when GoTrue rejects the token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('expired', { status: 401 }));
    const r = await authorizeOperator(reqWith({ Authorization: 'Bearer bad-token' }), 'support');
    expect(r.authorized).toBe(false);
    if (!r.authorized) {
      expect(r.response.status).toBe(401);
      const body = await r.response.json();
      expect(body.code).toBe('OPERATOR_SESSION_EXPIRED');
    }
  });

  it('returns 401 OPERATOR_INVALID_SESSION when GoTrue returns no id', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    const r = await authorizeOperator(reqWith({ Authorization: 'Bearer fake' }), 'support');
    expect(r.authorized).toBe(false);
    if (!r.authorized) {
      const body = await r.response.json();
      expect(body.code).toBe('OPERATOR_INVALID_SESSION');
    }
  });

  it('extracts the access token from a sb-* auth cookie when no Bearer header is set', async () => {
    const cookieValue = encodeURIComponent(JSON.stringify({ access_token: 'cookie-token', token_type: 'bearer' }));
    mockGoTrueUser();
    getUserPermissions.mockResolvedValue(rolesFor('support'));
    const r = await authorizeOperator(reqWith({ Cookie: `sb-test-auth-token=${cookieValue}` }), 'support');
    expect(r.authorized).toBe(true);
  });

  it('returns 500 OPERATOR_LOOKUP_FAILED when getUserPermissions() throws', async () => {
    mockGoTrueUser();
    getUserPermissions.mockRejectedValue(new Error('rpc down'));
    const r = await authorizeOperator(reqWith({ Authorization: 'Bearer good' }), 'support');
    expect(r.authorized).toBe(false);
    if (!r.authorized) {
      expect(r.response.status).toBe(500);
      const body = await r.response.json();
      expect(body.code).toBe('OPERATOR_LOOKUP_FAILED');
    }
  });

  it('returns 500 OPERATOR_AUTH_EXCEPTION when an unexpected error is thrown', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network gone'));
    const r = await authorizeOperator(reqWith({ Authorization: 'Bearer good' }), 'support');
    expect(r.authorized).toBe(false);
    if (!r.authorized) {
      expect(r.response.status).toBe(500);
      const body = await r.response.json();
      expect(body.code).toBe('OPERATOR_AUTH_EXCEPTION');
    }
  });
});

// ─── Tier resolution + rank parity ────────────────────────────────────────

describe('authorizeOperator — tier resolution', () => {
  it('returns 403 OPERATOR_NOT_FOUND when the caller holds no operator-tier RBAC role', async () => {
    mockGoTrueUser();
    getUserPermissions.mockResolvedValue({
      roles: [{ name: 'teacher', display_name: 'Teacher', hierarchy_level: 50 }],
      permissions: [],
    });
    const r = await authorizeOperator(reqWith({ Authorization: 'Bearer good' }), 'support');
    expect(r.authorized).toBe(false);
    if (!r.authorized) {
      expect(r.response.status).toBe(403);
      const body = await r.response.json();
      expect(body.code).toBe('OPERATOR_NOT_FOUND');
    }
  });

  it('returns 403 OPERATOR_NOT_FOUND for a caller with NO roles at all', async () => {
    mockGoTrueUser();
    getUserPermissions.mockResolvedValue({ roles: [], permissions: [] });
    const r = await authorizeOperator(reqWith({ Authorization: 'Bearer good' }), 'support');
    expect(r.authorized).toBe(false);
    if (!r.authorized) {
      const body = await r.response.json();
      expect(body.code).toBe('OPERATOR_NOT_FOUND');
    }
  });

  // ── Collision safety: roles whose hierarchy_level happens to interleave
  // with the operator-tier band (reviewer=58, institution_admin=70) must
  // NEVER satisfy an operator floor. This is the core reason
  // authorizeOperator() must NOT compare raw hierarchy_level.
  it.each([
    ['reviewer', 58],
    ['institution_admin', 70],
    ['tutor', 40],
  ] as const)('a %s role (hierarchy_level=%i) never satisfies the support floor', async (roleName, hierarchyLevel) => {
    mockGoTrueUser();
    getUserPermissions.mockResolvedValue({
      roles: [{ name: roleName, display_name: roleName, hierarchy_level: hierarchyLevel }],
      permissions: [],
    });
    const r = await authorizeOperator(reqWith({ Authorization: 'Bearer good' }), 'support');
    expect(r.authorized).toBe(false);
    if (!r.authorized) {
      const body = await r.response.json();
      expect(body.code).toBe('OPERATOR_NOT_FOUND');
    }
  });

  it('resolves the HIGHEST operator tier when the caller holds multiple roles', async () => {
    mockGoTrueUser();
    getUserPermissions.mockResolvedValue({
      roles: [
        { name: 'support', display_name: 'Support', hierarchy_level: 55 },
        { name: 'finance', display_name: 'Finance', hierarchy_level: 65 },
        { name: 'teacher', display_name: 'Teacher', hierarchy_level: 50 },
      ],
      permissions: [],
    });
    const r = await authorizeOperator(reqWith({ Authorization: 'Bearer good' }), 'finance');
    expect(r.authorized).toBe(true);
    if (r.authorized) expect(r.adminLevel).toBe('finance');
  });

  // ── Full 6x6 parity matrix: authorizeOperator's verdict must exactly
  // match hasMinimumLevel(have, need) — the same comparison authorizeAdmin()
  // performs — for every (have, need) pair.
  describe('parity matrix: authorizeOperator(have) vs hasMinimumLevel(have, need)', () => {
    for (const have of ADMIN_LEVELS) {
      for (const need of ADMIN_LEVELS) {
        const expectAllowed = hasMinimumLevel(have, need);
        it(`have=${have}, need=${need} -> ${expectAllowed ? 'ALLOW' : 'DENY'}`, async () => {
          mockGoTrueUser();
          getUserPermissions.mockResolvedValue(rolesFor(have));
          const r = await authorizeOperator(reqWith({ Authorization: 'Bearer good' }), need);
          expect(r.authorized).toBe(expectAllowed);
          if (expectAllowed && r.authorized) {
            expect(r.adminLevel).toBe(have);
          } else if (!expectAllowed && !r.authorized) {
            expect(r.response.status).toBe(403);
            const body = await r.response.json();
            expect(body.code).toBe('OPERATOR_INSUFFICIENT_LEVEL');
            expect(body.required_level).toBe(need);
          }
        });
      }
    }
  });
});

// ─── admin_users enrichment (best-effort, non-authoritative) ─────────────

describe('authorizeOperator — admin_users enrichment', () => {
  it('authorizes an RBAC-only operator with NO matching admin_users row (adminId falls back to userId)', async () => {
    mockGoTrueUser('u-rbac-only', 'rbac-only@x.com');
    getUserPermissions.mockResolvedValue(rolesFor('finance'));

    const r = await authorizeOperator(reqWith({ Authorization: 'Bearer good' }), 'finance');
    expect(r.authorized).toBe(true);
    if (r.authorized) {
      expect(r.userId).toBe('u-rbac-only');
      expect(r.adminId).toBe('u-rbac-only');
      expect(r.email).toBe('rbac-only@x.com');
      expect(r.name).toBe('');
      expect(r.adminLevel).toBe('finance');
    }
  });

  it('enriches adminId/name/email from a matching admin_users row when present', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/v1/user')) {
        return new Response(JSON.stringify({ id: 'u-2', email: 'gotrue@x.com' }), { status: 200 });
      }
      if (url.includes('/admin_users')) {
        return new Response(
          JSON.stringify([{ id: 'admin-row-9', name: 'Nina Ops', email: 'nina@x.com' }]),
          { status: 200 },
        );
      }
      return new Response('', { status: 201 });
    });
    getUserPermissions.mockResolvedValue(rolesFor('admin'));

    const r = await authorizeOperator(reqWith({ Authorization: 'Bearer good' }), 'admin');
    expect(r.authorized).toBe(true);
    if (r.authorized) {
      expect(r.adminId).toBe('admin-row-9');
      expect(r.name).toBe('Nina Ops');
      expect(r.email).toBe('nina@x.com');
    }
  });

  it('never denies when the admin_users enrichment fetch itself fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/v1/user')) {
        return new Response(JSON.stringify({ id: 'u-3', email: 'ok@x.com' }), { status: 200 });
      }
      if (url.includes('/admin_users')) {
        throw new Error('network blip');
      }
      return new Response('', { status: 201 });
    });
    getUserPermissions.mockResolvedValue(rolesFor('super_admin'));

    const r = await authorizeOperator(reqWith({ Authorization: 'Bearer good' }), 'super_admin');
    expect(r.authorized).toBe(true);
    if (r.authorized) {
      expect(r.adminId).toBe('u-3');
      expect(r.adminLevel).toBe('super_admin');
    }
  });
});
