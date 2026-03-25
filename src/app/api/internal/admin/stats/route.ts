import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * GET /api/internal/admin/stats — System overview stats
 *
 * Auth: ADMIN_SECRET_KEY header only (no RBAC dependency).
 * This avoids the authorizeRequest → cookie parsing → Sentry wrapping
 * chain that was causing 500 errors.
 */
export async function GET(request: NextRequest) {
  try {
    // Simple auth: check x-admin-key header
    const adminKey = request.headers.get('x-admin-key');
    const secretKey = process.env.SUPER_ADMIN_SECRET;

    if (!secretKey || !adminKey || adminKey !== secretKey) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Create a fresh Supabase admin client (avoids singleton issues)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }

    const db = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Query counts — each in try/catch so one failure doesn't kill all
    const count = async (table: string, since?: string) => {
      try {
        let q = db.from(table).select('*', { count: 'exact', head: true });
        if (since) q = q.gte('created_at', since);
        const { count: c } = await q;
        return c ?? 0;
      } catch {
        return -1; // indicates error
      }
    };

    const since24h = new Date(Date.now() - 86400000).toISOString();

    const [students, teachers, parents, quizzes, chats, audits, rQuizzes, rChats, rSignups] =
      await Promise.all([
        count('students'),
        count('teachers'),
        count('guardians'),
        count('quiz_sessions'),
        count('chat_sessions'),
        count('audit_logs'),
        count('quiz_sessions', since24h),
        count('chat_sessions', since24h),
        count('students', since24h),
      ]);

    return NextResponse.json({
      totals: { students, teachers, parents, quiz_sessions: quizzes, chat_sessions: chats, audit_logs: audits },
      last_24h: { quizzes: rQuizzes, chats: rChats, signups: rSignups },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal error', message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
