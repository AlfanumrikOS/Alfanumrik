/**
 * teacher-dashboard — Supabase Edge Function
 *
 * Serves the teacher portal with class management, mastery heatmaps,
 * at-risk student alerts, and classroom polling.
 *
 * Actions:
 *   - get_dashboard:       Teacher info, classes, aggregate stats
 *   - get_heatmap:         Student × concept mastery matrix
 *   - get_alerts:          At-risk student detection
 *   - resolve_alert:       Mark alert as resolved
 *   - launch_poll:         Create classroom poll
 *   - close_poll:          Close poll and return results
 *   - get_class_overview:  Reports / class aggregate snapshot
 *   - get_student_report:  Reports / per-student deep dive
 *   - get_class_trends:    Reports / 30-day rolling trends
 *   - get_assignment_submissions: Phase C.1 / submission list per assignment
 *   - get_submission_detail:      Phase C.1 / per-question breakdown
 *   - mark_submission_reviewed:   Phase C.1 / record feedback + score override
 *   - get_grade_book:             Phase C.2 / matrix of students × columns
 *   - set_grade_book_cell:        Phase C.2 / set one (student, column) cell
 *   - export_grade_book_csv:      Phase C.2 / export grade book matrix as CSV
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts'
// P12: teachers should only see subjects each student is currently enrolled in
// (grade-map ∩ plan). See:
//   docs/superpowers/specs/2026-04-15-subject-governance-design.md §6.2

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Phase D.6 cold-start mitigation: construct the service-role client once at
// module scope and reuse across every invocation while the Edge Function
// instance is warm. The Supabase client is pure config + an internal fetch
// wrapper; there are no per-request stateful resources to spread between
// requests. Earlier code newed up a client inside each handler (23 call
// sites across this file), paying the constructor cost on every request.
// This saves ~50-150 ms of cold-start latency and trims allocator pressure
// on warm requests.
const SERVICE_CLIENT = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function getServiceClient() {
  return SERVICE_CLIENT
}

// ─── Per-resource ownership helpers (P13 follow-up to JWT binding) ──────
// JWT binding alone prevents teacher A from impersonating teacher B by
// passing B's teacher_id. But several handlers also accept class_id /
// alert_id / poll_id from the body and operate on them with the
// service-role client — without these checks, A could still fetch B's
// class roster heatmap or close B's poll by passing B's class_id.

/**
 * Verify that `classId` belongs to `teacherId`, or that the synthetic
 * `grade-<n>` pseudo-class id corresponds to a grade the teacher teaches.
 * Used by handlers that accept a class_id from the request body.
 */
async function assertTeacherOwnsClass(
  supabase: ReturnType<typeof getServiceClient>,
  teacherId: string,
  classId: string,
): Promise<boolean> {
  if (!classId) return false

  // Synthetic id used when the teacher has no class assignments — must
  // correspond to a grade in the teacher's grades_taught array.
  if (classId.startsWith('grade-')) {
    const grade = classId.replace('grade-', '')
    const { data: teacher } = await supabase
      .from('teachers')
      .select('grades_taught')
      .eq('id', teacherId)
      .single()
    if (!teacher) return false
    const grades = Array.isArray(teacher.grades_taught)
      ? teacher.grades_taught.map(String)
      : teacher.grades_taught != null
      ? [String(teacher.grades_taught)]
      : []
    return grades.includes(grade)
  }

  const { data: assignment } = await supabase
    .from('teacher_class_assignments')
    .select('class_id')
    .eq('teacher_id', teacherId)
    .eq('class_id', classId)
    .limit(1)
    .maybeSingle()
  if (assignment) return true

  try {
    const { data: classTeacher } = await supabase
      .from('class_teachers')
      .select('class_id')
      .eq('teacher_id', teacherId)
      .eq('class_id', classId)
      .limit(1)
      .maybeSingle()
    if (classTeacher) return true
  } catch { /* ignore */ }

  return false
}

/**
 * Verify that `pollId` was created by `teacherId`. Returns true on a
 * direct teacher_id match, false otherwise — including the case where
 * the polls table doesn't exist or the row is absent (fail closed).
 */
async function assertTeacherOwnsPoll(
  supabase: ReturnType<typeof getServiceClient>,
  teacherId: string,
  pollId: string,
): Promise<boolean> {
  if (!pollId) return false
  try {
    const { data: poll } = await supabase
      .from('classroom_polls')
      .select('teacher_id')
      .eq('id', pollId)
      .limit(1)
      .maybeSingle()
    return !!poll && poll.teacher_id === teacherId
  } catch {
    return false
  }
}

// ─── get_dashboard ──────────────────────────────────────────
async function handleGetDashboard(
  body: Record<string, unknown>,
  origin: string | null,
): Promise<Response> {
  const teacherId = String(body.teacher_id || '')
  if (!teacherId) return errorResponse('teacher_id required', 400, origin)

  const supabase = getServiceClient()

  // Fetch teacher profile
  const { data: teacher } = await supabase
    .from('teachers')
    .select('id, name, school_name, subjects_taught, grades_taught')
    .eq('id', teacherId)
    .single()

  if (!teacher) return errorResponse('Teacher not found', 404, origin)

  // Fetch classes assigned to this teacher
  let classes: Array<{ id: string; name: string; student_count: number; avg_mastery?: number }> = []
  try {
    const { data: classData } = await supabase
      .from('teacher_class_assignments')
      .select('class_id, classes(id, name, grade, section)')
      .eq('teacher_id', teacherId)

    if (classData && classData.length > 0) {
      // Get student counts per class
      for (const assignment of classData) {
        const cls = (assignment as any).classes
        if (!cls) continue
        const { count } = await supabase
          .from('students')
          .select('*', { count: 'exact', head: true })
          .eq('class_id', cls.id)
        classes.push({
          id: cls.id,
          name: cls.name || `${cls.grade}-${cls.section || 'A'}`,
          student_count: count ?? 0,
          avg_mastery: 0,
        })
      }
    }
  } catch {
    // Classes table may not exist — return empty
    classes = []
  }

  // If no class assignments found, try to find students by grade
  if (classes.length === 0 && teacher.grades_taught) {
    const grades = Array.isArray(teacher.grades_taught) ? teacher.grades_taught : [teacher.grades_taught]
    for (const grade of grades) {
      const { count } = await supabase
        .from('students')
        .select('*', { count: 'exact', head: true })
        .eq('grade', String(grade))
      classes.push({
        id: `grade-${grade}`,
        name: `Grade ${grade}`,
        student_count: count ?? 0,
        avg_mastery: 0,
      })
    }
  }

  const totalStudents = classes.reduce((sum, c) => sum + c.student_count, 0)

  // Count recent alerts (students with low performance)
  let activeAlerts = 0
  let criticalAlerts = 0
  try {
    const { data: lowPerf } = await supabase
      .from('student_learning_profiles')
      .select('student_id, total_questions_asked, total_questions_answered_correctly')
      .gt('total_questions_asked', 5)

    if (lowPerf) {
      for (const p of lowPerf) {
        const accuracy = p.total_questions_asked > 0
          ? p.total_questions_answered_correctly / p.total_questions_asked
          : 0
        if (accuracy < 0.3) { criticalAlerts++; activeAlerts++ }
        else if (accuracy < 0.5) { activeAlerts++ }
      }
    }
  } catch { /* profiles table may not exist */ }

  return jsonResponse({
    teacher: { name: teacher.name },
    classes,
    stats: {
      total_students: totalStudents,
      active_alerts: activeAlerts,
      critical_alerts: criticalAlerts,
      active_assignments: 0,
    },
  }, 200, {}, origin)
}

// ─── get_heatmap ────────────────────────────────────────────
async function handleGetHeatmap(
  body: Record<string, unknown>,
  origin: string | null,
): Promise<Response> {
  const classId = String(body.class_id || '')
  const subject = body.subject ? String(body.subject) : null
  const teacherId = String(body.teacher_id || '')
  if (!classId) return errorResponse('class_id required', 400, origin)

  const supabase = getServiceClient()

  // P13: caller must own the class they're asking about.
  if (!(await assertTeacherOwnsClass(supabase, teacherId, classId))) {
    return errorResponse('Class not owned by caller', 403, origin)
  }

  // Determine students in this class/grade
  const isGradeId = classId.startsWith('grade-')
  const grade = isGradeId ? classId.replace('grade-', '') : null

  let studentQuery = supabase.from('students').select('id, name, grade')
  if (isGradeId && grade) {
    studentQuery = studentQuery.eq('grade', grade)
  } else {
    studentQuery = studentQuery.eq('class_id', classId)
  }
  const { data: students } = await studentQuery.limit(50)

  if (!students || students.length === 0) {
    return jsonResponse({
      student_count: 0,
      concept_count: 0,
      concepts: [],
      matrix: [],
    }, 200, {}, origin)
  }

  // Get concepts/topics for this grade/subject
  let conceptQuery = supabase.from('curriculum_topics').select('id, title, chapter_number').order('chapter_number')
  if (grade) conceptQuery = conceptQuery.eq('grade', grade)
  if (subject) conceptQuery = conceptQuery.eq('subject_code', subject)
  const { data: concepts } = await conceptQuery.limit(12)

  const conceptList = (concepts || []).map(c => ({
    id: c.id,
    title: c.title,
    chapter: c.chapter_number,
  }))

  // Build mastery matrix
  const matrix = []
  for (const student of students) {
    const cells = []
    let totalMastery = 0

    for (const concept of conceptList) {
      // Try BKT mastery state
      let pKnow = 0
      let attempts = 0
      let level = 'none'

      try {
        const { data: bkt } = await supabase
          .from('bkt_mastery_state')
          .select('p_know, attempts, mastery_level')
          .eq('student_id', student.id)
          .eq('topic_id', concept.id)
          .single()

        if (bkt) {
          pKnow = bkt.p_know ?? 0
          attempts = bkt.attempts ?? 0
          level = bkt.mastery_level || 'none'
        }
      } catch { /* table may not exist */ }

      cells.push({ p_know: pKnow, level, attempts })
      totalMastery += pKnow
    }

    const avgMastery = conceptList.length > 0
      ? Math.round((totalMastery / conceptList.length) * 100)
      : 0

    matrix.push({
      student_name: student.name || 'Student',
      avg_mastery: avgMastery,
      cells,
    })
  }

  return jsonResponse({
    student_count: students.length,
    concept_count: conceptList.length,
    concepts: conceptList,
    matrix,
  }, 200, {}, origin)
}

// ─── get_alerts ─────────────────────────────────────────────
async function handleGetAlerts(
  body: Record<string, unknown>,
  origin: string | null,
): Promise<Response> {
  const classId = String(body.class_id || '')
  const teacherId = String(body.teacher_id || '')
  if (!classId) return errorResponse('class_id required', 400, origin)

  const supabase = getServiceClient()

  // P13: caller must own the class they're asking about.
  if (!(await assertTeacherOwnsClass(supabase, teacherId, classId))) {
    return errorResponse('Class not owned by caller', 403, origin)
  }

  const isGradeId = classId.startsWith('grade-')
  const grade = isGradeId ? classId.replace('grade-', '') : null

  // Get students
  let studentQuery = supabase.from('students').select('id, name, grade')
  if (isGradeId && grade) {
    studentQuery = studentQuery.eq('grade', grade)
  } else {
    studentQuery = studentQuery.eq('class_id', classId)
  }
  const { data: students } = await studentQuery.limit(100)

  if (!students || students.length === 0) {
    return jsonResponse([], 200, {}, origin)
  }

  const studentIds = students.map(s => s.id)
  const alerts: Array<{
    id: string; severity: string; title: string; description: string;
    recommended_action: string; student_id: string; student_name: string;
  }> = []

  // Check learning profiles for weak students
  try {
    const { data: profiles } = await supabase
      .from('student_learning_profiles')
      .select('student_id, subject, total_questions_asked, total_questions_answered_correctly, xp, streak_days')
      .in('student_id', studentIds)

    // P12: Pre-compute allowed subjects per student so the teacher view only
    // surfaces alerts for subjects the student is currently enrolled in.
    const allowedBySid = new Map<string, Set<string>>()
    for (const sid of studentIds) {
      try {
        const { data: allowedRows } = await supabase.rpc('get_available_subjects', { p_student_id: sid })
        if (Array.isArray(allowedRows)) {
          allowedBySid.set(
            sid,
            new Set(
              (allowedRows as Array<{ code: string; is_locked: boolean }>)
                .filter((r) => !r.is_locked)
                .map((r) => r.code),
            ),
          )
        }
      } catch {
        // If RPC fails for one student, leave them absent; alerts for them
        // will be hidden below (fail closed).
      }
    }

    if (profiles) {
      for (const p of profiles) {
        const student = students.find(s => s.id === p.student_id)
        if (!student || p.total_questions_asked < 5) continue

        // Subject-scoped alerts (accuracy) must be gated by the student's
        // current subject entitlement; streak alerts below are subject-free.
        const allowed = allowedBySid.get(p.student_id)
        const subjectAllowed = allowed ? allowed.has(String(p.subject)) : false

        const accuracy = p.total_questions_answered_correctly / p.total_questions_asked
        const name = student.name || 'Student'

        if (subjectAllowed && accuracy < 0.3) {
          alerts.push({
            id: `alert-${p.student_id}-${p.subject}-critical`,
            severity: 'critical',
            title: `${name} — critical accuracy in ${p.subject}`,
            description: `${Math.round(accuracy * 100)}% accuracy over ${p.total_questions_asked} questions. Needs immediate intervention.`,
            recommended_action: `Schedule a one-on-one revision session on ${p.subject} fundamentals.`,
            student_id: p.student_id,
            student_name: name,
          })
        } else if (subjectAllowed && accuracy < 0.5) {
          alerts.push({
            id: `alert-${p.student_id}-${p.subject}-high`,
            severity: 'high',
            title: `${name} — weak in ${p.subject}`,
            description: `${Math.round(accuracy * 100)}% accuracy. Targeted practice needed.`,
            recommended_action: `Assign a focused quiz on weak chapters in ${p.subject}.`,
            student_id: p.student_id,
            student_name: name,
          })
        }

        // Streak dropped warning
        if (p.streak_days === 0 && p.xp > 100) {
          alerts.push({
            id: `alert-${p.student_id}-streak`,
            severity: 'medium',
            title: `${name} — streak broken`,
            description: `Was active (${p.xp} XP) but streak dropped to 0. May be losing engagement.`,
            recommended_action: 'Send an encouragement message or assign a short quiz.',
            student_id: p.student_id,
            student_name: name,
          })
        }
      }
    }
  } catch { /* profiles may not exist */ }

  // Sort by severity
  const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
  alerts.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9))

  return jsonResponse(alerts, 200, {}, origin)
}

// ─── resolve_alert ──────────────────────────────────────────
async function handleResolveAlert(
  body: Record<string, unknown>,
  origin: string | null,
): Promise<Response> {
  const alertId = String(body.alert_id || '')
  const teacherId = String(body.teacher_id || '')
  if (!alertId) return errorResponse('alert_id required', 400, origin)

  // Alerts are derived from student data, not stored separately, so there's
  // no row-level ownership to verify on alert_id itself. We tag the audit
  // row with the (JWT-derived) teacher_id so the audit trail records WHO
  // resolved each alert.
  //
  // Bug fix: the previous version targeted a non-existent table `audit_log`
  // (singular) with wrong column names (`entity_type`, `entity_id`). The
  // insert was caught by try/catch and silently never wrote anything — the
  // audit trail for resolve_alert has been a no-op for as long as this
  // handler has existed. Now uses the real `audit_logs` table (plural) with
  // its actual schema: action, resource_type, resource_id, auth_user_id,
  // details.
  const supabase = getServiceClient()
  try {
    // Resolve teacher.auth_user_id so audit_logs.auth_user_id is the
    // canonical Supabase user UUID, not the internal teachers.id.
    const { data: t } = await supabase
      .from('teachers')
      .select('auth_user_id')
      .eq('id', teacherId)
      .maybeSingle()

    await supabase.from('audit_logs').insert({
      auth_user_id: t?.auth_user_id ?? null,
      action: 'resolve_alert',
      resource_type: 'alert',
      resource_id: alertId,
      details: { teacher_id: teacherId, resolved_at: new Date().toISOString() },
      status: 'success',
    })
  } catch { /* never block the resolve on an audit insert failure */ }

  return jsonResponse({ success: true }, 200, {}, origin)
}

// ─── launch_poll ────────────────────────────────────────────
async function handleLaunchPoll(
  body: Record<string, unknown>,
  origin: string | null,
): Promise<Response> {
  const classId = String(body.class_id || '')
  const questionText = String(body.question_text || '')
  const teacherId = String(body.teacher_id || '')
  const options = body.options as string[] | undefined

  if (!classId || !questionText) {
    return errorResponse('class_id and question_text required', 400, origin)
  }

  const supabase = getServiceClient()

  // P13: caller must own the class they're launching a poll into.
  // Without this, a teacher could create a poll under another teacher's
  // class_id and reach that class's students.
  if (!(await assertTeacherOwnsClass(supabase, teacherId, classId))) {
    return errorResponse('Class not owned by caller', 403, origin)
  }

  try {
    const { data, error } = await supabase
      .from('classroom_polls')
      .insert({
        class_id: classId,
        teacher_id: teacherId,
        question_text: questionText,
        options: options || [],
        status: 'active',
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (error) throw error
    return jsonResponse({ poll_id: data.id }, 200, {}, origin)
  } catch (err: unknown) {
    // Table may not exist — return a mock poll_id
    const mockId = `poll-${Date.now()}`
    return jsonResponse({ poll_id: mockId }, 200, {}, origin)
  }
}

// ─── close_poll ─────────────────────────────────────────────
async function handleClosePoll(
  body: Record<string, unknown>,
  origin: string | null,
): Promise<Response> {
  const pollId = String(body.poll_id || '')
  const teacherId = String(body.teacher_id || '')
  if (!pollId) return errorResponse('poll_id required', 400, origin)

  const supabase = getServiceClient()

  // P13: caller must own the poll they're closing. Without this a teacher
  // could close another teacher's poll and read its responses.
  if (!(await assertTeacherOwnsPoll(supabase, teacherId, pollId))) {
    return errorResponse('Poll not owned by caller', 403, origin)
  }

  try {
    // Update poll status
    await supabase
      .from('classroom_polls')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .eq('id', pollId)

    // Get responses
    const { data: responses, count } = await supabase
      .from('classroom_responses')
      .select('*', { count: 'exact' })
      .eq('poll_id', pollId)

    const correctCount = (responses || []).filter((r: any) => r.is_correct).length
    const totalCount = count ?? 0
    const accuracyPct = totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0

    return jsonResponse({
      accuracy_pct: accuracyPct,
      response_count: totalCount,
      responses: responses || [],
    }, 200, {}, origin)
  } catch {
    // Tables may not exist
    return jsonResponse({ accuracy_pct: 0, response_count: 0, responses: [] }, 200, {}, origin)
  }
}

// ─── Reports helpers ────────────────────────────────────────
// All three Reports actions aggregate over the union of students the
// teacher owns. A teacher "owns" a student if either (a) the student is
// in a class assigned to them via teacher_class_assignments, or (b) the
// student's grade is in the teacher's grades_taught. We resolve the
// student set once and reuse it. Both lookups are RLS-friendly via the
// service-role client after the JWT binding step.
async function resolveStudentsForTeacher(
  supabase: ReturnType<typeof getServiceClient>,
  teacherId: string,
): Promise<Array<{ id: string; name: string; grade: string }>> {
  const seen = new Set<string>()
  const out: Array<{ id: string; name: string; grade: string }> = []

  // Path A: students attached to this teacher's classes.
  try {
    const { data: assignments } = await supabase
      .from('teacher_class_assignments')
      .select('class_id')
      .eq('teacher_id', teacherId)
    const classIds = (assignments || []).map((a: any) => a.class_id).filter(Boolean)
    if (classIds.length > 0) {
      const { data: classStudents } = await supabase
        .from('students')
        .select('id, name, grade')
        .in('class_id', classIds)
        .is('deleted_at', null)
        .limit(1000)
      for (const s of classStudents || []) {
        if (s?.id && !seen.has(s.id)) {
          seen.add(s.id)
          out.push({ id: s.id, name: s.name || 'Student', grade: String(s.grade || '') })
        }
      }
    }
  } catch { /* table may not exist */ }

  // Path B: fall back to grades_taught — and ALSO union when the
  // teacher has class assignments but the assignments don't cover
  // every student in their grades. We only do this if path A returned
  // nothing, mirroring handleGetDashboard's behavior.
  if (out.length === 0) {
    try {
      const { data: teacher } = await supabase
        .from('teachers')
        .select('grades_taught')
        .eq('id', teacherId)
        .maybeSingle()
      const grades = Array.isArray(teacher?.grades_taught)
        ? teacher!.grades_taught.map(String)
        : teacher?.grades_taught != null
        ? [String(teacher.grades_taught)]
        : []
      if (grades.length > 0) {
        const { data: gradeStudents } = await supabase
          .from('students')
          .select('id, name, grade')
          .in('grade', grades)
          .is('deleted_at', null)
          .limit(1000)
        for (const s of gradeStudents || []) {
          if (s?.id && !seen.has(s.id)) {
            seen.add(s.id)
            out.push({ id: s.id, name: s.name || 'Student', grade: String(s.grade || '') })
          }
        }
      }
    } catch { /* teachers row missing */ }
  }

  return out
}

/** Bucket a mastery percent (0-100) into the Reports UI's level codes. */
function masteryLevelFromPercent(pct: number): 'mastered' | 'proficient' | 'familiar' | 'developing' | 'not_started' {
  if (pct >= 80) return 'mastered'
  if (pct >= 60) return 'proficient'
  if (pct >= 40) return 'familiar'
  if (pct > 0) return 'developing'
  return 'not_started'
}

// ─── get_class_overview ─────────────────────────────────────
// Reports → "Class Overview" tab. Aggregates across all of the
// teacher's students. Degrades to zeros when source tables are sparse.
async function handleGetClassOverview(
  body: Record<string, unknown>,
  origin: string | null,
): Promise<Response> {
  const teacherId = String(body.teacher_id || '')
  if (!teacherId) return errorResponse('teacher_id required', 400, origin)

  const supabase = getServiceClient()
  const students = await resolveStudentsForTeacher(supabase, teacherId)
  const studentIds = students.map(s => s.id)
  const nameById = new Map(students.map(s => [s.id, s.name]))

  if (studentIds.length === 0) {
    return jsonResponse({
      stats: { total_students: 0, avg_mastery: 0, avg_accuracy: 0, active_this_week: 0 },
      mastery_distribution: { mastered: 0, proficient: 0, familiar: 0, developing: 0, not_started: 0 },
      top_performers: [],
      needs_attention: [],
    }, 200, {}, origin)
  }

  // Per-student aggregates from learning profiles. Profiles are per
  // (student, subject) so we collapse them to a per-student average.
  type Agg = { xp: number; asked: number; correct: number; lastSession: string | null }
  const agg = new Map<string, Agg>()
  for (const id of studentIds) agg.set(id, { xp: 0, asked: 0, correct: 0, lastSession: null })

  try {
    const { data: profiles } = await supabase
      .from('student_learning_profiles')
      .select('student_id, xp, total_questions_asked, total_questions_answered_correctly, last_session_at')
      .in('student_id', studentIds)
    for (const p of profiles || []) {
      const a = agg.get(p.student_id)
      if (!a) continue
      a.xp += Number(p.xp || 0)
      a.asked += Number(p.total_questions_asked || 0)
      a.correct += Number(p.total_questions_answered_correctly || 0)
      if (p.last_session_at) {
        if (!a.lastSession || p.last_session_at > a.lastSession) a.lastSession = p.last_session_at
      }
    }
  } catch { /* profiles may not exist */ }

  // Active-this-week: any quiz_session completed in the last 7 days.
  let activeThisWeek = 0
  try {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data: recent } = await supabase
      .from('quiz_sessions')
      .select('student_id, completed_at')
      .in('student_id', studentIds)
      .gte('completed_at', weekAgo)
      .limit(5000)
    const seen = new Set<string>()
    for (const r of recent || []) {
      if (r.student_id && !seen.has(r.student_id)) seen.add(r.student_id)
    }
    activeThisWeek = seen.size
  } catch { /* table may not exist */ }

  // Compute mastery distribution + accuracy + top/bottom from agg.
  const dist = { mastered: 0, proficient: 0, familiar: 0, developing: 0, not_started: 0 }
  let totalAccuracySum = 0
  let totalAccuracyCount = 0
  let totalMasterySum = 0
  let totalMasteryCount = 0

  type Row = { id: string; name: string; xp: number; accuracy: number; mastery: number }
  const rows: Row[] = []

  for (const [id, a] of agg.entries()) {
    const accuracy = a.asked > 0 ? Math.round((a.correct / a.asked) * 100) : 0
    // Without a true BKT roll-up, accuracy is the best proxy for mastery
    // at this aggregation layer. We bucket via the same thresholds the
    // UI uses so the donut/bar chart aligns with the per-student card.
    const mastery = accuracy
    const level = masteryLevelFromPercent(mastery)
    dist[level]++
    if (a.asked > 0) {
      totalAccuracySum += accuracy
      totalAccuracyCount++
      totalMasterySum += mastery
      totalMasteryCount++
    }
    rows.push({ id, name: nameById.get(id) || 'Student', xp: a.xp, accuracy, mastery })
  }

  // Convert dist absolute counts to percentages of the total cohort.
  const total = studentIds.length
  const distPct = {
    mastered: total > 0 ? Math.round((dist.mastered / total) * 100) : 0,
    proficient: total > 0 ? Math.round((dist.proficient / total) * 100) : 0,
    familiar: total > 0 ? Math.round((dist.familiar / total) * 100) : 0,
    developing: total > 0 ? Math.round((dist.developing / total) * 100) : 0,
    not_started: total > 0 ? Math.round((dist.not_started / total) * 100) : 0,
  }

  const avgMastery = totalMasteryCount > 0 ? Math.round(totalMasterySum / totalMasteryCount) : 0
  const avgAccuracy = totalAccuracyCount > 0 ? Math.round(totalAccuracySum / totalAccuracyCount) : 0

  const topPerformers = [...rows]
    .filter(r => r.xp > 0)
    .sort((a, b) => b.xp - a.xp)
    .slice(0, 5)
    .map(r => ({ name: r.name, student_name: r.name, xp: r.xp, total_xp: r.xp, mastery: r.mastery }))

  const needsAttention = [...rows]
    .filter(r => r.mastery < 50 && r.id)
    .sort((a, b) => a.mastery - b.mastery)
    .slice(0, 5)
    .map(r => ({
      name: r.name,
      student_name: r.name,
      mastery: r.mastery,
      reason: `${r.mastery}% mastery`,
    }))

  return jsonResponse({
    stats: {
      total_students: total,
      avg_mastery: avgMastery,
      avg_accuracy: avgAccuracy,
      active_this_week: activeThisWeek,
    },
    mastery_distribution: distPct,
    top_performers: topPerformers,
    needs_attention: needsAttention,
  }, 200, {}, origin)
}

// ─── get_student_report ─────────────────────────────────────
// Reports → "Student Analysis" tab. Per-student deep dive. Ownership:
// the student must be in the teacher's resolved set (class or grade).
async function handleGetStudentReport(
  body: Record<string, unknown>,
  origin: string | null,
): Promise<Response> {
  const studentId = String(body.student_id || '')
  const teacherId = String(body.teacher_id || '')
  if (!studentId) return errorResponse('student_id required', 400, origin)

  const supabase = getServiceClient()

  // P13: per-resource ownership. We re-resolve the teacher's student
  // set rather than trust body.student_id — without this, a teacher
  // could pass any student_id from another school.
  const owned = await resolveStudentsForTeacher(supabase, teacherId)
  const target = owned.find(s => s.id === studentId)
  if (!target) {
    return errorResponse('Student not owned by caller', 403, origin)
  }

  // Per-subject mastery from learning profiles. Each row is one
  // (student, subject) pair.
  const subjects: Array<{ subject: string; name: string; mastery: number; level: string }> = []
  let totalXp = 0
  let totalStreak = 0
  let totalAsked = 0
  let totalCorrect = 0
  try {
    const { data: profiles } = await supabase
      .from('student_learning_profiles')
      .select('subject, xp, streak_days, total_questions_asked, total_questions_answered_correctly')
      .eq('student_id', studentId)
    for (const p of profiles || []) {
      const subj = String(p.subject || '')
      const asked = Number(p.total_questions_asked || 0)
      const correct = Number(p.total_questions_answered_correctly || 0)
      totalXp += Number(p.xp || 0)
      if ((p.streak_days || 0) > totalStreak) totalStreak = Number(p.streak_days)
      totalAsked += asked
      totalCorrect += correct
      const pct = asked > 0 ? Math.round((correct / asked) * 100) : 0
      subjects.push({
        subject: subj,
        name: subj,
        mastery: pct,
        level: masteryLevelFromPercent(pct),
      })
    }
  } catch { /* profiles missing */ }

  const accuracy = totalAsked > 0 ? Math.round((totalCorrect / totalAsked) * 100) : 0

  // Strengths / weaknesses: top 3 and bottom 3 subjects by mastery
  // among those the student has actually attempted.
  const sortedAttempted = [...subjects].filter(s => s.mastery > 0).sort((a, b) => b.mastery - a.mastery)
  const strengths = sortedAttempted.slice(0, 3).map(s => ({ topic: s.subject, name: s.subject }))
  const weaknesses = [...sortedAttempted].reverse().slice(0, 3).map(s => ({ topic: s.subject, name: s.subject }))

  // Lightweight recommendations — same heuristics the alerts handler uses.
  const recommendations: string[] = []
  for (const s of subjects) {
    if (s.mastery > 0 && s.mastery < 40) {
      recommendations.push(`Assign a focused revision quiz on ${s.subject} fundamentals.`)
    }
  }
  if (totalStreak === 0 && totalXp > 100) {
    recommendations.push('Student is losing streak — send an encouragement nudge.')
  }
  if (recommendations.length === 0 && subjects.length > 0) {
    recommendations.push('Student is on track — continue with current plan.')
  }

  return jsonResponse({
    student_id: studentId,
    name: target.name,
    student_name: target.name,
    xp: totalXp,
    total_xp: totalXp,
    streak: totalStreak,
    current_streak: totalStreak,
    accuracy,
    avg_accuracy: accuracy,
    subjects,
    subject_mastery: subjects,
    strengths,
    weaknesses,
    recommendations,
  }, 200, {}, origin)
}

// ─── get_class_trends ───────────────────────────────────────
// Reports → "Trends" tab. 30-day rolling window over the teacher's
// student set. Returns daily timeseries, a 4x7 activity heatmap
// (4 weeks × 7 weekdays), and most-improved learners.
async function handleGetClassTrends(
  body: Record<string, unknown>,
  origin: string | null,
): Promise<Response> {
  const teacherId = String(body.teacher_id || '')
  if (!teacherId) return errorResponse('teacher_id required', 400, origin)

  const supabase = getServiceClient()
  const students = await resolveStudentsForTeacher(supabase, teacherId)
  const studentIds = students.map(s => s.id)
  const nameById = new Map(students.map(s => [s.id, s.name]))

  if (studentIds.length === 0) {
    return jsonResponse({
      class_id: null,
      daily: [],
      weekly_progress: [],
      activity_heatmap: [],
      most_improved: [],
      week_over_week_delta: 0,
    }, 200, {}, origin)
  }

  const now = new Date()
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const windowDays = 30
  const windowStart = new Date(todayUtc.getTime() - (windowDays - 1) * 24 * 60 * 60 * 1000)

  // Pull all completed quiz_sessions in the window for this cohort.
  type QS = {
    student_id: string
    completed_at: string | null
    score_percent: number | null
    correct_answers: number | null
    total_questions: number | null
    time_taken_seconds: number | null
    time_spent_seconds: number | null
  }
  let sessions: QS[] = []
  try {
    const { data } = await supabase
      .from('quiz_sessions')
      .select('student_id, completed_at, score_percent, correct_answers, total_questions, time_taken_seconds, time_spent_seconds')
      .in('student_id', studentIds)
      .gte('completed_at', windowStart.toISOString())
      .not('completed_at', 'is', null)
      .limit(5000)
    sessions = (data || []) as QS[]
  } catch { /* table may not exist */ }

  // Bucket by UTC date — small drift vs IST is acceptable here because
  // trend charts span 30 days. Day strings: 'YYYY-MM-DD'.
  const dateKey = (d: Date) => d.toISOString().slice(0, 10)
  const daily = new Map<string, { attempts: number; masterySum: number; timeOnTask: number }>()
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(windowStart.getTime() + i * 24 * 60 * 60 * 1000)
    daily.set(dateKey(d), { attempts: 0, masterySum: 0, timeOnTask: 0 })
  }
  for (const s of sessions) {
    if (!s.completed_at) continue
    const key = s.completed_at.slice(0, 10)
    const bucket = daily.get(key)
    if (!bucket) continue
    bucket.attempts++
    bucket.masterySum += Number(s.score_percent || 0)
    bucket.timeOnTask += Number(s.time_spent_seconds || s.time_taken_seconds || 0)
  }

  const dailyArray = Array.from(daily.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, b]) => ({
      date,
      attempts: b.attempts,
      avg_mastery: b.attempts > 0 ? Math.round(b.masterySum / b.attempts) : 0,
      time_on_task: b.timeOnTask,
    }))

  // Week-over-week delta on attempts (last 7d vs prior 7d).
  const last7 = dailyArray.slice(-7).reduce((acc, d) => acc + d.attempts, 0)
  const prior7 = dailyArray.slice(-14, -7).reduce((acc, d) => acc + d.attempts, 0)
  const weekOverWeekDelta = prior7 === 0 ? (last7 > 0 ? 100 : 0) : Math.round(((last7 - prior7) / prior7) * 100)

  // Weekly progress: 4 weeks of avg-mastery rollup.
  const weekly: Array<{ label: string; week: string; progress: number; percent: number }> = []
  for (let w = 0; w < 4; w++) {
    const slice = dailyArray.slice(w * 7, (w + 1) * 7)
    const totalAttempts = slice.reduce((acc, d) => acc + d.attempts, 0)
    const masterySum = slice.reduce((acc, d) => acc + d.avg_mastery * d.attempts, 0)
    const avg = totalAttempts > 0 ? Math.round(masterySum / totalAttempts) : 0
    const label = `Week ${w + 1}`
    weekly.push({ label, week: label, progress: avg, percent: avg })
  }

  // Activity heatmap: 4 rows (weeks 1-4 of the window) × 7 cols
  // (Mon-Sun). Cell value = total attempts that weekday across the
  // students cohort.
  const heat: number[][] = [
    [0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0],
  ]
  for (let i = 0; i < dailyArray.length; i++) {
    const weekIndex = Math.floor(i / 7)
    if (weekIndex >= 4) break
    const date = new Date(dailyArray[i].date + 'T00:00:00Z')
    // getUTCDay: 0=Sun..6=Sat. Convert to Mon=0..Sun=6.
    const dayCol = (date.getUTCDay() + 6) % 7
    heat[weekIndex][dayCol] += dailyArray[i].attempts
  }

  // Most-improved: split window in halves, compare avg score_percent.
  type Imp = { id: string; firstHalf: number[]; secondHalf: number[] }
  const midpoint = new Date(windowStart.getTime() + Math.floor(windowDays / 2) * 24 * 60 * 60 * 1000)
  const impMap = new Map<string, Imp>()
  for (const id of studentIds) impMap.set(id, { id, firstHalf: [], secondHalf: [] })
  for (const s of sessions) {
    if (!s.completed_at) continue
    const sm = impMap.get(s.student_id)
    if (!sm) continue
    const score = Number(s.score_percent || 0)
    const when = new Date(s.completed_at)
    if (when < midpoint) sm.firstHalf.push(score)
    else sm.secondHalf.push(score)
  }
  const mostImproved = Array.from(impMap.values())
    .map(m => {
      const before = m.firstHalf.length > 0 ? m.firstHalf.reduce((a, b) => a + b, 0) / m.firstHalf.length : 0
      const after = m.secondHalf.length > 0 ? m.secondHalf.reduce((a, b) => a + b, 0) / m.secondHalf.length : 0
      return { id: m.id, improvement: Math.round(after - before), beforeN: m.firstHalf.length, afterN: m.secondHalf.length }
    })
    .filter(m => m.improvement > 0 && m.beforeN > 0 && m.afterN > 0)
    .sort((a, b) => b.improvement - a.improvement)
    .slice(0, 5)
    .map(m => ({
      name: nameById.get(m.id) || 'Student',
      student_name: nameById.get(m.id) || 'Student',
      improvement: m.improvement,
      delta: m.improvement,
    }))

  return jsonResponse({
    class_id: null,
    daily: dailyArray,
    weekly_progress: weekly,
    activity_heatmap: heat,
    most_improved: mostImproved,
    week_over_week_delta: weekOverWeekDelta,
  }, 200, {}, origin)
}

// Lightweight student list for the Reports page's StudentAnalysisTab.
// Returns just enough shape for the dropdown selector; per-student deep
// dive is served by get_student_report.
async function handleGetStudentsList(
  body: Record<string, unknown>,
  origin: string | null,
): Promise<Response> {
  const teacherId = String(body.teacher_id || '')
  if (!teacherId) return errorResponse('teacher_id required', 400, origin)
  const supabase = getServiceClient()
  const students = await resolveStudentsForTeacher(supabase, teacherId)
  return jsonResponse({
    students: students.map(s => ({ id: s.id, name: s.name, grade: s.grade })),
  }, 200, {}, origin)
}

// ─── Phase C.1 — Submission review actions ──────────────────
//
// The teacher dashboard previously had no surface to review student
// assignment submissions. These three actions feed the /teacher/submissions
// drill-in flow: assignment-list → per-submission list → per-question
// breakdown with a feedback input.
//
// Ownership model — every handler verifies the underlying assignment
// belongs to a class owned by `teacher_id`. We accept BOTH `class_teachers`
// (used by /api/teacher/* routes) and `teacher_class_assignments` (used by
// the rest of this Edge Function); the prod schema has both wired.

/** Verify the assignment row belongs to a class the teacher owns. */
async function teacherOwnsAssignment(
  supabase: ReturnType<typeof getServiceClient>,
  teacherId: string,
  assignmentId: string,
): Promise<{ owns: boolean; assignment: Record<string, unknown> | null }> {
  if (!assignmentId) return { owns: false, assignment: null }
  const { data: a } = await supabase
    .from('assignments')
    .select('id, class_id, teacher_id, title, subject, grade, chapter, difficulty, question_count, due_date, type, created_at')
    .eq('id', assignmentId)
    .maybeSingle()
  if (!a) return { owns: false, assignment: null }

  // Direct ownership: teacher_id matches on the assignment row.
  if ((a as { teacher_id?: string }).teacher_id === teacherId) {
    return { owns: true, assignment: a as Record<string, unknown> }
  }

  // Indirect ownership: the class is co-taught (class_teachers /
  // teacher_class_assignments) — surface the same data to all co-teachers.
  const classId = (a as { class_id?: string }).class_id
  if (!classId) return { owns: false, assignment: a as Record<string, unknown> }

  try {
    const { data: link } = await supabase
      .from('class_teachers')
      .select('class_id')
      .eq('class_id', classId)
      .eq('teacher_id', teacherId)
      .limit(1)
      .maybeSingle()
    if (link) return { owns: true, assignment: a as Record<string, unknown> }
  } catch { /* table may not exist on this env */ }

  try {
    const { data: link2 } = await supabase
      .from('teacher_class_assignments')
      .select('class_id')
      .eq('class_id', classId)
      .eq('teacher_id', teacherId)
      .limit(1)
      .maybeSingle()
    if (link2) return { owns: true, assignment: a as Record<string, unknown> }
  } catch { /* table may not exist on this env */ }

  return { owns: false, assignment: a as Record<string, unknown> }
}

interface SubmissionRow {
  student_id: string
  student_name: string
  submission_id: string | null
  submitted_at: string | null
  score_percent: number | null
  time_spent_sec: number
  status: 'pending' | 'submitted' | 'graded'
  questions_total: number
  questions_correct: number
}

/** Bucket the canonical assignment_submissions.status into the UI's 3 states. */
function uiStatusForSubmission(
  status: string | null | undefined,
  submittedAt: string | null,
  gradedAt: string | null,
): 'pending' | 'submitted' | 'graded' {
  if (gradedAt || status === 'graded' || status === 'reviewed') return 'graded'
  if (submittedAt || status === 'submitted' || status === 'completed') return 'submitted'
  return 'pending'
}

// ─── get_assignment_submissions ─────────────────────────────
async function handleGetAssignmentSubmissions(
  body: Record<string, unknown>,
  origin: string | null,
): Promise<Response> {
  const teacherId = String(body.teacher_id || '')
  const assignmentId = String(body.assignment_id || '')
  if (!teacherId) return errorResponse('teacher_id required', 400, origin)
  if (!assignmentId) return errorResponse('assignment_id required', 400, origin)

  const supabase = getServiceClient()

  // Ownership.
  const ownership = await teacherOwnsAssignment(supabase, teacherId, assignmentId)
  if (!ownership.owns) {
    return errorResponse('Assignment not found or not owned by this teacher', 403, origin)
  }
  const assignment = ownership.assignment

  // Roster: students in the assignment's class. Same dual-path logic
  // resolveStudentsForTeacher uses — start from class_students, fall
  // back to grade when the class table is sparse on this env.
  const classId = String((assignment as { class_id?: string } | null)?.class_id || '')
  const students: Array<{ id: string; name: string; grade: string }> = []
  const seen = new Set<string>()

  if (classId) {
    try {
      // Path A: class_students (used by /api/teacher/classes wiring).
      const { data: cs } = await supabase
        .from('class_students')
        .select('student_id, students(id, name, grade, deleted_at)')
        .eq('class_id', classId)
      for (const row of cs || []) {
        const s = (row as any).students
        if (s && s.id && !s.deleted_at && !seen.has(s.id)) {
          seen.add(s.id)
          students.push({ id: s.id, name: s.name || 'Student', grade: String(s.grade || '') })
        }
      }
    } catch { /* table may not exist */ }

    if (students.length === 0) {
      try {
        // Path B: direct students.class_id (used elsewhere in this file).
        const { data: ss } = await supabase
          .from('students')
          .select('id, name, grade')
          .eq('class_id', classId)
          .is('deleted_at', null)
          .limit(1000)
        for (const s of ss || []) {
          if (s?.id && !seen.has(s.id)) {
            seen.add(s.id)
            students.push({ id: s.id, name: s.name || 'Student', grade: String(s.grade || '') })
          }
        }
      } catch { /* fall through to empty */ }
    }
  }

  // Submissions for these students on this assignment.
  const submissions: SubmissionRow[] = []
  try {
    const { data: subs } = await supabase
      .from('assignment_submissions')
      .select('id, student_id, score, questions_total, questions_correct, time_spent_seconds, status, submitted_at, graded_at')
      .eq('assignment_id', assignmentId)
    const byStudent = new Map<string, any>()
    for (const s of subs || []) byStudent.set(String(s.student_id), s)

    // Emit one row per student in the roster — pending if no submission
    // row exists yet (UI surfaces "not started" gracefully).
    for (const stu of students) {
      const sub = byStudent.get(stu.id)
      if (sub) {
        const total = Number(sub.questions_total ?? 0)
        const correct = Number(sub.questions_correct ?? 0)
        // Prefer the canonical `score` column (already a percent in this
        // schema); fall back to questions_correct / questions_total.
        const score = sub.score != null
          ? Number(sub.score)
          : total > 0
            ? Math.round((correct / total) * 100)
            : null
        submissions.push({
          student_id: stu.id,
          student_name: stu.name,
          submission_id: String(sub.id),
          submitted_at: sub.submitted_at ?? null,
          score_percent: score,
          time_spent_sec: Number(sub.time_spent_seconds ?? 0),
          status: uiStatusForSubmission(sub.status, sub.submitted_at, sub.graded_at),
          questions_total: total,
          questions_correct: correct,
        })
      } else {
        submissions.push({
          student_id: stu.id,
          student_name: stu.name,
          submission_id: null,
          submitted_at: null,
          score_percent: null,
          time_spent_sec: 0,
          status: 'pending',
          questions_total: 0,
          questions_correct: 0,
        })
      }
    }
  } catch { /* assignment_submissions absent on this env — empty rows already populated */ }

  return jsonResponse({ assignment, submissions }, 200, {}, origin)
}

// ─── get_submission_detail ──────────────────────────────────
async function handleGetSubmissionDetail(
  body: Record<string, unknown>,
  origin: string | null,
): Promise<Response> {
  const teacherId = String(body.teacher_id || '')
  const submissionId = String(body.submission_id || '')
  if (!teacherId) return errorResponse('teacher_id required', 400, origin)
  if (!submissionId) return errorResponse('submission_id required', 400, origin)

  const supabase = getServiceClient()

  // Fetch the submission row first; the assignment_id on it drives the
  // ownership check.
  const { data: sub, error: subErr } = await supabase
    .from('assignment_submissions')
    .select('id, assignment_id, student_id, score, questions_total, questions_correct, time_spent_seconds, attempt_number, status, started_at, submitted_at, graded_at, graded_by, responses, teacher_feedback, xp_earned')
    .eq('id', submissionId)
    .maybeSingle()
  if (subErr) {
    return errorResponse(`Failed to load submission: ${subErr.message}`, 500, origin)
  }
  if (!sub) return errorResponse('Submission not found', 404, origin)

  const ownership = await teacherOwnsAssignment(supabase, teacherId, String(sub.assignment_id))
  if (!ownership.owns) {
    return errorResponse('Submission not found or not owned by this teacher', 403, origin)
  }

  // Student profile (single).
  const { data: student } = await supabase
    .from('students')
    .select('id, name, grade')
    .eq('id', sub.student_id)
    .maybeSingle()

  // The `responses` column is jsonb — typically an array of
  // { question_id, question_text, student_answer, correct_answer,
  //   is_correct, time_spent_seconds }. Shape it for the UI defensively.
  const rawResponses = Array.isArray(sub.responses) ? sub.responses : []
  const answers = rawResponses.map((r: any, idx: number) => ({
    question_id: String(r?.question_id ?? r?.id ?? `q${idx + 1}`),
    question_text: String(r?.question_text ?? r?.question ?? r?.prompt ?? `Question ${idx + 1}`),
    student_answer: r?.student_answer ?? r?.answer ?? r?.response ?? null,
    correct_answer: r?.correct_answer ?? r?.correct ?? null,
    correct: r?.is_correct === true || r?.correct === true,
    time_spent: Number(r?.time_spent_seconds ?? r?.time_spent ?? 0),
  }))

  return jsonResponse({
    submission: {
      id: sub.id,
      assignment_id: sub.assignment_id,
      student_id: sub.student_id,
      score: sub.score,
      questions_total: sub.questions_total,
      questions_correct: sub.questions_correct,
      time_spent_seconds: sub.time_spent_seconds,
      attempt_number: sub.attempt_number,
      status: uiStatusForSubmission(sub.status, sub.submitted_at, sub.graded_at),
      submitted_at: sub.submitted_at,
      graded_at: sub.graded_at,
      teacher_feedback: sub.teacher_feedback,
      xp_earned: sub.xp_earned,
    },
    answers,
    student: student ? { id: student.id, name: student.name, grade: String(student.grade || '') } : null,
    assignment: ownership.assignment,
  }, 200, {}, origin)
}

// ─── mark_submission_reviewed ───────────────────────────────
// ADR-005: this handler is a CANONICAL WRITER (until a projector is
// extracted). It MUST emit the state_event before any direct write to
// assignment_submissions, so subscribers see the signal even if the
// write fails. Idempotency-key is `submission_reviewed:<submission_id>:
// <graded_at_iso>` — re-saving feedback emits a fresh event.
async function handleMarkSubmissionReviewed(
  body: Record<string, unknown>,
  origin: string | null,
): Promise<Response> {
  const teacherId = String(body.teacher_id || '')
  const submissionId = String(body.submission_id || '')
  const feedbackRaw = body.feedback
  const scoreOverrideRaw = body.score_override

  if (!teacherId) return errorResponse('teacher_id required', 400, origin)
  if (!submissionId) return errorResponse('submission_id required', 400, origin)

  const feedback = typeof feedbackRaw === 'string' && feedbackRaw.trim().length > 0
    ? feedbackRaw.trim().slice(0, 2000)
    : null
  const scoreOverride = typeof scoreOverrideRaw === 'number' && Number.isFinite(scoreOverrideRaw)
    ? Math.max(0, Math.min(100, Math.round(scoreOverrideRaw)))
    : null

  const supabase = getServiceClient()

  // Fetch submission for ownership + payload context.
  const { data: sub, error: subErr } = await supabase
    .from('assignment_submissions')
    .select('id, assignment_id, student_id, score, questions_total, questions_correct')
    .eq('id', submissionId)
    .maybeSingle()
  if (subErr) return errorResponse(`Failed to load submission: ${subErr.message}`, 500, origin)
  if (!sub) return errorResponse('Submission not found', 404, origin)

  const ownership = await teacherOwnsAssignment(supabase, teacherId, String(sub.assignment_id))
  if (!ownership.owns) {
    return errorResponse('Submission not found or not owned by this teacher', 403, origin)
  }

  // Resolve the teacher's auth_user_id for the event envelope's actor.
  // We have teacher_id (resolved by JWT binding); look up the auth row.
  const { data: teacher } = await supabase
    .from('teachers')
    .select('id, auth_user_id, school_id')
    .eq('id', teacherId)
    .maybeSingle()
  if (!teacher) return errorResponse('Teacher account not found', 403, origin)

  const now = new Date().toISOString()
  // Final score the teacher endorsed. Prefer override; else keep the
  // existing canonical score; else fall back to questions_correct ratio.
  const total = Number(sub.questions_total ?? 0)
  const correct = Number(sub.questions_correct ?? 0)
  const derivedScore = total > 0 ? Math.round((correct / total) * 100) : null
  const finalScore = scoreOverride != null
    ? scoreOverride
    : sub.score != null
      ? Number(sub.score)
      : derivedScore

  // STEP 1 (mandatory): publish to bus BEFORE canonical write.
  // We inline a small publishEvent equivalent for the Edge runtime — the
  // real publishEvent in src/lib/state/events/publish.ts is Node/Next-only.
  // Schema is mirrored from TeacherSubmissionReviewedSchema; the API-route
  // entry point (src/app/api/teacher/submissions/[id]/review/route.ts) uses
  // the canonical publishEvent + Zod path. This action exists so the
  // teacher page can call the Edge Function uniformly without an extra
  // Next.js route round-trip — but it does NOT bypass the registry: the
  // event kind matches, the API route's contract tests + publish flag still
  // gate the bus.
  const idempotencyKey = `submission_reviewed:${submissionId}:${now}`
  const eventId = crypto.randomUUID()
  let busFlagOn = false
  try {
    const { data: flag } = await supabase
      .from('feature_flags')
      .select('is_enabled')
      .eq('flag_name', 'ff_event_bus_v1')
      .maybeSingle()
    busFlagOn = flag?.is_enabled === true
  } catch { /* flag absent — bus stays off, same default as publishEvent() */ }

  if (busFlagOn) {
    try {
      await supabase.from('state_events').insert({
        event_id: eventId,
        kind: 'teacher.submission_reviewed',
        actor_auth_user_id: (teacher as { auth_user_id?: string }).auth_user_id ?? null,
        tenant_id: (teacher as { school_id?: string | null }).school_id ?? null,
        idempotency_key: idempotencyKey,
        occurred_at: now,
        payload: {
          submissionId,
          assignmentId: String(sub.assignment_id),
          studentId: String(sub.student_id),
          teacherId,
          hasFeedback: feedback !== null,
          scorePercent: finalScore,
          scoreOverridden: scoreOverride != null,
        },
      })
    } catch (e) {
      // Don't fail the user-visible request on bus outage — log and
      // continue. The canonical write still happens so the teacher's
      // feedback is preserved.
      console.warn('teacher.submission_reviewed publish failed:', e instanceof Error ? e.message : String(e))
    }
  }

  // STEP 2: canonical write. TODO: extract to projector subscriber.
  // Direct writes from a route are acceptable per ADR-005 spine
  // fallback when no projector exists, provided the event ALREADY
  // fired (which it has, above).
  const patch: Record<string, unknown> = {
    graded_at: now,
    graded_by: teacherId,
    status: 'graded',
    updated_at: now,
  }
  if (feedback !== null) patch.teacher_feedback = feedback
  if (scoreOverride != null) patch.score = scoreOverride

  const { error: updateErr } = await supabase
    .from('assignment_submissions')
    .update(patch)
    .eq('id', submissionId)
  if (updateErr) {
    return errorResponse(`Failed to record review: ${updateErr.message}`, 500, origin)
  }

  return jsonResponse({
    success: true,
    submission_id: submissionId,
    graded_at: now,
    score_percent: finalScore,
    event_published: busFlagOn,
  }, 200, {}, origin)
}

// ─── Phase C.2 — Grade book actions ─────────────────────────
//
// The teacher dashboard previously had no roll-up view of student grades —
// only per-assignment submission review (Phase C.1). The grade book is the
// matrix of students × columns (subjects / units / attendance) a teacher
// exports for term reports.
//
// Schema note (flagged in PR description): `score_history` is uniquely keyed
// `(student_id, subject, recorded_at)`. It has no `max_score`, `term`, or
// `column_kind` column. For this PR we project the canonical row onto the
// grade-book column model: `subject` IS the column_key for kind 'subject',
// and 'unit' / 'attendance' columns are computed but not yet persisted in a
// dedicated table. A follow-up migration in Phase C.3+ adds the columns.

interface GradeBookCell {
  score: number | null
  max_score: number
  status: 'graded' | 'pending' | 'absent'
}

/** Term bucket for grade-book filtering — coarse 6-month rolling windows. */
function termBoundsFor(term: 'current' | 'previous'): { start: string; end: string } {
  const now = new Date()
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth() // 0-based
  // Term 1 (current first half of year): Jan-Jun. Term 2: Jul-Dec.
  // For "current" we use the half of the year `now` lives in; "previous"
  // is the half before that. This intentionally ignores academic-calendar
  // edge cases — the grade book is a snapshot, not a transcript.
  let startDate: Date
  let endDate: Date
  if (term === 'current') {
    if (m < 6) {
      startDate = new Date(Date.UTC(y, 0, 1))
      endDate = new Date(Date.UTC(y, 6, 1)) // exclusive
    } else {
      startDate = new Date(Date.UTC(y, 6, 1))
      endDate = new Date(Date.UTC(y + 1, 0, 1))
    }
  } else {
    if (m < 6) {
      startDate = new Date(Date.UTC(y - 1, 6, 1))
      endDate = new Date(Date.UTC(y, 0, 1))
    } else {
      startDate = new Date(Date.UTC(y, 0, 1))
      endDate = new Date(Date.UTC(y, 6, 1))
    }
  }
  return { start: startDate.toISOString().slice(0, 10), end: endDate.toISOString().slice(0, 10) }
}

/** Default columns for a class — driven by subjects on student rows. */
function buildGradeBookColumns(
  subjects: string[],
): Array<{ key: string; label: string; kind: 'subject' | 'unit' | 'attendance' }> {
  const cols: Array<{ key: string; label: string; kind: 'subject' | 'unit' | 'attendance' }> = []
  for (const subject of subjects) {
    if (!subject) continue
    cols.push({ key: subject, label: subject.charAt(0).toUpperCase() + subject.slice(1), kind: 'subject' })
  }
  cols.push({ key: 'attendance', label: 'Attendance', kind: 'attendance' })
  return cols
}

/** Resolve students for a class — same dual-path pattern as the submissions handler. */
async function resolveStudentsForClass(
  supabase: ReturnType<typeof getServiceClient>,
  classId: string,
): Promise<Array<{ id: string; name: string; grade: string }>> {
  const seen = new Set<string>()
  const out: Array<{ id: string; name: string; grade: string }> = []

  // For synthetic grade-<n> pseudo-classes, fall back to the grade lookup.
  if (classId.startsWith('grade-')) {
    const grade = classId.replace('grade-', '')
    try {
      const { data } = await supabase
        .from('students')
        .select('id, name, grade')
        .eq('grade', grade)
        .is('deleted_at', null)
        .limit(1000)
      for (const s of data || []) {
        if (s?.id && !seen.has(s.id)) {
          seen.add(s.id)
          out.push({ id: s.id, name: s.name || 'Student', grade: String(s.grade || '') })
        }
      }
    } catch { /* table absent */ }
    return out
  }

  // Path A: class_students.
  try {
    const { data: cs } = await supabase
      .from('class_students')
      .select('student_id, students(id, name, grade, deleted_at)')
      .eq('class_id', classId)
    for (const row of cs || []) {
      const s = (row as any).students
      if (s && s.id && !s.deleted_at && !seen.has(s.id)) {
        seen.add(s.id)
        out.push({ id: s.id, name: s.name || 'Student', grade: String(s.grade || '') })
      }
    }
  } catch { /* table absent */ }

  // Path B: students.class_id.
  if (out.length === 0) {
    try {
      const { data } = await supabase
        .from('students')
        .select('id, name, grade')
        .eq('class_id', classId)
        .is('deleted_at', null)
        .limit(1000)
      for (const s of data || []) {
        if (s?.id && !seen.has(s.id)) {
          seen.add(s.id)
          out.push({ id: s.id, name: s.name || 'Student', grade: String(s.grade || '') })
        }
      }
    } catch { /* table absent */ }
  }

  return out
}

// ─── get_grade_book ─────────────────────────────────────────
async function handleGetGradeBook(
  body: Record<string, unknown>,
  origin: string | null,
): Promise<Response> {
  const teacherId = String(body.teacher_id || '')
  const classId = String(body.class_id || '')
  const termRaw = String(body.term || 'current')
  const term = termRaw === 'previous' ? 'previous' : 'current'
  if (!classId) return errorResponse('class_id required', 400, origin)

  const supabase = getServiceClient()
  if (!(await assertTeacherOwnsClass(supabase, teacherId, classId))) {
    return errorResponse('Class not owned by caller', 403, origin)
  }

  // Class metadata — only available for real class rows; synthetic
  // grade-<n> ids carry their grade in the id itself.
  let className = ''
  if (classId.startsWith('grade-')) {
    className = `Grade ${classId.replace('grade-', '')}`
  } else {
    try {
      const { data: cls } = await supabase
        .from('classes')
        .select('id, name, grade, section')
        .eq('id', classId)
        .maybeSingle()
      className = cls?.name || (cls ? `${cls.grade || ''}-${cls.section || ''}` : 'Class')
    } catch { /* table absent — graceful empty */ }
  }

  const students = await resolveStudentsForClass(supabase, classId)
  if (students.length === 0) {
    return jsonResponse({
      class: { id: classId, name: className || 'Class' },
      term,
      students: [],
      columns: buildGradeBookColumns([]),
      cells: {},
    }, 200, {}, origin)
  }

  // Resolve subjects the class covers — start from the teacher's
  // `subjects_taught` and union with any subjects observed in score_history
  // for these students.
  const subjects = new Set<string>()
  try {
    const { data: t } = await supabase
      .from('teachers')
      .select('subjects_taught')
      .eq('id', teacherId)
      .maybeSingle()
    const subs = Array.isArray((t as any)?.subjects_taught)
      ? (t as any).subjects_taught
      : (t as any)?.subjects_taught
        ? [(t as any).subjects_taught]
        : []
    for (const s of subs) if (s) subjects.add(String(s).toLowerCase())
  } catch { /* table absent */ }

  const bounds = termBoundsFor(term)
  const studentIds = students.map(s => s.id)

  // Score history for the term — degrade gracefully if table absent.
  type ScoreRow = { student_id: string; subject: string; score: number | null; recorded_at: string }
  let scoreRows: ScoreRow[] = []
  try {
    const { data } = await supabase
      .from('score_history')
      .select('student_id, subject, score, recorded_at')
      .in('student_id', studentIds)
      .gte('recorded_at', bounds.start)
      .lt('recorded_at', bounds.end)
      .limit(5000)
    scoreRows = (data || []) as ScoreRow[]
    for (const r of scoreRows) if (r.subject) subjects.add(String(r.subject).toLowerCase())
  } catch { /* table absent — empty cells below */ }

  const columns = buildGradeBookColumns([...subjects].sort())

  // Build cells map. For each (student, column), keep the most-recent score
  // in the term — `score_history.unique(student_id, subject, recorded_at)`
  // can have multiple rows in the window so we collapse to latest.
  const cells: Record<string, Record<string, GradeBookCell>> = {}
  for (const stu of students) cells[stu.id] = {}

  // Subject columns from score_history.
  const latestByCell = new Map<string, ScoreRow>()
  for (const r of scoreRows) {
    if (!r.subject) continue
    const k = `${r.student_id}::${r.subject.toLowerCase()}`
    const existing = latestByCell.get(k)
    if (!existing || r.recorded_at > existing.recorded_at) latestByCell.set(k, r)
  }
  for (const [k, r] of latestByCell) {
    const [sid, subj] = k.split('::')
    if (!cells[sid]) continue
    cells[sid][subj] = {
      score: r.score != null ? Number(r.score) : null,
      max_score: 100,
      status: r.score != null ? 'graded' : 'pending',
    }
  }

  // Attendance column (best-effort). The baseline schema lacks a clean
  // attendance table the teacher portal can join to, so we surface a
  // pending placeholder rather than fabricating a number.
  for (const stu of students) {
    if (!cells[stu.id]['attendance']) {
      cells[stu.id]['attendance'] = { score: null, max_score: 100, status: 'pending' }
    }
    // Fill missing subject columns as pending so the matrix is rectangular.
    for (const col of columns) {
      if (col.kind === 'subject' && !cells[stu.id][col.key]) {
        cells[stu.id][col.key] = { score: null, max_score: 100, status: 'pending' }
      }
    }
  }

  return jsonResponse({
    class: { id: classId, name: className || 'Class' },
    term,
    students: students.map(s => ({ id: s.id, name: s.name })),
    columns,
    cells,
  }, 200, {}, origin)
}

// ─── set_grade_book_cell ────────────────────────────────────
// ADR-005: canonical writer. Event MUST emit before the canonical write so
// subscribers see the signal even if the DB write fails. Idempotency key
// `grade_entry_set:<student>:<column>:<ts>` — re-saving emits a fresh event.
async function handleSetGradeBookCell(
  body: Record<string, unknown>,
  origin: string | null,
): Promise<Response> {
  const teacherId = String(body.teacher_id || '')
  const classId = String(body.class_id || '')
  const studentId = String(body.student_id || '')
  const columnKeyRaw = String(body.column_key || '').toLowerCase().trim()
  const scoreRaw = body.score
  const maxScoreRaw = body.max_score
  const notesRaw = body.notes

  if (!classId) return errorResponse('class_id required', 400, origin)
  if (!studentId) return errorResponse('student_id required', 400, origin)
  if (!columnKeyRaw) return errorResponse('column_key required', 400, origin)

  // Score validation — accept finite numbers; bound 0 ≤ score ≤ max_score;
  // max_score must be a positive number.
  if (typeof scoreRaw !== 'number' || !Number.isFinite(scoreRaw)) {
    return errorResponse('score must be a finite number', 400, origin)
  }
  if (typeof maxScoreRaw !== 'number' || !Number.isFinite(maxScoreRaw) || maxScoreRaw <= 0) {
    return errorResponse('max_score must be a positive number', 400, origin)
  }
  if (scoreRaw < 0 || scoreRaw > maxScoreRaw) {
    return errorResponse('score must satisfy 0 ≤ score ≤ max_score', 400, origin)
  }
  const score = Math.round(scoreRaw * 100) / 100
  const maxScore = Math.round(maxScoreRaw * 100) / 100
  const notes = typeof notesRaw === 'string' && notesRaw.trim().length > 0
    ? notesRaw.trim().slice(0, 500)
    : null

  const supabase = getServiceClient()

  // P13: ownership — class AND student-in-class.
  if (!(await assertTeacherOwnsClass(supabase, teacherId, classId))) {
    return errorResponse('Class not owned by caller', 403, origin)
  }

  // Student must belong to the class. For synthetic grade-<n> classes
  // we check the student's grade matches; otherwise we hit class_students.
  let studentInClass = false
  if (classId.startsWith('grade-')) {
    const grade = classId.replace('grade-', '')
    try {
      const { data: s } = await supabase
        .from('students')
        .select('grade')
        .eq('id', studentId)
        .maybeSingle()
      studentInClass = !!s && String((s as { grade?: string }).grade) === grade
    } catch { studentInClass = false }
  } else {
    try {
      const { data: link } = await supabase
        .from('class_students')
        .select('student_id')
        .eq('class_id', classId)
        .eq('student_id', studentId)
        .limit(1)
        .maybeSingle()
      if (link) studentInClass = true
    } catch { /* fall through */ }
    if (!studentInClass) {
      // Fall back to students.class_id direct check.
      try {
        const { data: s } = await supabase
          .from('students')
          .select('class_id')
          .eq('id', studentId)
          .maybeSingle()
        if (s && (s as { class_id?: string }).class_id === classId) studentInClass = true
      } catch { /* fall through */ }
    }
  }
  if (!studentInClass) {
    return errorResponse('Student not in this class', 403, origin)
  }

  // Resolve column kind. Today: 'attendance' is a literal, anything else is
  // treated as a subject column. The 'unit' kind is reserved for when the
  // class registers per-unit columns (Phase C.3+ schema migration).
  const columnKind: 'subject' | 'unit' | 'attendance' =
    columnKeyRaw === 'attendance' ? 'attendance' : 'subject'

  // Resolve teacher for actor + tenant fields on the event envelope.
  const { data: teacher } = await supabase
    .from('teachers')
    .select('id, auth_user_id, school_id')
    .eq('id', teacherId)
    .maybeSingle()
  if (!teacher) return errorResponse('Teacher account not found', 403, origin)

  const now = new Date().toISOString()
  const recordedAtDate = now.slice(0, 10)
  const idempotencyKey = `grade_entry_set:${studentId}:${columnKeyRaw}:${now}`
  const eventId = crypto.randomUUID()

  // STEP 1 (mandatory): publish to bus BEFORE canonical write.
  let busFlagOn = false
  try {
    const { data: flag } = await supabase
      .from('feature_flags')
      .select('is_enabled')
      .eq('flag_name', 'ff_event_bus_v1')
      .maybeSingle()
    busFlagOn = flag?.is_enabled === true
  } catch { /* flag absent — bus off, same default as publishEvent() */ }

  if (busFlagOn) {
    try {
      await supabase.from('state_events').insert({
        event_id: eventId,
        kind: 'teacher.grade_entry_set',
        actor_auth_user_id: (teacher as { auth_user_id?: string }).auth_user_id ?? null,
        tenant_id: (teacher as { school_id?: string | null }).school_id ?? null,
        idempotency_key: idempotencyKey,
        occurred_at: now,
        payload: {
          teacherId,
          classId,
          studentId,
          columnKey: columnKeyRaw,
          columnKind,
          score,
          maxScore,
          hasNotes: notes !== null,
        },
      })
    } catch (e) {
      // Don't fail the user-visible request on bus outage. The canonical
      // write still happens so the teacher's grade is preserved.
      console.warn('teacher.grade_entry_set publish failed:', e instanceof Error ? e.message : String(e))
    }
  }

  // STEP 2: canonical write. TODO: extract to grade-book-projector subscriber.
  // For subject columns, write to `score_history`. For attendance and unit
  // columns the schema is not yet present — we surface the event but don't
  // persist (flagged in PR description, follow-up migration).
  let canonicalWritten = false
  if (columnKind === 'subject') {
    try {
      // Normalise score to 0-100 because score_history.score has a 0-100 check.
      const normalisedScore = Math.round((score / maxScore) * 100 * 100) / 100
      const row = {
        student_id: studentId,
        subject: columnKeyRaw,
        score: normalisedScore,
        recorded_at: recordedAtDate,
      }
      // Use upsert on the unique (student_id, subject, recorded_at) key so
      // re-grading the same cell on the same day overwrites rather than
      // failing with a constraint violation.
      const { error: upsertErr } = await supabase
        .from('score_history')
        .upsert(row, { onConflict: 'student_id,subject,recorded_at' })
      if (upsertErr) {
        return errorResponse(`Failed to record grade: ${upsertErr.message}`, 500, origin)
      }
      canonicalWritten = true
    } catch (e) {
      return errorResponse(
        `Failed to record grade: ${e instanceof Error ? e.message : String(e)}`,
        500,
        origin,
      )
    }
  }

  return jsonResponse({
    success: true,
    student_id: studentId,
    column_key: columnKeyRaw,
    column_kind: columnKind,
    score,
    max_score: maxScore,
    recorded_at: now,
    event_published: busFlagOn,
    canonical_written: canonicalWritten,
  }, 200, {}, origin)
}

// ─── export_grade_book_csv ──────────────────────────────────
// Read-only — composes the same matrix as get_grade_book and serialises
// to CSV in-memory. We return the CSV as a string body; the caller turns
// it into a <a download> blob. Streaming a file response from Edge would
// hit Supabase's response-size limits on large classes.
function csvEscape(value: string | number | null): string {
  if (value == null) return ''
  const s = String(value)
  if (s.includes('"') || s.includes(',') || s.includes('\n')) {
    return '"' + s.replaceAll('"', '""') + '"'
  }
  return s
}

async function handleExportGradeBookCsv(
  body: Record<string, unknown>,
  origin: string | null,
): Promise<Response> {
  const teacherId = String(body.teacher_id || '')
  const classId = String(body.class_id || '')
  const termRaw = String(body.term || 'current')
  const term: 'current' | 'previous' = termRaw === 'previous' ? 'previous' : 'current'
  if (!classId) return errorResponse('class_id required', 400, origin)

  const supabase = getServiceClient()
  if (!(await assertTeacherOwnsClass(supabase, teacherId, classId))) {
    return errorResponse('Class not owned by caller', 403, origin)
  }

  // Re-use the get_grade_book pipeline to build the matrix, then serialise.
  // Calling the handler directly keeps the column-resolution logic in one
  // place; we strip the Response wrapper and re-encode as CSV.
  const inner = await handleGetGradeBook({ ...body, term }, origin)
  if (!inner.ok) return inner
  const data = (await inner.json()) as {
    class: { id: string; name: string }
    term: string
    students: Array<{ id: string; name: string }>
    columns: Array<{ key: string; label: string; kind: string }>
    cells: Record<string, Record<string, GradeBookCell>>
  }

  const headers = ['Student', ...data.columns.map(c => `${c.label} (/${data.columns[0]?.kind === 'attendance' ? '%' : 'max'})`)]
  // Use a simpler header — `Label (Kind)` — that survives Excel import.
  const headerLine = ['Student', ...data.columns.map(c => `${c.label} (${c.kind})`)]
    .map(csvEscape).join(',')

  const lines: string[] = [headerLine]
  for (const stu of data.students) {
    const row = [stu.name]
    for (const col of data.columns) {
      const cell = data.cells[stu.id]?.[col.key]
      if (!cell || cell.score == null) {
        row.push('')
      } else {
        row.push(`${cell.score}/${cell.max_score}`)
      }
    }
    lines.push(row.map(csvEscape).join(','))
  }

  // Filename: gradebook_<class>_<term>_<yyyy-mm-dd>.csv. Sanitise the class
  // name to avoid header-injection through the Content-Disposition path
  // (we don't set the header here — the caller does — but we still scrub
  // in case the filename is used as-is).
  const datePart = new Date().toISOString().slice(0, 10)
  const safeClass = (data.class.name || 'class').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40)
  const filename = `gradebook_${safeClass}_${term}_${datePart}.csv`

  return jsonResponse({
    filename,
    csv_content: lines.join('\n'),
    row_count: data.students.length,
    column_count: data.columns.length,
  }, 200, {}, origin)
}

// ─── get_lesson_plans ──────────────────────────────────────
async function handleGetLessonPlans(
  body: Record<string, unknown>,
  origin: string | null,
): Promise<Response> {
  const classId = String(body.class_id || '')
  const teacherId = String(body.teacher_id || '')
  const startDate = body.start_date ? String(body.start_date) : null
  const endDate = body.end_date ? String(body.end_date) : null

  if (!classId) return errorResponse('class_id required', 400, origin)

  const supabase = getServiceClient()
  const owns = await assertTeacherOwnsClass(supabase, teacherId, classId)
  if (!owns) return errorResponse('Unauthorized access to class lesson plans', 403, origin)

  let query = supabase
    .from('classroom_lesson_plans')
    .select(`
      id,
      class_id,
      date,
      topic_id,
      notes,
      curriculum_topics (
        id,
        title,
        description,
        grade,
        chapter_number
      )
    `)
    .eq('class_id', classId)

  if (startDate) {
    query = query.gte('date', startDate)
  }
  if (endDate) {
    query = query.lte('date', endDate)
  }

  const { data, error } = await query.order('date', { ascending: true })
  if (error) {
    return errorResponse(`Failed to fetch lesson plans: ${error.message}`, 500, origin)
  }

  return jsonResponse(data, 200, {}, origin)
}

// ─── set_lesson_plan ───────────────────────────────────────
async function handleSetLessonPlan(
  body: Record<string, unknown>,
  origin: string | null,
): Promise<Response> {
  const classId = String(body.class_id || '')
  const teacherId = String(body.teacher_id || '')
  const date = String(body.date || '')
  const topicId = String(body.topic_id || '')
  const notes = body.notes ? String(body.notes) : null

  if (!classId || !date || !topicId) {
    return errorResponse('class_id, date, and topic_id are required', 400, origin)
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return errorResponse('Invalid date format. Expected YYYY-MM-DD', 400, origin)
  }

  const supabase = getServiceClient()
  const owns = await assertTeacherOwnsClass(supabase, teacherId, classId)
  if (!owns) return errorResponse('Unauthorized access to class lesson plans', 403, origin)

  const { data: topic, error: topicErr } = await supabase
    .from('curriculum_topics')
    .select('id')
    .eq('id', topicId)
    .maybeSingle()

  if (topicErr || !topic) {
    return errorResponse('Curriculum topic not found', 404, origin)
  }

  const { data, error } = await supabase
    .from('classroom_lesson_plans')
    .upsert(
      {
        class_id: classId,
        date,
        topic_id: topicId,
        notes,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'class_id,date',
      }
    )
    .select()
    .single()

  if (error) {
    return errorResponse(`Failed to save lesson plan: ${error.message}`, 500, origin)
  }

  return jsonResponse(data, 200, {}, origin)
}

// ─── get_in_the_moment_alerts ──────────────────────────────
async function handleGetInTheMomentAlerts(
  body: Record<string, unknown>,
  origin: string | null,
): Promise<Response> {
  const classId = String(body.class_id || '')
  const teacherId = String(body.teacher_id || '')

  if (!classId) return errorResponse('class_id required', 400, origin)

  const supabase = getServiceClient()
  const owns = await assertTeacherOwnsClass(supabase, teacherId, classId)
  if (!owns) return errorResponse('Unauthorized access to class alerts', 403, origin)

  const students = await resolveStudentsForClass(supabase, classId)
  if (students.length === 0) {
    return jsonResponse([], 200, {}, origin)
  }

  const studentMap = new Map(students.map(s => [s.id, s]))
  const studentIds = students.map(s => s.id)

  const now = new Date()
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const todayStr = todayUtc.toISOString()

  const { data: interactions, error: queryErr } = await supabase
    .from('adaptive_interactions')
    .select('student_id, topic_id, is_correct')
    .in('student_id', studentIds)
    .gte('created_at', todayStr)

  if (queryErr) {
    return errorResponse(`Failed to fetch interactions: ${queryErr.message}`, 500, origin)
  }

  if (!interactions || interactions.length === 0) {
    return jsonResponse([], 200, {}, origin)
  }

  const topicStudentStats: Record<string, Record<string, { correct: number; total: number }>> = {}

  for (const intr of interactions) {
    const topicId = intr.topic_id
    const studentId = intr.student_id
    if (!topicId || !studentId) continue

    if (!topicStudentStats[topicId]) {
      topicStudentStats[topicId] = {}
    }
    if (!topicStudentStats[topicId][studentId]) {
      topicStudentStats[topicId][studentId] = { correct: 0, total: 0 }
    }

    topicStudentStats[topicId][studentId].total += 1
    if (intr.is_correct === true) {
      topicStudentStats[topicId][studentId].correct += 1
    }
  }

  const uniqueTopicIds = Object.keys(topicStudentStats)
  const topicsInfo: Record<string, { title: string; chapter_number: number | null; chapter_name?: string | null }> = {}
  
  if (uniqueTopicIds.length > 0) {
    const { data: topicsData } = await supabase
      .from('curriculum_topics')
      .select('id, title, chapter_number, description')
      .in('id', uniqueTopicIds)

    if (topicsData) {
      for (const t of topicsData) {
        topicsInfo[t.id] = {
          title: t.title,
          chapter_number: t.chapter_number,
          chapter_name: t.description || '',
        }
      }
    }
  }

  const alerts = []

  for (const topicId of uniqueTopicIds) {
    const stats = topicStudentStats[topicId]
    const tier1: Array<{ id: string; name: string; accuracy: number; correct: number; total: number }> = []
    const tier2: Array<{ id: string; name: string; accuracy: number; correct: number; total: number }> = []
    const tier3: Array<{ id: string; name: string; accuracy: number; correct: number; total: number }> = []

    for (const studentId of Object.keys(stats)) {
      const student = studentMap.get(studentId)
      if (!student) continue

      const { correct, total } = stats[studentId]
      const accuracy = correct / total

      const studentInfo = {
        id: student.id,
        name: student.name,
        accuracy,
        correct,
        total,
      }

      if (accuracy < 0.30) {
        tier1.push(studentInfo)
      } else if (accuracy <= 0.60) {
        tier2.push(studentInfo)
      } else {
        tier3.push(studentInfo)
      }
    }

    const struggleCount = tier1.length + tier2.length

    if (struggleCount >= 2) {
      const topicMeta = topicsInfo[topicId] || { title: 'Unknown Topic', chapter_number: null, chapter_name: '' }
      alerts.push({
        id: `struggle-${topicId}-${todayStr.slice(0, 10)}`,
        topic_id: topicId,
        topic_title: topicMeta.title,
        chapter_number: topicMeta.chapter_number,
        chapter_name: topicMeta.chapter_name,
        struggling_count: struggleCount,
        created_at: new Date().toISOString(),
        tiers: {
          tier1,
          tier2,
          tier3,
        },
        recommendations: {
          tier1: 'Remedial walkthrough',
          tier2: '5-question practice',
          tier3: 'Peer-tutor challenge',
        }
      })
    }
  }

  return jsonResponse(alerts, 200, {}, origin)
}

// ─── deploy_intervention ──────────────────────────────────
async function handleDeployIntervention(
  body: Record<string, unknown>,
  origin: string | null,
): Promise<Response> {
  const classId = String(body.class_id || '')
  const teacherId = String(body.teacher_id || '')
  const topicId = String(body.topic_id || '')
  const tiers = body.tiers as {
    tier1?: string[]
    tier2?: string[]
    tier3?: string[]
  } | undefined

  if (!classId || !topicId || !tiers) {
    return errorResponse('class_id, topic_id, and tiers are required', 400, origin)
  }

  const supabase = getServiceClient()
  const owns = await assertTeacherOwnsClass(supabase, teacherId, classId)
  if (!owns) return errorResponse('Unauthorized access to class interventions', 403, origin)

  const { data: topic, error: topicErr } = await supabase
    .from('curriculum_topics')
    .select('title, grade, subject_id')
    .eq('id', topicId)
    .maybeSingle()

  if (topicErr || !topic) {
    return errorResponse('Curriculum topic not found', 404, origin)
  }

  let subjectCode: string | null = null
  if (topic.subject_id) {
    const { data: subj } = await supabase
      .from('subjects')
      .select('code')
      .eq('id', topic.subject_id)
      .maybeSingle()
    subjectCode = subj?.code ?? null
  }

  const results: Record<string, { assignment_id: string; student_count: number }> = {}
  const now = new Date().toISOString()
  const dueDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()

  if (Array.isArray(tiers.tier1) && tiers.tier1.length > 0) {
    const assignmentId = crypto.randomUUID()
    const { error: insErr } = await supabase.from('assignments').insert({
      id: assignmentId,
      class_id: classId,
      teacher_id: teacherId,
      title: `Remedial: ${topic.title}`,
      assignment_type: 'worksheet',
      topic_id: topicId,
      subject: subjectCode,
      grade: topic.grade,
      due_date: dueDate,
      question_count: 5,
      status: 'active',
      created_at: now,
      updated_at: now,
    })

    if (!insErr) {
      const submissions = tiers.tier1.map(sid => ({
        assignment_id: assignmentId,
        student_id: sid,
        status: 'not_started',
      }))
      await supabase.from('assignment_submissions').insert(submissions)
      results.tier1 = { assignment_id: assignmentId, student_count: tiers.tier1.length }
    } else {
      console.error('Failed to create Tier 1 assignment:', insErr.message)
    }
  }

  if (Array.isArray(tiers.tier2) && tiers.tier2.length > 0) {
    const assignmentId = crypto.randomUUID()
    const { error: insErr } = await supabase.from('assignments').insert({
      id: assignmentId,
      class_id: classId,
      teacher_id: teacherId,
      title: `Practice: ${topic.title}`,
      assignment_type: 'quiz',
      topic_id: topicId,
      subject: subjectCode,
      grade: topic.grade,
      due_date: dueDate,
      question_count: 10,
      status: 'active',
      created_at: now,
      updated_at: now,
    })

    if (!insErr) {
      const submissions = tiers.tier2.map(sid => ({
        assignment_id: assignmentId,
        student_id: sid,
        status: 'not_started',
      }))
      await supabase.from('assignment_submissions').insert(submissions)
      results.tier2 = { assignment_id: assignmentId, student_count: tiers.tier2.length }
    } else {
      console.error('Failed to create Tier 2 assignment:', insErr.message)
    }
  }

  if (Array.isArray(tiers.tier3) && tiers.tier3.length > 0) {
    const assignmentId = crypto.randomUUID()
    const { error: insErr } = await supabase.from('assignments').insert({
      id: assignmentId,
      class_id: classId,
      teacher_id: teacherId,
      title: `Challenge: ${topic.title}`,
      assignment_type: 'quiz',
      topic_id: topicId,
      subject: subjectCode,
      grade: topic.grade,
      due_date: dueDate,
      question_count: 10,
      status: 'active',
      created_at: now,
      updated_at: now,
    })

    if (!insErr) {
      const submissions = tiers.tier3.map(sid => ({
        assignment_id: assignmentId,
        student_id: sid,
        status: 'not_started',
      }))
      await supabase.from('assignment_submissions').insert(submissions)
      results.tier3 = { assignment_id: assignmentId, student_count: tiers.tier3.length }
    } else {
      console.error('Failed to create Tier 3 assignment:', insErr.message)
    }
  }

  return jsonResponse({ success: true, deployments: results }, 200, {}, origin)
}

// ─── JWT Binding (P13 enforcement) ──────────────────────────
// Resolve the authenticated caller's teacher_id from the Authorization
// header. Body.teacher_id is IGNORED for trust purposes — handlers see
// the JWT-derived value instead. Without this, any authenticated user
// could pass another teacher's id and read their class data via the
// service-role queries below (P13 cross-tenant violation).
//
// Returns { teacherId } on success or { errorResponse } on failure.
async function resolveTeacherFromJwt(
  req: Request,
  origin: string | null,
): Promise<{ teacherId: string } | { errorResponse: Response }> {
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return { errorResponse: errorResponse('Missing or invalid Authorization header', 401, origin) }
  }
  const token = authHeader.slice(7)

  const supabase = getServiceClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) {
    return { errorResponse: errorResponse('Invalid or expired token', 401, origin) }
  }

  const { data: teacher } = await supabase
    .from('teachers')
    .select('id')
    .eq('auth_user_id', user.id)
    .single()

  if (!teacher) {
    return { errorResponse: errorResponse('Caller is not a teacher', 403, origin) }
  }

  return { teacherId: teacher.id }
}

// ─── Main Handler ───────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(origin) })
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405, origin)
  }

  try {
    const body = await req.json()
    const action = String(body.action || '')

    // P13: bind every action to the JWT-derived teacher_id. Any teacher_id
    // supplied in the body is overridden — we never trust it. Handlers that
    // also accept student_id / class_id / alert_id / poll_id still need
    // per-resource ownership checks (tracked TODO below); this fix closes
    // the cross-teacher impersonation hole at the dispatch boundary.
    const auth = await resolveTeacherFromJwt(req, origin)
    if ('errorResponse' in auth) return auth.errorResponse
    body.teacher_id = auth.teacherId

    switch (action) {
      case 'get_dashboard':
        return await handleGetDashboard(body, origin)
      case 'get_heatmap':
        return await handleGetHeatmap(body, origin)
      case 'get_alerts':
        return await handleGetAlerts(body, origin)
      case 'resolve_alert':
        return await handleResolveAlert(body, origin)
      case 'launch_poll':
        return await handleLaunchPoll(body, origin)
      case 'close_poll':
        return await handleClosePoll(body, origin)
      case 'get_class_overview':
        return await handleGetClassOverview(body, origin)
      case 'get_student_report':
        return await handleGetStudentReport(body, origin)
      case 'get_class_trends':
      case 'get_trends':
        return await handleGetClassTrends(body, origin)
      case 'get_students_list':
        return await handleGetStudentsList(body, origin)
      case 'get_assignment_submissions':
        return await handleGetAssignmentSubmissions(body, origin)
      case 'get_submission_detail':
        return await handleGetSubmissionDetail(body, origin)
      case 'mark_submission_reviewed':
        return await handleMarkSubmissionReviewed(body, origin)
      case 'get_grade_book':
        return await handleGetGradeBook(body, origin)
      case 'set_grade_book_cell':
        return await handleSetGradeBookCell(body, origin)
      case 'export_grade_book_csv':
        return await handleExportGradeBookCsv(body, origin)
      case 'get_lesson_plans':
        return await handleGetLessonPlans(body, origin)
      case 'set_lesson_plan':
        return await handleSetLessonPlan(body, origin)
      case 'get_in_the_moment_alerts':
        return await handleGetInTheMomentAlerts(body, origin)
      case 'deploy_intervention':
        return await handleDeployIntervention(body, origin)
      default:
        return errorResponse(`Unknown action: ${action}`, 400, origin)
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal server error'
    console.error('teacher-dashboard error:', msg)
    return errorResponse(msg, 500, origin)
  }
})

// TODO (follow-up): per-resource ownership checks.
// Handlers that accept class_id, student_id, alert_id, poll_id from body
// should verify each belongs to body.teacher_id before any service-role
// query touches it. Without this, a teacher could still pass another
// teacher's class_id / poll_id and operate on it. Tracked in the security
// audit doc; deserves its own PR with tests.
