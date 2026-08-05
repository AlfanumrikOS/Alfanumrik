import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Safeguarding Phase 1 — /api/super-admin/safeguarding review API.
 *
 *   - authorizeAdmin(request, 'admin') gates BOTH verbs — non-admin gets the
 *     auth failure response and NO query runs.
 *   - LIST payloads NEVER select or return disclosure_excerpt (P13); only the
 *     single-row ?id= detail does.
 *   - PATCH transitions pending_review → reviewed/actioned/dismissed only;
 *     non-pending rows 409; audit is metadata-only.
 */

let _authResult: Record<string, unknown>;
const _logAdminAudit = vi.fn(() => Promise.resolve());
vi.mock('@alfanumrik/lib/admin-auth', () => ({
  authorizeAdmin: vi.fn((...args: unknown[]) => {
    _authorizeCalls.push(args);
    return Promise.resolve(_authResult);
  }),
  logAdminAudit: (...args: unknown[]) => _logAdminAudit(...args),
  logAdminAuditByUserId: vi.fn(() => Promise.resolve()),
}));
const _authorizeCalls: unknown[][] = [];

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── supabaseAdmin chain mock — records select projections, returns fixtures ──
const _selects: string[] = [];
let _rows: Record<string, unknown>[] = [];
let _currentRow: Record<string, unknown> | null = null;
let _updatedRow: Record<string, unknown> | null = null;
let _updatePayload: Record<string, unknown> | null = null;
let _queryCount = 0;

function makeChain() {
  const state: { mode: 'select' | 'update'; cols?: string } = { mode: 'select' };
  const chain: Record<string, unknown> = {};
  chain.select = (cols: string) => {
    _selects.push(cols);
    state.cols = cols;
    return chain;
  };
  chain.update = (payload: Record<string, unknown>) => {
    _updatePayload = payload;
    state.mode = 'update';
    return chain;
  };
  chain.eq = () => chain;
  chain.order = () => chain;
  chain.limit = () => chain;
  chain.maybeSingle = () => {
    if (state.mode === 'update') return Promise.resolve({ data: _updatedRow, error: null });
    // select .maybeSingle(): the 'id, status' load vs the detail fetch.
    return Promise.resolve({ data: _currentRow, error: null });
  };
  (chain as { then: unknown }).then = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise.resolve({ data: _rows, error: null }).then(resolve, reject);
  return chain;
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (_table: string) => {
      _queryCount += 1;
      return makeChain();
    },
  },
  getSupabaseAdmin: vi.fn(),
}));

function makeGet(query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/super-admin/safeguarding${query}`);
}
function makePatch(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/super-admin/safeguarding', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID_ID = '11111111-2222-3333-4444-555555555555';

beforeEach(() => {
  vi.clearAllMocks();
  _selects.length = 0;
  _authorizeCalls.length = 0;
  _rows = [];
  _currentRow = null;
  _updatedRow = null;
  _updatePayload = null;
  _queryCount = 0;
  _authResult = {
    authorized: true,
    userId: 'admin-auth-user-1',
    adminId: 'admin-row-1',
    email: 'a@x.test',
    name: 'Admin',
    adminLevel: 'admin',
  };
});

describe('auth gate', () => {
  it('requires admin level "admin" and returns the auth failure without querying', async () => {
    _authResult = {
      authorized: false,
      response: NextResponse.json({ error: 'nope' }, { status: 403 }),
    };
    const { GET } = await import('@/app/api/super-admin/safeguarding/route');
    const res = await GET(makeGet());
    expect(res.status).toBe(403);
    expect(_queryCount).toBe(0);
    expect(_authorizeCalls[0]?.[1]).toBe('admin');
  });
});

describe('GET list — excerpt-free (P13)', () => {
  it('never selects disclosure_excerpt in the list projection', async () => {
    _rows = [
      { id: VALID_ID, category: 'self_harm', tier: 'high', status: 'pending_review' },
    ];
    const { GET } = await import('@/app/api/super-admin/safeguarding/route');
    const res = await GET(makeGet());
    const body = (await res.json()) as { rows: unknown[] };
    expect(res.status).toBe(200);
    expect(body.rows).toHaveLength(1);
    expect(_selects).toHaveLength(1);
    expect(_selects[0]).not.toContain('disclosure_excerpt');
  });

  it('rejects an invalid status filter with 400', async () => {
    const { GET } = await import('@/app/api/super-admin/safeguarding/route');
    const res = await GET(makeGet('?status=bogus'));
    expect(res.status).toBe(400);
  });

  it('returns disclosure_excerpt ONLY on the single-row ?id= detail', async () => {
    _currentRow = { id: VALID_ID, status: 'pending_review', disclosure_excerpt: 'x' };
    const { GET } = await import('@/app/api/super-admin/safeguarding/route');
    const res = await GET(makeGet(`?id=${VALID_ID}`));
    expect(res.status).toBe(200);
    expect(_selects[0]).toContain('disclosure_excerpt');
  });
});

describe('PATCH — status transition + metadata-only audit', () => {
  it('transitions pending_review → reviewed and audits metadata only', async () => {
    _currentRow = { id: VALID_ID, status: 'pending_review' };
    _updatedRow = { id: VALID_ID, status: 'reviewed' };
    const { PATCH } = await import('@/app/api/super-admin/safeguarding/route');
    const res = await PATCH(makePatch({ id: VALID_ID, status: 'reviewed', review_notes: 'ok' }));
    expect(res.status).toBe(200);
    expect(_updatePayload).toMatchObject({ status: 'reviewed', reviewed_by: 'admin-auth-user-1' });

    expect(_logAdminAudit).toHaveBeenCalledTimes(1);
    const details = _logAdminAudit.mock.calls[0][4] as Record<string, unknown>;
    expect(Object.keys(details).sort()).toEqual(['action', 'escalation_id', 'status']);
    expect(JSON.stringify(details)).not.toContain('disclosure');
  });

  it('409s when the row is no longer pending_review', async () => {
    _currentRow = { id: VALID_ID, status: 'reviewed' };
    const { PATCH } = await import('@/app/api/super-admin/safeguarding/route');
    const res = await PATCH(
      makePatch({ id: VALID_ID, status: 'dismissed', review_notes: 'dup case' }),
    );
    expect(res.status).toBe(409);
  });

  it('rejects an invalid target status (pending_review is not a PATCH target)', async () => {
    const { PATCH } = await import('@/app/api/super-admin/safeguarding/route');
    const res = await PATCH(makePatch({ id: VALID_ID, status: 'pending_review' }));
    expect(res.status).toBe(400);
  });

  it('400s dismissal without review_notes and runs no query', async () => {
    const { PATCH } = await import('@/app/api/super-admin/safeguarding/route');
    const res = await PATCH(makePatch({ id: VALID_ID, status: 'dismissed' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ success: false, error: 'review_notes required for dismissal' });
    expect(_queryCount).toBe(0);
  });

  it('400s dismissal with whitespace-only review_notes', async () => {
    const { PATCH } = await import('@/app/api/super-admin/safeguarding/route');
    const res = await PATCH(makePatch({ id: VALID_ID, status: 'dismissed', review_notes: '  ' }));
    expect(res.status).toBe(400);
    expect(_queryCount).toBe(0);
  });

  it('allows dismissal with non-empty review_notes', async () => {
    _currentRow = { id: VALID_ID, status: 'pending_review' };
    _updatedRow = { id: VALID_ID, status: 'dismissed' };
    const { PATCH } = await import('@/app/api/super-admin/safeguarding/route');
    const res = await PATCH(
      makePatch({ id: VALID_ID, status: 'dismissed', review_notes: 'classifier false positive' }),
    );
    expect(res.status).toBe(200);
    expect(_updatePayload).toMatchObject({ status: 'dismissed' });
  });
});
