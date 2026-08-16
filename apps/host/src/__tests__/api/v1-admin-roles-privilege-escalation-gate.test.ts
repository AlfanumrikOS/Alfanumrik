/**
 * P9 privilege-escalation gate — /api/v1/admin/roles.
 *
 * Ops Gate 5 finding on the Phase 1 Mission Control overhaul (2026-08-16):
 * before this fix, 20260816000008's all-6-tier admin_users -> RBAC role sync
 * trigger would grant the RBAC `admin` role to every admin_level='admin'
 * admin_users row, which — via the `admin` role's unconditional wildcard
 * permission grant (20260612123200) — handed those operators `role.manage`
 * for the first time. GET/POST/PATCH /api/v1/admin/roles gated ONLY on
 * `authorizeRequest(request, 'role.manage')`, with no additional
 * super_admin-specific check and no proxy.ts middleware coverage (that gate
 * only covers /internal/admin/* and /api/internal/admin/*). Net effect: an
 * admin-tier operator could rewrite ANY role's permission set — including
 * their own — via a raw PATCH call, a self-service path to super_admin-
 * equivalent reach.
 *
 * The fix has two independent halves, both exercised here:
 *   (a) DB: migration 20260816000010_admin_role_scope_out_role_manage.sql
 *       removes role.manage/permission.manage from the `admin` role's
 *       grant — pinned separately in
 *       admin-role-scope-out-role-manage-migration.test.ts (static SQL, no
 *       DB). A full live-DB integration test of the trigger firing +
 *       real RBAC lookup is out of scope for a Vitest unit test (matches
 *       the established convention — see
 *       analyst-role-and-admin-tier-sync-migration.test.ts's own note) and
 *       is tracked as a follow-up in the CI "integration tests" lane.
 *   (b) Route: this file. Proves the route now requires
 *       authorizeOperator(request, 'super_admin') IN ADDITION TO
 *       authorizeRequest(request, 'role.manage'), that the operator check
 *       runs FIRST (fail-fast — RBAC permission check and all DB work are
 *       never reached when the operator check denies), and that a genuine
 *       super_admin is NOT accidentally broken by the new gate.
 *
 * Strategy: mock both authorizeOperator (@alfanumrik/lib/admin-auth) and
 * authorizeRequest (@alfanumrik/lib/rbac) directly with return values that
 * mirror what the REAL implementations compute post-fix for each tier —
 * this is the same pattern used throughout this repo for gate-contract
 * pins (see rbac-elevation.test.ts, permission-gate-orphan-repoint.test.ts).
 * The real authorizeOperator tier-resolution logic (hasMinimumLevel parity,
 * admin -> DENY / super_admin -> ALLOW against a 'super_admin' floor) is
 * independently proven correct by the full 6x6 matrix in
 * apps/host/src/__tests__/lib/authorize-operator.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const _authorizeOperatorImpl = vi.fn();
const _authorizeRequestImpl = vi.fn();
const _logAuditImpl = vi.fn();
const _invalidateImpl = vi.fn();

vi.mock('@alfanumrik/lib/admin-auth', () => ({
  authorizeOperator: (...args: unknown[]) => _authorizeOperatorImpl(...args),
}));

vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeRequestImpl(...args),
  logAudit: (...args: unknown[]) => _logAuditImpl(...args),
  invalidateForSecurityEvent: (...args: unknown[]) => _invalidateImpl(...args),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@alfanumrik/lib/sanitize', () => ({
  isValidUUID: (s: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
}));

// ── supabaseAdmin mock: thenable chain proxy ────────────────────────────────
let _tableResults: Map<string, unknown> = new Map();
let _defaultResult: unknown = { data: null, error: null };

function chain(resolveWith: unknown) {
  const p = Promise.resolve(resolveWith);
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_, prop: string) {
      if (prop === 'then') return p.then.bind(p);
      if (prop === 'catch') return p.catch.bind(p);
      if (prop === 'finally') return p.finally.bind(p);
      if (prop === 'single') return () => p;
      if (prop === 'maybeSingle') return () => p;
      return () => new Proxy({} as Record<string, unknown>, handler);
    },
  };
  return new Proxy({} as Record<string, unknown>, handler);
}

const adminClient = {
  from: (table: string) => chain(_tableResults.get(table) ?? _defaultResult),
};

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: adminClient,
  getSupabaseAdmin: () => adminClient,
}));

// ── Helpers ─────────────────────────────────────────────────────────────────
function req(method: string, body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/v1/admin/roles', {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
    body: body !== undefined ? JSON.stringify(body) : null,
  });
}

/** Mirrors the REAL authorizeOperator(request, 'super_admin') verdict for an admin-tier caller (post-fix: DENY). */
function operatorTierAdmin() {
  _authorizeOperatorImpl.mockResolvedValue({
    authorized: false,
    response: new Response(
      JSON.stringify({ error: 'This action requires operator level "super_admin" or higher.', code: 'OPERATOR_INSUFFICIENT_LEVEL', required_level: 'super_admin' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    ),
  });
}

/** Mirrors the REAL authorizeOperator(request, 'super_admin') verdict for a genuine super_admin (ALLOW). */
function operatorTierSuperAdmin() {
  _authorizeOperatorImpl.mockResolvedValue({
    authorized: true,
    userId: 'sa-1',
    adminId: 'sa-1',
    email: 'root@x.com',
    name: 'Root',
    adminLevel: 'super_admin',
  });
}

/** Mirrors the REAL authorizeRequest(request, 'role.manage') verdict post-fix: only super_admin holds it. */
function permissionRoleManage(role: 'admin' | 'super_admin') {
  if (role === 'super_admin') {
    _authorizeRequestImpl.mockResolvedValue({
      authorized: true,
      userId: 'sa-1',
      studentId: null,
      roles: ['super_admin'],
      permissions: ['role.manage', 'permission.manage'],
      errorResponse: null,
    });
  } else {
    // Post-fix: 'admin' no longer holds role.manage.
    const errorResponse = new Response(
      JSON.stringify({ error: 'Forbidden', code: 'PERMISSION_DENIED', required: 'role.manage' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    );
    _authorizeRequestImpl.mockResolvedValue({
      authorized: false,
      userId: 'op-1',
      studentId: null,
      roles: ['admin'],
      permissions: [],
      errorResponse,
    });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  _tableResults = new Map();
  _defaultResult = { data: null, error: null };
});

const VALID_ROLE_ID = '550e8400-e29b-41d4-a716-446655440000';

describe('P9 — /api/v1/admin/roles requires super_admin operator tier (defense-in-depth)', () => {
  describe('an admin-tier operator (post 20260816000008 trigger sync) is REJECTED end-to-end', () => {
    it('GET: denied by the operator gate before the RBAC permission check ever runs', async () => {
      operatorTierAdmin();
      const { GET } = await import('@/app/api/v1/admin/roles/route');
      const res = await GET(req('GET'));
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.code).toBe('OPERATOR_INSUFFICIENT_LEVEL');
      // Fail-fast: authorizeRequest (the RBAC layer) must never be reached.
      expect(_authorizeRequestImpl).not.toHaveBeenCalled();
    });

    it('POST: denied by the operator gate before any role creation happens', async () => {
      operatorTierAdmin();
      const { POST } = await import('@/app/api/v1/admin/roles/route');
      const res = await POST(req('POST', { name: 'shadow-admin', permissions: ['role.manage'] }));
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.code).toBe('OPERATOR_INSUFFICIENT_LEVEL');
      expect(_authorizeRequestImpl).not.toHaveBeenCalled();
    });

    it('PATCH: denied by the operator gate before any role_permissions mutation happens', async () => {
      operatorTierAdmin();
      const { PATCH } = await import('@/app/api/v1/admin/roles/route');
      const res = await PATCH(
        req('PATCH', { role_id: VALID_ROLE_ID, permissions: ['role.manage', 'permission.manage', 'system.config'] }),
      );
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.code).toBe('OPERATOR_INSUFFICIENT_LEVEL');
      // The central escalation vector: an admin-tier caller must NEVER reach
      // the RBAC layer, let alone the role_permissions delete/insert below it.
      expect(_authorizeRequestImpl).not.toHaveBeenCalled();
    });

    it('PATCH: even if the RBAC permission check were somehow bypassed to ALLOW (regression simulation), the operator gate alone still blocks the admin-tier caller', async () => {
      // Defense-in-depth proof: simulate a hypothetical regression where
      // role.manage got re-granted to `admin` (the exact bug this PR fixes),
      // by making the RBAC mock permissive too. The operator gate — which
      // runs FIRST and short-circuits on deny — must still be the one that
      // blocks the request; assert the response is unaffected by whatever
      // authorizeRequest would have said.
      operatorTierAdmin();
      permissionRoleManage('admin'); // won't even be invoked, but wire it as "hypothetically ALLOW"
      _authorizeRequestImpl.mockResolvedValue({
        authorized: true,
        userId: 'op-1',
        studentId: null,
        roles: ['admin'],
        permissions: ['role.manage'],
        errorResponse: null,
      });
      const { PATCH } = await import('@/app/api/v1/admin/roles/route');
      const res = await PATCH(req('PATCH', { role_id: VALID_ROLE_ID, permissions: ['role.manage'] }));
      expect(res.status).toBe(403);
      expect(_authorizeRequestImpl).not.toHaveBeenCalled();
    });
  });

  describe('a genuine super_admin is NOT accidentally broken by the new gate', () => {
    it('GET: succeeds through both gates', async () => {
      operatorTierSuperAdmin();
      permissionRoleManage('super_admin');
      _tableResults.set('roles', { data: [{ id: VALID_ROLE_ID, name: 'editor' }], error: null });
      const { GET } = await import('@/app/api/v1/admin/roles/route');
      const res = await GET(req('GET'));
      expect(res.status).toBe(200);
      expect(_authorizeOperatorImpl).toHaveBeenCalledWith(expect.anything(), 'super_admin');
      expect(_authorizeRequestImpl).toHaveBeenCalledWith(expect.anything(), 'role.manage');
    });

    it('POST: passes both gates and reaches route logic (not blocked at 401/403)', async () => {
      // Not asserting 201 here: the shared chain() proxy mock resolves every
      // `.from('roles')` call (both the duplicate-name check and the
      // post-insert `.select().single()`) to the SAME `_tableResults`
      // value, which this route's business logic doesn't support
      // distinguishing in a simple table-name-keyed mock. That is a DB
      // plumbing detail unrelated to this gate-contract pin — what matters
      // here is that both auth gates were consulted, in the right order,
      // with the right required level/permission, and neither denied.
      operatorTierSuperAdmin();
      permissionRoleManage('super_admin');
      const { POST } = await import('@/app/api/v1/admin/roles/route');
      const res = await POST(req('POST', { name: 'editor' }));
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
      expect(_authorizeOperatorImpl).toHaveBeenCalledWith(expect.anything(), 'super_admin');
      expect(_authorizeRequestImpl).toHaveBeenCalledWith(expect.anything(), 'role.manage');
    });

    it('PATCH: succeeds through both gates and actually reaches the mutation', async () => {
      operatorTierSuperAdmin();
      permissionRoleManage('super_admin');
      _tableResults.set('roles', { data: { id: VALID_ROLE_ID, name: 'editor' }, error: null });
      _tableResults.set('user_roles', { data: [], error: null });
      const { PATCH } = await import('@/app/api/v1/admin/roles/route');
      const res = await PATCH(req('PATCH', { role_id: VALID_ROLE_ID, permissions: [] }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(_authorizeOperatorImpl).toHaveBeenCalledWith(expect.anything(), 'super_admin');
      expect(_authorizeRequestImpl).toHaveBeenCalledWith(expect.anything(), 'role.manage');
    });
  });

  describe('gate ordering', () => {
    it('PATCH calls authorizeOperator before authorizeRequest (fail-fast on the cheaper/stronger check first)', async () => {
      const callOrder: string[] = [];
      _authorizeOperatorImpl.mockImplementation(async () => {
        callOrder.push('operator');
        return { authorized: true, userId: 'sa-1', adminId: 'sa-1', email: '', name: '', adminLevel: 'super_admin' };
      });
      _authorizeRequestImpl.mockImplementation(async () => {
        callOrder.push('rbac');
        return { authorized: true, userId: 'sa-1', studentId: null, roles: ['super_admin'], permissions: ['role.manage'], errorResponse: null };
      });
      _tableResults.set('roles', { data: { id: VALID_ROLE_ID, name: 'editor' }, error: null });
      _tableResults.set('user_roles', { data: [], error: null });
      const { PATCH } = await import('@/app/api/v1/admin/roles/route');
      await PATCH(req('PATCH', { role_id: VALID_ROLE_ID, permissions: [] }));
      expect(callOrder).toEqual(['operator', 'rbac']);
    });
  });
});
