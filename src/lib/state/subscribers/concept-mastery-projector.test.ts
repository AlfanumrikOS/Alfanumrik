import { describe, it, expect, vi } from 'vitest';
import { conceptMasteryProjector } from './concept-mastery-projector';
import type { SubscriberContext } from './subscriber';
import type { DomainEvent } from '../events/registry';

type CheckAnsweredEvent = Extract<DomainEvent, { kind: 'learner.concept_check_answered' }>;

function makeEvent(
  overrides: Partial<{
    attemptId: string;
    prior: number;
    correct: boolean;
    seq: number;
    studentId: string;
    conceptId: string;
  }> = {},
): CheckAnsweredEvent {
  return {
    eventId: '11111111-1111-4111-8111-111111111111',
    occurredAt: '2026-05-12T10:00:00.000Z',
    actorAuthUserId: '22222222-2222-4222-8222-222222222222',
    tenantId: null,
    idempotencyKey: 'tutor.answer.test',
    kind: 'learner.concept_check_answered',
    payload: {
      studentId:        overrides.studentId ?? '33333333-3333-4333-8333-333333333333',
      conceptId:        overrides.conceptId ?? '44444444-4444-4444-8444-444444444444',
      attemptId:        overrides.attemptId ?? '55555555-5555-4555-8555-555555555555',
      questionId:       '44444444-4444-4444-8444-444444444444:practice:v1',
      correct:          overrides.correct ?? true,
      chosenIndex:      0,
      responseTimeMs:   1234,
      occurredAt:       '2026-05-12T10:00:00.000Z',
      attemptSequence:  overrides.seq ?? 1,
      priorMasteryMean: overrides.prior ?? 0.30,
      eventVersion:     1,
      subjectCode:      'math',
      chapterNumber:    1,
    },
  };
}

type ExistingRow = {
  last_attempt_id: string | null;
  total_correct: number;
  streak_current: number;
} | null;

function makeCtx(opts: {
  existingRow?: ExistingRow;
  upsertError?: { message: string } | null;
  dryRun?: boolean;
}): { ctx: SubscriberContext; upsert: ReturnType<typeof vi.fn>; lines: unknown[] } {
  const upsert = vi.fn().mockResolvedValue({ error: opts.upsertError ?? null });
  const lines: unknown[] = [];
  const sb = {
    from(table: string) {
      if (table !== 'concept_mastery') throw new Error(`unexpected table: ${table}`);
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: opts.existingRow ?? null, error: null }),
            }),
          }),
        }),
        upsert,
      };
    },
  } as unknown as SubscriberContext['sb'];
  return {
    ctx: {
      sb,
      dryRun: opts.dryRun ?? false,
      now: () => new Date('2026-05-12T10:00:00.000Z'),
      log: line => lines.push(line),
    },
    upsert,
    lines,
  };
}

describe('conceptMasteryProjector', () => {
  it('exposes studentIdFromEvent → payload.studentId', () => {
    const event = makeEvent();
    expect(conceptMasteryProjector.studentIdFromEvent!(event))
      .toBe('33333333-3333-4333-8333-333333333333');
  });

  it('idempotent: skips upsert when existing row already records this attemptId', async () => {
    const attemptId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const event = makeEvent({ attemptId });
    const { ctx, upsert, lines } = makeCtx({
      existingRow: { last_attempt_id: attemptId, total_correct: 5, streak_current: 5 },
    });
    await conceptMasteryProjector.handle(event, ctx);
    expect(upsert).not.toHaveBeenCalled();
    expect(lines).toHaveLength(1);
    expect((lines[0] as { outcome: string }).outcome).toBe('skipped');
  });

  it('happy path: recomputes posterior from event prior + upserts with correct fields', async () => {
    const event = makeEvent({ prior: 0.30, correct: true, seq: 1 });
    const { ctx, upsert } = makeCtx({ existingRow: null });
    await conceptMasteryProjector.handle(event, ctx);

    expect(upsert).toHaveBeenCalledTimes(1);
    const [payload, opts] = upsert.mock.calls[0];
    expect(opts).toEqual({ onConflict: 'student_id,concept_id' });
    expect(payload).toMatchObject({
      student_id:      '33333333-3333-4333-8333-333333333333',
      concept_id:      '44444444-4444-4444-8444-444444444444',
      last_attempt_id: '55555555-5555-4555-8555-555555555555',
      total_attempts:  1,
      total_correct:   1,
      streak_current:  1,
      bkt_version:     1,
    });
    // Posterior for prior=0.30, correct → ~0.693
    expect(payload.mastery_mean).toBeCloseTo(0.693, 2);
  });

  it('preserves total_correct + extends streak on a correct answer with existing row', async () => {
    const event = makeEvent({ prior: 0.69, correct: true, seq: 2 });
    const { ctx, upsert } = makeCtx({
      existingRow: { last_attempt_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', total_correct: 3, streak_current: 3 },
    });
    await conceptMasteryProjector.handle(event, ctx);
    const [payload] = upsert.mock.calls[0];
    expect(payload.total_correct).toBe(4);
    expect(payload.streak_current).toBe(4);
  });

  it('resets streak_current to 0 on a wrong answer; total_correct stays', async () => {
    const event = makeEvent({ prior: 0.69, correct: false, seq: 2 });
    const { ctx, upsert } = makeCtx({
      existingRow: { last_attempt_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', total_correct: 3, streak_current: 3 },
    });
    await conceptMasteryProjector.handle(event, ctx);
    const [payload] = upsert.mock.calls[0];
    expect(payload.total_correct).toBe(3);
    expect(payload.streak_current).toBe(0);
  });

  it('throws when upsert returns an error (caller retries via substrate)', async () => {
    const event = makeEvent();
    const { ctx } = makeCtx({ upsertError: { message: 'connection lost' } });
    await expect(conceptMasteryProjector.handle(event, ctx)).rejects.toThrow('connection lost');
  });

  it('respects dryRun (no upsert)', async () => {
    const event = makeEvent();
    const { ctx, upsert, lines } = makeCtx({ existingRow: null, dryRun: true });
    await conceptMasteryProjector.handle(event, ctx);
    expect(upsert).not.toHaveBeenCalled();
    expect((lines[0] as { outcome: string }).outcome).toBe('dryrun');
  });
});
