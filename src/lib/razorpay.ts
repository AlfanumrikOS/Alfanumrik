/**
 * ALFANUMRIK — Razorpay Integration Library
 *
 * Centralizes all Razorpay API interactions.
 * Pricing is always in rupees internally; conversion to paisa happens
 * ONLY at the Razorpay API boundary in this file.
 */

const RAZORPAY_BASE = 'https://api.razorpay.com/v1';

function authHeader(): string {
  const key = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key || !secret) throw new Error('Razorpay credentials not configured');
  return `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`;
}

async function rzpFetch<T = Record<string, unknown>>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${RAZORPAY_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authHeader(),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Razorpay API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ─── Plans ──────────────────────────────────────────────────

interface RazorpayPlan {
  id: string;
  entity: string;
  interval: number;
  period: string;
  item: { id: string; name: string; amount: number; currency: string };
}

/** Billing cadence supported by Razorpay's Plans API. */
export type RazorpayPlanPeriod = 'monthly' | 'yearly' | 'weekly' | 'daily';

/**
 * Create a Razorpay Plan for recurring billing.
 *
 * Backward-compatible: existing callers that pass only (name, amountInr) keep
 * the original monthly/interval-1 behaviour. The optional `opts` lets callers
 * provision other cadences without a separate function:
 *   - Monthly   → { period: 'monthly', interval: 1 } (default)
 *   - Quarterly → { period: 'monthly', interval: 3 }  ← bills every 3 months
 *   - Yearly    → { period: 'yearly',  interval: 1 }
 *
 * @param name - Plan display name (e.g. "Alfanumrik Starter Monthly")
 * @param amountInr - Price charged each interval, in rupees (already × interval
 *   when the caller wants e.g. 3 months billed at once on a monthly/interval-3
 *   plan — Razorpay charges `item.amount` per interval, NOT per period).
 * @param opts - Optional cadence override. Defaults to { period: 'monthly', interval: 1 }.
 */
export async function createRazorpayPlan(
  name: string,
  amountInr: number,
  opts?: { period?: RazorpayPlanPeriod; interval?: number },
): Promise<RazorpayPlan> {
  const period = opts?.period ?? 'monthly';
  const interval = opts?.interval ?? 1;
  return rzpFetch<RazorpayPlan>('/plans', {
    method: 'POST',
    body: JSON.stringify({
      period,
      interval,
      item: {
        name,
        amount: amountInr * 100, // convert to paisa for Razorpay
        currency: 'INR',
      },
    }),
  });
}

// ─── Subscriptions ──────────────────────────────────────────

interface RazorpaySubscription {
  id: string;
  entity: string;
  plan_id: string;
  status: string;
  current_start: number | null;
  current_end: number | null;
  short_url: string;
  charge_at: number | null;
}

/**
 * Create a Razorpay Subscription for a student.
 * Student pays the first charge immediately via checkout.
 */
export async function createRazorpaySubscription(params: {
  razorpayPlanId: string;
  totalBillingCycles?: number;
  customerNotify?: boolean;
  notes?: Record<string, string>;
}): Promise<RazorpaySubscription> {
  return rzpFetch<RazorpaySubscription>('/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      plan_id: params.razorpayPlanId,
      total_count: params.totalBillingCycles ?? 12, // up to 12 months
      quantity: 1,
      customer_notify: params.customerNotify ? 1 : 0,
      notes: params.notes ?? {},
    }),
  });
}

/**
 * Cancel a Razorpay Subscription.
 * @param cancelAtCycleEnd - If true, cancels at the end of current billing cycle
 */
export async function cancelRazorpaySubscription(
  subscriptionId: string,
  cancelAtCycleEnd: boolean = true,
): Promise<RazorpaySubscription> {
  return rzpFetch<RazorpaySubscription>(`/subscriptions/${subscriptionId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ cancel_at_cycle_end: cancelAtCycleEnd ? 1 : 0 }),
  });
}

/**
 * Update an existing Razorpay subscription's quantity (seats) mid-cycle.
 *
 * Razorpay's subscription model multiplies plan_id.amount × quantity to
 * compute the period charge. Bumping `quantity` is the supported way to
 * grow seats without cancelling and recreating. Schedule_change_at:
 *   - 'now'       → next charge happens immediately at the new amount.
 *   - 'cycle_end' → next charge at end of current billing cycle (default;
 *                   schools keep what they paid for through the period).
 *
 * Plan_id changes are NOT supported on a running subscription by Razorpay;
 * a true plan swap requires cancel + create. This helper only changes
 * quantity. Callers wanting a plan swap must cancel and re-subscribe.
 */
export async function updateRazorpaySubscriptionQuantity(params: {
  subscriptionId: string;
  newQuantity: number;
  scheduleChangeAt?: 'now' | 'cycle_end';
}): Promise<RazorpaySubscription> {
  return rzpFetch<RazorpaySubscription>(`/subscriptions/${params.subscriptionId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      quantity: params.newQuantity,
      schedule_change_at: params.scheduleChangeAt ?? 'cycle_end',
    }),
  });
}

// ─── Orders (for one-time yearly payments) ──────────────────

interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  status: string;
}

/**
 * Create a one-time Razorpay Order (used for yearly plans).
 */
export async function createRazorpayOrder(params: {
  amountInr: number;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<RazorpayOrder> {
  return rzpFetch<RazorpayOrder>('/orders', {
    method: 'POST',
    body: JSON.stringify({
      amount: params.amountInr * 100, // convert to paisa for Razorpay
      currency: 'INR',
      receipt: params.receipt,
      notes: params.notes ?? {},
    }),
  });
}
