import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, supabaseAdminHeaders, supabaseAdminUrl } from '../../../../lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

async function countRows(table: string, filter?: string): Promise<number> {
  try {
    const params = `select=id&limit=0${filter ? `&${filter}` : ''}`;
    const res = await fetch(supabaseAdminUrl(table, params), { method: 'HEAD', headers: supabaseAdminHeaders() });
    const range = res.headers.get('content-range');
    return range ? parseInt(range.split('/')[1]) || 0 : 0;
  } catch { return -1; }
}

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const since24h = new Date(Date.now() - 86400000).toISOString();
    const since7d = new Date(Date.now() - 7 * 86400000).toISOString();

    const [students, teachers, parents, quizzes, chats,
           rStudents, rQuizzes, rChats, weekStudents, weekQuizzes,
           revenueRes, aiHealthRes] = await Promise.all([
      countRows('students', 'is_demo=eq.false'),
      countRows('teachers', 'is_demo=eq.false'),
      countRows('guardians', 'is_demo=eq.false'),
      countRows('quiz_sessions'),
      countRows('chat_sessions'),
      countRows('students', `is_demo=eq.false&created_at=gte.${since24h}`),
      countRows('quiz_sessions', `created_at=gte.${since24h}`),
      countRows('chat_sessions', `created_at=gte.${since24h}`),
      countRows('students', `is_demo=eq.false&created_at=gte.${since7d}`),
      countRows('quiz_sessions', `created_at=gte.${since7d}`),
      // Revenue metrics (RPC returns: active_subs, mrr, churn_rate, plan_distribution, failed_payments)
      Promise.resolve(supabaseAdmin.rpc('admin_revenue_metrics')).then(r => r.data).catch(() => null),
      // AI health (RPC returns: api_success_rate, circuit_breaker_state, avg_response_ms, rag_hit_rate)
      Promise.resolve(supabaseAdmin.rpc('admin_ai_health')).then(r => r.data).catch(() => null),
    ]);

    return NextResponse.json({
      totals: { students, teachers, parents, quiz_sessions: quizzes, chat_sessions: chats },
      last_24h: { signups: rStudents, quizzes: rQuizzes, chats: rChats },
      last_7d: { signups: weekStudents, quizzes: weekQuizzes },
      revenue: revenueRes || {},
      ai_health: aiHealthRes || {},
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
