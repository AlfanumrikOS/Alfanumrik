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

/**
 * Create a Razorpay Plan for recurring billing.
 * @param name - Plan display name (e.g. "Alfanumrik Starter Monthly")
 * @param amountInr - Price in rupees
 */
export async function createRazorpayPlan(name: string, amountInr: number): Promise<RazorpayPlan> {
  return rzpFetch<RazorpayPlan>('/plans', {
    method: 'POST',
    body: JSON.stringify({
      period: 'monthly',
      interval: 1,
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
 * Fetch a Razorpay Subscription by ID.
 */
export async function fetchRazorpaySubscription(subscriptionId: string): Promise<RazorpaySubscription> {
  return rzpFetch<RazorpaySubscription>(`/subscriptions/${subscriptionId}`);
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
