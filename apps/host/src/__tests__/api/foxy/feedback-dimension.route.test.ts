import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * POST /api/foxy/feedback/dimension — REG-420 coverage-gap closure.
 *
 * Mirrors the mocking pattern used for the sibling route's test file
 * (`apps/host/src/__tests__/api/foxy/feedback.test.ts`) and the chainable
 * `@alfanumrik/lib/supabase-admin` mock convention from
 * `apps/host/src/__tests__/api/super-admin/ai-quality.route.test.ts`.
 *
 * Covers: 401/403 auth gate, 400 body validation (messageId/dimension/isUp),
 * the ownership trust-boundary (404 collapses "not found" and "wrong owner"
 * into the identical response — P13), role-eligibility (assistant-only),
 * happy path RPC args + response shape, reason truncation/null-coercion,
 * and the P13 logger spot-check (no `reason` text ever logged).
 */

const _authorizeImpl = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
}));

const STUDENT_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_STUDENT_ID = '99999999-9999-9999-9999-999999999999';
const VALID_MESSAGE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function setAuthorized() {
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId: '22222222-2222-2222-2222-222222222222',
    studentId: STUDENT_ID,
    roles: ['student'],
    permissions: ['progress.view_own'],
  });
}

function setUnauthorized(status = 401, code = 'AUTH_REQUIRED') {
  _authorizeImpl.mockResolvedValue({
    authorized: false,
    errorResponse: new Response(
      JSON.stringify({ success: false, error: code, code }),
      { status, headers: { 'Content-Type': 'application/json' } },
    ),
  });
}

vi.mock('@alfanumrik/lib/sanitize', () => ({
  isValidUUID: (s: unknown) =>
    typeof s === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
}));

const loggerErrorMock = vi.fn();
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: loggerErrorMock },
}));

let _rpcResult: { data: unknown; error: unknown } = {
  data: [{ id: 'feedback-uuid-1', coach_mode_used: 'socratic' }],
  error: null,
};
let _lastRpcArgs: { name: string; args: Record<string, unknown> } | null = null;

function setRpcResult(r: { data: unknown; error: unknown }) {
  _rpcResult = r;
}

// Ownership-check mock: `.from('foxy_chat_messages').select(...).eq('id', X).maybeSingle()`.
let _messageRow: { data: unknown; error: unknown } = {
  data: { id: VALID_MESSAGE_ID, student_id: STUDENT_ID, role: 'assistant' },
  error: null,
};
function setMessageRow(r: { data: unknown; error: unknown }) {
  _messageRow = r;
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    rpc: vi.fn((name: string, args: Record<string, unknown>) => {
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

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/foxy/feedback/dimension', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    messageId: VALID_MESSAGE_ID,
    dimension: 'accuracy',
    isUp: true,
    ...overrides,
  };
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
  _messageRow = {
    data: { id: VALID_MESSAGE_ID, student_id: STUDENT_ID, role: 'assistant' },
    error: null,
  };
  setAuthorized();
  const mod = await import('@/app/api/foxy/feedback/dimension/route');
  POST = mod.POST;
});

describe('POST /api/foxy/feedback/dimension', () => {
  // ── 1. Auth gate ─────────────────────────────────────────────────────
  it('returns the authorizer errorResponse verbatim when unauthorized (401)', async () => {
    setUnauthorized(401, 'AUTH_REQUIRED');
    const res = await POST(makeReq(validBody()));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('AUTH_REQUIRED');
    // Ownership lookup / RPC must never run when auth denies.
    expect(_lastRpcArgs).toBeNull();
  });

  it('returns the authorizer errorResponse verbatim when forbidden (403)', async () => {
    setUnauthorized(403, 'FORBIDDEN');
    const res = await POST(makeReq(validBody()));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('FORBIDDEN');
    expect(_lastRpcArgs).toBeNull();
  });

  it('calls authorizeRequest with progress.view_own and requireStudentId', async () => {
    await POST(makeReq(validBody()));
    expect(_authorizeImpl).toHaveBeenCalledWith(expect.anything(), 'progress.view_own', {
      requireStudentId: true,
    });
  });

  // ── 2. Body validation ───────────────────────────────────────────────
  it('returns 400 for missing messageId', async () => {
    const res = await POST(makeReq({ dimension: 'accuracy', isUp: true }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('BAD_REQUEST');
    expect(body.error).toMatch(/messageId/);
  });

  it('returns 400 for a malformed (non-uuid) messageId', async () => {
    const res = await POST(makeReq(validBody({ messageId: 'not-a-uuid' })));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/messageId/);
  });

  it('returns 400 for an invalid dimension value', async () => {
    const res = await POST(makeReq(validBody({ dimension: 'thoroughness' })));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('BAD_REQUEST');
    expect(body.error).toMatch(/dimension/);
  });

  it('returns 400 for a missing dimension value', async () => {
    const res = await POST(makeReq({ messageId: VALID_MESSAGE_ID, isUp: true }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/dimension/);
  });

  it('returns 400 for a non-boolean isUp', async () => {
    const res = await POST(makeReq(validBody({ isUp: 'yes' })));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/isUp/);
  });

  it('returns 400 for non-JSON body', async () => {
    const req = new Request('http://localhost/api/foxy/feedback/dimension', {
      method: 'POST',
      body: 'not-json',
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for a non-string reason', async () => {
    const res = await POST(makeReq(validBody({ reason: 42 })));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/reason/);
  });

  // ── 3/4/5. Ownership trust boundary ──────────────────────────────────
  it('returns 404 when the message does not exist', async () => {
    setMessageRow({ data: null, error: null });
    const res = await POST(makeReq(validBody()));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('NOT_FOUND');
    expect(_lastRpcArgs).toBeNull();
  });

  it('returns 404 with the IDENTICAL shape when the message belongs to a different student', async () => {
    setMessageRow({ data: null, error: null });
    const notFoundRes = await POST(makeReq(validBody()));
    const notFoundBody = await notFoundRes.json();

    setMessageRow({
      data: { id: VALID_MESSAGE_ID, student_id: OTHER_STUDENT_ID, role: 'assistant' },
      error: null,
    });
    const wrongOwnerRes = await POST(makeReq(validBody()));
    const wrongOwnerBody = await wrongOwnerRes.json();

    // The security property under test: "doesn't exist" and "wrong owner"
    // must be indistinguishable from the response alone.
    expect(wrongOwnerRes.status).toBe(notFoundRes.status);
    expect(wrongOwnerRes.status).toBe(404);
    expect(wrongOwnerBody).toEqual(notFoundBody);
    expect(_lastRpcArgs).toBeNull();
  });

  it('returns 404 when the message exists and is owned by the caller but is not an assistant turn', async () => {
    setMessageRow({
      data: { id: VALID_MESSAGE_ID, student_id: STUDENT_ID, role: 'user' },
      error: null,
    });
    const res = await POST(makeReq(validBody()));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('NOT_FOUND');
    expect(_lastRpcArgs).toBeNull();
  });

  // ── 6. Happy path ─────────────────────────────────────────────────────
  it('happy path: calls the RPC with the correct args and returns 200 with the mocked result', async () => {
    setRpcResult({ data: [{ id: 'feedback-uuid-42', coach_mode_used: 'direct' }], error: null });
    const res = await POST(
      makeReq(validBody({ dimension: 'clarity', isUp: false, reason: 'too long' })),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      data: { feedbackId: 'feedback-uuid-42', coachModeUsed: 'direct' },
    });

    expect(_lastRpcArgs).not.toBeNull();
    expect(_lastRpcArgs!.name).toBe('record_message_dimension_feedback');
    expect(_lastRpcArgs!.args).toEqual({
      p_message_id: VALID_MESSAGE_ID,
      p_dimension: 'clarity',
      p_is_up: false,
      p_reason: 'too long',
    });
  });

  it('accepts each of the 4 allowed dimension values', async () => {
    for (const dimension of ['accuracy', 'clarity', 'helpfulness', 'scope']) {
      vi.clearAllMocks();
      _lastRpcArgs = null;
      const res = await POST(makeReq(validBody({ dimension })));
      expect(res.status).toBe(200);
      expect(_lastRpcArgs!.args.p_dimension).toBe(dimension);
    }
  });

  it('returns 404 when the RPC itself returns an empty row set', async () => {
    setRpcResult({ data: [], error: null });
    const res = await POST(makeReq(validBody()));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('NOT_FOUND');
  });

  // ── 7. reason truncation / null coercion ─────────────────────────────
  it('truncates a reason longer than 500 chars to exactly 500 before passing to the RPC', async () => {
    const longReason = 'a'.repeat(800);
    await POST(makeReq(validBody({ reason: longReason })));
    expect(_lastRpcArgs!.args.p_reason).toHaveLength(500);
    expect(_lastRpcArgs!.args.p_reason).toBe('a'.repeat(500));
  });

  it('coerces an empty-string reason to null before passing to the RPC', async () => {
    await POST(makeReq(validBody({ reason: '' })));
    expect(_lastRpcArgs!.args.p_reason).toBeNull();
  });

  it('coerces a whitespace-only reason to null before passing to the RPC', async () => {
    await POST(makeReq(validBody({ reason: '   \t  ' })));
    expect(_lastRpcArgs!.args.p_reason).toBeNull();
  });

  it('coerces a missing reason to null before passing to the RPC', async () => {
    await POST(makeReq(validBody()));
    expect(_lastRpcArgs!.args.p_reason).toBeNull();
  });

  // ── 8. RPC failure -> 500 + P13 logger spot-check ────────────────────
  it('returns 500 when the RPC errors, and never logs the reason text (P13)', async () => {
    const secretReason = 'this-should-never-reach-the-logger-DO-NOT-LOG-ME';
    setRpcResult({ data: null, error: { message: 'simulated DB error' } });
    const res = await POST(makeReq(validBody({ reason: secretReason })));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('RPC_ERROR');

    expect(loggerErrorMock).toHaveBeenCalled();
    for (const call of loggerErrorMock.mock.calls) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain(secretReason);
    }
  });

  it('returns 500 when the ownership lookup itself errors, and never logs the reason text (P13)', async () => {
    const secretReason = 'another-secret-reason-DO-NOT-LOG-ME';
    setMessageRow({ data: null, error: { message: 'simulated lookup failure' } });
    const res = await POST(makeReq(validBody({ reason: secretReason })));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('RPC_ERROR');
    expect(_lastRpcArgs).toBeNull();

    expect(loggerErrorMock).toHaveBeenCalled();
    for (const call of loggerErrorMock.mock.calls) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain(secretReason);
    }
  });
});
