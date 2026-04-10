/**
 * teacher-dashboard — Supabase Edge Function
 *
 * Serves the teacher portal with class management, mastery heatmaps,
 * at-risk student alerts, and classroom polling.
 *
 * Actions:
 *   - get_dashboard:  Teacher info, classes, aggregate stats
 *   - get_heatmap:    Student × concept mastery matrix
 *   - get_alerts:     At-risk student detection
 *   - resolve_alert:  Mark alert as resolved
 *   - launch_poll:    Create classroom poll
 *   - close_poll:     Close poll and return results
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

function getServiceClient() {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
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
  if (!classId) return errorResponse('class_id required', 400, origin)

  const supabase = getServiceClient()

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
  if (!classId) return errorResponse('class_id required', 400, origin)

  const supabase = getServiceClient()
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

    if (profiles) {
      for (const p of profiles) {
        const student = students.find(s => s.id === p.student_id)
        if (!student || p.total_questions_asked < 5) continue

        const accuracy = p.total_questions_answered_correctly / p.total_questions_asked
        const name = student.name || 'Student'

        if (accuracy < 0.3) {
          alerts.push({
            id: `alert-${p.student_id}-${p.subject}-critical`,
            severity: 'critical',
            title: `${name} — critical accuracy in ${p.subject}`,
            description: `${Math.round(accuracy * 100)}% accuracy over ${p.total_questions_asked} questions. Needs immediate intervention.`,
            recommended_action: `Schedule a one-on-one revision session on ${p.subject} fundamentals.`,
            student_id: p.student_id,
            student_name: name,
          })
        } else if (accuracy < 0.5) {
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
  if (!alertId) return errorResponse('alert_id required', 400, origin)

  // Alerts are derived from student data, not stored separately.
  // We can log the resolution for audit purposes.
  const supabase = getServiceClient()
  try {
    await supabase.from('audit_log').insert({
      action: 'resolve_alert',
      entity_type: 'alert',
      entity_id: alertId,
      details: { resolved_at: new Date().toISOString() },
    })
  } catch { /* audit_log may not exist */ }

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
  if (!pollId) return errorResponse('poll_id required', 400, origin)

  const supabase = getServiceClient()

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
      default:
        return errorResponse(`Unknown action: ${action}`, 400, origin)
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal server error'
    console.error('teacher-dashboard error:', msg)
    return errorResponse(msg, 500, origin)
  }
})
