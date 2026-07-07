/**
 * Unit tests for the OFFLINE-SYNC telemetry path in runQuizSubmitSideEffects
 * (Wave 2.5.3). The offline-sync ops-event MUST fire BEFORE the
 * idempotent_replay early-return (it measures replays), and MUST NOT fire at
 * all on the online path (no offlineMeta) — preserving byte-identical online
 * behavior. METADATA ONLY (P13).
 *
 * We mock the leaf modules (logOpsEvent, posthog, publishEvent, orchestrator
 * bridge) and call runQuizSubmitSideEffects directly so we can assert ordering
 * and the exact event envelope.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const logOpsEventMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@alfanumrik/lib/ops-events', () => ({ logOpsEvent: (...a: unknown[]) => logOpsEventMock(...a) }));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const posthogCaptureMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@alfanumrik/lib/posthog/server', () => ({
  capture: (...a: unknown[]) => posthogCaptureMock(...a),
}));

const publishEventMock = vi.fn().mockResolvedValue({ published: false, reason: 'flag_off' });
vi.mock('@alfanumrik/lib/state/events/publish', () => ({
  publishEvent: (...a: unknown[]) => publishEventMock(...a),
}));

const maybeDispatchMock = vi
  .fn()
  .mockResolvedValue({ ranOrchestrator: false, publishedEventCount: 0 });
vi.mock('@alfanumrik/lib/state/quiz-orchestrator-bridge', () => ({
  maybeDispatchQuizCompletion: (...a: unknown[]) => maybeDispatchMock(...a),
}));

// bktUpdate is a pure helper used by computeMasteryDeltas — leave it real.

import {
  runQuizSubmitSideEffects,
  type QuizSubmitSideEffectInput,
  type QuizSubmitSideEffectResult,
} from '@alfanumrik/lib/quiz/submit-side-effects';

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

const STUDENT = '11111111-1111-4111-8111-111111111111';
const SESSION = '33333333-3333-4333-8333-333333333333';
const QUESTION = '44444444-4444-4444-8444-444444444444';

// Minimal admin stub — only resolveTenantIdForStudent reads students.school_id.
function adminStub() {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.maybeSingle = () => Promise.resolve({ data: { school_id: null } });
  return { from: () => chain } as never;
}

function baseInput(overrides: Partial<QuizSubmitSideEffectInput> = {}): QuizSubmitSideEffectInput {
  return {
    studentId: STUDENT,
    sessionId: SESSION,
    subject: 'math',
    topic: 'algebra',
    chapter: 3,
    totalTimeSeconds: 42,
    responses: [{ question_id: QUESTION, time_taken_seconds: 7 }],
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

const replayResult: QuizSubmitSideEffectResult = { ...freshResult, idempotent_replay: true };

function offlineSyncEvents() {
  return logOpsEventMock.mock.calls
    .map((c) => c[0] as Record<string, unknown>)
    .filter((e) => e?.category === 'offline-sync');
}

beforeEach(() => {
  vi.clearAllMocks();
  posthogCaptureMock.mockResolvedValue(undefined);
  publishEventMock.mockResolvedValue({ published: false, reason: 'flag_off' });
  maybeDispatchMock.mockResolvedValue({ ranOrchestrator: false, publishedEventCount: 0 });
});

describe('runQuizSubmitSideEffects — offline-sync telemetry', () => {
  const offlineMeta = {
    attemptMode: 'offline_replay' as const,
    capturedAt: '2026-06-06T09:00:00.000Z',
    drainedAt: '2026-06-06T09:01:30.000Z',
    queueLatencySeconds: 90,
    drainAttempt: 1,
  };

  it('online (no offlineMeta) emits NO offline-sync event', async () => {
    runQuizSubmitSideEffects(adminStub(), 'auth-1', baseInput(), freshResult);
    await flushAsync();
    expect(offlineSyncEvents()).toHaveLength(0);
  });

  it('offline fresh grade emits the event with wasIdempotentReplay=false + full metadata', async () => {
    runQuizSubmitSideEffects(adminStub(), 'auth-1', baseInput({ offlineMeta }), freshResult);
    await flushAsync();

    const events = offlineSyncEvents();
    expect(events).toHaveLength(1);
    const ev = events[0];
    expect(ev.category).toBe('offline-sync');
    expect(ev.severity).toBe('info');
    expect(ev.message).toBe('learner_offline_sync_replay');
    expect(ev.subjectType).toBe('student');
    expect(ev.subjectId).toBe(STUDENT);
    expect(ev.context).toEqual({
      schemaVersion: 1,
      sessionId: SESSION,
      capturedAt: offlineMeta.capturedAt,
      drainedAt: offlineMeta.drainedAt,
      queueLatencySeconds: 90,
      wasIdempotentReplay: false,
      drainAttempt: 1,
    });
  });

  it('offline idempotent replay STILL emits the event (fires BEFORE the early-return)', async () => {
    runQuizSubmitSideEffects(adminStub(), 'auth-1', baseInput({ offlineMeta }), replayResult);
    await flushAsync();

    const events = offlineSyncEvents();
    expect(events).toHaveLength(1);
    expect((events[0].context as Record<string, unknown>).wasIdempotentReplay).toBe(true);

    // But all OTHER side-effects are short-circuited by the replay guard.
    expect(posthogCaptureMock).not.toHaveBeenCalled();
    expect(publishEventMock).not.toHaveBeenCalled();
    expect(maybeDispatchMock).not.toHaveBeenCalled();
  });

  it('drainAttempt omitted → context.drainAttempt is null (metadata only)', async () => {
    const { drainAttempt: _omit, ...metaNoAttempt } = offlineMeta;
    void _omit;
    runQuizSubmitSideEffects(
      adminStub(),
      'auth-1',
      baseInput({ offlineMeta: metaNoAttempt }),
      freshResult,
    );
    await flushAsync();
    const ctx = offlineSyncEvents()[0].context as Record<string, unknown>;
    expect(ctx.drainAttempt).toBeNull();
  });
});
