/**
 * Phase 3B Wave C — /api/school-admin/staff route unit tests (mocked, NO DB).
 *
 * Mirrors the Wave B seat-enforcement-routes seam discipline:
 *   - the flag seam (`isFeatureEnabled`) is mocked so each test controls the gate;
 *   - the auth seam (`authorizeSchoolAdmin`) is stubbed authorized with a fixed
 *     school + self-admin id;
 *   - the supabase-admin client is a controllable handler-keyed chainable stub
 *     that ALSO supports `{ count }` (the lockout principal count uses
 *     `.select('id', { count:'exact', head:true })`);
 *   - logger / audit are no-op mocks (and we assert no PII is logged).
 *
 * Coverage:
 *   FLAG OFF → 404 on ALL verbs (gate runs BEFORE auth — authorizeSchoolAdmin is
 *     never even consulted).
 *   FLAG ON  → GET lists school-scoped active staff; POST invite-new (201) +
 *     idempotent reactivate of a revoked member (200) + no-op on an active member
 *     (200); PATCH role change (valid enum, invalid enum → 400, cross-school → 404,
 *     last-principal demote → 409 LAST_PRINCIPAL_LOCKOUT); DELETE revoke (200) +
 *     last-principal revoke → 409 + cross-school → 404; no PII in logs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const SCHOOL = '11111111-1111-1111-1111-111111111111';
const OTHER_SCHOOL = '22222222-2222-2222-2222-222222222222';
const SELF_ADMIN = 'sa-self-1';

// ── Flag seam (gate branches on this). Default ON for this file; the flag-OFF
//    describe block flips it false in its own beforeEach. ──
const flag = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...a: unknown[]) => flag.isFeatureEnabled(...a),
  SCHOOL_ADMIN_RBAC_FLAGS: { V1: 'ff_school_admin_rbac' },
}));

// ── Auth seam. authorizeSchoolAdmin stubbed authorized. Controllable so the
//    flag-OFF block can prove it is NEVER called (gate short-circuits first). ──
const auth = vi.hoisted(() => ({
  authorizeSchoolAdmin: vi.fn(),
}));
vi.mock('@/lib/school-admin-auth', () => ({
  authorizeSchoolAdmin: (...a: unknown[]) => auth.authorizeSchoolAdmin(...a),
}));

// ── Quiet infra mocks. We capture audit + logger calls to assert no PII. ──
const captured = vi.hoisted(() => ({
  audit: [] as Array<Record<string, unknown>>,
  logArgs: [] as unknown[],
}));
vi.mock('@/lib/audit', () => ({
  logSchoolAudit: vi.fn(async (entry: Record<string, unknown>) => {
    captured.audit.push(entry);
  }),
}));
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn((...a: unknown[]) => captured.logArgs.push(a)),
    warn: vi.fn((...a: unknown[]) => captured.logArgs.push(a)),
    error: vi.fn((...a: unknown[]) => captured.logArgs.push(a)),
  },
}));

// ── Controllable supabase-admin chainable stub (handler-keyed, count-aware). ──
const dbState = vi.hoisted(() => ({
  handlers: {} as Record<string, () => Promise<{ data: unknown; error: unknown; count?: number }>>,
  authCreateUser: vi.fn(),
  authListUsers: vi.fn(),
  // record the row passed to each update so we can assert is_active / role flips
  updates: [] as Array<{ table: string; row: unknown }>,
  inserts: [] as Array<{ table: string; row: unknown }>,
}));

function makeDb() {
  function builder(table: string) {
    const ctx = { op: 'select' };
    const chain: Record<string, unknown> = {};
    const ret = () => chain;
    chain.select = vi.fn((_c?: unknown, _opts?: unknown) => chain);
    chain.eq = vi.fn(ret);
    chain.order = vi.fn(ret);
    chain.update = vi.fn((row: unknown) => {
      ctx.op = 'update';
      dbState.updates.push({ table, row });
      return chain;
    });
    chain.insert = vi.fn((row: unknown) => {
      ctx.op = 'insert';
      dbState.inserts.push({ table, row });
      return chain;
    });
    const resolve = (term: string) => {
      const h =
        dbState.handlers[`${table}:${term}`] ??
        dbState.handlers[`${table}:${ctx.op}`] ??
        dbState.handlers[table];
      if (h) return h();
      return Promise.resolve({ data: null, error: null, count: 0 });
    };
    chain.maybeSingle = vi.fn(() => resolve('maybeSingle'));
    chain.single = vi.fn(() => resolve('single'));
    // GET / update / count selects await the chain directly (no terminal).
    (chain as { then: unknown }).then = (onF: (v: unknown) => unknown) =>
      resolve(ctx.op).then(onF);
    return chain;
  }
  return {
    from: vi.fn((t: string) => builder(t)),
    auth: { admin: { createUser: dbState.authCreateUser, listUsers: dbState.authListUsers } },
  };
}

vi.mock('@/lib/supabase-admin', () => {
  const db = makeDb();
  return { getSupabaseAdmin: () => db, supabaseAdmin: db };
});

import { GET, POST, PATCH, DELETE } from '@/app/api/school-admin/staff/route';

function jsonReq(body: unknown, method = 'POST', url = '/api/school-admin/staff'): Request {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function getReq(url = '/api/school-admin/staff'): Request {
  return new Request(`http://localhost${url}`, { method: 'GET' });
}

function authedOk() {
  auth.authorizeSchoolAdmin.mockResolvedValue({
    authorized: true,
    userId: 'admin-user-1',
    schoolId: SCHOOL,
    schoolAdminId: SELF_ADMIN,
    schoolAdminRole: 'principal',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  dbState.handlers = {};
  dbState.authCreateUser.mockReset();
  dbState.authListUsers.mockReset();
  dbState.updates = [];
  dbState.inserts = [];
  captured.audit = [];
  captured.logArgs = [];
  flag.isFeatureEnabled.mockResolvedValue(true); // ON by default
  authedOk();
});

// ═════════════════════════════════════════════════════════════════════════════
// FLAG OFF — 404 on every verb, gate BEFORE auth
// ═════════════════════════════════════════════════════════════════════════════
describe('FLAG OFF — endpoint behaves as not-present (404 before auth)', () => {
  beforeEach(() => {
    flag.isFeatureEnabled.mockResolvedValue(false);
  });

  it('GET → 404 and never calls authorizeSchoolAdmin', async () => {
    const res = await GET(getReq() as never);
    expect(res.status).toBe(404);
    expect(auth.authorizeSchoolAdmin).not.toHaveBeenCalled();
  });

  it('POST → 404 and never calls authorizeSchoolAdmin', async () => {
    const res = await POST(jsonReq({ email: 'x@y.test', role: 'vice_principal' }) as never);
    expect(res.status).toBe(404);
    expect(auth.authorizeSchoolAdmin).not.toHaveBeenCalled();
  });

  it('PATCH → 404 and never calls authorizeSchoolAdmin', async () => {
    const res = await PATCH(jsonReq({ id: 'sa-2', role: 'principal' }, 'PATCH') as never);
    expect(res.status).toBe(404);
    expect(auth.authorizeSchoolAdmin).not.toHaveBeenCalled();
  });

  it('DELETE → 404 and never calls authorizeSchoolAdmin', async () => {
    const res = await DELETE(jsonReq({ id: 'sa-2' }, 'DELETE') as never);
    expect(res.status).toBe(404);
    expect(auth.authorizeSchoolAdmin).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FLAG ON — authorize denial passthrough
// ═════════════════════════════════════════════════════════════════════════════
describe('FLAG ON — authorize denial is returned unchanged', () => {
  it('returns the authorizeSchoolAdmin 403 when the caller lacks manage_staff', async () => {
    auth.authorizeSchoolAdmin.mockResolvedValue({
      authorized: false,
      errorResponse: new Response(JSON.stringify({ success: false, code: 'SCHOOL_ADMIN_ROLE_DENIED' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    });
    const res = await GET(getReq() as never);
    expect(res.status).toBe(403);
    expect(auth.authorizeSchoolAdmin).toHaveBeenCalledWith(expect.anything(), 'institution.manage_staff');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GET — list school-scoped active staff
// ═════════════════════════════════════════════════════════════════════════════
describe('GET — lists active staff for the caller school', () => {
  it('returns the staff array (200)', async () => {
    const staff = [
      { id: 'sa-self-1', name: 'Pat', email: 'p@s.test', role: 'principal', is_active: true },
      { id: 'sa-2', name: 'Vee', email: 'v@s.test', role: 'vice_principal', is_active: true },
    ];
    dbState.handlers['school_admins'] = () => Promise.resolve({ data: staff, error: null });

    const res = await GET(getReq() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.staff).toHaveLength(2);
  });

  it('returns an empty array (not an error) when the school has no other staff', async () => {
    dbState.handlers['school_admins'] = () => Promise.resolve({ data: [], error: null });
    const res = await GET(getReq() as never);
    expect(res.status).toBe(200);
    expect((await res.json()).data.staff).toEqual([]);
  });

  it('maps a list DB error to 500', async () => {
    dbState.handlers['school_admins'] = () =>
      Promise.resolve({ data: null, error: { message: 'boom' } });
    const res = await GET(getReq() as never);
    expect(res.status).toBe(500);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// POST — invite / reactivate / no-op (idempotent)
// ═════════════════════════════════════════════════════════════════════════════
describe('POST — invite new (201)', () => {
  it('creates an auth user + school_admins row and returns 201', async () => {
    // existing-by-email: none; createUser ok; by-auth re-check: none; insert→row
    dbState.handlers['school_admins:maybeSingle'] = () => Promise.resolve({ data: null, error: null });
    dbState.authCreateUser.mockResolvedValue({ data: { user: { id: 'auth-new' } }, error: null });
    dbState.handlers['school_admins:single'] = () =>
      Promise.resolve({ data: { id: 'sa-new', role: 'vice_principal' }, error: null });

    const res = await POST(
      jsonReq({ email: 'new@s.test', role: 'vice_principal', name: 'New Admin' }) as never,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.id).toBe('sa-new');
    expect(body.data.reactivated).toBe(false);
    expect(body.data.alreadyMember).toBe(false);
    // an audit row was written for the invite
    expect(captured.audit.some((a) => a.action === 'school_admin.invited')).toBe(true);
  });

  it('rejects an invalid email with 400', async () => {
    const res = await POST(jsonReq({ email: 'not-an-email', role: 'principal' }) as never);
    expect(res.status).toBe(400);
  });

  it('rejects an invalid role enum with 400', async () => {
    const res = await POST(jsonReq({ email: 'ok@s.test', role: 'headmaster' }) as never);
    expect(res.status).toBe(400);
  });
});

describe('POST — idempotent on an existing member', () => {
  it('no-op (200) when the email is already an ACTIVE member (does not change role)', async () => {
    dbState.handlers['school_admins:maybeSingle'] = () =>
      Promise.resolve({
        data: { id: 'sa-existing', auth_user_id: 'auth-x', role: 'principal', is_active: true },
        error: null,
      });

    const res = await POST(
      jsonReq({ email: 'dup@s.test', role: 'vice_principal' }) as never, // requests a DIFFERENT role
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.alreadyMember).toBe(true);
    expect(body.data.reactivated).toBe(false);
    // role is the existing one — the no-op did NOT silently change it
    expect(body.data.role).toBe('principal');
    // no insert / createUser happened
    expect(dbState.authCreateUser).not.toHaveBeenCalled();
    expect(dbState.inserts.length).toBe(0);
  });

  it('reactivates a previously-revoked member (200) with the requested role', async () => {
    dbState.handlers['school_admins:maybeSingle'] = () =>
      Promise.resolve({
        data: { id: 'sa-revoked', auth_user_id: 'auth-y', role: 'academic_coordinator', is_active: false },
        error: null,
      });
    dbState.handlers['school_admins:update'] = () => Promise.resolve({ data: null, error: null });

    const res = await POST(jsonReq({ email: 'back@s.test', role: 'vice_principal' }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.reactivated).toBe(true);
    expect(body.data.role).toBe('vice_principal');
    // the update set is_active back to true with the requested role
    const upd = dbState.updates.find((u) => u.table === 'school_admins');
    expect(upd).toBeDefined();
    expect((upd!.row as { is_active: boolean }).is_active).toBe(true);
    expect((upd!.row as { role: string }).role).toBe('vice_principal');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PATCH — role change + cross-school + last-principal lockout
// ═════════════════════════════════════════════════════════════════════════════
describe('PATCH — role change', () => {
  it('changes a non-principal target role (200)', async () => {
    dbState.handlers['school_admins:maybeSingle'] = () =>
      Promise.resolve({
        data: { id: 'sa-2', role: 'vice_principal', is_active: true, school_id: SCHOOL },
        error: null,
      });
    dbState.handlers['school_admins:update'] = () => Promise.resolve({ data: null, error: null });

    const res = await PATCH(jsonReq({ id: 'sa-2', role: 'academic_coordinator' }, 'PATCH') as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.changed).toBe(true);
    expect(body.data.role).toBe('academic_coordinator');
    expect(captured.audit.some((a) => a.action === 'school_admin.role_changed')).toBe(true);
  });

  it('is a no-op (200, changed:false) when the role is unchanged', async () => {
    dbState.handlers['school_admins:maybeSingle'] = () =>
      Promise.resolve({
        data: { id: 'sa-2', role: 'vice_principal', is_active: true, school_id: SCHOOL },
        error: null,
      });
    const res = await PATCH(jsonReq({ id: 'sa-2', role: 'vice_principal' }, 'PATCH') as never);
    expect(res.status).toBe(200);
    expect((await res.json()).data.changed).toBe(false);
    expect(dbState.updates.length).toBe(0);
  });

  it('rejects an invalid role enum with 400', async () => {
    const res = await PATCH(jsonReq({ id: 'sa-2', role: 'headmaster' }, 'PATCH') as never);
    expect(res.status).toBe(400);
  });

  it('returns 404 for a CROSS-SCHOOL target (target.school_id != caller school)', async () => {
    dbState.handlers['school_admins:maybeSingle'] = () =>
      Promise.resolve({
        data: { id: 'sa-other', role: 'vice_principal', is_active: true, school_id: OTHER_SCHOOL },
        error: null,
      });
    const res = await PATCH(jsonReq({ id: 'sa-other', role: 'principal' }, 'PATCH') as never);
    expect(res.status).toBe(404);
    expect(dbState.updates.length).toBe(0);
  });

  it('returns 409 LAST_PRINCIPAL_LOCKOUT when demoting the ONLY active principal', async () => {
    // target is a principal; count of active principals = 1 ⇒ lockout.
    dbState.handlers['school_admins:maybeSingle'] = () =>
      Promise.resolve({
        data: { id: 'sa-self-1', role: 'principal', is_active: true, school_id: SCHOOL },
        error: null,
      });
    // countActivePrincipals: awaited select with { count } ⇒ count=1
    dbState.handlers['school_admins'] = () => Promise.resolve({ data: null, error: null, count: 1 });

    const res = await PATCH(jsonReq({ id: 'sa-self-1', role: 'vice_principal' }, 'PATCH') as never);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('LAST_PRINCIPAL_LOCKOUT');
    // nothing was updated — the demote was blocked all-or-nothing
    expect(dbState.updates.length).toBe(0);
  });

  it('ALLOWS demoting a principal when ANOTHER active principal remains (count=2)', async () => {
    dbState.handlers['school_admins:maybeSingle'] = () =>
      Promise.resolve({
        data: { id: 'sa-p2', role: 'principal', is_active: true, school_id: SCHOOL },
        error: null,
      });
    dbState.handlers['school_admins'] = () => Promise.resolve({ data: null, error: null, count: 2 });
    dbState.handlers['school_admins:update'] = () => Promise.resolve({ data: null, error: null });

    const res = await PATCH(jsonReq({ id: 'sa-p2', role: 'vice_principal' }, 'PATCH') as never);
    expect(res.status).toBe(200);
    expect((await res.json()).data.changed).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// DELETE — revoke + cross-school + last-principal lockout + idempotent
// ═════════════════════════════════════════════════════════════════════════════
describe('DELETE — revoke (deactivate)', () => {
  it('revokes a non-principal member (200)', async () => {
    dbState.handlers['school_admins:maybeSingle'] = () =>
      Promise.resolve({
        data: { id: 'sa-2', role: 'vice_principal', is_active: true, school_id: SCHOOL },
        error: null,
      });
    dbState.handlers['school_admins:update'] = () => Promise.resolve({ data: null, error: null });

    const res = await DELETE(jsonReq({ id: 'sa-2' }, 'DELETE') as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.revoked).toBe(true);
    expect(body.data.alreadyRevoked).toBe(false);
    const upd = dbState.updates.find((u) => u.table === 'school_admins');
    expect((upd!.row as { is_active: boolean }).is_active).toBe(false);
    expect(captured.audit.some((a) => a.action === 'school_admin.revoked')).toBe(true);
  });

  it('is idempotent (200, alreadyRevoked:true) for an already-revoked member', async () => {
    dbState.handlers['school_admins:maybeSingle'] = () =>
      Promise.resolve({
        data: { id: 'sa-2', role: 'vice_principal', is_active: false, school_id: SCHOOL },
        error: null,
      });
    const res = await DELETE(jsonReq({ id: 'sa-2' }, 'DELETE') as never);
    expect(res.status).toBe(200);
    expect((await res.json()).data.alreadyRevoked).toBe(true);
    expect(dbState.updates.length).toBe(0);
  });

  it('returns 404 for a CROSS-SCHOOL target', async () => {
    dbState.handlers['school_admins:maybeSingle'] = () =>
      Promise.resolve({
        data: { id: 'sa-other', role: 'vice_principal', is_active: true, school_id: OTHER_SCHOOL },
        error: null,
      });
    const res = await DELETE(jsonReq({ id: 'sa-other' }, 'DELETE') as never);
    expect(res.status).toBe(404);
    expect(dbState.updates.length).toBe(0);
  });

  it('returns 409 LAST_PRINCIPAL_LOCKOUT when revoking the ONLY active principal', async () => {
    dbState.handlers['school_admins:maybeSingle'] = () =>
      Promise.resolve({
        data: { id: 'sa-self-1', role: 'principal', is_active: true, school_id: SCHOOL },
        error: null,
      });
    dbState.handlers['school_admins'] = () => Promise.resolve({ data: null, error: null, count: 1 });

    const res = await DELETE(jsonReq({ id: 'sa-self-1' }, 'DELETE') as never);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('LAST_PRINCIPAL_LOCKOUT');
    expect(dbState.updates.length).toBe(0);
  });

  it('ALLOWS revoking a principal when another active principal remains (count=2)', async () => {
    dbState.handlers['school_admins:maybeSingle'] = () =>
      Promise.resolve({
        data: { id: 'sa-p2', role: 'principal', is_active: true, school_id: SCHOOL },
        error: null,
      });
    dbState.handlers['school_admins'] = () => Promise.resolve({ data: null, error: null, count: 2 });
    dbState.handlers['school_admins:update'] = () => Promise.resolve({ data: null, error: null });

    const res = await DELETE(jsonReq({ id: 'sa-p2' }, 'DELETE') as never);
    expect(res.status).toBe(200);
    expect((await res.json()).data.revoked).toBe(true);
  });

  it('requires an id (400 when none supplied)', async () => {
    const res = await DELETE(jsonReq(undefined, 'DELETE') as never);
    expect(res.status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// P13 — no PII in logs / audit metadata
// ═════════════════════════════════════════════════════════════════════════════
describe('P13 — no PII in audit metadata or logs', () => {
  it('the invite audit row carries id/role only (no email / name / phone)', async () => {
    dbState.handlers['school_admins:maybeSingle'] = () => Promise.resolve({ data: null, error: null });
    dbState.authCreateUser.mockResolvedValue({ data: { user: { id: 'auth-new' } }, error: null });
    dbState.handlers['school_admins:single'] = () =>
      Promise.resolve({ data: { id: 'sa-new', role: 'vice_principal' }, error: null });

    await POST(jsonReq({ email: 'secret@person.test', role: 'vice_principal', name: 'Real Name' }) as never);

    const invite = captured.audit.find((a) => a.action === 'school_admin.invited');
    expect(invite).toBeDefined();
    const blob = JSON.stringify(invite);
    expect(blob).not.toContain('secret@person.test');
    expect(blob).not.toContain('Real Name');
  });

  it('a 500-path error log never includes the target email', async () => {
    dbState.handlers['school_admins'] = () =>
      Promise.resolve({ data: null, error: { message: 'db down' } });
    await GET(getReq() as never);
    const blob = JSON.stringify(captured.logArgs);
    expect(blob).not.toContain('@'); // no email-shaped PII reached the logger args
  });
});
