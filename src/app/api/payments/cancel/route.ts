import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cancelRazorpaySubscription } from '@/lib/razorpay';

/**
 * Cancel Subscription Endpoint
 *
 * Cancels auto-renew. Access continues until current period ends.
 * Optionally allows immediate cancellation.
 */
export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey || !serviceKey) {
      return NextResponse.json({ error: 'Not configured' }, { status: 503 });
    }

    // Auth
    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() { return request.cookies.getAll().map(c => ({ name: c.name, value: c.value })); },
        setAll() {},
      },
    });

    let user = (await supabase.auth.getUser()).data.user;
    if (!user) {
      const authHeader = request.headers.get('Authorization');
      if (authHeader?.startsWith('Bearer ')) {
        const directClient = createClient(supabaseUrl, supabaseKey, {
          global: { headers: { Authorization: authHeader } },
        });
        user = (await directClient.auth.getUser()).data.user;
      }
    }
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const immediate = body.immediate === true;
    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 500) : null;

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Get student + subscription
    const { data: studentRow } = await admin
      .from('students')
      .select('id')
      .eq('auth_user_id', user.id)
      .single();

    if (!studentRow) {
      return NextResponse.json({ error: 'Student not found' }, { status: 404 });
    }

    const { data: sub } = await admin
      .from('student_subscriptions')
      .select('id, status, plan_code, razorpay_subscription_id, current_period_end, auto_renew')
      .eq('student_id', studentRow.id)
      .single();

    if (!sub || sub.status === 'cancelled' || sub.status === 'expired' || sub.plan_code === 'free') {
      return NextResponse.json({ error: 'No active subscription to cancel' }, { status: 400 });
    }

    // Cancel on Razorpay if recurring
    if (sub.razorpay_subscription_id) {
      try {
        await cancelRazorpaySubscription(sub.razorpay_subscription_id, !immediate);
      } catch (err) {
        console.error('Razorpay cancel failed:', err);
        // Continue with local cancellation even if Razorpay call fails
      }
    }

    if (immediate) {
      // Immediate cancel: downgrade now
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

      await admin
        .from('students')
        .update({ subscription_plan: 'free' })
        .eq('id', studentRow.id);

      // Log event
      await admin.from('subscription_events').insert({
        student_id: studentRow.id,
        subscription_id: sub.id,
        event_type: 'cancelled_immediately',
        plan_code: sub.plan_code,
        status_before: sub.status,
        status_after: 'cancelled',
        metadata: { reason },
      });

      return NextResponse.json({
        success: true,
        status: 'cancelled',
        message: 'Subscription cancelled. You have been downgraded to the free plan.',
      });
    }

    // End-of-cycle cancel: keep access until period end
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
      student_id: studentRow.id,
      subscription_id: sub.id,
      event_type: 'cancel_scheduled',
      plan_code: sub.plan_code,
      status_before: sub.status,
      status_after: sub.status,
      metadata: { reason, access_until: sub.current_period_end },
    });

    return NextResponse.json({
      success: true,
      status: 'cancel_scheduled',
      access_until: sub.current_period_end,
      message: `Auto-renewal cancelled. You'll keep access until ${new Date(sub.current_period_end).toLocaleDateString('en-IN')}.`,
    });
  } catch (err) {
    console.error('Cancel error:', err);
    return NextResponse.json({ error: 'Cancellation failed' }, { status: 500 });
  }
}
