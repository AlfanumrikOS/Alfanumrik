/**
 * REG-271 (part c) — quiz_graded client→server STITCH + subject/grade facets.
 *
 * quiz_graded is the funnel's ACTIVATION anchor (retention cohorts anchor on
 * it). For the anchor to join the SAME PostHog person the browser identified,
 * its distinctId MUST be `hashDistinctId(authUserId)` — the hash of the AUTH
 * uid (auth.uid). Keying by `input.studentId` (= students.id) instead would
 * stitch the event to a PHANTOM person and the activation funnel would read a
 * false 0%. Wave 2 (commit 4e2288fa) fixed this and added subject/grade facets.
 *
 * Contract pinned here:
 *   - quiz_graded distinctId === hashDistinctId(authUserId), and is NOT studentId
 *     (guards against the phantom-person regression).
 *   - `subject` and `grade` are present on the payload; `grade` is a STRING (P5).
 *   - `$insert_id` dedup key stays SESSION-keyed (not distinctId-keyed).
 *   - No scoring / XP value is recomputed — the payload re-broadcasts the RPC's
 *     already-computed score_percent / xp_earned / correct / total verbatim
 *     (measurement-only; the RPC is authoritative).
 *
 * We mock the leaf side-effect modules and keep the REAL hashDistinctId (partial
 * mock via importOriginal) so the stitch assertion is against the true hash.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@alfanumrik/lib/ops-events', () => ({ logOpsEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const captureMock = vi.fn().mockResolvedValue(undefined);
// Keep the REAL hashDistinctId — the whole point of this suite is to assert the
// distinctId equals the TRUE hash of the auth uid.
vi.mock('@alfanumrik/lib/posthog/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alfanumrik/lib/posthog/server')>();
  return { ...actual, capture: (...a: unknown[]) => captureMock(...a) };
});

vi.mock('@alfanumrik/lib/state/events/publish', () => ({
  publishEvent: vi.fn().mockResolvedValue({ published: false, reason: 'flag_off' }),
}));
vi.mock('@alfanumrik/lib/state/quiz-orchestrator-bridge', () => ({
  maybeDispatchQuizCompletion: vi.fn().mockResolvedValue({ ranOrchestrator: false, publishedEventCount: 0 }),
}));

import {
  runQuizSubmitSideEffects,
  type QuizSubmitSideEffectInput,
  type QuizSubmitSideEffectResult,
} from '@alfanumrik/lib/quiz/submit-side-effects';
import { hashDistinctId } from '@alfanumrik/lib/posthog/server';

// AUTH uid (auth.uid) and the DISTINCT students.id — deliberately different, so
// a phantom-person regression (keying by studentId) is caught.
const AUTH_UID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const SESSION = '99999999-9999-4999-8999-999999999999';
const QUESTION = '44444444-4444-4444-8444-444444444444';

function adminStub() {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.maybeSingle = () => Promise.resolve({ data: { school_id: null } });
  return { from: () => chain } as never;
}

function baseInput(overrides: Partial<QuizSubmitSideEffectInput> = {}): QuizSubmitSideEffectInput {
  return {
    studentId: STUDENT_ID,
    sessionId: SESSION,
    subject: 'science',
    grade: '8',
    topic: 'motion',
    chapter: 3,
    totalTimeSeconds: 60,
    responses: [{ question_id: QUESTION, time_taken_seconds: 12 }],
    ...overrides,
  };
}

const freshResult: QuizSubmitSideEffectResult = {
  session_id: SESSION,
  total: 10,
  correct: 8,
  score_percent: 80,
  xp_earned: 100,
  flagged: false,
  idempotent_replay: false,
};

/** The single quiz_graded capture() call (event name === 'quiz_graded'). */
function quizGradedCall() {
  const call = captureMock.mock.calls.find((c) => c[0] === 'quiz_graded');
  if (!call) throw new Error('quiz_graded was not captured');
  return {
    event: call[0] as string,
    distinctId: call[1] as string,
    payload: call[2] as Record<string, unknown>,
    insertId: call[3] as string,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  captureMock.mockResolvedValue(undefined);
});

describe('REG-271c — quiz_graded stitches to the AUTH uid, not students.id', () => {
  it('distinctId === hashDistinctId(authUserId) and is NOT studentId', () => {
    runQuizSubmitSideEffects(adminStub(), AUTH_UID, baseInput(), freshResult);
    const { distinctId } = quizGradedCall();

    expect(distinctId).toBe(hashDistinctId(AUTH_UID));
    expect(distinctId).toMatch(/^[0-9a-f]{16}$/);
    // Phantom-person guard: NEVER the raw studentId, and NEVER a hash of it.
    expect(distinctId).not.toBe(STUDENT_ID);
    expect(distinctId).not.toBe(hashDistinctId(STUDENT_ID));
  });

  it('does not leak the raw auth uid or student id into the payload', () => {
    runQuizSubmitSideEffects(adminStub(), AUTH_UID, baseInput(), freshResult);
    const { payload } = quizGradedCall();
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain(AUTH_UID);
    expect(serialized).not.toContain(STUDENT_ID);
  });
});

describe('REG-271c — subject + grade facets present, grade is a STRING (P5)', () => {
  it('subject and grade are on the payload', () => {
    runQuizSubmitSideEffects(adminStub(), AUTH_UID, baseInput({ subject: 'math', grade: '11' }), freshResult);
    const { payload } = quizGradedCall();
    expect(payload.subject).toBe('math');
    expect(payload.grade).toBe('11');
    expect(typeof payload.grade).toBe('string'); // P5 — never coerced to a number
  });

  it('grade "12" stays the string "12" (not 12)', () => {
    runQuizSubmitSideEffects(adminStub(), AUTH_UID, baseInput({ grade: '12' }), freshResult);
    const { payload } = quizGradedCall();
    expect(payload.grade).toBe('12');
    expect(payload.grade).not.toBe(12);
  });
});

describe('REG-271c — $insert_id stays session-keyed (dedup unchanged)', () => {
  it('insert_id is keyed by session, not by distinctId', () => {
    runQuizSubmitSideEffects(adminStub(), AUTH_UID, baseInput(), freshResult);
    const { insertId, distinctId } = quizGradedCall();
    expect(insertId).toBe(`quiz_graded:${SESSION}`);
    expect(insertId).not.toContain(distinctId);
  });
});

describe('REG-271c — measurement only: no scoring/XP recompute', () => {
  it('re-broadcasts the RPC score/xp/correct/total verbatim', () => {
    const rpc: QuizSubmitSideEffectResult = {
      ...freshResult,
      // Deliberately "wrong" values relative to any formula — the side-effect
      // must echo the RPC, never recompute. 7/10 would be 70% under P1, but the
      // RPC is authoritative and says 80%.
      total: 10,
      correct: 7,
      score_percent: 80,
      xp_earned: 137,
    };
    runQuizSubmitSideEffects(adminStub(), AUTH_UID, baseInput(), rpc);
    const { payload } = quizGradedCall();
    expect(payload.score_percent).toBe(80);
    expect(payload.xp_earned).toBe(137);
    expect(payload.correct).toBe(7);
    expect(payload.total).toBe(10);
    expect(payload.idempotent_replay).toBe(false);
  });

  it('idempotent replay short-circuits — no quiz_graded emitted', () => {
    runQuizSubmitSideEffects(adminStub(), AUTH_UID, baseInput(), { ...freshResult, idempotent_replay: true });
    expect(captureMock.mock.calls.some((c) => c[0] === 'quiz_graded')).toBe(false);
  });
});
