import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, logAudit } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

/**
 * GET /api/internal/admin/stats — System overview stats
 * Permission: system.audit
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeRequest(request, 'system.audit');
    if (!auth.authorized) return auth.errorResponse!;

    const [students, teachers, guardians, quizSessions, chatSessions, auditLogs] = await Promise.all([
      supabaseAdmin.from('students').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('teachers').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('guardians').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('quiz_sessions').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('chat_sessions').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('audit_logs').select('id', { count: 'exact', head: true }),
    ]);

    // Recent activity (last 24h)
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [recentQuizzes, recentChats, recentSignups] = await Promise.all([
      supabaseAdmin.from('quiz_sessions').select('id', { count: 'exact', head: true }).gte('created_at', since),
      supabaseAdmin.from('chat_sessions').select('id', { count: 'exact', head: true }).gte('created_at', since),
      supabaseAdmin.from('students').select('id', { count: 'exact', head: true }).gte('created_at', since),
    ]);

    logAudit(auth.userId, { action: 'view', resourceType: 'system_stats' });

    return NextResponse.json({
      totals: {
        students: students.count || 0,
        teachers: teachers.count || 0,
        parents: guardians.count || 0,
        quiz_sessions: quizSessions.count || 0,
        chat_sessions: chatSessions.count || 0,
        audit_logs: auditLogs.count || 0,
      },
      last_24h: {
        quizzes: recentQuizzes.count || 0,
        chats: recentChats.count || 0,
        signups: recentSignups.count || 0,
      },
    });
  } catch (err) {
    logger.error('admin_stats_failed', { error: err instanceof Error ? err : new Error(String(err)), route: '/api/internal/admin/stats' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
