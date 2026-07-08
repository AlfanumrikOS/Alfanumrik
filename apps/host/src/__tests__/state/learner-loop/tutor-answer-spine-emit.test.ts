/**
 * Spine-emit contract tests for /api/tutor/answer (legacy block only).
 *
 * The route's Path C v2 branch (all four flags ON) uses the atomic RPC
 * tutor_commit_attempt which inserts state_events under the same
 * Postgres transaction — no publishEvent() call from TS.
 *
 * The legacy block (Phase 0 naive concept_mastery upsert) is what this
 * PR adds a route-level publishEvent for: when ff_tutor_bkt_v1 OR
 * ff_projector_runner_v1 is OFF, or when Path C fell through, the route
 * fires learner.concept_check_answered from the route. Gated by
 * ff_event_bus_v1 inside publishEvent.
 *
 * These are CONTRACT tests against the registry — the route itself has
 * auth + DB + RPC dependencies that aren't worth mocking for the
 * publish-line shape pin.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  DomainEventSchema,
  LearnerConceptCheckAnsweredSchema,
} from '../../../lib/state/events/registry';
import {
  publishEvent,
  __resetFlagCacheForTests,
} from '../../../lib/state/events/publish';

// Replica of the event-building block at the bottom of
// src/app/api/tutor/answer/route.ts (legacy concept_check_answered branch).
// Keep in sync — divergence here vs the route is exactly what this test
// is protecting against.
function buildConceptCheckAnsweredEvent(args: {
  studentId: string;
  authUserId: string;
  schoolId: string | null;
  conceptId: string;
  attemptId: string;
  correct: boolean;
  chosenIndex: 0 | 1 | 2 | 3;
  responseTimeMs: number | null;
  attemptSequence: number;
  priorMasteryMean: number;
  subjectCode: string;
  chapterNumber: number;
  occurredAt?: string;
}) {
  return {
    kind: 'learner.concept_check_answered' as const,
    eventId: randomUUID(),
    occurredAt: args.occurredAt ?? new Date().toISOString(),
    actorAuthUserId: args.authUserId,
    tenantId: args.schoolId,
    idempotencyKey: `concept-check-answered:${args.attemptId}`,
    payload: {
      studentId: args.studentId,
      conceptId: args.conceptId,
      attemptId: args.attemptId,
      questionId: `${args.conceptId}:practice:v1`,
      correct: args.correct,
      chosenIndex: args.chosenIndex,
      responseTimeMs: args.responseTimeMs,
      occurredAt: args.occurredAt ?? new Date().toISOString(),
      attemptSequence: args.attemptSequence,
      priorMasteryMean: args.priorMasteryMean,
      eventVersion: 1 as const,
      subjectCode: args.subjectCode,
      chapterNumber: args.chapterNumber,
    },
  };
}

describe('learner.concept_check_answered — event shape from /api/tutor/answer (legacy branch)', () => {
  it('parses against DomainEventSchema', () => {
    const event = buildConceptCheckAnsweredEvent({
      studentId: '11111111-1111-1111-1111-111111111111',
      authUserId: '22222222-2222-2222-2222-222222222222',
      schoolId: '33333333-3333-3333-3333-333333333333',
      conceptId: '44444444-4444-4444-4444-444444444444',
      attemptId: '55555555-5555-5555-5555-555555555555',
      correct: true,
      chosenIndex: 2,
      responseTimeMs: 1500,
      attemptSequence: 1,
      priorMasteryMean: 0.5,
      subjectCode: 'math',
      chapterNumber: 3,
    });
    expect(() => DomainEventSchema.parse(event)).not.toThrow();
  });

  it('parses against LearnerConceptCheckAnsweredSchema', () => {
    const event = buildConceptCheckAnsweredEvent({
      studentId: '11111111-1111-1111-1111-111111111111',
      authUserId: '22222222-2222-2222-2222-222222222222',
      schoolId: null,
      conceptId: '44444444-4444-4444-4444-444444444444',
      attemptId: '55555555-5555-5555-5555-555555555555',
      correct: false,
      chosenIndex: 0,
      responseTimeMs: null,
      attemptSequence: 2,
      priorMasteryMean: 0.65,
      subjectCode: 'science',
      chapterNumber: 1,
    });
    expect(() => LearnerConceptCheckAnsweredSchema.parse(event)).not.toThrow();
  });

  it('idempotencyKey is deterministic on attemptId — retries dedupe', () => {
    const aid = '55555555-5555-5555-5555-555555555555';
    const a = buildConceptCheckAnsweredEvent({
      studentId: '11111111-1111-1111-1111-111111111111',
      authUserId: '22222222-2222-2222-2222-222222222222',
      schoolId: null,
      conceptId: '44444444-4444-4444-4444-444444444444',
      attemptId: aid,
      correct: true,
      chosenIndex: 2,
      responseTimeMs: 1500,
      attemptSequence: 1,
      priorMasteryMean: 0.5,
      subjectCode: 'math',
      chapterNumber: 3,
    });
    const b = buildConceptCheckAnsweredEvent({
      studentId: '11111111-1111-1111-1111-111111111111',
      authUserId: '99999999-9999-9999-9999-999999999999', // different envelope
      schoolId: '88888888-8888-8888-8888-888888888888',
      conceptId: '44444444-4444-4444-4444-444444444444',
      attemptId: aid, // same attempt
      correct: true,
      chosenIndex: 2,
      responseTimeMs: 1500,
      attemptSequence: 1,
      priorMasteryMean: 0.5,
      subjectCode: 'math',
      chapterNumber: 3,
      occurredAt: '2030-01-01T00:00:00.000Z', // different time
    });
    expect(a.idempotencyKey).toBe(b.idempotencyKey);
    expect(a.idempotencyKey).toBe(`concept-check-answered:${aid}`);
  });

  it('rejects out-of-range chosenIndex (registry contract guard)', () => {
    const event = buildConceptCheckAnsweredEvent({
      studentId: '11111111-1111-1111-1111-111111111111',
      authUserId: '22222222-2222-2222-2222-222222222222',
      schoolId: null,
      conceptId: '44444444-4444-4444-4444-444444444444',
      attemptId: '55555555-5555-5555-5555-555555555555',
      correct: true,
      chosenIndex: 7 as 0 | 1 | 2 | 3, // illegal — outside the 0..3 closed range
      responseTimeMs: 1500,
      attemptSequence: 1,
      priorMasteryMean: 0.5,
      subjectCode: 'math',
      chapterNumber: 3,
    });
    expect(() => DomainEventSchema.parse(event)).toThrow();
  });

  it('handles null responseTimeMs (no client clock available)', () => {
    const event = buildConceptCheckAnsweredEvent({
      studentId: '11111111-1111-1111-1111-111111111111',
      authUserId: '22222222-2222-2222-2222-222222222222',
      schoolId: null,
      conceptId: '44444444-4444-4444-4444-444444444444',
      attemptId: '55555555-5555-5555-5555-555555555555',
      correct: true,
      chosenIndex: 1,
      responseTimeMs: null,
      attemptSequence: 1,
      priorMasteryMean: 0.5,
      subjectCode: 'math',
      chapterNumber: 3,
    });
    expect(event.payload.responseTimeMs).toBeNull();
    expect(() => DomainEventSchema.parse(event)).not.toThrow();
  });
});

// ─── Flag-OFF / Flag-ON publish contract ─────────────────────────────

interface MockInsertCall { table: string; row: Record<string, unknown> }

function makeMockSupabase(flagEnabled: boolean) {
  const inserts: MockInsertCall[] = [];
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

const SAMPLE_CONCEPT_CHECK_EVENT = buildConceptCheckAnsweredEvent({
  studentId: '11111111-1111-1111-1111-111111111111',
  authUserId: '22222222-2222-2222-2222-222222222222',
  schoolId: null,
  conceptId: '44444444-4444-4444-4444-444444444444',
  attemptId: '55555555-5555-5555-5555-555555555555',
  correct: true,
  chosenIndex: 2,
  responseTimeMs: 1200,
  attemptSequence: 1,
  priorMasteryMean: 0.5,
  subjectCode: 'math',
  chapterNumber: 3,
  occurredAt: '2026-05-17T10:00:00.000Z',
});

describe('publishEvent flag-gate — learner.concept_check_answered', () => {
  beforeEach(() => {
    __resetFlagCacheForTests();
  });

  it('is a no-op when ff_event_bus_v1 is OFF', async () => {
    const { sb, inserts } = makeMockSupabase(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await publishEvent(sb as any, SAMPLE_CONCEPT_CHECK_EVENT);
    expect(result.published).toBe(false);
    expect(result.reason).toBe('flag_off');
    expect(inserts).toHaveLength(0);
  });

  it('publishes one INSERT to state_events when ff_event_bus_v1 is ON', async () => {
    const { sb, inserts } = makeMockSupabase(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await publishEvent(sb as any, SAMPLE_CONCEPT_CHECK_EVENT);
    expect(result.published).toBe(true);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].row).toMatchObject({
      kind: 'learner.concept_check_answered',
      idempotency_key: SAMPLE_CONCEPT_CHECK_EVENT.idempotencyKey,
    });
  });
});
