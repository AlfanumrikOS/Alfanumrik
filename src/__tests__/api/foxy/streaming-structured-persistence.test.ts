/**
 * /api/foxy STREAMING structured-payload persistence — Phase 2 (closes the
 * MAJOR finding from quality review of PR #475 / #493).
 *
 * The non-streaming branch was already covered by
 * `structured-persistence.test.ts`. This file pins the SAME contract for the
 * streaming branch (`ff_foxy_streaming` ON):
 *
 *   1. SSE `done` event includes a VALID `structured` FoxyResponse:
 *        - DB insert for the assistant row carries `structured: <obj>`.
 *        - DB insert for `content` is the DENORMALIZED string (NOT raw JSON).
 *        - Audit log records `structured_present: true`.
 *
 *   2. SSE `done` event has NO `structured` field (legacy / non-Foxy upstream):
 *        - DB insert sets `structured: null` and `content` = accumulated text.
 *        - Audit log records `structured_present: false`.
 *
 *   3. SSE `done` event has a MALFORMED `structured` payload:
 *        - Boundary validation rejects it.
 *        - logger.error('foxy.structured.invalid_payload') fires.
 *        - DB insert sets `structured: null` and `content` = accumulated text
 *          so the student turn is still preserved.
 *
 * Why this matters: prior to this fix, the streaming `persistOnDone` ignored
 * `payload.structured` and wrote `accumulatedText` (which, when the structured-
 * output prompt is active, is the raw model JSON) into `content` and left
 * `structured` NULL. On session resume (GET) the renderer's legacy fallback
 * would render escaped JSON to users. With `ff_foxy_streaming` defaulting OFF
 * the blast radius today is zero, but flipping the flag would corrupt every
 * streamed turn until this is fixed.
 *
 * Product invariant compliance:
 *   P12 (AI Safety) — defense-in-depth: malformed JSONB is never persisted.
 *   P13 (Data Privacy) — the `foxy.structured.invalid_payload` log line MUST
 *     NOT include studentId at error level (asserted in case 3).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { FoxyResponse } from '@/lib/foxy/schema';
import { denormalizeFoxyResponse } from '@/lib/foxy/denormalize';

// ─── env stubs ───────────────────────────────────────────────────────────────
beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
});

// ─── RBAC mock ───────────────────────────────────────────────────────────────
const _authorizeImpl = vi.fn();
const _logAuditImpl = vi.fn();

vi.mock('@/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
  logAudit: (...args: unknown[]) => _logAuditImpl(...args),
}));

// ─── Feature-flag mock — streaming ON ────────────────────────────────────────
const _isFeatureEnabled = vi.fn();
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => _isFeatureEnabled(...args),
}));

// ─── Subject-governance mock — pass-through ──────────────────────────────────
vi.mock('@/lib/subjects', () => ({
  validateSubjectWrite: vi.fn().mockResolvedValue({ ok: true }),
}));

// ─── Logger spy ──────────────────────────────────────────────────────────────
const loggerInfo = vi.fn();
const loggerWarn = vi.fn();
const loggerError = vi.fn();
vi.mock('@/lib/logger', () => ({
  logger: {
    info: (...args: unknown[]) => loggerInfo(...args),
    warn: (...args: unknown[]) => loggerWarn(...args),
    error: (...args: unknown[]) => loggerError(...args),
    debug: vi.fn(),
  },
}));

// ─── grounded-client streaming mock ──────────────────────────────────────────
//
// We hand the route handler a Response whose body is a synthetic SSE stream we
// build per test. The route's TransformStream parser will consume it, fire
// `persistOnDone`, and we assert on the captured DB insert.

interface SSEEvent {
  event: string;
  data: Record<string, unknown>;
}

function buildSseStream(events: SSEEvent[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) {
        const frame = `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`;
        controller.enqueue(encoder.encode(frame));
      }
      controller.close();
    },
  });
}

// Per-test buffer of events to stream; mutated via setStreamEvents().
let _streamEvents: SSEEvent[] = [];
function setStreamEvents(events: SSEEvent[]) {
  _streamEvents = events;
}

vi.mock('@/lib/ai/grounded-client', () => ({
  callGroundedAnswer: vi.fn().mockResolvedValue({ grounded: false, abstain_reason: 'circuit_open' }),
  callGroundedAnswerStream: vi.fn(async () => {
    const body = buildSseStream(_streamEvents);
    return {
      ok: true as const,
      response: new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    };
  }),
}));

// ─── ai workflows (legacy) — should never be reached ─────────────────────────
vi.mock('@/lib/ai', () => ({
  classifyIntent: vi.fn().mockResolvedValue({ intent: 'should-not-run' }),
  routeIntent: vi.fn().mockRejectedValue(new Error('legacy path should not run')),
}));

// ─── supabaseAdmin mock ──────────────────────────────────────────────────────
const insertCalls: { table: string; rows: unknown }[] = [];

function makeChain(table: string) {
  const chain: Record<string, unknown> = {};

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
    'select', 'insert', 'update', 'eq', 'neq', 'in', 'ilike',
    'order', 'limit', 'gte', 'lte', 'not', 'is',
  ];
  for (const m of fluent) {
    chain[m] = (..._args: unknown[]) => chain;
  }
  chain.insert = (rows: unknown) => {
    insertCalls.push({ table, rows });
    return {
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve, reject),
      select: () => ({
        single: () => Promise.resolve({ data: { id: 'session-uuid-1' }, error: null }),
      }),
    };
  };
  chain.single = () => Promise.resolve(resolveDefault());
  chain.maybeSingle = () => Promise.resolve(resolveDefault());
  (chain as { then: unknown }).then = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise.resolve(resolveDefault()).then(resolve, reject);
  return chain;
}

const rpcImpl = vi.fn();

vi.mock('@/lib/supabase-admin', () => ({
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

async function drainStream(res: Response): Promise<string> {
  // Drain the response body so the route's TransformStream `flush()` runs and
  // fires `persistOnDone()`. Without this, the test would assert on the insert
  // BEFORE the persistence step executed.
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  // Yield once so any awaited inserts inside the fire-and-forget
  // `void persistOnDone()` resolve before assertions run.
  await new Promise((resolve) => setTimeout(resolve, 0));
  // And once more — the insert path is `await`-chained inside persistOnDone.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const decoder = new TextDecoder();
  return chunks.map((c) => decoder.decode(c)).join('');
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

function findAssistantInsert(): Record<string, unknown> | null {
  for (const call of insertCalls) {
    if (call.table !== 'foxy_chat_messages') continue;
    const rows = call.rows as Array<Record<string, unknown>>;
    const assistant = rows.find((r) => r.role === 'assistant');
    if (assistant) return assistant;
  }
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  insertCalls.length = 0;
  _streamEvents = [];
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId: 'auth-user-1',
    studentId: 'student-uuid-1',
    roles: ['student'],
    permissions: ['foxy.chat'],
  });
  // ff_foxy_streaming ON for these tests — that's the whole point.
  _isFeatureEnabled.mockImplementation((flag: string) => {
    if (flag === 'ai_usage_global') return Promise.resolve(true);
    if (flag === 'ff_grounded_ai_foxy') return Promise.resolve(true);
    if (flag === 'ff_foxy_streaming') return Promise.resolve(true);
    return Promise.resolve(false);
  });
  rpcImpl.mockResolvedValue({
    data: [{ allowed: true, current_count: 1 }],
    error: null,
  });
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('/api/foxy streaming structured persistence', () => {
  it('persists structured payload AND denormalized content when SSE done emits valid structured', async () => {
    // Synthesize an SSE stream with the same shape pipeline-stream.ts emits:
    // metadata → text deltas → done(with structured).
    setStreamEvents([
      {
        event: 'metadata',
        data: {
          groundingStatus: 'grounded',
          citations: [],
          traceId: 'trace-stream-1',
          confidence: 0.92,
        },
      },
      // The model would have streamed the raw JSON of VALID_STRUCTURED token by
      // token (the structured-output prompt forces JSON). Mid-stream we can't
      // validate, so we deliberately inject a JSON-shaped accumulatedText that
      // would be UNREADABLE if persisted to `content`.
      { event: 'text', data: { delta: JSON.stringify(VALID_STRUCTURED) } },
      {
        event: 'done',
        data: {
          tokensUsed: 64,
          latencyMs: 320,
          groundedFromChunks: true,
          claudeModel: 'claude-haiku-4-5',
          answerLength: 150,
          // The ENTIRE point of the fix — pipeline-stream.ts now emits this on
          // `done`, and the route must (a) capture it (b) validate (c) persist.
          structured: VALID_STRUCTURED,
        },
      },
    ]);

    const { POST } = await import('@/app/api/foxy/route');
    const res = await POST(
      makePostRequest({ message: 'Solve 2x + 3 = 11', subject: 'math', grade: '7', stream: true }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    await drainStream(res);

    const assistant = findAssistantInsert();
    expect(assistant).toBeTruthy();
    // The structured JSONB column carries the full validated payload.
    expect(assistant!.structured).toEqual(VALID_STRUCTURED);
    // CRITICAL — `content` is the denormalized human-readable text, NOT the
    // raw JSON-shaped accumulatedText. This is what closes the legacy-fallback
    // rendering bug on session resume.
    expect(assistant!.content).toBe(denormalizeFoxyResponse(VALID_STRUCTURED));
    expect(assistant!.content).not.toContain('{"title"'); // not raw JSON

    // No malformed-payload log fired on the happy path.
    const errorEvents = loggerError.mock.calls.map((c: unknown[]) => c[0]);
    expect(errorEvents).not.toContain('foxy.structured.invalid_payload');

    // Audit log adoption-telemetry parity with the non-streaming branch.
    expect(_logAuditImpl).toHaveBeenCalled();
    const auditDetails = (_logAuditImpl.mock.calls[0][1] as { details: Record<string, unknown> })
      .details;
    expect(auditDetails.structured_present).toBe(true);
    expect(auditDetails.flow).toBe('grounded-answer-stream');
  });

  it('persists structured=null and content=accumulatedText when SSE done has no structured', async () => {
    // Legacy / non-Foxy / pre-structured upstream — `done` event omits structured.
    setStreamEvents([
      {
        event: 'metadata',
        data: { groundingStatus: 'grounded', citations: [], traceId: 'trace-2', confidence: 0.8 },
      },
      { event: 'text', data: { delta: 'Hello, ' } },
      { event: 'text', data: { delta: 'student!' } },
      {
        event: 'done',
        data: {
          tokensUsed: 12,
          latencyMs: 100,
          groundedFromChunks: true,
          claudeModel: 'claude-haiku-4-5',
          answerLength: 16,
          // No structured field — legacy path.
        },
      },
    ]);

    const { POST } = await import('@/app/api/foxy/route');
    const res = await POST(
      makePostRequest({ message: 'Hi Foxy', subject: 'math', grade: '7', stream: true }),
    );
    expect(res.status).toBe(200);
    await drainStream(res);

    const assistant = findAssistantInsert();
    expect(assistant).toBeTruthy();
    // structured column explicitly null on legacy path.
    expect(assistant!.structured).toBeNull();
    // content is the accumulated streamed text (sum of all `text.delta` events).
    expect(assistant!.content).toBe('Hello, student!');

    const errorEvents = loggerError.mock.calls.map((c: unknown[]) => c[0]);
    expect(errorEvents).not.toContain('foxy.structured.invalid_payload');

    const auditDetails = (_logAuditImpl.mock.calls[0][1] as { details: Record<string, unknown> })
      .details;
    expect(auditDetails.structured_present).toBe(false);
  });

  it('rejects malformed structured at boundary, logs once, persists null without losing turn', async () => {
    // Missing `subject` makes the schema parse fail at the top-level field.
    const malformed = {
      title: 'Bad payload',
      // subject intentionally absent
      blocks: [{ type: 'paragraph', text: 'hi' }],
    };

    setStreamEvents([
      {
        event: 'metadata',
        data: { groundingStatus: 'grounded', citations: [], traceId: 'trace-3', confidence: 0.8 },
      },
      { event: 'text', data: { delta: 'Partial answer text.' } },
      {
        event: 'done',
        data: {
          tokensUsed: 8,
          latencyMs: 90,
          groundedFromChunks: true,
          claudeModel: 'claude-haiku-4-5',
          answerLength: 20,
          structured: malformed,
        },
      },
    ]);

    const { POST } = await import('@/app/api/foxy/route');
    const res = await POST(
      makePostRequest({ message: 'Hi', subject: 'math', grade: '7', stream: true }),
    );
    expect(res.status).toBe(200);
    await drainStream(res);

    const assistant = findAssistantInsert();
    expect(assistant).toBeTruthy();
    // Validation rejected → structured null, content preserved.
    expect(assistant!.structured).toBeNull();
    expect(assistant!.content).toBe('Partial answer text.');

    // Boundary validator MUST fire its named log event.
    const invalidCalls = loggerError.mock.calls.filter(
      (c: unknown[]) => c[0] === 'foxy.structured.invalid_payload',
    );
    expect(invalidCalls.length).toBeGreaterThanOrEqual(1);
    // P13 — studentId must NOT appear in the error context.
    const ctx = invalidCalls[0][1] as Record<string, unknown>;
    expect(ctx).not.toHaveProperty('studentId');
    expect(ctx).toHaveProperty('traceId', 'trace-3');

    // Audit log records structured_present=false on the malformed path (parity
    // with the non-streaming branch — `false` means "we did not persist a
    // validated structured payload", regardless of why).
    const auditDetails = (_logAuditImpl.mock.calls[0][1] as { details: Record<string, unknown> })
      .details;
    expect(auditDetails.structured_present).toBe(false);
  });
});
