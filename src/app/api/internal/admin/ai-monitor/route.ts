import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSecret } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

// GET /api/internal/admin/ai-monitor
// Returns hourly AI usage for last 24h + error rate + top subjects
export async function GET(request: NextRequest) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;

  const supabase = getSupabaseAdmin();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  try {
    const [hourlyRes, chatSubjectRes, errorRes] = await Promise.all([
      // Hourly AI call counts
      supabase
        .from('ai_usage_stats')
        .select('hour_bucket,total_requests,total_tokens,error_count')
        .gte('hour_bucket', since24h)
        .order('hour_bucket', { ascending: true }),

      // Top subjects in chat sessions 24h
      supabase
        .from('chat_sessions')
        .select('subject')
        .gte('created_at', since24h),

      // AI errors from audit log
      supabase
        .from('audit_logs')
        .select('action,details,created_at')
        .like('action', '%ai%')
        .eq('status', 'failure')
        .gte('created_at', since24h)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    // Aggregate subject distribution
    const subjectCounts: Record<string, number> = {};
    for (const row of (chatSubjectRes.data || [])) {
      const s = (row as Record<string, unknown>).subject as string || 'unknown';
      subjectCounts[s] = (subjectCounts[s] || 0) + 1;
    }
    const topSubjects = Object.entries(subjectCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([subject, count]) => ({ subject, count }));

    const hourly = (hourlyRes.data || []).map((r: Record<string, unknown>) => ({
      hour: r.hour_bucket,
      requests: r.total_requests ?? 0,
      tokens: r.total_tokens ?? 0,
      errors: r.error_count ?? 0,
    }));

    const totalRequests = hourly.reduce((s, h) => s + (h.requests as number), 0);
    const totalErrors = hourly.reduce((s, h) => s + (h.errors as number), 0);

    return NextResponse.json({
      hourly,
      top_subjects: topSubjects,
      summary: {
        total_requests_24h: totalRequests,
        total_errors_24h: totalErrors,
        error_rate_pct: totalRequests > 0 ? Math.round((totalErrors / totalRequests) * 1000) / 10 : 0,
      },
      recent_errors: errorRes.data || [],
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
