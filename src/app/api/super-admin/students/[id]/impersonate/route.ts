import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, isValidUUID } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

// GET /api/super-admin/students/[id]/impersonate — check for active session
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  const { id: studentId } = await params;
  if (!isValidUUID(studentId)) {
    return NextResponse.json({ error: 'Invalid student ID' }, { status: 400 });
  }

  try {
    const now = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('admin_impersonation_sessions')
      .select('id, admin_id, student_id, started_at, expires_at, pages_viewed, ip_address')
      .eq('admin_id', auth.adminId)
      .eq('student_id', studentId)
      .is('ended_at', null)
      .gt('expires_at', now)
      .order('started_at', { ascending: false })
      .limit(1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const session = data?.[0] || null;
    let remainingSeconds = 0;

    if (session) {
      remainingSeconds = Math.max(
        0,
        Math.floor((new Date(session.expires_at).getTime() - Date.now()) / 1000)
      );
    }

    return NextResponse.json({
      active: !!session,
      session,
      remainingSeconds,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}

// POST /api/super-admin/students/[id]/impersonate — start new session
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  const { id: studentId } = await params;
  if (!isValidUUID(studentId)) {
    return NextResponse.json({ error: 'Invalid student ID' }, { status: 400 });
  }

  try {
    // Verify student exists
    const { data: student } = await supabaseAdmin
      .from('students')
      .select('id')
      .eq('id', studentId)
      .single();

    if (!student) {
      return NextResponse.json({ error: 'Student not found' }, { status: 404 });
    }

    const now = new Date().toISOString();

    // End any existing active session for this admin (any student)
    await supabaseAdmin
      .from('admin_impersonation_sessions')
      .update({ ended_at: now })
      .eq('admin_id', auth.adminId)
      .is('ended_at', null);

    // Create new session
    const ipAddress =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      null;

    const { data: session, error } = await supabaseAdmin
      .from('admin_impersonation_sessions')
      .insert({
        admin_id: auth.adminId,
        student_id: studentId,
        ip_address: ipAddress,
      })
      .select('id, admin_id, student_id, started_at, expires_at, pages_viewed, ip_address')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Audit log
    await logAdminAudit(
      auth,
      'impersonation_started',
      'student',
      studentId,
      { session_id: session.id },
      ipAddress || undefined
    );

    return NextResponse.json({ session }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}

// PATCH /api/super-admin/students/[id]/impersonate — end active session
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  const { id: studentId } = await params;
  if (!isValidUUID(studentId)) {
    return NextResponse.json({ error: 'Invalid student ID' }, { status: 400 });
  }

  try {
    const now = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('admin_impersonation_sessions')
      .update({ ended_at: now })
      .eq('admin_id', auth.adminId)
      .eq('student_id', studentId)
      .is('ended_at', null)
      .select('id');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const sessionId = data?.[0]?.id;

    // Audit log
    await logAdminAudit(
      auth,
      'impersonation_ended',
      'student',
      studentId,
      { session_id: sessionId || null },
      request.headers.get('x-forwarded-for') || undefined
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}
