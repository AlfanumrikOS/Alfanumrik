/**
 * export-report – Alfanumrik Edge Function
 *
 * Generate data reports for teachers and parents/guardians.
 * Validates that the caller has permission before returning any data.
 *
 * POST body:
 * {
 *   report_type: 'class_performance' | 'student_hpc' | 'parent_weekly'
 *   scope_id:    string   – class_id for class_performance, student_id for the others
 *   format?:     'json' | 'csv'  (default: 'json')
 * }
 *
 * Auth: Bearer token (Supabase anon JWT) must be present.
 *       Permission check is enforced per report_type:
 *         class_performance – caller must own the class (teacher)
 *         student_hpc       – caller must be the student or a linked guardian
 *         parent_weekly     – caller must be a guardian linked to the student
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportType = 'class_performance' | 'student_hpc' | 'parent_weekly'
type Format = 'json' | 'csv'

interface RequestBody {
  report_type: ReportType
  scope_id: string
  format?: Format
}

// ─── CSV serialiser ───────────────────────────────────────────────────────────

function toCSV(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0])
  const escape = (v: unknown): string => {
    const s = v == null ? '' : String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s
  }
  const lines = [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(',')),
  ]
  return lines.join('\r\n')
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

/** Resolve the auth user's internal role record (student / teacher / guardian). */
async function resolveCallerRole(
  supabase: SupabaseClient,
  authUserId: string,
): Promise<{ role: string; internal_id: string } | null> {
  const { data, error } = await supabase.rpc('get_user_role', {
    p_auth_user_id: authUserId,
  })
  if (error || !data) return null
  return data as { role: string; internal_id: string }
}

// ─── Permission guards ────────────────────────────────────────────────────────

async function assertTeacherOwnsClass(
  supabase: SupabaseClient,
  teacherId: string,
  classId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('classes')
    .select('id')
    .eq('id', classId)
    .eq('teacher_id', teacherId)
    .maybeSingle()

  if (error) throw new Error(`Permission check failed: ${error.message}`)
  if (!data) throw new Error('Forbidden: you do not own this class')
}

async function assertGuardianLinkedToStudent(
  supabase: SupabaseClient,
  guardianId: string,
  studentId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('guardian_student_links')
    .select('guardian_id')
    .eq('guardian_id', guardianId)
    .eq('student_id', studentId)
    .maybeSingle()

  if (error) throw new Error(`Permission check failed: ${error.message}`)
  if (!data) throw new Error('Forbidden: you are not linked to this student')
}

async function assertStudentOrGuardian(
  supabase: SupabaseClient,
  callerRole: { role: string; internal_id: string },
  studentId: string,
): Promise<void> {
  if (callerRole.role === 'student' && callerRole.internal_id === studentId) return
  if (callerRole.role === 'guardian') {
    await assertGuardianLinkedToStudent(supabase, callerRole.internal_id, studentId)
    return
  }
  // Teachers can also view student HPC for their enrolled students
  if (callerRole.role === 'teacher') {
    const { data } = await supabase
      .from('class_enrollments')
      .select('id')
      .eq('student_id', studentId)
      .limit(1)
    if (data && data.length > 0) return
  }
  throw new Error('Forbidden: insufficient permissions to view this student report')
}

// ─── Report generators ────────────────────────────────────────────────────────

/**
 * class_performance – aggregate quiz and mastery stats for all students in a class.
 */
async function generateClassPerformanceReport(
  supabase: SupabaseClient,
  classId: string,
): Promise<Record<string, unknown>[]> {
  // Fetch class metadata
  const { data: classData, error: classError } = await supabase
    .from('classes')
    .select('id, name, grade, section, subject')
    .eq('id', classId)
    .single()

  if (classError) throw new Error(`class_performance: ${classError.message}`)

  // Fetch enrollments
  const { data: enrollments, error: enrollError } = await supabase
    .from('class_enrollments')
    .select('student_id, enrolled_at, students(name, email)')
    .eq('class_id', classId)

  if (enrollError) throw new Error(`class_performance enrollments: ${enrollError.message}`)

  const enrolledStudents = (enrollments ?? []) as {
    student_id: string
    enrolled_at: string
    students: { name: string; email: string } | null
  }[]

  if (enrolledStudents.length === 0) {
    return [{
      class_id: classId,
      class_name: (classData as Record<string, unknown>)?.name,
      total_students: 0,
      message: 'No enrolled students',
    }]
  }

  const studentIds = enrolledStudents.map((e) => e.student_id)

  // Fetch learning profiles for these students
  const { data: profiles } = await supabase
    .from('student_learning_profiles')
    .select('student_id, subject, xp, streak_days, total_questions_asked, total_questions_answered_correctly')
    .in('student_id', studentIds)

  // Fetch recent quiz sessions (last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const { data: sessions } = await supabase
    .from('quiz_sessions')
    .select('student_id, subject, score_percent, xp_earned, created_at')
    .in('student_id', studentIds)
    .gte('created_at', thirtyDaysAgo)

  // Fetch mastery counts
  const { data: masteryRows } = await supabase
    .from('concept_mastery')
    .select('student_id, mastery_level')
    .in('student_id', studentIds)

  // Build per-student summary
  const profileMap = new Map<string, typeof profiles>()
  for (const p of (profiles ?? [])) {
    const arr = profileMap.get(p.student_id) ?? []
    arr.push(p)
    profileMap.set(p.student_id, arr)
  }

  const sessionMap = new Map<string, typeof sessions>()
  for (const s of (sessions ?? [])) {
    const arr = sessionMap.get(s.student_id) ?? []
    arr.push(s)
    sessionMap.set(s.student_id, arr)
  }

  const masteryMap = new Map<string, number[]>()
  for (const m of (masteryRows ?? [])) {
    const arr = masteryMap.get(m.student_id) ?? []
    arr.push(m.mastery_level)
    masteryMap.set(m.student_id, arr)
  }

  const rows: Record<string, unknown>[] = []

  for (const enroll of enrolledStudents) {
    const sid = enroll.student_id
    const studentProfiles = profileMap.get(sid) ?? []
    const studentSessions = sessionMap.get(sid) ?? []
    const masteryLevels = masteryMap.get(sid) ?? []

    const totalXp = studentProfiles.reduce((s, p) => s + ((p.xp as number) ?? 0), 0)
    const maxStreak = Math.max(0, ...studentProfiles.map((p) => (p.streak_days as number) ?? 0))
    const totalAsked = studentProfiles.reduce((s, p) => s + ((p.total_questions_asked as number) ?? 0), 0)
    const totalCorrect = studentProfiles.reduce((s, p) => s + ((p.total_questions_answered_correctly as number) ?? 0), 0)
    const avgScore30d =
      studentSessions.length > 0
        ? Math.round(
            studentSessions.reduce((s, sess) => s + ((sess.score_percent as number) ?? 0), 0) /
              studentSessions.length,
          )
        : null
    const avgMastery =
      masteryLevels.length > 0
        ? Math.round((masteryLevels.reduce((s, m) => s + m, 0) / masteryLevels.length) * 100)
        : null
    const topicsMastered = masteryLevels.filter((m) => m >= 0.95).length

    rows.push({
      student_id: sid,
      student_name: enroll.students?.name ?? 'Unknown',
      enrolled_at: enroll.enrolled_at,
      total_xp: totalXp,
      max_streak_days: maxStreak,
      overall_accuracy_pct: totalAsked > 0 ? Math.round((totalCorrect / totalAsked) * 100) : null,
      avg_score_30d: avgScore30d,
      quizzes_30d: studentSessions.length,
      avg_mastery_pct: avgMastery,
      topics_mastered: topicsMastered,
    })
  }

  // Sort by total XP descending
  rows.sort((a, b) => ((b.total_xp as number) ?? 0) - ((a.total_xp as number) ?? 0))

  return rows
}

/**
 * student_hpc – High-Performance Card: full mastery + stats for one student.
 * "HPC" is a term used in competitive education contexts.
 */
async function generateStudentHpcReport(
  supabase: SupabaseClient,
  studentId: string,
): Promise<Record<string, unknown>[]> {
  const { data: student, error: studentError } = await supabase
    .from('students')
    .select('id, name, grade, email')
    .eq('id', studentId)
    .maybeSingle()

  if (studentError) throw new Error(`student_hpc student fetch: ${studentError.message}`)
  if (!student) throw new Error(`Student ${studentId} not found`)

  const { data: profiles } = await supabase
    .from('student_learning_profiles')
    .select('subject, xp, streak_days, total_questions_asked, total_questions_answered_correctly')
    .eq('student_id', studentId)
    .order('xp', { ascending: false })

  const { data: masteryRows } = await supabase
    .from('concept_mastery')
    .select(`
      topic_id,
      mastery_level,
      total_attempts,
      correct_attempts,
      last_reviewed_at,
      next_review_at,
      curriculum_topics(title, chapter_number, subject_id, subjects(name, code))
    `)
    .eq('student_id', studentId)
    .order('mastery_level', { ascending: false })
    .limit(100)

  const { data: recentSessions } = await supabase
    .from('quiz_sessions')
    .select('id, subject, score_percent, xp_earned, time_taken_seconds, created_at')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })
    .limit(20)

  // Build flat HPC rows — one row per subject mastery
  const profileRows = ((profiles ?? []) as Record<string, unknown>[]).map((p) => ({
    student_id: studentId,
    student_name: (student as Record<string, unknown>).name,
    grade: (student as Record<string, unknown>).grade,
    report_section: 'subject_profile',
    subject: p.subject,
    xp: p.xp,
    streak_days: p.streak_days,
    total_questions_asked: p.total_questions_asked,
    total_questions_correct: p.total_questions_answered_correctly,
    accuracy_pct:
      (p.total_questions_asked as number) > 0
        ? Math.round(
            (((p.total_questions_answered_correctly as number) ?? 0) /
              (p.total_questions_asked as number)) *
              100,
          )
        : null,
  }))

  const masteryData = ((masteryRows ?? []) as Record<string, unknown>[]).map((m) => {
    const topic = m.curriculum_topics as Record<string, unknown> | null
    const subjectInfo = topic?.subjects as Record<string, unknown> | null
    return {
      student_id: studentId,
      student_name: (student as Record<string, unknown>).name,
      grade: (student as Record<string, unknown>).grade,
      report_section: 'concept_mastery',
      topic_id: m.topic_id,
      topic_title: topic?.title ?? null,
      chapter_number: topic?.chapter_number ?? null,
      subject_name: subjectInfo?.name ?? null,
      subject_code: subjectInfo?.code ?? null,
      mastery_level: m.mastery_level,
      mastery_pct: Math.round(((m.mastery_level as number) ?? 0) * 100),
      total_attempts: m.total_attempts,
      correct_attempts: m.correct_attempts,
      last_reviewed_at: m.last_reviewed_at,
      next_review_at: m.next_review_at,
    }
  })

  const sessionData = ((recentSessions ?? []) as Record<string, unknown>[]).map((s) => ({
    student_id: studentId,
    student_name: (student as Record<string, unknown>).name,
    grade: (student as Record<string, unknown>).grade,
    report_section: 'recent_quiz',
    session_id: s.id,
    subject: s.subject,
    score_percent: s.score_percent,
    xp_earned: s.xp_earned,
    time_taken_seconds: s.time_taken_seconds,
    created_at: s.created_at,
  }))

  return [...profileRows, ...masteryData, ...sessionData]
}

/**
 * parent_weekly – weekly digest of a student's activity for their guardian.
 */
async function generateParentWeeklyReport(
  supabase: SupabaseClient,
  studentId: string,
): Promise<Record<string, unknown>[]> {
  const { data: student, error: studentError } = await supabase
    .from('students')
    .select('id, name, grade')
    .eq('id', studentId)
    .maybeSingle()

  if (studentError) throw new Error(`parent_weekly student fetch: ${studentError.message}`)
  if (!student) throw new Error(`Student ${studentId} not found`)

  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()

  // Quiz sessions this week
  const { data: sessions } = await supabase
    .from('quiz_sessions')
    .select('id, subject, score_percent, xp_earned, time_taken_seconds, created_at')
    .eq('student_id', studentId)
    .gte('created_at', sevenDaysAgo)
    .order('created_at', { ascending: false })

  const sessionList = (sessions ?? []) as {
    id: string
    subject: string
    score_percent: number
    xp_earned: number
    time_taken_seconds: number
    created_at: string
  }[]

  const totalXp = sessionList.reduce((s, q) => s + (q.xp_earned ?? 0), 0)
  const avgScore =
    sessionList.length > 0
      ? Math.round(sessionList.reduce((s, q) => s + (q.score_percent ?? 0), 0) / sessionList.length)
      : 0
  const studyMinutes = Math.round(
    sessionList.reduce((s, q) => s + (q.time_taken_seconds ?? 0), 0) / 60,
  )
  const subjectsCovered = [...new Set(sessionList.map((q) => q.subject))]

  // New mastery gains this week
  const { data: newMastery } = await supabase
    .from('concept_mastery')
    .select(`
      topic_id,
      mastery_level,
      updated_at,
      curriculum_topics(title, subjects(name))
    `)
    .eq('student_id', studentId)
    .gte('updated_at', sevenDaysAgo)
    .gte('mastery_level', 0.65)
    .order('mastery_level', { ascending: false })
    .limit(10)

  // Current streak
  const { data: profiles } = await supabase
    .from('student_learning_profiles')
    .select('streak_days')
    .eq('student_id', studentId)

  const currentStreak = Math.max(0, ...((profiles ?? []) as { streak_days: number }[]).map((p) => p.streak_days ?? 0))

  // Summary row
  const summary: Record<string, unknown>[] = [{
    report_section: 'weekly_summary',
    student_id: studentId,
    student_name: (student as Record<string, unknown>).name,
    grade: (student as Record<string, unknown>).grade,
    week_start: sevenDaysAgo,
    week_end: new Date().toISOString(),
    quizzes_completed: sessionList.length,
    avg_score_pct: avgScore,
    total_xp_earned: totalXp,
    study_minutes: studyMinutes,
    subjects_covered: subjectsCovered.join(', '),
    current_streak_days: currentStreak,
    topics_proficient_or_mastered: (newMastery ?? []).length,
  }]

  // Per-session rows
  const sessionRows = sessionList.map((s) => ({
    report_section: 'quiz_detail',
    student_id: studentId,
    session_id: s.id,
    subject: s.subject,
    score_pct: s.score_percent,
    xp_earned: s.xp_earned,
    time_minutes: Math.round((s.time_taken_seconds ?? 0) / 60),
    completed_at: s.created_at,
  }))

  // Mastery gains rows
  const masteryRows = ((newMastery ?? []) as Record<string, unknown>[]).map((m) => {
    const topic = m.curriculum_topics as Record<string, unknown> | null
    const subject = topic?.subjects as Record<string, unknown> | null
    return {
      report_section: 'mastery_gain',
      student_id: studentId,
      topic_id: m.topic_id,
      topic_title: topic?.title ?? null,
      subject_name: subject?.name ?? null,
      mastery_pct: Math.round(((m.mastery_level as number) ?? 0) * 100),
      updated_at: m.updated_at,
    }
  })

  return [...summary, ...sessionRows, ...masteryRows]
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    // ── Authenticate caller ─────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Missing or invalid Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Client with caller's JWT for auth.uid() checks
    const callerSupabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        auth: { persistSession: false },
        global: { headers: { Authorization: authHeader } },
      },
    )

    const {
      data: { user },
      error: userError,
    } = await callerSupabase.auth.getUser()

    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Service-role client for internal DB queries
    const adminSupabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } },
    )

    // Resolve the caller's role
    const callerRole = await resolveCallerRole(adminSupabase, user.id)
    if (!callerRole) {
      return new Response(JSON.stringify({ error: 'User profile not found' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Parse & validate request body ──────────────────────────────────────
    let body: RequestBody
    try {
      body = await req.json()
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { report_type, scope_id, format = 'json' } = body

    const validReportTypes: ReportType[] = ['class_performance', 'student_hpc', 'parent_weekly']
    if (!validReportTypes.includes(report_type)) {
      return new Response(
        JSON.stringify({
          error: `Invalid report_type. Must be one of: ${validReportTypes.join(', ')}`,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (!scope_id) {
      return new Response(JSON.stringify({ error: 'scope_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!['json', 'csv'].includes(format)) {
      return new Response(JSON.stringify({ error: 'format must be "json" or "csv"' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Permission enforcement ──────────────────────────────────────────────
    try {
      if (report_type === 'class_performance') {
        if (callerRole.role !== 'teacher') {
          throw new Error('Forbidden: only teachers can access class performance reports')
        }
        await assertTeacherOwnsClass(adminSupabase, callerRole.internal_id, scope_id)
      } else if (report_type === 'student_hpc') {
        await assertStudentOrGuardian(adminSupabase, callerRole, scope_id)
      } else if (report_type === 'parent_weekly') {
        if (callerRole.role !== 'guardian') {
          // Allow students to view their own weekly
          if (!(callerRole.role === 'student' && callerRole.internal_id === scope_id)) {
            throw new Error('Forbidden: only guardians or the student can access parent_weekly reports')
          }
        } else {
          await assertGuardianLinkedToStudent(adminSupabase, callerRole.internal_id, scope_id)
        }
      }
    } catch (permErr) {
      const msg = permErr instanceof Error ? permErr.message : String(permErr)
      return new Response(JSON.stringify({ error: msg }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Generate report ─────────────────────────────────────────────────────
    let rows: Record<string, unknown>[]

    switch (report_type) {
      case 'class_performance':
        rows = await generateClassPerformanceReport(adminSupabase, scope_id)
        break
      case 'student_hpc':
        rows = await generateStudentHpcReport(adminSupabase, scope_id)
        break
      case 'parent_weekly':
        rows = await generateParentWeeklyReport(adminSupabase, scope_id)
        break
    }

    // ── Serialise and return ────────────────────────────────────────────────
    if (format === 'csv') {
      const csv = toCSV(rows)
      return new Response(csv, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${report_type}_${scope_id}.csv"`,
        },
      })
    }

    return new Response(
      JSON.stringify({
        report_type,
        scope_id,
        generated_at: new Date().toISOString(),
        total_rows: rows.length,
        data: rows,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('export-report error:', message)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
