import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * REG-147 (API half) — /api/super-admin/entitlements GET + PUT.
 *
 * Under test: src/app/api/super-admin/entitlements/route.ts
 *   - Auth: authorizeAdmin(request, 'super_admin'). Non-super-admin → the auth
 *     failure response (403), with no data leak.
 *   - GET ?school_id  → the full resolved panel-row set for the school.
 *   - PUT sparse      → {key,value} upserts, {key,_delete:true} deletes, in one
 *     pass; an invalid key or wrong value shape → 400 BEFORE any write; a
 *     contract not belonging to the school → 400; every applied change emits an
 *     admin audit row carrying ids/keys/values only (P13 — no PII).
 *
 * House mocking style (src/__tests__/api/foxy/*): collaborators mocked at the
 * module boundary.
 *   - @alfanumrik/lib/admin-auth          → authorizeAdmin (drive authorized/denied) +
 *                                 logAdminAudit (capture audit payloads).
 *   - @alfanumrik/lib/entitlements/resolver → getResolvedEntitlements stubbed so the
 *                                 panel-row builder is deterministic and the
 *                                 test focuses on the ROUTE (auth/validation/
 *                                 write/audit), not resolution (covered by
 *                                 resolver.test.ts).
 *   - @alfanumrik/lib/supabase-admin      → per-table chained builder recording every
 *                                 upsert/delete so the sparse-apply + write-order
 *                                 + before-any-write-on-400 assertions can inspect
 *                                 exactly what the route asked the DB to do.
 *   The catalog (@alfanumrik/lib/entitlements/catalog) stays REAL — the route's key/value
 *   validation IS the contract under test.
 */

const SCHOOL = '11111111-1111-4111-8111-111111111111';
const CONTRACT = '22222222-2222-4222-8222-222222222222';
const FOREIGN_SCHOOL = '33333333-3333-4333-8333-333333333333';

// ─── @alfanumrik/lib/admin-auth ────────────────────────────────────────────────────────
const _authorizeAdmin = vi.fn();
const _logAdminAudit = vi.fn().mockResolvedValue(undefined);
vi.mock('@alfanumrik/lib/admin-auth', () => ({
  authorizeAdmin: (...args: unknown[]) => _authorizeAdmin(...args),
  logAdminAudit: (...args: unknown[]) => _logAdminAudit(...args),
}));

// ─── @alfanumrik/lib/logger ────────────────────────────────────────────────────────────
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─── @alfanumrik/lib/entitlements/resolver — deterministic resolved set ────────────────
import { ENTITLEMENT_CATALOG } from '@alfanumrik/lib/entitlements/catalog';

function deterministicByKey() {
  const byKey = new Map<string, unknown>();
  for (const e of ENTITLEMENT_CATALOG) {
    const value = e.valueShape === 'enabled' ? { enabled: true } : { max: 5, period: 'day' };
    byKey.set(e.key, {
      key: e.key,
      value,
      resolved_by: 'plan_default',
      effectiveEnabled: e.valueShape === 'enabled' ? true : null,
      effectiveMax: e.valueShape === 'enabled' ? null : 5,
      force_disabled_by_parent: false,
    });
  }
  return byKey;
}

const _getResolvedEntitlements = vi.fn(async (..._args: unknown[]) => ({ plan: 'free', byKey: deterministicByKey() }));
vi.mock('@alfanumrik/lib/entitlements/resolver', () => ({
  getResolvedEntitlements: (...args: unknown[]) => _getResolvedEntitlements(...args),
}));

// ─── @alfanumrik/lib/supabase-admin (per-table chained builder, records writes) ────────
interface WriteRecord {
  table: string;
  op: 'upsert' | 'delete';
  payload?: unknown;
  inArgs: Array<[string, unknown]>;
  eqArgs: Array<[string, unknown]>;
}

let writes: WriteRecord[] = [];
// What each single-row lookup returns.
let schoolRow: { id: string } | null;
let contractRow: { id: string; school_id: string } | null;
let institutionRows: Array<Record<string, unknown>>;
let contractSummaryRow: Record<string, unknown> | null;

function makeBuilder(table: string) {
  const rec: WriteRecord = { table, op: 'upsert', inArgs: [], eqArgs: [] };
  // The route reads school_contracts twice: the ownership check (.eq('id',…)
  // then .maybeSingle) and loadContractSummary (.order(...).limit(...).
  // maybeSingle). `ordered` distinguishes them so the ownership check sees the
  // real ownership row and the summary read sees the summary row.
  let ordered = false;

  const resolveRead = (): { data: unknown; error: null } => {
    if (table === 'institution_entitlements') return { data: institutionRows, error: null };
    return { data: [], error: null };
  };
  const resolveSingle = (): { data: unknown; error: null } => {
    if (table === 'schools') return { data: schoolRow, error: null };
    if (table === 'school_contracts') {
      return { data: ordered ? contractSummaryRow : contractRow, error: null };
    }
    if (table === 'institution_entitlements') return { data: null, error: null };
    return { data: null, error: null };
  };

  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = (col: string, val: unknown) => {
    rec.eqArgs.push([col, val]);
    return builder;
  };
  builder.in = (col: string, val: unknown) => {
    rec.inArgs.push([col, val]);
    // For a delete, the terminal .in(...) resolves the write.
    if (rec.op === 'delete') {
      writes.push(rec);
      return Promise.resolve({ data: null, error: null });
    }
    return builder;
  };
  builder.order = () => {
    ordered = true;
    return builder;
  };
  builder.limit = () => builder;
  builder.maybeSingle = () => Promise.resolve(resolveSingle());
  builder.single = () => Promise.resolve(resolveSingle());
  builder.upsert = (payload: unknown) => {
    rec.op = 'upsert';
    rec.payload = payload;
    writes.push(rec);
    return Promise.resolve({ data: null, error: null });
  };
  builder.delete = () => {
    rec.op = 'delete';
    return builder;
  };
  (builder as { then: unknown }).then = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise.resolve(resolveRead()).then(resolve, reject);
  return builder;
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (table: string) => makeBuilder(table) },
  getSupabaseAdmin: () => ({ from: (table: string) => makeBuilder(table) }),
}));

import { GET, PUT } from '@/app/api/super-admin/entitlements/route';

function makeGet(qs: string): NextRequest {
  return new NextRequest(`http://localhost/api/super-admin/entitlements${qs}`, { method: 'GET' });
}
function makePut(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/super-admin/entitlements', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const OK_AUTH = {
  authorized: true as const,
  userId: 'admin-auth-uid',
  adminId: 'admin-row-id',
  email: 'admin@alfanumrik.com',
  name: 'Ops Admin',
  adminLevel: 'super_admin',
};

beforeEach(() => {
  vi.clearAllMocks();
  writes = [];
  schoolRow = { id: SCHOOL };
  contractRow = { id: CONTRACT, school_id: SCHOOL };
  institutionRows = [];
  contractSummaryRow = { id: CONTRACT, contract_number: 'C-1', status: 'active' };
  _authorizeAdmin.mockResolvedValue(OK_AUTH);
  _getResolvedEntitlements.mockResolvedValue({ plan: 'free', byKey: deterministicByKey() });
});

// ─────────────────────────────────────────────────────────────────────────────
// Auth — non-super-admin → 403, no data leak
// ─────────────────────────────────────────────────────────────────────────────

describe('REG-147 route — super-admin auth gate', () => {
  it('GET as non-super-admin → the authorizeAdmin failure response (403), no rows', async () => {
    const { NextResponse } = await import('next/server');
    _authorizeAdmin.mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    });
    const res = await GET(makeGet(`?school_id=${SCHOOL}`));
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty('rows');
    expect(body).not.toHaveProperty('data');
  });

  it('PUT as non-super-admin → 403, and NO DB write happens', async () => {
    const { NextResponse } = await import('next/server');
    _authorizeAdmin.mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    });
    const res = await PUT(makePut({ school_id: SCHOOL, changes: [{ key: 'module.lms', value: { enabled: true } }] }));
    expect(res.status).toBe(403);
    expect(writes).toHaveLength(0);
    expect(_logAdminAudit).not.toHaveBeenCalled();
  });

  it('GET requires super_admin level (authorizeAdmin called with "super_admin")', async () => {
    await GET(makeGet(`?school_id=${SCHOOL}`));
    expect(_authorizeAdmin).toHaveBeenCalledWith(expect.anything(), 'super_admin');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET — resolved rows shape
// ─────────────────────────────────────────────────────────────────────────────

describe('REG-147 route — GET resolved set', () => {
  it('returns success + the 12-row resolved panel set for a valid school_id', async () => {
    const res = await GET(makeGet(`?school_id=${SCHOOL}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { school_id: string; rows: unknown[] } };
    expect(body.success).toBe(true);
    expect(body.data.school_id).toBe(SCHOOL);
    expect(body.data.rows).toHaveLength(ENTITLEMENT_CATALOG.length);
  });

  it('each row carries the catalog metadata + effective/resolved_by fields', async () => {
    const res = await GET(makeGet(`?school_id=${SCHOOL}`));
    const body = (await res.json()) as { data: { rows: Array<Record<string, unknown>> } };
    const row = body.data.rows[0];
    for (const f of ['key', 'category', 'control', 'valueShape', 'effective', 'resolved_by']) {
      expect(row).toHaveProperty(f);
    }
  });

  it('rejects a non-UUID school_id with 400 (before any resolution)', async () => {
    const res = await GET(makeGet('?school_id=not-a-uuid'));
    expect(res.status).toBe(400);
    expect(_getResolvedEntitlements).not.toHaveBeenCalled();
  });

  it('404 when the school does not exist', async () => {
    schoolRow = null;
    const res = await GET(makeGet(`?school_id=${SCHOOL}`));
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT sparse upsert / delete
// ─────────────────────────────────────────────────────────────────────────────

describe('REG-147 route — PUT sparse upsert/delete', () => {
  it('a {key,value} change upserts exactly that row (onConflict school_id,entitlement_key)', async () => {
    const res = await PUT(makePut({
      school_id: SCHOOL,
      changes: [{ key: 'feature.foxy_interact', value: { enabled: true } }],
    }));
    expect(res.status).toBe(200);
    const upserts = writes.filter(w => w.table === 'institution_entitlements' && w.op === 'upsert');
    expect(upserts).toHaveLength(1);
    const payload = upserts[0].payload as Array<Record<string, unknown>>;
    expect(payload).toHaveLength(1);
    expect(payload[0]).toMatchObject({
      school_id: SCHOOL,
      entitlement_key: 'feature.foxy_interact',
      value: { enabled: true },
    });
  });

  it('a {key,_delete:true} change deletes exactly that key, no upsert', async () => {
    const res = await PUT(makePut({
      school_id: SCHOOL,
      changes: [{ key: 'module.live_classes', _delete: true }],
    }));
    expect(res.status).toBe(200);
    const deletes = writes.filter(w => w.table === 'institution_entitlements' && w.op === 'delete');
    const upserts = writes.filter(w => w.table === 'institution_entitlements' && w.op === 'upsert');
    expect(deletes).toHaveLength(1);
    expect(upserts).toHaveLength(0);
    // the delete is scoped to the school + the requested key
    const delRec = deletes[0];
    expect(delRec.eqArgs).toContainEqual(['school_id', SCHOOL]);
    expect(delRec.inArgs).toContainEqual(['entitlement_key', ['module.live_classes']]);
  });

  it('mixes upsert + delete in one request (sparse)', async () => {
    const res = await PUT(makePut({
      school_id: SCHOOL,
      changes: [
        { key: 'feature.exam_create', value: { enabled: false } },
        { key: 'limit.quiz_daily', _delete: true },
      ],
    }));
    expect(res.status).toBe(200);
    expect(writes.filter(w => w.op === 'upsert')).toHaveLength(1);
    expect(writes.filter(w => w.op === 'delete')).toHaveLength(1);
    const body = (await res.json()) as { data: { applied: Array<{ key: string; action: string }> } };
    expect(body.data.applied).toEqual([
      { key: 'feature.exam_create', action: 'set' },
      { key: 'limit.quiz_daily', action: 'clear' },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT validation — invalid key / wrong shape rejected BEFORE any write
// ─────────────────────────────────────────────────────────────────────────────

describe('REG-147 route — PUT validation rejects before any write', () => {
  it('an INVALID key → 400, no write, no audit', async () => {
    const res = await PUT(makePut({
      school_id: SCHOOL,
      changes: [{ key: 'module.not_a_real_key', value: { enabled: true } }],
    }));
    expect(res.status).toBe(400);
    expect(writes).toHaveLength(0);
    expect(_logAdminAudit).not.toHaveBeenCalled();
  });

  it('a wrong VALUE SHAPE (max for a toggle key) → 400, no write', async () => {
    const res = await PUT(makePut({
      school_id: SCHOOL,
      changes: [{ key: 'module.lms', value: { max: 10, period: 'day' } }],
    }));
    expect(res.status).toBe(400);
    expect(writes).toHaveLength(0);
  });

  it('a wrong VALUE SHAPE (enabled for a limit key) → 400, no write', async () => {
    const res = await PUT(makePut({
      school_id: SCHOOL,
      changes: [{ key: 'limit.quiz_daily', value: { enabled: true } }],
    }));
    expect(res.status).toBe(400);
    expect(writes).toHaveLength(0);
  });

  it('a valid change AFTER an invalid one still rejects the whole batch (all-or-nothing validation)', async () => {
    const res = await PUT(makePut({
      school_id: SCHOOL,
      changes: [
        { key: 'module.lms', value: { enabled: true } },     // valid
        { key: 'limit.quiz_daily', value: { enabled: true } }, // invalid shape
      ],
    }));
    expect(res.status).toBe(400);
    expect(writes).toHaveLength(0);
  });

  it('an empty changes array → 400', async () => {
    const res = await PUT(makePut({ school_id: SCHOOL, changes: [] }));
    expect(res.status).toBe(400);
    expect(writes).toHaveLength(0);
  });

  it('a non-UUID school_id → 400 before any lookup', async () => {
    const res = await PUT(makePut({ school_id: 'nope', changes: [{ key: 'module.lms', value: { enabled: true } }] }));
    expect(res.status).toBe(400);
    expect(writes).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT — contract belonging to school
// ─────────────────────────────────────────────────────────────────────────────

describe('REG-147 route — PUT contract ownership', () => {
  it('a contract_id that belongs to the school is accepted', async () => {
    contractRow = { id: CONTRACT, school_id: SCHOOL };
    const res = await PUT(makePut({
      school_id: SCHOOL,
      contract_id: CONTRACT,
      changes: [{ key: 'module.analytics', value: { enabled: true } }],
    }));
    expect(res.status).toBe(200);
    // the upserted row stamps the contract_id
    const upsert = writes.find(w => w.op === 'upsert');
    const payload = upsert!.payload as Array<Record<string, unknown>>;
    expect(payload[0].contract_id).toBe(CONTRACT);
  });

  it('a contract_id that belongs to ANOTHER school → 400, no write', async () => {
    contractRow = { id: CONTRACT, school_id: FOREIGN_SCHOOL };
    const res = await PUT(makePut({
      school_id: SCHOOL,
      contract_id: CONTRACT,
      changes: [{ key: 'module.analytics', value: { enabled: true } }],
    }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/contract_id does not belong/i);
    expect(writes.filter(w => w.op === 'upsert')).toHaveLength(0);
  });

  it('a contract_id that does not exist → 404, no write', async () => {
    contractRow = null;
    const res = await PUT(makePut({
      school_id: SCHOOL,
      contract_id: CONTRACT,
      changes: [{ key: 'module.analytics', value: { enabled: true } }],
    }));
    expect(res.status).toBe(404);
    expect(writes.filter(w => w.op === 'upsert')).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT — audit (one row per change, ids/keys/values only — P13)
// ─────────────────────────────────────────────────────────────────────────────

describe('REG-147 route — PUT audit trail (P13: ids/keys/values, no PII)', () => {
  it('emits exactly one audit row per applied change', async () => {
    await PUT(makePut({
      school_id: SCHOOL,
      changes: [
        { key: 'feature.exam_create', value: { enabled: false } },
        { key: 'limit.quiz_daily', _delete: true },
      ],
    }));
    expect(_logAdminAudit).toHaveBeenCalledTimes(2);
  });

  it('the audit action distinguishes set vs clear; details carry school_id/key/values + actor', async () => {
    await PUT(makePut({
      school_id: SCHOOL,
      changes: [
        { key: 'feature.exam_create', value: { enabled: false } },
        { key: 'module.live_classes', _delete: true },
      ],
    }));
    const calls = _logAdminAudit.mock.calls;
    // call signature: (auth, action, entityType, entityId, details, ip, opts)
    const byAction = new Map<string, unknown[]>(calls.map(c => [c[1] as string, c]));
    expect(byAction.has('entitlement.override.set')).toBe(true);
    expect(byAction.has('entitlement.override.clear')).toBe(true);

    const setCall = byAction.get('entitlement.override.set')!;
    expect(setCall[2]).toBe('institution_entitlement');
    expect(setCall[3]).toBe(`${SCHOOL}:feature.exam_create`); // entityId = school:key composite
    const setDetails = setCall[4] as Record<string, unknown>;
    expect(setDetails.school_id).toBe(SCHOOL);
    expect(setDetails.key).toBe('feature.exam_create');
    expect(setDetails.new_value).toEqual({ enabled: false });
    expect(setDetails.actor).toBe(OK_AUTH.adminId);

    const clearCall = byAction.get('entitlement.override.clear')!;
    const clearDetails = clearCall[4] as Record<string, unknown>;
    expect(clearDetails.new_value).toBeNull(); // a clear sets new_value to null
  });

  it('audit details contain NO PII keys (no email / phone / name / password)', async () => {
    await PUT(makePut({
      school_id: SCHOOL,
      changes: [{ key: 'module.analytics', value: { enabled: true } }],
    }));
    for (const call of _logAdminAudit.mock.calls) {
      const details = JSON.stringify(call[4] ?? {});
      expect(details).not.toMatch(/email|phone|password|"name"/i);
    }
  });
});
