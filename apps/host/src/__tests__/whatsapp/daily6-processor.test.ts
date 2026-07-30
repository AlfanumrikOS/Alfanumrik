/**
 * WhatsApp Daily 6 — processor lifecycle tests (Phase 3, the core loop).
 *
 * Binding spec: docs/superpowers/specs/2026-07-30-whatsapp-daily6-behavioral-spec.md
 * Module under test: apps/host/src/app/api/whatsapp/_lib/daily6.ts
 *
 * Builder-handoff pins implemented here:
 *   (i)    flagged (P3) → xp_earned 0 shown, score recorded via the RPC,
 *          flagged copy in the summary (EN + HI).
 *   (ii)   partial sets NEVER submitted — new-IST-day expiry abandons WITHOUT
 *          submit_quiz_results_v2; same-day resume re-serves the current
 *          question.
 *   (iii)  bkt_update called ONCE per answer with (student, node_code,
 *          is_correct, time_ms); record_adaptive_response NEVER called
 *          (runtime assertion in a global afterEach — the double-XP
 *          protection; the static twin lives in daily6-wiring.test.ts).
 *   (iv)   runtime caller literals: 'whatsapp-webhook-route' for webhook-
 *          sourced events, 'whatsapp-drain-cron' for drain-sourced events
 *          (byte-exact static twin vs migration 20260801100600 in
 *          daily6-wiring.test.ts).
 *   (vi)   d6_last_event_id replay guard — same event re-delivered does not
 *          double-append a response or re-run bkt_update.
 *   (ix)   snapshot grading — PINNED ACTUAL: the JSONB shuffle_map arrives in
 *          JS as a 0-based array, and the code grades displayed index d via
 *          shuffleMap[d] === correct_answer_index_snapshot. This is the exact
 *          twin of the SQL grader `shuffle_map[selected + 1]` (1-based), per
 *          the baseline column comment "shuffle_map[displayed_index] =
 *          original_index". Hand-computed examples below.
 *   (x)    XP is RPC-authoritative — the summary renders the RPC's returned
 *          values VERBATIM (xp_earned=70 for 5/6 → "+70 XP").
 *   (xi)   timing clamp(1..600) — the 1s floor is deliberate (do NOT raise to
 *          3) — and p_time = SUM(time_spent), not wall-clock last−first.
 *   (xii)  floor-3: <3 P6-valid questions → no session + bilingual copy.
 *   (xiii) subject picker: multi-subject student gets the picker,
 *          single-subject skips it.
 *
 * House pattern: supabaseAdmin via lazy Proxy, logger mocked,
 * resolveActiveStudent (the R6 chokepoint) mocked at the module boundary,
 * whatsapp-send fetch stubbed. Owner: testing.
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';

// ─── Module-boundary mocks ──────────────────────────────────────────────────

let mockAdminImpl: any;
vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: new Proxy({} as any, {
    get(_target, prop) {
      if (!mockAdminImpl) return undefined;
      const value = mockAdminImpl[prop];
      return typeof value === 'function' ? value.bind(mockAdminImpl) : value;
    },
  }),
}));

const loggerCalls: Array<{ level: string; msg: string; meta?: unknown }> = [];
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: {
    info: (msg: string, meta?: unknown) => loggerCalls.push({ level: 'info', msg, meta }),
    warn: (msg: string, meta?: unknown) => loggerCalls.push({ level: 'warn', msg, meta }),
    error: (msg: string, meta?: unknown) => loggerCalls.push({ level: 'error', msg, meta }),
    debug: vi.fn(),
  },
}));

/** Captures the byte-exact caller literal handed to the signer (pin iv). */
const signCalls: Array<{ method: string; path: string; caller: string }> = [];
vi.mock('@alfanumrik/lib/security/internal-caller-signing', () => ({
  buildInternalCallerHeaders: (method: string, path: string, _payload: string, caller: string) => {
    signCalls.push({ method, path, caller });
    return { 'x-internal-caller': caller };
  },
}));

/** R6 chokepoint mocked at the boundary — the processor must use ONLY this. */
let activeStudent: any;
const resolveActiveStudentMock = vi.fn(async () => activeStudent);
vi.mock('@alfanumrik/lib/whatsapp/identity', () => ({
  resolveActiveStudent: (...a: unknown[]) => resolveActiveStudentMock(...a),
}));

import {
  DAILY6_PROCESSABLE_INTENTS,
  processDaily6Event,
  runDaily6EventFromWebhook,
  type Daily6Event,
} from '@/app/api/whatsapp/_lib/daily6';
import { istDate } from '@alfanumrik/lib/whatsapp/ist';

// ─── whatsapp-send fetch stub ───────────────────────────────────────────────

interface FetchCall {
  url: string;
  headers: Record<string, string>;
  body: any;
}

const fetchState = {
  calls: [] as FetchCall[],
  /** Per-call result queue; empty → ok:200. */
  results: [] as Array<{ ok: boolean; status?: number }>,
};

const fetchMock = vi.fn(async (url: any, init: any) => {
  fetchState.calls.push({
    url: String(url),
    headers: (init?.headers ?? {}) as Record<string, string>,
    body: JSON.parse(String(init?.body ?? '{}')),
  });
  const r = fetchState.results.length > 0 ? fetchState.results.shift()! : { ok: true };
  return { ok: r.ok, status: r.status ?? (r.ok ? 200 : 500) } as Response;
});
vi.stubGlobal('fetch', fetchMock);

afterAll(() => {
  vi.unstubAllGlobals();
});

// ─── supabaseAdmin state ────────────────────────────────────────────────────

type RpcResult = { data: unknown; error: { message: string } | null };
type RpcHandler = RpcResult[] | ((args: Record<string, any>) => RpcResult);
type FilterCall = [string, ...unknown[]];

const st = {
  identityRows: [] as Array<{ id: string; role: string; created_at?: string }>,
  sessionPrefRows: [] as Array<{ identity_id: string }>,
  sessionRow: null as Record<string, unknown> | null,
  sessionUpserts: [] as Array<{ row: Record<string, any>; opts: Record<string, unknown> }>,
  sessionUpsertError: null as { message: string } | null,
  nodeRows: [] as Array<{ node_code: string }>,
  subjectCodeRows: [] as Array<{ subject_code: string }>,
  masteryCount: 0,
  masteryRow: null as Record<string, unknown> | null,
  shuffleRows: {} as Record<string, Record<string, unknown>>,
  shuffleError: null as { message: string } | null,
  studentRow: null as Record<string, unknown> | null,
  eventStatusUpdates: [] as Array<{ update: Record<string, unknown>; filters: FilterCall[] }>,
  rpcCalls: [] as Array<{ name: string; args: Record<string, any> }>,
  rpcHandlers: {} as Record<string, RpcHandler>,
};

function resetState() {
  st.identityRows = [{ id: 'ident-1', role: 'student' }];
  st.sessionPrefRows = [];
  st.sessionRow = null;
  st.sessionUpserts.length = 0;
  st.sessionUpsertError = null;
  st.nodeRows = [];
  st.subjectCodeRows = [];
  st.masteryCount = 0;
  st.masteryRow = { mastery_prob: 0.68, next_review_at: new Date(Date.now() + 2 * 86_400_000).toISOString() };
  st.shuffleRows = {};
  st.shuffleError = null;
  st.studentRow = { streak_days: 5 };
  st.eventStatusUpdates.length = 0;
  st.rpcCalls.length = 0;
  st.rpcHandlers = {
    bkt_update: [{ data: null, error: null }],
    submit_quiz_results_v2: [
      { data: { total: 6, correct: 4, score_percent: 67, xp_earned: 40, flagged: false }, error: null },
    ],
  };
}

function buildMockAdmin() {
  return {
    from(table: string) {
      switch (table) {
        case 'whatsapp_identities':
          return {
            select: () => {
              const c: any = {
                eq: () => c,
                is: () => c,
                not: () => c,
                order: () => c,
                then: (res: any, rej: any) =>
                  Promise.resolve({ data: st.identityRows, error: null }).then(res, rej),
              };
              return c;
            },
          };
        case 'whatsapp_sessions': {
          return {
            select: () => {
              let usedIn = false;
              const c: any = {
                eq: () => c,
                in: () => {
                  usedIn = true;
                  return c;
                },
                order: () => c,
                limit: () => c,
                maybeSingle: async () => ({ data: st.sessionRow, error: null }),
                then: (res: any, rej: any) =>
                  Promise.resolve({ data: usedIn ? st.sessionPrefRows : [], error: null }).then(
                    res,
                    rej,
                  ),
              };
              return c;
            },
            upsert: (row: Record<string, any>, opts: Record<string, unknown>) => {
              st.sessionUpserts.push({ row, opts });
              return Promise.resolve({ error: st.sessionUpsertError });
            },
          };
        }
        case 'learning_graph':
          return {
            select: (cols: string) => {
              const c: any = {
                eq: () => c,
                limit: () => c,
                then: (res: any, rej: any) =>
                  Promise.resolve({
                    data: cols.includes('node_code') ? st.nodeRows : st.subjectCodeRows,
                    error: null,
                  }).then(res, rej),
              };
              return c;
            },
          };
        case 'adaptive_mastery':
          return {
            select: (_cols: string, opts?: { head?: boolean }) => {
              if (opts?.head) {
                const c: any = {
                  eq: () => c,
                  in: () => c,
                  then: (res: any, rej: any) =>
                    Promise.resolve({ count: st.masteryCount, error: null }).then(res, rej),
                };
                return c;
              }
              const c: any = {
                eq: () => c,
                maybeSingle: async () => ({ data: st.masteryRow, error: null }),
              };
              return c;
            },
          };
        case 'quiz_session_shuffles': {
          let qid: string | null = null;
          return {
            select: () => {
              const c: any = {
                eq: (col: string, v: unknown) => {
                  if (col === 'question_id') qid = String(v);
                  return c;
                },
                maybeSingle: async () => ({
                  data: st.shuffleError ? null : qid ? (st.shuffleRows[qid] ?? null) : null,
                  error: st.shuffleError,
                }),
              };
              return c;
            },
          };
        }
        case 'students':
          return {
            select: () => {
              const c: any = {
                eq: () => c,
                maybeSingle: async () => ({ data: st.studentRow, error: null }),
              };
              return c;
            },
          };
        case 'whatsapp_inbound_events':
          return {
            update: (update: Record<string, unknown>) => {
              const rec = { update, filters: [] as FilterCall[] };
              st.eventStatusUpdates.push(rec);
              const c: any = {
                eq: (...a: unknown[]) => {
                  rec.filters.push(['eq', ...a]);
                  return c;
                },
                then: (res: any, rej: any) => Promise.resolve({ error: null }).then(res, rej),
              };
              return c;
            },
          };
        default:
          throw new Error(`unexpected from(${table}) in processor tests`);
      }
    },
    rpc: async (name: string, args: Record<string, any>) => {
      st.rpcCalls.push({ name, args });
      const h = st.rpcHandlers[name];
      if (!h) return { data: null, error: { message: `no handler for ${name}` } };
      if (typeof h === 'function') return h(args);
      return h.length > 1 ? h.shift()! : h[0];
    },
  };
}

function rpcCallsOf(name: string) {
  return st.rpcCalls.filter((c) => c.name === name);
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

const IDENTITY_ID = 'ident-1';
const TODAY = istDate();
const QIDS = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'];
/** Fixed serve timestamp for per-question timing math. */
const T0 = Date.parse('2026-07-30T04:00:00Z');

const SERVED = QIDS.map((id, i) => ({
  question_id: id,
  question_text: `Question ${i + 1} text?`,
  question_hi: null,
  options_displayed: [`${id}-optA`, `${id}-optB`, `${id}-optC`, `${id}-optD`],
  explanation: `Explanation for ${id}. It has detail.`,
  explanation_hi: null,
}));

/** N1 x4, N2 x2 — makes N1 the footer node (spec (h)). */
const META = QIDS.map((id, i) => ({
  question_id: id,
  node_code: i < 4 ? 'N1' : 'N2',
  source: i === 0 ? 'srs_due' : 'zpd',
  mastery_pct_before: i < 4 ? 62 : 40,
  title: i < 4 ? 'Fractions' : 'Decimals',
}));

const FULL_RESPONSES = QIDS.map((id, i) => ({
  question_id: id,
  selected_displayed_index: i % 4,
  time_spent: 5 * (i + 1), // SUM = 105
}));

function defaultContext(over: Record<string, unknown> = {}) {
  return {
    d6_idempotency_key: 'idem-1',
    d6_q_sent_at: new Date(T0).toISOString(),
    d6_meta: structuredClone(META),
    d6_questions: structuredClone(SERVED),
    ...over,
  };
}

function activeSession(over: Record<string, any> = {}) {
  return {
    identity_id: IDENTITY_ID,
    active_student_id: 'stu-1',
    state: 'daily6_active',
    d6_date: TODAY,
    d6_quiz_session_id: 'qs-1',
    d6_question_ids: [...QIDS],
    d6_index: 0,
    d6_responses: [],
    d6_served_at: new Date(Date.now() - 3_600_000).toISOString(),
    subject: 'MATH',
    grade: '8',
    locale: 'en',
    context: defaultContext(),
    ...over,
  };
}

function idleSession(over: Record<string, any> = {}) {
  return activeSession({
    state: 'idle',
    d6_date: null,
    d6_quiz_session_id: null,
    d6_question_ids: [],
    d6_index: 0,
    d6_responses: [],
    d6_served_at: null,
    context: {},
    ...over,
  });
}

function evt(over: Partial<Daily6Event> = {}): Daily6Event {
  return {
    id: 'evt-1',
    intent: 'd6_start',
    args: {},
    phoneHash: 'a'.repeat(64),
    receivedAtMs: Date.now(),
    source: 'webhook',
    ...over,
  } as Daily6Event;
}

/** Handlers for a full compose → start_quiz_session serve. */
function installComposeHandlers() {
  st.rpcHandlers.get_practice_queue = [
    {
      data: {
        queue: QIDS.map((_id, i) => ({
          node_code: `M${i + 1}`,
          title: `T${i + 1}`,
          source: 'srs_due',
          mastery_pct: 60,
        })),
      },
      error: null,
    },
  ];
  st.rpcHandlers.get_questions_for_node = (args) => {
    const n = Number(String(args.p_node_code).slice(1));
    const id = QIDS[n - 1];
    return {
      data: [
        {
          id,
          question_text: `Q${n}?`,
          options: [`${id}-a`, `${id}-b`, `${id}-c`, `${id}-d`],
          correct_answer_index: 1,
          explanation: 'Because so.',
        },
      ],
      error: null,
    };
  };
  st.rpcHandlers.start_quiz_session = [
    { data: { session_id: 'qs-1', questions: structuredClone(SERVED) }, error: null },
  ];
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
  resetState();
  loggerCalls.length = 0;
  signCalls.length = 0;
  fetchState.calls.length = 0;
  fetchState.results.length = 0;
  fetchMock.mockClear();
  resolveActiveStudentMock.mockClear();
  activeStudent = {
    studentId: 'stu-1',
    grade: '8',
    subject: 'MATH',
    locale: 'en',
    selectedSubjects: ['MATH'],
  };
  mockAdminImpl = buildMockAdmin();
});

afterEach(() => {
  // Pin (iii), runtime half of the double-XP protection: NOTHING in ANY flow
  // exercised by this suite may call record_adaptive_response.
  expect(st.rpcCalls.map((c) => c.name)).not.toContain('record_adaptive_response');
});

// ─────────────────────────────────────────────────────────────────────────────
// Dispatcher basics
// ─────────────────────────────────────────────────────────────────────────────

describe('processDaily6Event — dispatcher', () => {
  it('owns exactly the four Phase-3 intents (wiring mocks depend on this set)', () => {
    expect(new Set(DAILY6_PROCESSABLE_INTENTS)).toEqual(
      new Set(['d6_start', 'd6_answer', 'subject_pick', 'menu']),
    );
  });

  it('no live identity for the phone_hash → terminal "failed" with no sends', async () => {
    st.identityRows = [];
    const outcome = await processDaily6Event(evt());
    expect(outcome).toBe('failed');
    expect(fetchState.calls).toHaveLength(0);
  });

  it('live identity but no resolvable student → not-linked reply, outcome done', async () => {
    activeStudent = null;
    const outcome = await processDaily6Event(evt());
    expect(outcome).toBe('done');
    expect(fetchState.calls).toHaveLength(1);
    const body = fetchState.calls[0].body;
    expect(body.to_identity_id).toBe(IDENTITY_ID);
    expect(body.kind).toBe('session');
    expect(body.message.body).toContain('not linked to a student account');
  });

  it('not-linked reply is Hindi when the session row says locale=hi (P7)', async () => {
    activeStudent = null;
    st.sessionRow = idleSession({ locale: 'hi' });
    await processDaily6Event(evt());
    expect(fetchState.calls[0].body.message.body).toContain('विद्यार्थी खाते');
  });

  it('NEVER throws: resolveActiveStudent rejection maps to outcome retry', async () => {
    resolveActiveStudentMock.mockRejectedValueOnce(new Error('boom'));
    const outcome = await processDaily6Event(evt());
    expect(outcome).toBe('retry');
  });

  it('menu → interactive buttons carrying the d6:start opcode', async () => {
    const outcome = await processDaily6Event(evt({ intent: 'menu' }));
    expect(outcome).toBe('done');
    const msg = fetchState.calls[0].body.message;
    expect(msg.type).toBe('interactive_buttons');
    expect(msg.buttons.map((b: any) => b.id)).toEqual(['d6:start', 'show:help']);
  });

  it('menu send failure (whatsapp-send non-200) → retry', async () => {
    fetchState.results.push({ ok: false, status: 500 });
    const outcome = await processDaily6Event(evt({ intent: 'menu' }));
    expect(outcome).toBe('retry');
  });

  it('prefers the identity that already has a session row (most recent)', async () => {
    st.identityRows = [
      { id: 'ident-1', role: 'student' },
      { id: 'ident-2', role: 'student' },
    ];
    st.sessionPrefRows = [{ identity_id: 'ident-2' }];
    await processDaily6Event(evt({ intent: 'menu' }));
    expect(resolveActiveStudentMock).toHaveBeenCalledWith(expect.anything(), 'ident-2');
  });

  it('falls back to the oldest student-role binding when no session row exists', async () => {
    st.identityRows = [
      { id: 'ident-g', role: 'guardian' },
      { id: 'ident-s', role: 'student' },
    ];
    st.sessionPrefRows = [];
    await processDaily6Event(evt({ intent: 'menu' }));
    expect(resolveActiveStudentMock).toHaveBeenCalledWith(expect.anything(), 'ident-s');
  });
});

describe('runDaily6EventFromWebhook — event-row settlement', () => {
  it('outcome done → row marked done with processed_at', async () => {
    await runDaily6EventFromWebhook(evt({ intent: 'menu' }));
    expect(st.eventStatusUpdates).toHaveLength(1);
    expect(st.eventStatusUpdates[0].update.status).toBe('done');
    expect(typeof st.eventStatusUpdates[0].update.processed_at).toBe('string');
    expect(st.eventStatusUpdates[0].filters).toContainEqual(['eq', 'id', 'evt-1']);
  });

  it('outcome failed → row marked failed with last_error=daily6_terminal', async () => {
    st.identityRows = [];
    await runDaily6EventFromWebhook(evt());
    expect(st.eventStatusUpdates).toHaveLength(1);
    expect(st.eventStatusUpdates[0].update).toMatchObject({
      status: 'failed',
      last_error: 'daily6_terminal',
    });
  });

  it('outcome retry → row LEFT pending (no status write; the drain is the retry mechanism)', async () => {
    fetchState.results.push({ ok: false, status: 502 });
    await runDaily6EventFromWebhook(evt({ intent: 'menu' }));
    expect(st.eventStatusUpdates).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// startDaily6 — daily gate + subject picker (Q5, pin xiii)
// ─────────────────────────────────────────────────────────────────────────────

describe('startDaily6 — interim daily gate + subject selection', () => {
  it('d6_date already today (set completed) → done-for-today reply, NO compose', async () => {
    st.sessionRow = idleSession({ d6_date: TODAY });
    const outcome = await processDaily6Event(evt());
    expect(outcome).toBe('done');
    expect(fetchState.calls[0].body.message.body).toContain('come back tomorrow');
    expect(rpcCallsOf('get_practice_queue')).toHaveLength(0);
    expect(rpcCallsOf('start_quiz_session')).toHaveLength(0);
  });

  it('done-for-today reply is Hindi for locale=hi', async () => {
    activeStudent.locale = 'hi';
    st.sessionRow = idleSession({ d6_date: TODAY, locale: 'hi' });
    await processDaily6Event(evt());
    expect(fetchState.calls[0].body.message.body).toContain('कल फिर आना');
  });

  it('(xiii) MULTI-subject student → subject picker list, state=picking_subject, no compose yet', async () => {
    activeStudent.selectedSubjects = ['MATH', 'SCIENCE'];
    const outcome = await processDaily6Event(evt());
    expect(outcome).toBe('done');

    expect(st.sessionUpserts).toHaveLength(1);
    expect(st.sessionUpserts[0].row.state).toBe('picking_subject');

    const msg = fetchState.calls[0].body.message;
    expect(msg.type).toBe('interactive_list');
    // "Continue <last subject>" tops the list (active.subject = MATH).
    expect(msg.items[0].id).toBe('subj:MATH');
    expect(msg.items[0].title).toContain('Continue MATH');
    expect(msg.items.map((i: any) => i.id)).toEqual(['subj:MATH', 'subj:SCIENCE']);

    expect(rpcCallsOf('get_practice_queue')).toHaveLength(0);
  });

  it('(xiii) SINGLE-subject student → picker skipped, compose runs directly with that subject', async () => {
    activeStudent.selectedSubjects = ['MATH'];
    installComposeHandlers();
    await processDaily6Event(evt());
    const calls = rpcCallsOf('get_practice_queue');
    expect(calls).toHaveLength(1);
    expect(calls[0].args.p_subject).toBe('MATH');
    // No picking_subject state was ever written.
    expect(st.sessionUpserts.every((u) => u.row.state !== 'picking_subject')).toBe(true);
  });

  it('subject_pick with a valid subject composes for THAT subject', async () => {
    activeStudent.selectedSubjects = ['MATH', 'SCIENCE'];
    installComposeHandlers();
    const outcome = await processDaily6Event(
      evt({ intent: 'subject_pick', args: { subject: 'SCIENCE' } }),
    );
    expect(outcome).toBe('done');
    expect(rpcCallsOf('get_practice_queue')[0].args.p_subject).toBe('SCIENCE');
  });

  it('subject_pick with an unknown subject re-offers the picker, never composes', async () => {
    activeStudent.selectedSubjects = ['MATH', 'SCIENCE'];
    await processDaily6Event(evt({ intent: 'subject_pick', args: { subject: 'HACKED' } }));
    const msg = fetchState.calls[0].body.message;
    expect(msg.type).toBe('interactive_list');
    expect(msg.items.map((i: any) => i.id)).toEqual(['subj:MATH', 'subj:SCIENCE']);
    expect(rpcCallsOf('get_practice_queue')).toHaveLength(0);
  });

  it('subject_pick on a day already gated → done-for-today, no compose', async () => {
    activeStudent.selectedSubjects = ['MATH', 'SCIENCE'];
    st.sessionRow = idleSession({ d6_date: TODAY });
    await processDaily6Event(evt({ intent: 'subject_pick', args: { subject: 'MATH' } }));
    expect(fetchState.calls[0].body.message.body).toContain('come back tomorrow');
    expect(rpcCallsOf('get_practice_queue')).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// composeAndServe — serve + floor-3 (pin xii)
// ─────────────────────────────────────────────────────────────────────────────

describe('composeAndServe — session start + floor of 3', () => {
  it('serves via start_quiz_session and persists the full d6 session state', async () => {
    installComposeHandlers();
    const outcome = await processDaily6Event(evt());
    expect(outcome).toBe('done');

    expect(rpcCallsOf('start_quiz_session')).toHaveLength(1);
    expect(rpcCallsOf('start_quiz_session')[0].args).toEqual({
      p_student_id: 'stu-1',
      p_question_ids: QIDS,
    });

    expect(st.sessionUpserts).toHaveLength(1);
    const row = st.sessionUpserts[0].row;
    expect(row.state).toBe('daily6_active');
    expect(row.d6_date).toBe(TODAY);
    expect(row.d6_quiz_session_id).toBe('qs-1');
    expect(row.d6_question_ids).toEqual(QIDS);
    expect(row.d6_index).toBe(0);
    expect(row.d6_responses).toEqual([]);
    expect(row.grade).toBe('8'); // P5: STRING
    expect(typeof row.grade).toBe('string');
    expect(typeof row.context.d6_idempotency_key).toBe('string');
    expect(row.context.d6_idempotency_key).toHaveLength(36); // uuid
    expect(typeof row.context.d6_q_sent_at).toBe('string');
    expect(row.context.d6_meta).toHaveLength(6);
    expect(row.context.d6_questions).toHaveLength(6);

    // First question message: displayed options only, opcode rows
    // d6:a:<qIdx>:<optIdx> — qIdx=0 (the FIRST served question's position).
    const send = fetchState.calls[0].body;
    expect(send.message.type).toBe('interactive_list');
    expect(send.message.body).toContain('Q1/6');
    expect(send.message.items.map((i: any) => i.id)).toEqual([
      'd6:a:0:0',
      'd6:a:0:1',
      'd6:a:0:2',
      'd6:a:0:3',
    ]);
    expect(send.idempotency_key).toBe('d6:q:qs-1:0');
  });

  it('(xii) fewer than 3 P6-valid questions → NO session, bilingual "not enough" copy (EN)', async () => {
    st.rpcHandlers.get_practice_queue = [
      {
        data: { queue: [{ node_code: 'M1', source: 'srs_due' }, { node_code: 'M2', source: 'zpd' }] },
        error: null,
      },
    ];
    st.rpcHandlers.get_questions_for_node = (args) => {
      const id = `q-${args.p_node_code}`;
      return {
        data: [
          {
            id,
            question_text: `${id}?`,
            options: [`${id}-a`, `${id}-b`, `${id}-c`, `${id}-d`],
            correct_answer_index: 0,
            explanation: 'e.',
          },
        ],
        error: null,
      };
    };
    st.rpcHandlers.select_quiz_questions_rag = [
      { data: null, error: { message: 'Access denied' } },
    ];

    const outcome = await processDaily6Event(evt());
    expect(outcome).toBe('done');
    expect(rpcCallsOf('start_quiz_session')).toHaveLength(0);
    expect(fetchState.calls[0].body.message.body).toBe(
      'Not enough practice for this subject yet — try another subject.',
    );
    // The refusal upsert must NOT stamp d6_date — the student may immediately
    // try another subject (spec (a).3).
    expect(st.sessionUpserts).toHaveLength(1);
    expect(st.sessionUpserts[0].row.state).toBe('idle');
    expect(st.sessionUpserts[0].row).not.toHaveProperty('d6_date');
  });

  it('(xii) the "not enough" copy is Hindi for locale=hi', async () => {
    activeStudent.locale = 'hi';
    st.rpcHandlers.get_practice_queue = [{ data: { queue: [] }, error: null }];
    st.rpcHandlers.select_quiz_questions_rag = [
      { data: null, error: { message: 'Access denied' } },
    ];
    await processDaily6Event(evt());
    expect(fetchState.calls[0].body.message.body).toBe(
      'इस विषय के लिए अभी पर्याप्त अभ्यास सामग्री नहीं है — कोई और विषय आज़माओ।',
    );
  });

  it('exactly 3 valid questions serves a 3-question set (floor is inclusive) and totals track the served count', async () => {
    st.rpcHandlers.get_practice_queue = [
      {
        data: {
          queue: ['M1', 'M2', 'M3'].map((n) => ({ node_code: n, source: 'srs_due' })),
        },
        error: null,
      },
    ];
    st.rpcHandlers.get_questions_for_node = (args) => {
      const n = Number(String(args.p_node_code).slice(1));
      const id = QIDS[n - 1];
      return {
        data: [
          {
            id,
            question_text: `${id}?`,
            options: [`${id}-a`, `${id}-b`, `${id}-c`, `${id}-d`],
            correct_answer_index: 0,
            explanation: 'e.',
          },
        ],
        error: null,
      };
    };
    st.rpcHandlers.select_quiz_questions_rag = [
      { data: null, error: { message: 'Access denied' } },
    ];
    st.rpcHandlers.start_quiz_session = [
      { data: { session_id: 'qs-1', questions: structuredClone(SERVED.slice(0, 3)) }, error: null },
    ];

    const outcome = await processDaily6Event(evt());
    expect(outcome).toBe('done');
    expect(fetchState.calls[0].body.message.body).toContain('Q1/3');
    expect(st.sessionUpserts[0].row.d6_question_ids).toEqual(['q1', 'q2', 'q3']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Answer flow — snapshot grading (ix), bkt (iii), timing (xi), replay (vi)
// ─────────────────────────────────────────────────────────────────────────────

describe('handleDaily6Answer — snapshot grading + bkt_update + timing', () => {
  beforeEach(() => {
    st.sessionRow = activeSession();
    // shuffle_map semantics (baseline column comment):
    //   shuffle_map[displayed_index] = original_index in options_snapshot.
    // SQL grades shuffle_map[selected + 1] (1-based); the JS twin is
    // shuffleMap[selected] (0-based). Hand-computed: map [2,0,3,1] with
    // correct_answer_index_snapshot=3 → the correct DISPLAYED position is 2
    // (displayed C shows original option 3).
    st.shuffleRows.q1 = { shuffle_map: [2, 0, 3, 1], correct_answer_index_snapshot: 3 };
  });

  it('(ix)+(iii) correct answer: shuffleMap[d]===snapshot → is_correct, bkt_update ONCE with exact args', async () => {
    const outcome = await processDaily6Event(
      evt({ intent: 'd6_answer', args: { qIdx: '0', optIdx: '2' }, receivedAtMs: T0 + 20_000 }),
    );
    expect(outcome).toBe('done');

    const bkt = rpcCallsOf('bkt_update');
    expect(bkt).toHaveLength(1); // ONCE per answer
    expect(bkt[0].args).toEqual({
      p_student_id: 'stu-1', // R6: from resolveActiveStudent only
      p_node_code: 'N1',
      p_is_correct: true,
      p_response_time_ms: 20_000, // time_spent(20s) * 1000
    });

    // Response appended once; position + replay marker advanced.
    expect(st.sessionUpserts).toHaveLength(1);
    const row = st.sessionUpserts[0].row;
    expect(row.d6_responses).toEqual([
      { question_id: 'q1', selected_displayed_index: 2, time_spent: 20 },
    ]);
    expect(row.d6_index).toBe(1);
    expect(row.context.d6_last_event_id).toBe('evt-1');

    // ONE combined feedback message, then the next question separately.
    expect(fetchState.calls[0].body.message.body).toContain('✅ Correct!');
    expect(fetchState.calls[0].body.idempotency_key).toBe('d6:fb:qs-1:0');
    expect(fetchState.calls[1].body.message.body).toContain('Q2/6');
    expect(fetchState.calls[1].body.idempotency_key).toBe('d6:q:qs-1:1');
    // dev-5 opcode round-trip: the NEXT question (0-based index 1, "Q2/6")
    // stamps qIdx=1 — the position it now occupies as d6_index, not the
    // question it followed.
    expect(
      fetchState.calls[1].body.message.items.map((i: any) => i.id),
    ).toEqual(['d6:a:1:0', 'd6:a:1:1', 'd6:a:1:2', 'd6:a:1:3']);
  });

  it('(ix) wrong answer: graded vs snapshot, feedback names the correct DISPLAYED letter + option text + explanation', async () => {
    await processDaily6Event(
      evt({ intent: 'd6_answer', args: { qIdx: '0', optIdx: '0' }, receivedAtMs: T0 + 20_000 }),
    );
    // d=0 → shuffleMap[0]=2 ≠ 3 → wrong. Correct displayed index =
    // findIndex(orig===3) = 2 → letter C, text options_displayed[2].
    expect(rpcCallsOf('bkt_update')[0].args.p_is_correct).toBe(false);
    const fb = fetchState.calls[0].body.message.body;
    expect(fb).toContain('❌ The answer was C: q1-optC');
    expect(fb).toContain('Explanation for q1.');
  });

  it('(ix) second hand-computed permutation: map [3,2,1,0], snapshot 0 → displayed D is correct', async () => {
    st.shuffleRows.q1 = { shuffle_map: [3, 2, 1, 0], correct_answer_index_snapshot: 0 };
    await processDaily6Event(
      evt({ intent: 'd6_answer', args: { qIdx: '0', optIdx: '3' }, receivedAtMs: T0 + 10_000 }),
    );
    // SQL 1-based: shuffle_map[3+1] = shuffle_map[4] = 0 == snapshot →
    // JS 0-based twin: shuffleMap[3] = 0 == snapshot. Correct.
    expect(rpcCallsOf('bkt_update')[0].args.p_is_correct).toBe(true);
  });

  it('(xi) clamp FLOOR: a 300ms answer records time_spent=1 — the 1s floor is deliberate, NOT 3', async () => {
    await processDaily6Event(
      evt({ intent: 'd6_answer', args: { qIdx: '0', optIdx: '2' }, receivedAtMs: T0 + 300 }),
    );
    expect(st.sessionUpserts[0].row.d6_responses[0].time_spent).toBe(1);
    expect(rpcCallsOf('bkt_update')[0].args.p_response_time_ms).toBe(1_000);
  });

  it('(xi) clamp CEILING: a 5000s answer records time_spent=600', async () => {
    await processDaily6Event(
      evt({ intent: 'd6_answer', args: { qIdx: '0', optIdx: '2' }, receivedAtMs: T0 + 5_000_000 }),
    );
    expect(st.sessionUpserts[0].row.d6_responses[0].time_spent).toBe(600);
    expect(rpcCallsOf('bkt_update')[0].args.p_response_time_ms).toBe(600_000);
  });

  it('(vi) REPLAY GUARD: the same event id re-delivered does not double-append or re-run bkt_update', async () => {
    st.sessionRow = activeSession({
      d6_index: 1,
      d6_responses: [{ question_id: 'q1', selected_displayed_index: 2, time_spent: 20 }],
      context: defaultContext({ d6_last_event_id: 'evt-1' }),
    });
    const outcome = await processDaily6Event(
      evt({ intent: 'd6_answer', args: { qIdx: '1', optIdx: '2' }, receivedAtMs: T0 + 25_000 }),
    );
    expect(outcome).toBe('done');
    expect(rpcCallsOf('bkt_update')).toHaveLength(0);
    expect(st.sessionUpserts).toHaveLength(0); // response NOT re-appended
    // It re-serves the NEXT question so the student is never stuck.
    expect(fetchState.calls).toHaveLength(1);
    expect(fetchState.calls[0].body.message.body).toContain('Q2/6');
  });

  it('(iii) a question with no node_code (top-up) records the response but skips bkt_update', async () => {
    const meta = structuredClone(META);
    (meta[0] as any).node_code = null;
    st.sessionRow = activeSession({ context: defaultContext({ d6_meta: meta }) });
    await processDaily6Event(
      evt({ intent: 'd6_answer', args: { qIdx: '0', optIdx: '2' }, receivedAtMs: T0 + 20_000 }),
    );
    expect(rpcCallsOf('bkt_update')).toHaveLength(0);
    expect(st.sessionUpserts[0].row.d6_responses).toHaveLength(1);
  });

  it('bkt_update failure is non-fatal: the answer still records and the flow continues', async () => {
    st.rpcHandlers.bkt_update = [{ data: null, error: { message: 'bkt down' } }];
    const outcome = await processDaily6Event(
      evt({ intent: 'd6_answer', args: { qIdx: '0', optIdx: '2' }, receivedAtMs: T0 + 20_000 }),
    );
    expect(outcome).toBe('done');
    expect(st.sessionUpserts[0].row.d6_responses).toHaveLength(1);
  });

  it('stray answer with no active set → ignored terminally (position-check semantics)', async () => {
    st.sessionRow = idleSession();
    const outcome = await processDaily6Event(
      evt({ intent: 'd6_answer', args: { qIdx: '0', optIdx: '1' } }),
    );
    expect(outcome).toBe('done');
    expect(fetchState.calls).toHaveLength(0);
    expect(rpcCallsOf('bkt_update')).toHaveLength(0);
  });

  it('malformed answer index (out of 0-3) → ignored, nothing recorded', async () => {
    const outcome = await processDaily6Event(
      evt({ intent: 'd6_answer', args: { qIdx: '0', optIdx: '7' } }),
    );
    expect(outcome).toBe('done');
    expect(rpcCallsOf('bkt_update')).toHaveLength(0);
    expect(st.sessionUpserts).toHaveLength(0);
  });

  it('malformed / missing question position (qIdx) → ignored, nothing recorded', async () => {
    const outcome = await processDaily6Event(
      evt({ intent: 'd6_answer', args: { qIdx: 'not-a-number', optIdx: '2' } }),
    );
    expect(outcome).toBe('done');
    expect(rpcCallsOf('bkt_update')).toHaveLength(0);
    expect(st.sessionUpserts).toHaveLength(0);
    expect(fetchState.calls).toHaveLength(0);
  });

  it('missing shuffle snapshot row → retry (never grades against live question_bank)', async () => {
    delete st.shuffleRows.q1;
    const outcome = await processDaily6Event(
      evt({ intent: 'd6_answer', args: { qIdx: '0', optIdx: '2' }, receivedAtMs: T0 + 20_000 }),
    );
    expect(outcome).toBe('retry');
    expect(rpcCallsOf('bkt_update')).toHaveLength(0);
    expect(st.sessionUpserts).toHaveLength(0);
  });

  // ── dev-5 (Phase-3 conformance, assessment's condition for approval) ──────
  // A tap on a STALE interactive list card — an older, already-superseded
  // question message; WhatsApp never disables previously-sent lists —
  // produces a genuinely NEW inbound event (a fresh event id), so it passes
  // the d6_last_event_id dedup guard above. The qIdx-vs-d6_index check must
  // catch it independently.
  describe('dev-5: stale-question-tap guard (qIdx must match the live d6_index)', () => {
    it('qIdx behind the live d6_index (tap on an OLDER already-answered question) is rejected: no grade, no bkt_update, no index advance, current question re-served', async () => {
      st.sessionRow = activeSession({
        d6_index: 2,
        d6_responses: FULL_RESPONSES.slice(0, 2),
      });
      const outcome = await processDaily6Event(
        evt({
          id: 'evt-stale-1',
          intent: 'd6_answer',
          // Opcode encodes qIdx=0 — the FIRST question's card, tapped late,
          // while the session has already moved on to index 2.
          args: { qIdx: '0', optIdx: '1' },
          receivedAtMs: T0 + 20_000,
        }),
      );
      expect(outcome).toBe('done');
      expect(rpcCallsOf('bkt_update')).toHaveLength(0);
      // The ONLY session write is the resume path's per-question serve-time
      // reset (context only) — d6_index/d6_responses are NEVER touched, i.e.
      // NOT graded and NOT advanced.
      expect(st.sessionUpserts).toHaveLength(1);
      expect(st.sessionUpserts[0].row).not.toHaveProperty('d6_index');
      expect(st.sessionUpserts[0].row).not.toHaveProperty('d6_responses');
      // Nudge, then the CURRENT question (index 2 = "Q3/6") re-served.
      expect(fetchState.calls).toHaveLength(2);
      expect(fetchState.calls[0].body.message.body).toContain('already moved on');
      expect(fetchState.calls[0].body.idempotency_key).toBe('d6:stale:evt-stale-1');
      expect(fetchState.calls[1].body.message.body).toContain('Q3/6');
    });

    it('qIdx ahead of the live d6_index (opcode from a not-yet-served future question — malformed/tampered) is also rejected the same way', async () => {
      st.sessionRow = activeSession({ d6_index: 0 });
      const outcome = await processDaily6Event(
        evt({ id: 'evt-stale-2', intent: 'd6_answer', args: { qIdx: '3', optIdx: '1' } }),
      );
      expect(outcome).toBe('done');
      expect(rpcCallsOf('bkt_update')).toHaveLength(0);
      expect(st.sessionUpserts).toHaveLength(1);
      expect(st.sessionUpserts[0].row).not.toHaveProperty('d6_index');
      expect(st.sessionUpserts[0].row).not.toHaveProperty('d6_responses');
      expect(fetchState.calls[1].body.message.body).toContain('Q1/6');
    });

    it('qIdx MATCHING the live d6_index still grades normally (regression — the guard does not block legitimate taps)', async () => {
      st.sessionRow = activeSession({ d6_index: 0 });
      const outcome = await processDaily6Event(
        evt({ intent: 'd6_answer', args: { qIdx: '0', optIdx: '2' }, receivedAtMs: T0 + 20_000 }),
      );
      expect(outcome).toBe('done');
      expect(rpcCallsOf('bkt_update')).toHaveLength(1);
      expect(st.sessionUpserts).toHaveLength(1);
      expect(st.sessionUpserts[0].row.d6_index).toBe(1);
      expect(fetchState.calls[0].body.message.body).toContain('✅ Correct!');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Resume / expiry (pin ii)
// ─────────────────────────────────────────────────────────────────────────────

describe('resume + expiry — partial sets are NEVER submitted', () => {
  it('(ii) same-IST-day resume re-serves the CURRENT question with a fresh timing anchor, no submit', async () => {
    st.sessionRow = activeSession({
      d6_index: 2,
      d6_responses: FULL_RESPONSES.slice(0, 2),
    });
    const outcome = await processDaily6Event(evt()); // d6_start
    expect(outcome).toBe('done');
    expect(rpcCallsOf('submit_quiz_results_v2')).toHaveLength(0);
    // d6_q_sent_at reset so timing reflects THIS serve.
    expect(st.sessionUpserts).toHaveLength(1);
    expect(st.sessionUpserts[0].row.context.d6_q_sent_at).not.toBe(new Date(T0).toISOString());
    expect(fetchState.calls[0].body.message.body).toContain('Q3/6');
    expect(fetchState.calls[0].body.idempotency_key).toBe('d6:q:qs-1:2:revt-1');
    // dev-5 opcode round-trip: the re-served 3rd question (0-based index 2)
    // stamps qIdx=2 on every option row — matching session.d6_index at serve
    // time, NOT a global/monotonic counter.
    expect(
      fetchState.calls[0].body.message.items.map((i: any) => i.id),
    ).toEqual(['d6:a:2:0', 'd6:a:2:1', 'd6:a:2:2', 'd6:a:2:3']);
  });

  it('(ii) NEW IST day with a PARTIAL set → abandoned WITHOUT submit_quiz_results_v2, then a fresh serve', async () => {
    st.sessionRow = activeSession({
      d6_date: '2020-01-01',
      d6_index: 3,
      d6_responses: FULL_RESPONSES.slice(0, 3),
    });
    st.rpcHandlers.get_practice_queue = [{ data: { queue: [] }, error: null }];
    st.rpcHandlers.select_quiz_questions_rag = [
      { data: null, error: { message: 'Access denied' } },
    ];

    const outcome = await processDaily6Event(evt()); // d6_start
    expect(outcome).toBe('done');

    // THE pin: the partial set never reaches the scoring RPC.
    expect(rpcCallsOf('submit_quiz_results_v2')).toHaveLength(0);

    // Abandon clears d6_* INCLUDING d6_date (the fresh day must not be gated)
    // and strips the stale idempotency key.
    const clear = st.sessionUpserts[0].row;
    expect(clear.state).toBe('idle');
    expect(clear.d6_date).toBeNull();
    expect(clear.d6_quiz_session_id).toBeNull();
    expect(clear.d6_responses).toEqual([]);
    expect(clear.context).not.toHaveProperty('d6_idempotency_key');

    // Bilingual expiry copy, then a fresh compose is attempted.
    expect(fetchState.calls[0].body.message.body).toContain("Yesterday's set expired");
    expect(rpcCallsOf('get_practice_queue').length).toBeGreaterThan(0);
  });

  it('(ii) expiry also triggers from a d6_answer on the stale day — the answer is NOT applied and nothing submits', async () => {
    st.sessionRow = activeSession({
      d6_date: '2020-01-01',
      d6_index: 3,
      d6_responses: FULL_RESPONSES.slice(0, 3),
    });
    st.rpcHandlers.get_practice_queue = [{ data: { queue: [] }, error: null }];
    st.rpcHandlers.select_quiz_questions_rag = [
      { data: null, error: { message: 'Access denied' } },
    ];

    await processDaily6Event(evt({ intent: 'd6_answer', args: { qIdx: '3', optIdx: '1' } }));
    expect(rpcCallsOf('submit_quiz_results_v2')).toHaveLength(0);
    expect(rpcCallsOf('bkt_update')).toHaveLength(0);
    expect(fetchState.calls[0].body.message.body).toContain("Yesterday's set expired");
  });

  it('new day but FULLY answered within 168h → submit still retries with the STORED idempotency key', async () => {
    st.sessionRow = activeSession({
      d6_date: '2020-01-01',
      d6_index: 6,
      d6_responses: structuredClone(FULL_RESPONSES),
      d6_served_at: new Date(Date.now() - 100 * 3_600_000).toISOString(), // 100h < 168h
    });
    await processDaily6Event(evt());
    const submits = rpcCallsOf('submit_quiz_results_v2');
    expect(submits).toHaveLength(1);
    expect(submits[0].args.p_idempotency_key).toBe('idem-1');
  });

  it('(vi) fresh compose after expiry does NOT inherit the prior set\'s d6_last_event_id replay guard', async () => {
    installComposeHandlers();
    st.sessionRow = activeSession({
      d6_date: '2020-01-01',
      d6_index: 3,
      d6_responses: FULL_RESPONSES.slice(0, 3),
      context: defaultContext({ d6_last_event_id: 'evt-yesterday' }),
    });

    const outcome = await processDaily6Event(evt()); // d6_start → expiry → fresh serve
    expect(outcome).toBe('done');

    // First upsert is the abandon/clear; the LAST is the fresh-compose serve.
    expect(st.sessionUpserts.length).toBeGreaterThanOrEqual(2);
    const freshRow = st.sessionUpserts[st.sessionUpserts.length - 1].row;
    expect(freshRow.state).toBe('daily6_active');
    expect(freshRow.context.d6_last_event_id).not.toBe('evt-yesterday');
    // eslint-disable-next-line no-eq-null, eqeqeq
    expect(freshRow.context.d6_last_event_id == null).toBe(true);
  });

  it('fully answered but BEYOND 168h → abandoned without submit (staleness cap)', async () => {
    st.sessionRow = activeSession({
      d6_date: '2020-01-01',
      d6_index: 6,
      d6_responses: structuredClone(FULL_RESPONSES),
      d6_served_at: new Date(Date.now() - 200 * 3_600_000).toISOString(), // > 168h
    });
    st.rpcHandlers.get_practice_queue = [{ data: { queue: [] }, error: null }];
    st.rpcHandlers.select_quiz_questions_rag = [
      { data: null, error: { message: 'Access denied' } },
    ];
    await processDaily6Event(evt());
    expect(rpcCallsOf('submit_quiz_results_v2')).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Submit + closing summary (pins i, iv, x, xi)
// ─────────────────────────────────────────────────────────────────────────────

describe('submitDaily6 — exact RPC mapping + RPC-verbatim summary', () => {
  beforeEach(() => {
    st.sessionRow = activeSession({
      d6_index: 6,
      d6_responses: structuredClone(FULL_RESPONSES),
    });
  });

  const answerEvt = (over: Partial<Daily6Event> = {}) =>
    evt({ intent: 'd6_answer', args: {}, ...over });

  it('(e)+(xi) exact submit mapping: verbatim responses, p_time = SUM(time_spent) — NOT wall-clock — grade STRING, stored key', async () => {
    await processDaily6Event(answerEvt());
    const submits = rpcCallsOf('submit_quiz_results_v2');
    expect(submits).toHaveLength(1);
    expect(submits[0].args).toEqual({
      p_session_id: 'qs-1',
      p_student_id: 'stu-1', // R6 chokepoint value ONLY
      p_subject: 'MATH',
      p_grade: '8',
      p_topic: null,
      p_chapter: null,
      p_responses: FULL_RESPONSES,
      p_time: 105, // 5+10+15+20+25+30
      p_idempotency_key: 'idem-1',
    });
    expect(typeof submits[0].args.p_grade).toBe('string'); // P5
  });

  it('(x) summary renders the RPC return VERBATIM: 5/6 with xp_earned=70 → "+70 XP"', async () => {
    st.rpcHandlers.submit_quiz_results_v2 = [
      {
        data: { total: 6, correct: 5, score_percent: 83, xp_earned: 70, flagged: false },
        error: null,
      },
    ];
    await processDaily6Event(answerEvt());
    const body = fetchState.calls[0].body;
    expect(body.message.body).toContain('🎯 5/6 correct · 83% · +70 XP');
    expect(body.message.body).toContain('🔥 Streak: 5 days');
    expect(body.idempotency_key).toBe('d6:sum:qs-1');
  });

  it('(h) mastery footer: majority node, compose-time before → post-bkt after, next review as IST weekday', async () => {
    st.masteryRow = {
      mastery_prob: 0.68,
      next_review_at: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    };
    await processDaily6Event(answerEvt());
    const text = fetchState.calls[0].body.message.body as string;
    // N1 has 4 of 6 questions → footer node; before=62 (d6_meta), after=68.
    expect(text).toContain('Fractions: 62% → 68%');
    expect(text).toMatch(/Next review: (Sun|Mon|Tue|Wed|Thu|Fri|Sat)/);
  });

  it('xp_capped from the RPC → the cap line is appended verbatim', async () => {
    st.rpcHandlers.submit_quiz_results_v2 = [
      {
        data: {
          total: 6,
          correct: 4,
          score_percent: 67,
          xp_earned: 40,
          xp_capped: true,
          flagged: false,
        },
        error: null,
      },
    ];
    await processDaily6Event(answerEvt());
    expect(fetchState.calls[0].body.message.body).toContain('+40 XP (daily XP limit reached)');
  });

  it('(i) FLAGGED (P3): xp 0, score still recorded via the RPC, flagged copy shown (EN)', async () => {
    st.rpcHandlers.submit_quiz_results_v2 = [
      {
        data: { total: 6, correct: 6, score_percent: 100, xp_earned: 0, flagged: true },
        error: null,
      },
    ];
    await processDaily6Event(answerEvt());
    // Score recorded: the RPC WAS called with the full response set.
    expect(rpcCallsOf('submit_quiz_results_v2')).toHaveLength(1);
    const text = fetchState.calls[0].body.message.body as string;
    expect(text).toContain('🎯 6/6 correct · 100%');
    expect(text).toContain('+0 XP — answered too fast to earn XP');
    expect(text).not.toContain('+130'); // no P2 payout on a flagged set
  });

  it('(i) flagged copy in Hindi for locale=hi (XP untranslated per P7)', async () => {
    activeStudent.locale = 'hi';
    st.rpcHandlers.submit_quiz_results_v2 = [
      {
        data: { total: 6, correct: 6, score_percent: 100, xp_earned: 0, flagged: true },
        error: null,
      },
    ];
    await processDaily6Event(answerEvt());
    const text = fetchState.calls[0].body.message.body as string;
    expect(text).toContain('+0 XP — XP के लिए थोड़ा धीरे सोचकर जवाब दो');
    expect(text).toContain('सही'); // "correct" translated
  });

  it('(c) post-submit clear KEEPS d6_date (the daily-gate marker) and strips every other d6_* key', async () => {
    await processDaily6Event(answerEvt());
    expect(st.sessionUpserts).toHaveLength(1);
    const row = st.sessionUpserts[0].row;
    expect(row.state).toBe('idle');
    expect(row.d6_date).toBe(TODAY); // KEPT — gates the rest of the day
    expect(row.d6_quiz_session_id).toBeNull();
    expect(row.d6_question_ids).toEqual([]);
    expect(row.d6_index).toBe(0);
    expect(row.d6_responses).toEqual([]);
    expect(row.d6_served_at).toBeNull();
    for (const key of [
      'd6_idempotency_key',
      'd6_q_sent_at',
      'd6_meta',
      'd6_questions',
      'd6_last_event_id',
    ]) {
      expect(row.context).not.toHaveProperty(key);
    }
  });

  it('submit RPC failure → retry, session NOT cleared (idempotency key survives for the next attempt)', async () => {
    st.rpcHandlers.submit_quiz_results_v2 = [
      { data: null, error: { message: 'transient' } },
    ];
    const outcome = await processDaily6Event(answerEvt());
    expect(outcome).toBe('retry');
    expect(st.sessionUpserts).toHaveLength(0);
    expect(fetchState.calls).toHaveLength(0);
  });

  it('(ii) defensive: response-count ≠ served-count NEVER submits — abandons instead of flagging', async () => {
    st.sessionRow = activeSession({
      d6_index: 6,
      d6_responses: structuredClone(FULL_RESPONSES.slice(0, 4)),
    });
    const outcome = await processDaily6Event(answerEvt());
    expect(outcome).toBe('done');
    expect(rpcCallsOf('submit_quiz_results_v2')).toHaveLength(0);
    expect(st.sessionUpserts[0].row.state).toBe('idle'); // cleared, not submitted
  });

  it('(iv) webhook-sourced sends sign with the byte-exact caller whatsapp-webhook-route', async () => {
    await processDaily6Event(answerEvt({ source: 'webhook' }));
    expect(signCalls.length).toBeGreaterThan(0);
    expect(signCalls.every((c) => c.caller === 'whatsapp-webhook-route')).toBe(true);
    expect(signCalls.every((c) => c.path === '/functions/v1/whatsapp-send')).toBe(true);
  });

  it('(iv) drain-sourced sends sign with the byte-exact caller whatsapp-drain-cron', async () => {
    await processDaily6Event(answerEvt({ source: 'drain' }));
    expect(signCalls.length).toBeGreaterThan(0);
    expect(signCalls.every((c) => c.caller === 'whatsapp-drain-cron')).toBe(true);
  });
});
