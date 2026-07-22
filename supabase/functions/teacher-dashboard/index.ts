/**
 * teacher-dashboard — Supabase Edge Function
 *
 * Serves the teacher portal with class management, mastery heatmaps,
 * at-risk student alerts, and classroom polling.
 *
 * Actions:
 *   - get_dashboard:       Teacher info, classes, aggregate stats
 *   - get_heatmap:         Student × concept mastery matrix
 *   - get_alerts:          At-risk student detection (each alert additively
 *                          carries `remediation_status` — Phase 3A Wave A / A2)
 *   - resolve_alert:       Mark alert as resolved
 *   - launch_poll:         Create classroom poll
 *   - close_poll:          Close poll and return results
 *   - get_class_overview:  Reports / class aggregate snapshot
 *   - get_student_report:  Reports / per-student deep dive
 *   - get_class_trends:    Reports / 30-day rolling trends
 *   - get_assignment_submissions: Phase C.1 / submission list per assignment
 *   - get_grading_queue:          Phase 3A Wave B / cross-assignment queue of
 *                                 submissions awaiting grading (+ count badge,
 *                                 needs_review_reason exception signal)
 *   - get_submission_detail:      Phase C.1 / per-question breakdown
 *   - mark_submission_reviewed:   Phase C.1 / record feedback + score override
 *   - get_grade_book:             Phase C.2 / matrix of students × columns
 *   - set_grade_book_cell:        Phase C.2 / set one (student, column) cell
 *   - export_grade_book_csv:      Phase C.2 / export grade book matrix as CSV
 *   - mark_attendance:            Phase 1 / bulk-upsert daily roll call for a class
 *   - get_attendance_record:      Phase 1 / fetch attendance records for a class on a date
 *   - get_student_mastery_report: Phase 3A Wave C / one roster student's mastery
 *                                 (BKT verbatim) + Bloom's (correct/total over
 *                                 answered quiz_responses) deep dive
 *   - get_class_mastery_bloom_summary: Phase 3A Wave C / class-level avg mastery
 *                                 per concept + Bloom's distribution rollup
 *   - export_student_report:      Phase 3A Wave C / per-student mastery+Bloom
 *                                 report as a parent-readable CSV
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts'
import {
  averageFractionsAsPercent,
  averagePercentages,
  averageScopedMasteryByStudent,
  finiteMetricOrNull,
  resolveClassCurriculumScope,
  resolveStudentMastery,
  shapeCohortBktMasteryMap,
} from './metrics.ts'
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

type CurriculumTopicScopeRow = {
  id: string
  title: string
  chapter_number: number | null
}

/**
 * Resolve active curriculum topics for one governed grade + subject code.
 * `curriculum_topics` stores a subject UUID, so resolve the public subject code
 * through `subjects` instead of querying a non-existent subject_code column.
 */
async function listCurriculumTopicsForScope(
  supabase: ReturnType<typeof getServiceClient>,
  grade: string | null,
  subjectCode: string | null,
  limit = 2000,
): Promise<CurriculumTopicScopeRow[]> {
  if (!grade || !subjectCode) return []

  const { data: subject, error: subjectError } = await supabase
    .from('subjects')
    .select('id')
    .eq('code', subjectCode)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()
  if (subjectError || !subject?.id) return []

  const { data: topics, error: topicsError } = await supabase
    .from('curriculum_topics')
    .select('id, title, chapter_number')
    .eq('grade', grade)
    .eq('subject_id', subject.id)
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('chapter_number')
    .order('display_order')
    .limit(limit)

  if (topicsError) return []
  return (topics || []).map((topic) => ({
    id: String(topic.id),
    title: String(topic.title || ''),
    chapter_number: topic.chapter_number == null ? null : Number(topic.chapter_number),
  }))
}

// ─── Per-resource ownership helpers (P13 follow-up to JWT binding) ──────
// JWT binding alone prevents teacher A from impersonating teacher B by
// passing B's teacher_id. But several handlers also accept class_id /
// alert_id / poll_id from the body and operate on them with the
// service-role client — without these checks, A could still fetch B's
// class roster heatmap or close B's poll by passing B's class_id.

/**
 * Resolve the AUTHENTICATED teacher's tenant (school_id), used to tenant-scope
 * every grade-fallback student query (TSB-1, P8/P13).
 *
 * `teacherId` is ALWAYS the JWT-bound id: the request dispatcher overwrites
 * `body.teacher_id` with `resolveTeacherFromJwt`'s Bearer-derived value before
 * any handler runs, so this lookup is auth-derived and NEVER trusts a
 * request-supplied id.
 *
 * Returns the school_id string, or `null` when the teacher belongs to no
 * institution (independent / B2C teacher). Callers MUST treat `null` as
 * FAIL-CLOSED: a grade fallback for a school-less teacher returns NO students.
 * It must never fan out across all tenants — that is exactly the cross-tenant
 * leak this guards against.
 */
async function resolveTeacherSchoolId(
  supabase: ReturnType<typeof getServiceClient>,
  teacherId: string,
): Promise<string | null> {
  if (!teacherId) return null
  try {
    const { data: teacher } = await supabase
      .from('teachers')
      .select('school_id')
      .eq('id', teacherId)
      .maybeSingle()
    const sid = (teacher as { school_id?: string | null } | null)?.school_id
    return sid ? String(sid) : null
  } catch {
    return null
  }
}

/**
 * Verify that `classId` belongs to `teacherId`, or that the synthetic
 * `grade-<n>` pseudo-class id corresponds to a grade the teacher teaches
 * WITHIN the teacher's own school.
 * Used by handlers that accept a class_id from the request body.
 */
async function assertTeacherOwnsClass(
  supabase: ReturnType<typeof getServiceClient>,
  teacherId: string,
  classId: string,
): Promise<boolean> {
  if (!classId) return false

  // Synthetic id used when the teacher has no class assignments — must
  // correspond to a grade in the teacher's grades_taught array AND the
  // teacher must belong to a school. TSB-1 (P8/P13): a teacher with no
  // school_id (independent/B2C) cannot own a grade pseudo-class, because the
  // downstream grade fallback has no tenant to scope to and would otherwise
  // fan out across every school's students. Fail-closed for the null-school
  // case; the teacher must reach students through an explicit class roster.
  if (classId.startsWith('grade-')) {
    const grade = classId.replace('grade-', '')
    const { data: teacher } = await supabase
      .from('teachers')
      .select('grades_taught, school_id')
      .eq('id', teacherId)
      .single()
    if (!teacher) return false
    if (!(teacher as { school_id?: string | null }).school_id) return false
    const grades = Array.isArray(teacher.grades_taught)
      ? teacher.grades_taught.map(String)
      : teacher.grades_taught != null
      ? [String(teacher.grades_taught)]
      : []
    return grades.includes(grade)
  }

  const { data: classTeacher } = await supabase
    .from('class_teachers')
    .select('class_id')
    .eq('teacher_id', teacherId)
    .eq('class_id', classId)
    .limit(1)
    .maybeSingle()
  if (classTeacher) return true

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
    .select('id, name, school_name, school_id, subjects_taught, grades_taught')
    .eq('id', teacherId)
    .single()

  if (!teacher) return errorResponse('Teacher not found', 404, origin)

  const teacherSubjectCodes = (Array.isArray(teacher.subjects_taught)
    ? teacher.subjects_taught
    : teacher.subjects_taught != null
      ? [teacher.subjects_taught]
      : [])
    .map((subject) => String(subject).trim().toLowerCase())
    .filter(Boolean)

  // Per-class roster student shape surfaced to /teacher/classes' expanded view
  // (cls.students). Field names match the frontend ClassData contract exactly
  // (src/app/teacher/classes/page.tsx:56):
  //   { id, name, xp, mastery }
  // `xp` is the student's existing xp_total (read-only; no XP math changed).
  // `mastery` is the same BKT p_know average already used by the heatmap,
  // rounded to a percent (no mastery math changed).
  type DashStudent = {
    id: string
    class_id: string
    name: string
    grade: string | null
    xp: number | null
    mastery: number | null
  }
  // Per-class assignment shape surfaced to /teacher/classes (cls.assignments).
  // Field names match the frontend ClassData contract exactly
  // (src/app/teacher/classes/page.tsx:57): { id, title, type, due_date }
  type DashAssignment = {
    id: string
    title: string
    type: string
    due_date: string | null
  }

  // Fetch classes assigned to this teacher
  let classes: Array<{
    id: string
    name: string
    grade: string | null
    section: string | null
    subject: string | null
    class_code: string | null
    student_count: number
    avg_mastery?: number | null
    students?: DashStudent[]
    assignments?: DashAssignment[]
  }> = []
  try {
    const { data: classData } = await supabase
      .from('class_teachers')
      .select('class_id, classes(id, name, grade, section, subject, class_code)')
      .eq('teacher_id', teacherId)

    if (classData && classData.length > 0) {
      // Get student counts per class. Roster lives in the class_students
      // join table (there is no students.class_id column) — resolve the
      // class's student ids, then count live (non-deleted) rows by id.
      for (const assignment of classData) {
        const cls = (assignment as any).classes
        if (!cls) continue
        let count = 0
        const { data: roster } = await supabase
          .from('class_students')
          .select('student_id')
          .eq('class_id', cls.id)
        const rosterIds = (roster || [])
          .map((r: any) => r.student_id as string | null)
          .filter((id): id is string => !!id)

        // Lightweight per-class roster students[] for the expanded view. Load
        // live (non-deleted) student id+name+xp_total, then attach a coarse BKT
        // mastery snapshot (avg p_know across that student's concept_mastery
        // rows). Shape matches the frontend contract: { id, name, xp, mastery }.
        const dashStudents: DashStudent[] = []
        if (rosterIds.length > 0) {
          const { count: liveCount } = await supabase
            .from('students')
            .select('*', { count: 'exact', head: true })
            .in('id', rosterIds)
            .is('deleted_at', null)
          count = liveCount ?? 0

          const { data: liveStudents } = await supabase
            .from('students')
            .select('id, name, grade, xp_total')
            .in('id', rosterIds)
            .is('deleted_at', null)
            .limit(200)
          const liveIds = (liveStudents || []).map((s: any) => String(s.id))
          // Resolve the class-owned curriculum slice before reading mastery.
          // A class metric must not average a student's unrelated grades or
          // subjects into this class card.
          const classScope = resolveClassCurriculumScope(
            String(cls.id),
            cls.grade,
            cls.subject,
            undefined,
            teacherSubjectCodes,
          )
          const scopedTopics = await listCurriculumTopicsForScope(
            supabase,
            classScope.grade,
            classScope.subjectCode,
          )
          const scopedTopicIds = scopedTopics.map((topic) => topic.id)
          let masteryRows: Array<{ student_id: unknown; topic_id: unknown; p_know: unknown }> = []
          if (liveIds.length > 0 && scopedTopicIds.length > 0) {
            try {
              const { data: cm } = await supabase
                .from('concept_mastery')
                .select('student_id, topic_id, p_know')
                .in('student_id', liveIds)
                .in('topic_id', scopedTopicIds)
                .limit(20000)
              masteryRows = cm || []
            } catch { /* concept_mastery absent -- mastery remains unavailable */ }
          }
          const masteryByStudent = averageScopedMasteryByStudent(
            liveIds,
            scopedTopicIds,
            masteryRows,
          )
          for (const s of liveStudents || []) {
            const sid = String((s as any).id)
            dashStudents.push({
              id: sid,
              class_id: String(cls.id),
              name: (s as any).name || 'Student',
              grade: (s as any).grade == null ? null : String((s as any).grade),
              xp: finiteMetricOrNull((s as any).xp_total),
              mastery: masteryByStudent.get(sid) ?? null,
            })
          }
        }

        // Lightweight per-class assignments[] for the expanded view. Shape
        // matches the frontend contract: { id, title, type, due_date }. `type`
        // is the assignment_type column (the kind label the UI renders).
        // Degrade gracefully if the table is absent on this env.
        const dashAssignments: DashAssignment[] = []
        try {
          const { data: classAssignments } = await supabase
            .from('assignments')
            .select('id, title, assignment_type, due_date')
            .eq('class_id', cls.id)
            .order('due_date', { ascending: false, nullsFirst: false })
            .limit(50)
          for (const a of classAssignments || []) {
            dashAssignments.push({
              id: String((a as any).id),
              title: (a as any).title || 'Assignment',
              type: String((a as any).assignment_type || 'assignment'),
              due_date: (a as any).due_date ? String((a as any).due_date) : null,
            })
          }
        } catch { /* assignments table absent — empty assignments[] */ }

        classes.push({
          id: cls.id,
          name: cls.name || `${cls.grade}-${cls.section || 'A'}`,
          grade: cls.grade == null ? null : String(cls.grade),
          section: cls.section == null ? null : String(cls.section),
          subject: cls.subject == null ? null : String(cls.subject),
          class_code: cls.class_code == null ? null : String(cls.class_code),
          student_count: count ?? 0,
          avg_mastery: averagePercentages(dashStudents.map((student) => student.mastery)),
          students: dashStudents,
          assignments: dashAssignments,
        })
      }
    }
  } catch {
    // Classes table may not exist — return empty
    classes = []
  }

  // If no class assignments found, try to find students by grade — scoped to
  // the teacher's own school (TSB-1, P8/P13). A teacher with no school_id
  // (independent/B2C) gets NO grade pseudo-classes at all: the count would
  // otherwise expose how many students each other school has in that grade.
  const dashSchoolId = (teacher as { school_id?: string | null }).school_id
  if (classes.length === 0 && teacher.grades_taught && dashSchoolId) {
    const grades = Array.isArray(teacher.grades_taught) ? teacher.grades_taught : [teacher.grades_taught]
    for (const grade of grades) {
      const { count } = await supabase
        .from('students')
        .select('*', { count: 'exact', head: true })
        .eq('grade', String(grade))
        .eq('school_id', dashSchoolId)
      classes.push({
        id: `grade-${grade}`,
        name: `Grade ${grade}`,
        grade: String(grade),
        section: null,
        subject: null,
        class_code: null,
        student_count: count ?? 0,
        avg_mastery: null,
        students: [],
        assignments: [],
      })
    }
  }

  const totalStudents = classes.reduce((sum, c) => sum + c.student_count, 0)

  // Count recent alerts only inside the JWT-resolved teacher roster. The
  // service-role client must never turn this summary into a cross-school read.
  let activeAlerts = 0
  let criticalAlerts = 0
  try {
    const dashboardStudents = await resolveStudentsForTeacher(supabase, teacherId)
    const dashboardStudentIds = dashboardStudents.map((student) => student.id)
    const { data: lowPerf } = dashboardStudentIds.length > 0
      ? await supabase
        .from('student_learning_profiles')
        .select('student_id, total_questions_asked, total_questions_answered_correctly')
        .in('student_id', dashboardStudentIds)
        .gt('total_questions_asked', 5)
      : { data: [] }

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
      // The current assignment rows do not expose a governed "active" state.
      // Null is honest; the frontend renders it as unavailable.
      active_assignments: null,
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

  // Resolve the governed class curriculum scope. For regular classes, grade
  // and default subject come from owned class metadata. A requested subject may
  // override the default only when it is in the teacher's subject assignment.
  const isGradeId = classId.startsWith('grade-')
  const pseudoGrade = isGradeId ? classId.replace('grade-', '') : null
  const { data: classMetadata } = isGradeId
    ? { data: null }
    : await supabase
      .from('classes')
      .select('grade, subject')
      .eq('id', classId)
      .limit(1)
      .maybeSingle()
  const { data: teacherScope } = await supabase
    .from('teachers')
    .select('subjects_taught')
    .eq('id', teacherId)
    .limit(1)
    .maybeSingle()
  const allowedSubjects = Array.isArray(teacherScope?.subjects_taught)
    ? teacherScope.subjects_taught
    : teacherScope?.subjects_taught != null
      ? [teacherScope.subjects_taught]
      : []
  let curriculumScope = resolveClassCurriculumScope(
    classId,
    classMetadata?.grade ?? pseudoGrade,
    classMetadata?.subject,
    subject,
    allowedSubjects,
  )

  // Determine students in this class/grade.
  let students: Array<{ id: string; name: string | null; grade: string | null }> | null = null
  if (isGradeId && pseudoGrade) {
    // TSB-1 (P8/P13): the grade pseudo-class fans out by grade only — scope it
    // to the teacher's OWN school. Fail-closed (empty) when the teacher has no
    // school. assertTeacherOwnsClass already 403s a school-less teacher above;
    // this is the same-school defense-in-depth so a teacher cannot read OTHER
    // schools' students in their grade.
    const schoolId = await resolveTeacherSchoolId(supabase, teacherId)
    if (schoolId) {
      const { data } = await supabase
        .from('students')
        .select('id, name, grade')
        .eq('grade', pseudoGrade)
        .eq('school_id', schoolId)
        .limit(50)
      students = data
    }
  } else {
    // Roster lives in class_students (no students.class_id column):
    // resolve the class's student ids, then load those students by id.
    const { data: roster } = await supabase
      .from('class_students')
      .select('student_id')
      .eq('class_id', classId)
    const rosterIds = (roster || [])
      .map((r: any) => r.student_id as string | null)
      .filter((id): id is string => !!id)
    if (rosterIds.length > 0) {
      const { data } = await supabase
        .from('students')
        .select('id, name, grade')
        .in('id', rosterIds)
        .limit(50)
      students = data
    }
  }

  if (!students || students.length === 0) {
    return jsonResponse({
      class_id: classId,
      grade: curriculumScope.grade,
      subject: curriculumScope.subjectCode,
      student_count: 0,
      concept_count: 0,
      concepts: [],
      matrix: [],
    }, 200, {}, origin)
  }

  // If legacy class metadata has no grade, accept only one unambiguous roster
  // grade. Multiple grades fail honest (no concepts) rather than broadening.
  if (!curriculumScope.grade) {
    const rosterGrades = [...new Set(
      students.map((student) => student.grade == null ? '' : String(student.grade).trim()).filter(Boolean),
    )]
    if (rosterGrades.length === 1) {
      curriculumScope = { ...curriculumScope, grade: rosterGrades[0].replace(/^grade\s+/i, '') }
    }
  }

  const scopedTopics = await listCurriculumTopicsForScope(
    supabase,
    curriculumScope.grade,
    curriculumScope.subjectCode,
    12,
  )
  const conceptList = scopedTopics.map((concept) => ({
    id: concept.id,
    title: concept.title,
    chapter: concept.chapter_number,
  }))

  // Build mastery matrix
  const matrix = []
  for (const student of students) {
    const cells = []
    const observedMastery: number[] = []

    for (const concept of conceptList) {
      // Try BKT mastery state
      let pKnow = 0
      let attempts = 0
      let level = 'none'

      try {
        const { data: bkt } = await supabase
          .from('concept_mastery')
          .select('p_know, attempts, mastery_level')
          .eq('student_id', student.id)
          .eq('topic_id', concept.id)
          .single()

        if (bkt) {
          const observedPKnow = finiteMetricOrNull(bkt.p_know)
          if (observedPKnow !== null) {
            pKnow = observedPKnow
            observedMastery.push(observedPKnow)
          }
          attempts = bkt.attempts ?? 0
          level = bkt.mastery_level || 'none'
        }
      } catch { /* table may not exist */ }

      cells.push({ p_know: pKnow, level, attempts })
    }

    const avgMastery = averageFractionsAsPercent(observedMastery)

    matrix.push({
      student_id: student.id,
      class_id: classId,
      student_name: student.name || 'Student',
      grade: student.grade == null ? null : String(student.grade),
      avg_mastery: avgMastery,
      cells,
    })
  }

  return jsonResponse({
    class_id: classId,
    grade: curriculumScope.grade,
    subject: curriculumScope.subjectCode,
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

  // Get students. Roster lives in class_students (no students.class_id
  // column): resolve the class's student ids, then load those students.
  let students: Array<{ id: string; name: string | null; grade: string | null }> | null = null
  if (isGradeId && grade) {
    // TSB-1 (P8/P13): scope the grade pseudo-class to the teacher's OWN school.
    // Fail-closed (empty) for a school-less teacher; same-school defense-in-depth
    // beyond the assertTeacherOwnsClass gate so a teacher cannot read OTHER
    // schools' students in their grade.
    const schoolId = await resolveTeacherSchoolId(supabase, teacherId)
    if (schoolId) {
      const { data } = await supabase
        .from('students')
        .select('id, name, grade')
        .eq('grade', grade)
        .eq('school_id', schoolId)
        .limit(100)
      students = data
    }
  } else {
    const { data: roster } = await supabase
      .from('class_students')
      .select('student_id')
      .eq('class_id', classId)
    const rosterIds = (roster || [])
      .map((r: any) => r.student_id as string | null)
      .filter((id): id is string => !!id)
    if (rosterIds.length > 0) {
      const { data } = await supabase
        .from('students')
        .select('id, name, grade')
        .in('id', rosterIds)
        .limit(100)
      students = data
    }
  }

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

  // Phase 3A Wave A / A2 — surface remediation status on each alert (additive,
  // backward-compatible). These derived alerts have synthetic ids and no
  // at_risk_alerts row, so we join teacher_remediation_assignments by
  // (teacher_id, student_id). A student carries the "most-open" status among
  // the caller-teacher's remediation rows for them: in_progress > assigned >
  // resolved > (none). dismissed rows are ignored (treated as none).
  const remediationByStudent = await resolveRemediationStatusByStudent(
    supabase,
    teacherId,
    studentIds,
  )
  const alertsWithRemediation = alerts.map((a) => ({
    ...a,
    remediation_status: remediationByStudent.get(a.student_id) ?? 'none',
  }))

  return jsonResponse(alertsWithRemediation, 200, {}, origin)
}

// ─── Remediation-status join (Phase 3A Wave A / A2) ─────────────────────
// Resolves the open remediation status per student for a teacher. Returns a
// Map<student_id, 'assigned' | 'in_progress' | 'resolved'>. Students with no
// remediation row (or only dismissed rows) are absent — callers default to
// 'none'. The table may be absent on older envs; we fail soft to an empty map
// so the alerts payload still renders.
type RemediationStatus = 'assigned' | 'in_progress' | 'resolved'

async function resolveRemediationStatusByStudent(
  supabase: ReturnType<typeof getServiceClient>,
  teacherId: string,
  studentIds: string[],
): Promise<Map<string, RemediationStatus>> {
  const out = new Map<string, RemediationStatus>()
  if (!teacherId || studentIds.length === 0) return out

  // Precedence: in_progress (2) beats assigned (1) beats resolved (0).
  const rank: Record<RemediationStatus, number> = { resolved: 0, assigned: 1, in_progress: 2 }

  try {
    const { data: rows } = await supabase
      .from('teacher_remediation_assignments')
      .select('student_id, status')
      .eq('teacher_id', teacherId)
      .in('student_id', studentIds)
      .in('status', ['assigned', 'in_progress', 'resolved'])

    for (const r of rows || []) {
      const sid = (r as { student_id?: string }).student_id
      const status = (r as { status?: string }).status as RemediationStatus | undefined
      if (!sid || !status || !(status in rank)) continue
      const current = out.get(sid)
      if (!current || rank[status] > rank[current]) out.set(sid, status)
    }
  } catch {
    // Table absent on this env — fail soft; alerts render with 'none'.
  }

  return out
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
      .from('classroom_poll_responses')
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
// in a class assigned to them via class_teachers, or (b) the student's
// grade is in the teacher's grades_taught AND the student is in the
// teacher's own school (tenant-scoped — TSB-1). We resolve the student set
// once and reuse it. Both lookups run on the service-role client (RLS
// bypassed) after the JWT binding step, so tenant scope MUST be enforced in
// app code here.
//
// TODO(TSB-3 convergence): this resolver is the Edge-runtime twin of
// `canAccessStudent` (src/lib/rbac.ts) whose teacher branch is strictly
// class-roster-only (NO grade fallback). The two boundaries currently differ
// only by Path B (the school-scoped grade fallback), which is an INTENDED
// product behavior for newly-onboarded teachers with grades_taught but no
// class yet. Fully converging onto class-roster-only would remove that
// fallback (a product-behavior change requiring product sign-off), and the
// Next.js `src/lib` helper cannot be imported into this Deno function (runtime
// split). Until a shared authz module bridges the two runtimes, keep Path A
// roster semantics byte-for-byte aligned with `canAccessStudent` (assigned
// students only, fail-closed) and keep Path B tenant-scoped as below.
async function resolveStudentsForTeacher(
  supabase: ReturnType<typeof getServiceClient>,
  teacherId: string,
): Promise<Array<{ id: string; name: string; grade: string }>> {
  const seen = new Set<string>()
  const out: Array<{ id: string; name: string; grade: string }> = []

  // Path A: students attached to this teacher's classes. Roster lives in
  // the class_students join table (there is no students.class_id column):
  // resolve the student ids for the teacher's classes, then load the live
  // student rows by id.
  try {
    const { data: assignments } = await supabase
      .from('class_teachers')
      .select('class_id')
      .eq('teacher_id', teacherId)
    const classIds = (assignments || []).map((a: any) => a.class_id).filter(Boolean)
    if (classIds.length > 0) {
      const { data: roster } = await supabase
        .from('class_students')
        .select('student_id')
        .in('class_id', classIds)
      const rosterIds = (roster || [])
        .map((r: any) => r.student_id as string | null)
        .filter((id): id is string => !!id)
      if (rosterIds.length > 0) {
        const { data: classStudents } = await supabase
          .from('students')
          .select('id, name, grade')
          .in('id', rosterIds)
          .is('deleted_at', null)
          .limit(1000)
        for (const s of classStudents || []) {
          if (s?.id && !seen.has(s.id)) {
            seen.add(s.id)
            out.push({ id: s.id, name: s.name || 'Student', grade: String(s.grade || '') })
          }
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
        .select('grades_taught, school_id')
        .eq('id', teacherId)
        .maybeSingle()
      const schoolId = (teacher as { school_id?: string | null } | null)?.school_id
      const grades = Array.isArray(teacher?.grades_taught)
        ? teacher!.grades_taught.map(String)
        : teacher?.grades_taught != null
        ? [String(teacher.grades_taught)]
        : []
      // TSB-1 (P8/P13): scope the grade fallback to the teacher's OWN school.
      // Fail-closed when the teacher has no school_id — an independent/B2C
      // teacher gets an EMPTY set here rather than every grade-6–12 student
      // across all schools. `idx_students_school_grade` covers (school_id, grade).
      if (schoolId && grades.length > 0) {
        const { data: gradeStudents } = await supabase
          .from('students')
          .select('id, name, grade')
          .in('grade', grades)
          .eq('school_id', schoolId)
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

// ─── Shared BKT mastery primitive (T8) ──────────────────────────────────
// Reports (get_class_overview, get_student_report) used to compute
// "mastery" as an accuracy proxy off student_learning_profiles
// (correct/asked), commented as a stand-in for lacking a true BKT roll-up
// at this aggregation layer. That roll-up now exists as a shared Postgres
// RPC (migration 20260721000200_shared_cohort_bkt_mastery_rpc.sql) — the
// SAME formula the School-Admin Command Center's get_school_overview and
// the super-admin B2B analytics route use. Calling it here means all three
// surfaces trace back to one formula for "this cohort's mastery."
//
// The RPC trusts the caller to have already resolved an authorized
// student_id set (exactly like the direct concept_mastery reads elsewhere
// in this file) — EXECUTE is granted to `service_role` only, which is what
// this Edge Function's SERVICE_CLIENT authenticates as.
async function fetchCohortBktMastery(
  supabase: ReturnType<typeof getServiceClient>,
  studentIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (studentIds.length === 0) return out
  try {
    const { data, error } = await supabase.rpc('get_cohort_bkt_mastery_by_student', {
      p_student_ids: studentIds,
    })
    if (error || !Array.isArray(data)) return out
    return shapeCohortBktMasteryMap(data)
  } catch { /* RPC absent on this env — callers fall back to the accuracy proxy */ }
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

  // T8: real BKT mastery per student, via the shared cohort-mastery RPC —
  // the SAME formula the School-Admin Command Center and super-admin B2B
  // analytics use. Students with no concept_mastery rows are absent from
  // this map; for them we fall back to the accuracy proxy below so a
  // sparse-BKT env still gets a reasonable per-student number.
  const bktMasteryByStudent = await fetchCohortBktMastery(supabase, studentIds)

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
    // T8: prefer the real BKT mastery (shared calculate_cohort_bkt_mastery
    // formula) when the student has concept_mastery data; fall back to the
    // accuracy proxy only when no BKT signal exists yet for that student.
    const mastery = resolveStudentMastery(bktMasteryByStudent.get(id), accuracy)
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

  // T8: single-number BKT mastery for this student, via the shared
  // calculate_cohort_bkt_mastery formula (same one the School-Admin Command
  // Center and super-admin B2B analytics use). `null` when the student has
  // no concept_mastery rows yet — the UI should render "not enough data"
  // rather than a fake 0%, and MUST NOT recompute this from `accuracy`.
  const bktMasteryMap = await fetchCohortBktMastery(supabase, [studentId])
  const bktMastery = bktMasteryMap.get(studentId) ?? null

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
    // T8: real BKT mastery (shared formula), separate from the per-subject
    // accuracy breakdown above — the two are different metrics and must not
    // be conflated. `null` means no BKT signal yet, not 0%.
    mastery: bktMastery,
    bkt_mastery: bktMastery,
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
// NOTE (T8): the `avg_mastery` values this handler produces below are a
// DAILY QUIZ-SCORE-PERCENT rollup over time (a trend line), not a point-in-
// time BKT cohort snapshot — they answer "how did scores move day over
// day," a genuinely different question from "what is this cohort's mastery
// right now" (answered by calculate_cohort_bkt_mastery, used in
// get_class_overview / get_student_report / get_school_overview / the
// super-admin B2B route). Deliberately NOT unified with the shared BKT
// primitive — forcing a timeseries onto a single-snapshot formula would
// lose the trend signal this tab exists to show.
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
// belongs to a class owned by `teacher_id`, either directly (assignment
// row's teacher_id) or via co-teaching through `class_teachers`.

/** Verify the assignment row belongs to a class the teacher owns. */
async function teacherOwnsAssignment(
  supabase: ReturnType<typeof getServiceClient>,
  teacherId: string,
  assignmentId: string,
): Promise<{ owns: boolean; assignment: Record<string, unknown> | null }> {
  if (!assignmentId) return { owns: false, assignment: null }
  // Column-name note (production incident, 2026-07-21): `assignments` has no
  // `type` column — it has `assignment_type`, aliased to `type` here so the
  // returned shape (surfaced verbatim as the `assignment` field of
  // get_assignment_submissions) matches the frontend AssignmentRow contract.
  // `chapter`/`difficulty` are real columns as of migration
  // 20260721000300_assignments_add_chapter_difficulty.sql. This SELECT
  // previously named a non-existent `type` column, which supabase-js does not
  // throw on — it returns `data: null` — so every call silently fell through
  // to `{ owns: false, assignment: null }`, 403'ing legitimate owners.
  const { data: a } = await supabase
    .from('assignments')
    .select('id, class_id, teacher_id, title, subject, grade, chapter, difficulty, question_count, due_date, type:assignment_type, created_at')
    .eq('id', assignmentId)
    .maybeSingle()
  if (!a) return { owns: false, assignment: null }

  // Direct ownership: teacher_id matches on the assignment row.
  if ((a as { teacher_id?: string }).teacher_id === teacherId) {
    return { owns: true, assignment: a as Record<string, unknown> }
  }

  // Indirect ownership: the class is co-taught (class_teachers) — surface
  // the same data to all co-teachers.
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

// ─── Phase 3A Wave B — cross-assignment grading queue ───────────────────
//
// The Command Center needs a single "N submissions awaiting grading" surface
// that spans ALL of the caller-teacher's assignments, not just one. This is a
// READ that mirrors get_assignment_submissions' roster/ownership scoping but
// aggregates across assignments and filters to the awaiting-grading state.
//
// "Awaiting grading" = the submission has been turned in (status submitted /
// completed, or submitted_at is set) but NOT yet graded/reviewed. We reuse the
// SAME uiStatusForSubmission() derivation as the per-assignment list so the two
// surfaces never disagree about what "graded" means.

/**
 * needs_review_reason — additive, lightweight exception-review signal.
 *
 * Pure derived metadata only — NO scoring/XP math, NO write. We surface a flag
 * when a submission looks anomalous enough to merit teacher attention, reusing
 * signals already present on the row:
 *
 *   - 'all_same_answer'  — every answered question carries the same option
 *                          index (the P3 anti-cheat "no all-same if >3 Qs"
 *                          rule). Only meaningful with >3 answered questions.
 *   - 'too_fast'         — average time per question is below the P3 anti-cheat
 *                          floor of 3 s/question (rushed / likely not engaged).
 *
 * `responses` is the canonical jsonb answer array; entries may carry the chosen
 * option under any of a few historical keys, so we normalise defensively. When
 * neither the answer array nor a usable time figure is present we return null
 * rather than fabricate a flag (per the brief: don't invent signals).
 *
 * Precedence when multiple fire: all_same_answer (the stronger integrity
 * signal) before too_fast.
 */
const ANTI_CHEAT_MIN_AVG_SECONDS_PER_Q = 3 // P3: minimum 3s avg per question

function deriveNeedsReviewReason(args: {
  responses: unknown
  questionsTotal: number
  timeSpentSeconds: number
}): 'all_same_answer' | 'too_fast' | null {
  const answeredOptionIndexes: number[] = []
  if (Array.isArray(args.responses)) {
    for (const r of args.responses as Array<Record<string, unknown>>) {
      // Normalise the chosen option across historical key names. We only use
      // this to detect the all-same pattern — never to (re)score anything.
      const raw =
        r?.selected_index ??
        r?.student_answer ??
        r?.answer ??
        r?.response ??
        null
      if (raw == null) continue
      const idx = typeof raw === 'number' ? raw : Number(raw)
      if (Number.isFinite(idx)) answeredOptionIndexes.push(idx)
    }
  }

  // all_same_answer: P3 only flags this when there are MORE than 3 questions,
  // so a legitimately-uniform 3-question quiz isn't penalised.
  if (
    answeredOptionIndexes.length > 3 &&
    answeredOptionIndexes.every((v) => v === answeredOptionIndexes[0])
  ) {
    return 'all_same_answer'
  }

  // too_fast: average seconds/question below the P3 floor. Needs both a
  // positive question count and a positive recorded time to be meaningful.
  const qCount = Number(args.questionsTotal) || answeredOptionIndexes.length
  const timeSpent = Number(args.timeSpentSeconds) || 0
  if (qCount > 0 && timeSpent > 0) {
    const avgPerQ = timeSpent / qCount
    if (avgPerQ < ANTI_CHEAT_MIN_AVG_SECONDS_PER_Q) return 'too_fast'
  }

  return null
}

interface GradingQueueItem {
  submission_id: string
  assignment_id: string
  assignment_title: string
  student_id: string
  student_name: string
  submitted_at: string | null
  question_count: number
  auto_score: number | null
  needs_review_reason: 'all_same_answer' | 'too_fast' | null
}

/**
 * Build the flat, oldest-first grading queue from a teacher's assignments and
 * their submissions. Pure shaping — extracted so it can be unit-tested without
 * the Supabase client. Only submissions whose derived UI status is 'submitted'
 * (turned in, not yet graded) are emitted.
 */
function buildGradingQueue(
  assignments: Array<{ id: string; title: string }>,
  submissions: Array<{
    id: string
    assignment_id: string
    student_id: string
    score: number | null
    questions_total: number | null
    questions_correct: number | null
    time_spent_seconds: number | null
    status: string | null
    submitted_at: string | null
    graded_at: string | null
    responses: unknown
  }>,
  studentNameById: Map<string, string>,
): GradingQueueItem[] {
  const titleById = new Map(assignments.map((a) => [a.id, a.title]))
  const out: GradingQueueItem[] = []

  for (const s of submissions) {
    const uiStatus = uiStatusForSubmission(s.status, s.submitted_at, s.graded_at)
    if (uiStatus !== 'submitted') continue // graded/pending excluded from the queue

    const total = Number(s.questions_total ?? 0)
    const correct = Number(s.questions_correct ?? 0)
    // auto_score: prefer the canonical percent; else derive from the ratio.
    const autoScore =
      s.score != null
        ? Number(s.score)
        : total > 0
          ? Math.round((correct / total) * 100)
          : null

    out.push({
      submission_id: String(s.id),
      assignment_id: String(s.assignment_id),
      assignment_title: titleById.get(String(s.assignment_id)) || 'Assignment',
      student_id: String(s.student_id),
      student_name: studentNameById.get(String(s.student_id)) || 'Student',
      submitted_at: s.submitted_at ?? null,
      question_count: total,
      auto_score: autoScore,
      needs_review_reason: deriveNeedsReviewReason({
        responses: s.responses,
        questionsTotal: total,
        timeSpentSeconds: Number(s.time_spent_seconds ?? 0),
      }),
    })
  }

  // Oldest-first by submitted_at; null submitted_at sorts last (shouldn't
  // happen for a 'submitted' row, but stay defensive).
  out.sort((a, b) => {
    if (a.submitted_at === b.submitted_at) return 0
    if (a.submitted_at == null) return 1
    if (b.submitted_at == null) return -1
    return a.submitted_at < b.submitted_at ? -1 : 1
  })

  return out
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

  // Roster: students in the assignment's class. Roster lives in the
  // class_students join table (there is no students.class_id column),
  // resolve student ids there then load the live student rows by id.
  const classId = String((assignment as { class_id?: string } | null)?.class_id || '')
  const students: Array<{ id: string; name: string; grade: string }> = []
  const seen = new Set<string>()

  if (classId) {
    try {
      // class_students join table (used by /api/teacher/classes wiring).
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

// ─── get_grading_queue ──────────────────────────────────────
// Cross-assignment queue of submissions awaiting grading, across ALL of the
// caller-teacher's assignments (+ optional class_id filter). Roster/ownership
// scoping is identical to get_assignment_submissions: a teacher sees only
// submissions on assignments they own (directly or as a co-teacher), for
// students on the relevant class roster.
async function handleGetGradingQueue(
  body: Record<string, unknown>,
  origin: string | null,
): Promise<Response> {
  const teacherId = String(body.teacher_id || '')
  const classFilter = body.class_id ? String(body.class_id) : null
  if (!teacherId) return errorResponse('teacher_id required', 400, origin)

  const supabase = getServiceClient()

  // 1. Resolve the teacher's owned assignments. Direct ownership only here —
  //    a co-taught assignment surfaces via teacher_id on the row in the
  //    common case; the per-assignment handler additionally honours the
  //    co-teacher link tables, but the queue's primary scope is the teacher's
  //    own assignments. We fetch by teacher_id and optionally narrow by class.
  let assignmentQuery = supabase
    .from('assignments')
    .select('id, title, class_id')
    .eq('teacher_id', teacherId)
  if (classFilter) assignmentQuery = assignmentQuery.eq('class_id', classFilter)

  let assignments: Array<{ id: string; title: string; class_id: string | null }> = []
  try {
    const { data } = await assignmentQuery.limit(1000)
    assignments = (data || []).map((a: any) => ({
      id: String(a.id),
      title: String(a.title ?? 'Assignment'),
      class_id: a.class_id != null ? String(a.class_id) : null,
    }))
  } catch { /* assignments table absent on this env — empty queue */ }

  if (assignments.length === 0) {
    return jsonResponse({ count: 0, items: [] }, 200, {}, origin)
  }

  const assignmentIds = assignments.map((a) => a.id)

  // 2. Fetch submissions across these assignments. Filter awaiting-grading in
  //    SQL where we can (status + ungraded), then re-derive precisely in JS via
  //    uiStatusForSubmission so the queue and the per-assignment list agree.
  type RawSub = {
    id: string
    assignment_id: string
    student_id: string
    score: number | null
    questions_total: number | null
    questions_correct: number | null
    time_spent_seconds: number | null
    status: string | null
    submitted_at: string | null
    graded_at: string | null
    responses: unknown
  }
  let rawSubs: RawSub[] = []
  try {
    const { data } = await supabase
      .from('assignment_submissions')
      .select('id, assignment_id, student_id, score, questions_total, questions_correct, time_spent_seconds, status, submitted_at, graded_at, responses')
      .in('assignment_id', assignmentIds)
      .is('graded_at', null)
      .in('status', ['submitted', 'completed'])
      .limit(5000)
    rawSubs = (data || []) as RawSub[]
  } catch { /* table absent — empty queue */ }

  if (rawSubs.length === 0) {
    return jsonResponse({ count: 0, items: [] }, 200, {}, origin)
  }

  // 3. Resolve student names for the submissions in the queue (P5: grade is a
  //    string elsewhere; here we only need the display name). Batch by id.
  const studentIds = Array.from(new Set(rawSubs.map((s) => String(s.student_id))))
  const studentNameById = new Map<string, string>()
  try {
    const { data: studs } = await supabase
      .from('students')
      .select('id, name')
      .in('id', studentIds)
    for (const s of studs || []) {
      studentNameById.set(String(s.id), (s as { name?: string }).name || 'Student')
    }
  } catch { /* fall back to default name below */ }

  const items = buildGradingQueue(
    assignments.map((a) => ({ id: a.id, title: a.title })),
    rawSubs,
    studentNameById,
  )

  return jsonResponse({ count: items.length, items }, 200, {}, origin)
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
    .select('id, assignment_id, student_id, score, questions_total, questions_correct, time_spent_seconds, attempt_number, status, started_at, submitted_at, graded_at, graded_by, responses, teacher_feedback, teacher_feedback_hi, xp_earned')
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
      teacher_feedback_hi: sub.teacher_feedback_hi,
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
  const feedbackHiRaw = body.feedback_hi
  const scoreOverrideRaw = body.score_override

  if (!teacherId) return errorResponse('teacher_id required', 400, origin)
  if (!submissionId) return errorResponse('submission_id required', 400, origin)

  const feedback = typeof feedbackRaw === 'string' && feedbackRaw.trim().length > 0
    ? feedbackRaw.trim().slice(0, 2000)
    : null
  // P7 bilingual variant — mirrors `feedback` exactly (trim, 2000-char cap,
  // null when blank). Persisted to the additive teacher_feedback_hi column;
  // never overwrites the English teacher_feedback column.
  const feedbackHi = typeof feedbackHiRaw === 'string' && feedbackHiRaw.trim().length > 0
    ? feedbackHiRaw.trim().slice(0, 2000)
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
  if (feedbackHi !== null) patch.teacher_feedback_hi = feedbackHi
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

/**
 * Resolve students for a class. Synthetic grade-<n> pseudo-classes fall back
 * to a grade lookup; real classes roster through the class_students join
 * table (there is no students.class_id column on the live schema).
 *
 * `teacherId` is the JWT-bound caller. It is REQUIRED to tenant-scope the
 * grade pseudo-class fallback (TSB-1, P8/P13): the grade lookup only ever
 * returns students in the teacher's own school, and returns EMPTY when the
 * teacher has no school. Every caller already asserts ownership of `classId`
 * via assertTeacherOwnsClass before reaching here.
 */
async function resolveStudentsForClass(
  supabase: ReturnType<typeof getServiceClient>,
  classId: string,
  teacherId: string,
): Promise<Array<{ id: string; name: string; grade: string }>> {
  const seen = new Set<string>()
  const out: Array<{ id: string; name: string; grade: string }> = []

  // For synthetic grade-<n> pseudo-classes, fall back to the grade lookup —
  // scoped to the teacher's own school. Fail-closed (empty) for a school-less
  // teacher so the fallback never fans out across tenants.
  if (classId.startsWith('grade-')) {
    const grade = classId.replace('grade-', '')
    const schoolId = await resolveTeacherSchoolId(supabase, teacherId)
    if (!schoolId) return out
    try {
      const { data } = await supabase
        .from('students')
        .select('id, name, grade')
        .eq('grade', grade)
        .eq('school_id', schoolId)
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

  // Real class: roster lives in the class_students join table.
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

  const students = await resolveStudentsForClass(supabase, classId, teacherId)
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

  // Attendance column — query student_attendance for actual records.
  // For each student: attendance% = round(days_present / total_days * 100).
  // 'present' and 'late' both count as present for the % calculation.
  // Falls back to null/pending if student_attendance table is absent or empty.
  try {
    const termStartDate = bounds.start.slice(0, 10)
    const termEndDate = new Date().toISOString().slice(0, 10) // up to today
    const { data: attRows } = await supabase
      .from('student_attendance')
      .select('student_id, status')
      .eq('class_id', classId)
      .in('student_id', studentIds)
      .gte('date', termStartDate)
      .lte('date', termEndDate)
      .limit(50000)

    const attByStudent = new Map<string, { present: number; total: number }>()
    for (const row of ((attRows || []) as Array<{ student_id: string; status: string }>)) {
      const sid = String(row.student_id)
      if (!attByStudent.has(sid)) attByStudent.set(sid, { present: 0, total: 0 })
      const cur = attByStudent.get(sid)!
      cur.total++
      if (row.status === 'present' || row.status === 'late') cur.present++
    }

    for (const stu of students) {
      const att = attByStudent.get(stu.id)
      if (att && att.total > 0) {
        cells[stu.id]['attendance'] = {
          score: Math.round((att.present / att.total) * 100),
          max_score: 100,
          status: 'graded',
        }
      }
      // If no records found: fall through to the pending-placeholder block below.
    }
  } catch {
    // student_attendance absent on older envs or query failed — fall through
    // to the pending placeholder for graceful degradation.
  }

  // Merge first-class saved cells from `grade_book_entries` OVER the derived
  // matrix so a teacher's explicit save SURVIVES a reload (FIX 1 — the core of
  // the "save → reload → gone" bug). Saved cells are authoritative: they carry
  // the teacher-entered raw score + the column's own max_score, and they cover
  // every column kind (subject / attendance / unit), not just score_history
  // subjects. Any saved column_key not already in `columns` is appended so the
  // matrix stays rectangular and the saved cell is actually rendered.
  // Migration: 20260620001000_grade_book_entries.sql (apply + redeploy on merge).
  try {
    const { data: savedRows } = await supabase
      .from('grade_book_entries')
      .select('student_id, column_key, score, max_score')
      .eq('class_id', classId)
      .in('student_id', studentIds)
      .limit(20000)
    for (const r of (savedRows || []) as Array<{
      student_id: string
      column_key: string
      score: number | null
      max_score: number | null
    }>) {
      const sid = String(r.student_id)
      const key = String(r.column_key || '').toLowerCase()
      if (!key || !cells[sid]) continue
      // Ensure the saved column is part of the declared column set.
      if (!columns.some(c => c.key === key)) {
        const kind: 'subject' | 'unit' | 'attendance' =
          key === 'attendance' ? 'attendance' : key.startsWith('unit:') ? 'unit' : 'subject'
        const label = kind === 'attendance'
          ? 'Attendance'
          : key.charAt(0).toUpperCase() + key.slice(1)
        // Insert subject/unit columns before the trailing attendance column to
        // preserve the existing column ordering convention.
        if (kind === 'attendance') {
          columns.push({ key, label, kind })
        } else {
          const attIdx = columns.findIndex(c => c.kind === 'attendance')
          if (attIdx >= 0) columns.splice(attIdx, 0, { key, label, kind })
          else columns.push({ key, label, kind })
        }
      }
      cells[sid][key] = {
        score: r.score != null ? Number(r.score) : null,
        max_score: r.max_score != null ? Number(r.max_score) : 100,
        status: r.score != null ? 'graded' : 'pending',
      }
    }
  } catch { /* grade_book_entries absent on this env — fall back to derived matrix */ }

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
  // we check the student's grade matches; otherwise membership lives in
  // the class_students join table (there is no students.class_id column).
  let studentInClass = false
  if (classId.startsWith('grade-')) {
    const grade = classId.replace('grade-', '')
    // TSB-1 (P8/P13): a grade pseudo-class membership match must be tenant
    // scoped — the student must share BOTH the grade AND the teacher's school.
    // Without the school predicate a teacher could write a grade-book cell for
    // a same-grade student at ANOTHER school. Fail-closed for school-less.
    const schoolId = await resolveTeacherSchoolId(supabase, teacherId)
    if (schoolId) {
      try {
        const { data: s } = await supabase
          .from('students')
          .select('grade')
          .eq('id', studentId)
          .eq('school_id', schoolId)
          .maybeSingle()
        studentInClass = !!s && String((s as { grade?: string }).grade) === grade
      } catch { studentInClass = false }
    }
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

  // STEP 2: canonical write — `grade_book_entries` is the first-class store for
  // the gradebook cell (keyed UNIQUE(class_id, student_id, column_key)). This is
  // what makes a saved cell SURVIVE a reload: get_grade_book merges these rows
  // over the derived matrix. Persisted for EVERY column kind (subject /
  // attendance / unit) so non-subject cells no longer vanish on refresh.
  // Migration: 20260620001000_grade_book_entries.sql (apply + redeploy on merge).
  let gradeBookPersisted = false
  try {
    const { error: gbErr } = await supabase
      .from('grade_book_entries')
      .upsert(
        {
          class_id: classId,
          student_id: studentId,
          column_key: columnKeyRaw,
          score,
          max_score: maxScore,
          teacher_id: teacherId,
          updated_at: now,
        },
        { onConflict: 'class_id,student_id,column_key' },
      )
    if (gbErr) {
      return errorResponse(`Failed to record grade: ${gbErr.message}`, 500, origin)
    }
    gradeBookPersisted = true
  } catch (e) {
    return errorResponse(
      `Failed to record grade: ${e instanceof Error ? e.message : String(e)}`,
      500,
      origin,
    )
  }

  // STEP 3: legacy derived write. For SUBJECT columns we additionally keep the
  // pre-existing `score_history` derived row so the analytics/reports surfaces
  // that read score_history stay populated (unchanged behaviour). Attendance
  // and unit columns have no score_history representation and rely solely on
  // the grade_book_entries store above.
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
    grade_book_persisted: gradeBookPersisted,
  }, 200, {}, origin)
}

// ─── mark_attendance ────────────────────────────────────────
// Bulk-upserts attendance records for a class on a given date.
// Body: { teacher_id, class_id, date (YYYY-MM-DD), records: Array<{student_id, status, period?, notes?}> }
// Returns: { upserted: number, errors: string[] }
async function handleMarkAttendance(
  body: Record<string, unknown>,
  origin: string | null,
): Promise<Response> {
  const teacherId = String(body.teacher_id || '')
  const classId   = String(body.class_id   || '')
  const dateRaw   = String(body.date        || '')
  const records   = Array.isArray(body.records) ? body.records : []

  if (!teacherId) return errorResponse('teacher_id required', 400, origin)
  if (!classId)   return errorResponse('class_id required', 400, origin)
  if (!dateRaw || !/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
    return errorResponse('date must be YYYY-MM-DD', 400, origin)
  }
  if (records.length === 0) return errorResponse('records array must be non-empty', 400, origin)
  if (records.length > 200) return errorResponse('records exceeds max batch size of 200', 400, origin)

  const VALID_STATUSES = new Set(['present', 'absent', 'late', 'excused'])
  const supabase = getServiceClient()

  // P13: teacher must own this class
  if (!(await assertTeacherOwnsClass(supabase, teacherId, classId))) {
    return errorResponse('Class not owned by caller', 403, origin)
  }

  // Synthetic grade-<n> class IDs are not real rows in `classes` and cannot
  // satisfy the student_attendance FK constraint on class_id. Attendance marking
  // requires a real class UUID. Teachers with only synthetic grade-level classes
  // should create a formal class record first.
  if (classId.startsWith('grade-')) {
    return errorResponse(
      'mark_attendance requires a real class ID. Synthetic grade-level classes are not supported for attendance.',
      400,
      origin,
    )
  }

  const errors: string[] = []
  const rows: Array<{
    class_id: string
    student_id: string
    date: string
    status: string
    marked_by: string
    period: string
    notes: string | null
  }> = []

  for (const rec of records as Array<Record<string, unknown>>) {
    const studentId = String(rec.student_id || '')
    const status    = String(rec.status     || '').toLowerCase()
    const period    = typeof rec.period === 'string' && rec.period.trim()
      ? rec.period.trim().slice(0, 50)
      : 'All Day'
    const notes = typeof rec.notes === 'string' && rec.notes.trim()
      ? rec.notes.trim().slice(0, 200)
      : null

    if (!studentId) { errors.push('record missing student_id'); continue }
    if (!VALID_STATUSES.has(status)) {
      errors.push(`student ${studentId}: invalid status "${status}"`)
      continue
    }
    rows.push({ class_id: classId, student_id: studentId, date: dateRaw, status, marked_by: teacherId, period, notes })
  }

  if (rows.length === 0) {
    return errorResponse(`No valid records: ${errors.join('; ')}`, 400, origin)
  }

  const { error: upsertErr } = await supabase
    .from('student_attendance')
    .upsert(rows, { onConflict: 'class_id,student_id,date,period' })

  if (upsertErr) {
    return errorResponse(`Attendance write failed: ${upsertErr.message}`, 500, origin)
  }

  return jsonResponse({ upserted: rows.length, errors }, 200, {}, origin)
}

// ─── get_attendance_record ──────────────────────────────────
// Returns all attendance rows for a class on a specific date.
// Body: { teacher_id, class_id, date (YYYY-MM-DD), period? }
async function handleGetAttendanceRecord(
  body: Record<string, unknown>,
  origin: string | null,
): Promise<Response> {
  const teacherId = String(body.teacher_id || '')
  const classId   = String(body.class_id   || '')
  const dateRaw   = String(body.date        || '')
  const period    = typeof body.period === 'string' && body.period.trim()
    ? body.period.trim().slice(0, 50)
    : null

  if (!teacherId) return errorResponse('teacher_id required', 400, origin)
  if (!classId)   return errorResponse('class_id required', 400, origin)
  if (!dateRaw || !/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
    return errorResponse('date must be YYYY-MM-DD', 400, origin)
  }

  const supabase = getServiceClient()

  if (!(await assertTeacherOwnsClass(supabase, teacherId, classId))) {
    return errorResponse('Class not owned by caller', 403, origin)
  }

  // Fetch class roster — all enrolled students for the class
  type RosterStudent = { id: string; name: string }
  let students: RosterStudent[] = []
  try {
    if (!classId.startsWith('grade-')) {
      // Real class ID: query class_students join → students
      const { data: rosterRows } = await supabase
        .from('class_students')
        .select('students(id, name)')
        .eq('class_id', classId)
        .eq('is_active', true)
        .limit(300)
      students = ((rosterRows || []) as Array<{ students: RosterStudent | null }>)
        .map(r => r.students)
        .filter((s): s is RosterStudent => s !== null && !!s.id)
    } else {
      // Synthetic grade-<n> class: query students by grade, tenant-scoped to
      // the teacher's own school (TSB-1, P8/P13). Fail-closed (empty) for a
      // school-less teacher.
      const grade = classId.replace('grade-', '')
      const schoolId = await resolveTeacherSchoolId(supabase, teacherId)
      if (schoolId) {
        const { data: gradeRows } = await supabase
          .from('students')
          .select('id, name')
          .eq('grade', grade)
          .eq('school_id', schoolId)
          .limit(300)
        students = ((gradeRows || []) as RosterStudent[]).filter(s => !!s.id)
      }
    }
  } catch { /* table absent — return empty roster */ }

  let query = supabase
    .from('student_attendance')
    .select('id, student_id, date, status, period, notes, marked_by, created_at, updated_at')
    .eq('class_id', classId)
    .eq('date', dateRaw)

  if (period) query = query.eq('period', period)

  const { data, error } = await query.limit(500)
  if (error) return errorResponse(`Query failed: ${error.message}`, 500, origin)

  return jsonResponse({ date: dateRaw, class_id: classId, students, records: data || [] }, 200, {}, origin)
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

// ─── Phase 3A Wave C — Mastery + Bloom's report actions ─────────────────
//
// Wave C deepens the gradebook with two reporting dimensions the raw-score
// matrix lacks: MASTERY (the existing BKT signal, read verbatim) and BLOOM'S
// (the student's accuracy per CBSE Bloom's level, derived from the questions
// they actually answered). Two reads + a parent-ready export:
//
//   - get_student_mastery_report      — one roster student's mastery+Bloom deep dive
//   - get_class_mastery_bloom_summary — class-level rollup for the heatmap drill-through
//   - export_student_report           — the per-student report in a parent-readable shape
//
// REUSE, don't rebuild:
//   * Mastery reuses the get_heatmap BKT path verbatim — concept_mastery
//     (p_know / attempts / mastery_level) keyed by (student_id, topic_id). The
//     p_know value is the existing BKT probability; we surface it as a percent
//     for display only. NO new mastery math.
//   * Bloom's is sourced from quiz_responses.bloom_level — the bloom_level is
//     denormalised onto each answered-question row alongside is_correct and
//     student_id, so a per-level correct/total rollup needs no join to
//     question_bank. (The marking-audit view + get_submission_detail read the
//     same canonical table.) accuracy_pct = round(correct/total*100) is a
//     DISPLAY figure only — it is NOT a score and never feeds XP (P1/P2
//     untouched).
//   * Roster scoping reuses resolveStudentsForTeacher (P13): a student must be
//     on the caller-teacher's roster or the report is refused.
//
// CBSE Bloom's levels are technical terms (P7) — never translated.

/** Canonical CBSE Bloom's taxonomy order (low → high cognitive demand). */
const BLOOM_LEVELS = [
  'remember',
  'understand',
  'apply',
  'analyze',
  'evaluate',
  'create',
] as const
type BloomLevel = (typeof BLOOM_LEVELS)[number]

interface BloomLevelRow {
  bloom_level: string
  correct: number
  total: number
  accuracy_pct: number
}

interface BloomDistribution {
  by_level: BloomLevelRow[]
  weakest_level: string | null
}

/**
 * Aggregate a student's answered questions into a per-Bloom-level correct/total
 * rollup. Pure shaping — no scoring/XP math. `accuracy_pct` is a display figure
 * (round(correct/total*100)); `weakest_level` is the answered level with the
 * lowest accuracy (ties broken by canonical Bloom order, i.e. the lower-order
 * level wins). Levels the student never answered are omitted from `by_level`
 * and ignored for `weakest_level` — we never fabricate a 0% for an unattempted
 * level. Unknown/legacy bloom_level strings are normalised to lowercase and
 * passed through (so non-canonical labels still aggregate) but only canonical
 * levels participate in the tie-break ordering.
 */
function aggregateBloomDistribution(
  responses: Array<{ bloom_level: string | null; is_correct: boolean | null }>,
): BloomDistribution {
  const tally = new Map<string, { correct: number; total: number }>()
  for (const r of responses) {
    const level = typeof r.bloom_level === 'string' ? r.bloom_level.trim().toLowerCase() : ''
    if (!level) continue // skip rows with no recorded Bloom level
    const bucket = tally.get(level) ?? { correct: 0, total: 0 }
    bucket.total += 1
    if (r.is_correct === true) bucket.correct += 1
    tally.set(level, bucket)
  }

  // Emit by_level in canonical Bloom order first, then any non-canonical
  // levels alphabetically, so the UI renders a stable, pedagogically-ordered list.
  const canonicalOrder = (lvl: string): number => {
    const idx = (BLOOM_LEVELS as readonly string[]).indexOf(lvl)
    return idx === -1 ? Number.MAX_SAFE_INTEGER : idx
  }
  const levels = [...tally.keys()].sort((a, b) => {
    const ca = canonicalOrder(a)
    const cb = canonicalOrder(b)
    if (ca !== cb) return ca - cb
    return a.localeCompare(b)
  })

  const by_level: BloomLevelRow[] = levels.map((level) => {
    const { correct, total } = tally.get(level)!
    return {
      bloom_level: level,
      correct,
      total,
      accuracy_pct: total > 0 ? Math.round((correct / total) * 100) : 0,
    }
  })

  // weakest_level: lowest accuracy among answered levels; ties go to the
  // lower canonical Bloom order (already the sort order of by_level), so a
  // simple stable min-scan picks the earlier-ordered level on a tie.
  let weakest: string | null = null
  let weakestPct = Number.POSITIVE_INFINITY
  for (const row of by_level) {
    if (row.accuracy_pct < weakestPct) {
      weakestPct = row.accuracy_pct
      weakest = row.bloom_level
    }
  }

  return { by_level, weakest_level: weakest }
}

interface ConceptMasteryRow {
  topic_id: string
  concept: string
  mastery_pct: number
  attempts: number
}

interface MasterySummary {
  by_concept: ConceptMasteryRow[]
  overall_pct: number
}

/**
 * Shape the BKT mastery read (one row per concept the student has a
 * concept_mastery row for) into the report's mastery block. `mastery_pct` is
 * the existing BKT p_know surfaced as a percent (round(p_know*100)) — read
 * VERBATIM, no re-derivation. `overall_pct` is the simple mean of the
 * per-concept mastery percents (display rollup only). Concepts with no BKT row
 * are omitted upstream (we only pass rows that exist).
 */
function shapeMasterySummary(
  rows: Array<{ topic_id: string; concept: string; p_know: number; attempts: number }>,
): MasterySummary {
  const by_concept: ConceptMasteryRow[] = rows.map((r) => ({
    topic_id: r.topic_id,
    concept: r.concept,
    mastery_pct: Math.round((Number(r.p_know) || 0) * 100),
    attempts: Number(r.attempts) || 0,
  }))
  const overall_pct =
    by_concept.length > 0
      ? Math.round(by_concept.reduce((acc, c) => acc + c.mastery_pct, 0) / by_concept.length)
      : 0
  return { by_concept, overall_pct }
}

/**
 * Read a single student's BKT mastery rows joined to their concept titles.
 * Reuses the same concept_mastery shape get_heatmap reads (p_know, attempts,
 * mastery_level) — but here we list every concept the student has a row for
 * rather than intersecting with a fixed concept grid. Fails soft to [] when the
 * table is absent (older env), mirroring get_heatmap's defensive try/catch.
 */
async function readStudentConceptMastery(
  supabase: ReturnType<typeof getServiceClient>,
  studentId: string,
): Promise<Array<{ topic_id: string; concept: string; p_know: number; attempts: number }>> {
  const out: Array<{ topic_id: string; concept: string; p_know: number; attempts: number }> = []
  try {
    const { data: bktRows } = await supabase
      .from('concept_mastery')
      .select('topic_id, p_know, attempts')
      .eq('student_id', studentId)
      .limit(500)
    if (!bktRows || bktRows.length === 0) return out

    // Resolve concept titles for the topic ids in one batch.
    const topicIds = Array.from(
      new Set(bktRows.map((r) => String((r as { topic_id?: string }).topic_id)).filter(Boolean)),
    )
    const titleById = new Map<string, string>()
    if (topicIds.length > 0) {
      try {
        const { data: topics } = await supabase
          .from('curriculum_topics')
          .select('id, title')
          .in('id', topicIds)
        for (const t of topics || []) {
          titleById.set(String((t as { id: string }).id), String((t as { title?: string }).title || ''))
        }
      } catch { /* topics table absent — fall back to topic id as label */ }
    }

    for (const r of bktRows) {
      const topicId = String((r as { topic_id?: string }).topic_id || '')
      if (!topicId) continue
      out.push({
        topic_id: topicId,
        concept: titleById.get(topicId) || topicId,
        p_know: Number((r as { p_know?: number }).p_know) || 0,
        attempts: Number((r as { attempts?: number }).attempts) || 0,
      })
    }
  } catch { /* concept_mastery absent on this env — empty mastery block */ }
  return out
}

/**
 * Read a single student's answered-question Bloom rows from quiz_responses.
 * bloom_level + is_correct are denormalised onto the row, so this is a single
 * table read with no join. Fails soft to [] when the table is absent.
 */
async function readStudentBloomResponses(
  supabase: ReturnType<typeof getServiceClient>,
  studentId: string,
): Promise<Array<{ bloom_level: string | null; is_correct: boolean | null }>> {
  try {
    const { data } = await supabase
      .from('quiz_responses')
      .select('bloom_level, is_correct')
      .eq('student_id', studentId)
      .not('bloom_level', 'is', null)
      .limit(5000)
    return (data || []) as Array<{ bloom_level: string | null; is_correct: boolean | null }>
  } catch {
    return []
  }
}

interface RecentActivity {
  quizzes: number
  avg_score: number
  streak: number
}

/**
 * Lightweight recent-activity rollup for the report header: number of completed
 * quizzes, their average score_percent (display only — read from the canonical
 * quiz_sessions, NOT recomputed), and the student's best streak from learning
 * profiles. All best-effort; degrades to zeros.
 */
async function readStudentRecentActivity(
  supabase: ReturnType<typeof getServiceClient>,
  studentId: string,
): Promise<RecentActivity> {
  let quizzes = 0
  let scoreSum = 0
  let scoreCount = 0
  try {
    const { data: sessions } = await supabase
      .from('quiz_sessions')
      .select('score_percent, completed_at')
      .eq('student_id', studentId)
      .not('completed_at', 'is', null)
      .limit(5000)
    for (const s of sessions || []) {
      quizzes += 1
      const sp = (s as { score_percent?: number | null }).score_percent
      if (sp != null) {
        scoreSum += Number(sp)
        scoreCount += 1
      }
    }
  } catch { /* quiz_sessions absent — zeros */ }

  let streak = 0
  try {
    const { data: profiles } = await supabase
      .from('student_learning_profiles')
      .select('streak_days')
      .eq('student_id', studentId)
    for (const p of profiles || []) {
      const s = Number((p as { streak_days?: number }).streak_days || 0)
      if (s > streak) streak = s
    }
  } catch { /* profiles absent — streak 0 */ }

  return {
    quizzes,
    avg_score: scoreCount > 0 ? Math.round(scoreSum / scoreCount) : 0,
    streak,
  }
}

// ─── get_student_mastery_report ─────────────────────────────
// Per-student mastery + Bloom's deep dive. Roster-scoped (P13): the student
// must be on the caller-teacher's resolved set or we 403. NO scoring/XP — the
// mastery block is the BKT value read verbatim; the Bloom block is correct/total
// accuracy over the questions the student actually answered.
async function handleGetStudentMasteryReport(
  body: Record<string, unknown>,
  origin: string | null,
): Promise<Response> {
  const studentId = String(body.student_id || '')
  const teacherId = String(body.teacher_id || '')
  if (!studentId) return errorResponse('student_id required', 400, origin)

  const supabase = getServiceClient()

  // P13: per-resource ownership — re-resolve the teacher's roster and confirm
  // the target student is on it. We never trust body.student_id alone.
  const owned = await resolveStudentsForTeacher(supabase, teacherId)
  const target = owned.find((s) => s.id === studentId)
  if (!target) {
    return errorResponse('Student not owned by caller', 403, origin)
  }

  const [masteryRows, bloomRows, recent] = await Promise.all([
    readStudentConceptMastery(supabase, studentId),
    readStudentBloomResponses(supabase, studentId),
    readStudentRecentActivity(supabase, studentId),
  ])

  const mastery = shapeMasterySummary(masteryRows)
  const bloom = aggregateBloomDistribution(bloomRows)

  return jsonResponse({
    student_id: studentId,
    student_name: target.name,
    grade: String(target.grade || ''), // P5: grade is a string
    mastery,
    bloom,
    recent,
  }, 200, {}, origin)
}

// ─── get_class_mastery_bloom_summary ────────────────────────
// Class-level rollup: average mastery per concept across the class + the
// class's Bloom's distribution (which levels the class is weakest at). For the
// Command Center heatmap drill-through + the class report. Reuses the same BKT
// + quiz_responses reads, aggregated across the class roster. Roster-scoped:
// the caller must own the class (assertTeacherOwnsClass).
async function handleGetClassMasteryBloomSummary(
  body: Record<string, unknown>,
  origin: string | null,
): Promise<Response> {
  const classId = String(body.class_id || '')
  const teacherId = String(body.teacher_id || '')
  if (!classId) return errorResponse('class_id required', 400, origin)

  const supabase = getServiceClient()

  // P13: caller must own the class they're rolling up.
  if (!(await assertTeacherOwnsClass(supabase, teacherId, classId))) {
    return errorResponse('Class not owned by caller', 403, origin)
  }

  const students = await resolveStudentsForClass(supabase, classId, teacherId)
  if (students.length === 0) {
    return jsonResponse({
      class_id: classId,
      student_count: 0,
      mastery: { by_concept: [], overall_pct: 0 },
      bloom: { by_level: [], weakest_level: null },
    }, 200, {}, origin)
  }
  const studentIds = students.map((s) => s.id)

  // ── Class mastery rollup: average p_know per concept across the class. ──
  // Single batched read of every roster student's BKT rows; we average per
  // topic. Same concept_mastery shape get_heatmap reads — values verbatim.
  const conceptAgg = new Map<string, { masterySum: number; attemptsSum: number; n: number }>()
  try {
    const { data: bktRows } = await supabase
      .from('concept_mastery')
      .select('topic_id, p_know, attempts')
      .in('student_id', studentIds)
      .limit(20000)
    for (const r of bktRows || []) {
      const topicId = String((r as { topic_id?: string }).topic_id || '')
      if (!topicId) continue
      const a = conceptAgg.get(topicId) ?? { masterySum: 0, attemptsSum: 0, n: 0 }
      a.masterySum += Math.round((Number((r as { p_know?: number }).p_know) || 0) * 100)
      a.attemptsSum += Number((r as { attempts?: number }).attempts) || 0
      a.n += 1
      conceptAgg.set(topicId, a)
    }
  } catch { /* concept_mastery absent — empty mastery rollup */ }

  // Resolve concept titles for the aggregated topic ids.
  const topicIds = [...conceptAgg.keys()]
  const titleById = new Map<string, string>()
  if (topicIds.length > 0) {
    try {
      const { data: topics } = await supabase
        .from('curriculum_topics')
        .select('id, title')
        .in('id', topicIds)
      for (const t of topics || []) {
        titleById.set(String((t as { id: string }).id), String((t as { title?: string }).title || ''))
      }
    } catch { /* topics absent — fall back to id as label */ }
  }

  const byConcept: Array<{ topic_id: string; concept: string; avg_mastery_pct: number; student_count: number }> = []
  for (const [topicId, a] of conceptAgg) {
    byConcept.push({
      topic_id: topicId,
      concept: titleById.get(topicId) || topicId,
      avg_mastery_pct: a.n > 0 ? Math.round(a.masterySum / a.n) : 0,
      student_count: a.n,
    })
  }
  // Weakest concepts first so the drill-through highlights where to intervene.
  byConcept.sort((x, y) => x.avg_mastery_pct - y.avg_mastery_pct)
  const overallMastery =
    byConcept.length > 0
      ? Math.round(byConcept.reduce((acc, c) => acc + c.avg_mastery_pct, 0) / byConcept.length)
      : 0

  // ── Class Bloom's distribution: pool every roster student's answered
  // questions and aggregate per Bloom level. Same denormalised
  // quiz_responses.bloom_level read — pooled across the class. ──
  let bloomRows: Array<{ bloom_level: string | null; is_correct: boolean | null }> = []
  try {
    const { data } = await supabase
      .from('quiz_responses')
      .select('bloom_level, is_correct')
      .in('student_id', studentIds)
      .not('bloom_level', 'is', null)
      .limit(50000)
    bloomRows = (data || []) as Array<{ bloom_level: string | null; is_correct: boolean | null }>
  } catch { /* quiz_responses absent — empty bloom rollup */ }
  const bloom = aggregateBloomDistribution(bloomRows)

  return jsonResponse({
    class_id: classId,
    student_count: students.length,
    mastery: { by_concept: byConcept, overall_pct: overallMastery },
    bloom,
  }, 200, {}, origin)
}

// ─── export_student_report ──────────────────────────────────
// Parent-ready export of the per-student mastery+Bloom report. Reuses the
// get_student_mastery_report pipeline (so the two surfaces never disagree),
// then serialises to a clean, parent-readable CSV using the SAME csvEscape
// helper as export_grade_book_csv. P13: only the teacher's own roster student's
// data — the inner handler's 403 gate is inherited. No other-student PII.
async function handleExportStudentReport(
  body: Record<string, unknown>,
  origin: string | null,
): Promise<Response> {
  const studentId = String(body.student_id || '')
  if (!studentId) return errorResponse('student_id required', 400, origin)

  // Re-use the report pipeline (and its roster 403 gate) to build the data.
  const inner = await handleGetStudentMasteryReport(body, origin)
  if (!inner.ok) return inner
  const report = (await inner.json()) as {
    student_id: string
    student_name: string
    grade: string
    mastery: MasterySummary
    bloom: BloomDistribution
    recent: RecentActivity
  }

  // Build a sectioned, parent-readable CSV. Section headers are bare rows so
  // the file opens cleanly in Excel/Sheets and reads top-to-bottom. CBSE
  // Bloom's level names are technical terms (P7) — left untranslated.
  const lines: string[] = []
  lines.push(['Student Report', report.student_name].map(csvEscape).join(','))
  lines.push(['Grade', report.grade].map(csvEscape).join(','))
  lines.push(['Overall Mastery (%)', report.mastery.overall_pct].map(csvEscape).join(','))
  lines.push(['Quizzes Completed', report.recent.quizzes].map(csvEscape).join(','))
  lines.push(['Average Score (%)', report.recent.avg_score].map(csvEscape).join(','))
  lines.push(['Best Streak (days)', report.recent.streak].map(csvEscape).join(','))
  lines.push('')

  lines.push(['Concept Mastery', '', ''].map(csvEscape).join(','))
  lines.push(['Concept', 'Mastery (%)', 'Attempts'].map(csvEscape).join(','))
  for (const c of report.mastery.by_concept) {
    lines.push([c.concept, c.mastery_pct, c.attempts].map(csvEscape).join(','))
  }
  lines.push('')

  lines.push(["Bloom's Level Performance", '', '', ''].map(csvEscape).join(','))
  lines.push(["Bloom's Level", 'Correct', 'Total', 'Accuracy (%)'].map(csvEscape).join(','))
  for (const b of report.bloom.by_level) {
    lines.push([b.bloom_level, b.correct, b.total, b.accuracy_pct].map(csvEscape).join(','))
  }
  if (report.bloom.weakest_level) {
    lines.push('')
    lines.push(['Weakest Bloom Level', report.bloom.weakest_level].map(csvEscape).join(','))
  }

  const datePart = new Date().toISOString().slice(0, 10)
  const safeName = (report.student_name || 'student').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40)
  const filename = `student_report_${safeName}_${datePart}.csv`

  return jsonResponse({
    filename,
    csv_content: lines.join('\n'),
    student_id: report.student_id,
    student_name: report.student_name,
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

  const students = await resolveStudentsForClass(supabase, classId, teacherId)
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
// RCA fix (2026-07-20, Task T3): this handler previously wrote directly to
// `assignments` / `assignment_submissions` with hardcoded question counts
// (5|10) and a hardcoded 3-day due date — a THIRD, orphaned remediation
// pathway that completely bypassed:
//   - `teacher_remediation_assignments` (the canonical table written by
//     POST /api/teacher/remediation and read by the student daily-queue
//     resolver — resolve-next-action.ts / today/render.ts — and by Loop A's
//     escalation logic in remediation-queue-adapter.ts / recovery-evaluation.ts)
//   - `adaptive_interventions` (the Loop A-D system)
// Remediation a teacher "deployed" here was therefore invisible to the
// student. Grep-confirmed (apps/host/src/app/teacher/**, mobile/**): there is
// NO frontend caller of action 'deploy_intervention' anywhere in the web app
// or the Flutter app — this action is only reachable via a direct
// authenticated POST to this Edge Function. It is NOT deleted outright
// because (a) the static contract canary (__tests__/contract.test.ts) pins
// actions.ts's teacherDashboardActionNames 1:1 against this switch's case
// list, so removing the action is a deliberate, separately-reviewable
// contract change, and (b) the safer fix for an exposed-but-unwired action is
// to make it write correctly rather than leave a dead write path that could
// silently reappear behind a future UI button. It now inserts one
// `teacher_remediation_assignments` row per (student, tier) — chapter_id =
// topic_id, matching the canonical shape — and respects the same DB dedupe
// backstop (uq_teacher_remediation_assignments_open_dedupe: 23505 on that
// index is idempotent-success, not a failure), mirroring
// apps/host/src/app/api/teacher/remediation/route.ts's pre-check + named-
// conflict pattern.
//
// Response shape note: `deployments.tierN` changed from
// `{ assignment_id, student_count }` (one shared `assignments` row per tier)
// to `{ assignment_ids, student_count }` (one canonical row per student) —
// there is no live caller for this to break.
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
    .select('id')
    .eq('id', topicId)
    .maybeSingle()

  if (topicErr || !topic) {
    return errorResponse('Curriculum topic not found', 404, origin)
  }

  const OPEN_DEDUPE_INDEX = 'uq_teacher_remediation_assignments_open_dedupe'
  const OPEN_STATUSES = ['assigned', 'in_progress']

  const results: Record<string, { assignment_ids: string[]; student_count: number }> = {}

  for (const tierKey of ['tier1', 'tier2', 'tier3'] as const) {
    const studentIds = tiers[tierKey]
    if (!Array.isArray(studentIds) || studentIds.length === 0) continue

    const assignmentIds: string[] = []

    // Sequential (not Promise.all): duplicate student ids within the same
    // tier array must still dedupe against each other, not just against
    // pre-existing rows.
    for (const rawStudentId of studentIds) {
      const studentId = String(rawStudentId || '')
      if (!studentId) continue

      // Idempotency pre-check: an OPEN row for (student, class, chapter)
      // already covers this. teacher_id is deliberately NOT part of the
      // lookup — the DB dedupe index is not keyed by teacher either, so a
      // colleague's open row for the same student x class x chapter also
      // counts as already covered (matches the teacher route's documented
      // cross-teacher 23505 handling).
      const { data: existing, error: existingErr } = await supabase
        .from('teacher_remediation_assignments')
        .select('id')
        .eq('student_id', studentId)
        .eq('class_id', classId)
        .eq('chapter_id', topicId)
        .in('status', OPEN_STATUSES)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (existingErr) {
        console.error(
          `deploy_intervention idempotency lookup failed (${tierKey}, student ${studentId}):`,
          existingErr.message,
        )
        continue
      }
      if (existing) {
        assignmentIds.push(existing.id as string)
        continue
      }

      const { data: inserted, error: insErr } = await supabase
        .from('teacher_remediation_assignments')
        .insert({
          teacher_id: teacherId,
          student_id: studentId,
          class_id: classId,
          chapter_id: topicId,
          status: 'assigned',
        })
        .select('id')
        .single()

      if (insErr) {
        const evidence = [insErr.message, insErr.details, insErr.hint].filter(Boolean).join(' ')
        if (insErr.code === '23505' && evidence.includes(OPEN_DEDUPE_INDEX)) {
          // Named DB backstop conflict: another writer (a race on this same
          // request, or a colleague teacher) already created the open row.
          // Idempotent-success — do not fail the whole tier.
          continue
        }
        console.error(
          `Failed to deploy ${tierKey} remediation for student ${studentId}:`,
          insErr.message,
        )
        continue
      }
      assignmentIds.push(inserted.id as string)
    }

    results[tierKey] = { assignment_ids: assignmentIds, student_count: studentIds.length }
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
      case 'get_grading_queue':
        return await handleGetGradingQueue(body, origin)
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
      case 'mark_attendance':
        return await handleMarkAttendance(body, origin)
      case 'get_attendance_record':
        return await handleGetAttendanceRecord(body, origin)
      case 'get_student_mastery_report':
        return await handleGetStudentMasteryReport(body, origin)
      case 'get_class_mastery_bloom_summary':
        return await handleGetClassMasteryBloomSummary(body, origin)
      case 'export_student_report':
        return await handleExportStudentReport(body, origin)
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

// SECURITY NOTE (TSB-6, corrected 2026-06-29): per-resource ownership IS
// enforced. Every handler that accepts class_id/student_id/alert_id/poll_id
// from the body checks it before any service-role query: assertTeacherOwnsClass
// (heatmap, alerts, overview, trends, mastery, attendance, in-the-moment,
// grade-book), assertTeacherOwnsPoll (close_poll), teacherOwnsAssignment
// (submissions), and owned-set membership (student report / mastery report).
// teacher_id itself is JWT-bound at the dispatcher (resolveTeacherFromJwt),
// never trusted from the body.
//
// The real residual cross-tenant risk was NOT a missing per-resource check —
// it was the grade-fallback student queries running over the service-role
// client (RLS bypassed) with no school_id predicate (TSB-1). Those are now
// tenant-scoped via resolveTeacherSchoolId + `.eq('school_id', …)`, fail-closed
// for school-less teachers. Defense-in-depth follow-ups tracked by the audit:
//   - TSB-2: add a "Teachers can view students in their classes" RLS policy on
//     public.students so these service-role reads gain a DB-layer backstop.
//   - TSB-3: converge this resolver onto canAccessStudent (src/lib/rbac.ts) once
//     a shared authz module bridges the Next.js/Deno runtime split.
