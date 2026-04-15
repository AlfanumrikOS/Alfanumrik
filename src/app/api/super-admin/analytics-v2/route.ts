import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, supabaseAdminHeaders, supabaseAdminUrl } from '../../../../lib/admin-auth';

async function supabaseRest(table: string, params: string = '') {
  const res = await fetch(supabaseAdminUrl(table, params), {
    headers: supabaseAdminHeaders('count=exact'),
  });
  return res;
}

async function countRows(table: string, filter?: string): Promise<number> {
  try {
    const params = `select=id&limit=0${filter ? `&${filter}` : ''}`;
    const res = await fetch(supabaseAdminUrl(table, params), {
      method: 'HEAD',
      headers: supabaseAdminHeaders(),
    });
    const range = res.headers.get('content-range');
    return range ? parseInt(range.split('/')[1]) || 0 : 0;
  } catch { return 0; }
}

async function safeJson<T>(res: Response): Promise<T[]> {
  try { const d = await res.json(); return Array.isArray(d) ? d : []; }
  catch { return []; }
}

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const today = new Date().toISOString().slice(0, 10);
    const todayStart = `${today}T00:00:00.000Z`;
    const since7d = new Date(Date.now() - 7 * 86400000).toISOString();
    const since7dDate = since7d.slice(0, 10);

    const [
      activeTodayRes,
      activeWeekRes,
      foxyTodayCount,
      foxyWeekCount,
      foxyTotalCount,
      chatTotalCount,
      quizTodayCount,
      quizWeekCount,
      quizTotalCount,
      stemTodayCount,
      stemWeekCount,
      stemTotalCount,
      plansTodayCount,
      plansWeekCount,
      plansTotalCount,
      gradeDistRes,
      subsDistRes,
      recentSignupsRes,
      foxyWeekRes,
      quizWeekRes,
    ] = await Promise.all([
      // Active users
      supabaseRest('student_daily_usage', `select=student_id&usage_date=eq.${today}&limit=20000`),
      supabaseRest('student_daily_usage', `select=student_id&usage_date=gte.${since7dDate}&limit=50000`),
      // Foxy (new table)
      countRows('foxy_sessions', `created_at=gte.${todayStart}`),
      countRows('foxy_sessions', `created_at=gte.${since7d}`),
      countRows('foxy_sessions'),
      countRows('chat_sessions'),
      // Quizzes
      countRows('quiz_sessions', `created_at=gte.${todayStart}`),
      countRows('quiz_sessions', `created_at=gte.${since7d}`),
      countRows('quiz_sessions'),
      // STEM Lab
      countRows('student_simulation_progress', `created_at=gte.${todayStart}`),
      countRows('student_simulation_progress', `created_at=gte.${since7d}`),
      countRows('student_simulation_progress'),
      // Study Plans
      countRows('study_plans', `created_at=gte.${todayStart}`),
      countRows('study_plans', `created_at=gte.${since7d}`),
      countRows('study_plans'),
      // Grade distribution: quiz sessions last 7d
      supabaseRest('quiz_sessions', `select=student_id,grade&created_at=gte.${since7d}&limit=50000`),
      // Subscription distribution: all non-demo students
      supabaseRest('students', `select=subscription_plan&is_demo=eq.false&limit=100000`),
      // Recent signups: last 10
      supabaseRest('students', `select=id,name,grade,board,created_at,subscription_plan&is_demo=eq.false&order=created_at.desc&limit=10`),
      // Top active: sessions last 7d (for aggregation)
      supabaseRest('foxy_sessions', `select=student_id&created_at=gte.${since7d}&limit=50000`),
      supabaseRest('quiz_sessions', `select=student_id&created_at=gte.${since7d}&limit=50000`),
    ]);

    // Active users
    const todayRows = await safeJson<{ student_id: string }>(activeTodayRes);
    const active_today = new Set(todayRows.map(r => r.student_id)).size;

    const weekRows = await safeJson<{ student_id: string }>(activeWeekRes);
    const active_week = new Set(weekRows.map(r => r.student_id)).size;

    // Grade distribution
    const gradeRows = await safeJson<{ student_id: string; grade: string }>(gradeDistRes);
    const gradeMap = new Map<string, Set<string>>();
    for (const r of gradeRows) {
      if (!r.grade) continue;
      if (!gradeMap.has(r.grade)) gradeMap.set(r.grade, new Set());
      gradeMap.get(r.grade)!.add(r.student_id);
    }
    const grade_distribution = ['6', '7', '8', '9', '10', '11', '12'].map(g => ({
      grade: g,
      count: gradeMap.get(g)?.size ?? 0,
    }));

    // Subscription distribution
    const subsRows = await safeJson<{ subscription_plan: string | null }>(subsDistRes);
    const dist: Record<string, number> = { free: 0, starter: 0, pro: 0, unlimited: 0 };
    for (const r of subsRows) {
      const plan = (r.subscription_plan || 'free').toLowerCase();
      dist[plan] = (dist[plan] || 0) + 1;
    }

    // Recent signups
    const signupRows = await safeJson<{
      id: string; name: string; grade: string; board: string;
      created_at: string; subscription_plan: string;
    }>(recentSignupsRes);

    const ids = signupRows.map(s => s.id);
    let recent_signups: {
      id: string; name: string; grade: string; board: string;
      created_at: string; subscription_plan: string;
      quiz_count: number; foxy_count: number;
    }[] = [];

    if (ids.length > 0) {
      const idList = ids.join(',');
      const [qCountRes, fCountRes] = await Promise.all([
        supabaseRest('quiz_sessions', `select=student_id&student_id=in.(${idList})&limit=5000`),
        supabaseRest('foxy_sessions', `select=student_id&student_id=in.(${idList})&limit=5000`),
      ]);
      const qRows = await safeJson<{ student_id: string }>(qCountRes);
      const fRows = await safeJson<{ student_id: string }>(fCountRes);
      const quizCounts: Record<string, number> = {};
      const foxyCounts: Record<string, number> = {};
      for (const r of qRows) quizCounts[r.student_id] = (quizCounts[r.student_id] || 0) + 1;
      for (const r of fRows) foxyCounts[r.student_id] = (foxyCounts[r.student_id] || 0) + 1;
      recent_signups = signupRows.map(s => ({
        ...s,
        quiz_count: quizCounts[s.id] || 0,
        foxy_count: foxyCounts[s.id] || 0,
      }));
    } else {
      recent_signups = signupRows.map(s => ({ ...s, quiz_count: 0, foxy_count: 0 }));
    }

    // Top active students
    const foxyW = await safeJson<{ student_id: string }>(foxyWeekRes);
    const quizW = await safeJson<{ student_id: string }>(quizWeekRes);
    const actMap: Record<string, { foxy: number; quiz: number }> = {};
    for (const r of foxyW) { actMap[r.student_id] ??= { foxy: 0, quiz: 0 }; actMap[r.student_id].foxy++; }
    for (const r of quizW) { actMap[r.student_id] ??= { foxy: 0, quiz: 0 }; actMap[r.student_id].quiz++; }
    const topIds = Object.entries(actMap)
      .sort(([, a], [, b]) => (b.foxy + b.quiz) - (a.foxy + a.quiz))
      .slice(0, 10)
      .map(([id]) => id);

    let top_active: {
      id: string; name: string; grade: string;
      foxy_sessions: number; quiz_sessions: number;
    }[] = [];

    if (topIds.length > 0) {
      const studRes = await supabaseRest(
        'students',
        `select=id,name,grade&id=in.(${topIds.join(',')})&is_demo=eq.false&limit=10`
      );
      const studRows = await safeJson<{ id: string; name: string; grade: string }>(studRes);
      top_active = topIds.map(id => {
        const s = studRows.find(r => r.id === id);
        return {
          id,
          name: s?.name || 'Unknown',
          grade: s?.grade || '—',
          foxy_sessions: actMap[id].foxy,
          quiz_sessions: actMap[id].quiz,
        };
      });
    }

    return NextResponse.json({
      active_today,
      active_week,
      total_foxy_all_time: foxyTotalCount + chatTotalCount,
      grade_distribution,
      feature_usage: {
        foxy:        { today: foxyTodayCount,  week: foxyWeekCount,  total: foxyTotalCount + chatTotalCount },
        quizzes:     { today: quizTodayCount,  week: quizWeekCount,  total: quizTotalCount },
        stem_lab:    { today: stemTodayCount,  week: stemWeekCount,  total: stemTotalCount },
        study_plans: { today: plansTodayCount, week: plansWeekCount, total: plansTotalCount },
      },
      subscription_distribution: dist,
      recent_signups,
      top_active,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
