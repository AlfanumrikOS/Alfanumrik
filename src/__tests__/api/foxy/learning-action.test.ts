import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * POST /api/foxy/learning-action — BINDING guard suite (assessment-issued).
 *
 * The learning-action endpoint records a student's tap on a post-answer action
 * chip (Got it / Explain simpler / Show example / Quiz me / Save). It is
 * NON-EVIDENTIAL telemetry. These tests are the wall the assessment agent put
 * up: a self-report MUST NEVER move mastery or XP, feedback provenance must be
 * exact, and the continuity (expectation-lifecycle) rules must hold.
 *
 * Covers guard items #1, #2, #4, #5, and the quiz_me-TRIGGER half of #6.
 *
 * Mocking strategy (per testing-agent rule 2 — mock the Supabase clients, not
 * business logic):
 *   - `@/lib/supabase-admin` (supabaseAdmin): a recording proxy that captures
 *     every `.from(<table>)` call + the terminal op (insert/update/upsert/
 *     delete) and every `.rpc(name, args)`. The ownership lookup
 *     (`.from('foxy_chat_messages').select().eq().maybeSingle()`) and the
 *     continuity reads/writes against foxy_pending_expectations both flow
 *     through this client.
 *   - `@/lib/supabase-server` (createSupabaseServerClient): a separate
 *     recording proxy for the RLS-respecting `student_bookmarks` insert on the
 *     `save` path.
 *   - `@/lib/state/events/publish` (publishEvent): captured; asserted to be the
 *     ONLY bus write and to carry an IDs+enums-only payload.
 */

// ─── mastery surfaces that this route must NEVER write to (assessment list) ───
const FORBIDDEN_MASTERY_TABLES = [
  'concept_mastery',
  'cme_concept_state',
  'student_skill_state',
  'knowledge_gaps',
  'learner_mastery',
  'cme_error_log',
  'quiz_sessions',
  'student_learning_profiles',
  'bloom_progression',
] as const;

// ─── recorders shared across the admin/server proxies ────────────────────────
interface WriteRecord {
  client: 'admin' | 'server';
  table: string;
  op: 'insert' | 'update' | 'upsert' | 'delete';
}
let writes: WriteRecord[] = [];
let rpcCalls: Array<{ name: string; args: unknown }> = [];
let publishCalls: unknown[] = [];

// Drives the ownership lookup result + continuity reads.
const STUDENT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_STUDENT_ID = '99999999-9999-9999-9999-999999999999';
const VALID_MESSAGE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SESSION_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

let _messageRow: { data: unknown; error: unknown };
// record_message_feedback RPC result (one feedback row per message).
let _feedbackRpcResult: { data: unknown; error: unknown };
// loadOpenExpectation result — drives the continuity branch.
let _openExpectation: { data: unknown; error: unknown };
// student_bookmarks insert result (save path).
let _bookmarkInsert: { error: unknown };

function setMessageRow(r: { data: unknown; error: unknown }) {
  _messageRow = r;
}
function setOpenExpectation(r: { data: unknown; error: unknown }) {
  _openExpectation = r;
}

// ─── auth ────────────────────────────────────────────────────────────────────
const _authorizeImpl = vi.fn();
vi.mock('@/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
}));
function setAuthorized() {
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId: USER_ID,
    studentId: STUDENT_ID,
    roles: ['student'],
    permissions: ['progress.view_own'],
  });
}
function setUnauthorized() {
  _authorizeImpl.mockResolvedValue({
    authorized: false,
    errorResponse: new Response(JSON.stringify({ success: false, error: 'AUTH_REQUIRED' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }),
  });
}

vi.mock('@/lib/sanitize', () => ({
  isValidUUID: (s: unknown) =>
    typeof s === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    default: actual,
    randomUUID: () => 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  };
});

// publishEvent — capture, never write. Resolves like the real best-effort one.
vi.mock('@/lib/state/events/publish', () => ({
  publishEvent: vi.fn((_sb: unknown, event: unknown) => {
    publishCalls.push(event);
    return Promise.resolve({ published: true });
  }),
}));

// ─── supabaseAdmin recording proxy ─────────────────────────────────────────────
// Supports two shapes the route uses:
//   1. ownership lookup: .from('foxy_chat_messages').select(...).eq(...).maybeSingle()
//   2. continuity write: loadOpenExpectation / markExpectationAnswered run their
//      OWN supabase calls against .from('foxy_pending_expectations'); they are
//      imported into the route, so we mock the foxy-expectations module instead
//      (see below) — but ANY stray .from() on a mastery table here is recorded.
function makeAdminFromChain(table: string) {
  // Terminal recorders for mutating ops.
  const recordWrite = (op: WriteRecord['op']) => {
    writes.push({ client: 'admin', table, op });
    return Promise.resolve({ data: null, error: null });
  };
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve(table === 'foxy_chat_messages' ? _messageRow : { data: null, error: null })),
    single: vi.fn(() => Promise.resolve({ data: null, error: null })),
    insert: vi.fn(() => recordWrite('insert')),
    update: vi.fn(() => recordWrite('update')),
    upsert: vi.fn(() => recordWrite('upsert')),
    delete: vi.fn(() => recordWrite('delete')),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
  };
  return chain;
}

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => makeAdminFromChain(table)),
    rpc: vi.fn((name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      if (name === 'record_message_feedback') return Promise.resolve(_feedbackRpcResult);
      return Promise.resolve({ data: null, error: null });
    }),
  },
}));

// ─── supabase-server recording proxy (save path → student_bookmarks) ───────────
function makeServerFromChain(table: string) {
  return {
    insert: vi.fn(() => {
      writes.push({ client: 'server', table, op: 'insert' });
      return Promise.resolve({ error: _bookmarkInsert.error });
    }),
  };
}
vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: vi.fn(() =>
    Promise.resolve({ from: vi.fn((table: string) => makeServerFromChain(table)) }),
  ),
}));

// ─── foxy-expectations: spy on the continuity primitives the route imports ─────
// loadOpenExpectation reads the open expectation; markExpectationAnswered closes
// it. We assert WHICH one fires per action/kind (guard #5). The real module
// would write foxy_pending_expectations (not a mastery table), so spying keeps
// the continuity assertions crisp without re-implementing its SQL.
const _loadOpenExpectation = vi.fn((..._args: unknown[]): Promise<unknown> => Promise.resolve(null));
const _markExpectationAnswered = vi.fn((..._args: unknown[]): Promise<void> => Promise.resolve());
vi.mock('@/lib/learn/foxy-expectations', () => ({
  loadOpenExpectation: (...args: unknown[]) => _loadOpenExpectation(...args),
  markExpectationAnswered: (...args: unknown[]) => _markExpectationAnswered(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let POST: any;

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/foxy/learning-action', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  writes = [];
  rpcCalls = [];
  publishCalls = [];
  setAuthorized();
  _messageRow = {
    data: { id: VALID_MESSAGE_ID, student_id: STUDENT_ID, role: 'assistant', session_id: SESSION_ID, content: 'Photosynthesis converts light to chemical energy.' },
    error: null,
  };
  _feedbackRpcResult = { data: [{ id: 'feedback-uuid-1', coach_mode_used: null }], error: null };
  _openExpectation = { data: null, error: null };
  _bookmarkInsert = { error: null };
  // Default: no open expectation. Continuity tests override.
  _loadOpenExpectation.mockResolvedValue(null);
  _markExpectationAnswered.mockResolvedValue(undefined);
  const mod = await import('@/app/api/foxy/learning-action/route');
  POST = mod.POST;
});

// Helper: assert NO mastery-surface write happened on either client.
function expectNoMasteryWrites() {
  const masteryWrites = writes.filter((w) =>
    (FORBIDDEN_MASTERY_TABLES as readonly string[]).includes(w.table),
  );
  expect(masteryWrites, `unexpected mastery writes: ${JSON.stringify(masteryWrites)}`).toEqual([]);
}

describe('POST /api/foxy/learning-action — auth + validation', () => {
  it('returns 401 when unauthorized', async () => {
    setUnauthorized();
    const res = await POST(makeReq({ messageId: VALID_MESSAGE_ID, actionType: 'got_it' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 for an invalid actionType', async () => {
    const res = await POST(makeReq({ messageId: VALID_MESSAGE_ID, actionType: 'cheat' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/actionType/);
  });

  it('returns 400 for a non-uuid messageId', async () => {
    const res = await POST(makeReq({ messageId: 'nope', actionType: 'got_it' }));
    expect(res.status).toBe(400);
  });
});

// ─── GUARD #1 — NON-EVIDENTIAL MASTERY ISOLATION (core) ───────────────────────
describe('GUARD #1 — non-evidential mastery isolation (P2): ZERO writes to any mastery surface', () => {
  const actions = ['got_it', 'explain_simpler', 'show_example', 'save', 'quiz_me'] as const;

  for (const action of actions) {
    it(`${action} issues ZERO writes to any mastery table`, async () => {
      const res = await POST(makeReq({ messageId: VALID_MESSAGE_ID, actionType: action, sessionId: SESSION_ID }));
      expect(res.status).toBe(200);
      expectNoMasteryWrites();
    });
  }

  it('quiz_me TRIGGER (press, no answer) writes NOTHING but the bus event — no mastery, no feedback, no bookmark', async () => {
    const res = await POST(makeReq({ messageId: VALID_MESSAGE_ID, actionType: 'quiz_me', sessionId: SESSION_ID }));
    expect(res.status).toBe(200);
    // No mastery surface touched.
    expectNoMasteryWrites();
    // quiz_me records the SIGNAL only — no feedback RPC, no student_bookmarks.
    expect(rpcCalls.find((c) => c.name === 'record_message_feedback')).toBeUndefined();
    expect(writes.find((w) => w.table === 'student_bookmarks')).toBeUndefined();
    // No expectation lifecycle change either (quiz_me never touches expectations).
    expect(_markExpectationAnswered).not.toHaveBeenCalled();
  });

  it('the ONLY non-feedback/bookmark side effect across all actions is the bus publish (telemetry)', async () => {
    for (const action of actions) {
      writes = [];
      rpcCalls = [];
      publishCalls = [];
      await POST(makeReq({ messageId: VALID_MESSAGE_ID, actionType: action, sessionId: SESSION_ID }));
      // Exactly one bus event per action.
      expect(publishCalls.length, `${action} should publish exactly one event`).toBe(1);
      expectNoMasteryWrites();
    }
  });
});

// ─── GUARD #2 — NO XP ─────────────────────────────────────────────────────────
describe('GUARD #2 — no XP: route never awards XP and never calls the quiz-submit path', () => {
  const actions = ['got_it', 'explain_simpler', 'show_example', 'save', 'quiz_me'] as const;

  for (const action of actions) {
    it(`${action} never calls submitQuizResults / atomic_quiz_profile_update`, async () => {
      const res = await POST(makeReq({ messageId: VALID_MESSAGE_ID, actionType: action, sessionId: SESSION_ID }));
      expect(res.status).toBe(200);
      expect(rpcCalls.find((c) => c.name === 'atomic_quiz_profile_update')).toBeUndefined();
    });

    it(`${action} response carries no XP field`, async () => {
      const res = await POST(makeReq({ messageId: VALID_MESSAGE_ID, actionType: action, sessionId: SESSION_ID }));
      const body = await res.json();
      const blob = JSON.stringify(body).toLowerCase();
      expect(blob).not.toMatch(/"xp/);
      expect(blob).not.toMatch(/xp_earned|xpearned|xp_total/);
    });
  }
});

// ─── GUARD #4 — FEEDBACK PROVENANCE ───────────────────────────────────────────
describe('GUARD #4 — feedback provenance via record_message_feedback', () => {
  it('got_it → is_up=true, reason="learning_action:got_it", exactly one RPC row', async () => {
    const res = await POST(makeReq({ messageId: VALID_MESSAGE_ID, actionType: 'got_it' }));
    expect(res.status).toBe(200);
    const fbCalls = rpcCalls.filter((c) => c.name === 'record_message_feedback');
    expect(fbCalls).toHaveLength(1);
    const args = fbCalls[0].args as { p_message_id: string; p_is_up: boolean; p_reason: string };
    expect(args.p_message_id).toBe(VALID_MESSAGE_ID);
    expect(args.p_is_up).toBe(true);
    expect(args.p_reason).toBe('learning_action:got_it');
    const body = await res.json();
    expect(body.data.feedbackId).toBe('feedback-uuid-1');
  });

  it('explain_simpler → is_up=false, reason="learning_action:explain_simpler"', async () => {
    const res = await POST(makeReq({ messageId: VALID_MESSAGE_ID, actionType: 'explain_simpler' }));
    expect(res.status).toBe(200);
    const fbCalls = rpcCalls.filter((c) => c.name === 'record_message_feedback');
    expect(fbCalls).toHaveLength(1);
    const args = fbCalls[0].args as { p_is_up: boolean; p_reason: string };
    expect(args.p_is_up).toBe(false);
    expect(args.p_reason).toBe('learning_action:explain_simpler');
  });

  it('show_example / save / quiz_me write NO feedback row (no provenance for non-feedback actions)', async () => {
    for (const action of ['show_example', 'save', 'quiz_me'] as const) {
      rpcCalls = [];
      await POST(makeReq({ messageId: VALID_MESSAGE_ID, actionType: action, sessionId: SESSION_ID }));
      expect(
        rpcCalls.find((c) => c.name === 'record_message_feedback'),
        `${action} must not record feedback`,
      ).toBeUndefined();
    }
  });

  it('ownership 404-collapse: message owned by another student → 404, NO feedback RPC', async () => {
    setMessageRow({
      data: { id: VALID_MESSAGE_ID, student_id: OTHER_STUDENT_ID, role: 'assistant', session_id: SESSION_ID, content: 'x' },
      error: null,
    });
    const res = await POST(makeReq({ messageId: VALID_MESSAGE_ID, actionType: 'got_it' }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('NOT_FOUND');
    expect(rpcCalls.find((c) => c.name === 'record_message_feedback')).toBeUndefined();
  });

  it('ownership 404-collapse: missing message → 404 (same code as wrong-owner — no UUID probing)', async () => {
    setMessageRow({ data: null, error: null });
    const res = await POST(makeReq({ messageId: VALID_MESSAGE_ID, actionType: 'got_it' }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('NOT_FOUND');
  });

  it('ownership 404-collapse: user-role message (not assistant) → 404', async () => {
    setMessageRow({
      data: { id: VALID_MESSAGE_ID, student_id: STUDENT_ID, role: 'user', session_id: SESSION_ID, content: 'x' },
      error: null,
    });
    const res = await POST(makeReq({ messageId: VALID_MESSAGE_ID, actionType: 'got_it' }));
    expect(res.status).toBe(404);
  });
});

// ─── GUARD #5 — CONTINUITY (expectation lifecycle on got_it) ──────────────────
describe('GUARD #5 — continuity: got_it expectation lifecycle', () => {
  const CHECKABLE = ['mcq', 'recall', 'solve'] as const;
  // Progression-ladder kinds — a "Got it" ack must NOT close these so the
  // chapter ladder survives to the next turn (Part 2C). They stay OPEN.
  const PROGRESSION = ['choose_topic', 'next_topic'] as const;
  // Closable kinds — non-checkable AND non-progression (explain / open).
  const CLOSABLE = ['explain', 'open'] as const;

  for (const kind of CHECKABLE) {
    it(`got_it on an open CHECKABLE expectation (${kind}) leaves it OPEN (no markExpectationAnswered)`, async () => {
      _loadOpenExpectation.mockResolvedValue({ id: 'exp-1', kind, session_id: SESSION_ID });
      const res = await POST(makeReq({ messageId: VALID_MESSAGE_ID, actionType: 'got_it', sessionId: SESSION_ID }));
      expect(res.status).toBe(200);
      expect(_loadOpenExpectation).toHaveBeenCalled();
      expect(_markExpectationAnswered).not.toHaveBeenCalled();
    });
  }

  for (const kind of PROGRESSION) {
    it(`got_it on an open PROGRESSION-ladder expectation (${kind}) leaves it OPEN (ladder survives the ack)`, async () => {
      _loadOpenExpectation.mockResolvedValue({ id: 'exp-prog', kind, session_id: SESSION_ID });
      const res = await POST(makeReq({ messageId: VALID_MESSAGE_ID, actionType: 'got_it', sessionId: SESSION_ID }));
      expect(res.status).toBe(200);
      expect(_loadOpenExpectation).toHaveBeenCalled();
      // PROGRESSION anchors must NOT be closed by a "Got it" tap.
      expect(_markExpectationAnswered).not.toHaveBeenCalled();
    });
  }

  for (const kind of CLOSABLE) {
    it(`got_it on an open CLOSABLE expectation (${kind}) MAY close it via markExpectationAnswered(id, null)`, async () => {
      _loadOpenExpectation.mockResolvedValue({ id: 'exp-2', kind, session_id: SESSION_ID });
      const res = await POST(makeReq({ messageId: VALID_MESSAGE_ID, actionType: 'got_it', sessionId: SESSION_ID }));
      expect(res.status).toBe(200);
      expect(_markExpectationAnswered).toHaveBeenCalledTimes(1);
      // answeredMessageId is null — there is no answer message, just an ack tap.
      const callArgs = _markExpectationAnswered.mock.calls[0];
      expect(callArgs[1]).toBe('exp-2'); // expectationId
      expect(callArgs[2]).toBeNull();    // answeredMessageId
    });
  }

  it('explain_simpler leaves an open CHECKABLE expectation OPEN (never closes the loop)', async () => {
    _loadOpenExpectation.mockResolvedValue({ id: 'exp-3', kind: 'mcq', session_id: SESSION_ID });
    await POST(makeReq({ messageId: VALID_MESSAGE_ID, actionType: 'explain_simpler', sessionId: SESSION_ID }));
    expect(_markExpectationAnswered).not.toHaveBeenCalled();
  });

  it('explain_simpler leaves an open NON-CHECKABLE expectation OPEN too', async () => {
    _loadOpenExpectation.mockResolvedValue({ id: 'exp-4', kind: 'open', session_id: SESSION_ID });
    await POST(makeReq({ messageId: VALID_MESSAGE_ID, actionType: 'explain_simpler', sessionId: SESSION_ID }));
    expect(_markExpectationAnswered).not.toHaveBeenCalled();
  });

  it('show_example leaves the expectation OPEN (never loads or closes it)', async () => {
    _loadOpenExpectation.mockResolvedValue({ id: 'exp-5', kind: 'open', session_id: SESSION_ID });
    await POST(makeReq({ messageId: VALID_MESSAGE_ID, actionType: 'show_example', sessionId: SESSION_ID }));
    expect(_markExpectationAnswered).not.toHaveBeenCalled();
  });

  it('got_it with no open expectation is a no-op on the lifecycle (no markExpectationAnswered)', async () => {
    _loadOpenExpectation.mockResolvedValue(null);
    const res = await POST(makeReq({ messageId: VALID_MESSAGE_ID, actionType: 'got_it', sessionId: SESSION_ID }));
    expect(res.status).toBe(200);
    expect(_markExpectationAnswered).not.toHaveBeenCalled();
  });
});

// ─── GUARD #7 — GOT-IT PROGRESSION GUARD (next_topic ladder survival) ─────────
// Binding (Part 2C): a "Got it" tap must NOT close choose_topic or next_topic
// (the chapter-ladder anchors), MUST still close explain/open, and MUST leave
// mcq/recall/solve open. PROGRESSION_EXPECTATION_KINDS = {choose_topic,
// next_topic} is the guard set in /api/foxy/learning-action/route.ts.
describe('GUARD #7 — got_it progression guard: ladder anchors survive the ack', () => {
  it('got_it does NOT close choose_topic (topic menu still awaiting a pick)', async () => {
    _loadOpenExpectation.mockResolvedValue({ id: 'exp-ct', kind: 'choose_topic', session_id: SESSION_ID });
    await POST(makeReq({ messageId: VALID_MESSAGE_ID, actionType: 'got_it', sessionId: SESSION_ID }));
    expect(_markExpectationAnswered).not.toHaveBeenCalled();
  });

  it('got_it does NOT close next_topic (ladder advance + Socratic check still open)', async () => {
    _loadOpenExpectation.mockResolvedValue({ id: 'exp-nt', kind: 'next_topic', session_id: SESSION_ID });
    await POST(makeReq({ messageId: VALID_MESSAGE_ID, actionType: 'got_it', sessionId: SESSION_ID }));
    expect(_markExpectationAnswered).not.toHaveBeenCalled();
  });

  it('got_it STILL closes explain and open (closable kinds)', async () => {
    for (const kind of ['explain', 'open'] as const) {
      vi.clearAllMocks();
      setAuthorized();
      _loadOpenExpectation.mockResolvedValue({ id: `exp-${kind}`, kind, session_id: SESSION_ID });
      _markExpectationAnswered.mockResolvedValue(undefined);
      await POST(makeReq({ messageId: VALID_MESSAGE_ID, actionType: 'got_it', sessionId: SESSION_ID }));
      expect(_markExpectationAnswered, `${kind} should close on got_it`).toHaveBeenCalledTimes(1);
    }
  });

  it('got_it leaves mcq / recall / solve OPEN (checkable kinds still gradable)', async () => {
    for (const kind of ['mcq', 'recall', 'solve'] as const) {
      vi.clearAllMocks();
      setAuthorized();
      _loadOpenExpectation.mockResolvedValue({ id: `exp-${kind}`, kind, session_id: SESSION_ID });
      await POST(makeReq({ messageId: VALID_MESSAGE_ID, actionType: 'got_it', sessionId: SESSION_ID }));
      expect(_markExpectationAnswered, `${kind} must stay open on got_it`).not.toHaveBeenCalled();
    }
  });
});

// ─── GUARD #6 (route-level half) — quiz_me TRIGGER is formative-only ──────────
describe('GUARD #6 (trigger) — quiz_me press records the signal but writes no evidence', () => {
  it('quiz_me writes no quiz_sessions row and changes no P1 score (no mastery, no feedback, no bookmark)', async () => {
    const res = await POST(makeReq({ messageId: VALID_MESSAGE_ID, actionType: 'quiz_me', sessionId: SESSION_ID }));
    expect(res.status).toBe(200);
    expect(writes.find((w) => w.table === 'quiz_sessions')).toBeUndefined();
    expectNoMasteryWrites();
    expect(rpcCalls.find((c) => c.name === 'record_message_feedback')).toBeUndefined();
    expect(rpcCalls.find((c) => c.name === 'atomic_quiz_profile_update')).toBeUndefined();
  });
});

// ─── save path: RLS-respecting bookmark insert (not supabaseAdmin) ────────────
describe('save path — RLS-respecting student_bookmarks insert', () => {
  it('save inserts into student_bookmarks via the SERVER (RLS) client, never via supabaseAdmin', async () => {
    const res = await POST(makeReq({ messageId: VALID_MESSAGE_ID, actionType: 'save', sessionId: SESSION_ID }));
    expect(res.status).toBe(200);
    const bookmarkWrites = writes.filter((w) => w.table === 'student_bookmarks');
    expect(bookmarkWrites).toHaveLength(1);
    expect(bookmarkWrites[0].client).toBe('server'); // RLS-respecting, not admin
    expect(bookmarkWrites[0].op).toBe('insert');
    // And still no mastery writes.
    expectNoMasteryWrites();
  });
});

// ─── bus payload is IDs + enums only (P13) ────────────────────────────────────
describe('telemetry payload hygiene (P13)', () => {
  it('the published learner.learning_action payload carries IDs + enums only — no message content', async () => {
    await POST(makeReq({ messageId: VALID_MESSAGE_ID, actionType: 'save', sessionId: SESSION_ID, subjectCode: 'science', chapterNumber: 4 }));
    expect(publishCalls).toHaveLength(1);
    const ev = publishCalls[0] as { kind: string; payload: Record<string, unknown> };
    expect(ev.kind).toBe('learner.learning_action');
    // The message body is never echoed on the bus.
    const blob = JSON.stringify(ev.payload);
    expect(blob).not.toContain('Photosynthesis');
    expect(ev.payload.actionType).toBe('save');
    expect(ev.payload.messageId).toBe(VALID_MESSAGE_ID);
  });
});
