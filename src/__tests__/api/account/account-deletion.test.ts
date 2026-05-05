/**
 * Tests for the DPDP Section 17 right-to-erasure endpoint at
 * /api/v1/account/delete (Wave 2 D7 follow-up #1).
 *
 * Coverage:
 *   POST   — 401 unauth, 400 missing/invalid body, 400 wrong confirmEmail,
 *            201 happy path (created), 200 idempotent replay (already_requested),
 *            503 if subscription cancel inside the RPC fails, 404 if no profile.
 *   DELETE — 200 happy path during cooling-off, 410 already purged,
 *            410 already cancelled, 410 cooling-off ended, 404 no request.
 *   GET    — 200 returns log entry, 404 if no deletion record.
 *
 * The route uses authorizeRequest + supabaseAdmin RPC + supabaseAdmin.from
 * + supabaseAdmin.auth.admin.getUserById. All four are mocked deterministically.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Constants ─────────────────────────────────────────────────────────────────
const AUTH_USER_ID = '11111111-1111-4111-8111-111111111111';
const STUDENT_ID = '22222222-2222-4222-8222-222222222222';
const DELETION_ID = '33333333-3333-4333-8333-333333333333';
const CALLER_EMAIL = 'student@example.com';
const COOLING_OFF_ENDS_AT = '2026-06-04T12:00:00.000Z';

// ── RBAC mock ─────────────────────────────────────────────────────────────────
let _authImpl: () => Promise<unknown> = async () => ({
  authorized: true,
  userId: AUTH_USER_ID,
  studentId: null,
  roles: ['student'],
  permissions: ['account.delete'],
});
vi.mock('@/lib/rbac', () => ({
  authorizeRequest: () => _authImpl(),
}));

function setAuthorized(userId = AUTH_USER_ID) {
  _authImpl = async () => ({
    authorized: true,
    userId,
    studentId: null,
    roles: ['student'],
    permissions: ['account.delete'],
  });
}
function setUnauthorized() {
  _authImpl = async () => ({
    authorized: false,
    userId: null,
    studentId: null,
    roles: [],
    permissions: [],
    errorResponse: new Response(
      JSON.stringify({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    ),
    reason: 'No valid auth',
  });
}

// ── Logger mock ───────────────────────────────────────────────────────────────
const loggerInfo = vi.fn();
const loggerWarn = vi.fn();
const loggerError = vi.fn();
vi.mock('@/lib/logger', () => ({
  logger: { info: loggerInfo, warn: loggerWarn, error: loggerError, debug: vi.fn() },
}));

// ── supabaseAdmin mock ────────────────────────────────────────────────────────
//
// The route uses these supabaseAdmin shapes:
//   - .from('students'|'teachers'|'guardians').select('id').eq('auth_user_id',…).maybeSingle()
//   - .from('account_deletion_log').select(…).eq(…).eq(…).order(…).limit(1).maybeSingle()
//   - .auth.admin.getUserById(authUserId)
//   - .rpc('request_account_deletion', {...})
//   - .rpc('cancel_account_deletion', {...})
//
// We expose per-table .maybeSingle handlers + RPC handlers + auth.email handler.

interface TableState {
  students_lookup: { data: { id: string } | null; error: null };
  teachers_lookup: { data: { id: string } | null; error: null };
  guardians_lookup: { data: { id: string } | null; error: null };
  log_lookup: { data: Record<string, unknown> | null; error: { message: string } | null };
}

const _state: TableState = {
  students_lookup: { data: { id: STUDENT_ID }, error: null },
  teachers_lookup: { data: null, error: null },
  guardians_lookup: { data: null, error: null },
  log_lookup: { data: null, error: null },
};

let _emailLookup: { data: { user: { email: string } | null } | null; error: { message: string } | null } = {
  data: { user: { email: CALLER_EMAIL } },
  error: null,
};

let _requestRpc: { data: unknown; error: { message: string } | null } = {
  data: [
    {
      deletion_id: DELETION_ID,
      cooling_off_ends_at: COOLING_OFF_ENDS_AT,
      outcome: 'created',
      subscription_outcome: 'cancel_scheduled',
    },
  ],
  error: null,
};

let _cancelRpc: { data: unknown; error: { message: string } | null } = {
  data: [{ cancelled: true, reason: 'cancelled' }],
  error: null,
};

const rpcSpy = vi.fn();

function makeAdminMock() {
  function fromMock(table: string) {
    const chain: Record<string, (...args: unknown[]) => unknown> = {};
    for (const m of ['select', 'eq', 'in', 'lte', 'order', 'limit']) {
      chain[m] = () => chain;
    }
    chain.maybeSingle = async () => {
      if (table === 'students') return _state.students_lookup;
      if (table === 'teachers') return _state.teachers_lookup;
      if (table === 'guardians') return _state.guardians_lookup;
      if (table === 'account_deletion_log') return _state.log_lookup;
      return { data: null, error: null };
    };
    return chain;
  }

  return {
    from: (t: string) => fromMock(t),
    auth: {
      admin: {
        getUserById: async (_id: string) => _emailLookup,
      },
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcSpy(name, args);
      if (name === 'request_account_deletion') return Promise.resolve(_requestRpc);
      if (name === 'cancel_account_deletion') return Promise.resolve(_cancelRpc);
      return Promise.resolve({ data: null, error: { message: `unknown rpc ${name}` } });
    },
  };
}

vi.mock('@/lib/supabase-admin', () => {
  const adminMock = makeAdminMock();
  return {
    supabaseAdmin: adminMock,
    getSupabaseAdmin: () => adminMock,
  };
});

// ── Test helpers ──────────────────────────────────────────────────────────────

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/account/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
function deleteRequest(): Request {
  return new Request('http://localhost/api/v1/account/delete', { method: 'DELETE' });
}
function getRequest(): Request {
  return new Request('http://localhost/api/v1/account/delete', { method: 'GET' });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let POST: any, DELETE: any, GET: any;

beforeEach(async () => {
  vi.clearAllMocks();
  setAuthorized();
  _state.students_lookup = { data: { id: STUDENT_ID }, error: null };
  _state.teachers_lookup = { data: null, error: null };
  _state.guardians_lookup = { data: null, error: null };
  _state.log_lookup = { data: null, error: null };
  _emailLookup = { data: { user: { email: CALLER_EMAIL } }, error: null };
  _requestRpc = {
    data: [
      {
        deletion_id: DELETION_ID,
        cooling_off_ends_at: COOLING_OFF_ENDS_AT,
        outcome: 'created',
        subscription_outcome: 'cancel_scheduled',
      },
    ],
    error: null,
  };
  _cancelRpc = { data: [{ cancelled: true, reason: 'cancelled' }], error: null };

  const mod = await import('@/app/api/v1/account/delete/route');
  POST = mod.POST;
  DELETE = mod.DELETE;
  GET = mod.GET;
});

// ── POST tests ────────────────────────────────────────────────────────────────

describe('POST /api/v1/account/delete', () => {
  it('returns 401 when caller is not authenticated', async () => {
    setUnauthorized();
    const res = await POST(postRequest({ reason: 'wanted to', confirmEmail: CALLER_EMAIL }));
    expect(res.status).toBe(401);
  });

  it('returns 400 when body is invalid JSON', async () => {
    const res = await POST(postRequest('{not-json'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('BAD_REQUEST');
  });

  it('returns 400 when reason is missing or too short', async () => {
    const res = await POST(postRequest({ reason: 'a', confirmEmail: CALLER_EMAIL }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('REASON_REQUIRED');
  });

  it('returns 400 when reason exceeds 1000 chars', async () => {
    const res = await POST(
      postRequest({ reason: 'x'.repeat(1001), confirmEmail: CALLER_EMAIL }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('REASON_TOO_LONG');
  });

  it('returns 400 when confirmEmail is missing', async () => {
    const res = await POST(postRequest({ reason: 'switching schools' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('CONFIRM_EMAIL_REQUIRED');
  });

  it('returns 400 when confirmEmail does not match the caller email', async () => {
    const res = await POST(
      postRequest({ reason: 'switching schools', confirmEmail: 'someone-else@example.com' }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('CONFIRM_EMAIL_MISMATCH');
    expect(loggerWarn).toHaveBeenCalled();
  });

  it('returns 503 when the email lookup fails', async () => {
    _emailLookup = { data: null, error: { message: 'auth admin down' } };
    const res = await POST(postRequest({ reason: 'switching schools', confirmEmail: CALLER_EMAIL }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('EMAIL_LOOKUP_FAILED');
  });

  it('returns 404 when caller has no profile in any role table', async () => {
    _state.students_lookup = { data: null, error: null };
    _state.teachers_lookup = { data: null, error: null };
    _state.guardians_lookup = { data: null, error: null };
    const res = await POST(postRequest({ reason: 'switching schools', confirmEmail: CALLER_EMAIL }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('NO_ACCOUNT');
  });

  it('returns 201 on the happy path and forwards the deletion_id + cooling_off_ends_at', async () => {
    const res = await POST(postRequest({ reason: 'switching schools', confirmEmail: CALLER_EMAIL }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.deletion_id).toBe(DELETION_ID);
    expect(body.data.cooling_off_ends_at).toBe(COOLING_OFF_ENDS_AT);
    expect(body.data.can_cancel).toBe(true);
    expect(body.data.idempotent_replay).toBe(false);
    expect(body.data.subscription_outcome).toBe('cancel_scheduled');
    expect(rpcSpy).toHaveBeenCalledWith(
      'request_account_deletion',
      expect.objectContaining({
        p_account_id: STUDENT_ID,
        p_role: 'student',
        p_reason: 'switching schools',
        p_auth_user_id: AUTH_USER_ID,
      }),
    );
  });

  it('returns 200 with idempotent_replay=true when the RPC reports already_requested', async () => {
    _requestRpc = {
      data: [
        {
          deletion_id: DELETION_ID,
          cooling_off_ends_at: COOLING_OFF_ENDS_AT,
          outcome: 'already_requested',
          subscription_outcome: 'n/a',
        },
      ],
      error: null,
    };
    const res = await POST(postRequest({ reason: 'switching schools', confirmEmail: CALLER_EMAIL }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.idempotent_replay).toBe(true);
  });

  it('returns 503 when the RPC errors (subscription cancel rolled back the txn)', async () => {
    _requestRpc = {
      data: null,
      error: { message: 'subscription cancel failed (deadlock)' },
    };
    const res = await POST(postRequest({ reason: 'switching schools', confirmEmail: CALLER_EMAIL }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('RPC_FAILED');
    expect(loggerError).toHaveBeenCalled();
  });

  it('uppercases / mixed-case confirmEmail still matches (case-insensitive comparison)', async () => {
    const res = await POST(
      postRequest({ reason: 'switching schools', confirmEmail: CALLER_EMAIL.toUpperCase() }),
    );
    expect(res.status).toBe(201);
  });
});

// ── DELETE tests ──────────────────────────────────────────────────────────────

describe('DELETE /api/v1/account/delete', () => {
  it('returns 401 when caller is not authenticated', async () => {
    setUnauthorized();
    const res = await DELETE(deleteRequest());
    expect(res.status).toBe(401);
  });

  it('returns 200 on happy-path cancel during cooling-off', async () => {
    _state.log_lookup = {
      data: { id: DELETION_ID, status: 'requested' },
      error: null,
    };
    const res = await DELETE(deleteRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.cancelled).toBe(true);
  });

  it('returns 410 when the account has already been purged', async () => {
    _state.log_lookup = {
      data: { id: DELETION_ID, status: 'purged' },
      error: null,
    };
    const res = await DELETE(deleteRequest());
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.code).toBe('ALREADY_PURGED');
  });

  it('returns 410 when the deletion was already cancelled by the user', async () => {
    _state.log_lookup = {
      data: { id: DELETION_ID, status: 'cancelled_by_user' },
      error: null,
    };
    const res = await DELETE(deleteRequest());
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.code).toBe('ALREADY_CANCELLED');
  });

  it('returns 404 when there is no deletion request', async () => {
    _state.log_lookup = { data: null, error: null };
    const res = await DELETE(deleteRequest());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('NO_REQUEST');
  });

  it('returns 410 when the cooling-off window has ended (RPC reports cooling_off_ended)', async () => {
    _state.log_lookup = {
      data: { id: DELETION_ID, status: 'requested' },
      error: null,
    };
    _cancelRpc = { data: [{ cancelled: false, reason: 'cooling_off_ended' }], error: null };
    const res = await DELETE(deleteRequest());
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.code).toBe('COOLING_OFF_ENDED');
  });

  it('returns 503 when the cancel RPC errors', async () => {
    _state.log_lookup = {
      data: { id: DELETION_ID, status: 'requested' },
      error: null,
    };
    _cancelRpc = { data: null, error: { message: 'db down' } };
    const res = await DELETE(deleteRequest());
    expect(res.status).toBe(503);
  });
});

// ── GET tests ─────────────────────────────────────────────────────────────────

describe('GET /api/v1/account/delete', () => {
  it('returns 401 when caller is not authenticated', async () => {
    setUnauthorized();
    const res = await GET(getRequest());
    expect(res.status).toBe(401);
  });

  it('returns 200 with the log entry when one exists', async () => {
    _state.log_lookup = {
      data: {
        id: DELETION_ID,
        status: 'requested',
        requested_at: '2026-05-05T10:00:00.000Z',
        cooling_off_ends_at: COOLING_OFF_ENDS_AT,
        completed_at: null,
        purged_categories: {},
      },
      error: null,
    };
    const res = await GET(getRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.deletion_id).toBe(DELETION_ID);
    expect(body.data.status).toBe('requested');
    expect(body.data.can_cancel).toBe(true);
  });

  it('returns 404 when no deletion record exists', async () => {
    _state.log_lookup = { data: null, error: null };
    const res = await GET(getRequest());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('NO_REQUEST');
  });

  it('marks can_cancel=false for terminal statuses', async () => {
    _state.log_lookup = {
      data: {
        id: DELETION_ID,
        status: 'purged',
        requested_at: '2026-04-01T10:00:00.000Z',
        cooling_off_ends_at: '2026-05-01T10:00:00.000Z',
        completed_at: '2026-05-01T10:30:00.000Z',
        purged_categories: { profile: true, foxy_messages: 42 },
      },
      error: null,
    };
    const res = await GET(getRequest());
    const body = await res.json();
    expect(body.data.can_cancel).toBe(false);
    expect(body.data.purged_categories.foxy_messages).toBe(42);
  });
});
