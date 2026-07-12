/**
 * /api/teacher/remediation — Phase 3A (Teacher Command Center) Wave A / A2.
 *
 * POST — a teacher assigns targeted remediation to a student on a weak concept
 *        (heatmap cell) or off an at-risk alert ("general" remediation, no
 *        chapter). Writes one `teacher_remediation_assignments` row (status
 *        'assigned'). Idempotent in TWO layers:
 *        (1) per-teacher pre-check — if an OPEN row (assigned | in_progress)
 *            already exists for (teacher, student, class, chapter) it is returned
 *            rather than duplicated;
 *        (2) DB backstop — the partial unique index
 *            uq_teacher_remediation_assignments_open_dedupe (migration
 *            20260619000400; key student × class × chapter-bucket WHERE
 *            status='assigned', teacher_id deliberately NOT in the key) turns
 *            a cross-teacher or check-then-insert-race duplicate INSERT into
 *            a 23505, which is handled as idempotent success: the surviving
 *            assigned row is looked up and returned (200), never a 500.
 *
 * GET  — lists the caller-teacher's remediation assignments, optionally
 *        filtered by status / class. Roster-scoped (a teacher only ever sees
 *        rows they assigned).
 *
 * Auth: `class.assign_remediation` permission (A1 migration seeds it onto the
 *        teacher role) AND a server-side exact-class roster check. The selected
 *        class must be active in the teacher's school, with active
 *        `class_teachers` and `class_enrollments` rows. RLS also enforces the DB
 *        path; this route repeats every boundary because its service client
 *        bypasses RLS.
 *
 * Identity contract (A1, non-negotiable):
 *   - teacher_id  = internal `teachers.id`   (resolved from auth.uid(), NEVER auth.uid())
 *   - student_id  = `students.id`
 *   - chapter_id  = `curriculum_topics.id`   (nullable — general/alert remediation)
 *   - source_alert_id = `at_risk_alerts.id`  (nullable)
 *   - class_id    = `classes.id`             (caller-selected, server-verified)
 *   - status      ∈ assigned | in_progress | resolved | dismissed
 *
 * P9 RBAC (route gate) · P8 exact-class scope (server-verified) · P5 grade
 * normalized only for curriculum matching · P13 no PII in logs.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const PostBodySchema = z.object({
  class_id: z.string().regex(UUID_RE, 'class_id must be a valid UUID'),
  student_id: z.string().regex(UUID_RE, 'student_id must be a valid UUID'),
  chapter_id: z.string().regex(UUID_RE, 'chapter_id must be a valid UUID').nullable().optional(),
  source_alert_id: z
    .string()
    .regex(UUID_RE, 'source_alert_id must be a valid UUID')
    .nullable()
    .optional(),
});

const OPEN_STATUSES = ['assigned', 'in_progress'] as const;
const ALL_STATUSES = ['assigned', 'in_progress', 'resolved', 'dismissed'] as const;

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

/**
 * Resolve the internal teacher row for the authenticated caller.
 * Returns null when the caller has no teacher profile.
 */
async function resolveTeacher(authUserId: string): Promise<
  { id: string; school_id: string | null } | null
> {
  const { data, error } = await supabaseAdmin
    .from('teachers')
    .select('id, school_id')
    .eq('auth_user_id', authUserId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) {
    logger.error('teacher_remediation_teacher_lookup_failed', {
      error: new Error(error.message),
      route: 'teacher/remediation',
    });
    throw new Error('teacher_lookup_failed');
  }
  return (data as { id: string; school_id: string | null } | null) ?? null;
}

type TeacherIdentity = { id: string; school_id: string | null };
type RemediationClassScope = {
  id: string;
  school_id: string;
  grade: string;
  subject: string | null;
};

function canonicalGrade(value: string): string | null {
  const match = value.trim().match(/^(?:(?:grade|class)\s*-?\s*)?(\d{1,2})(?:st|nd|rd|th)?$/i);
  if (!match) return null;
  const grade = Number(match[1]);
  return grade >= 6 && grade <= 12 ? String(grade) : null;
}

function subjectKey(value: string): string {
  return value.trim().toLocaleLowerCase('en-IN').replace(/[^a-z0-9]+/g, '');
}

/**
 * Resolve the exact caller-selected class scope. The service-role client
 * bypasses RLS, so every relationship is re-checked explicitly here:
 * active teacher-class assignment, active student enrollment, active class,
 * and matching school membership for teacher, class, and student.
 */
async function resolveRemediationClassScope(
  teacher: TeacherIdentity,
  classId: string,
  studentId: string,
): Promise<RemediationClassScope | null> {
  if (!teacher.school_id) return null;

  const { data: classRow, error: classError } = await supabaseAdmin
    .from('classes')
    .select('id, school_id, grade, subject')
    .eq('id', classId)
    .eq('school_id', teacher.school_id)
    .eq('is_active', true)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();
  if (classError) {
    logger.error('teacher_remediation_class_lookup_failed', {
      error: new Error(classError.message),
      route: 'teacher/remediation',
    });
    throw new Error('class_scope_lookup_failed');
  }
  const selectedClass = classRow as {
    id: string;
    school_id: string | null;
    grade: string;
    subject: string | null;
  } | null;
  if (!selectedClass?.school_id) return null;

  const { data: teacherClass, error: teacherClassError } = await supabaseAdmin
    .from('class_teachers')
    .select('class_id')
    .eq('teacher_id', teacher.id)
    .eq('class_id', classId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (teacherClassError) {
    logger.error('teacher_remediation_class_teacher_lookup_failed', {
      error: new Error(teacherClassError.message),
      route: 'teacher/remediation',
    });
    throw new Error('class_scope_lookup_failed');
  }
  if (!teacherClass) return null;

  const { data: enrolment, error: enrolmentError } = await supabaseAdmin
    .from('class_enrollments')
    .select('class_id')
    .eq('class_id', classId)
    .eq('student_id', studentId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (enrolmentError) {
    logger.error('teacher_remediation_class_enrollment_lookup_failed', {
      error: new Error(enrolmentError.message),
      route: 'teacher/remediation',
    });
    throw new Error('class_scope_lookup_failed');
  }
  if (!enrolment) return null;

  const { data: student, error: studentError } = await supabaseAdmin
    .from('students')
    .select('id')
    .eq('id', studentId)
    .eq('school_id', selectedClass.school_id)
    .eq('is_active', true)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();
  if (studentError) {
    logger.error('teacher_remediation_student_scope_lookup_failed', {
      error: new Error(studentError.message),
      route: 'teacher/remediation',
    });
    throw new Error('class_scope_lookup_failed');
  }
  if (!student) return null;

  return {
    id: selectedClass.id,
    school_id: selectedClass.school_id,
    grade: selectedClass.grade,
    subject: selectedClass.subject,
  };
}

/** Validate that a requested curriculum topic is published for this class. */
async function curriculumTopicAllowed(
  classScope: RemediationClassScope,
  chapterId: string,
): Promise<boolean> {
  const grade = canonicalGrade(classScope.grade);
  if (!grade || !classScope.subject) return false;

  const { data: topic, error: topicError } = await supabaseAdmin
    .from('curriculum_topics')
    .select('id, subject_id')
    .eq('id', chapterId)
    .eq('grade', grade)
    .eq('is_active', true)
    .eq('content_status', 'published')
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();
  if (topicError) {
    logger.error('teacher_remediation_topic_lookup_failed', {
      error: new Error(topicError.message),
      route: 'teacher/remediation',
    });
    throw new Error('topic_scope_lookup_failed');
  }
  const scopedTopic = topic as { id: string; subject_id: string } | null;
  if (!scopedTopic) return false;

  const { data: subject, error: subjectError } = await supabaseAdmin
    .from('subjects')
    .select('id, code, name')
    .eq('id', scopedTopic.subject_id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (subjectError) {
    logger.error('teacher_remediation_subject_lookup_failed', {
      error: new Error(subjectError.message),
      route: 'teacher/remediation',
    });
    throw new Error('topic_scope_lookup_failed');
  }
  const scopedSubject = subject as { id: string; code: string; name: string } | null;
  if (!scopedSubject) return false;

  const classSubject = subjectKey(classScope.subject);
  return classSubject.length > 0
    && [scopedSubject.code, scopedSubject.name].some((value) => subjectKey(value) === classSubject);
}

// ─── POST: assign remediation ────────────────────────────────
export async function POST(request: NextRequest) {
  const auth = await authorizeRequest(request, 'class.assign_remediation');
  if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;

  // Validate body.
  let body: z.infer<typeof PostBodySchema>;
  try {
    body = PostBodySchema.parse(await request.json());
  } catch (e) {
    const msg =
      e instanceof z.ZodError ? e.issues[0]?.message ?? 'Invalid body' : 'Invalid body';
    return err(msg, 400);
  }
  const classId = body.class_id;
  const studentId = body.student_id;
  const chapterId = body.chapter_id ?? null;
  const sourceAlertId = body.source_alert_id ?? null;

  // Resolve the internal teacher id (NEVER auth.uid()).
  let teacher: { id: string; school_id: string | null } | null;
  try {
    teacher = await resolveTeacher(auth.userId!);
  } catch {
    return err('Failed to resolve teacher', 500);
  }
  if (!teacher) return err('Teacher account not found', 403);

  // The caller's selected class is an authorization boundary. Never replace it
  // with an arbitrary shared class when a learner is enrolled in more than one.
  let classScope: RemediationClassScope | null;
  try {
    classScope = await resolveRemediationClassScope(teacher, classId, studentId);
  } catch {
    return err('Failed to verify class roster', 500);
  }
  if (!classScope) return err('Class or student is not available for remediation', 403);

  if (chapterId) {
    let topicAllowed = false;
    try {
      topicAllowed = await curriculumTopicAllowed(classScope, chapterId);
    } catch {
      return err('Failed to verify curriculum topic', 500);
    }
    if (!topicAllowed) return err('Topic is not available for the selected class', 403);
  }

  // A source alert is evidence, not caller-controlled metadata. When present,
  // bind it to the same learner, roster-derived class and internal teacher
  // before storing the foreign key. This prevents a forged URL/body from
  // attaching another teacher's or learner's alert to the remediation.
  if (sourceAlertId) {
    const { data: sourceAlert, error: sourceAlertError } = await supabaseAdmin
      .from('at_risk_alerts')
      .select('id')
      .eq('id', sourceAlertId)
      .eq('student_id', studentId)
      .eq('class_id', classId)
      .eq('teacher_id', teacher.id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    if (sourceAlertError) {
      logger.error('teacher_remediation_source_alert_lookup_failed', {
        error: new Error(sourceAlertError.message),
        route: 'teacher/remediation',
      });
      return err('Failed to verify source alert', 500);
    }
    if (!sourceAlert) return err('Source alert is not available for this learner', 403);
  }

  // Idempotency: an OPEN row for (teacher, student, class, chapter) already covers
  // this assignment — return it instead of duplicating. chapter_id is matched
  // including the NULL case (general remediation), so re-assigning general
  // remediation for the same student is also idempotent.
  let existingQuery = supabaseAdmin
    .from('teacher_remediation_assignments')
    .select(
      'id, teacher_id, student_id, class_id, chapter_id, source_alert_id, status, created_at, resolved_at',
    )
    .eq('teacher_id', teacher.id)
    .eq('student_id', studentId)
    .eq('class_id', classId)
    .in('status', OPEN_STATUSES as unknown as string[]);
  existingQuery = chapterId
    ? existingQuery.eq('chapter_id', chapterId)
    : existingQuery.is('chapter_id', null);

  const { data: existing, error: existingErr } = await existingQuery
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingErr) {
    logger.error('teacher_remediation_idempotency_lookup_failed', {
      error: new Error(existingErr.message),
      route: 'teacher/remediation',
    });
    return err('Failed to assign remediation', 500);
  }
  if (existing) {
    return NextResponse.json({ success: true, data: existing, idempotent: true }, { status: 200 });
  }

  // Insert the new assignment (status 'assigned').
  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('teacher_remediation_assignments')
    .insert({
      teacher_id: teacher.id,
      student_id: studentId,
      class_id: classId,
      chapter_id: chapterId,
      source_alert_id: sourceAlertId,
      status: 'assigned',
    })
    .select(
      'id, teacher_id, student_id, class_id, chapter_id, source_alert_id, status, created_at, resolved_at',
    )
    .single();
  if (insertErr) {
    // 23505 = the partial unique dedupe index
    // (uq_teacher_remediation_assignments_open_dedupe, migration
    // 20260619000400) caught a duplicate OPEN row for the same
    // (student, class, chapter-bucket). The pre-check above is keyed
    // per-teacher, so a COLLEAGUE's open row — or a concurrent request racing
    // this non-atomic check-then-insert — surfaces here as a unique violation
    // instead of via the pre-check. Same duplicate signal to the student →
    // same idempotent-success contract as the pre-check path: look up the
    // surviving assigned row on the index's natural key (student, class,
    // chapter eq-or-IS-NULL, status='assigned' — NOT teacher_id) and return it.
    if (insertErr.code === '23505') {
      let survivorQuery = supabaseAdmin
        .from('teacher_remediation_assignments')
        .select(
          'id, teacher_id, student_id, class_id, chapter_id, source_alert_id, status, created_at, resolved_at',
        )
        .eq('student_id', studentId)
        .eq('class_id', classId)
        .eq('status', 'assigned');
      survivorQuery = chapterId
        ? survivorQuery.eq('chapter_id', chapterId)
        : survivorQuery.is('chapter_id', null);
      const { data: survivor, error: survivorErr } = await survivorQuery
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (survivorErr || !survivor) {
        // Conflict reported but the surviving row can't be resolved (e.g. it
        // transitioned between the failed insert and this lookup) — fall back
        // to the established failure response; the teacher can simply retry.
        logger.error('teacher_remediation_dedupe_lookup_failed', {
          error: new Error(survivorErr?.message ?? 'no surviving assigned row found'),
          route: 'teacher/remediation',
        });
        return err('Failed to assign remediation', 500);
      }
      return NextResponse.json(
        { success: true, data: survivor, idempotent: true },
        { status: 200 },
      );
    }
    logger.error('teacher_remediation_insert_failed', {
      error: new Error(insertErr.message),
      route: 'teacher/remediation',
    });
    return err('Failed to assign remediation', 500);
  }

  return NextResponse.json({ success: true, data: inserted }, { status: 201 });
}

// ─── GET: list the caller-teacher's assignments ──────────────
export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'class.assign_remediation');
  if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;

  // Resolve the internal teacher id (NEVER auth.uid()).
  let teacher: { id: string; school_id: string | null } | null;
  try {
    teacher = await resolveTeacher(auth.userId!);
  } catch {
    return err('Failed to resolve teacher', 500);
  }
  if (!teacher) return err('Teacher account not found', 403);

  // Optional filters.
  const url = new URL(request.url);
  const statusParam = url.searchParams.get('status');
  const classParam = url.searchParams.get('class_id');

  if (statusParam && !(ALL_STATUSES as readonly string[]).includes(statusParam)) {
    return err('Invalid status filter', 400);
  }
  if (classParam && !UUID_RE.test(classParam)) {
    return err('Invalid class_id filter', 400);
  }

  let query = supabaseAdmin
    .from('teacher_remediation_assignments')
    .select(
      'id, teacher_id, student_id, class_id, chapter_id, source_alert_id, status, created_at, resolved_at',
    )
    .eq('teacher_id', teacher.id);
  if (statusParam) query = query.eq('status', statusParam);
  if (classParam) query = query.eq('class_id', classParam);

  const { data, error } = await query.order('created_at', { ascending: false }).limit(500);
  if (error) {
    logger.error('teacher_remediation_list_failed', {
      error: new Error(error.message),
      route: 'teacher/remediation',
    });
    return err('Failed to list remediation assignments', 500);
  }

  return NextResponse.json({ success: true, data: data ?? [] }, { status: 200 });
}
