import { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { ok, fail, type ServiceResult } from './types';
import { cancelRazorpaySubscription } from '@/lib/razorpay';

type BillingEnv = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceKey: string;
};

export type AuthedUser = {
  id: string;
  email: string | null;
};

/** Strip billing-cycle suffix and map legacy aliases to canonical plan code. */
export function canonicalizePlanCode(raw: string): string {
  return (raw || '')
    .replace(/_(monthly|yearly)$/, '')
    .replace(/^ultimate$/, 'unlimited')
    .replace(/^basic$/, 'starter')
    .replace(/^premium$/, 'pro');
}

export function getBillingEnv(): ServiceResult<BillingEnv> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
    return fail('Payment system not configured', 'INTERNAL');
  }

  return ok({ supabaseUrl, supabaseAnonKey, supabaseServiceKey });
}

export async function getAuthedUserFromRequest(
  request: NextRequest,
  env: BillingEnv
): Promise<ServiceResult<AuthedUser>> {
  try {
    const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll().map((c) => ({ name: c.name, value: c.value }));
        },
        setAll() {},
      },
    });

    let user = (await supabase.auth.getUser()).data.user;
    if (!user) {
      const authHeader = request.headers.get('Authorization');
      if (authHeader?.startsWith('Bearer ')) {
        const directClient = createClient(env.supabaseUrl, env.supabaseAnonKey, {
          global: { headers: { Authorization: authHeader } },
        });
        user = (await directClient.auth.getUser()).data.user;
      }
    }

    if (!user) {
      return fail('Unauthorized', 'UNAUTHORIZED');
    }

    return ok({ id: user.id, email: user.email ?? null });
  } catch (e) {
    return fail(
      `Auth resolution failed: ${e instanceof Error ? e.message : String(e)}`,
      'UNAUTHORIZED'
    );
  }
}

export function createBillingAdminClient(env: BillingEnv): SupabaseClient {
  return createClient(env.supabaseUrl, env.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function resolveStudentIdForUser(
  admin: SupabaseClient,
  user: AuthedUser
): Promise<ServiceResult<string>> {
  try {
    const { data: studentRow, error: studentErr } = await admin
      .from('students')
      .select('id')
      .eq('auth_user_id', user.id)
      .limit(1)
      .maybeSingle();

    if (studentErr) {
      logger.warn('billing_student_lookup_by_auth_user_failed', {
        error: studentErr.message,
        authUserId: user.id,
      });
    }

    if (studentRow?.id) {
      return ok(studentRow.id);
    }

    if (user.email) {
      const { data: byEmail, error: emailErr } = await admin
        .from('students')
        .select('id')
        .eq('email', user.email)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (emailErr) {
        logger.warn('billing_student_lookup_by_email_failed', {
          error: emailErr.message,
          email: user.email,
        });
      }

      if (byEmail?.id) {
        // Best-effort: repair auth_user_id mapping for future lookups.
        try {
          await admin.from('students').update({ auth_user_id: user.id }).eq('id', byEmail.id);
        } catch {
          // non-fatal
        }
        return ok(byEmail.id);
      }
    }

    return fail('Student not found', 'NOT_FOUND');
  } catch (e) {
    return fail(
      `Student resolution failed: ${e instanceof Error ? e.message : String(e)}`,
      'DB_ERROR'
    );
  }
}

export type CancelSubscriptionInput = {
  immediate: boolean;
  reason: string | null;
};

export type CancelSubscriptionResult =
  | { status: 'cancelled'; message: string }
  | { status: 'cancel_scheduled'; access_until: string; message: string };

export type SubscriptionPlanRow = {
  id: string;
  plan_code: string;
  name: string;
  price_monthly: number;
  price_yearly: number;
  razorpay_plan_id_monthly: string | null;
  is_active: boolean;
};

export async function getActivePlan(
  admin: SupabaseClient,
  planCode: string
): Promise<ServiceResult<SubscriptionPlanRow>> {
  const { data: plan, error } = await admin
    .from('subscription_plans')
    .select('id, plan_code, name, price_monthly, price_yearly, razorpay_plan_id_monthly, is_active')
    .eq('plan_code', planCode)
    .eq('is_active', true)
    .single();

  if (error || !plan) {
    return fail('Plan not available', 'NOT_FOUND');
  }

  return ok(plan as SubscriptionPlanRow);
}

export async function cancelSubscription(
  admin: SupabaseClient,
  studentId: string,
  input: CancelSubscriptionInput
): Promise<ServiceResult<CancelSubscriptionResult>> {
  const { immediate, reason } = input;

  const { data: sub, error: subErr } = await admin
    .from('student_subscriptions')
    .select('id, status, plan_code, razorpay_subscription_id, current_period_end, auto_renew')
    .eq('student_id', studentId)
    .single();

  if (subErr) {
    return fail(`Subscription fetch failed: ${subErr.message}`, 'DB_ERROR');
  }

  if (
    !sub ||
    sub.status === 'cancelled' ||
    sub.status === 'expired' ||
    sub.status === 'halted' ||
    sub.plan_code === 'free'
  ) {
    return fail('No active subscription to cancel', 'INVALID_INPUT');
  }

  if (sub.razorpay_subscription_id) {
    try {
      await cancelRazorpaySubscription(sub.razorpay_subscription_id, !immediate);
    } catch (err) {
      logger.error('billing_razorpay_cancel_failed', {
        error: err instanceof Error ? err : new Error(String(err)),
        rzSubId: sub.razorpay_subscription_id,
      });
    }
  }

  if (immediate) {
    await admin
      .from('student_subscriptions')
      .update({
        status: 'cancelled',
        auto_renew: false,
        cancelled_at: new Date().toISOString(),
        cancel_reason: reason,
        ended_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', sub.id);

    await admin.from('students').update({ subscription_plan: 'free' }).eq('id', studentId);

    await admin.from('subscription_events').insert({
      student_id: studentId,
      subscription_id: sub.id,
      event_type: 'cancelled_immediately',
      plan_code: sub.plan_code,
      status_before: sub.status,
      status_after: 'cancelled',
      metadata: { reason },
    });

    return ok({
      status: 'cancelled',
      message: 'Subscription cancelled. You have been downgraded to the free plan.',
    });
  }

  await admin
    .from('student_subscriptions')
    .update({
      auto_renew: false,
      cancelled_at: new Date().toISOString(),
      cancel_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sub.id);

  await admin.from('subscription_events').insert({
    student_id: studentId,
    subscription_id: sub.id,
    event_type: 'cancel_scheduled',
    plan_code: sub.plan_code,
    status_before: sub.status,
    status_after: sub.status,
    metadata: { reason, access_until: sub.current_period_end },
  });

  return ok({
    status: 'cancel_scheduled',
    access_until: sub.current_period_end,
    message: `Auto-renewal cancelled. You'll keep access until ${new Date(
      sub.current_period_end
    ).toLocaleDateString('en-IN')}.`,
  });
}

