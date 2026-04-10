/**
 * nep-compliance – Alfanumrik Edge Function
 *
 * Generates and retrieves NEP 2020 Holistic Progress Cards (HPC) for students.
 * Maps student mastery data across subjects to NEP competency frameworks.
 *
 * POST body:
 * {
 *   action: 'generate_hpc' | 'get_hpc'
 *   student_id: string
 * }
 *
 * Auth: apikey header (Supabase anon key) required.
 * Service role used internally for cross-table queries.
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

// ─── Types ────────────────────────────────────────────────────────────────────

interface RequestBody {
  action: 'generate_hpc' | 'get_hpc'
  student_id: string
}

interface SubjectPerformance {
  avg_mastery_pct: number
  concepts_attempted: number
  concepts_total: number
  chapters_covered: number
  chapters_total: number
}

interface BloomDistribution {
  remember: number
  understand: number
  apply: number
  analyze: number
  evaluate: number
  create: number
  total: number
}

interface HPCReport {
  student: { name: string; grade: string; board: string }
  academic_year: string
  term: string
  class_percentile: number
  bloom_distribution: BloomDistribution
  competency_levels: Record<string, { overall_level: string }>
  subject_performance: Record<string, SubjectPerformance>
  learning_behaviors: {
    consistency: number | null
    curiosity: number | null
    self_regulation: number | null
    collaboration: number | null
  }
  holistic_indicators: {
    total_sessions: number
    active_days: number
    streak_best: number
    notes_created: number
    xp_total: number
    study_regularity_pct: number
  }
  cbse_readiness: Record<string, Record<string, { section: string; marks: string; readiness_pct: number | null }>>
  portfolio_highlights: Array<{ type: string; description: string; date: string }>
  generated_at: string
}

// ─── NEP Competency Mapping ──────────────────────────────────────────────────

/**
 * Map average mastery percentage to NEP competency level.
 * NEP 2020 competency levels: beginning, developing, proficient, advanced
 */
function masteryToCompetencyLevel(avgMasteryPct: number): string {
  if (avgMasteryPct >= 85) return 'advanced'
  if (avgMasteryPct >= 65) return 'proficient'
  if (avgMasteryPct >= 40) return 'developing'
  return 'beginning'
}

/**
 * Derive a 1-5 behavior rating from raw metrics.
 */
function computeBehaviorRating(value: number, max: number): number | null {
  if (max <= 0) return null
  const ratio = Math.min(value / max, 1)
  return Math.max(1, Math.ceil(ratio * 5))
}

/**
 * Compute academic year string from current date.
 */
function getAcademicYear(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  // Indian academic year: April to March
  if (month >= 4) return `${year}-${year + 1}`
  return `${year - 1}-${year}`
}

/**
 * Compute current term based on month.
 */
function getCurrentTerm(): string {
  const month = new Date().getMonth() + 1
  // Term 1: April-September, Term 2: October-March
  return month >= 4 && month <= 9 ? 'Term 1' : 'Term 2'
}

// ─── CBSE Board Exam Structure ───────────────────────────────────────────────

// TODO: Move to a shared config or DB table when full CBSE integration is built
const CBSE_EXAM_SECTIONS: Record<string, Array<{ section: string; marks: string }>> = {
  mathematics: [
    { section: 'Section A – MCQs', marks: '20' },
    { section: 'Section B – Short Answer I', marks: '10' },
    { section: 'Section C – Short Answer II', marks: '18' },
    { section: 'Section D – Long Answer', marks: '20' },
    { section: 'Section E – Case-based', marks: '12' },
  ],
  science: [
    { section: 'Section A – MCQs', marks: '20' },
    { section: 'Section B – Short Answer I', marks: '10' },
    { section: 'Section C – Short Answer II', marks: '18' },
    { section: 'Section D – Long Answer', marks: '20' },
    { section: 'Section E – Case-based', marks: '12' },
  ],
}

// ─── HPC Generator ──────────────────────────────────────────────────────────

async function generateHPC(
  supabase: SupabaseClient,
  studentId: string,
): Promise<HPCReport> {
  // 1. Fetch student info
  const { data: student, error: studentError } = await supabase
    .from('students')
    .select('id, name, grade')
    .eq('id', studentId)
    .maybeSingle()

  if (studentError) throw new Error(`Failed to fetch student: ${studentError.message}`)
  if (!student) throw new Error(`Student ${studentId} not found`)

  const studentRecord = student as { id: string; name: string; grade: string }

  // 2. Fetch learning profiles across all subjects
  const { data: profiles } = await supabase
    .from('student_learning_profiles')
    .select('subject, xp_total, streak_days, total_questions_asked, total_questions_answered_correctly')
    .eq('student_id', studentId)

  const profileList = (profiles ?? []) as Array<{
    subject: string
    xp_total: number
    streak_days: number
    total_questions_asked: number
    total_questions_answered_correctly: number
  }>

  // 3. Fetch concept mastery data
  const { data: masteryRows } = await supabase
    .from('concept_mastery')
    .select(`
      topic_id,
      mastery_level,
      total_attempts,
      correct_attempts,
      curriculum_topics(title, chapter_number, subject_id, subjects(name, code))
    `)
    .eq('student_id', studentId)

  const masteryList = (masteryRows ?? []) as Array<{
    topic_id: string
    mastery_level: number
    total_attempts: number
    correct_attempts: number
    curriculum_topics: {
      title: string
      chapter_number: number
      subject_id: string
      subjects: { name: string; code: string } | null
    } | null
  }>

  // 4. Fetch quiz sessions for Bloom's distribution and session counts
  const { data: quizSessions } = await supabase
    .from('quiz_sessions')
    .select('id, subject, score_percent, xp_earned, bloom_level, created_at')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })

  const sessionList = (quizSessions ?? []) as Array<{
    id: string
    subject: string
    score_percent: number
    xp_earned: number
    bloom_level: string | null
    created_at: string
  }>

  // 5. Build Bloom's distribution from quiz sessions
  const bloomDist: BloomDistribution = {
    remember: 0,
    understand: 0,
    apply: 0,
    analyze: 0,
    evaluate: 0,
    create: 0,
    total: 0,
  }
  for (const session of sessionList) {
    const level = (session.bloom_level ?? 'remember').toLowerCase() as keyof Omit<BloomDistribution, 'total'>
    if (level in bloomDist && level !== 'total') {
      bloomDist[level]++
      bloomDist.total++
    }
  }

  // 6. Build subject performance map
  const subjectPerformance: Record<string, SubjectPerformance> = {}

  // Group mastery by subject
  const masteryBySubject = new Map<string, typeof masteryList>()
  for (const m of masteryList) {
    const subjectName = m.curriculum_topics?.subjects?.name?.toLowerCase() ?? 'unknown'
    const arr = masteryBySubject.get(subjectName) ?? []
    arr.push(m)
    masteryBySubject.set(subjectName, arr)
  }

  // Get total concepts and chapters per subject for the student's grade
  // TODO: Query curriculum_topics table with proper grade filter when available
  for (const [subject, masteries] of masteryBySubject) {
    const avgMastery = masteries.length > 0
      ? Math.round(
          (masteries.reduce((sum, m) => sum + (m.mastery_level ?? 0), 0) / masteries.length) * 100,
        )
      : 0

    // Count unique chapters covered
    const chapterNumbers = new Set(
      masteries
        .filter((m) => m.curriculum_topics?.chapter_number != null)
        .map((m) => m.curriculum_topics!.chapter_number),
    )

    // TODO: Fetch actual total concepts and chapters from curriculum_topics table
    // For now, estimate totals based on available data
    const estimatedTotalConcepts = Math.max(masteries.length, 20)
    const estimatedTotalChapters = Math.max(chapterNumbers.size, 10)

    subjectPerformance[subject] = {
      avg_mastery_pct: avgMastery,
      concepts_attempted: masteries.length,
      concepts_total: estimatedTotalConcepts,
      chapters_covered: chapterNumbers.size,
      chapters_total: estimatedTotalChapters,
    }
  }

  // 7. Build competency levels per subject (NEP 2020 mapping)
  const competencyLevels: Record<string, { overall_level: string }> = {}
  for (const [subject, perf] of Object.entries(subjectPerformance)) {
    competencyLevels[subject] = {
      overall_level: masteryToCompetencyLevel(perf.avg_mastery_pct),
    }
  }

  // 8. Compute learning behaviors (NCF 2023)
  const totalXp = profileList.reduce((s, p) => s + (p.xp_total ?? 0), 0)
  const maxStreak = Math.max(0, ...profileList.map((p) => p.streak_days ?? 0))
  const totalQuestionsAsked = profileList.reduce((s, p) => s + (p.total_questions_asked ?? 0), 0)

  // Compute unique active days from quiz sessions
  const activeDaySet = new Set(
    sessionList.map((s) => s.created_at?.substring(0, 10)),
  )
  const activeDays = activeDaySet.size

  // Consistency: based on streak relative to 30-day benchmark
  const consistencyRating = computeBehaviorRating(maxStreak, 30)
  // Curiosity: based on total questions asked relative to 500 benchmark
  const curiosityRating = computeBehaviorRating(totalQuestionsAsked, 500)
  // Self-regulation: based on active days relative to 90-day benchmark
  const selfRegulationRating = computeBehaviorRating(activeDays, 90)
  // Collaboration: TODO: integrate with collaboration features when available
  const collaborationRating: number | null = null

  // 9. Compute holistic indicators
  const studyRegularityPct = sessionList.length > 0
    ? Math.min(100, Math.round((activeDays / 30) * 100))
    : 0

  const holisticIndicators = {
    total_sessions: sessionList.length,
    active_days: activeDays,
    streak_best: maxStreak,
    notes_created: 0, // TODO: Query notes table when note-taking feature is built
    xp_total: totalXp,
    study_regularity_pct: studyRegularityPct,
  }

  // 10. CBSE board exam readiness estimation
  const cbseReadiness: Record<string, Record<string, { section: string; marks: string; readiness_pct: number | null }>> = {}
  for (const [subject, perf] of Object.entries(subjectPerformance)) {
    const sections = CBSE_EXAM_SECTIONS[subject]
    if (!sections) continue

    const subjectReadiness: Record<string, { section: string; marks: string; readiness_pct: number | null }> = {}
    for (let i = 0; i < sections.length; i++) {
      const sec = sections[i]
      // Estimate readiness based on mastery and Bloom's level alignment
      // MCQs map to remember/understand, case-based maps to analyze/evaluate
      let readinessPct: number | null = null
      if (perf.concepts_attempted > 0) {
        // Base readiness on overall mastery, adjusted by section type
        const basePct = perf.avg_mastery_pct
        if (sec.section.includes('MCQ')) {
          readinessPct = Math.min(100, Math.round(basePct * 1.1))
        } else if (sec.section.includes('Case-based')) {
          readinessPct = Math.round(basePct * 0.75)
        } else if (sec.section.includes('Long Answer')) {
          readinessPct = Math.round(basePct * 0.8)
        } else {
          readinessPct = basePct
        }
      }
      subjectReadiness[`section_${i}`] = {
        section: sec.section,
        marks: sec.marks,
        readiness_pct: readinessPct,
      }
    }
    cbseReadiness[subject] = subjectReadiness
  }

  // 11. Build portfolio highlights from mastery milestones
  const portfolioHighlights: Array<{ type: string; description: string; date: string }> = []

  // Mastery milestones (topics with mastery >= 0.9)
  const masteredTopics = masteryList
    .filter((m) => m.mastery_level >= 0.9 && m.curriculum_topics?.title)
    .sort((a, b) => b.mastery_level - a.mastery_level)
    .slice(0, 5)

  for (const m of masteredTopics) {
    portfolioHighlights.push({
      type: 'mastery',
      description: `Mastered "${m.curriculum_topics!.title}" (${Math.round(m.mastery_level * 100)}%)`,
      date: new Date().toISOString().substring(0, 10), // TODO: Use actual mastery date from updated_at
    })
  }

  // High-score quiz sessions (score >= 90%)
  const highScoreSessions = sessionList
    .filter((s) => s.score_percent >= 90)
    .slice(0, 3)

  for (const s of highScoreSessions) {
    portfolioHighlights.push({
      type: 'achievement',
      description: `Scored ${s.score_percent}% in ${s.subject} quiz`,
      date: s.created_at?.substring(0, 10) ?? '',
    })
  }

  // XP milestone
  if (totalXp >= 1000) {
    portfolioHighlights.push({
      type: 'achievement',
      description: `Earned ${totalXp} total XP across all subjects`,
      date: new Date().toISOString().substring(0, 10),
    })
  }

  // 12. Compute class percentile (approximate)
  // TODO: Compare against actual classmates when class enrollment data is available
  // For now, derive from overall mastery across subjects
  const overallMasteryValues = Object.values(subjectPerformance).map((p) => p.avg_mastery_pct)
  const overallAvgMastery = overallMasteryValues.length > 0
    ? Math.round(overallMasteryValues.reduce((s, v) => s + v, 0) / overallMasteryValues.length)
    : 50
  // Map mastery to a percentile estimate (simple linear mapping)
  const classPercentile = Math.min(99, Math.max(1, overallAvgMastery))

  return {
    student: {
      name: studentRecord.name ?? 'Student',
      grade: studentRecord.grade ?? '',
      board: 'CBSE',
    },
    academic_year: getAcademicYear(),
    term: getCurrentTerm(),
    class_percentile: classPercentile,
    bloom_distribution: bloomDist,
    competency_levels: competencyLevels,
    subject_performance: subjectPerformance,
    learning_behaviors: {
      consistency: consistencyRating,
      curiosity: curiosityRating,
      self_regulation: selfRegulationRating,
      collaboration: collaborationRating,
    },
    holistic_indicators: holisticIndicators,
    cbse_readiness: cbseReadiness,
    portfolio_highlights: portfolioHighlights,
    generated_at: new Date().toISOString(),
  }
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
    // ── Validate apikey header ──────────────────────────────────────────────
    const apikey = req.headers.get('apikey')
    if (!apikey) {
      return new Response(JSON.stringify({ error: 'Missing apikey header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Parse request body ──────────────────────────────────────────────────
    let body: RequestBody
    try {
      body = await req.json()
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { action, student_id } = body

    if (!action || !['generate_hpc', 'get_hpc'].includes(action)) {
      return new Response(
        JSON.stringify({ error: 'Invalid action. Must be "generate_hpc" or "get_hpc"' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (!student_id) {
      return new Response(JSON.stringify({ error: 'student_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Service-role client for internal queries ────────────────────────────
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } },
    )

    // ── Verify student exists ───────────────────────────────────────────────
    const { data: studentCheck, error: checkError } = await supabase
      .from('students')
      .select('id')
      .eq('id', student_id)
      .maybeSingle()

    if (checkError || !studentCheck) {
      return new Response(JSON.stringify({ error: 'Student not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Handle actions ──────────────────────────────────────────────────────
    if (action === 'generate_hpc') {
      // Generate the HPC report to validate data availability.
      // In a production system, this would persist the report to a table.
      // TODO: Store generated HPC in a nep_hpc_reports table for caching
      await generateHPC(supabase, student_id)

      return new Response(JSON.stringify({ success: true, generated: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'get_hpc') {
      // Generate on-the-fly since we don't have a persistence table yet
      // TODO: Read from nep_hpc_reports table when it exists, fall back to generation
      const report = await generateHPC(supabase, student_id)

      return new Response(JSON.stringify(report), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Should not reach here due to validation above
    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('nep-compliance error:', message)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
