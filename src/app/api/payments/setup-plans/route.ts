import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createRazorpayPlan } from '@/lib/razorpay';
import { logger } from '@/lib/logger';

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

    // Simple admin auth — only callable with the service role key as header
    if (!adminSecret || adminSecret !== serviceKey) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ error: 'Not configured' }, { status: 503 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Get paid plans that need Razorpay plan IDs
    const { data: plans } = await admin
      .from('subscription_plans')
      .select('id, plan_code, name, price_monthly, razorpay_plan_id_monthly')
      .eq('is_active', true)
      .gt('price_monthly', 0)
      .order('sort_order');

    if (!plans || plans.length === 0) {
      return NextResponse.json({ message: 'No paid plans found' });
    }

    const results: Array<{ plan_code: string; status: string; razorpay_plan_id?: string }> = [];

    for (const plan of plans) {
      if (plan.razorpay_plan_id_monthly) {
        results.push({
          plan_code: plan.plan_code,
          status: 'already_exists',
          razorpay_plan_id: plan.razorpay_plan_id_monthly,
        });
        continue;
      }

      try {
        const rzpPlan = await createRazorpayPlan(
          `Alfanumrik ${plan.name} Monthly`,
          plan.price_monthly,
        );

        await admin
          .from('subscription_plans')
          .update({ razorpay_plan_id_monthly: rzpPlan.id })
          .eq('id', plan.id);

        results.push({
          plan_code: plan.plan_code,
          status: 'created',
          razorpay_plan_id: rzpPlan.id,
        });
      } catch (err) {
        results.push({
          plan_code: plan.plan_code,
          status: `error: ${err instanceof Error ? err.message : 'unknown'}`,
        });
      }
    }

    return NextResponse.json({ results });
  } catch (err) {
    logger.error('Setup plans error', { error: err instanceof Error ? err : new Error(String(err)) });
    return NextResponse.json({ error: 'Setup failed' }, { status: 500 });
  }
}
