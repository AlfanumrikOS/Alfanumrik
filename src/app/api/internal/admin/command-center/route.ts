import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSecret, logAdminAction } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;

  const supabase = getSupabaseAdmin();
  const ip = request.headers.get('x-forwarded-for') || '';

  try {
    const now = new Date();
    const since1h  = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const since7d  = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const since30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Run all metric queries in parallel
    const [
      studentsRes, teachersRes, guardiansRes, schoolsRes,
      quiz24hRes, chat24hRes, newStudents24hRes, newStudents7dRes,
      activeStudents24hRes, activeStudents7dRes,
      aiUsage1hRes, aiUsage24hRes,
      revenueToday, revenue7d, revenue30d,
      premiumCount, basicCount,
      openTicketsRes, pendingTicketsRes,
      quizSessions7dRes,
    ] = await Promise.all([
      // Totals
      supabase.from('students').select('id', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('teachers').select('id', { count: 'exact', head: true }),
      supabase.from('guardians').select('id', { count: 'exact', head: true }),
      supabase.from('schools').select('id', { count: 'exact', head: true }),
      // Activity 24h
      supabase.from('quiz_sessions').select('id', { count: 'exact', head: true }).gte('created_at', since24h),
      supabase.from('chat_sessions').select('id', { count: 'exact', head: true }).gte('created_at', since24h),
      supabase.from('students').select('id', { count: 'exact', head: true }).gte('created_at', since24h),
      supabase.from('students').select('id', { count: 'exact', head: true }).gte('created_at', since7d),
      // DAU/WAU via daily_activity
      supabase.from('daily_activity').select('student_id', { count: 'exact', head: true }).gte('activity_date', since24h.slice(0, 10)),
      supabase.from('daily_activity').select('student_id', { count: 'exact', head: true }).gte('activity_date', since7d.slice(0, 10)),
      // AI usage
      supabase.from('ai_usage_stats').select('total_requests').gte('hour_bucket', since1h),
      supabase.from('ai_usage_stats').select('total_requests').gte('hour_bucket', since24h),
      // Revenue
      supabase.from('payment_history').select('amount').eq('status', 'captured').gte('created_at', now.toISOString().slice(0, 10)),
      supabase.from('payment_history').select('amount').eq('status', 'captured').gte('created_at', since7d),
      supabase.from('payment_history').select('amount').eq('status', 'captured').gte('created_at', since30d),
      // Subscriptions
      supabase.from('students').select('id', { count: 'exact', head: true }).eq('subscription_plan', 'premium').eq('is_active', true),
      supabase.from('students').select('id', { count: 'exact', head: true }).eq('subscription_plan', 'basic').eq('is_active', true),
      // Support
      supabase.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'open'),
      supabase.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      // Quiz sessions 7d for sparkline
      supabase.from('quiz_sessions').select('created_at').gte('created_at', since7d).order('created_at', { ascending: true }),
    ]);

    // Aggregate AI calls
    const aiCalls1h = (aiUsage1hRes.data || []).reduce((s: number, r: Record<string, unknown>) => s + (Number(r.total_requests) || 0), 0);
    const aiCalls24h = (aiUsage24hRes.data || []).reduce((s: number, r: Record<string, unknown>) => s + (Number(r.total_requests) || 0), 0);

    // Aggregate revenue
    const sumRevenue = (rows: Array<Record<string, unknown>>) =>
      (rows || []).reduce((s, r) => s + (Number(r.amount) || 0), 0) / 100; // paise → rupees

    const revToday = sumRevenue(revenueToday.data || []);
    const rev7d = sumRevenue(revenue7d.data || []);
    const rev30d = sumRevenue(revenue30d.data || []);

    // Build 7-day quiz sparkline (count per day)
    const sparkline: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10);
      sparkline[d] = 0;
    }
    for (const row of (quizSessions7dRes.data || [])) {
      const d = (row as Record<string, unknown>).created_at?.toString().slice(0, 10) || '';
      if (d in sparkline) sparkline[d]++;
    }

    logAdminAction({ action: 'view_command_center', entity_type: 'dashboard', ip });

    return NextResponse.json({
      totals: {
        students: studentsRes.count ?? 0,
        teachers: teachersRes.count ?? 0,
        guardians: guardiansRes.count ?? 0,
        schools: schoolsRes.count ?? 0,
        premium_students: premiumCount.count ?? 0,
        basic_students: basicCount.count ?? 0,
      },
      activity: {
        dau: activeStudents24hRes.count ?? 0,
        wau: activeStudents7dRes.count ?? 0,
        new_students_24h: newStudents24hRes.count ?? 0,
        new_students_7d: newStudents7dRes.count ?? 0,
        quiz_sessions_24h: quiz24hRes.count ?? 0,
        chat_sessions_24h: chat24hRes.count ?? 0,
      },
      ai: {
        calls_last_1h: aiCalls1h,
        calls_last_24h: aiCalls24h,
      },
      revenue: {
        today_inr: revToday,
        last_7d_inr: rev7d,
        last_30d_inr: rev30d,
      },
      support: {
        open_tickets: (openTicketsRes.count ?? 0) + (pendingTicketsRes.count ?? 0),
      },
      sparkline: Object.entries(sparkline).map(([date, quizzes]) => ({ date, quizzes })),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
