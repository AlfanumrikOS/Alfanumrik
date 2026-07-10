/**
 * /api/teacher/remediation — Phase 3A (Teacher Command Center) Wave A / A2.
 *
 * POST — a teacher assigns targeted remediation to a student on a weak concept
 *        (heatmap cell) or off an at-risk alert ("general" remediation, no
 *        chapter). Writes one `teacher_remediation_assignments` row (status
 *        'assigned'). Idempotent in TWO layers:
 *        (1) per-teacher pre-check — if an OPEN row (assigned | in_progress)
 *            already exists for (teacher, student, chapter) it is returned
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
 *        teacher role) AND a server-side roster check — the student must be on
 *        the caller's roster via `class_enrollments × class_teachers`. RLS already
 *        enforces this at the DB layer (A1 policies); we re-verify in the route
 *        as defense-in-depth so a forged `student_id` is rejected with a 403
 *        before any insert.
 *
 * Identity contract (A1, non-negotiable):
 *   - teacher_id  = internal `teachers.id`   (resolved from auth.uid(), NEVER auth.uid())
 *   - student_id  = `students.id`
 *   - chapter_id  = `curriculum_topics.id`   (nullable — general/alert remediation)
 *   - source_alert_id = `at_risk_alerts.id`  (nullable)
 *   - class_id    = `classes.id`             (derived from the roster join)
 *   - status      ∈ assigned | in_progress | resolved | dismissed
 *
 * P9 RBAC (route gate) · P8 roster scope (server-verified) · P5 grade stays a
 * string upstream (no grade handled here) · P13 no PII in logs.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const PostBodySchema = z.object({
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

/**
 * Roster check (defense-in-depth, mirrors the A1 RLS join). A teacher "owns" a
 * student iff they share a class via class_enrollments × class_teachers. Returns
 * the class_id of that shared class (used for the assignment row) or null when
 * the student is NOT on the caller's roster.
 *
 * We resolve the join through the teacher's class ids so the lookup is two
 * indexed equality reads rather than a cross-table JOIN (the Supabase client
 * has no JOIN builder).
 */
async function rosterClassId(teacherId: string, studentId: string): Promise<string | null> {
  // 1. Classes this teacher is attached to.
  const { data: teacherClasses, error: tcErr } = await supabaseAdmin
    .from('class_teachers')
    .select('class_id')
    .eq('teacher_id', teacherId);
  if (tcErr) {
    logger.error('teacher_remediation_class_teachers_lookup_failed', {
      error: new Error(tcErr.message),
      route: 'teacher/remediation',
    });
    throw new Error('roster_lookup_failed');
  }
  const classIds = (teacherClasses ?? [])
    .map((r) => (r as { class_id: string | null }).class_id)
    .filter((c): c is string => !!c);
  if (classIds.length === 0) return null;

  // 2. Is the student enrolled in any of those classes?
  const { data: enrolment, error: csErr } = await supabaseAdmin
    .from('class_enrollments')
    .select('class_id')
    .eq('student_id', studentId)
    .in('class_id', classIds)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (csErr) {
    logger.error('teacher_remediation_class_enrollments_lookup_failed', {
      error: new Error(csErr.message),
      route: 'teacher/remediation',
    });
    throw new Error('roster_lookup_failed');
  }
  return (enrolment as { class_id: string } | null)?.class_id ?? null;
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

  // Roster check (P8): the student must be on the caller's roster. Also yields
  // the class_id for the assignment row.
  let classId: string | null;
  try {
    classId = await rosterClassId(teacher.id, studentId);
  } catch {
    return err('Failed to verify roster', 500);
  }
  if (!classId) return err('Student is not on your roster', 403);

  // Idempotency: an OPEN row for (teacher, student, chapter) already covers
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
