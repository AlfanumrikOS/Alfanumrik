import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSecret } from '@alfanumrik/lib/admin-auth';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;

  const supabase = getSupabaseAdmin();

  try {
    const since24h = new Date(Date.now() - 86400000).toISOString();
    const since7d  = new Date(Date.now() - 7 * 86400000).toISOString();

    // Live-data correctness parity with /api/super-admin/stats (the correct twin).
    // Drift fixes (2026-08-03, P2-1 PR-1):
    // 1. Chats: chat traffic migrated from legacy `chat_sessions` to `foxy_sessions`
    //    in Phase 2. Sum BOTH so chats are not under-reported by ~56x.
    // 2. is_demo filter: exclude demo accounts from real-user counts — students,
    //    teachers, guardians totals + the student signup windows — matching
    //    super-admin. Session counts (quiz/chat/foxy) are NOT is_demo-filtered.
    // 3. schools (deleted_at is null) + simulations catalog counts added for
    //    response-shape parity with super-admin.
    const [
      { count: students }, { count: teachers }, { count: guardians },
      { count: quizzes },
      { count: foxyChats }, { count: legacyChats },
      { count: interactiveSims }, { count: examSims }, { count: schools },
      { count: rStudents }, { count: rQuizzes },
      { count: rFoxyChats }, { count: rLegacyChats },
      { count: wStudents }, { count: wQuizzes },
    ] = await Promise.all([
      supabase.from('students').select('id', { count: 'exact', head: true }).eq('is_demo', false),
      supabase.from('teachers').select('id', { count: 'exact', head: true }).eq('is_demo', false),
      supabase.from('guardians').select('id', { count: 'exact', head: true }).eq('is_demo', false),
      supabase.from('quiz_sessions').select('id', { count: 'exact', head: true }),
      supabase.from('foxy_sessions').select('id', { count: 'exact', head: true }),
      supabase.from('chat_sessions').select('id', { count: 'exact', head: true }),
      supabase.from('interactive_simulations').select('id', { count: 'exact', head: true }),
      supabase.from('exam_simulations').select('id', { count: 'exact', head: true }),
      supabase.from('schools').select('id', { count: 'exact', head: true }).is('deleted_at', null),
      supabase.from('students').select('id', { count: 'exact', head: true }).eq('is_demo', false).gte('created_at', since24h),
      supabase.from('quiz_sessions').select('id', { count: 'exact', head: true }).gte('created_at', since24h),
      supabase.from('foxy_sessions').select('id', { count: 'exact', head: true }).gte('created_at', since24h),
      supabase.from('chat_sessions').select('id', { count: 'exact', head: true }).gte('created_at', since24h),
      supabase.from('students').select('id', { count: 'exact', head: true }).eq('is_demo', false).gte('created_at', since7d),
      supabase.from('quiz_sessions').select('id', { count: 'exact', head: true }).gte('created_at', since7d),
    ]);

    const chats = (foxyChats ?? 0) + (legacyChats ?? 0);
    const simulations = (interactiveSims ?? 0) + (examSims ?? 0);
    const rChats = (rFoxyChats ?? 0) + (rLegacyChats ?? 0);

    return NextResponse.json({
      totals: {
        students,
        teachers,
        parents: guardians,
        quiz_sessions: quizzes,
        chat_sessions: chats,
        foxy_sessions: foxyChats,
        legacy_chat_sessions: legacyChats,
        simulations,
        interactive_simulations: interactiveSims,
        exam_simulations: examSims,
        schools,
      },
      last_24h: { signups: rStudents, quizzes: rQuizzes, chats: rChats },
      last_7d: { signups: wStudents, quizzes: wQuizzes },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
