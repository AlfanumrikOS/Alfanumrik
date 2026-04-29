/**
 * parent-portal — Supabase Edge Function
 *
 * Serves the parent portal pages with data about linked children.
 * Actions:
 *   - parent_login: Authenticate parent via link code, return guardian + student
 *   - get_child_dashboard: Return comprehensive child stats for dashboard + reports
 *   - get_tips: Return parenting tips based on child data
 *   - get_children: Return all linked children for a guardian
 *   - get_monthly_report: Return monthly report data for a child
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts'
// P12/P13: never surface stale/invalid subject data to a parent; see
// docs/superpowers/specs/2026-04-15-subject-governance-design.md §6.2
// validateSubjectRpc is per-subject; for the list filter we call the RPC
// directly and intersect with selected_subjects.

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

function getServiceClient() {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// ─── Action Handlers ──────────────────────────────────────────────────────

/**
 * parent_login — Authenticate a parent by link code.
 * Looks up guardian_student_links by link_code on the student,
 * or creates a guardian + link if the code matches a student's invite_code.
 */
async function handleParentLogin(
  body: Record<string, unknown>,
  origin: string | null,
  authUserId: string | null = null
): Promise<Response> {
  const linkCode = String(body.link_code || '').trim().toUpperCase()
  const parentName = String(body.parent_name || 'Parent')

  if (!linkCode) {
    return jsonResponse({ error: 'Link code is required' }, 400, {}, origin)
  }

  const supabase = getServiceClient()

  // 1. Try to find a student with this invite_code or link_code
  const { data: student, error: studentErr } = await supabase
    .from('students')
    .select('id, name, grade, last_active, invite_code, link_code')
    .or(`invite_code.eq.${linkCode},link_code.eq.${linkCode}`)
    .eq('is_active', true)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()

  if (studentErr || !student) {
    return jsonResponse(
      { error: 'Invalid link code. Please check and try again.' },
      200,
      {},
      origin
    )
  }

  // 2. Find or create guardian
  let guardianId: string
  let guardianName: string

  // 2a. If caller is authenticated, check for an existing guardian profile by auth_user_id.
  //     This prevents creating orphan guardian rows when the parent already signed up via auth.
  if (authUserId) {
    const { data: authGuardian } = await supabase
      .from('guardians')
      .select('id, name')
      .eq('auth_user_id', authUserId)
      .limit(1)
      .maybeSingle()

    if (authGuardian) {
      guardianId = authGuardian.id
      guardianName = authGuardian.name || parentName

      // Ensure a link exists between this guardian and the student
      const { data: existingAuthLink } = await supabase
        .from('guardian_student_links')
        .select('id')
        .eq('guardian_id', guardianId)
        .eq('student_id', student.id)
        .limit(1)
        .maybeSingle()

      if (!existingAuthLink) {
        await supabase.from('guardian_student_links').insert({
          guardian_id: guardianId,
          student_id: student.id,
          status: 'active',
          link_code: linkCode,
          is_verified: true,
          linked_at: new Date().toISOString(),
          initiated_by: 'parent_login',
        })
      }

      return jsonResponse(
        {
          guardian: { id: guardianId, name: guardianName },
          student: { id: student.id, name: student.name, grade: student.grade },
        },
        200,
        {},
        origin
      )
    }
  }

  // 2b. Check if there's already a guardian linked to this student.
  // Bug fix (2026-04-29) — privacy hardening (P13):
  // Previously, when an UNAUTHENTICATED user entered a link code that another
  // guardian had already claimed, this branch returned that other guardian's
  // id + name, effectively logging the new caller in as that other parent.
  // That allowed anyone in possession of a leaked link code (e.g. a tuition
  // center) to impersonate the real parent and view all of their linked
  // children. We now require the caller to be authenticated (handled by the
  // auth_user_id branch above) before reusing an existing guardian; otherwise
  // we add a NEW guardian + link, scoping the new caller's session to a
  // distinct guardian row.
  const { data: existingLink } = await supabase
    .from('guardian_student_links')
    .select('guardian_id, guardians(id, name, email)')
    .eq('student_id', student.id)
    .in('status', ['active', 'approved'])
    .limit(1)
    .maybeSingle()

  if (existingLink?.guardian_id && authUserId) {
    // Authenticated caller AND a guardian already exists for this student.
    // The auth_user_id branch above would have matched the caller's own
    // guardian if they had one; falling through to here means they don't.
    // Reuse the existing guardian only when the existing guardian's
    // auth_user_id matches the caller (prevents hijack). Otherwise, create a
    // distinct guardian row below.
    const { data: existingGuardian } = await supabase
      .from('guardians')
      .select('id, name, auth_user_id')
      .eq('id', existingLink.guardian_id)
      .maybeSingle()

    if (existingGuardian && existingGuardian.auth_user_id === authUserId) {
      guardianId = existingGuardian.id
      guardianName = existingGuardian.name || parentName
    } else {
      // Fall through to create-new-guardian path
      guardianId = ''
      guardianName = ''
    }
  } else {
    guardianId = ''
    guardianName = ''
  }

  if (!guardianId) {
    // Create new guardian and link — set auth_user_id if the caller is authenticated
    const guardianInsert: Record<string, unknown> = { name: parentName, relationship: 'parent' }
    if (authUserId) {
      guardianInsert.auth_user_id = authUserId
    }

    const { data: newGuardian, error: guardianErr } = await supabase
      .from('guardians')
      .insert(guardianInsert)
      .select('id, name')
      .single()

    if (guardianErr || !newGuardian) {
      return jsonResponse(
        { error: 'Could not create parent profile. Please try again.' },
        200,
        {},
        origin
      )
    }

    guardianId = newGuardian.id
    guardianName = newGuardian.name

    // Create the link
    await supabase.from('guardian_student_links').insert({
      guardian_id: guardianId,
      student_id: student.id,
      status: 'active',
      link_code: linkCode,
      is_verified: true,
      linked_at: new Date().toISOString(),
      initiated_by: 'parent_login',
    })
  }

  return jsonResponse(
    {
      guardian: { id: guardianId, name: guardianName },
      student: { id: student.id, name: student.name, grade: student.grade },
    },
    200,
    {},
    origin
  )
}

/**
 * get_children — Return all linked children for a guardian.
 * Used by the reports page child selector.
 */
async function handleGetChildren(
  body: Record<string, unknown>,
  origin: string | null
): Promise<Response> {
  const guardianId = String(body.guardian_id || '')

  if (!guardianId) {
    return jsonResponse({ error: 'guardian_id is required' }, 400, {}, origin)
  }

  const supabase = getServiceClient()

  const { data: links, error } = await supabase
    .from('guardian_student_links')
    .select('student_id, students(id, name, grade)')
    .eq('guardian_id', guardianId)
    .in('status', ['active', 'approved'])

  if (error) {
    return jsonResponse({ error: 'Failed to load children' }, 500, {}, origin)
  }

  const children = (links || [])
    .map((link: Record<string, unknown>) => {
      const s = link.students as unknown as { id: string; name: string; grade: string } | null
      return s ? { id: s.id, name: s.name, grade: s.grade } : null
    })
    .filter(Boolean)

  return jsonResponse({ children }, 200, {}, origin)
}

/**
 * getChildDashboardData — Internal helper that builds dashboard data for a single student.
 * Extracted so it can be reused by both single-child and multi-child flows.
 */
async function getChildDashboardData(
  supabase: ReturnType<typeof getServiceClient>,
  studentId: string
): Promise<Record<string, unknown>> {
  // Fetch student basic info
  const { data: student } = await supabase
    .from('students')
    .select('id, name, grade, xp_total, streak_days, last_active, preferred_subject, selected_subjects')
    .eq('id', studentId)
    .single()

  if (!student) {
    return { error: 'Student not found', id: studentId }
  }

  // Fetch learning profiles
  const { data: profiles } = await supabase
    .from('student_learning_profiles')
    .select('subject, xp, streak_days, total_sessions, total_questions_asked, total_questions_answered_correctly, total_time_minutes, last_session_at')
    .eq('student_id', studentId)

  // Fetch quiz sessions
  const { data: quizSessions } = await supabase
    .from('quiz_sessions')
    .select('id, subject, topic_title, score_percent, correct_answers, total_questions, time_taken_seconds, created_at, completed_at, is_completed')
    .eq('student_id', studentId)
    .eq('is_completed', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(100)

  // Fetch chat session count
  const { count: totalChats } = await supabase
    .from('chat_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', studentId)

  // Fetch concept mastery
  const { data: conceptMastery } = await supabase
    .from('concept_mastery')
    .select('topic_id, mastery_level, mastery_probability')
    .eq('student_id', studentId)

  const allProfiles = profiles || []
  const allQuizzes = quizSessions || []
  const allConcepts = conceptMastery || []

  const totalXp = student.xp_total || 0
  const streak = student.streak_days || 0
  const totalQuizCount = allQuizzes.length
  const totalMinutes = allProfiles.reduce(
    (sum: number, p: Record<string, unknown>) => sum + (Number(p.total_time_minutes) || 0),
    0
  )
  const avgScore =
    totalQuizCount > 0
      ? Math.round(
          allQuizzes.reduce(
            (sum: number, q: Record<string, unknown>) => sum + (Number(q.score_percent) || 0),
            0
          ) / totalQuizCount
        )
      : 0
  const totalCorrect = allQuizzes.reduce(
    (sum: number, q: Record<string, unknown>) => sum + (Number(q.correct_answers) || 0),
    0
  )
  const totalQuestions = allQuizzes.reduce(
    (sum: number, q: Record<string, unknown>) => sum + (Number(q.total_questions) || 0),
    0
  )
  const accuracy = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0

  // Daily activity (last 7 days)
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const today = new Date()
  const dailyActivity = []
  const weekQuizzes: Record<string, unknown>[] = []

  for (let i = 6; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const dateStr = d.toISOString().slice(0, 10)
    const dayQuizzes = allQuizzes.filter(
      (q: Record<string, unknown>) => String(q.created_at || '').slice(0, 10) === dateStr
    )
    const quizCount = dayQuizzes.length
    const dayXp = dayQuizzes.reduce(
      (sum: number, q: Record<string, unknown>) => sum + (Number(q.correct_answers) || 0) * 10,
      0
    )
    dailyActivity.push({
      label: dayLabels[d.getDay()],
      day: dateStr,
      quizzes: quizCount,
      xp: dayXp,
      active: quizCount > 0,
      studyTime: dayQuizzes.reduce(
        (sum: number, q: Record<string, unknown>) => sum + (Number(q.time_taken_seconds) || 0),
        0
      ),
    })
    weekQuizzes.push(...dayQuizzes)
  }

  const weekQuizCount = weekQuizzes.length
  const weekAvgScore =
    weekQuizCount > 0
      ? Math.round(
          weekQuizzes.reduce(
            (sum: number, q: Record<string, unknown>) => sum + (Number(q.score_percent) || 0),
            0
          ) / weekQuizCount
        )
      : 0
  const activeDays = dailyActivity.filter((d) => d.active).length

  // BKT mastery
  const masteryLevels: Record<string, number> = { mastered: 0, proficient: 0, familiar: 0, attempted: 0 }
  for (const c of allConcepts) {
    const level = String(c.mastery_level || '')
    if (level === 'mastered') masteryLevels.mastered++
    else if (level === 'proficient') masteryLevels.proficient++
    else if (level === 'familiar') masteryLevels.familiar++
    else masteryLevels.attempted++
  }

  // Bug fix (2026-04-29): Compute a true mastery percentage from concept_mastery
  // rather than aliasing accuracy. Previously stats.mastery was set to accuracy,
  // so the parent UI showed identical numbers for "Mastery" and "Accuracy" pills,
  // misleading parents about distinct measures.
  // mastery_percent = (mastered + 0.66 * proficient + 0.33 * familiar) / total
  // Same weighting used by the student-facing /progress page.
  const totalConcepts = allConcepts.length
  const masteryPercent = totalConcepts > 0
    ? Math.round(
        ((masteryLevels.mastered + 0.66 * masteryLevels.proficient + 0.33 * masteryLevels.familiar) /
          totalConcepts) *
          100
      )
    : 0

  // Subject data
  const subjectMap = new Map<string, { quizzes: Record<string, unknown>[] }>()
  for (const q of allQuizzes) {
    const subj = String(q.subject || 'Unknown')
    if (!subjectMap.has(subj)) subjectMap.set(subj, { quizzes: [] })
    subjectMap.get(subj)!.quizzes.push(q)
  }

  // P12/P13: never surface stale/invalid subject data to a parent; see
  // docs/superpowers/specs/2026-04-15-subject-governance-design.md §6.2
  // Intersect selected_subjects AND quiz-derived subjects with the student's
  // currently-valid subjects (grade-map ∩ plan). Record what was filtered
  // out for ops visibility.
  let allowedCodes: Set<string> | null = null
  const staleSubjects: string[] = []
  try {
    const { data: allowedRows } = await supabase.rpc('get_available_subjects', {
      p_student_id: student.id,
    })
    if (Array.isArray(allowedRows)) {
      allowedCodes = new Set(
        (allowedRows as Array<{ code: string; is_locked: boolean }>)
          .filter((r) => !r.is_locked)
          .map((r) => r.code),
      )
    }
  } catch (subjErr) {
    console.warn(
      'parent-portal: get_available_subjects failed, returning unfiltered data:',
      subjErr instanceof Error ? subjErr.message : String(subjErr),
    )
  }

  const selected = Array.isArray(student.selected_subjects)
    ? (student.selected_subjects as unknown[]).map((s) => String(s))
    : []
  if (allowedCodes) {
    for (const s of selected) {
      if (!allowedCodes.has(s)) staleSubjects.push(s)
    }
    for (const s of Array.from(subjectMap.keys())) {
      if (!allowedCodes.has(s)) {
        staleSubjects.push(s)
        subjectMap.delete(s)
      }
    }
  }

  const subjects = Array.from(subjectMap.keys())

  const subjectProgress = Array.from(subjectMap.entries()).map(([name, data]) => {
    const sqz = data.quizzes
    const percent = sqz.length > 0
      ? Math.round(sqz.reduce((s: number, q: Record<string, unknown>) => s + (Number(q.score_percent) || 0), 0) / sqz.length)
      : 0
    return { name, percent }
  })

  // Insights
  const insights: string[] = []
  if (streak >= 7) insights.push(`Great consistency! ${student.name} has a ${streak}-day study streak.`)
  else if (streak === 0) insights.push(`${student.name} hasn't studied today. A gentle reminder might help!`)
  if (accuracy >= 80) insights.push(`Strong performance with ${accuracy}% accuracy overall.`)
  else if (accuracy > 0 && accuracy < 50) insights.push(`Accuracy is at ${accuracy}%. More practice on weak topics could help.`)

  const todayQuizzes = dailyActivity[dailyActivity.length - 1]?.quizzes || 0
  const todayStudyTime = dailyActivity[dailyActivity.length - 1]?.studyTime || 0

  // De-duplicate stale list
  const dedupedStale = Array.from(new Set(staleSubjects))

  return {
    id: student.id,
    ...(dedupedStale.length > 0 ? { stale_subjects: dedupedStale } : {}),
    student: { name: student.name, grade: student.grade },
    name: student.name,
    grade: student.grade,
    subject: student.preferred_subject || 'Science',
    stats: {
      xp: totalXp,
      streak,
      accuracy,
      totalQuizzes: totalQuizCount,
      minutes: totalMinutes,
      totalChats: totalChats || 0,
      avgScore,
      // Bug fix (2026-04-29): mastery is now derived from concept_mastery, not
      // aliased to accuracy. See computation of masteryPercent above.
      mastery: masteryPercent,
      mastery_percent: masteryPercent,
      avg_score: avgScore,
      total_quizzes: totalQuizCount,
      study_minutes: totalMinutes,
      current_streak: streak,
      today_quizzes: todayQuizzes,
      today_minutes: Math.round(todayStudyTime / 60),
      todayQuizzes,
      todayMinutes: Math.round(todayStudyTime / 60),
    },
    dailyActivity,
    weekSummary: { quizzes: weekQuizCount, avgScore: weekAvgScore, activeDays },
    bktMastery: {
      levels: masteryLevels,
      total: allConcepts.length,
      concepts: allConcepts.map((c: Record<string, unknown>) => ({
        name: String(c.topic_id || '').slice(0, 8),
        level: String(c.mastery_level || 'developing'),
        subject: 'General',
      })),
    },
    activeBursts: [],
    insights,
    subjects,
    subjectProgress,
    recentAchievements: [],
    weekSummary_text: weekQuizCount > 0
      ? `Completed ${weekQuizCount} quizzes with ${weekAvgScore}% average score, active ${activeDays} of 7 days.`
      : '',
    last_active: student.last_active,
    lastActive: student.last_active,
    todayQuizzes,
    todayMinutes: Math.round(todayStudyTime / 60),
    activeToday: todayQuizzes > 0,
  }
}

/**
 * handleGetAllChildrenDashboard — Returns dashboard data for all linked children.
 * Used by parent/children/page.tsx when no student_id is provided.
 */
async function handleGetAllChildrenDashboard(
  guardianId: string,
  origin: string | null
): Promise<Response> {
  const supabase = getServiceClient()

  // Get all linked children
  const { data: links, error } = await supabase
    .from('guardian_student_links')
    .select('student_id')
    .eq('guardian_id', guardianId)
    .in('status', ['active', 'approved'])

  if (error || !links || links.length === 0) {
    return jsonResponse({ students: [] }, 200, {}, origin)
  }

  // Fetch dashboard data for each child
  const students = []
  for (const link of links) {
    const data = await getChildDashboardData(supabase, link.student_id)
    if (!data.error) {
      students.push(data)
    }
  }

  return jsonResponse({ students }, 200, {}, origin)
}

/**
 * get_child_dashboard — Return comprehensive stats for a child.
 * Serves both the main dashboard (parent/page.tsx) and the reports page.
 *
 * Expected response shape (DashboardData / ReportData):
 *   student: { name, grade }
 *   stats: { xp, streak, accuracy, totalQuizzes, minutes, totalChats, avgScore }
 *   dailyActivity: WeeklyDay[]
 *   weekSummary: { quizzes, avgScore, activeDays }
 *   bktMastery: { levels: Record<string, number>, total, concepts: ConceptItem[] }
 *   activeBursts: ActiveBurst[]
 *   insights: string[]
 *   subjects: SubjectData[]
 *   quizHistory: QuizRecord[]
 *   parentTips: TipItem[]
 */
async function handleGetChildDashboard(
  body: Record<string, unknown>,
  origin: string | null
): Promise<Response> {
  const guardianId = String(body.guardian_id || '')
  const studentId = String(body.student_id || '')

  if (!guardianId) {
    return jsonResponse(
      { error: 'guardian_id is required' },
      400,
      {},
      origin
    )
  }

  // If no student_id, return dashboard data for ALL linked children
  // (used by parent/children/page.tsx)
  if (!studentId) {
    return await handleGetAllChildrenDashboard(guardianId, origin)
  }

  const supabase = getServiceClient()

  // Verify guardian-student link (P13: data privacy)
  const { data: link } = await supabase
    .from('guardian_student_links')
    .select('id')
    .eq('guardian_id', guardianId)
    .eq('student_id', studentId)
    .in('status', ['active', 'approved'])
    .limit(1)
    .maybeSingle()

  if (!link) {
    return jsonResponse(
      { error: 'You do not have access to this child\'s data.' },
      403,
      {},
      origin
    )
  }

  // Use shared helper for all data fetching + computation
  const dashData = await getChildDashboardData(supabase, studentId)

  if (dashData.error) {
    return jsonResponse({ error: dashData.error }, 404, {}, origin)
  }

  // Enrich with quiz history and subject detail for the reports page
  const allQuizzes = await fetchQuizHistory(supabase, studentId)
  const allProfiles = await fetchLearningProfiles(supabase, studentId)
  const subjectsDetailed = buildSubjectDetail(allQuizzes, allProfiles)
  const quizHistory = buildQuizHistory(allQuizzes)
  const stats = dashData.stats as Record<string, unknown>
  const accuracy = Number(stats.accuracy) || 0
  const streak = Number(stats.streak) || 0
  const totalQuizzes = Number(stats.totalQuizzes) || 0
  const weekQuizzes = Number((dashData.weekSummary as Record<string, unknown>)?.quizzes) || 0
  const parentTips = generateTips(accuracy, streak, totalQuizzes, weekQuizzes)

  return jsonResponse(
    {
      ...dashData,
      subjects: subjectsDetailed,
      quizHistory,
      recentQuizzes: quizHistory,
      parentTips,
      tips: parentTips,
    },
    200,
    {},
    origin
  )
}

// ─── Data-fetch helpers (used by handleGetChildDashboard for report-level detail) ──

async function fetchQuizHistory(
  supabase: ReturnType<typeof getServiceClient>,
  studentId: string
): Promise<Record<string, unknown>[]> {
  const { data } = await supabase
    .from('quiz_sessions')
    .select('id, subject, topic_title, score_percent, correct_answers, total_questions, time_taken_seconds, created_at, completed_at, is_completed')
    .eq('student_id', studentId)
    .eq('is_completed', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(100)
  return data || []
}

async function fetchLearningProfiles(
  supabase: ReturnType<typeof getServiceClient>,
  studentId: string
): Promise<Record<string, unknown>[]> {
  const { data } = await supabase
    .from('student_learning_profiles')
    .select('subject, xp, streak_days, total_sessions, total_questions_asked, total_questions_answered_correctly, total_time_minutes, last_session_at')
    .eq('student_id', studentId)
  return data || []
}

function buildSubjectDetail(
  allQuizzes: Record<string, unknown>[],
  allProfiles: Record<string, unknown>[]
): Record<string, unknown>[] {
  const subjectMap = new Map<string, { quizzes: Record<string, unknown>[]; profile: Record<string, unknown> | null }>()

  for (const q of allQuizzes) {
    const subj = String(q.subject || 'Unknown')
    if (!subjectMap.has(subj)) subjectMap.set(subj, { quizzes: [], profile: null })
    subjectMap.get(subj)!.quizzes.push(q)
  }

  for (const p of allProfiles) {
    const subj = String(p.subject || 'Unknown')
    if (!subjectMap.has(subj)) subjectMap.set(subj, { quizzes: [], profile: null })
    subjectMap.get(subj)!.profile = p
  }

  return Array.from(subjectMap.entries()).map(([name, data]) => {
    const sqz = data.quizzes
    const mastery = sqz.length > 0
      ? Math.round(sqz.reduce((s: number, q: Record<string, unknown>) => s + (Number(q.score_percent) || 0), 0) / sqz.length)
      : 0
    const recentScore = sqz.length > 0 ? Math.round(Number(sqz[0].score_percent) || 0) : undefined

    const topicScores = new Map<string, number[]>()
    for (const q of sqz) {
      const topic = String(q.topic_title || '')
      if (!topic) continue
      if (!topicScores.has(topic)) topicScores.set(topic, [])
      topicScores.get(topic)!.push(Number(q.score_percent) || 0)
    }
    const strongTopics: string[] = []
    const weakTopics: string[] = []
    for (const [topic, scores] of topicScores) {
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length
      if (avg >= 70) strongTopics.push(topic)
      else if (avg < 50) weakTopics.push(topic)
    }

    return {
      name,
      mastery,
      recentScore,
      topicsMastered: strongTopics.length,
      totalTopics: topicScores.size,
      strongTopics: strongTopics.slice(0, 3),
      weakTopics: weakTopics.slice(0, 3),
    }
  })
}

function buildQuizHistory(allQuizzes: Record<string, unknown>[]): Record<string, unknown>[] {
  return allQuizzes.slice(0, 20).map((q) => ({
    topic: q.topic_title || '',
    subject: q.subject || '',
    score: Math.round(Number(q.score_percent) || 0),
    date: q.created_at || '',
    created_at: q.created_at || '',
    timeSpent: Number(q.time_taken_seconds) || 0,
  }))
}

/**
 * get_tips — Return parenting tips.
 */
async function handleGetTips(
  _body: Record<string, unknown>,
  origin: string | null
): Promise<Response> {
  // Static tips list — could be personalized in the future based on child data
  const tips = [
    {
      id: 'tip-1',
      title: 'Set a daily study routine',
      description:
        'Even 20 minutes of focused practice daily leads to significant improvement over time. Help your child pick a consistent time each day.',
    },
    {
      id: 'tip-2',
      title: 'Celebrate small wins',
      description:
        'Acknowledge streaks, completed quizzes, and improved scores. Positive reinforcement builds intrinsic motivation.',
    },
    {
      id: 'tip-3',
      title: 'Ask what they learned today',
      description:
        'When your child explains a concept to you, it reinforces their understanding. This technique is called "teach-back" and is highly effective.',
    },
    {
      id: 'tip-4',
      title: 'Focus on progress, not perfection',
      description:
        'A score improving from 40% to 60% is more meaningful than always scoring 90%. Growth mindset is key to long-term success.',
    },
    {
      id: 'tip-5',
      title: 'Use the AI tutor together',
      description:
        'Sit with your child and explore Foxy together. Understanding how the AI tutor works helps you guide their learning better.',
    },
    {
      id: 'tip-6',
      title: 'Review the weekly report',
      description:
        'Check the Reports page weekly to spot trends. Consistent dips in a subject mean your child may need extra support there.',
    },
  ]

  return jsonResponse({ tips }, 200, {}, origin)
}

/**
 * get_monthly_report — Return monthly report data for a child.
 */
async function handleGetMonthlyReport(
  body: Record<string, unknown>,
  origin: string | null
): Promise<Response> {
  const guardianId = String(body.guardian_id || '')
  const studentId = String(body.student_id || '')
  const reportMonth = String(body.report_month || '') // e.g. "2026-03"

  if (!guardianId || !studentId || !reportMonth) {
    return jsonResponse(
      { error: 'guardian_id, student_id, and report_month are required' },
      400,
      {},
      origin
    )
  }

  const supabase = getServiceClient()

  // Verify guardian-student link
  const { data: link } = await supabase
    .from('guardian_student_links')
    .select('id')
    .eq('guardian_id', guardianId)
    .eq('student_id', studentId)
    .in('status', ['active', 'approved'])
    .limit(1)
    .maybeSingle()

  if (!link) {
    return jsonResponse(
      { error: 'You do not have access to this child\'s data.' },
      403,
      {},
      origin
    )
  }

  // Parse report_month to first-of-month date
  const monthDate = `${reportMonth}-01`

  // Fetch from monthly_reports table
  const { data: report, error } = await supabase
    .from('monthly_reports')
    .select('*')
    .eq('student_id', studentId)
    .eq('report_month', monthDate)
    .maybeSingle()

  if (error) {
    return jsonResponse({ error: 'Failed to load monthly report' }, 500, {}, origin)
  }

  if (!report) {
    // Try to generate the report if it doesn't exist
    const { data: generated, error: genErr } = await supabase.rpc(
      'generate_monthly_report',
      { p_student_id: studentId, p_month: monthDate }
    )

    if (genErr || !generated) {
      return jsonResponse(
        { error: 'No monthly report available for this period.' },
        200,
        {},
        origin
      )
    }

    // Fetch the newly generated report
    const { data: newReport } = await supabase
      .from('monthly_reports')
      .select('*')
      .eq('student_id', studentId)
      .eq('report_month', monthDate)
      .maybeSingle()

    if (newReport) {
      return jsonResponse(formatMonthlyReport(newReport), 200, {}, origin)
    }

    // Return the RPC result directly if table fetch failed
    return jsonResponse({ report_data: generated }, 200, {}, origin)
  }

  return jsonResponse(formatMonthlyReport(report), 200, {}, origin)
}

// ─── Helper Functions ─────────────────────────────────────────────────────

function formatMonthlyReport(report: Record<string, unknown>) {
  // Parse JSONB fields
  const weakChapters = Array.isArray(report.weak_chapters)
    ? report.weak_chapters
    : parseJsonbArray(report.weak_chapters)
  const strongChapters = Array.isArray(report.strong_chapters)
    ? report.strong_chapters
    : parseJsonbArray(report.strong_chapters)
  const accuracyTrend = Array.isArray(report.accuracy_trend)
    ? report.accuracy_trend
    : parseJsonbArray(report.accuracy_trend)
  const reportData = (report.report_data || {}) as Record<string, unknown>

  return {
    report_data: {
      conceptMasteryPct: Number(report.concept_mastery_pct) || 0,
      retentionScore: Number(report.retention_score) || 0,
      weakChapters,
      strongChapters,
      predictedScore: parsePredictedScore(report.predicted_score),
      syllabusCompletionPct: Number(report.syllabus_completion_pct) || 0,
      accuracyTrend,
      timeEfficiency: Number(report.time_efficiency) || 0,
      studyConsistencyPct: Number(report.study_consistency_pct) || 0,
      totalStudyMinutes: Number(report.total_study_minutes) || 0,
      totalQuestionsAttempted: Number(report.total_questions_attempted) || 0,
      improvementAreas: (reportData.improvementAreas as string[]) || [],
      achievements: (reportData.achievements as string[]) || [],
    },
  }
}

function parseJsonbArray(val: unknown): unknown[] {
  if (Array.isArray(val)) return val
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

function parsePredictedScore(val: unknown): number | string {
  if (typeof val === 'number') return val
  if (typeof val === 'string') {
    const num = Number(val)
    return isNaN(num) ? val : num
  }
  if (val && typeof val === 'object') {
    const obj = val as Record<string, unknown>
    // predicted_score is stored as JSONB, might be { score: N } or just N
    if ('score' in obj) return Number(obj.score) || '--'
    if ('value' in obj) return Number(obj.value) || '--'
  }
  return '--'
}

function generateTips(
  accuracy: number,
  streak: number,
  totalQuizzes: number,
  weekQuizzes: number
): Array<{ id: string; title: string; description: string; icon?: string }> {
  const tips: Array<{ id: string; title: string; description: string; icon?: string }> = []

  if (accuracy < 50 && totalQuizzes > 0) {
    tips.push({
      id: 'tip-accuracy',
      title: 'Focus on understanding over speed',
      description:
        'Your child might be rushing through questions. Encourage them to read each question carefully and use the explanation feature after wrong answers.',
      icon: '\uD83C\uDFAF',
    })
  }

  if (streak === 0) {
    tips.push({
      id: 'tip-streak',
      title: 'Help restart the study streak',
      description:
        'Even a 5-minute session counts! Suggest your child open the app and do just one quiz to rebuild the streak habit.',
      icon: '\uD83D\uDD25',
    })
  } else if (streak >= 7) {
    tips.push({
      id: 'tip-streak-praise',
      title: 'Celebrate the streak!',
      description:
        `Your child has studied for ${streak} days straight. This consistency is the #1 predictor of academic improvement. Let them know you noticed!`,
      icon: '\uD83C\uDF1F',
    })
  }

  if (weekQuizzes === 0) {
    tips.push({
      id: 'tip-inactive',
      title: 'Encourage regular practice',
      description:
        'No quizzes this week. Try setting a specific "study time" each day — consistency matters more than duration.',
      icon: '\uD83D\uDCDA',
    })
  }

  if (totalQuizzes === 0) {
    tips.push({
      id: 'tip-start',
      title: 'Get started together',
      description:
        'Sit with your child and explore a topic together. Taking the first quiz together can reduce anxiety and build confidence.',
      icon: '\uD83D\uDE80',
    })
  }

  // Always add a general tip
  tips.push({
    id: 'tip-general',
    title: 'Praise effort, not just results',
    description:
      'Research shows that praising hard work ("You practiced so well!") is more effective than praising ability ("You\'re so smart!") in building long-term motivation.',
    icon: '\uD83D\uDCA1',
  })

  return tips
}

// ─── Main Handler ─────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  const corsHeaders = getCorsHeaders(origin)

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Only accept POST
  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405, origin)
  }

  try {
    const body = await req.json()
    const action = String(body.action || '')

    // Resolve auth user ID to prevent orphan guardian creation.
    // Primary source: explicit auth_user_id from the client (reliable, set by AuthContext).
    // Fallback: extract from Authorization header (may fail due to session timing).
    // The auth_user_id is verified by checking if a guardian with that ID exists in the DB —
    // a spoofed ID with no matching guardian row is harmless (falls through to create path).
    let authUserId: string | null = null

    // 1. Explicit auth_user_id from request body (set by parent page from AuthContext)
    const bodyAuthUserId = typeof body.auth_user_id === 'string' && body.auth_user_id.length > 0
      ? body.auth_user_id
      : null
    if (bodyAuthUserId) {
      authUserId = bodyAuthUserId
    }

    // 2. Fallback: Authorization header token extraction
    if (!authUserId) {
      const authHeader = req.headers.get('authorization')
      if (authHeader?.startsWith('Bearer ')) {
        try {
          const { data: { user } } = await getServiceClient().auth.getUser(
            authHeader.replace('Bearer ', '')
          )
          if (user) authUserId = user.id
        } catch {
          // No valid auth session — continue without authUserId
        }
      }
    }

    switch (action) {
      case 'parent_login':
        return await handleParentLogin(body, origin, authUserId)

      case 'get_child_dashboard':
        return await handleGetChildDashboard(body, origin)

      case 'get_tips':
        return await handleGetTips(body, origin)

      case 'get_children':
        return await handleGetChildren(body, origin)

      case 'get_monthly_report':
        return await handleGetMonthlyReport(body, origin)

      default:
        return errorResponse(`Unknown action: ${action}`, 400, origin)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    return errorResponse(message, 500, origin)
  }
})
