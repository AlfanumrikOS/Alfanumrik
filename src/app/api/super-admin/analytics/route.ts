import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, supabaseAdminHeaders, supabaseAdminUrl } from '../../../../lib/admin-auth';

// Direct Supabase REST API helper — bypasses JS client entirely
async function supabaseRest(table: string, params: string = '', method: string = 'GET', body?: string) {
  const res = await fetch(supabaseAdminUrl(table, params), {
    method,
    headers: supabaseAdminHeaders('count=exact'),
    ...(body ? { body } : {}),
  });

  return res;
}

// Build an array of date strings for the last N days (YYYY-MM-DD)
function lastNDays(n: number): string[] {
  const days: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

// Count rows by date from an array of objects with created_at
function countByDate(rows: { created_at: string }[], days: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const d of days) counts[d] = 0;
  for (const row of rows) {
    const day = row.created_at?.slice(0, 10);
    if (day && counts[day] !== undefined) counts[day]++;
  }
  return counts;
}

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const since30d = new Date(Date.now() - 30 * 86400000).toISOString();
    const since7d = new Date(Date.now() - 7 * 86400000).toISOString();
    const since1d = new Date(Date.now() - 86400000).toISOString();
    const days = lastNDays(30);

    // Fire all queries in parallel
    const [
      signupsRes,
      quizzesRes,
      chatsRes,
      subjectsRes,
      plansRes,
      active1dRes,
      active7dRes,
      active30dRes,
      chaptersRes,
      topicsRes,
      questionsRes,
      topStudentsRes,
    ] = await Promise.all([
      // 1. Engagement: signups in last 30 days
      supabaseRest('students', `select=created_at&created_at=gte.${since30d}&order=created_at.asc&limit=10000`),
      // 2. Engagement: quizzes in last 30 days
      supabaseRest('quiz_sessions', `select=created_at&created_at=gte.${since30d}&order=created_at.asc&limit=10000`),
      // 3. Engagement: chats in last 30 days
      supabaseRest('chat_sessions', `select=created_at&created_at=gte.${since30d}&order=created_at.asc&limit=10000`),
      // 4. Popular subjects: all quiz sessions with subject
      supabaseRest('quiz_sessions', `select=subject&limit=50000`),
      // 5. Revenue: subscription plan breakdown
      supabaseRest('students', `select=subscription_plan&limit=50000`),
      // 6. Retention: active in last 1d (using quiz or chat activity)
      supabaseRest('quiz_sessions', `select=student_id&created_at=gte.${since1d}&limit=50000`),
      supabaseRest('quiz_sessions', `select=student_id&created_at=gte.${since7d}&limit=50000`),
      supabaseRest('quiz_sessions', `select=student_id&created_at=gte.${since30d}&limit=50000`),
      // 7. Content stats (curriculum_topics is the actual table)
      supabaseRest('curriculum_topics', `select=id&parent_topic_id=is.null&deleted_at=is.null&limit=0`, 'HEAD'),
      supabaseRest('curriculum_topics', `select=id&deleted_at=is.null&limit=0`, 'HEAD'),
      supabaseRest('question_bank', `select=id&deleted_at=is.null&limit=0`, 'HEAD'),
      // 8. Top students by XP
      supabaseRest('students', `select=id,name,email,grade,xp_total,streak_days,avatar_url&order=xp_total.desc.nullslast&limit=10`),
    ]);

    // Parse JSON responses — safe fallback to empty array if any query failed
    const safeJson = async <T>(res: Response): Promise<T[]> => {
      try { const d = await res.json(); return Array.isArray(d) ? d : []; }
      catch { return []; }
    };
    const [signups, quizzes, chats, subjectRows, planRows, active1dRows, active7dRows, active30dRows, topStudents] =
      await Promise.all([
        safeJson<{ created_at: string }>(signupsRes),
        safeJson<{ created_at: string }>(quizzesRes),
        safeJson<{ created_at: string }>(chatsRes),
        safeJson<{ subject: string }>(subjectsRes),
        safeJson<{ subscription_plan: string | null }>(plansRes),
        safeJson<{ student_id: string }>(active1dRes),
        safeJson<{ student_id: string }>(active7dRes),
        safeJson<{ student_id: string }>(active30dRes),
        safeJson<{ id: string; name: string; email: string; grade: string; xp_total: number; streak_days: number; avatar_url: string | null }>(topStudentsRes),
      ]);

    // --- 1. Engagement: daily breakdown ---
    const signupsByDate = countByDate(signups, days);
    const quizzesByDate = countByDate(quizzes, days);
    const chatsByDate = countByDate(chats, days);

    const engagement = days.map((date) => ({
      date,
      signups: signupsByDate[date] || 0,
      quizzes: quizzesByDate[date] || 0,
      chats: chatsByDate[date] || 0,
    }));

    // --- 2. Popular subjects ---
    const subjectCounts: Record<string, number> = {};
    for (const row of subjectRows) {
      const s = row.subject || 'unknown';
      subjectCounts[s] = (subjectCounts[s] || 0) + 1;
    }
    const popular_subjects = Object.entries(subjectCounts)
      .map(([subject, count]) => ({ subject, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    // --- 3. Revenue: subscription plan breakdown ---
    const planCounts: Record<string, number> = {};
    for (const row of planRows) {
      const plan = row.subscription_plan || 'free';
      planCounts[plan] = (planCounts[plan] || 0) + 1;
    }
    const revenue = Object.entries(planCounts)
      .map(([plan, count]) => ({ plan, count }))
      .sort((a, b) => b.count - a.count);

    // --- 4. Retention: unique active students (array format for frontend .map()) ---
    const uniqueCount = (rows: { student_id: string }[]) => new Set(rows.map((r) => r.student_id)).size;
    const retention = [
      { period: '24h', count: uniqueCount(active1dRows) },
      { period: '7d', count: uniqueCount(active7dRows) },
      { period: '30d', count: uniqueCount(active30dRows) },
    ];

    // --- 5. Content stats ---
    const parseCount = (res: Response): number => {
      const range = res.headers.get('content-range');
      if (range) {
        const total = range.split('/')[1];
        return parseInt(total) || 0;
      }
      return 0;
    };
    const content_stats = {
      chapters: parseCount(chaptersRes),
      topics: parseCount(topicsRes),
      questions: parseCount(questionsRes),
    };

    // --- 6. Top students ---
    const top_students = (Array.isArray(topStudents) ? topStudents : []).map((s) => ({
      id: s.id,
      name: s.name,
      email: s.email,
      grade: s.grade,
      xp_total: s.xp_total ?? 0,
      streak_days: s.streak_days ?? 0,
      avatar_url: s.avatar_url,
    }));

    return NextResponse.json({
      engagement,
      popular_subjects,
      revenue,
      retention,
      content_stats,
      top_students,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
