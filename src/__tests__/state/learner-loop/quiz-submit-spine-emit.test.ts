/**
 * Spine-emit contract tests for /api/quiz/submit.
 *
 * The route fires two route-level publishEvent calls after the
 * submit_quiz_results_v2 RPC succeeds:
 *
 *   - learner.quiz_completed (one per quiz session)
 *   - learner.mastery_changed  (one per chapter touched by the questions)
 *
 * Both are gated by ff_event_bus_v1 inside publishEvent. Both use
 * idempotency keys that match quiz-completion-service.ts so that when
 * the orchestrator-bridge path also fires (ff_orchestrator_v1 ON), the
 * bus's UNIQUE(idempotency_key) constraint dedupes.
 *
 * These are CONTRACT tests, not route integration tests. The route has
 * heavy auth + RPC dependencies that aren't worth mocking for the
 * publish-line shape pin; the schema is the source of truth. If the
 * registry contract drifts the test fails before the route can ship.
 *
 * Flag-OFF behaviour is verified separately by exercising
 * publishEvent() against a fixture Supabase client.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  computeMasteryDeltas,
  masteryChangedIdempotencyKey,
  quizCompletedIdempotencyKey,
} from '../../../app/api/quiz/submit/route';
import {
  DomainEventSchema,
  LearnerMasteryChangedSchema,
  LearnerQuizCompletedSchema,
} from '../../../lib/state/events/registry';
import {
  publishEvent,
  __resetFlagCacheForTests,
} from '../../../lib/state/events/publish';

// ─── Idempotency key helpers ─────────────────────────────────────────

describe('quizCompletedIdempotencyKey', () => {
  it('returns the orchestrator-compatible key', () => {
    // Must match quiz-completion-service.ts:162 verbatim so the bus's
    // UNIQUE constraint dedupes when both paths fire.
    const sid = '11111111-1111-1111-1111-111111111111';
    expect(quizCompletedIdempotencyKey(sid)).toBe(`quiz-completed:${sid}`);
  });

  it('is deterministic — same sessionId always produces the same key', () => {
    const sid = '22222222-2222-2222-2222-222222222222';
    expect(quizCompletedIdempotencyKey(sid)).toBe(quizCompletedIdempotencyKey(sid));
  });
});

describe('masteryChangedIdempotencyKey', () => {
  it('returns the orchestrator-compatible key', () => {
    // Must match quiz-completion-service.ts:181 verbatim.
    const sid = '11111111-1111-1111-1111-111111111111';
    expect(masteryChangedIdempotencyKey(sid, 3)).toBe(`mastery-changed:${sid}:3`);
  });

  it('different chapters produce different keys for the same session', () => {
    const sid = '11111111-1111-1111-1111-111111111111';
    expect(masteryChangedIdempotencyKey(sid, 1)).not.toBe(masteryChangedIdempotencyKey(sid, 2));
  });
});

// ─── computeMasteryDeltas (BKT math mirror) ───────────────────────────

describe('computeMasteryDeltas', () => {
  it('returns one delta per chapter that appeared in the quiz', () => {
    const out = computeMasteryDeltas(1, [
      { correct: true },
      { correct: false },
      { correct: true, chapterNumberOverride: 2 },
    ]);
    expect(out.map((d) => d.chapterNumber).sort()).toEqual([1, 2]);
  });

  it('uses null fromMastery when no prior is supplied (first-attempt)', () => {
    const out = computeMasteryDeltas(7, [{ correct: true }]);
    expect(out[0].fromMastery).toBeNull();
    // Even with null fromMastery, toMastery is well-defined (BKT seeded
    // from BKT_PRIOR_INIT=0.3 internally).
    expect(out[0].toMastery).toBeGreaterThan(0);
    expect(out[0].toMastery).toBeLessThanOrEqual(1);
  });

  it('uses supplied prior when available', () => {
    const out = computeMasteryDeltas(3, [{ correct: true }], { 3: 0.6 });
    expect(out[0].fromMastery).toBe(0.6);
    // posterior must be above the prior on a correct answer (BKT update).
    expect(out[0].toMastery).toBeGreaterThanOrEqual(0.6);
  });

  it('clamps toMastery to [0,1] (no float drift past the edge)', () => {
    // Hammer 20 correct in a row — converges near 1.0 but must not exceed.
    const correct20 = Array.from({ length: 20 }, () => ({ correct: true }));
    const out = computeMasteryDeltas(1, correct20);
    expect(out[0].toMastery).toBeLessThanOrEqual(1);
    expect(out[0].toMastery).toBeGreaterThan(0.9);
  });

  it('threads BKT through outcomes in order (mastery decreases on wrong after corrects)', () => {
    const corrects = [{ correct: true }, { correct: true }, { correct: true }];
    const correctsThenWrong = [
      { correct: true }, { correct: true }, { correct: true }, { correct: false },
    ];
    const a = computeMasteryDeltas(1, corrects);
    const b = computeMasteryDeltas(1, correctsThenWrong);
    expect(b[0].toMastery).toBeLessThan(a[0].toMastery);
  });

  it('emits empty array when no questions are supplied', () => {
    expect(computeMasteryDeltas(1, [])).toEqual([]);
  });
});

// ─── learner.quiz_completed event shape ───────────────────────────────

describe('learner.quiz_completed — event shape published by /api/quiz/submit', () => {
  function buildEvent(opts: {
    sessionId: string;
    authUserId: string;
    schoolId: string | null;
    subjectCode: string;
    chapterNumber: number;
    questionCount: number;
    correctCount: number;
    durationSec: number;
    xpEarned: number;
  }) {
    return {
      kind: 'learner.quiz_completed' as const,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorAuthUserId: opts.authUserId,
      tenantId: opts.schoolId,
      idempotencyKey: quizCompletedIdempotencyKey(opts.sessionId),
      payload: {
        quizSessionId: opts.sessionId,
        subjectCode: opts.subjectCode,
        chapterNumber: opts.chapterNumber,
        questionCount: opts.questionCount,
        correctCount: opts.correctCount,
        durationSec: opts.durationSec,
        xpEarned: opts.xpEarned,
      },
    };
  }

  it('parses against DomainEventSchema', () => {
    const event = buildEvent({
      sessionId: '11111111-1111-1111-1111-111111111111',
      authUserId: '22222222-2222-2222-2222-222222222222',
      schoolId: '33333333-3333-3333-3333-333333333333',
      subjectCode: 'math',
      chapterNumber: 7,
      questionCount: 10,
      correctCount: 8,
      durationSec: 600,
      xpEarned: 40,
    });
    expect(() => DomainEventSchema.parse(event)).not.toThrow();
  });

  it('parses against LearnerQuizCompletedSchema', () => {
    const event = buildEvent({
      sessionId: '11111111-1111-1111-1111-111111111111',
      authUserId: '22222222-2222-2222-2222-222222222222',
      schoolId: null,
      subjectCode: 'science',
      chapterNumber: 1,
      questionCount: 5,
      correctCount: 5,
      durationSec: 300,
      xpEarned: 25,
    });
    expect(() => LearnerQuizCompletedSchema.parse(event)).not.toThrow();
  });

  it('handles B2C tenantId null', () => {
    const event = buildEvent({
      sessionId: '11111111-1111-1111-1111-111111111111',
      authUserId: '22222222-2222-2222-2222-222222222222',
      schoolId: null,
      subjectCode: 'math',
      chapterNumber: 1,
      questionCount: 3,
      correctCount: 1,
      durationSec: 120,
      xpEarned: 5,
    });
    expect(event.tenantId).toBeNull();
    expect(() => DomainEventSchema.parse(event)).not.toThrow();
  });

  it('correctCount can equal zero (a 0-correct quiz still emits)', () => {
    const event = buildEvent({
      sessionId: '11111111-1111-1111-1111-111111111111',
      authUserId: '22222222-2222-2222-2222-222222222222',
      schoolId: null,
      subjectCode: 'math',
      chapterNumber: 1,
      questionCount: 5,
      correctCount: 0,
      durationSec: 240,
      xpEarned: 0,
    });
    expect(() => DomainEventSchema.parse(event)).not.toThrow();
  });
});

// ─── learner.mastery_changed event shape ──────────────────────────────

describe('learner.mastery_changed — event shape published by /api/quiz/submit', () => {
  function buildEvent(opts: {
    sessionId: string;
    authUserId: string;
    schoolId: string | null;
    subjectCode: string;
    chapterNumber: number;
    fromMastery: number | null;
    toMastery: number;
  }) {
    return {
      kind: 'learner.mastery_changed' as const,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorAuthUserId: opts.authUserId,
      tenantId: opts.schoolId,
      idempotencyKey: masteryChangedIdempotencyKey(opts.sessionId, opts.chapterNumber),
      payload: {
        subjectCode: opts.subjectCode,
        chapterNumber: opts.chapterNumber,
        fromMastery: opts.fromMastery,
        toMastery: opts.toMastery,
        trigger: 'quiz' as const,
      },
    };
  }

  it('parses against DomainEventSchema with null fromMastery', () => {
    const event = buildEvent({
      sessionId: '11111111-1111-1111-1111-111111111111',
      authUserId: '22222222-2222-2222-2222-222222222222',
      schoolId: null,
      subjectCode: 'math',
      chapterNumber: 3,
      fromMastery: null,
      toMastery: 0.42,
    });
    expect(() => DomainEventSchema.parse(event)).not.toThrow();
  });

  it('parses against LearnerMasteryChangedSchema with numeric prior', () => {
    const event = buildEvent({
      sessionId: '11111111-1111-1111-1111-111111111111',
      authUserId: '22222222-2222-2222-2222-222222222222',
      schoolId: '33333333-3333-3333-3333-333333333333',
      subjectCode: 'science',
      chapterNumber: 5,
      fromMastery: 0.3,
      toMastery: 0.55,
    });
    expect(() => LearnerMasteryChangedSchema.parse(event)).not.toThrow();
  });

  it('rejects toMastery > 1 (registry contract guard)', () => {
    const event = buildEvent({
      sessionId: '11111111-1111-1111-1111-111111111111',
      authUserId: '22222222-2222-2222-2222-222222222222',
      schoolId: null,
      subjectCode: 'math',
      chapterNumber: 1,
      fromMastery: 0.9,
      toMastery: 1.05, // invalid
    });
    expect(() => DomainEventSchema.parse(event)).toThrow();
  });
});

// ─── Flag-OFF / Flag-ON publish contract ──────────────────────────────
//
// publishEvent() is the single gate for ff_event_bus_v1. We exercise
// both branches with a minimal in-memory mock of the Supabase client.

interface MockInsertCall { table: string; row: Record<string, unknown> }

function makeMockSupabase(flagEnabled: boolean) {
  const inserts: MockInsertCall[] = [];
  // Loose typing to satisfy the SupabaseClient surface publishEvent uses.
  // Only the .from(...).select/maybeSingle path for feature_flags and
  // .from('state_events').insert path are exercised.
  const sb = {
    from(table: string) {
      if (table === 'feature_flags') {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle: async () => ({ data: flagEnabled ? { is_enabled: true } : null, error: null }),
        };
      }
      if (table === 'state_events') {
        return {
          insert: async (row: Record<string, unknown>) => {
            inserts.push({ table, row });
            return { error: null };
          },
        };
      }
      throw new Error(`unmocked table: ${table}`);
    },
  };
  return { sb, inserts };
}

const SAMPLE_QUIZ_COMPLETED_EVENT = {
  kind: 'learner.quiz_completed' as const,
  eventId: '11111111-1111-1111-1111-111111111111',
  occurredAt: '2026-05-17T10:00:00.000Z',
  actorAuthUserId: '22222222-2222-2222-2222-222222222222',
  tenantId: null,
  idempotencyKey: quizCompletedIdempotencyKey('33333333-3333-3333-3333-333333333333'),
  payload: {
    quizSessionId: '33333333-3333-3333-3333-333333333333',
    subjectCode: 'math',
    chapterNumber: 1,
    questionCount: 5,
    correctCount: 3,
    durationSec: 300,
    xpEarned: 15,
  },
};

describe('publishEvent flag-gate — learner.quiz_completed', () => {
  beforeEach(() => {
    __resetFlagCacheForTests();
  });

  it('is a no-op when ff_event_bus_v1 is OFF (no insert into state_events)', async () => {
    const { sb, inserts } = makeMockSupabase(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await publishEvent(sb as any, SAMPLE_QUIZ_COMPLETED_EVENT);
    expect(result.published).toBe(false);
    expect(result.reason).toBe('flag_off');
    expect(inserts).toHaveLength(0);
  });

  it('publishes when ff_event_bus_v1 is ON (one INSERT into state_events)', async () => {
    const { sb, inserts } = makeMockSupabase(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await publishEvent(sb as any, SAMPLE_QUIZ_COMPLETED_EVENT);
    expect(result.published).toBe(true);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe('state_events');
    expect(inserts[0].row).toMatchObject({
      kind: 'learner.quiz_completed',
      idempotency_key: SAMPLE_QUIZ_COMPLETED_EVENT.idempotencyKey,
      actor_auth_user_id: SAMPLE_QUIZ_COMPLETED_EVENT.actorAuthUserId,
    });
  });
});
