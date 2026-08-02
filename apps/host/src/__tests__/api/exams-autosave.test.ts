/**
 * /api/exams/papers/[id]/autosave — POST route tests (screen 11 "Mock exam",
 * `ff_exam_v2`).
 *
 * Pins:
 *   - auth gate (401/403), paper-id + body validation (400s)
 *   - cbse_board flow (attempt_id present): scoped UPDATE of
 *     `mock_test_attempts.client_metadata` ONLY (student_id + exam_paper_id +
 *     status='in_progress'); never touches score_percent/raw_score/
 *     xp_earned/status; never calls any RPC (in particular, never
 *     `submit_mock_test_attempt`).
 *   - static-paper flow (no attempt_id): well-formed no-op, `persisted: false`
 *   - a row belonging to a different student, or already submitted, is a
 *     silent no-op (`persisted: false`), not an error
 *   - method guard (GET/PUT/DELETE/PATCH → 405)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── RBAC mock ────────────────────────────────────────────────────────────
const _authorizeImpl = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
}));

function setAuthorized(opts?: { studentId?: string | null }) {
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId: 'auth-user-1',
    studentId: opts?.studentId === undefined ? 'student-uuid-1' : opts.studentId,
    roles: ['student'],
    permissions: ['exam.view'],
  });
}

function setUnauthorized() {
  _authorizeImpl.mockResolvedValue({
    authorized: false,
    userId: null,
    studentId: null,
    roles: [],
    permissions: [],
    errorResponse: new Response(
      JSON.stringify({ success: false, error: 'AUTH_REQUIRED' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    ),
  });
}

// ── Logger mock ──────────────────────────────────────────────────────────
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Supabase admin mock — update-chain only, no RPC support at all ──────
interface UpdateCall {
  table: string;
  values: Record<string, unknown>;
  filters: Array<{ col: string; val: unknown }>;
}

const updateCalls: UpdateCall[] = [];
let matchingRowIds: string[] = []; // rows the mocked filter chain "finds"
const rpcSpy = vi.fn();

function buildUpdateChain(table: string, values: Record<string, unknown>) {
  const filters: Array<{ col: string; val: unknown }> = [];
  const chain = {
    eq(col: string, val: unknown) {
      filters.push({ col, val });
      return chain;
    },
    select() {
      updateCalls.push({ table, values, filters });
      return Promise.resolve({
        data: matchingRowIds.map((id) => ({ id })),
        error: null,
      });
    },
  };
  return chain;
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      update: (values: Record<string, unknown>) => buildUpdateChain(table, values),
    }),
    rpc: (...args: unknown[]) => rpcSpy(...args),
  },
}));

// ── Fixtures ──────────────────────────────────────────────────────────────

const PAPER_ID = '11111111-1111-4111-a111-111111111111';
const ATTEMPT_ID = '22222222-2222-4222-a222-222222222222';
const Q1_ID = '33333333-3333-4333-a333-333333333333';

function makeReq(id: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/exams/papers/${id}/autosave`, {
    method: 'POST',
    headers: { Authorization: 'Bearer fake.jwt', 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

const makeCtx = (id: string) => ({ params: Promise.resolve({ id }) });

const defaultBody = () => ({
  attempt_id: ATTEMPT_ID,
  responses: [{ question_id: Q1_ID, response_index: 1, marked_for_review: false }],
  cursor: 0,
  remaining_seconds: 3550,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let autosavePOST: any;

beforeEach(async () => {
  vi.clearAllMocks();
  updateCalls.length = 0;
  matchingRowIds = [ATTEMPT_ID];
  setAuthorized();
  const mod = await import('@/app/api/exams/papers/[id]/autosave/route');
  autosavePOST = mod.POST;
});

describe('POST /api/exams/papers/[id]/autosave', () => {
  it('401 when unauthenticated', async () => {
    setUnauthorized();
    const res = await autosavePOST(makeReq(PAPER_ID, defaultBody()), makeCtx(PAPER_ID));
    expect(res.status).toBe(401);
  });

  it('400 on an invalid paper id', async () => {
    const res = await autosavePOST(makeReq('not-a-uuid', defaultBody()), makeCtx('not-a-uuid'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_paper_id');
  });

  it('403 when the caller has no linked student profile', async () => {
    setAuthorized({ studentId: null });
    const res = await autosavePOST(makeReq(PAPER_ID, defaultBody()), makeCtx(PAPER_ID));
    expect(res.status).toBe(403);
  });

  it('400 on malformed JSON', async () => {
    const req = new Request(`http://localhost/api/exams/papers/${PAPER_ID}/autosave`, {
      method: 'POST',
      headers: { Authorization: 'Bearer fake.jwt', 'Content-Type': 'application/json' },
      body: '{not json',
    });
    const res = await autosavePOST(req, makeCtx(PAPER_ID));
    expect(res.status).toBe(400);
  });

  it('400 when a response_index is out of the 0..3 range', async () => {
    const body = { ...defaultBody(), responses: [{ question_id: Q1_ID, response_index: 9 }] };
    const res = await autosavePOST(makeReq(PAPER_ID, body), makeCtx(PAPER_ID));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_responses');
  });

  it('400 when cursor is negative', async () => {
    const body = { ...defaultBody(), cursor: -1 };
    const res = await autosavePOST(makeReq(PAPER_ID, body), makeCtx(PAPER_ID));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_cursor');
  });

  it('cbse_board flow: UPDATEs only client_metadata, scoped to student_id + exam_paper_id + status=in_progress — never touches score/xp/status columns, never calls any RPC', async () => {
    const res = await autosavePOST(makeReq(PAPER_ID, defaultBody()), makeCtx(PAPER_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, persisted: true });

    expect(updateCalls).toHaveLength(1);
    const call = updateCalls[0];
    expect(call.table).toBe('mock_test_attempts');
    // Only client_metadata is ever written.
    expect(Object.keys(call.values)).toEqual(['client_metadata']);
    expect(call.values).not.toHaveProperty('score_percent');
    expect(call.values).not.toHaveProperty('raw_score');
    expect(call.values).not.toHaveProperty('xp_earned');
    expect(call.values).not.toHaveProperty('status');
    // Scoped to this exact row/owner/paper/state.
    expect(call.filters).toEqual(
      expect.arrayContaining([
        { col: 'id', val: ATTEMPT_ID },
        { col: 'student_id', val: 'student-uuid-1' },
        { col: 'exam_paper_id', val: PAPER_ID },
        { col: 'status', val: 'in_progress' },
      ]),
    );
    // Never touches the submission RPC.
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('static-paper flow (no attempt_id): well-formed no-op, persisted:false, no DB write attempted', async () => {
    const { attempt_id: _drop, ...body } = defaultBody();
    const res = await autosavePOST(makeReq(PAPER_ID, body), makeCtx(PAPER_ID));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, persisted: false });
    expect(updateCalls).toHaveLength(0);
  });

  it('a row that does not match (already submitted / wrong owner) is a silent no-op, not an error', async () => {
    matchingRowIds = []; // UPDATE matches zero rows
    const res = await autosavePOST(makeReq(PAPER_ID, defaultBody()), makeCtx(PAPER_ID));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, persisted: false });
  });

  it('accepts and logs an optional Idempotency-Key header without requiring one', async () => {
    const res = await autosavePOST(
      makeReq(PAPER_ID, defaultBody(), { 'Idempotency-Key': 'replay-key-1' }),
      makeCtx(PAPER_ID),
    );
    expect(res.status).toBe(200);
  });

  it('405s non-POST verbs', async () => {
    const mod = await import('@/app/api/exams/papers/[id]/autosave/route');
    for (const verb of ['GET', 'PUT', 'DELETE', 'PATCH'] as const) {
      const res = await mod[verb](makeReq(PAPER_ID, defaultBody()));
      expect(res.status).toBe(405);
    }
  });
});
