/**
 * Phase 3B Wave A / A5 — resolveCommandCenterContext + helpers (unit, no DB).
 *
 * resolveCommandCenterContext is the server-side school-resolution guard shared
 * by all three Command Center read routes. It is the FIRST line of cross-tenant
 * safety (the SECURITY DEFINER RPC's internal guard is defence-in-depth behind
 * it). These tests pin its contract WITHOUT a live DB by mocking:
 *   - `@alfanumrik/lib/rbac` authorizeRequest (P9 gate)
 *   - `@supabase/ssr` createServerClient (membership lookup)
 *   - `@alfanumrik/lib/logger`
 *
 * Resolution contract under test:
 *   - P9 gate fails               → its 401/403 returned UNCHANGED
 *   - no active membership        → 403
 *   - single membership, no param → resolves that school
 *   - multi-school, no ?school_id → 400 with { school_ids }
 *   - ?school_id not a membership → 403
 *   - ?school_id is a membership  → resolves the requested school
 *   - membership lookup DB error  → 500, no SQL leaked
 *
 * Plus the pure helpers parsePagination + rpcErrorResponse.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── authorizeRequest mock (controllable per test) ─────────────────────────────
const { mockAuthorize } = vi.hoisted(() => ({ mockAuthorize: vi.fn() }));
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => mockAuthorize(...args),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── createServerClient mock — returns a client whose school_admins query
//    resolves to a controllable result. The function does:
//      supabase.from('school_admins').select('school_id').eq('is_active', true)
//    and awaits the chain, so the terminal node must be a thenable. ───────────
const membershipHolder: { data: unknown; error: { message: string } | null } = {
  data: [],
  error: null,
};

function schoolAdminsBuilder() {
  const chain = {
    select() {
      return chain;
    },
    eq() {
      // Terminal node — awaited by the resolver. Resolve the controllable result.
      return Promise.resolve({ data: membershipHolder.data, error: membershipHolder.error });
    },
  };
  return chain;
}

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    from(table: string) {
      if (table === 'school_admins') return schoolAdminsBuilder();
      throw new Error(`unexpected table: ${table}`);
    },
  }),
}));

import {
  resolveCommandCenterContext,
  parsePagination,
  rpcErrorResponse,
  COMMAND_CENTER_PERMISSION,
  COMMAND_CENTER_CACHE_CONTROL,
} from '@alfanumrik/lib/school-admin/command-center-context';
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
} from '@alfanumrik/lib/school-admin/command-center-types';

const SCHOOL_A = '11111111-1111-1111-1111-111111111111';
const SCHOOL_B = '22222222-2222-2222-2222-222222222222';
const SCHOOL_C = '33333333-3333-3333-3333-333333333333';
const ROUTE = '/api/school-admin/overview';

function authedOk(userId = 'auth-user-1') {
  mockAuthorize.mockResolvedValue({
    authorized: true,
    userId,
    studentId: null,
    roles: ['school_admin'],
    permissions: [COMMAND_CENTER_PERMISSION],
  });
}

function authedDenied(status = 403) {
  mockAuthorize.mockResolvedValue({
    authorized: false,
    userId: null,
    studentId: null,
    roles: [],
    permissions: [],
    errorResponse: new Response(
      JSON.stringify({ error: 'Permission denied', code: 'PERMISSION_DENIED' }),
      { status, headers: { 'Content-Type': 'application/json' } },
    ),
  });
}

function makeRequest(query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/school-admin/overview${query}`, {
    method: 'GET',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  membershipHolder.data = [];
  membershipHolder.error = null;
});

// ─────────────────────────────────────────────────────────────────────────────
describe('resolveCommandCenterContext — P9 gate passthrough', () => {
  it('returns the authorizeRequest 403 UNCHANGED when the gate denies', async () => {
    authedDenied(403);
    const result = await resolveCommandCenterContext(makeRequest(), ROUTE);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.response.status).toBe(403);
    // The membership lookup must never run when the gate denies.
    expect(membershipHolder.data).toEqual([]);
  });

  it('returns the authorizeRequest 401 UNCHANGED when unauthenticated', async () => {
    authedDenied(401);
    const result = await resolveCommandCenterContext(makeRequest(), ROUTE);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.response.status).toBe(401);
  });

  it('gates on the institution.view_analytics permission (P9)', async () => {
    authedOk();
    membershipHolder.data = [{ school_id: SCHOOL_A }];
    await resolveCommandCenterContext(makeRequest(), ROUTE);
    expect(mockAuthorize).toHaveBeenCalledWith(expect.anything(), 'institution.view_analytics');
  });
});

describe('resolveCommandCenterContext — membership resolution', () => {
  it('403 when the caller has NO active school_admin membership', async () => {
    authedOk();
    membershipHolder.data = [];
    const result = await resolveCommandCenterContext(makeRequest(), ROUTE);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.response.status).toBe(403);
  });

  it('resolves the single school without any ?school_id param', async () => {
    authedOk('admin-A');
    membershipHolder.data = [{ school_id: SCHOOL_A }];
    const result = await resolveCommandCenterContext(makeRequest(), ROUTE);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.ctx.schoolId).toBe(SCHOOL_A);
    expect(result.ctx.userId).toBe('admin-A');
    expect(result.ctx.supabase).toBeDefined();
  });

  it('400 with { school_ids } when multi-school and no ?school_id given', async () => {
    authedOk();
    membershipHolder.data = [{ school_id: SCHOOL_A }, { school_id: SCHOOL_B }];
    const result = await resolveCommandCenterContext(makeRequest(), ROUTE);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.response.status).toBe(400);
    const body = await result.response.json();
    expect(body.success).toBe(false);
    expect(body.school_ids).toEqual([SCHOOL_A, SCHOOL_B]);
  });

  it('403 when ?school_id is NOT one of the caller active memberships (cross-school)', async () => {
    authedOk();
    membershipHolder.data = [{ school_id: SCHOOL_A }, { school_id: SCHOOL_B }];
    const result = await resolveCommandCenterContext(
      makeRequest(`?school_id=${SCHOOL_C}`),
      ROUTE,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.response.status).toBe(403);
  });

  it('resolves the requested school when ?school_id matches a membership', async () => {
    authedOk();
    membershipHolder.data = [{ school_id: SCHOOL_A }, { school_id: SCHOOL_B }];
    const result = await resolveCommandCenterContext(
      makeRequest(`?school_id=${SCHOOL_B}`),
      ROUTE,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.ctx.schoolId).toBe(SCHOOL_B);
  });

  it('de-duplicates repeated membership rows for the same school', async () => {
    authedOk();
    membershipHolder.data = [{ school_id: SCHOOL_A }, { school_id: SCHOOL_A }];
    // Two rows for the SAME school must count as one ⇒ single-school resolve,
    // NOT a multi-school 400.
    const result = await resolveCommandCenterContext(makeRequest(), ROUTE);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.ctx.schoolId).toBe(SCHOOL_A);
  });

  it('500 (no SQL leak) when the membership lookup errors', async () => {
    authedOk();
    membershipHolder.error = { message: 'relation "school_admins" violated policy xyz' };
    const result = await resolveCommandCenterContext(makeRequest(), ROUTE);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.response.status).toBe(500);
    const body = await result.response.json();
    expect(body.success).toBe(false);
    // The raw SQL / policy text must never reach the client (P13).
    expect(JSON.stringify(body)).not.toContain('policy xyz');
    expect(JSON.stringify(body)).not.toContain('school_admins');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('parsePagination — limit/offset clamp', () => {
  const parse = (query: string) =>
    parsePagination(makeRequest(query), DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT);

  it('defaults to limit=20, offset=0 when params are absent', () => {
    expect(parse('')).toEqual({ limit: 20, offset: 0 });
  });

  it('honors a valid in-range ?limit', () => {
    expect(parse('?limit=37').limit).toBe(37);
  });

  it('clamps ?limit above MAX to 100', () => {
    expect(parse('?limit=500').limit).toBe(MAX_PAGE_LIMIT);
    expect(parse('?limit=99999').limit).toBe(100);
  });

  it('clamps ?limit=0 up to 1 (min floor)', () => {
    expect(parse('?limit=0').limit).toBe(1);
  });

  it('clamps a negative ?limit up to 1', () => {
    expect(parse('?limit=-5').limit).toBe(1);
  });

  it('falls back to the default for a non-numeric ?limit', () => {
    expect(parse('?limit=abc').limit).toBe(DEFAULT_PAGE_LIMIT);
  });

  it('clamps a negative ?offset to 0', () => {
    expect(parse('?offset=-10').offset).toBe(0);
  });

  it('falls back to offset=0 for a non-numeric ?offset', () => {
    expect(parse('?offset=xyz').offset).toBe(0);
  });

  it('honors a valid ?offset', () => {
    expect(parse('?offset=40').offset).toBe(40);
  });
});

describe('rpcErrorResponse — Postgres error → HTTP', () => {
  it('maps Postgres 42501 (scope-guard) to HTTP 403', () => {
    const res = rpcErrorResponse({ code: '42501', message: 'not authorized for school' }, ROUTE);
    expect(res.status).toBe(403);
  });

  it('maps any other RPC error to HTTP 500 without leaking the SQL message', async () => {
    const res = rpcErrorResponse(
      { code: '23505', message: 'duplicate key value violates unique constraint "x"' },
      ROUTE,
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('unique constraint');
    expect(JSON.stringify(body)).not.toContain('23505');
  });

  it('maps a null error to HTTP 500 (defensive)', () => {
    const res = rpcErrorResponse(null, ROUTE);
    expect(res.status).toBe(500);
  });
});

describe('Command Center constants', () => {
  it('uses the existing institution.view_analytics permission (no new permission)', () => {
    expect(COMMAND_CENTER_PERMISSION).toBe('institution.view_analytics');
  });

  it('sets the platform authed-read cache header', () => {
    expect(COMMAND_CENTER_CACHE_CONTROL).toBe('private, max-age=30, stale-while-revalidate=60');
  });
});
