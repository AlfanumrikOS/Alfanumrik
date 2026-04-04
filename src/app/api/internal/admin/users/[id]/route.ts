import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSecret, logAdminAction } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

// GET /api/internal/admin/users/[id] — fetch single user detail
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;

  const supabase = getSupabaseAdmin();
  const { id } = await params;

  try {
    const [studentRes, quizRes, chatRes, masteryRes, activityRes] = await Promise.all([
      supabase.from('students').select('*').eq('id', id).single(),
      supabase.from('quiz_sessions').select('id,subject,score_percent,total_questions,correct_answers,is_completed,created_at').eq('student_id', id).order('created_at', { ascending: false }).limit(10),
      supabase.from('chat_sessions').select('id,subject,message_count,created_at').eq('student_id', id).order('created_at', { ascending: false }).limit(10),
      supabase.from('concept_mastery').select('subject,topic_id,mastery_score,last_reviewed_at').eq('student_id', id).order('mastery_score', { ascending: false }).limit(20),
      supabase.from('daily_activity').select('activity_date,xp_earned,quizzes_completed').eq('student_id', id).order('activity_date', { ascending: false }).limit(30),
    ]);

    if (!studentRes.data) return NextResponse.json({ error: 'Student not found' }, { status: 404 });

    return NextResponse.json({
      student: studentRes.data,
      recent_quizzes: quizRes.data || [],
      recent_chats: chatRes.data || [],
      top_mastery: masteryRes.data || [],
      activity_heatmap: activityRes.data || [],
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

// PATCH /api/internal/admin/users/[id] — update student fields + bulk actions
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;

  const supabase = getSupabaseAdmin();
  const { id } = await params;
  const ip = request.headers.get('x-forwarded-for') || '';

  try {
    const body = await request.json();
    const { action, ...updates } = body;

    // Named action shortcuts
    if (action === 'suspend') {
      await supabase.from('students').update({ is_active: false, account_status: 'suspended' }).eq('id', id);
      await logAdminAction({ action: 'suspend_student', entity_type: 'student', entity_id: id, ip });
      return NextResponse.json({ success: true, action: 'suspended' });
    }

    if (action === 'restore') {
      await supabase.from('students').update({ is_active: true, account_status: 'active' }).eq('id', id);
      await logAdminAction({ action: 'restore_student', entity_type: 'student', entity_id: id, ip });
      return NextResponse.json({ success: true, action: 'restored' });
    }

    if (action === 'reset_streak') {
      await supabase.from('students').update({ streak_days: 0 }).eq('id', id);
      await logAdminAction({ action: 'reset_streak', entity_type: 'student', entity_id: id, ip });
      return NextResponse.json({ success: true, action: 'streak_reset' });
    }

    if (action === 'reset_xp') {
      await supabase.from('students').update({ xp_total: 0 }).eq('id', id);
      await logAdminAction({ action: 'reset_xp', entity_type: 'student', entity_id: id, ip });
      return NextResponse.json({ success: true, action: 'xp_reset' });
    }

    if (action === 'upgrade_plan') {
      const plan = updates.plan || 'premium';
      await supabase.from('students').update({ subscription_plan: plan }).eq('id', id);
      await logAdminAction({ action: 'upgrade_plan', entity_type: 'student', entity_id: id, details: { plan }, ip });
      return NextResponse.json({ success: true, action: 'plan_upgraded', plan });
    }

    if (action === 'force_link_guardian') {
      const { guardian_email } = updates;
      if (!guardian_email) return NextResponse.json({ error: 'guardian_email required' }, { status: 400 });

      const { data: guardian } = await supabase.from('guardians').select('id').eq('email', guardian_email).single();
      if (!guardian) return NextResponse.json({ error: 'Guardian not found' }, { status: 404 });

      await supabase.from('guardian_student_links').upsert({
        guardian_id: guardian.id,
        student_id: id,
        status: 'approved',
      }, { onConflict: 'guardian_id,student_id' });

      await logAdminAction({ action: 'force_link_guardian', entity_type: 'student', entity_id: id, details: { guardian_email }, ip });
      return NextResponse.json({ success: true, action: 'guardian_linked' });
    }

    // Generic field update — allowlist enforced
    const ALLOWED = ['is_active', 'account_status', 'subscription_plan', 'grade', 'board', 'preferred_subject', 'school_name'];
    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(updates)) {
      if (ALLOWED.includes(k)) safe[k] = v;
    }

    if (Object.keys(safe).length === 0) {
      return NextResponse.json({ error: 'No valid fields' }, { status: 400 });
    }

    const { error } = await supabase.from('students').update(safe).eq('id', id);
    if (error) throw error;

    await logAdminAction({ action: 'update_student', entity_type: 'student', entity_id: id, details: safe, ip });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
