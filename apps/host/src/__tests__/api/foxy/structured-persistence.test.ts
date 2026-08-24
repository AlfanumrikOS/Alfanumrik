/**
 * /api/foxy structured-payload persistence — Phase 2 (structured rendering).
 *
 * Pins the API-boundary contract for the new `structured` field that the
 * grounded-answer Edge Function may include alongside the legacy `answer`
 * string. Three scenarios are pinned:
 *
 *   1. Upstream returns a VALID `structured` FoxyResponse:
 *        - Route response includes `structured`.
 *        - DB insert for the assistant row carries `structured: <obj>` and
 *          `content: <denormalized string>` (NOT the raw `answer`).
 *
 *   2. Upstream returns NO `structured` field (legacy path):
 *        - Route response omits `structured`.
 *        - DB insert sets `structured: null` and `content: <raw answer>`.
 *
 *   3. Upstream returns a MALFORMED `structured` payload:
 *        - Boundary validation rejects it.
 *        - logger.error('foxy.structured.invalid_payload') fires.
 *        - DB insert sets `structured: null` and `content: <raw answer>`.
 *
 * P12 (AI Safety): scenario 3 is defense-in-depth. Even if the Edge Function
 * side has a bug we never write a malformed payload into the JSONB column.
 * P9 (RBAC): unchanged — the test asserts on the post-auth code path; auth
 * itself is mocked permissively. The route's `authorizeRequest('foxy.chat')`
 * call still runs, but the test bench only asserts on persistence shape.
 * P13 (Data Privacy): the `foxy.structured.invalid_payload` log line must not
 * include studentId at error level (see route comments). The test asserts the
 * absence of that field in the logged context.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { FoxyResponse } from '@alfanumrik/lib/foxy/schema';
import { denormalizeFoxyResponse } from '@alfanumrik/lib/foxy/denormalize';

// ─── env stubs (route checks these at top of handler) ────────────────────────
beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
});

// ─── RBAC mock ───────────────────────────────────────────────────────────────
const _authorizeImpl = vi.fn();
const _logAuditImpl = vi.fn();

vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
  logAudit: (...args: unknown[]) => _logAuditImpl(...args),
}));

// ─── Feature-flag mock (grounded path ON, streaming OFF, ai_usage_global ON) ─
const _isFeatureEnabled = vi.fn();
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => _isFeatureEnabled(...args),
}));

// ─── Subject-governance mock — pass-through ──────────────────────────────────
vi.mock('@alfanumrik/lib/subjects', () => ({
  validateSubjectWrite: vi.fn().mockResolvedValue({ ok: true }),
}));

// ─── Logger spy ──────────────────────────────────────────────────────────────
const loggerInfo = vi.fn();
const loggerWarn = vi.fn();
const loggerError = vi.fn();
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: {
    info: (...args: unknown[]) => loggerInfo(...args),
    warn: (...args: unknown[]) => loggerWarn(...args),
    error: (...args: unknown[]) => loggerError(...args),
    debug: vi.fn(),
  },
}));

// ─── grounded-client mock — controlled per test ──────────────────────────────
type GroundedReturn = Record<string, unknown>;
let _groundedReturn: GroundedReturn = {};
function setGroundedReturn(value: GroundedReturn) {
  _groundedReturn = value;
}

vi.mock('@alfanumrik/lib/ai/grounded-client', () => ({
  callGroundedAnswer: (...args: unknown[]) => {
    void args;
    return Promise.resolve(_groundedReturn);
  },
  callGroundedAnswerStream: vi.fn().mockResolvedValue({ ok: false, reason: 'not-used' }),
}));

// ─── ai workflows (legacy path) — should NEVER be reached in these tests ─────
vi.mock('@alfanumrik/lib/ai', () => ({
  classifyIntent: vi.fn().mockResolvedValue({ intent: 'should-not-run' }),
  routeIntent: vi.fn().mockRejectedValue(new Error('legacy path should not run')),
}));

// ─── supabaseAdmin mock ──────────────────────────────────────────────────────
//
// Captures the rows passed to `from('foxy_chat_messages').insert([...])`.
// Other tables (foxy_sessions, students, cme_*, etc.) return permissive
// stubs so the route progresses to the persistence step.
const insertCalls: { table: string; rows: unknown }[] = [];
const updateCalls: { table: string; patch: unknown }[] = [];

// Injectable driver errors for foxy_chat_messages. supabase-js does NOT throw
// on a rejected write — it RESOLVES with `{ data: null, error }`. These knobs
// reproduce that exact shape, which is what the 2026-08-24 incident turned on.
let _messageInsertError: { code: string; message: string } | null = null;
let _messageUpdateError: { code: string; message: string } | null = null;

function makeChain(table: string) {
  // The route uses many chained methods. Build a permissive chain that
  // returns sensible defaults.
  const chain: Record<string, unknown> = {};
  let isUpdate = false;

  // Default resolvers per table.
  const resolveDefault = (): { data: unknown; error: unknown } => {
    if (table === 'students') {
      return {
        data: { subscription_plan: 'free', account_status: 'active', academic_goal: null },
        error: null,
      };
    }
    if (table === 'foxy_sessions') {
      return { data: { id: 'session-uuid-1' }, error: null };
    }
    if (table === 'foxy_chat_messages') {
      return { data: [], error: null };
    }
    return { data: [], error: null };
  };

  const fluent = [
    'select',
    'insert',
    'update',
    'eq',
    'neq',
    'in',
    'ilike',
    'order',
    'limit',
    'gte',
    'lte',
    'not',
    'is',
  ];
  for (const m of fluent) {
    chain[m] = (..._args: unknown[]) => chain;
  }
  // Override insert so we capture the rows AND keep the chain (route awaits
  // the bare insert promise).
  chain.insert = (rows: unknown) => {
    insertCalls.push({ table, rows });
    const err = table === 'foxy_chat_messages' ? _messageInsertError : null;
    // `.insert(rows).select('id, role')` resolves with the inserted rows —
    // mirror that so the route can capture the assistant-row UUID.
    const selectResult = () => {
      if (err) return { data: null, error: err };
      const list = Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [rows];
      return {
        data: list.map((r, i) => ({ id: `msg-${r.role ?? 'row'}-${i}`, role: r.role })),
        error: null,
      };
    };
    // Return a thenable so `await supabaseAdmin.from(t).insert(rows)` works.
    return {
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve({ data: null, error: err }).then(resolve, reject),
      // Allow .select() chaining (route uses .insert(...).select('id').single()
      // for sessions and .insert(...).select('id, role') for messages).
      select: () => ({
        single: () => Promise.resolve({ data: { id: 'session-uuid-1' }, error: null }),
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(selectResult()).then(resolve, reject),
      }),
    };
  };
  chain.update = (patch: unknown) => {
    updateCalls.push({ table, patch });
    isUpdate = true;
    return chain;
  };
  // Terminal awaits.
  chain.single = () => Promise.resolve(resolveDefault());
  chain.maybeSingle = () => Promise.resolve(resolveDefault());
  // Direct-await on chain (terminal).
  (chain as { then: unknown }).then = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) => {
    if (isUpdate && table === 'foxy_chat_messages' && _messageUpdateError) {
      return Promise.resolve({ data: null, error: _messageUpdateError }).then(resolve, reject);
    }
    return Promise.resolve(resolveDefault()).then(resolve, reject);
  };
  return chain;
}

const rpcImpl = vi.fn();

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => makeChain(table),
    rpc: (...args: unknown[]) => rpcImpl(...args),
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────
function makePostRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/foxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' },
    body: JSON.stringify(body),
  });
}

const VALID_STRUCTURED: FoxyResponse = {
  title: 'Solving 2x + 3 = 11',
  subject: 'math',
  blocks: [
    { type: 'step', text: 'Subtract 3 from both sides.' },
    { type: 'math', latex: '2x = 8' },
    { type: 'answer', text: 'x = 4' },
  ],
};

function makeGroundedSuccess(extra: Record<string, unknown> = {}): GroundedReturn {
  return {
    grounded: true,
    answer: 'Answer text from upstream.',
    citations: [],
    confidence: 0.9,
    groundedFromChunks: true,
    trace_id: 'trace-1',
    meta: { claude_model: 'haiku', tokens_used: 42, latency_ms: 100 },
    ...extra,
  };
}

function findAssistantInsert(): Record<string, unknown> | null {
  for (const call of insertCalls) {
    if (call.table !== 'foxy_chat_messages') continue;
    const rows = call.rows as Array<Record<string, unknown>>;
    const assistant = rows.find((r) => r.role === 'assistant');
    if (assistant) return assistant;
  }
  return null;
}

function findMessageInserts(): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (const call of insertCalls) {
    if (call.table !== 'foxy_chat_messages') continue;
    const list = Array.isArray(call.rows)
      ? (call.rows as Array<Record<string, unknown>>)
      : [call.rows as Record<string, unknown>];
    rows.push(...list);
  }
  return rows;
}

function persistFailureLogs(): Array<Record<string, unknown>> {
  return loggerError.mock.calls
    .filter((c: unknown[]) => c[0] === 'foxy.message_persist_failed')
    .map((c: unknown[]) => c[1] as Record<string, unknown>);
}

beforeEach(() => {
  vi.clearAllMocks();
  insertCalls.length = 0;
  updateCalls.length = 0;
  _messageInsertError = null;
  _messageUpdateError = null;
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId: 'auth-user-1',
    studentId: 'student-uuid-1',
    roles: ['student'],
    permissions: ['foxy.chat'],
  });
  _isFeatureEnabled.mockImplementation((flag: string) => {
    if (flag === 'ai_usage_global') return Promise.resolve(true);
    if (flag === 'ff_grounded_ai_foxy') return Promise.resolve(true);
    if (flag === 'ff_foxy_streaming') return Promise.resolve(false);
    return Promise.resolve(false);
  });
  // check_and_record_usage RPC: allow with used_count=1. get_plan_limit RPC
  // (DB-authoritative daily cap) returns a finite free-tier-ish number so the
  // route's remaining = max(0, limit - used_count) resolves cleanly.
  rpcImpl.mockImplementation((name: string) => {
    if (name === 'get_plan_limit') {
      return Promise.resolve({ data: 10, error: null });
    }
    return Promise.resolve({ data: [{ allowed: true, used_count: 1 }], error: null });
  });
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('/api/foxy structured persistence', () => {
  it('persists structured payload AND denormalized content when upstream returns valid structured', async () => {
    setGroundedReturn(makeGroundedSuccess({ structured: VALID_STRUCTURED }));

    const { POST } = await import('@/app/api/foxy/route');
    const res = await POST(
      makePostRequest({ message: 'Solve 2x + 3 = 11', subject: 'math', grade: '7' }),
    );
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    // Wire shape: structured present and equal to the upstream payload.
    expect(body.structured).toEqual(VALID_STRUCTURED);
    // Legacy `response` still populated for backward compat.
    expect(typeof body.response).toBe('string');

    // DB insert for the assistant row carries BOTH structured and the
    // denormalized content string (NOT the raw upstream answer).
    const assistant = findAssistantInsert();
    expect(assistant).toBeTruthy();
    expect(assistant!.structured).toEqual(VALID_STRUCTURED);
    expect(assistant!.content).toBe(denormalizeFoxyResponse(VALID_STRUCTURED));
    // Critically: the persisted content is NOT the legacy raw answer when
    // structured is present (the structured payload is the source of truth).
    expect(assistant!.content).not.toBe('Answer text from upstream.');

    // No malformed-payload log fired on the happy path.
    const errorEvents = loggerError.mock.calls.map((c: unknown[]) => c[0]);
    expect(errorEvents).not.toContain('foxy.structured.invalid_payload');
  });

  it('omits structured from response and persists structured=null when upstream omits it', async () => {
    setGroundedReturn(makeGroundedSuccess(/* no structured */));

    const { POST } = await import('@/app/api/foxy/route');
    const res = await POST(
      makePostRequest({ message: 'Hello Foxy', subject: 'math', grade: '7' }),
    );
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    // Wire shape: NO structured field on the response (omit, don't null).
    expect('structured' in body).toBe(false);

    // DB insert: structured explicitly null, content is the raw upstream answer.
    const assistant = findAssistantInsert();
    expect(assistant).toBeTruthy();
    expect(assistant!.structured).toBeNull();
    expect(assistant!.content).toBe('Answer text from upstream.');

    // No malformed-payload log on the legacy path.
    const errorEvents = loggerError.mock.calls.map((c: unknown[]) => c[0]);
    expect(errorEvents).not.toContain('foxy.structured.invalid_payload');
  });

  it('rejects malformed structured payload at boundary, logs, persists null', async () => {
    // Missing `subject` makes the schema parse fail at the top-level field.
    const malformed = {
      title: 'Bad payload',
      // subject intentionally absent
      blocks: [{ type: 'paragraph', text: 'hi' }],
    };
    setGroundedReturn(makeGroundedSuccess({ structured: malformed }));

    const { POST } = await import('@/app/api/foxy/route');
    const res = await POST(
      makePostRequest({ message: 'Hi', subject: 'math', grade: '7' }),
    );
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    // Wire shape: structured field omitted (validation rejected the payload).
    expect('structured' in body).toBe(false);

    // DB insert: structured null, content is the raw upstream answer (the
    // student turn must still be preserved).
    const assistant = findAssistantInsert();
    expect(assistant).toBeTruthy();
    expect(assistant!.structured).toBeNull();
    expect(assistant!.content).toBe('Answer text from upstream.');

    // The boundary validator MUST fire its named log event.
    const invalidCalls = loggerError.mock.calls.filter(
      (c: unknown[]) => c[0] === 'foxy.structured.invalid_payload',
    );
    expect(invalidCalls.length).toBeGreaterThanOrEqual(1);
    // P13: studentId MUST NOT appear in the error context.
    const ctx = invalidCalls[0][1] as Record<string, unknown>;
    expect(ctx).not.toHaveProperty('studentId');
    // Trace id present for ops triage.
    expect(ctx).toHaveProperty('traceId');
  });

  it('audit log records structured_present=true on the structured path', async () => {
    setGroundedReturn(makeGroundedSuccess({ structured: VALID_STRUCTURED }));
    const { POST } = await import('@/app/api/foxy/route');
    await POST(makePostRequest({ message: 'Q', subject: 'math', grade: '7' }));
    expect(_logAuditImpl).toHaveBeenCalled();
    const auditDetails = (_logAuditImpl.mock.calls[0][1] as { details: Record<string, unknown> })
      .details;
    expect(auditDetails.structured_present).toBe(true);
  });

  it('audit log records structured_present=false on the legacy / malformed path', async () => {
    setGroundedReturn(makeGroundedSuccess(/* no structured */));
    const { POST } = await import('@/app/api/foxy/route');
    await POST(makePostRequest({ message: 'Q', subject: 'math', grade: '7' }));
    const auditDetails = (_logAuditImpl.mock.calls[0][1] as { details: Record<string, unknown> })
      .details;
    expect(auditDetails.structured_present).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Incident 2026-08-24 — "Foxy persisted ZERO messages for 21 days"
// ─────────────────────────────────────────────────────────────────────────────
//
// Production evidence: max(foxy_chat_messages.created_at) = 2026-08-02, while
// foxy_sessions kept being created normally (283 rows in August). 256/329
// sessions in the trailing 30 days had ZERO messages. Nothing alerted.
//
// Two structural defects made that possible and invisible; both are pinned
// here.
//
//   D1. EVERY foxy_chat_messages write site destructured only `data` and
//       dropped the driver `error`, inside a try/catch that could never fire.
//       supabase-js RESOLVES with `{ data: null, error }` on a rejected write
//       — it does not throw. So a constraint violation / missing column /
//       RLS denial produced no log line at all and the turn returned 200 as
//       if the message had been saved.
//
//   D2. The hard-abstain return was a pure early-exit that wrote NOTHING.
//       When the grounded service abstains, the STUDENT'S OWN QUESTION was
//       destroyed, not just Foxy's answer — which is precisely the shape of
//       "sessions exist, messages don't".
//
// P13: the failure log must carry ids / counts / error codes / constraint
// NAMES only — never the student's message text.
describe('/api/foxy message-persistence failure surfacing (incident 2026-08-24)', () => {
  it('D1: a rejected foxy_chat_messages INSERT is logged, not swallowed', async () => {
    setGroundedReturn(makeGroundedSuccess({ structured: VALID_STRUCTURED }));
    // The exact shape supabase-js hands back on a CHECK violation.
    _messageInsertError = {
      code: '23514',
      message:
        'new row for relation "foxy_chat_messages" violates check constraint "structured_role_check"',
    };

    const { POST } = await import('@/app/api/foxy/route');
    const res = await POST(
      makePostRequest({ message: 'Solve 2x + 3 = 11', subject: 'math', grade: '7' }),
    );

    // The student still gets their answer — a persistence failure must never
    // break the turn (P4-style resilience).
    expect(res.status).toBe(200);

    // ...but the route MUST have surfaced the write failure.
    const failures = persistFailureLogs();
    expect(failures.length).toBeGreaterThanOrEqual(1);
    const f = failures[0];
    expect(f.table).toBe('foxy_chat_messages');
    expect(f.stage).toBe('grounded_insert');
    expect(f.errorCode).toBe('23514');
    expect(f.errorKind).toBe('check_violation');
    // Constraint NAME is the alertable/diagnosable field.
    expect(f.constraint).toBe('structured_role_check');
    // Identifiers present for triage.
    expect(f.foxySessionId).toBe('session-uuid-1');
    expect(f.studentId).toBe('student-uuid-1');
  });

  it('D1/P13: the failure log carries no message text and no raw driver strings', async () => {
    const secret = 'my private question about photosynthesis';
    setGroundedReturn(makeGroundedSuccess());
    _messageInsertError = {
      code: '23502',
      // Postgres embeds the failing row values in DETAIL — the exact reason
      // the raw driver message must never be logged verbatim.
      message: `null value in column "content" violates not-null constraint DETAIL: Failing row contains (${secret}).`,
    };

    const { POST } = await import('@/app/api/foxy/route');
    await POST(makePostRequest({ message: secret, subject: 'math', grade: '7' }));

    const failures = persistFailureLogs();
    expect(failures.length).toBeGreaterThanOrEqual(1);
    for (const f of failures) {
      const serialized = JSON.stringify(f);
      expect(serialized).not.toContain(secret);
      expect(serialized).not.toContain('Failing row');
      expect(f).not.toHaveProperty('content');
      expect(f).not.toHaveProperty('message');
    }
    // Structural identifiers survived the scrub.
    expect(failures[0].errorCode).toBe('23502');
    expect(failures[0].errorKind).toBe('not_null_violation');
    expect(failures[0].column).toBe('content');
  });

  it('D2: a hard abstain still persists the turn instead of losing the question', async () => {
    // `no_supporting_chunks` is NOT in LEGACY_FALLBACK_ABSTAIN_REASONS, so this
    // is the terminal hard-abstain return — the branch that used to write
    // nothing at all.
    setGroundedReturn({
      grounded: false,
      abstain_reason: 'no_supporting_chunks',
      suggested_alternatives: [],
      citations: [],
      trace_id: 'trace-abstain',
      meta: { latency_ms: 12, tokens_used: 0 },
    });

    const { POST } = await import('@/app/api/foxy/route');
    const res = await POST(
      makePostRequest({ message: 'What is turgor pressure?', subject: 'science', grade: '7' }),
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.groundingStatus).toBe('hard-abstain');

    const rows = findMessageInserts();
    const userRow = rows.find((r) => r.role === 'user');
    expect(userRow, 'the student question MUST be persisted on the abstain path').toBeTruthy();
    expect(userRow!.content).toBe('What is turgor pressure?');
    // A well-formed turn: the assistant side is recorded too (safe abstain
    // text, never fabricated content).
    expect(rows.find((r) => r.role === 'assistant')).toBeTruthy();
  });

  it('D1: a rejected pending→final UPDATE falls back to an INSERT and is logged', async () => {
    // ff_foxy_native_turns_v1 ON → the route pre-inserts user + pending
    // assistant rows, then UPDATEs the assistant row on completion. A
    // BEFORE UPDATE immutability guard would reject that UPDATE and strand the
    // answer as an empty pending row forever.
    _isFeatureEnabled.mockImplementation((flag: string) => {
      if (flag === 'ai_usage_global') return Promise.resolve(true);
      if (flag === 'ff_grounded_ai_foxy') return Promise.resolve(true);
      if (flag === 'ff_foxy_streaming') return Promise.resolve(false);
      if (flag === 'ff_foxy_native_turns_v1') return Promise.resolve(true);
      return Promise.resolve(false);
    });
    _messageUpdateError = {
      code: 'P0001',
      message: 'foxy_chat_messages rows are immutable',
    };
    setGroundedReturn(makeGroundedSuccess({ structured: VALID_STRUCTURED }));

    const { POST } = await import('@/app/api/foxy/route');
    const res = await POST(makePostRequest({ message: 'Q', subject: 'math', grade: '7' }));
    expect(res.status).toBe(200);

    // The rejected UPDATE is logged with its stage...
    const stages = persistFailureLogs().map((f) => f.stage);
    expect(stages).toContain('grounded_update');

    // ...and the assistant turn still materialises via the fallback INSERT
    // carrying the real answer (not the empty pending placeholder).
    const assistantRows = findMessageInserts().filter((r) => r.role === 'assistant');
    expect(assistantRows.length).toBeGreaterThanOrEqual(2); // pending + fallback
    const finalRow = assistantRows[assistantRows.length - 1];
    expect(finalRow.pending).toBe(false);
    expect(finalRow.content).toBe(denormalizeFoxyResponse(VALID_STRUCTURED));
  });
});
