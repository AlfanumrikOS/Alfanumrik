import { describe, it, expect, vi } from 'vitest';
import { freeTierProvisioner } from './free-tier-provisioner';
import type { SubscriberContext } from './subscriber';
import type { DomainEvent } from '../events/registry';

type SignedUpEvent = Extract<DomainEvent, { kind: 'learner.signed_up' }>;

function makeEvent(): SignedUpEvent {
  return {
    eventId: '11111111-1111-4111-8111-111111111111',
    occurredAt: '2026-06-02T10:00:00.000Z',
    actorAuthUserId: '22222222-2222-4222-8222-222222222222',
    tenantId: null,
    idempotencyKey: 'learner-signed-up:22222222-2222-4222-8222-222222222222',
    kind: 'learner.signed_up',
    payload: {
      grade: '9',
      board: 'CBSE',
      language: 'en',
      invitedBy: null,
    },
  };
}

function makeCtx(opts: {
  studentRow?: { id: string } | null;
  studentError?: { message: string } | null;
  existingSub?: { id: string } | null;
  subError?: { message: string } | null;
  rpcError?: { message: string } | null;
  dryRun?: boolean;
}) {
  const rpc = vi.fn().mockResolvedValue({ error: opts.rpcError ?? null });
  const lines: unknown[] = [];

  const sb = {
    from(table: string) {
      if (table === 'students') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: opts.studentRow !== undefined ? opts.studentRow : { id: 'student-uuid-3333' },
                error: opts.studentError ?? null,
              }),
            }),
          }),
        };
      }
      if (table === 'student_subscriptions') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: opts.existingSub !== undefined ? opts.existingSub : null,
                error: opts.subError ?? null,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
    rpc,
  } as unknown as SubscriberContext['sb'];

  return {
    ctx: {
      sb,
      dryRun: opts.dryRun ?? false,
      now: () => new Date('2026-06-02T10:00:00.000Z'),
      log: (line: any) => lines.push(line),
    },
    rpc,
    lines,
  };
}

describe('freeTierProvisioner', () => {
  it('exposes studentIdFromEvent → event.actorAuthUserId', () => {
    const event = makeEvent();
    expect(freeTierProvisioner.studentIdFromEvent!(event))
      .toBe('22222222-2222-4222-8222-222222222222');
  });

  it('happy path: resolves student, checks no existing sub, calls RPC', async () => {
    const event = makeEvent();
    const { ctx, rpc, lines } = makeCtx({});

    await freeTierProvisioner.handle(event, ctx);

    expect(rpc).toHaveBeenCalledWith('activate_free_subscription', {
      p_student_id: 'student-uuid-3333',
    });
    expect(lines).toHaveLength(1);
    expect((lines[0] as { outcome: string }).outcome).toBe('ok');
  });

  it('skips RPC if student profile not found', async () => {
    const event = makeEvent();
    const { ctx, rpc, lines } = makeCtx({ studentRow: null });

    await freeTierProvisioner.handle(event, ctx);

    expect(rpc).not.toHaveBeenCalled();
    expect(lines).toHaveLength(1);
    expect((lines[0] as { outcome: string }).outcome).toBe('skipped');
    expect((lines[0] as { message: string }).message).toContain('student profile not found');
  });

  it('throws error when student resolution fails', async () => {
    const event = makeEvent();
    const { ctx, rpc } = makeCtx({ studentError: { message: 'db failure' } });

    await expect(freeTierProvisioner.handle(event, ctx)).rejects.toThrow('db failure');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('skips if subscription already exists', async () => {
    const event = makeEvent();
    const { ctx, rpc, lines } = makeCtx({ existingSub: { id: 'sub-uuid-111' } });

    await freeTierProvisioner.handle(event, ctx);

    expect(rpc).not.toHaveBeenCalled();
    expect(lines).toHaveLength(1);
    expect((lines[0] as { outcome: string }).outcome).toBe('skipped');
    expect((lines[0] as { message: string }).message).toContain('subscription already exists');
  });

  it('throws error when existing subscription check fails', async () => {
    const event = makeEvent();
    const { ctx, rpc } = makeCtx({ subError: { message: 'db error checking sub' } });

    await expect(freeTierProvisioner.handle(event, ctx)).rejects.toThrow('db error checking sub');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('respects dryRun flag', async () => {
    const event = makeEvent();
    const { ctx, rpc, lines } = makeCtx({ dryRun: true });

    await freeTierProvisioner.handle(event, ctx);

    expect(rpc).not.toHaveBeenCalled();
    expect(lines).toHaveLength(1);
    expect((lines[0] as { outcome: string }).outcome).toBe('dryrun');
  });

  it('throws error if activate_free_subscription RPC fails', async () => {
    const event = makeEvent();
    const { ctx, rpc } = makeCtx({ rpcError: { message: 'rpc execution error' } });

    await expect(freeTierProvisioner.handle(event, ctx)).rejects.toThrow('rpc execution error');
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
