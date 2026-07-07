/**
 * /api/school-admin/gst-details — GET/PUT a school's own GST identity (Track A.3 B2B).
 *
 * Pins:
 *   - TENANT ISOLATION: every query is scoped to auth.schoolId. A school admin can
 *     only read/write THEIR OWN school's row — the route never accepts a school_id
 *     from the request body; it always uses auth.schoolId. We assert the upsert
 *     payload + select filter carry the authenticated school, and that a body-
 *     supplied foreign school_id is ignored.
 *   - authorizeSchoolAdmin gate: denial short-circuits before DB.
 *   - GSTIN 15-char format validation; unregistered (null gstin) allowed.
 *   - is_registered=true without a GSTIN is rejected.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAuthorizeSchoolAdmin = vi.fn();
vi.mock('@alfanumrik/lib/school-admin-auth', () => ({
  authorizeSchoolAdmin: (...a: unknown[]) => mockAuthorizeSchoolAdmin(...a),
}));
vi.mock('@alfanumrik/lib/school-admin/permission-code', () => ({
  schoolAdminPermissionCode: vi.fn().mockResolvedValue('institution.manage'),
}));

const dbCalls = vi.hoisted(() => ({
  selectFilters: [] as Array<[string, unknown]>,
  upsertPayload: null as any,
  upsertOptions: null as any,
}));
let _selectRow: any = { data: null, error: null };
let _upsertRow: any = { data: null, error: null };

function fromMock() {
  const chain: any = {};
  chain.select = () => chain;
  chain.eq = (c: string, v: unknown) => { dbCalls.selectFilters.push([c, v]); return chain; };
  chain.maybeSingle = () => Promise.resolve(_upsertPending ? _upsertRow : _selectRow);
  chain.upsert = (payload: any, options: any) => {
    dbCalls.upsertPayload = payload;
    dbCalls.upsertOptions = options;
    _upsertPending = true;
    return chain;
  };
  return chain;
}
let _upsertPending = false;

vi.mock('@alfanumrik/lib/supabase-admin', () => ({ getSupabaseAdmin: () => ({ from: () => fromMock() }) }));
vi.mock('@alfanumrik/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const SCHOOL_A = 'school-A-uuid';

function authorized(schoolId = SCHOOL_A) {
  return { authorized: true, userId: 'u1', schoolId, schoolAdminId: 'sa1', roles: ['institution_admin'], permissions: ['institution.manage'] };
}
function deniedSA(status: number) {
  const { NextResponse } = require('next/server');
  return { authorized: false, errorResponse: NextResponse.json({ success: false, error: 'Unauthorized', code: 'AUTH_REQUIRED' }, { status }) };
}

function req(body?: unknown): any {
  return { json: async () => body ?? {}, headers: { get: () => null } };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbCalls.selectFilters = [];
  dbCalls.upsertPayload = null;
  dbCalls.upsertOptions = null;
  _selectRow = { data: null, error: null };
  _upsertRow = { data: { id: 'g1', school_id: SCHOOL_A, gstin: null, is_registered: false }, error: null };
  _upsertPending = false;
  mockAuthorizeSchoolAdmin.mockResolvedValue(authorized());
});

async function loadGET() { return (await import('@/app/api/school-admin/gst-details/route')).GET; }
async function loadPUT() { return (await import('@/app/api/school-admin/gst-details/route')).PUT; }

describe('GET /api/school-admin/gst-details — tenant isolation + auth', () => {
  it('scopes the read to the authenticated school_id only', async () => {
    _selectRow = { data: { id: 'g1', school_id: SCHOOL_A, gstin: '27ABCDE1234F1Z5', is_registered: true }, error: null };
    const GET = await loadGET();
    const res = await GET(req());
    expect(res).toBeDefined();
    expect(res!.status).toBe(200);
    expect(dbCalls.selectFilters).toContainEqual(['school_id', SCHOOL_A]);
    // It NEVER queries any other school.
    expect(dbCalls.selectFilters.every(([c, v]) => c !== 'school_id' || v === SCHOOL_A)).toBe(true);
  });

  it('returns a typed empty shell scoped to the caller school when no row exists', async () => {
    _selectRow = { data: null, error: null };
    const GET = await loadGET();
    const res = await GET(req());
    expect(res).toBeDefined();
    const body = await res!.json();
    expect(body.data.school_id).toBe(SCHOOL_A);
    expect(body.data.is_registered).toBe(false);
  });

  it('a denied school admin gets the gate response and never reads the DB', async () => {
    mockAuthorizeSchoolAdmin.mockResolvedValue(deniedSA(403));
    const GET = await loadGET();
    const res = await GET(req());
    expect(res).toBeDefined();
    expect(res!.status).toBe(403);
    expect(dbCalls.selectFilters).toHaveLength(0);
  });
});

describe('PUT /api/school-admin/gst-details — tenant isolation', () => {
  it('writes only the authenticated school_id, ignoring any school_id in the body (cross-school denied)', async () => {
    const PUT = await loadPUT();
    const res = await PUT(req({ school_id: 'school-B-attacker', gstin: '27ABCDE1234F1Z5', legal_name: 'A School' }));
    expect(res).toBeDefined();
    expect(res!.status).toBe(200);
    // The persisted school_id is the AUTHENTICATED school, not the body's foreign id.
    expect(dbCalls.upsertPayload.school_id).toBe(SCHOOL_A);
    expect(dbCalls.upsertPayload.school_id).not.toBe('school-B-attacker');
    expect(dbCalls.upsertOptions).toEqual({ onConflict: 'school_id' });
  });

  it('a denied school admin cannot write', async () => {
    mockAuthorizeSchoolAdmin.mockResolvedValue(deniedSA(403));
    const PUT = await loadPUT();
    const res = await PUT(req({ gstin: '27ABCDE1234F1Z5' }));
    expect(res).toBeDefined();
    expect(res!.status).toBe(403);
    expect(dbCalls.upsertPayload).toBeNull();
  });
});

describe('PUT /api/school-admin/gst-details — GSTIN validation', () => {
  it('accepts a valid 15-char GSTIN and derives is_registered=true', async () => {
    const PUT = await loadPUT();
    const res = await PUT(req({ gstin: '27ABCDE1234F1Z5', legal_name: 'A School' }));
    expect(res).toBeDefined();
    expect(res!.status).toBe(200);
    expect(dbCalls.upsertPayload.gstin).toBe('27ABCDE1234F1Z5');
    expect(dbCalls.upsertPayload.is_registered).toBe(true);
  });

  it('rejects a malformed GSTIN (wrong length/shape) with 400', async () => {
    const PUT = await loadPUT();
    const res = await PUT(req({ gstin: '27ABCDE' }));
    expect(res).toBeDefined();
    expect(res!.status).toBe(400);
    expect(dbCalls.upsertPayload).toBeNull();
  });

  it('allows an unregistered school (null gstin) → is_registered=false', async () => {
    const PUT = await loadPUT();
    const res = await PUT(req({ gstin: null, legal_name: 'Unregistered School' }));
    expect(res).toBeDefined();
    expect(res!.status).toBe(200);
    expect(dbCalls.upsertPayload.gstin).toBeNull();
    expect(dbCalls.upsertPayload.is_registered).toBe(false);
  });

  it('rejects is_registered=true with no GSTIN (P11-adjacent integrity)', async () => {
    const PUT = await loadPUT();
    const res = await PUT(req({ is_registered: true }));
    expect(res).toBeDefined();
    expect(res!.status).toBe(400);
    expect(dbCalls.upsertPayload).toBeNull();
  });
});
