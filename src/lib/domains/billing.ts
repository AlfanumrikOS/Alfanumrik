/**
 * Billing Domain (B10) — read-only typed APIs.
 *
 * CONTRACT:
 *   - Server-only via supabaseAdmin. The ESLint `no-restricted-imports`
 *     rule allow-lists `src/lib/domains/**` and blocks all client callers.
 *   - All functions return ServiceResult<T>. Soft-fail on Postgres 42P01
 *     (relation missing) so planned-but-unprovisioned tables degrade
 *     gracefully — same precedent as analytics / assessment modules.
 *
 *   - **NO WRITES HERE.** Subscription activation, cancellation, and
 *     webhook processing stay in:
 *       * `src/app/api/payments/webhook/route.ts` (HMAC-verified writes)
 *       * `activate_subscription` RPC (primary atomic path)
 *       * `atomic_subscription_activation` RPC (P11 split-brain fallback)
 *     P11 (Payment Integrity) demands signature-verified writes only —
 *     wrapping a write helper in this module would make it accidentally
 *     callable from non-webhook server code, which is exactly the risk
 *     this module is trying to make impossible by exposing only reads.
 *
 * Phase 0g.1 scope (per docs/architecture/MICROSERVICES_EXTRACTION_PLAN.md):
 *   - subscription_plans  (read)
 *   - student_subscriptions (read — current sub for student)
 *   - payments            (read — list + single)
 *   - razorpay_orders     (read — by razorpay_order_id)
 *   - razorpay_webhooks   (read — admin surface only)
 *
 * Webhook RPC wiring (Phase 0g.2) is intentionally NOT in this commit and
 * must ship as a separate PR with backend + architect + testing review per
 * the P14 review chain for payment-flow changes.
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import {
  ok,
  fail,
  type ServiceResult,
  type SubscriptionPlan,
  type StudentSubscription,
  type Payment,
  type RazorpayOrder,
  type RazorpayWebhook,
} from './types';

// ── Shared helpers ────────────────────────────────────────────────────────────

const PG_RELATION_DOES_NOT_EXIST = '42P01';

function isMissingRelation(err: { code?: string | null } | null): boolean {
  return !!err && err.code === PG_RELATION_DOES_NOT_EXIST;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// ── subscription_plans ────────────────────────────────────────────────────────

type SubscriptionPlanRow = {
  id: string;
  plan_code: string;
  name: string | null;
  price_monthly: number | null;
  price_yearly: number | null;
  razorpay_plan_id_monthly: string | null;
  is_active: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

const SUBSCRIPTION_PLAN_COLUMNS =
  'id, plan_code, name, price_monthly, price_yearly, ' +
  'razorpay_plan_id_monthly, is_active, created_at, updated_at';

function mapSubscriptionPlan(row: SubscriptionPlanRow): SubscriptionPlan {
  return {
    id: row.id,
    planCode: row.plan_code,
    name: row.name,
    priceMonthly: row.price_monthly,
    priceYearly: row.price_yearly,
    razorpayPlanIdMonthly: row.razorpay_plan_id_monthly,
    isActive: row.is_active ?? false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * List subscription plans. Defaults to active-only, which matches every
 * customer-facing surface. Pass `activeOnly: false` for super-admin
 * inventory views.
 */
export async function listSubscriptionPlans(
  opts: { activeOnly?: boolean } = {}
): Promise<ServiceResult<SubscriptionPlan[]>> {
  const activeOnly = opts.activeOnly ?? true;

  let query = supabaseAdmin
    .from('subscription_plans')
    .select(SUBSCRIPTION_PLAN_COLUMNS)
    .order('price_monthly', { ascending: true, nullsFirst: true });

  if (activeOnly) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query;

  if (error) {
    if (isMissingRelation(error)) {
      logger.warn('billing_subscription_plans_table_missing', {
        error: error.message,
      });
    } else {
      logger.error('billing_list_subscription_plans_failed', {
        error: new Error(error.message),
      });
    }
    return fail(
      `subscription_plans lookup failed: ${error.message}`,
      'DB_ERROR'
    );
  }

  return ok(
    (data ?? []).map((r) => mapSubscriptionPlan(r as unknown as SubscriptionPlanRow))
  );
}

/**
 * Look up a subscription plan by its plan_code (e.g. 'free', 'pro_monthly').
 * Returns null (not an error) when the plan_code does not resolve.
 */
export async function getSubscriptionPlanByCode(
  planCode: string
): Promise<ServiceResult<SubscriptionPlan | null>> {
  if (!planCode) return fail('planCode is required', 'INVALID_INPUT');

  const { data, error } = await supabaseAdmin
    .from('subscription_plans')
    .select(SUBSCRIPTION_PLAN_COLUMNS)
    .eq('plan_code', planCode)
    .maybeSingle();

  if (error) {
    if (isMissingRelation(error)) {
      logger.warn('billing_subscription_plans_table_missing', {
        error: error.message,
      });
    } else {
      logger.error('billing_get_subscription_plan_failed', {
        error: new Error(error.message),
        planCode,
      });
    }
    return fail(
      `subscription_plans lookup failed: ${error.message}`,
      'DB_ERROR'
    );
  }

  return ok(
    data ? mapSubscriptionPlan(data as unknown as SubscriptionPlanRow) : null
  );
}

// ── student_subscriptions ─────────────────────────────────────────────────────

type StudentSubscriptionRow = {
  id: string;
  student_id: string;
  plan_id: string | null;
  plan_code: string | null;
  status: string | null;
  billing_cycle: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  next_billing_at: string | null;
  grace_period_end: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  renewal_attempts: number | null;
  auto_renew: boolean | null;
  amount_paid: number | null;
  razorpay_subscription_id: string | null;
  razorpay_payment_id: string | null;
  ended_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

const STUDENT_SUBSCRIPTION_COLUMNS =
  'id, student_id, plan_id, plan_code, status, billing_cycle, ' +
  'current_period_start, current_period_end, next_billing_at, ' +
  'grace_period_end, cancelled_at, cancel_reason, renewal_attempts, ' +
  'auto_renew, amount_paid, razorpay_subscription_id, razorpay_payment_id, ' +
  'ended_at, created_at, updated_at';

function mapStudentSubscription(row: StudentSubscriptionRow): StudentSubscription {
  return {
    id: row.id,
    studentId: row.student_id,
    planId: row.plan_id,
    planCode: row.plan_code,
    status: row.status,
    billingCycle: row.billing_cycle,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    nextBillingAt: row.next_billing_at,
    gracePeriodEnd: row.grace_period_end,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
    renewalAttempts: row.renewal_attempts ?? 0,
    autoRenew: row.auto_renew ?? false,
    amountPaid: row.amount_paid,
    razorpaySubscriptionId: row.razorpay_subscription_id,
    razorpayPaymentId: row.razorpay_payment_id,
    endedAt: row.ended_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Get the current subscription row for a student. Returns null (not an
 * error) when the student has never had a row written — common for fresh
 * signups before the auto-free-on-signup trigger fires.
 *
 * Callers that want plan display details should also call
 * getSubscriptionPlanByCode(sub.planCode) — they are joined at the route
 * layer rather than here so the projection stays narrow.
 */
export async function getStudentSubscription(
  studentId: string
): Promise<ServiceResult<StudentSubscription | null>> {
  if (!studentId) return fail('studentId is required', 'INVALID_INPUT');

  const { data, error } = await supabaseAdmin
    .from('student_subscriptions')
    .select(STUDENT_SUBSCRIPTION_COLUMNS)
    .eq('student_id', studentId)
    .maybeSingle();

  if (error) {
    if (isMissingRelation(error)) {
      logger.warn('billing_student_subscriptions_table_missing', {
        error: error.message,
      });
    } else {
      logger.error('billing_get_student_subscription_failed', {
        error: new Error(error.message),
        studentId,
      });
    }
    return fail(
      `student_subscriptions lookup failed: ${error.message}`,
      'DB_ERROR'
    );
  }

  return ok(
    data ? mapStudentSubscription(data as unknown as StudentSubscriptionRow) : null
  );
}

// ── payments ──────────────────────────────────────────────────────────────────

type PaymentRow = {
  id: string;
  student_id: string | null;
  razorpay_payment_id: string | null;
  razorpay_order_id: string | null;
  amount: number | null;
  currency: string | null;
  status: string | null;
  plan_code: string | null;
  billing_cycle: string | null;
  created_at: string | null;
  updated_at: string | null;
};

const PAYMENT_COLUMNS =
  'id, student_id, razorpay_payment_id, razorpay_order_id, amount, ' +
  'currency, status, plan_code, billing_cycle, created_at, updated_at';

function mapPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    studentId: row.student_id,
    razorpayPaymentId: row.razorpay_payment_id,
    razorpayOrderId: row.razorpay_order_id,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    planCode: row.plan_code,
    billingCycle: row.billing_cycle,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Look up a single payment row by primary key. Returns null when not found.
 */
export async function getPayment(
  paymentId: string
): Promise<ServiceResult<Payment | null>> {
  if (!paymentId) return fail('paymentId is required', 'INVALID_INPUT');

  const { data, error } = await supabaseAdmin
    .from('payments')
    .select(PAYMENT_COLUMNS)
    .eq('id', paymentId)
    .maybeSingle();

  if (error) {
    if (isMissingRelation(error)) {
      logger.warn('billing_payments_table_missing', { error: error.message });
    } else {
      logger.error('billing_get_payment_failed', {
        error: new Error(error.message),
        paymentId,
      });
    }
    return fail(`payments lookup failed: ${error.message}`, 'DB_ERROR');
  }

  return ok(data ? mapPayment(data as unknown as PaymentRow) : null);
}

/**
 * List payments. Bounded by either studentId (student/parent surfaces) or
 * status (admin surfaces). At least one filter is required to prevent
 * unbounded scans.
 */
export async function listPayments(opts: {
  studentId?: string;
  status?: string;
  limit?: number;
}): Promise<ServiceResult<Payment[]>> {
  if (!opts?.studentId && !opts?.status) {
    return fail(
      'At least one of studentId or status is required',
      'INVALID_INPUT'
    );
  }

  const limit = clamp(opts.limit ?? 50, 1, 200);

  let query = supabaseAdmin
    .from('payments')
    .select(PAYMENT_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (opts.studentId) query = query.eq('student_id', opts.studentId);
  if (opts.status) query = query.eq('status', opts.status);

  const { data, error } = await query;

  if (error) {
    if (isMissingRelation(error)) {
      logger.warn('billing_payments_table_missing', { error: error.message });
    } else {
      logger.error('billing_list_payments_failed', {
        error: new Error(error.message),
        studentId: opts.studentId,
        status: opts.status,
      });
    }
    return fail(`payments lookup failed: ${error.message}`, 'DB_ERROR');
  }

  return ok((data ?? []).map((r) => mapPayment(r as unknown as PaymentRow)));
}

// ── razorpay_orders ───────────────────────────────────────────────────────────

type RazorpayOrderRow = {
  id: string;
  razorpay_order_id: string;
  student_id: string | null;
  plan_code: string | null;
  amount: number | null;
  currency: string | null;
  status: string | null;
  receipt: string | null;
  notes: unknown;
  created_at: string | null;
  updated_at: string | null;
};

const RAZORPAY_ORDER_COLUMNS =
  'id, razorpay_order_id, student_id, plan_code, amount, currency, status, ' +
  'receipt, notes, created_at, updated_at';

function mapRazorpayOrder(row: RazorpayOrderRow): RazorpayOrder {
  return {
    id: row.id,
    razorpayOrderId: row.razorpay_order_id,
    studentId: row.student_id,
    planCode: row.plan_code,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    receipt: row.receipt,
    notes: row.notes ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Look up a Razorpay order by its razorpay_order_id (the external id
 * issued by Razorpay, NOT our internal primary key). Returns null when
 * the order id does not resolve.
 */
export async function getRazorpayOrderByOrderId(
  razorpayOrderId: string
): Promise<ServiceResult<RazorpayOrder | null>> {
  if (!razorpayOrderId) {
    return fail('razorpayOrderId is required', 'INVALID_INPUT');
  }

  const { data, error } = await supabaseAdmin
    .from('razorpay_orders')
    .select(RAZORPAY_ORDER_COLUMNS)
    .eq('razorpay_order_id', razorpayOrderId)
    .maybeSingle();

  if (error) {
    if (isMissingRelation(error)) {
      logger.warn('billing_razorpay_orders_table_missing', {
        error: error.message,
      });
    } else {
      logger.error('billing_get_razorpay_order_failed', {
        error: new Error(error.message),
        razorpayOrderId,
      });
    }
    return fail(`razorpay_orders lookup failed: ${error.message}`, 'DB_ERROR');
  }

  return ok(data ? mapRazorpayOrder(data as unknown as RazorpayOrderRow) : null);
}

// ── razorpay_webhooks ─────────────────────────────────────────────────────────

type RazorpayWebhookRow = {
  id: string;
  event_id: string | null;
  event_type: string | null;
  payload: unknown;
  signature_verified: boolean | null;
  processed: boolean | null;
  processing_error: string | null;
  created_at: string | null;
  processed_at: string | null;
};

const RAZORPAY_WEBHOOK_COLUMNS =
  'id, event_id, event_type, payload, signature_verified, processed, ' +
  'processing_error, created_at, processed_at';

function mapRazorpayWebhook(row: RazorpayWebhookRow): RazorpayWebhook {
  return {
    id: row.id,
    eventId: row.event_id,
    eventType: row.event_type,
    payload: row.payload ?? {},
    signatureVerified: row.signature_verified ?? false,
    processed: row.processed ?? false,
    processingError: row.processing_error,
    createdAt: row.created_at,
    processedAt: row.processed_at,
  };
}

/**
 * List recent Razorpay webhook records. **Admin surface only** — never
 * expose to student/parent/teacher routes. Newest first, default limit
 * 50, clamp 1..200.
 */
export async function listRazorpayWebhooks(
  opts: { eventType?: string; limit?: number } = {}
): Promise<ServiceResult<RazorpayWebhook[]>> {
  const limit = clamp(opts.limit ?? 50, 1, 200);

  let query = supabaseAdmin
    .from('razorpay_webhooks')
    .select(RAZORPAY_WEBHOOK_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (opts.eventType) query = query.eq('event_type', opts.eventType);

  const { data, error } = await query;

  if (error) {
    if (isMissingRelation(error)) {
      logger.warn('billing_razorpay_webhooks_table_missing', {
        error: error.message,
      });
    } else {
      logger.error('billing_list_razorpay_webhooks_failed', {
        error: new Error(error.message),
        eventType: opts.eventType,
      });
    }
    return fail(
      `razorpay_webhooks lookup failed: ${error.message}`,
      'DB_ERROR'
    );
  }

  return ok(
    (data ?? []).map((r) => mapRazorpayWebhook(r as unknown as RazorpayWebhookRow))
  );
}
