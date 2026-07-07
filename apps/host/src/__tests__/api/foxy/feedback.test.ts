import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * POST /api/foxy/feedback — B'-5 Phase 1.
 *
 * Covers: 401, 400 (invalid body / messageId / isUp / reason type),
 * 404 (RPC returned empty), 200 happy path with reason, 200 happy path
 * without reason, 500 RPC error.
 */

const _authorizeImpl = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
}));

function setAuthorized() {
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId: '22222222-2222-2222-2222-222222222222',
    studentId: '11111111-1111-1111-1111-111111111111',
    roles: ['student'],
    permissions: ['progress.view_own'],
  });
}

function setUnauthorized() {
  _authorizeImpl.mockResolvedValue({
    authorized: false,
    errorResponse: new Response(
      JSON.stringify({ success: false, error: 'AUTH_REQUIRED' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    ),
  });
}

vi.mock('@alfanumrik/lib/sanitize', () => ({
  isValidUUID: (s: unknown) =>
    typeof s === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

let _rpcResult: { data: unknown; error: unknown } = {
  data: [{ id: 'feedback-uuid-1', coach_mode_used: 'socratic' }],
  error: null,
};
let _lastRpcArgs: unknown = null;

function setRpcResult(r: { data: unknown; error: unknown }) {
  _rpcResult = r;
}

// B'-5 Phase 2 hardening: route does an explicit ownership check before
// calling the RPC. Mock returns the message row for `.from('foxy_chat_messages')
// .select(...).eq('id', X).maybeSingle()`. Tests can override with
// `setMessageRow(...)` to drive ownership-rejection branches.
const STUDENT_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_STUDENT_ID = '99999999-9999-9999-9999-999999999999';
let _messageRow: { data: unknown; error: unknown } = {
  data: { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', student_id: STUDENT_ID, role: 'assistant' },
  error: null,
};
function setMessageRow(r: { data: unknown; error: unknown }) {
  _messageRow = r;
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    rpc: vi.fn((name: string, args: unknown) => {
      _lastRpcArgs = { name, args };
      return Promise.resolve(_rpcResult);
    }),
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() => Promise.resolve(_messageRow)),
        })),
      })),
    })),
  },
}));

const VALID_MESSAGE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/foxy/feedback', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let POST: any;

beforeEach(async () => {
  vi.clearAllMocks();
  _lastRpcArgs = null;
  _rpcResult = {
    data: [{ id: 'feedback-uuid-1', coach_mode_used: 'socratic' }],
    error: null,
  };
  // Default: message exists, owned by the authorized student, role=assistant.
  // Ownership-rejection tests override with setMessageRow(...).
  _messageRow = {
    data: { id: VALID_MESSAGE_ID, student_id: STUDENT_ID, role: 'assistant' },
    error: null,
  };
  const mod = await import('@/app/api/foxy/feedback/route');
  POST = mod.POST;
});

describe('POST /api/foxy/feedback', () => {
  it('returns 401 when unauthorized', async () => {
    setUnauthorized();
    const res = await POST(makeReq({ messageId: VALID_MESSAGE_ID, isUp: true }));
    expect(res.status).toBe(401);
  });

  it('returns 400 for non-object body', async () => {
    setAuthorized();
    const req = new Request('http://localhost/api/foxy/feedback', {
      method: 'POST',
      body: 'not-json',
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing messageId', async () => {
    setAuthorized();
    const res = await POST(makeReq({ isUp: true }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/messageId/);
  });

  it('returns 400 for non-uuid messageId', async () => {
    setAuthorized();
    const res = await POST(makeReq({ messageId: 'not-a-uuid', isUp: true }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-boolean isUp', async () => {
    setAuthorized();
    const res = await POST(makeReq({ messageId: VALID_MESSAGE_ID, isUp: 'yes' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/isUp/);
  });

  it('returns 400 for non-string reason', async () => {
    setAuthorized();
    const res = await POST(makeReq({ messageId: VALID_MESSAGE_ID, isUp: false, reason: 42 }));
    expect(res.status).toBe(400);
  });

  it('happy path: records feedback with reason; trims whitespace; passes args to RPC', async () => {
    setAuthorized();
    const res = await POST(
      makeReq({ messageId: VALID_MESSAGE_ID, isUp: false, reason: '  too verbose  ' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.feedbackId).toBe('feedback-uuid-1');
    expect(body.data.coachModeUsed).toBe('socratic');

    // RPC received the trimmed reason + correct messageId + isUp
    const call = _lastRpcArgs as { name: string; args: { p_message_id: string; p_is_up: boolean; p_reason: string | null } };
    expect(call.name).toBe('record_message_feedback');
    expect(call.args.p_message_id).toBe(VALID_MESSAGE_ID);
    expect(call.args.p_is_up).toBe(false);
    expect(call.args.p_reason).toBe('too verbose');
  });

  it('happy path: empty/whitespace-only reason becomes null in RPC args', async () => {
    setAuthorized();
    await POST(makeReq({ messageId: VALID_MESSAGE_ID, isUp: true, reason: '   ' }));
    const call = _lastRpcArgs as { args: { p_reason: string | null } };
    expect(call.args.p_reason).toBeNull();
  });

  it('happy path: missing reason becomes null in RPC args', async () => {
    setAuthorized();
    await POST(makeReq({ messageId: VALID_MESSAGE_ID, isUp: true }));
    const call = _lastRpcArgs as { args: { p_reason: string | null } };
    expect(call.args.p_reason).toBeNull();
  });

  it('happy path: long reason is capped at 500 chars', async () => {
    setAuthorized();
    const longReason = 'x'.repeat(800);
    await POST(makeReq({ messageId: VALID_MESSAGE_ID, isUp: false, reason: longReason }));
    const call = _lastRpcArgs as { args: { p_reason: string | null } };
    expect(call.args.p_reason!.length).toBe(500);
  });

  it('returns 404 when RPC returns empty (message not found / not eligible / auth.uid mismatch)', async () => {
    setAuthorized();
    setRpcResult({ data: [], error: null });
    const res = await POST(makeReq({ messageId: VALID_MESSAGE_ID, isUp: true }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns 500 when RPC errors', async () => {
    setAuthorized();
    setRpcResult({ data: null, error: { message: 'simulated DB error' } });
    const res = await POST(makeReq({ messageId: VALID_MESSAGE_ID, isUp: true }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('RPC_ERROR');
  });

  // ── B'-5 Phase 2 hardening: route-side ownership check (P5/P13) ──────
  it('returns 404 when the message does not exist (no row)', async () => {
    setAuthorized();
    setMessageRow({ data: null, error: null });
    const res = await POST(makeReq({ messageId: VALID_MESSAGE_ID, isUp: true }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('NOT_FOUND');
    // Critical: RPC was NEVER called because the route rejected first.
    expect(_lastRpcArgs).toBeNull();
  });

  it('returns 404 when the message belongs to a different student (cross-tenant guard)', async () => {
    setAuthorized();
    setMessageRow({
      data: { id: VALID_MESSAGE_ID, student_id: OTHER_STUDENT_ID, role: 'assistant' },
      error: null,
    });
    const res = await POST(makeReq({ messageId: VALID_MESSAGE_ID, isUp: true }));
    expect(res.status).toBe(404);
    const body = await res.json();
    // Same NOT_FOUND code as "missing" — endpoint must not leak which case.
    expect(body.code).toBe('NOT_FOUND');
    expect(_lastRpcArgs).toBeNull();
  });

  it('returns 404 when the message is a user role (only assistant turns are feedback-eligible)', async () => {
    setAuthorized();
    setMessageRow({
      data: { id: VALID_MESSAGE_ID, student_id: STUDENT_ID, role: 'user' },
      error: null,
    });
    const res = await POST(makeReq({ messageId: VALID_MESSAGE_ID, isUp: true }));
    expect(res.status).toBe(404);
    expect(_lastRpcArgs).toBeNull();
  });

  it('returns 500 when the ownership lookup itself errors (DB outage)', async () => {
    setAuthorized();
    setMessageRow({ data: null, error: { message: 'simulated lookup failure' } });
    const res = await POST(makeReq({ messageId: VALID_MESSAGE_ID, isUp: true }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('RPC_ERROR');
    expect(_lastRpcArgs).toBeNull();
  });
});
