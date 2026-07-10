/**
 * POST /api/teacher/parent-notify — Phase 3A (Teacher Command Center) Wave D.
 *
 * "Tell the parent." A one-tap capability (e.g. on a remediation resolve) that
 * finds-or-creates the teacher↔parent thread for a roster student and appends a
 * single message — either a teacher-provided custom note or a factual, templated
 * one — REUSING the EXISTING teacher↔parent messaging infra
 * (`teacher_parent_threads` + `teacher_parent_messages`). No new table, no new
 * column, no new permission.
 *
 * Flow:
 *   1. `authorizeRequest('class.manage')` — the SAME gate the rest of the teacher
 *      messaging surface uses (P9). No new permission is introduced.
 *   2. Resolve caller → internal `teachers.id` (NEVER auth.uid()).
 *   3. Roster check (P8): the student must be on the caller's roster
 *      (class_teachers × class_enrollments), mirroring /api/teacher/remediation.
 *      403 if not.
 *   4. Resolve the student's guardian via `guardian_student_links`
 *      (approved/active, earliest = primary). NO linked guardian → a CLEAN 409
 *      `{ no_guardian: true }` (the UI shows "no parent linked") — NOT an error,
 *      and NO message is sent.
 *   5. Find-or-create the (teacher, guardian, student) thread — the same
 *      find-or-create logic the threads route uses.
 *   6. Compose the body: a provided `message` (sanitised) wins; otherwise a
 *      factual, parent-appropriate template for the `context`. If
 *      `include_report` is set, append a short inline progress-summary line
 *      (overall mastery + recent avg) — the "attachment" is an inline text
 *      summary, NOT a file (the messages table has no attachment column, so a
 *      migration-free inline summary / deep-link reference is the contract).
 *   7. Insert the message with `sender_role='teacher'`, bump the thread, drop an
 *      in-app notification for the guardian — the SAME insert path the existing
 *      teacher message-send route uses.
 *
 * Response 200: { thread_id, message_id }.
 *
 * Invariants: P5 grade strings (only surfaced, never parsed as int) · P8 roster
 * scope (server-verified) · P9 RBAC (class.manage) · P12 tone (factual,
 * parent/age-appropriate, no LLM output) · P13 no PII in logs.
 *
 * Errors: 400 invalid body · 401/403 auth · 403 non-roster / no teacher row ·
 *   409 no linked guardian · 500 db.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const BodySchema = z.object({
  student_id: z.string().regex(UUID_RE, 'student_id must be a valid UUID'),
  context: z.enum(['remediation_resolved', 'general']).default('general'),
  message: z.string().trim().min(1).max(4000).optional(),
  remediation_id: z.string().regex(UUID_RE, 'remediation_id must be a valid UUID').optional(),
  include_report: z.boolean().optional(),
});

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

/** Resolve the caller's internal teacher row. Null = no teacher profile. */
async function resolveTeacher(
  authUserId: string,
): Promise<{ id: string; school_id: string | null } | null> {
  const { data, error } = await supabaseAdmin
    .from('teachers')
    .select('id, school_id')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (error) {
    logger.error('teacher_parent_notify_teacher_lookup_failed', {
      error: new Error(error.message),
      route: 'teacher/parent-notify',
    });
    throw new Error('teacher_lookup_failed');
  }
  return (data as { id: string; school_id: string | null } | null) ?? null;
}

/**
 * Roster check (P8) — mirrors /api/teacher/remediation. A teacher "owns" a
 * student iff they share a class via class_teachers × class_enrollments. Returns
 * the shared class_id or null when the student is NOT on the roster.
 */
async function rosterClassId(teacherId: string, studentId: string): Promise<string | null> {
  const { data: teacherClasses, error: tcErr } = await supabaseAdmin
    .from('class_teachers')
    .select('class_id')
    .eq('teacher_id', teacherId);
  if (tcErr) {
    logger.error('teacher_parent_notify_class_teachers_lookup_failed', {
      error: new Error(tcErr.message),
      route: 'teacher/parent-notify',
    });
    throw new Error('roster_lookup_failed');
  }
  const classIds = (teacherClasses ?? [])
    .map((r) => (r as { class_id: string | null }).class_id)
    .filter((c): c is string => !!c);
  if (classIds.length === 0) return null;

  const { data: enrolment, error: csErr } = await supabaseAdmin
    .from('class_enrollments')
    .select('class_id')
    .eq('student_id', studentId)
    .in('class_id', classIds)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (csErr) {
    logger.error('teacher_parent_notify_class_enrollments_lookup_failed', {
      error: new Error(csErr.message),
      route: 'teacher/parent-notify',
    });
    throw new Error('roster_lookup_failed');
  }
  return (enrolment as { class_id: string } | null)?.class_id ?? null;
}

/** First name from a full name (template uses the given name only). */
function firstName(fullName: string | null | undefined): string {
  const trimmed = (fullName ?? '').trim();
  if (!trimmed) return 'Your child';
  return trimmed.split(/\s+/)[0];
}

/**
 * Inline progress summary line — the "attachment" for include_report. REUSES
 * Wave C's two read sources VERBATIM (concept_mastery p_know → percent;
 * quiz_sessions.score_percent → recent avg). No scoring/XP math, no new mastery
 * derivation, no file upload — a migration-free inline text summary. Returns
 * null (no line appended) when there is no signal yet.
 */
async function buildReportSummaryLine(studentId: string): Promise<string | null> {
  // Overall mastery = mean of round(p_know*100) over the student's BKT rows
  // (identical to get_student_mastery_report's mastery.overall_pct).
  let masteryPct: number | null = null;
  try {
    const { data: bkt } = await supabaseAdmin
      .from('concept_mastery')
      .select('p_know')
      .eq('student_id', studentId);
    const pcts = (bkt ?? []).map((r) =>
      Math.round((Number((r as { p_know?: number }).p_know) || 0) * 100),
    );
    if (pcts.length > 0) masteryPct = Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length);
  } catch {
    /* concept_mastery absent — omit mastery */
  }

  // Recent avg = mean of completed quiz_sessions.score_percent (identical to
  // get_student_mastery_report's recent.avg_score).
  let avgScore: number | null = null;
  try {
    const { data: sessions } = await supabaseAdmin
      .from('quiz_sessions')
      .select('score_percent, completed_at')
      .eq('student_id', studentId)
      .not('completed_at', 'is', null)
      .limit(5000);
    let sum = 0;
    let count = 0;
    for (const s of sessions ?? []) {
      const sp = (s as { score_percent?: number | null }).score_percent;
      if (sp != null) {
        sum += Number(sp);
        count += 1;
      }
    }
    if (count > 0) avgScore = Math.round(sum / count);
  } catch {
    /* quiz_sessions absent — omit recent avg */
  }

  const parts: string[] = [];
  if (masteryPct != null) parts.push(`overall mastery ${masteryPct}%`);
  if (avgScore != null) parts.push(`recent average ${avgScore}%`);
  if (parts.length === 0) return null;
  return `Quick progress snapshot: ${parts.join(', ')}.`;
}

/**
 * Factual, parent-appropriate templated body (P12 tone — no LLM output, age/
 * parent-appropriate). `remediation_resolved` names the student's first name and
 * the remediated concept when resolvable; `general` is a neutral check-in.
 */
function templatedBody(
  context: 'remediation_resolved' | 'general',
  studentFirstName: string,
  concept: string | null,
): string {
  if (context === 'remediation_resolved') {
    return concept
      ? `Good news! ${studentFirstName} has completed the practice I assigned on ${concept} and is making progress.`
      : `Good news! ${studentFirstName} has completed the extra practice I assigned and is making progress.`;
  }
  return `A quick update from your teacher about ${studentFirstName}'s learning.`;
}

export async function POST(request: NextRequest) {
  const auth = await authorizeRequest(request, 'class.manage');
  if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;

  // Validate body.
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0]?.message ?? 'Invalid body' : 'Invalid body';
    return err(msg, 400);
  }
  const { student_id, context, message, remediation_id, include_report } = body;

  // Resolve the internal teacher id (NEVER auth.uid()).
  let teacher: { id: string; school_id: string | null } | null;
  try {
    teacher = await resolveTeacher(auth.userId!);
  } catch {
    return err('Failed to resolve teacher', 500);
  }
  if (!teacher) return err('Teacher account not found', 403);

  // Roster check (P8).
  let classId: string | null;
  try {
    classId = await rosterClassId(teacher.id, student_id);
  } catch {
    return err('Failed to verify roster', 500);
  }
  if (!classId) return err('Student is not on your roster', 403);

  // Resolve the student's primary approved/active guardian. No linked guardian
  // is NOT an error — return a clean 409 so the UI shows "no parent linked".
  const { data: link, error: linkErr } = await supabaseAdmin
    .from('guardian_student_links')
    .select('guardian_id, status, created_at')
    .eq('student_id', student_id)
    .in('status', ['approved', 'active'])
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (linkErr) {
    logger.error('teacher_parent_notify_link_lookup_failed', {
      error: new Error(linkErr.message),
      route: 'teacher/parent-notify',
    });
    return err('Failed to resolve guardian', 500);
  }
  if (!link) {
    return NextResponse.json(
      { success: false, no_guardian: true, error: 'No parent linked to this student' },
      { status: 409 },
    );
  }
  const guardianId = (link as { guardian_id: string }).guardian_id;

  // ── Compose the message body ──
  let messageBody: string;
  if (message) {
    // Custom note wins (already trimmed + length-bounded by the schema).
    messageBody = message;
  } else {
    // Templated path. Resolve the remediated concept name (best-effort) for the
    // remediation_resolved template.
    const [{ data: studentRow }, conceptTitle] = await Promise.all([
      supabaseAdmin.from('students').select('id, name, grade').eq('id', student_id).maybeSingle(),
      resolveConceptTitle(teacher.id, student_id, remediation_id ?? null),
    ]);
    const studentFirst = firstName((studentRow as { name?: string } | null)?.name ?? null);
    messageBody = templatedBody(context, studentFirst, conceptTitle);
  }

  // ── Inline report "attachment" (migration-free) ──
  if (include_report) {
    const summaryLine = await buildReportSummaryLine(student_id);
    if (summaryLine) messageBody = `${messageBody}\n\n${summaryLine}`;
  }

  // ── Find-or-create the (teacher, guardian, student) thread ──
  // Mirrors the threads route's find-or-create logic.
  let threadId: string;
  const { data: existing, error: existingErr } = await supabaseAdmin
    .from('teacher_parent_threads')
    .select('id')
    .eq('teacher_id', teacher.id)
    .eq('guardian_id', guardianId)
    .eq('student_id', student_id)
    .maybeSingle();
  if (existingErr) {
    logger.error('teacher_parent_notify_thread_select_failed', {
      error: new Error(existingErr.message),
      route: 'teacher/parent-notify',
    });
    return err('Failed to resolve thread', 500);
  }

  if (existing) {
    threadId = (existing as { id: string }).id;
  } else {
    const { data: created, error: createErr } = await supabaseAdmin
      .from('teacher_parent_threads')
      .insert({
        teacher_id: teacher.id,
        guardian_id: guardianId,
        student_id: student_id,
        school_id: teacher.school_id ?? null,
        subject: null,
      })
      .select('id')
      .single();
    if (createErr || !created) {
      logger.error('teacher_parent_notify_thread_create_failed', {
        error: new Error(createErr?.message ?? 'no row returned'),
        route: 'teacher/parent-notify',
      });
      return err('Failed to create thread', 500);
    }
    threadId = (created as { id: string }).id;
  }

  // ── Insert the message (sender_role='teacher') — same insert path as the
  // existing teacher message-send route; the DB trigger bumps last_message_at. ──
  const { data: inserted, error: msgErr } = await supabaseAdmin
    .from('teacher_parent_messages')
    .insert({
      thread_id: threadId,
      sender_role: 'teacher',
      sender_auth_user_id: auth.userId!,
      body: messageBody,
    })
    .select('id, created_at')
    .single();
  if (msgErr || !inserted) {
    logger.error('teacher_parent_notify_message_insert_failed', {
      error: new Error(msgErr?.message ?? 'no row returned'),
      route: 'teacher/parent-notify',
    });
    return err('Failed to send message', 500);
  }
  const messageId = (inserted as { id: string }).id;

  // ── In-app notification for the guardian (best-effort) — mirrors the
  // teacher message-send route. The report "attachment" is referenced as a
  // deep-link to the student's progress, never a file. ──
  try {
    const notifBody = messageBody.length > 200 ? `${messageBody.slice(0, 200)}…` : messageBody;
    await supabaseAdmin.from('notifications').insert({
      recipient_id: guardianId,
      recipient_type: 'guardian',
      sender_id: teacher.id,
      sender_type: 'teacher',
      type: 'teacher_message',
      notification_type: 'teacher_message',
      title: 'New message from teacher',
      message: notifBody,
      body: notifBody,
      data: {
        thread_id: threadId,
        message_id: messageId,
        student_id,
        context,
        // Deep-link reference for the inline report (no file upload).
        report_ref: include_report ? { type: 'student_progress', student_id } : undefined,
      },
      is_read: false,
      delivery_channel: 'in_app',
    });
  } catch (e) {
    logger.warn('teacher_parent_notify_notification_insert_failed', {
      route: 'teacher/parent-notify',
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return NextResponse.json({ success: true, thread_id: threadId, message_id: messageId });
}

/**
 * Best-effort resolution of the remediated concept title for the template.
 * Prefers the named `remediation_id` (verified to belong to the caller-teacher +
 * student); falls back to the student's most recent open/resolved teacher
 * remediation. Returns null when no concept can be resolved (the template then
 * uses its concept-less variant). Read-only; never throws.
 */
async function resolveConceptTitle(
  teacherId: string,
  studentId: string,
  remediationId: string | null,
): Promise<string | null> {
  try {
    let q = supabaseAdmin
      .from('teacher_remediation_assignments')
      .select('id, teacher_id, student_id, chapter_id, status, created_at')
      .eq('teacher_id', teacherId)
      .eq('student_id', studentId);
    if (remediationId) q = q.eq('id', remediationId);
    const { data: rem } = await q
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const chapterId = (rem as { chapter_id?: string | null } | null)?.chapter_id ?? null;
    if (!chapterId) return null;

    const { data: topic } = await supabaseAdmin
      .from('curriculum_topics')
      .select('id, title')
      .eq('id', chapterId)
      .maybeSingle();
    const title = (topic as { title?: string | null } | null)?.title ?? null;
    return title && title.trim() ? title.trim() : null;
  } catch {
    return null;
  }
}
