import { NextRequest, NextResponse } from 'next/server';

// Direct Supabase REST API helper — bypasses JS client entirely
async function supabaseRest(table: string, params: string = '', method: string = 'GET') {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');

  const res = await fetch(`${url}/rest/v1/${table}?${params}`, {
    method,
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Prefer': 'count=exact',
    },
  });

  return res;
}

async function countRows(table: string, filter?: string): Promise<number> {
  try {
    const params = `select=id&limit=0${filter ? `&${filter}` : ''}`;
    const res = await supabaseRest(table, params, 'HEAD');
    const range = res.headers.get('content-range'); // "0-0/123"
    if (range) {
      const total = range.split('/')[1];
      return parseInt(total) || 0;
    }
    return 0;
  } catch {
    return -1;
  }
}

function checkAuth(request: NextRequest): boolean {
  const adminKey = request.headers.get('x-admin-secret');
  const secretKey = process.env.SUPER_ADMIN_SECRET;
  return !!(secretKey && adminKey && adminKey === secretKey);
}

export async function GET(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const since24h = new Date(Date.now() - 86400000).toISOString();
    const since7d = new Date(Date.now() - 7 * 86400000).toISOString();

    const [students, teachers, parents, quizzes, chats,
           rStudents, rQuizzes, rChats,
           weekStudents, weekQuizzes] = await Promise.all([
      countRows('students'),
      countRows('teachers'),
      countRows('guardians'),
      countRows('quiz_sessions'),
      countRows('chat_sessions'),
      countRows('students', `created_at=gte.${since24h}`),
      countRows('quiz_sessions', `created_at=gte.${since24h}`),
      countRows('chat_sessions', `created_at=gte.${since24h}`),
      countRows('students', `created_at=gte.${since7d}`),
      countRows('quiz_sessions', `created_at=gte.${since7d}`),
    ]);

    return NextResponse.json({
      totals: { students, teachers, parents, quiz_sessions: quizzes, chat_sessions: chats },
      last_24h: { signups: rStudents, quizzes: rQuizzes, chats: rChats },
      last_7d: { signups: weekStudents, quizzes: weekQuizzes },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
