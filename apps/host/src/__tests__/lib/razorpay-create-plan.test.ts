import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * createRazorpayPlan — quarterly-cadence support + backward compatibility.
 *
 * The quarterly-billing change added an optional `opts?: { period?, interval? }`
 * argument. These tests pin:
 *   • Backward compat: the existing 2-arg call shape (name, amountInr) still
 *     posts period='monthly', interval=1 — no caller had to change.
 *   • Quarterly: passing { interval: 3 } posts interval=3 on a monthly period
 *     (Razorpay charges item.amount per interval → bill every 3rd month).
 *   • Rupees→paisa conversion (×100) happens at the API boundary only.
 */

const realFetch = global.fetch;
let lastBody: Record<string, unknown> | null = null;

function stubFetchOk() {
  global.fetch = vi.fn(async (_url: unknown, init?: { body?: string }) => {
    lastBody = init?.body ? JSON.parse(init.body) : null;
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'plan_stub', entity: 'plan' }),
      text: async () => '',
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  lastBody = null;
  process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
  process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret';
  stubFetchOk();
});

afterEach(() => {
  global.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('createRazorpayPlan — backward compatibility (2-arg call)', () => {
  it('a 2-arg call posts period=monthly, interval=1 (unchanged default)', async () => {
    const { createRazorpayPlan } = await import('@alfanumrik/lib/razorpay');
    await createRazorpayPlan('Alfanumrik Starter Monthly', 99);

    expect(lastBody).toBeTruthy();
    expect(lastBody!.period).toBe('monthly');
    expect(lastBody!.interval).toBe(1);
    // Rupees → paisa at the boundary.
    expect((lastBody!.item as { amount: number }).amount).toBe(9900);
    expect((lastBody!.item as { currency: string }).currency).toBe('INR');
  });
});

describe('createRazorpayPlan — quarterly cadence ({ interval: 3 })', () => {
  it('passes interval=3 on a monthly period (bill every 3rd month)', async () => {
    const { createRazorpayPlan } = await import('@alfanumrik/lib/razorpay');
    // The caller (setup-plans) passes price_monthly × 3 as the per-interval amount.
    await createRazorpayPlan('Alfanumrik Starter Quarterly', 297, { interval: 3 });

    expect(lastBody!.period).toBe('monthly'); // default period unchanged
    expect(lastBody!.interval).toBe(3);
    expect((lastBody!.item as { amount: number }).amount).toBe(29700);
  });

  it('an explicit period override is still honored alongside interval', async () => {
    const { createRazorpayPlan } = await import('@alfanumrik/lib/razorpay');
    await createRazorpayPlan('Alfanumrik Pro Yearly', 2999, { period: 'yearly', interval: 1 });
    expect(lastBody!.period).toBe('yearly');
    expect(lastBody!.interval).toBe(1);
  });
});
