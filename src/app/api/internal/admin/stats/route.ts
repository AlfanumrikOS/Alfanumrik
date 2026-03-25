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
    if (!auth.authorized) {
      return NextResponse.json(
        { error: auth.reason || 'Unauthorized' },
        { status: 401 }
      );
    }

    // Query counts with individual error handling
    const queryCount = async (table: string, since?: string) => {
      try {
        let q = supabaseAdmin.from(table).select('*', { count: 'exact', head: true });
        if (since) q = q.gte('created_at', since);
        const { count, error } = await q;
        if (error) return 0;
        return count || 0;
      } catch {
        return 0;
      }
    };

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [studentCount, teacherCount, parentCount, quizCount, chatCount, auditCount] = await Promise.all([
      queryCount('students'),
      queryCount('teachers'),
      queryCount('guardians'),
      queryCount('quiz_sessions'),
      queryCount('chat_sessions'),
      queryCount('audit_logs'),
    ]);

    const [recentQuizzes, recentChats, recentSignups] = await Promise.all([
      queryCount('quiz_sessions', since),
      queryCount('chat_sessions', since),
      queryCount('students', since),
    ]);

    logAudit(auth.userId, { action: 'view', resourceType: 'system_stats' });

    return NextResponse.json({
      totals: {
        students: studentCount,
        teachers: teacherCount,
        parents: parentCount,
        quiz_sessions: quizCount,
        chat_sessions: chatCount,
        audit_logs: auditCount,
      },
      last_24h: {
        quizzes: recentQuizzes,
        chats: recentChats,
        signups: recentSignups,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('admin_stats_failed', { error: err instanceof Error ? err : new Error(message), route: '/api/internal/admin/stats' });
    return NextResponse.json({ error: 'Internal server error', details: message }, { status: 500 });
  }
}
