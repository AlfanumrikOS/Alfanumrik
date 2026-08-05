import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Safeguarding Phase 1 — /api/school-admin/safeguarding review API.
 *
 *   - authorizeSchoolAdmin gates both verbs with the dedicated
 *     'safeguarding.review' permission (NOT institution.view_analytics);
 *     non-admin gets the failure response and NO query runs.
 *   - Every query is hard-scoped to the caller's school_id (P8) — the list,
 *     the detail, the PATCH load, AND the PATCH update.
 *   - LIST payloads never select disclosure_excerpt (P13); only ?id= does.
 *   - status='dismissed' without non-empty review_notes → 400 (ops advisory).
 */

let _authResult: Record<string, unknown>;
const _authorizeCalls: unknown[][] = [];
vi.mock('@alfanumrik/lib/school-admin-auth', () => ({
  authorizeSchoolAdmin: vi.fn((...args: unknown[]) => {
    _authorizeCalls.push(args);
    return Promise.resolve(_authResult);
  }),
}));

vi.mock('@alfanumrik/lib/admin-auth', () => ({
  logAdminAuditByUserId: vi.fn(() => Promise.resolve()),
  logAdminAudit: vi.fn(() => Promise.resolve()),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const _selects: string[] = [];
const _eqCalls: Array<[string, unknown]> = [];
let _rows: Record<string, unknown>[] = [];
let _maybeSingleRow: Record<string, unknown> | null = null;
let _updatedRow: Record<string, unknown> | null = null;
let _queryCount = 0;

function makeChain() {
  const state = { mode: 'select' as 'select' | 'update' };
  const chain: Record<string, unknown> = {};
  chain.select = (cols: string) => {
    _selects.push(cols);
    return chain;
  };
  chain.update = () => {
    state.mode = 'update';
    return chain;
  };
  chain.eq = (col: string, val: unknown) => {
    _eqCalls.push([col, val]);
    return chain;
  };
  chain.order = () => chain;
  chain.limit = () => chain;
  chain.maybeSingle = () =>
    Promise.resolve({ data: state.mode === 'update' ? _updatedRow : _maybeSingleRow, error: null });
  (chain as { then: unknown }).then = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise.resolve({ data: _rows, error: null }).then(resolve, reject);
  return chain;
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: { from: vi.fn() },
  getSupabaseAdmin: () => ({
    from: (_table: string) => {
      _queryCount += 1;
      return makeChain();
    },
  }),
}));

function makeGet(query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/school-admin/safeguarding${query}`);
}
function makePatch(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/school-admin/safeguarding', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID_ID = '11111111-2222-3333-4444-555555555555';
const SCHOOL_ID = 'school-uuid-9';

beforeEach(() => {
  vi.clearAllMocks();
  _selects.length = 0;
  _eqCalls.length = 0;
  _authorizeCalls.length = 0;
  _rows = [];
  _maybeSingleRow = null;
  _updatedRow = null;
  _queryCount = 0;
  _authResult = {
    authorized: true,
    userId: 'school-admin-auth-1',
    schoolId: SCHOOL_ID,
    schoolAdminId: 'sa-row-1',
    schoolAdminRole: 'admin',
  };
});

describe('auth gate', () => {
  it('returns the auth failure and runs no query when unauthorized', async () => {
    _authResult = {
      authorized: false,
      errorResponse: NextResponse.json({ error: 'nope' }, { status: 403 }),
    };
    const { GET } = await import('@/app/api/school-admin/safeguarding/route');
    const res = await GET(makeGet());
    expect(res.status).toBe(403);
    expect(_queryCount).toBe(0);
    expect(_authorizeCalls[0]?.[1]).toBe('safeguarding.review');
  });

  it('gates GET and PATCH with the dedicated safeguarding.review permission', async () => {
    _rows = [];
    const { GET, PATCH } = await import('@/app/api/school-admin/safeguarding/route');
    await GET(makeGet());
    _maybeSingleRow = { id: VALID_ID, status: 'pending_review' };
    _updatedRow = { id: VALID_ID, status: 'reviewed' };
    await PATCH(makePatch({ id: VALID_ID, status: 'reviewed' }));
    expect(_authorizeCalls).toHaveLength(2);
    for (const call of _authorizeCalls) {
      expect(call[1]).toBe('safeguarding.review');
    }
  });
});

describe('GET — school scoping (P8) + excerpt-free list (P13)', () => {
  it('scopes the list to the caller school and never selects disclosure_excerpt', async () => {
    _rows = [{ id: VALID_ID, status: 'pending_review' }];
    const { GET } = await import('@/app/api/school-admin/safeguarding/route');
    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    expect(_selects[0]).not.toContain('disclosure_excerpt');
    expect(_eqCalls).toContainEqual(['school_id', SCHOOL_ID]);
  });

  it('detail (?id=) selects the excerpt but stays school-scoped', async () => {
    _maybeSingleRow = { id: VALID_ID, status: 'pending_review', disclosure_excerpt: 'x' };
    const { GET } = await import('@/app/api/school-admin/safeguarding/route');
    const res = await GET(makeGet(`?id=${VALID_ID}`));
    expect(res.status).toBe(200);
    expect(_selects[0]).toContain('disclosure_excerpt');
    expect(_eqCalls).toContainEqual(['school_id', SCHOOL_ID]);
  });

  it('404s a cross-school detail fetch (scoped query returns nothing) with no payload', async () => {
    _maybeSingleRow = null;
    const { GET } = await import('@/app/api/school-admin/safeguarding/route');
    const res = await GET(makeGet(`?id=${VALID_ID}`));
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.row).toBeUndefined();
    expect(body.rows).toBeUndefined();
    expect(body.data).toBeUndefined();
  });
});

describe('PATCH — same transition semantics, school-scoped', () => {
  it('transitions pending_review → actioned with the update scoped to the school', async () => {
    _maybeSingleRow = { id: VALID_ID, status: 'pending_review' };
    _updatedRow = { id: VALID_ID, status: 'actioned' };
    const { PATCH } = await import('@/app/api/school-admin/safeguarding/route');
    const res = await PATCH(makePatch({ id: VALID_ID, status: 'actioned' }));
    expect(res.status).toBe(200);
    // Both the load and the update must be school-scoped.
    const schoolScopes = _eqCalls.filter(([c, v]) => c === 'school_id' && v === SCHOOL_ID);
    expect(schoolScopes.length).toBeGreaterThanOrEqual(2);
  });

  it('409s when the row is not pending_review', async () => {
    _maybeSingleRow = { id: VALID_ID, status: 'dismissed' };
    const { PATCH } = await import('@/app/api/school-admin/safeguarding/route');
    const res = await PATCH(makePatch({ id: VALID_ID, status: 'reviewed' }));
    expect(res.status).toBe(409);
  });

  it('400s dismissal without review_notes and runs no query', async () => {
    const { PATCH } = await import('@/app/api/school-admin/safeguarding/route');
    const res = await PATCH(makePatch({ id: VALID_ID, status: 'dismissed' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ success: false, error: 'review_notes required for dismissal' });
    expect(_queryCount).toBe(0);
  });

  it('400s dismissal with whitespace-only review_notes', async () => {
    const { PATCH } = await import('@/app/api/school-admin/safeguarding/route');
    const res = await PATCH(makePatch({ id: VALID_ID, status: 'dismissed', review_notes: '   ' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('review_notes required for dismissal');
    expect(_queryCount).toBe(0);
  });

  it('allows dismissal with non-empty review_notes', async () => {
    _maybeSingleRow = { id: VALID_ID, status: 'pending_review' };
    _updatedRow = { id: VALID_ID, status: 'dismissed' };
    const { PATCH } = await import('@/app/api/school-admin/safeguarding/route');
    const res = await PATCH(
      makePatch({ id: VALID_ID, status: 'dismissed', review_notes: 'false positive — verified with class teacher' }),
    );
    expect(res.status).toBe(200);
  });
});
