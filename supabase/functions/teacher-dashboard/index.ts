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
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts'
// P12: teachers should only see subjects each student is currently enrolled in
// (grade-map ∩ plan). See:
//   docs/superpowers/specs/2026-04-15-subject-governance-design.md §6.2

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

function getServiceClient() {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
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
  return !!assignment
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
        return await handleGetClassTrends(body, origin)
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
