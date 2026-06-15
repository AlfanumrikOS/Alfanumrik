import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Unit tests for the post-submit quiz learning telemetry (SPEC-1..5).
 *
 * Under test:
 *   - prepareQuizTelemetry()         (PRE-RPC: topic resolution + pre-mastery read)
 *   - runQuizPostSubmitTelemetry()   (POST-RPC: per-answer + mastery-achieved events)
 * Both in src/lib/quiz/post-submit-telemetry.ts.
 *
 * House mocking style (see src/__tests__/api/foxy/*.test.ts +
 * src/__tests__/monitoring/*): collaborators mocked at the module boundary via
 * thin pass-through fns over vi.fn() spies.
 *
 *   - @/lib/monitoring/log-event   → logLearningEvent / logSystemMetric /
 *                                    generateCorrelationId (the telemetry WRITE
 *                                    + correlation-id surface). This is what the
 *                                    module imports directly.
 *   - @/lib/feature-flags          → isFeatureEnabled (the master flag gate that
 *                                    the ROUTE consults before capturing the
 *                                    pre-snapshot — modelled here so the flag-OFF
 *                                    scenario reproduces the route's behavior).
 *   - @/lib/supabase-admin         → a chained builder used for question_bank +
 *                                    concept_mastery READS and intervention_alerts
 *                                    OPS. The module reads/writes through the
 *                                    `admin` client PASSED BY THE CALLER, so the
 *                                    tests pass that same chained-builder instance
 *                                    in directly (and also register the module mock
 *                                    so an accidental module-level `supabaseAdmin`
 *                                    use would be caught, not hit the network).
 *
 * DUAL-ID CONTRACT (asserted): concept_mastery READS key on students.id;
 * learning_events WRITES key on auth.uid(). These must never be conflated.
 */

// ─── @/lib/monitoring/log-event ──────────────────────────────────────────────
// The telemetry module imports logLearningEvent + generateCorrelationId from
// here. generateCorrelationId is stubbed deterministically so SPEC-1's shared
// correlation_id is assertable.
const _logLearningEvent = vi.fn().mockResolvedValue(undefined);
const _logSystemMetric = vi.fn().mockResolvedValue(undefined);
const FIXED_CORRELATION_ID = 'corr-fixed-001';
vi.mock('@/lib/monitoring/log-event', () => ({
  logLearningEvent: (...args: unknown[]) => _logLearningEvent(...args),
  logSystemMetric: (...args: unknown[]) => _logSystemMetric(...args),
  generateCorrelationId: () => FIXED_CORRELATION_ID,
  generateSessionId: () => 'session-generated',
}));

// ─── @/lib/feature-flags ─────────────────────────────────────────────────────
const _isFeatureEnabled = vi.fn();
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => _isFeatureEnabled(...args),
  QUIZ_TELEMETRY_FLAGS: { V1: 'ff_quiz_telemetry_v1' },
}));

// ─── @/lib/supabase-admin (chained builder) ──────────────────────────────────
// Records every table touched + every terminal op so the dual-id + SPEC-3-inert
// assertions can inspect what the code asked the client to do. The builder is a
// thenable so `await admin.from('x').select(...).eq(...).in(...)` resolves.
//
// Per-table read data is injected via `cmReadData` (concept_mastery) and
// `qbReadData` (question_bank) so each test controls the pre/post mastery + the
// topic map without rebuilding the mock.

interface BuilderCall {
  table: string;
  op: 'select' | 'insert' | 'update' | 'delete' | 'upsert';
  eqArgs: Array<[string, unknown]>;
  inArgs: Array<[string, unknown]>;
  insertPayload?: unknown;
}

let builderCalls: BuilderCall[] = [];
let qbReadData: Array<{ id: string; topic_id: string | null }> = [];
// concept_mastery responses are FIFO: first read = pre, second read = post.
let cmReadQueue: Array<Array<{ topic_id: string; mastery_level: unknown }>> = [];

function makeBuilder(table: string) {
  // For concept_mastery, dequeue the next queued read (pre then post).
  const call: BuilderCall = { table, op: 'select', eqArgs: [], inArgs: [] };
  builderCalls.push(call);

  const resolveData = (): { data: unknown; error: null } => {
    if (table === 'question_bank') return { data: qbReadData, error: null };
    if (table === 'concept_mastery') {
      const next = cmReadQueue.shift() ?? [];
      return { data: next, error: null };
    }
    return { data: [], error: null };
  };

  const builder: Record<string, unknown> = {};
  builder.select = (..._a: unknown[]) => {
    call.op = 'select';
    return builder;
  };
  builder.insert = (payload: unknown) => {
    call.op = 'insert';
    call.insertPayload = payload;
    return builder;
  };
  builder.update = (payload: unknown) => {
    call.op = 'update';
    call.insertPayload = payload;
    return builder;
  };
  builder.delete = () => {
    call.op = 'delete';
    return builder;
  };
  builder.eq = (col: string, val: unknown) => {
    call.eqArgs.push([col, val]);
    return builder;
  };
  builder.in = (col: string, val: unknown) => {
    call.inArgs.push([col, val]);
    return builder;
  };
  builder.is = () => builder;
  builder.maybeSingle = () => Promise.resolve(resolveData());
  builder.single = () => Promise.resolve(resolveData());
  (builder as { then: unknown }).then = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise.resolve(resolveData()).then(resolve, reject);
  return builder;
}

const mockAdmin = { from: (table: string) => makeBuilder(table) } as unknown as import('@supabase/supabase-js').SupabaseClient;

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (table: string) => makeBuilder(table) },
  getSupabaseAdmin: () => ({ from: (table: string) => makeBuilder(table) }),
}));

// Import AFTER the mocks are registered.
import {
  prepareQuizTelemetry,
  runQuizPostSubmitTelemetry,
  type QuizTelemetryPre,
  type QuizTelemetryInput,
} from '@/lib/quiz/post-submit-telemetry';
import { isFeatureEnabled, QUIZ_TELEMETRY_FLAGS } from '@/lib/feature-flags';

const AUTH_UID = 'auth-uid-7f3';
const STUDENT_ID = 'student-row-123';

/** Flush the fire-and-forget `void (async () => {...})()` IIFE microtasks. */
async function flush(): Promise<void> {
  // A couple of macro/microtask turns is enough for the awaited chain inside
  // runQuizPostSubmitTelemetry to settle.
  await new Promise((r) => setTimeout(r, 0));
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

/** Convenience: just the logLearningEvent payloads of a given event_type. */
function eventsOfType(type: string): Array<Record<string, unknown>> {
  return _logLearningEvent.mock.calls
    .map((c) => c[0] as Record<string, unknown>)
    .filter((e) => e.event_type === type);
}

beforeEach(() => {
  vi.clearAllMocks();
  builderCalls = [];
  qbReadData = [];
  cmReadQueue = [];
  _isFeatureEnabled.mockResolvedValue(true);
});

// ─────────────────────────────────────────────────────────────────────────────
// SPEC-1 — one quiz_attempt event per graded question
// ─────────────────────────────────────────────────────────────────────────────

describe('SPEC-1 — per-question quiz_attempt events', () => {
  function basePre(): QuizTelemetryPre {
    return {
      topicIdByQuestionId: { q1: 'topic-A', q2: null },
      preMasteryByTopicId: { 'topic-A': 0.2 },
      correlationId: FIXED_CORRELATION_ID,
    };
  }

  function baseInput(): QuizTelemetryInput {
    return {
      studentId: STUDENT_ID,
      sessionId: 'rpc-session-999',
      subject: 'math',
      grade: '7',
      chapter: 3,
      responses: [
        { question_id: 'q1', time_taken_seconds: 4.2 },
        { question_id: 'q2', time_taken_seconds: null },
      ],
      gradedQuestions: [
        { question_id: 'q1', is_correct: true },
        { question_id: 'q2', is_correct: false },
      ],
    };
  }

  it('fires exactly 2 quiz_attempt events for a 2-question result', async () => {
    runQuizPostSubmitTelemetry(mockAdmin, AUTH_UID, baseInput(), basePre());
    await flush();
    expect(eventsOfType('quiz_attempt')).toHaveLength(2);
  });

  it('each event uses the AUTH uid as student_id (NOT students.id)', async () => {
    runQuizPostSubmitTelemetry(mockAdmin, AUTH_UID, baseInput(), basePre());
    await flush();
    for (const e of eventsOfType('quiz_attempt')) {
      expect(e.student_id).toBe(AUTH_UID);
      expect(e.student_id).not.toBe(STUDENT_ID);
    }
  });

  it('each event carries the session_id from the RPC result', async () => {
    runQuizPostSubmitTelemetry(mockAdmin, AUTH_UID, baseInput(), basePre());
    await flush();
    for (const e of eventsOfType('quiz_attempt')) {
      expect(e.session_id).toBe('rpc-session-999');
    }
  });

  it('topic_id comes from the question_bank map (null when unmapped)', async () => {
    runQuizPostSubmitTelemetry(mockAdmin, AUTH_UID, baseInput(), basePre());
    await flush();
    const byQ = new Map(
      eventsOfType('quiz_attempt').map((e) => [e.question_id, e.topic_id]),
    );
    expect(byQ.get('q1')).toBe('topic-A');
    expect(byQ.get('q2')).toBeNull();
  });

  it('verb/object_type and per-question is_correct mirror the RPC questions[]', async () => {
    runQuizPostSubmitTelemetry(mockAdmin, AUTH_UID, baseInput(), basePre());
    await flush();
    const byQ = new Map(
      eventsOfType('quiz_attempt').map((e) => [e.question_id, e]),
    );
    for (const e of eventsOfType('quiz_attempt')) {
      expect(e.verb).toBe('answered');
      expect(e.object_type).toBe('question');
    }
    expect((byQ.get('q1')!.result as { is_correct: boolean }).is_correct).toBe(true);
    expect((byQ.get('q2')!.result as { is_correct: boolean }).is_correct).toBe(false);
  });

  it('result.time_ms = round(time_taken_seconds * 1000), null when time missing', async () => {
    runQuizPostSubmitTelemetry(mockAdmin, AUTH_UID, baseInput(), basePre());
    await flush();
    const byQ = new Map(
      eventsOfType('quiz_attempt').map((e) => [e.question_id, e]),
    );
    // 4.2s → 4200ms
    expect((byQ.get('q1')!.result as { time_ms: number | null }).time_ms).toBe(4200);
    // null seconds → null ms (never NaN, never 0)
    expect((byQ.get('q2')!.result as { time_ms: number | null }).time_ms).toBeNull();
  });

  it('all events share one correlation_id', async () => {
    runQuizPostSubmitTelemetry(mockAdmin, AUTH_UID, baseInput(), basePre());
    await flush();
    const ids = eventsOfType('quiz_attempt').map(
      (e) => (e.context as { correlation_id: string }).correlation_id,
    );
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBe(FIXED_CORRELATION_ID);
  });

  it('question_id is present on every event', async () => {
    runQuizPostSubmitTelemetry(mockAdmin, AUTH_UID, baseInput(), basePre());
    await flush();
    const qids = eventsOfType('quiz_attempt').map((e) => e.question_id).sort();
    expect(qids).toEqual(['q1', 'q2']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SPEC-2 — mastery-achieved events (pre < 0.8 AND post >= 0.8)
// ─────────────────────────────────────────────────────────────────────────────

describe('SPEC-2 — mastery_updated emitted only on a fresh threshold crossing', () => {
  function preForTopic(topicId: string, preMastery: number): QuizTelemetryPre {
    return {
      topicIdByQuestionId: { q1: topicId },
      preMasteryByTopicId: { [topicId]: preMastery },
      correlationId: FIXED_CORRELATION_ID,
    };
  }

  function inputForTopic(): QuizTelemetryInput {
    return {
      studentId: STUDENT_ID,
      sessionId: 'rpc-session-mastery',
      subject: 'science',
      grade: '8',
      chapter: 1,
      responses: [{ question_id: 'q1', time_taken_seconds: 5 }],
      gradedQuestions: [{ question_id: 'q1', is_correct: true }],
    };
  }

  it('POSITIVE: pre 0.5 / post 0.85 → exactly one mastery_updated with pre/post/threshold', async () => {
    cmReadQueue = [[{ topic_id: 'topic-X', mastery_level: '0.85' }]]; // post-read
    runQuizPostSubmitTelemetry(
      mockAdmin,
      AUTH_UID,
      inputForTopic(),
      preForTopic('topic-X', 0.5),
    );
    await flush();
    const masteryEvents = eventsOfType('mastery_updated');
    expect(masteryEvents).toHaveLength(1);
    const ev = masteryEvents[0];
    expect(ev.student_id).toBe(AUTH_UID);
    expect(ev.topic_id).toBe('topic-X');
    expect(ev.verb).toBe('achieved');
    expect(ev.object_type).toBe('topic');
    expect(ev.result).toMatchObject({
      pre_mastery: 0.5,
      post_mastery: 0.85,
      threshold: 0.8,
    });
  });

  it('NEGATIVE (already mastered): pre 0.85 / post 0.9 → NO mastery_updated', async () => {
    cmReadQueue = [[{ topic_id: 'topic-Y', mastery_level: '0.9' }]];
    runQuizPostSubmitTelemetry(
      mockAdmin,
      AUTH_UID,
      inputForTopic(),
      preForTopic('topic-Y', 0.85),
    );
    await flush();
    expect(eventsOfType('mastery_updated')).toHaveLength(0);
  });

  it('NEGATIVE (never crossed): pre 0.3 / post 0.5 → NO mastery_updated', async () => {
    cmReadQueue = [[{ topic_id: 'topic-Z', mastery_level: '0.5' }]];
    runQuizPostSubmitTelemetry(
      mockAdmin,
      AUTH_UID,
      inputForTopic(),
      preForTopic('topic-Z', 0.3),
    );
    await flush();
    expect(eventsOfType('mastery_updated')).toHaveLength(0);
  });

  it('BOUNDARY: pre 0.79 / post exactly 0.8 → crosses (>= threshold) → one event', async () => {
    cmReadQueue = [[{ topic_id: 'topic-B', mastery_level: '0.8' }]];
    runQuizPostSubmitTelemetry(
      mockAdmin,
      AUTH_UID,
      inputForTopic(),
      preForTopic('topic-B', 0.79),
    );
    await flush();
    expect(eventsOfType('mastery_updated')).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SPEC-2 cast guard — non-numeric mastery_level → parseFloat NaN → 0.0
// ─────────────────────────────────────────────────────────────────────────────

describe('SPEC-2 cast guard — non-numeric mastery does not throw and reads as 0.0', () => {
  it("post mastery 'not_started' → treated as 0.0 → no mastery_updated, no throw", async () => {
    cmReadQueue = [[{ topic_id: 'topic-S', mastery_level: 'not_started' }]];
    const pre: QuizTelemetryPre = {
      topicIdByQuestionId: { q1: 'topic-S' },
      preMasteryByTopicId: { 'topic-S': 0.0 },
      correlationId: FIXED_CORRELATION_ID,
    };
    const input: QuizTelemetryInput = {
      studentId: STUDENT_ID,
      sessionId: 'rpc-session-cast',
      responses: [{ question_id: 'q1', time_taken_seconds: 3 }],
      gradedQuestions: [{ question_id: 'q1', is_correct: false }],
    };
    expect(() =>
      runQuizPostSubmitTelemetry(mockAdmin, AUTH_UID, input, pre),
    ).not.toThrow();
    await flush();
    // 0.0 (pre) < 0.8 but post 0.0 < 0.8 → not crossed → no event.
    expect(eventsOfType('mastery_updated')).toHaveLength(0);
    // The per-question event still fired (cast guard didn't break the flow).
    expect(eventsOfType('quiz_attempt')).toHaveLength(1);
  });

  it("pre 'not_started' → 0.0, post '0.82' → CROSSES → one mastery_updated", async () => {
    cmReadQueue = [[{ topic_id: 'topic-T', mastery_level: '0.82' }]];
    const pre: QuizTelemetryPre = {
      // prepareQuizTelemetry would already have coerced this to 0.0; model that.
      topicIdByQuestionId: { q1: 'topic-T' },
      preMasteryByTopicId: { 'topic-T': 0.0 },
      correlationId: FIXED_CORRELATION_ID,
    };
    const input: QuizTelemetryInput = {
      studentId: STUDENT_ID,
      sessionId: 'rpc-session-cast2',
      responses: [{ question_id: 'q1', time_taken_seconds: 3 }],
      gradedQuestions: [{ question_id: 'q1', is_correct: true }],
    };
    runQuizPostSubmitTelemetry(mockAdmin, AUTH_UID, input, pre);
    await flush();
    const ev = eventsOfType('mastery_updated');
    expect(ev).toHaveLength(1);
    expect((ev[0].result as { pre_mastery: number }).pre_mastery).toBe(0.0);
    expect((ev[0].result as { post_mastery: number }).post_mastery).toBe(0.82);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SPEC-2 cast guard at the PRE-read layer (prepareQuizTelemetry)
// ─────────────────────────────────────────────────────────────────────────────

describe('prepareQuizTelemetry — pre-read coercion + dual-id READ key', () => {
  it("coerces a non-numeric pre mastery_level to 0.0 (parseFloat NaN guard)", async () => {
    qbReadData = [{ id: 'q1', topic_id: 'topic-P' }];
    cmReadQueue = [[{ topic_id: 'topic-P', mastery_level: 'not_started' }]]; // pre-read
    const pre = await prepareQuizTelemetry(mockAdmin, STUDENT_ID, ['q1']);
    expect(pre.preMasteryByTopicId['topic-P']).toBe(0.0);
    expect(pre.topicIdByQuestionId.q1).toBe('topic-P');
    expect(pre.correlationId).toBe(FIXED_CORRELATION_ID);
  });

  it('concept_mastery pre-read is keyed by students.id (NOT auth.uid)', async () => {
    qbReadData = [{ id: 'q1', topic_id: 'topic-P' }];
    cmReadQueue = [[{ topic_id: 'topic-P', mastery_level: '0.4' }]];
    await prepareQuizTelemetry(mockAdmin, STUDENT_ID, ['q1']);
    const cmRead = builderCalls.find((c) => c.table === 'concept_mastery');
    expect(cmRead).toBeDefined();
    const studentEq = cmRead!.eqArgs.find(([col]) => col === 'student_id');
    expect(studentEq).toEqual(['student_id', STUDENT_ID]);
    // never the auth uid on the READ key
    expect(studentEq![1]).not.toBe(AUTH_UID);
  });

  it('topics with no concept_mastery row default to pre-mastery 0.0', async () => {
    qbReadData = [{ id: 'q1', topic_id: 'topic-P' }];
    cmReadQueue = [[]]; // no row for topic-P
    const pre = await prepareQuizTelemetry(mockAdmin, STUDENT_ID, ['q1']);
    expect(pre.preMasteryByTopicId['topic-P']).toBe(0.0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flag OFF — the route consults the flag; OFF → no pre-snapshot → no telemetry
// ─────────────────────────────────────────────────────────────────────────────

describe('Flag OFF — ff_quiz_telemetry_v1 disabled → no telemetry at all', () => {
  it('isFeatureEnabled(false) gates the route from ever calling prepareQuizTelemetry', async () => {
    _isFeatureEnabled.mockResolvedValue(false);
    // Reproduce the route's gate: only prepare when the flag is enabled.
    const enabled = await isFeatureEnabled(QUIZ_TELEMETRY_FLAGS.V1, {
      userId: AUTH_UID,
    });
    let pre: QuizTelemetryPre | undefined;
    if (enabled) {
      pre = await prepareQuizTelemetry(mockAdmin, STUDENT_ID, ['q1']);
    }
    // Flag OFF → no snapshot captured → no question_bank/concept_mastery reads.
    expect(enabled).toBe(false);
    expect(pre).toBeUndefined();
    expect(builderCalls).toHaveLength(0);
    expect(_logLearningEvent).not.toHaveBeenCalled();
  });

  it('the side-effects telemetry step is a no-op when telemetryPre is undefined', async () => {
    // Mirror submit-side-effects.ts: `if (input.telemetryPre) runQuiz...`.
    const telemetryPre: QuizTelemetryPre | undefined = undefined;
    if (telemetryPre) {
      runQuizPostSubmitTelemetry(mockAdmin, AUTH_UID, {
        studentId: STUDENT_ID,
        sessionId: 's',
        responses: [],
        gradedQuestions: [],
      }, telemetryPre);
    }
    await flush();
    expect(_logLearningEvent).not.toHaveBeenCalled();
    expect(builderCalls).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SPEC-5 — idempotent replay / duplicate / error → telemetry skipped entirely
// ─────────────────────────────────────────────────────────────────────────────

describe('SPEC-5 — idempotent replay / error short-circuits telemetry', () => {
  // The submit-side-effects guard short-circuits BEFORE runQuizPostSubmitTelemetry
  // on an idempotent replay. We model that guard exactly: the telemetry block is
  // only reached on a FRESH grade.
  function sideEffectGuardedTelemetry(opts: {
    idempotentReplay: boolean;
    telemetryPre?: QuizTelemetryPre;
  }) {
    // GUARD (mirrors runQuizSubmitSideEffects): replay short-circuits the whole
    // block, so the telemetry step never runs.
    if (opts.idempotentReplay) return;
    if (opts.telemetryPre) {
      runQuizPostSubmitTelemetry(
        mockAdmin,
        AUTH_UID,
        {
          studentId: STUDENT_ID,
          sessionId: 'rpc-session',
          responses: [{ question_id: 'q1', time_taken_seconds: 4 }],
          gradedQuestions: [{ question_id: 'q1', is_correct: true }],
        },
        opts.telemetryPre,
      );
    }
  }

  const freshPre: QuizTelemetryPre = {
    topicIdByQuestionId: { q1: 'topic-A' },
    preMasteryByTopicId: { 'topic-A': 0.2 },
    correlationId: FIXED_CORRELATION_ID,
  };

  it('idempotent replay → no telemetry (even though a pre-snapshot was passed)', async () => {
    sideEffectGuardedTelemetry({ idempotentReplay: true, telemetryPre: freshPre });
    await flush();
    expect(_logLearningEvent).not.toHaveBeenCalled();
    expect(builderCalls).toHaveLength(0);
  });

  it('fresh grade → telemetry DOES fire (control for the replay case)', async () => {
    sideEffectGuardedTelemetry({ idempotentReplay: false, telemetryPre: freshPre });
    await flush();
    expect(_logLearningEvent).toHaveBeenCalled();
    expect(eventsOfType('quiz_attempt')).toHaveLength(1);
  });

  it('errored submit (no pre-snapshot threaded) → telemetry skipped', async () => {
    // On the 503/error path the route never threads telemetryPre.
    sideEffectGuardedTelemetry({ idempotentReplay: false, telemetryPre: undefined });
    await flush();
    expect(_logLearningEvent).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dual-id — READS use students.id, WRITES use auth.uid()
// ─────────────────────────────────────────────────────────────────────────────

describe('Dual-id contract — concept_mastery READ on students.id, learning_events WRITE on auth.uid', () => {
  it('post-read concept_mastery filters on input.studentId (students.id), never auth.uid', async () => {
    cmReadQueue = [[{ topic_id: 'topic-A', mastery_level: '0.85' }]]; // post-read
    const pre: QuizTelemetryPre = {
      topicIdByQuestionId: { q1: 'topic-A' },
      preMasteryByTopicId: { 'topic-A': 0.2 },
      correlationId: FIXED_CORRELATION_ID,
    };
    runQuizPostSubmitTelemetry(
      mockAdmin,
      AUTH_UID,
      {
        studentId: STUDENT_ID,
        sessionId: 'rpc-session',
        responses: [{ question_id: 'q1', time_taken_seconds: 4 }],
        gradedQuestions: [{ question_id: 'q1', is_correct: true }],
      },
      pre,
    );
    await flush();

    const cmRead = builderCalls.find((c) => c.table === 'concept_mastery');
    expect(cmRead).toBeDefined();
    const studentEq = cmRead!.eqArgs.find(([col]) => col === 'student_id');
    expect(studentEq).toEqual(['student_id', STUDENT_ID]);
    expect(studentEq![1]).not.toBe(AUTH_UID);
  });

  it('every learning_events WRITE carries student_id = auth.uid (never students.id)', async () => {
    cmReadQueue = [[{ topic_id: 'topic-A', mastery_level: '0.85' }]];
    const pre: QuizTelemetryPre = {
      topicIdByQuestionId: { q1: 'topic-A' },
      preMasteryByTopicId: { 'topic-A': 0.2 },
      correlationId: FIXED_CORRELATION_ID,
    };
    runQuizPostSubmitTelemetry(
      mockAdmin,
      AUTH_UID,
      {
        studentId: STUDENT_ID,
        sessionId: 'rpc-session',
        responses: [{ question_id: 'q1', time_taken_seconds: 4 }],
        gradedQuestions: [{ question_id: 'q1', is_correct: true }],
      },
      pre,
    );
    await flush();

    const allEvents = _logLearningEvent.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(allEvents.length).toBeGreaterThan(0);
    for (const e of allEvents) {
      expect(e.student_id).toBe(AUTH_UID);
      expect(e.student_id).not.toBe(STUDENT_ID);
    }
    // Both event kinds present (quiz_attempt + mastery_updated), both auth.uid-keyed.
    expect(eventsOfType('quiz_attempt')).toHaveLength(1);
    expect(eventsOfType('mastery_updated')).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SPEC-3 deferred — no intervention_alerts insert, no adaptive_mastery query
// ─────────────────────────────────────────────────────────────────────────────

describe('SPEC-3 deferred — the consecutive-wrong intervention path is inert', () => {
  function manyWrongInput(): QuizTelemetryInput {
    // 4 wrong answers in a row — would trip CONSECUTIVE_WRONG_THRESHOLD (3) if
    // the deferred path were active. It must NOT be.
    return {
      studentId: STUDENT_ID,
      sessionId: 'rpc-session-wrong',
      subject: 'math',
      grade: '6',
      chapter: 2,
      responses: [
        { question_id: 'q1', time_taken_seconds: 4 },
        { question_id: 'q2', time_taken_seconds: 4 },
        { question_id: 'q3', time_taken_seconds: 4 },
        { question_id: 'q4', time_taken_seconds: 4 },
      ],
      gradedQuestions: [
        { question_id: 'q1', is_correct: false },
        { question_id: 'q2', is_correct: false },
        { question_id: 'q3', is_correct: false },
        { question_id: 'q4', is_correct: false },
      ],
    };
  }

  function pre4(): QuizTelemetryPre {
    return {
      topicIdByQuestionId: { q1: 'topic-A', q2: 'topic-A', q3: 'topic-A', q4: 'topic-A' },
      preMasteryByTopicId: { 'topic-A': 0.1 },
      correlationId: FIXED_CORRELATION_ID,
    };
  }

  it('NO intervention_alerts insert occurs (deferred / mis-attribution-safe)', async () => {
    cmReadQueue = [[{ topic_id: 'topic-A', mastery_level: '0.1' }]];
    runQuizPostSubmitTelemetry(mockAdmin, AUTH_UID, manyWrongInput(), pre4());
    await flush();
    const alertOps = builderCalls.filter((c) => c.table === 'intervention_alerts');
    expect(alertOps).toHaveLength(0);
  });

  it('NO adaptive_mastery query occurs (no topic_id mis-attribution attempt)', async () => {
    cmReadQueue = [[{ topic_id: 'topic-A', mastery_level: '0.1' }]];
    runQuizPostSubmitTelemetry(mockAdmin, AUTH_UID, manyWrongInput(), pre4());
    await flush();
    const adaptiveOps = builderCalls.filter((c) => c.table === 'adaptive_mastery');
    expect(adaptiveOps).toHaveLength(0);
  });

  it('the only tables touched post-submit are concept_mastery reads (no writes to any table)', async () => {
    cmReadQueue = [[{ topic_id: 'topic-A', mastery_level: '0.1' }]];
    runQuizPostSubmitTelemetry(mockAdmin, AUTH_UID, manyWrongInput(), pre4());
    await flush();
    // No insert/update/delete/upsert to ANY table from the telemetry module.
    const writes = builderCalls.filter((c) => c.op !== 'select');
    expect(writes).toHaveLength(0);
    // Only concept_mastery was read (the post-mastery comparison).
    const tablesTouched = [...new Set(builderCalls.map((c) => c.table))];
    expect(tablesTouched).toEqual(['concept_mastery']);
  });
});
