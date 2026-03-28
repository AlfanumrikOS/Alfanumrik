import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, supabaseAdminHeaders, supabaseAdminUrl } from '../../../../lib/admin-auth';
import { cacheStats, cacheFetch, CACHE_TTL } from '../../../../lib/cache';

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
    const data = await cacheFetch('obs:platform', CACHE_TTL.SHORT, async () => {
      const since24h = new Date(Date.now() - 86400000).toISOString();
      const since7d = new Date(Date.now() - 7 * 86400000).toISOString();

      const [totalStudents, totalTeachers, totalParents,
             activeStudents24h, activeStudents7d,
             quizzes24h, chats24h, failedJobs, pendingJobs,
             auditEntries24h, totalQuestions, totalTopics,
             flagsEnabled, flagsTotal] = await Promise.all([
        countRows('students', 'deleted_at=is.null'),
        countRows('teachers'),
        countRows('guardians'),
        countRows('quiz_sessions', `created_at=gte.${since24h}`),
        countRows('quiz_sessions', `created_at=gte.${since7d}`),
        countRows('quiz_sessions', `created_at=gte.${since24h}`),
        countRows('chat_sessions', `created_at=gte.${since24h}`),
        countRows('task_queue', 'status=eq.failed'),
        countRows('task_queue', 'status=eq.pending'),
        countRows('admin_audit_log', `created_at=gte.${since24h}`),
        countRows('question_bank', 'deleted_at=is.null'),
        countRows('curriculum_topics', 'deleted_at=is.null'),
        countRows('feature_flags', 'is_enabled=eq.true'),
        countRows('feature_flags'),
      ]);

      return {
        health: { status: failedJobs > 10 ? 'degraded' : 'healthy', checked_at: new Date().toISOString() },
        users: { students: totalStudents, teachers: totalTeachers, parents: totalParents, active_24h: activeStudents24h, active_7d: activeStudents7d },
        activity_24h: { quizzes: quizzes24h, chats: chats24h, admin_actions: auditEntries24h },
        content: { topics: totalTopics, questions: totalQuestions },
        jobs: { failed: failedJobs, pending: pendingJobs },
        feature_flags: { enabled: flagsEnabled, total: flagsTotal },
        cache: cacheStats(),
      };
    });

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
