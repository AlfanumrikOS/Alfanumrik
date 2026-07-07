import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { createRazorpayPlan } from '@alfanumrik/lib/razorpay';
import { logger } from '@alfanumrik/lib/logger';
import { secureEqual } from '@alfanumrik/lib/secure-compare';

/**
 * Setup Razorpay Plans — Admin only
 *
 * Creates Razorpay Plan objects for each monthly paid plan
 * and stores the IDs in subscription_plans.razorpay_plan_id_monthly.
 *
 * Safe to call multiple times — skips plans that already have IDs.
 */
export async function POST(request: NextRequest) {
  try {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const adminSecret = request.headers.get('x-admin-secret');

    // Simple admin auth — only callable with the service role key as header.
    // Constant-time compare — naive `!==` short-circuits at the first
    // differing byte and leaks the service role key through response timing
    // (same fix as PR #610 admin-secret + cron-secret gates).
    if (!adminSecret || !serviceKey || !secureEqual(adminSecret, serviceKey)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ error: 'Not configured' }, { status: 503 });
    }

    const admin = supabaseAdmin;

    // Get paid plans that need Razorpay plan IDs
    const { data: plans } = await admin
      .from('subscription_plans')
      .select('id, plan_code, name, price_monthly, razorpay_plan_id_monthly, razorpay_plan_id_quarterly')
      .eq('is_active', true)
      .gt('price_monthly', 0)
      .order('sort_order');

    if (!plans || plans.length === 0) {
      return NextResponse.json({ message: 'No paid plans found' });
    }

    const results: Array<{
      plan_code: string;
      status: string;
      razorpay_plan_id?: string;
      razorpay_plan_id_quarterly?: string;
    }> = [];

    for (const plan of plans) {
      // ── Monthly plan provisioning (existing behaviour) ──
      let monthlyId: string | null = plan.razorpay_plan_id_monthly;
      let monthlyStatus = 'already_exists';
      if (!monthlyId) {
        try {
          const rzpPlan = await createRazorpayPlan(
            `Alfanumrik ${plan.name} Monthly`,
            plan.price_monthly,
          );
          monthlyId = rzpPlan.id;
          monthlyStatus = 'created';
          await admin
            .from('subscription_plans')
            .update({ razorpay_plan_id_monthly: rzpPlan.id })
            .eq('id', plan.id);
        } catch (err) {
          monthlyStatus = `error: ${err instanceof Error ? err.message : 'unknown'}`;
        }
      }

      // ── Quarterly plan provisioning ──
      // Quarterly is a monthly-period plan billed every 3rd interval. Razorpay
      // charges item.amount per interval, so the per-charge amount is
      // price_monthly × 3 (three months billed at the end of each quarter).
      let quarterlyId: string | null = plan.razorpay_plan_id_quarterly;
      let quarterlyStatus = 'already_exists';
      if (!quarterlyId) {
        try {
          const rzpQuarterly = await createRazorpayPlan(
            `Alfanumrik ${plan.name} Quarterly`,
            plan.price_monthly * 3,
            { interval: 3 },
          );
          quarterlyId = rzpQuarterly.id;
          quarterlyStatus = 'created';
          await admin
            .from('subscription_plans')
            .update({ razorpay_plan_id_quarterly: rzpQuarterly.id })
            .eq('id', plan.id);
        } catch (err) {
          quarterlyStatus = `error: ${err instanceof Error ? err.message : 'unknown'}`;
        }
      }

      results.push({
        plan_code: plan.plan_code,
        status: `monthly:${monthlyStatus}; quarterly:${quarterlyStatus}`,
        ...(monthlyId ? { razorpay_plan_id: monthlyId } : {}),
        ...(quarterlyId ? { razorpay_plan_id_quarterly: quarterlyId } : {}),
      });
    }

    return NextResponse.json({ results });
  } catch (err) {
    logger.error('Setup plans error', { error: err instanceof Error ? err : new Error(String(err)) });
    return NextResponse.json({ error: 'Setup failed' }, { status: 500 });
  }
}
