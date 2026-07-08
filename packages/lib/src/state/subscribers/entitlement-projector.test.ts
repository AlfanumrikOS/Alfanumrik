import { describe, it, expect, vi } from 'vitest';
import { entitlementProjector } from './entitlement-projector';
import type { SubscriberContext } from './subscriber';
import type { DomainEvent } from '../events/registry';

type InvoicePaidEvent = Extract<DomainEvent, { kind: 'billing.invoice_paid' }>;

function makeEvent(tenantId: string | null = null): InvoicePaidEvent {
  return {
    eventId: '11111111-1111-4111-8111-111111111111',
    occurredAt: '2026-06-02T10:00:00.000Z',
    actorAuthUserId: '22222222-2222-4222-8222-222222222222',
    tenantId,
    idempotencyKey: 'billing-invoice-paid:11111111-1111-4111-8111-111111111111',
    kind: 'billing.invoice_paid',
    payload: {
      invoiceId: '55555555-5555-4555-8555-555555555555',
      amountInr: 99900,
      planSlug: 'premium_monthly',
    },
  };
}

function makeCtx(opts: {
  studentRow?: { id: string } | null;
  studentError?: { message: string } | null;
  paymentRow?: {
    plan_code: string;
    billing_cycle: string;
    razorpay_payment_id: string;
    razorpay_subscription_id: string;
  } | null;
  paymentError?: { message: string } | null;
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
      if (table === 'payment_history') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: opts.paymentRow !== undefined ? opts.paymentRow : {
                  plan_code: 'premium',
                  billing_cycle: 'monthly',
                  razorpay_payment_id: 'pay_123',
                  razorpay_subscription_id: 'sub_123',
                },
                error: opts.paymentError ?? null,
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

describe('entitlementProjector', () => {
  it('exposes studentIdFromEvent → event.actorAuthUserId', () => {
    const event = makeEvent();
    expect(entitlementProjector.studentIdFromEvent!(event))
      .toBe('22222222-2222-4222-8222-222222222222');
  });

  it('skips B2B/School subscription events (tenantId !== null)', async () => {
    const event = makeEvent('tenant-uuid-8888');
    const { ctx, rpc, lines } = makeCtx({});

    await entitlementProjector.handle(event, ctx);

    expect(rpc).not.toHaveBeenCalled();
    expect(lines).toHaveLength(1);
    expect((lines[0] as { outcome: string }).outcome).toBe('skipped');
    expect((lines[0] as { message: string }).message).toContain('B2B/School subscription');
  });

  it('happy path: B2C subscription invoice paid activates subscription via RPC', async () => {
    const event = makeEvent(null);
    const { ctx, rpc, lines } = makeCtx({});

    await entitlementProjector.handle(event, ctx);

    expect(rpc).toHaveBeenCalledWith('atomic_subscription_activation', {
      p_student_id: 'student-uuid-3333',
      p_plan_code: 'premium',
      p_billing_cycle: 'monthly',
      p_razorpay_payment_id: 'pay_123',
      p_razorpay_subscription_id: 'sub_123',
    });
    expect(lines).toHaveLength(1);
    expect((lines[0] as { outcome: string }).outcome).toBe('ok');
  });

  it('skips RPC if student profile not found', async () => {
    const event = makeEvent(null);
    const { ctx, rpc, lines } = makeCtx({ studentRow: null });

    await entitlementProjector.handle(event, ctx);

    expect(rpc).not.toHaveBeenCalled();
    expect(lines).toHaveLength(1);
    expect((lines[0] as { outcome: string }).outcome).toBe('skipped');
    expect((lines[0] as { message: string }).message).toContain('student profile not found');
  });

  it('throws error when student resolution fails', async () => {
    const event = makeEvent(null);
    const { ctx, rpc } = makeCtx({ studentError: { message: 'db failure' } });

    await expect(entitlementProjector.handle(event, ctx)).rejects.toThrow('db failure');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('throws error when payment history lookup fails', async () => {
    const event = makeEvent(null);
    const { ctx, rpc } = makeCtx({ paymentError: { message: 'payment db lookup error' } });

    await expect(entitlementProjector.handle(event, ctx)).rejects.toThrow('payment db lookup error');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('throws error when payment history row is not found', async () => {
    const event = makeEvent(null);
    const { ctx, rpc } = makeCtx({ paymentRow: null });

    await expect(entitlementProjector.handle(event, ctx)).rejects.toThrow('payment_history row not found');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('respects dryRun flag', async () => {
    const event = makeEvent(null);
    const { ctx, rpc, lines } = makeCtx({ dryRun: true });

    await entitlementProjector.handle(event, ctx);

    expect(rpc).not.toHaveBeenCalled();
    expect(lines).toHaveLength(1);
    expect((lines[0] as { outcome: string }).outcome).toBe('dryrun');
  });

  it('throws error if atomic_subscription_activation RPC fails', async () => {
    const event = makeEvent(null);
    const { ctx, rpc } = makeCtx({ rpcError: { message: 'activation rpc failed' } });

    await expect(entitlementProjector.handle(event, ctx)).rejects.toThrow('activation rpc failed');
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
