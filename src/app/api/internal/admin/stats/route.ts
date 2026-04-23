import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSecret } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;

  const supabase = getSupabaseAdmin();

  try {
    const since24h = new Date(Date.now() - 86400000).toISOString();
    const since7d  = new Date(Date.now() - 7 * 86400000).toISOString();

    const [
      { count: students }, { count: teachers }, { count: guardians },
      { count: quizzes }, { count: chats },
      { count: rStudents }, { count: rQuizzes }, { count: rChats },
      { count: wStudents }, { count: wQuizzes },
    ] = await Promise.all([
      supabase.from('identity.students').select('id', { count: 'exact', head: true }),
      supabase.from('identity.teachers').select('id', { count: 'exact', head: true }),
      supabase.from('identity.guardians').select('id', { count: 'exact', head: true }),
      supabase.from('quiz_sessions').select('id', { count: 'exact', head: true }),
      supabase.from('chat_sessions').select('id', { count: 'exact', head: true }),
      supabase.from('identity.students').select('id', { count: 'exact', head: true }).gte('created_at', since24h),
      supabase.from('quiz_sessions').select('id', { count: 'exact', head: true }).gte('created_at', since24h),
      supabase.from('chat_sessions').select('id', { count: 'exact', head: true }).gte('created_at', since24h),
      supabase.from('students').select('id', { count: 'exact', head: true }).gte('created_at', since7d),
      supabase.from('quiz_sessions').select('id', { count: 'exact', head: true }).gte('created_at', since7d),
    ]);

    return NextResponse.json({
      totals: { students, teachers, parents: guardians, quiz_sessions: quizzes, chat_sessions: chats },
      last_24h: { signups: rStudents, quizzes: rQuizzes, chats: rChats },
      last_7d: { signups: wStudents, quizzes: wQuizzes },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
