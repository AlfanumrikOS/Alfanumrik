import { describe, it, expect, vi } from 'vitest';
import { scheduledActionsWriter } from './scheduled-actions-writer';
import type { SubscriberContext } from './subscriber';
import type { DomainEvent } from '../events/registry';

type NextResolvedEvent = Extract<DomainEvent, { kind: 'learner.next_action_resolved' }>;

const STUDENT_ID = '33333333-3333-4333-8333-333333333333';

function makeEvent(overrides: Partial<NextResolvedEvent['payload']> = {}): NextResolvedEvent {
  return {
    eventId: '11111111-1111-4111-8111-111111111111',
    occurredAt: '2026-05-16T10:00:00.000Z',
    actorAuthUserId: '22222222-2222-4222-8222-222222222222',
    tenantId: null,
    idempotencyKey: 'learner.next.test',
    kind: 'learner.next_action_resolved',
    payload: {
      studentId:    overrides.studentId ?? STUDENT_ID,
      horizon:      overrides.horizon ?? 'daily',
      dayBucket:    overrides.dayBucket ?? '2026-05-16',
      rank:         overrides.rank ?? 0,
      actionKind:   overrides.actionKind ?? 'start_quiz',
      actionPayload: overrides.actionPayload ?? {
        kind: 'start_quiz',
        url: '/quiz?subject=math&chapter=1',
        subjectCode: 'math',
        chapterNumber: 1,
        zpdBin: 2,
        reason: 'todays_zpd',
      },
      generatedAt:  overrides.generatedAt ?? '2026-05-16T10:00:00.000Z',
      expiresAt:    overrides.expiresAt ?? '2026-05-16T18:30:00.000Z',
    },
  };
}

function makeCtx(opts: {
  upsertError?: { message: string } | null;
  dryRun?: boolean;
} = {}): { ctx: SubscriberContext; upsert: ReturnType<typeof vi.fn>; lines: unknown[] } {
  const upsert = vi.fn().mockResolvedValue({ error: opts.upsertError ?? null });
  const lines: unknown[] = [];
  const sb = {
    from(table: string) {
      if (table !== 'scheduled_actions') throw new Error(`unexpected table: ${table}`);
      return { upsert };
    },
  } as unknown as SubscriberContext['sb'];
  return {
    ctx: {
      sb,
      dryRun: opts.dryRun ?? false,
      now: () => new Date('2026-05-16T10:00:00.000Z'),
      log: line => lines.push(line),
    },
    upsert,
    lines,
  };
}

describe('scheduledActionsWriter', () => {
  it('binds to the learner.next_action_resolved kind', () => {
    expect(scheduledActionsWriter.kind).toBe('learner.next_action_resolved');
  });

  it('exposes studentIdFromEvent → payload.studentId', () => {
    expect(scheduledActionsWriter.studentIdFromEvent!(makeEvent())).toBe(STUDENT_ID);
  });

  it('upserts scheduled_actions with the SAME conflict key as the route write', async () => {
    const { ctx, upsert } = makeCtx();
    await scheduledActionsWriter.handle(makeEvent(), ctx);

    expect(upsert).toHaveBeenCalledTimes(1);
    const [, opts] = upsert.mock.calls[0];
    expect(opts).toEqual({ onConflict: 'student_id,horizon,day_bucket,rank' });
  });

  it('maps payload columns 1:1 with the route write (source hard-coded scheduler)', async () => {
    const { ctx, upsert } = makeCtx();
    const event = makeEvent();
    await scheduledActionsWriter.handle(event, ctx);

    const [row] = upsert.mock.calls[0];
    expect(row).toEqual({
      student_id:     STUDENT_ID,
      horizon:        'daily',
      day_bucket:     '2026-05-16',
      rank:           0,
      action_kind:    'start_quiz',
      action_payload: event.payload.actionPayload,
      source:         'scheduler',
      generated_at:   '2026-05-16T10:00:00.000Z',
      expires_at:     '2026-05-16T18:30:00.000Z',
    });
  });

  it('is idempotent on re-delivery — identical event upserts the identical row', async () => {
    const { ctx, upsert } = makeCtx();
    const event = makeEvent();
    await scheduledActionsWriter.handle(event, ctx);
    await scheduledActionsWriter.handle(event, ctx);

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert.mock.calls[0][0]).toEqual(upsert.mock.calls[1][0]);
    expect(upsert.mock.calls[0][1]).toEqual(upsert.mock.calls[1][1]);
  });

  it('respects dryRun (no upsert)', async () => {
    const { ctx, upsert, lines } = makeCtx({ dryRun: true });
    await scheduledActionsWriter.handle(makeEvent(), ctx);
    expect(upsert).not.toHaveBeenCalled();
    expect((lines[0] as { outcome: string }).outcome).toBe('dryrun');
  });

  it('throws when upsert returns an error (substrate retries)', async () => {
    const { ctx } = makeCtx({ upsertError: { message: 'connection lost' } });
    await expect(scheduledActionsWriter.handle(makeEvent(), ctx)).rejects.toThrow('connection lost');
  });

  it('is a safe no-op on a malformed payload (missing studentId) — no upsert, no throw', async () => {
    const { ctx, upsert, lines } = makeCtx();
    const event = makeEvent();
    // Simulate a payload that slipped past validation (defense-in-depth).
    (event.payload as { studentId?: string }).studentId = '';
    await expect(scheduledActionsWriter.handle(event, ctx)).resolves.toBeUndefined();
    expect(upsert).not.toHaveBeenCalled();
    expect((lines[0] as { outcome: string }).outcome).toBe('skipped');
  });
});
