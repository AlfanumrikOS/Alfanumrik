import { describe, it, expect } from 'vitest';
import {
  LearnerLearningActionSchema,
  DomainEventSchema,
  ALL_EVENT_KINDS,
} from '@alfanumrik/lib/state/events/registry';

/**
 * GUARD #7 — learner.learning_action Zod schema contract.
 *
 * The backend added the VALID fixture to events-registry.test.ts (it parses).
 * This file OWNS + VERIFIES the negative space the assessment guard demands:
 *   - a valid payload parses;
 *   - a bad actionType is rejected;
 *   - missing required ids (messageId / sessionId) are rejected;
 *   - the payload is IDs + enums only (no free text fields leak in).
 *
 * P13 rationale: a self-report telemetry event must never carry message body /
 * email / phone / name on the bus — the schema is the enforcement point.
 */

const ENVELOPE = {
  eventId: '00000000-0000-0000-0000-000000000001',
  occurredAt: '2026-06-14T12:00:00.000Z',
  actorAuthUserId: '00000000-0000-0000-0000-000000000002',
  tenantId: null,
  idempotencyKey: 'learning_action:msg:got_it',
  kind: 'learner.learning_action' as const,
};

const VALID_PAYLOAD = {
  messageId: '00000000-0000-0000-0000-000000000003',
  sessionId: '00000000-0000-0000-0000-000000000004',
  conceptId: '00000000-0000-0000-0000-000000000005',
  actionType: 'got_it' as const,
  subjectCode: 'science',
  chapterNumber: 4,
};

function parse(payload: Record<string, unknown>) {
  return DomainEventSchema.safeParse({ ...ENVELOPE, payload });
}

describe('GUARD #7 — learner.learning_action registry schema', () => {
  it('is a member of ALL_EVENT_KINDS', () => {
    expect(ALL_EVENT_KINDS).toContain('learner.learning_action');
  });

  it('parses a valid payload', () => {
    expect(parse(VALID_PAYLOAD).success).toBe(true);
  });

  it('parses each of the 5 action types', () => {
    for (const actionType of ['got_it', 'explain_simpler', 'show_example', 'quiz_me', 'save'] as const) {
      expect(parse({ ...VALID_PAYLOAD, actionType }).success, actionType).toBe(true);
    }
  });

  it('accepts a null conceptId (bar fires before any concept is bound)', () => {
    expect(parse({ ...VALID_PAYLOAD, conceptId: null }).success).toBe(true);
  });

  it('accepts an absent conceptId (optional)', () => {
    const { conceptId: _drop, ...withoutConcept } = VALID_PAYLOAD;
    void _drop;
    expect(parse(withoutConcept).success).toBe(true);
  });

  it('accepts null subjectCode + null chapterNumber', () => {
    expect(parse({ ...VALID_PAYLOAD, subjectCode: null, chapterNumber: null }).success).toBe(true);
  });

  it('rejects an unknown actionType', () => {
    expect(parse({ ...VALID_PAYLOAD, actionType: 'cheat' }).success).toBe(false);
    expect(parse({ ...VALID_PAYLOAD, actionType: 'submit_answer' }).success).toBe(false);
  });

  it('rejects a missing messageId', () => {
    const { messageId: _drop, ...rest } = VALID_PAYLOAD;
    void _drop;
    expect(parse(rest).success).toBe(false);
  });

  it('rejects a missing sessionId', () => {
    const { sessionId: _drop, ...rest } = VALID_PAYLOAD;
    void _drop;
    expect(parse(rest).success).toBe(false);
  });

  it('rejects a non-uuid messageId', () => {
    expect(parse({ ...VALID_PAYLOAD, messageId: 'not-a-uuid' }).success).toBe(false);
  });

  it('rejects a negative chapterNumber (nonnegative int contract)', () => {
    expect(parse({ ...VALID_PAYLOAD, chapterNumber: -1 }).success).toBe(false);
  });

  it('payload is IDs + enums only — free-text keys are stripped, not stored', () => {
    // The schema is non-strict; extra free-text keys are dropped on parse rather
    // than persisted. Proving they do not survive into the parsed payload is the
    // P13 guarantee (no message body / PII reaches the bus).
    const res = LearnerLearningActionSchema.safeParse({
      ...ENVELOPE,
      payload: {
        ...VALID_PAYLOAD,
        messageText: 'Photosynthesis converts light to chemical energy.',
        studentEmail: 'kid@example.com',
      },
    });
    expect(res.success).toBe(true);
    if (res.success) {
      const keys = Object.keys(res.data.payload).sort();
      expect(keys).toEqual(
        ['actionType', 'chapterNumber', 'conceptId', 'messageId', 'sessionId', 'subjectCode'].sort(),
      );
      expect(JSON.stringify(res.data.payload)).not.toContain('Photosynthesis');
      expect(JSON.stringify(res.data.payload)).not.toContain('@example.com');
    }
  });
});
