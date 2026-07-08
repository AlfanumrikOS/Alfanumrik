import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, supabaseAdminHeaders, supabaseAdminUrl } from '../../../../lib/admin-auth';

async function countRows(table: string, filter?: string): Promise<number> {
  try {
    const params = `select=id&limit=0${filter ? `&${filter}` : ''}`;
    const res = await fetch(supabaseAdminUrl(table, params), { method: 'HEAD', headers: supabaseAdminHeaders() });
    const range = res.headers.get('content-range');
    return range ? parseInt(range.split('/')[1]) || 0 : 0;
  } catch { return -1; }
}

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request, 'support');
  if (!auth.authorized) return auth.response;

  try {
    const since24h = new Date(Date.now() - 86400000).toISOString();
    const since7d = new Date(Date.now() - 7 * 86400000).toISOString();

    // Phase F.6 follow-up (2026-05-17): live-data correctness fixes.
    // 1. Chat sessions migrated from legacy `chat_sessions` to `foxy_sessions`
    //    in Phase 2; sum BOTH so we don't under-report by ~56x.
    // 2. NEW `simulations` field: catalog count of interactive_simulations +
    //    exam_simulations (115 prod). Replaces the hardcoded `19` literal in
    //    PlatformHealth + diagnostics widgets.
    // 3. NEW `schools` field: tenant count, also previously missing.
    const [students, teachers, parents, quizzes,
           foxyChats, legacyChats,
           interactiveSims, examSims, schools,
           rStudents, rQuizzes, rFoxyChats, rLegacyChats,
           weekStudents, weekQuizzes] = await Promise.all([
      countRows('students', 'is_demo=eq.false'),
      countRows('teachers', 'is_demo=eq.false'),
      countRows('guardians', 'is_demo=eq.false'),
      countRows('quiz_sessions'),
      countRows('foxy_sessions'),
      countRows('chat_sessions'),
      countRows('interactive_simulations'),
      countRows('exam_simulations'),
      countRows('schools', 'deleted_at=is.null'),
      countRows('students', `is_demo=eq.false&created_at=gte.${since24h}`),
      countRows('quiz_sessions', `created_at=gte.${since24h}`),
      countRows('foxy_sessions', `created_at=gte.${since24h}`),
      countRows('chat_sessions', `created_at=gte.${since24h}`),
      countRows('students', `is_demo=eq.false&created_at=gte.${since7d}`),
      countRows('quiz_sessions', `created_at=gte.${since7d}`),
    ]);

    const chats = foxyChats + legacyChats;
    const simulations = interactiveSims + examSims;
    const rChats = rFoxyChats + rLegacyChats;

    return NextResponse.json({
      totals: {
        students,
        teachers,
        parents,
        quiz_sessions: quizzes,
        chat_sessions: chats,
        // Live data fix: foxy_sessions + chat_sessions split + sum so the UI
        // can pick the dimension it cares about without losing data.
        foxy_sessions: foxyChats,
        legacy_chat_sessions: legacyChats,
        // Catalog counts (built-in simulations available, not student attempts).
        simulations,
        interactive_simulations: interactiveSims,
        exam_simulations: examSims,
        schools,
      },
      last_24h: { signups: rStudents, quizzes: rQuizzes, chats: rChats },
      last_7d: { signups: weekStudents, quizzes: weekQuizzes },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
