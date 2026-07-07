import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, isValidUUID } from '@alfanumrik/lib/admin-auth';
import { auditPiiReadThrottled } from '@alfanumrik/lib/admin-audit-throttle';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import {
  validateImpersonationSession,
  recordPageView,
} from '../../_lib/validate-session';

// GET /api/super-admin/students/[id]/dashboard — proxy dashboard data via impersonation
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Phase G.1: admin level required even for read because this route only
  // serves dashboard data while impersonating; impersonation start required
  // super_admin in /api/super-admin/students/[id]/impersonate POST.
  const auth = await authorizeAdmin(request, 'admin');
  if (!auth.authorized) return auth.response;

  const { id: studentId } = await params;
  if (!isValidUUID(studentId)) {
    return NextResponse.json({ error: 'Invalid student ID' }, { status: 400 });
  }

  // Phase G.5: throttled audit (1 entry per (admin,student,action)/hour)
  const ipAddress = request.headers.get('x-forwarded-for') || undefined;
  auditPiiReadThrottled(auth, 'student_dashboard.read', 'student', studentId, undefined, ipAddress);

  // Require active impersonation session
  const valid = await validateImpersonationSession(auth.adminId, studentId);
  if (!valid) {
    return NextResponse.json(
      { error: 'No active impersonation session' },
      { status: 403 }
    );
  }

  try {
    // Fetch student profile and dashboard data in parallel
    const [studentRes, dashboardRes] = await Promise.all([
      supabaseAdmin.from('students').select('*').eq('id', studentId).single(),
      supabaseAdmin.rpc('get_dashboard_data', { p_student_id: studentId }),
    ]);

    if (!studentRes.data) {
      return NextResponse.json({ error: 'Student not found' }, { status: 404 });
    }

    // Fire-and-forget page view tracking
    recordPageView(auth.adminId, studentId, 'dashboard');

    return NextResponse.json({
      student: studentRes.data,
      dashboard: dashboardRes.data || null,
    });
  } catch (err) {
    // If the RPC fails, fall back to direct queries
    try {
      const [studentRes, quizTodayRes, masteryRes] = await Promise.all([
        supabaseAdmin
          .from('students')
          .select('*')
          .eq('id', studentId)
          .single(),
        supabaseAdmin
          .from('quiz_sessions')
          .select('id', { count: 'exact', head: true })
          .eq('student_id', studentId)
          .gte('created_at', new Date().toISOString().split('T')[0]),
        supabaseAdmin
          .from('concept_mastery')
          .select('id', { count: 'exact', head: true })
          .eq('student_id', studentId),
      ]);

      if (!studentRes.data) {
        return NextResponse.json(
          { error: 'Student not found' },
          { status: 404 }
        );
      }

      // Fire-and-forget page view tracking
      recordPageView(auth.adminId, studentId, 'dashboard');

      return NextResponse.json({
        student: studentRes.data,
        dashboard: {
          xp: studentRes.data.xp_total || 0,
          streak: studentRes.data.streak_days || 0,
          quizzes_today: quizTodayRes.count || 0,
          mastery_count: masteryRes.count || 0,
        },
      });
    } catch (fallbackErr) {
      return NextResponse.json(
        {
          error:
            fallbackErr instanceof Error
              ? fallbackErr.message
              : 'Internal error',
        },
        { status: 500 }
      );
    }
  }
}
