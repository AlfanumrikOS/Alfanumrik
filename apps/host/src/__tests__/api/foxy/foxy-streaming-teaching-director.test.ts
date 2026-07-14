/**
 * Foxy Teaching Director — STREAMING parity + persist-on-success (Phase 2.1
 * polish, 2026-07-15). Behind ff_foxy_teaching_director_v1 (default OFF).
 *
 * Pins the two server-side fixes on the SSE streaming path
 * (apps/host/src/app/api/foxy/_lib/streaming.ts::handleStreamingFoxyTurn):
 *
 *   FIX 1 (streaming parity) — when the route threads a composed `teachingPlan`
 *   into the handler (teaching turn + flag ON), the SSE `done` event is enriched
 *   with the SAME `suggestedButtons` + `nextActions` the blocking JSON path
 *   returns. With NO plan (flag OFF / non-teaching / Director failure) the
 *   upstream `done` frame is re-emitted verbatim → byte-identical to today.
 *
 *   FIX 2 (persist on success only) — the per-session lesson step
 *   (persistLessonProgress) advances ONLY after a successful, non-safety-blocked
 *   answer (a `done` frame that passes the output screen). On an abstain (no
 *   `done`) or a safety redaction the lesson step is NOT advanced (the student
 *   didn't get the teaching, so the lesson stays put).
 *
 * We invoke the handler directly with a synthetic upstream SSE stream (the same
 * technique the grounded-answer Edge Function would produce) and a mocked
 * persistLessonProgress spy, so a refactor that drops the enrichment or the
 * success-gating surfaces immediately.
 *
 * Owner: ai-engineer. P14 reviewers: assessment (pedagogy), testing, frontend.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GroundedRequest } from '@alfanumrik/lib/ai/grounded-client';
import type { TeachingPlan } from '@alfanumrik/lib/foxy/teaching-director';
import { EMPTY_COGNITIVE_CONTEXT } from '@/app/api/foxy/_lib/constants';

// ─── rbac (logAudit) + logger ────────────────────────────────────────────────
vi.mock('@alfanumrik/lib/rbac', () => ({ logAudit: vi.fn() }));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── quota refund → no-op (avoid the real student_daily_usage read/write) ────
vi.mock('@/app/api/foxy/_lib/quota', () => ({ refundQuota: vi.fn().mockResolvedValue(undefined) }));

// ─── teaching-director → spy persistLessonProgress ───────────────────────────
const persistSpy = vi.fn();
vi.mock('@/app/api/foxy/_lib/teaching-director', () => ({
  persistLessonProgress: (...args: unknown[]) => persistSpy(...args),
}));

// ─── supabaseAdmin — capture the assistant persist, answer reads ─────────────
const insertCalls: { table: string; rows: unknown }[] = [];
function makeChain(table: string) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'neq', 'in', 'order', 'limit', 'update']) {
    chain[m] = () => chain;
  }
  chain.insert = (rows: unknown) => {
    insertCalls.push({ table, rows });
    return {
      select: () => ({
        then: (res: (v: unknown) => unknown) =>
          Promise.resolve({
            data: [
              { id: 'assistant-row-1', role: 'assistant' },
              { id: 'user-row-1', role: 'user' },
            ],
            error: null,
          }).then(res),
      }),
    };
  };
  chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
  chain.single = () => Promise.resolve({ data: null, error: null });
  (chain as { then: unknown }).then = (res: (v: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null }).then(res);
  return chain;
}
vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (t: string) => makeChain(t) },
}));

// ─── grounded-client streaming mock — feed a synthetic upstream SSE stream ───
interface SSEEvent { event: string; data: Record<string, unknown> }
let _streamEvents: SSEEvent[] = [];
function buildSseStream(events: SSEEvent[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) {
        controller.enqueue(encoder.encode(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`));
      }
      controller.close();
    },
  });
}
vi.mock('@alfanumrik/lib/ai/grounded-client', () => ({
  callGroundedAnswerStream: vi.fn(async () => ({
    ok: true as const,
    response: new Response(buildSseStream(_streamEvents), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }),
  })),
}));

// eslint-disable-next-line import/first
import { handleStreamingFoxyTurn } from '@/app/api/foxy/_lib/streaming';

// ─── Fixtures ────────────────────────────────────────────────────────────────
const FAKE_PLAN = {
  currentObjective: {
    conceptName: 'Decimals',
    conceptId: 'concept-decimals-1',
    whyNow: 'next-in-ladder',
    reason: { en: 'You are ready for the next step: Decimals.', hi: 'आप अगले चरण के लिए तैयार हैं: Decimals।' },
  },
  lessonStep: 'hook',
  difficultyTarget: 0.5,
  targetBloom: 'understand',
  depthCeiling: 'within_grade',
  suggestedButtons: ['got_it', 'show_example', 'quiz_me'],
  recommendedNextActions: [
    { kind: 'quiz_concept', label: { en: 'Practice Decimals with a few questions', hi: 'Decimals के कुछ सवालों से अभ्यास करो' } },
  ],
} as unknown as TeachingPlan;

const SUCCESS_EVENTS: SSEEvent[] = [
  { event: 'metadata', data: { groundingStatus: 'grounded', citations: [], traceId: 't1', confidence: 0.9 } },
  { event: 'text', data: { delta: 'Decimals are numbers with a fractional part.' } },
  { event: 'done', data: { tokensUsed: 40, latencyMs: 120, groundedFromChunks: true, claudeModel: 'claude-haiku-4-5', answerLength: 44 } },
];

function baseParams(overrides: Record<string, unknown> = {}) {
  return {
    groundedRequest: {} as GroundedRequest,
    hopTimeoutMs: 5000,
    studentId: 'student-1',
    userId: 'auth-user-1',
    resolvedSessionId: 'session-1',
    message: 'Teach me decimals',
    subject: 'math',
    grade: '7',
    chapter: null,
    mode: 'learn',
    cognitiveCtx: EMPTY_COGNITIVE_CONTEXT,
    ...overrides,
  };
}

async function drain(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  // Flush the fire-and-forget persistence + expectation writes.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  return chunks.map((c) => new TextDecoder().decode(c)).join('');
}

function parseDone(wire: string): Record<string, unknown> | null {
  for (const raw of wire.split('\n\n')) {
    const eventLine = raw.split('\n').find((l) => l.startsWith('event: '));
    const dataLine = raw.split('\n').find((l) => l.startsWith('data: '));
    if (eventLine?.slice(7).trim() === 'done' && dataLine) {
      try { return JSON.parse(dataLine.slice(6)); } catch { return null; }
    }
  }
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  insertCalls.length = 0;
  _streamEvents = [];
});

// ─── FIX 1 — streaming done-event parity ─────────────────────────────────────

describe('streaming done-event parity (FIX 1)', () => {
  it('plan present → done carries suggestedButtons + nextActions AND advances the lesson (FIX 2 success)', async () => {
    _streamEvents = SUCCESS_EVENTS;
    const res = await handleStreamingFoxyTurn(baseParams({ teachingPlan: FAKE_PLAN }));
    const wire = await drain(res);

    const done = parseDone(wire);
    expect(done).not.toBeNull();
    // Existing done keys preserved.
    expect(done!.tokensUsed).toBe(40);
    expect(done!.groundedFromChunks).toBe(true);
    // NEW wire fields — same names + values the blocking path returns.
    expect(done!.suggestedButtons).toEqual(FAKE_PLAN.suggestedButtons);
    expect(done!.nextActions).toEqual(FAKE_PLAN.recommendedNextActions);

    // FIX 2: successful answer → lesson step advanced exactly once with the plan.
    expect(persistSpy).toHaveBeenCalledTimes(1);
    expect(persistSpy).toHaveBeenCalledWith('session-1', FAKE_PLAN);
  });

  it('NO plan → done frame unchanged (no new keys) and NO lesson advance (byte-identical)', async () => {
    _streamEvents = SUCCESS_EVENTS;
    const res = await handleStreamingFoxyTurn(baseParams()); // no teachingPlan
    const wire = await drain(res);

    const done = parseDone(wire);
    expect(done).not.toBeNull();
    expect(done!.tokensUsed).toBe(40);
    expect(done!).not.toHaveProperty('suggestedButtons');
    expect(done!).not.toHaveProperty('nextActions');
    // The verbatim upstream done frame is re-emitted (no re-serialization).
    expect(wire).toContain('event: done');

    expect(persistSpy).not.toHaveBeenCalled();
  });
});

// ─── FIX 2 — persist ONLY on success ─────────────────────────────────────────

describe('lesson advances ONLY on a successful teaching answer (FIX 2)', () => {
  it('abstain (no done frame) → lesson step is NOT advanced even with a plan', async () => {
    _streamEvents = [
      { event: 'metadata', data: { groundingStatus: 'grounded', citations: [], traceId: 't2', confidence: 0.5 } },
      { event: 'abstain', data: { abstainReason: 'no_chunks_retrieved', suggestedAlternatives: [], traceId: 't2', latencyMs: 5 } },
    ];
    const res = await handleStreamingFoxyTurn(baseParams({ teachingPlan: FAKE_PLAN }));
    const wire = await drain(res);

    expect(wire).toContain('event: abstain');
    expect(wire).not.toContain('event: done');
    expect(persistSpy).not.toHaveBeenCalled();
  });

  it('upstream error frame (no done) → lesson step is NOT advanced even with a plan', async () => {
    _streamEvents = [
      { event: 'metadata', data: { groundingStatus: 'grounded', citations: [], traceId: 't3', confidence: 0.5 } },
      { event: 'error', data: { reason: 'timeout', traceId: 't3', latencyMs: 30000 } },
    ];
    const res = await handleStreamingFoxyTurn(baseParams({ teachingPlan: FAKE_PLAN }));
    const wire = await drain(res);

    expect(wire).toContain('event: error');
    expect(persistSpy).not.toHaveBeenCalled();
  });

  it('safety-blocked answer (done seen but content redacted) → lesson step is NOT advanced', async () => {
    _streamEvents = [
      { event: 'metadata', data: { groundingStatus: 'grounded', citations: [], traceId: 't4', confidence: 0.9 } },
      { event: 'text', data: { delta: 'This streamed answer is fucking unsafe.' } },
      { event: 'done', data: { tokensUsed: 20, latencyMs: 80, groundedFromChunks: true, claudeModel: 'claude-haiku-4-5', answerLength: 40 } },
    ];
    const res = await handleStreamingFoxyTurn(baseParams({ teachingPlan: FAKE_PLAN }));
    const wire = await drain(res);

    // The unsafe answer is reconciled to a safe abstain; done/text are withheld.
    expect(wire).toContain('event: abstain');
    expect(wire).not.toContain('event: done');
    expect(wire).not.toContain('fucking');
    // The student never got the teaching → lesson step must NOT advance.
    expect(persistSpy).not.toHaveBeenCalled();
  });
});
