import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, supabaseAdminHeaders, supabaseAdminUrl } from '../../../../lib/admin-auth';

// ---------------------------------------------------------------------------
// Supabase REST helper
// ---------------------------------------------------------------------------
async function supabaseRest(
  table: string,
  params: string,
  options: { method?: string; prefer?: string; body?: unknown } = {},
) {
  const { method = 'GET', prefer = 'count=exact', body } = options;
  const res = await fetch(supabaseAdminUrl(table, params), {
    method,
    headers: supabaseAdminHeaders(prefer),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return res;
}

// ---------------------------------------------------------------------------
// GET  — support query actions
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const params = new URL(request.url).searchParams;
    const action = params.get('action');

    // -----------------------------------------------------------------------
    // user_activity — recent sessions & daily usage for a user
    // -----------------------------------------------------------------------
    if (action === 'user_activity') {
      const userId = params.get('user_id');
      if (!userId) {
        return NextResponse.json({ error: 'Missing "user_id" param.' }, { status: 400 });
      }

      const [quizRes, chatRes, usageRes] = await Promise.all([
        supabaseRest(
          'quiz_sessions',
          `select=*&student_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=20`,
        ),
        supabaseRest(
          'chat_sessions',
          `select=*&student_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=20`,
        ),
        supabaseRest(
          'student_daily_usage',
          `select=*&student_id=eq.${encodeURIComponent(userId)}&order=usage_date.desc&limit=7`,
        ),
      ]);

      const [quizSessions, chatSessions, dailyUsage] = await Promise.all([
        quizRes.json(),
        chatRes.json(),
        usageRes.json(),
      ]);

      return NextResponse.json({
        quiz_sessions: quizSessions,
        chat_sessions: chatSessions,
        daily_usage: dailyUsage,
      });
    }

    // -----------------------------------------------------------------------
    // failed_jobs — failed entries in task_queue
    // -----------------------------------------------------------------------
    if (action === 'failed_jobs') {
      const res = await supabaseRest(
        'task_queue',
        'select=*&status=eq.failed&order=created_at.desc&limit=50',
      );

      const data = await res.json();
      const range = res.headers.get('content-range');
      const total = range ? parseInt(range.split('/')[1]) || 0 : data.length;

      return NextResponse.json({ data, total });
    }

    // -----------------------------------------------------------------------
    // parent_links — guardian-student relationships for a student
    // -----------------------------------------------------------------------
    if (action === 'parent_links') {
      const studentId = params.get('student_id');
      if (!studentId) {
        return NextResponse.json({ error: 'Missing "student_id" param.' }, { status: 400 });
      }

      const res = await supabaseRest(
        'guardian_student_links',
        `select=*,guardians(id,name,email)&student_id=eq.${encodeURIComponent(studentId)}&order=created_at.desc`,
      );

      if (!res.ok) {
        const text = await res.text();
        return NextResponse.json({ error: `Supabase error: ${text}` }, { status: res.status });
      }

      const data = await res.json();
      return NextResponse.json(data);
    }

    // -----------------------------------------------------------------------
    // class_mappings — class enrollments for a student
    // -----------------------------------------------------------------------
    if (action === 'class_mappings') {
      const studentId = params.get('student_id');
      if (!studentId) {
        return NextResponse.json({ error: 'Missing "student_id" param.' }, { status: 400 });
      }

      const res = await supabaseRest(
        'class_students',
        `select=*,classes(id,name,grade,section,subject_code,teacher_id)&student_id=eq.${encodeURIComponent(studentId)}&order=created_at.desc`,
      );

      if (!res.ok) {
        const text = await res.text();
        return NextResponse.json({ error: `Supabase error: ${text}` }, { status: res.status });
      }

      const data = await res.json();
      return NextResponse.json(data);
    }

    return NextResponse.json(
      { error: 'Unknown action. Use: user_activity, failed_jobs, parent_links, class_mappings.' },
      { status: 400 },
    );
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — support intervention actions
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();
    const action = body.action;

    // -----------------------------------------------------------------------
    // resend_invite — queue a resend-invite task
    // -----------------------------------------------------------------------
    if (action === 'resend_invite') {
      const { email, type } = body;
      if (!email || !type) {
        return NextResponse.json({ error: 'Missing "email" or "type".' }, { status: 400 });
      }

      const validTypes = ['student', 'teacher', 'parent'];
      if (!validTypes.includes(type)) {
        return NextResponse.json(
          { error: `Invalid type. Use: ${validTypes.join(', ')}.` },
          { status: 400 },
        );
      }

      const res = await supabaseRest('task_queue', '', {
        method: 'POST',
        prefer: 'return=representation',
        body: {
          type: 'resend_invite',
          status: 'pending',
          payload: { email, user_type: type },
          created_at: new Date().toISOString(),
        },
      });

      if (!res.ok) {
        const text = await res.text();
        return NextResponse.json({ error: `Failed to queue invite: ${text}` }, { status: res.status });
      }

      const created = await res.json();
      return NextResponse.json({ success: true, data: created }, { status: 201 });
    }

    // -----------------------------------------------------------------------
    // fix_relationship — update a parent link or class enrollment
    // -----------------------------------------------------------------------
    if (action === 'fix_relationship') {
      const { type, id, updates } = body;
      if (!type || !id || !updates || typeof updates !== 'object') {
        return NextResponse.json({ error: 'Missing "type", "id", or "updates".' }, { status: 400 });
      }

      const TABLE_MAP: Record<string, string> = {
        parent_link: 'guardian_student_links',
        class_enrollment: 'class_students',
      };

      const ALLOWED_FIELDS: Record<string, string[]> = {
        parent_link: ['status', 'relationship', 'guardian_id', 'student_id'],
        class_enrollment: ['status', 'student_id', 'class_id', 'is_active'],
      };

      const table = TABLE_MAP[type];
      const allowed = ALLOWED_FIELDS[type];
      if (!table || !allowed) {
        return NextResponse.json(
          { error: 'Invalid type. Use: parent_link, class_enrollment.' },
          { status: 400 },
        );
      }

      // Sanitise fields
      const safe: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(updates)) {
        if (allowed.includes(k)) safe[k] = v;
      }
      if (Object.keys(safe).length === 0) {
        return NextResponse.json({ error: 'No valid fields to update.' }, { status: 400 });
      }

      // Perform update
      const updateRes = await supabaseRest(
        table,
        `id=eq.${encodeURIComponent(id)}`,
        { method: 'PATCH', prefer: 'return=representation', body: safe },
      );

      if (!updateRes.ok) {
        const text = await updateRes.text();
        return NextResponse.json({ error: `Update failed: ${text}` }, { status: updateRes.status });
      }

      const updated = await updateRes.json();
      if (Array.isArray(updated) && updated.length === 0) {
        return NextResponse.json({ error: 'No record found with that id.' }, { status: 404 });
      }

      // Log to audit trail
      await logAdminAudit(auth, 'fix_relationship', type, id, { updates: safe });

      return NextResponse.json({ success: true, data: updated });
    }

    // -----------------------------------------------------------------------
    // reset_password — trigger a password reset email
    // -----------------------------------------------------------------------
    if (action === 'reset_password') {
      const { email } = body;
      if (!email) {
        return NextResponse.json({ error: 'Missing "email".' }, { status: 400 });
      }

      const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

      const res = await fetch(`${url}/auth/v1/recover`, {
        method: 'POST',
        headers: {
          'apikey': key,
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        const text = await res.text();
        return NextResponse.json({ error: `Password reset failed: ${text}` }, { status: res.status });
      }

      return NextResponse.json({ success: true, message: `Password reset email sent to ${email}.` });
    }

    return NextResponse.json(
      { error: 'Unknown action. Use: resend_invite, fix_relationship, reset_password.' },
      { status: 400 },
    );
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
