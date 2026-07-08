import { describe, it, expect } from 'vitest';
import { masteryStateWriter } from './mastery-state-writer';

describe('masteryStateWriter.studentIdFromEvent', () => {
  it('returns the actor auth_user_id', () => {
    const event = {
      eventId: '00000000-0000-0000-0000-000000000001',
      kind: 'learner.mastery_changed' as const,
      actorAuthUserId: 'auth-user-123',
      tenantId: null,
      idempotencyKey: 'idem-1',
      occurredAt: '2026-05-12T00:00:00Z',
      payload: { subjectCode: 'math', chapterNumber: 1, fromMastery: null, toMastery: 0.5, trigger: 'quiz' },
    };
    expect(masteryStateWriter.studentIdFromEvent?.(event as never)).toBe('auth-user-123');
  });

  it('is defined (not undefined)', () => {
    expect(typeof masteryStateWriter.studentIdFromEvent).toBe('function');
  });
});
