/**
 * parent-report-generator — Supabase Edge Function
 *
 * Generates AI-powered weekly learning reports for parents.
 * Uses Claude Haiku for cost-efficient, parent-friendly report generation.
 * Falls back to template-based reports if AI is unavailable.
 *
 * POST body:
 * {
 *   student_id: string   — student UUID
 *   parent_id:  string   — guardian UUID
 *   language:   "en" | "hi"
 * }
 *
 * Response:
 * {
 *   report: {
 *     period: string,
 *     highlights: string[],
 *     concerns: string[],
 *     suggestion: string,
 *     stats: { quizzes_completed, avg_score, xp_earned, time_spent_minutes, topics_mastered, streak }
 *   },
 *   generated_at: string
 * }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts'

// ─── Environment ────────────────────────────────────────────────
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

// ─── Circuit breaker for Claude API ─────────────────────────────
const circuitBreaker = {
  failures: 0,
  lastFailureAt: 0,
  state: 'closed' as 'closed' | 'open' | 'half-open',
  FAILURE_THRESHOLD: 5,
  RESET_TIMEOUT: 60_000,

  canRequest(): boolean {
    if (this.state === 'closed') return true
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureAt > this.RESET_TIMEOUT) {
        this.state = 'half-open'
        return true
      }
      return false
    }
    return false
  },

  recordSuccess(): void {
    this.failures = 0
    this.state = 'closed'
  },

  recordFailure(): void {
    this.failures++
    this.lastFailureAt = Date.now()
    if (this.failures >= this.FAILURE_THRESHOLD) {
      this.state = 'open'
    }
  },
}

// ─── Rate limiter: 1 report per student per day ─────────────────
const reportRateMap = new Map<string, number>()

function checkDailyRateLimit(studentId: string): boolean {
  const today = new Date().toISOString().slice(0, 10)
  const key = `${studentId}:${today}`
  if (reportRateMap.has(key)) return false
  // Evict old entries
  if (reportRateMap.size > 2000) {
    const todayPrefix = today
    for (const [k] of reportRateMap) {
      if (!k.endsWith(todayPrefix)) reportRateMap.delete(k)
    }
  }
  reportRateMap.set(key, Date.now())
  return true
}

// ─── Interfaces ─────────────────────────────────────────────────

interface WeeklyStats {
  quizzes_completed: number
  avg_score: number
  xp_earned: number
  time_spent_minutes: number
  topics_mastered: number
  streak: number
  xp_last_week: number
  avg_score_last_week: number
  subjects: string[]
  top_error_type: string | null
  mastery_gained: string[]
  mastery_lost: string[]
}

interface WeeklyReport {
  period: string
  highlights: string[]
  concerns: string[]
  suggestion: string
  stats: {
    quizzes_completed: number
    avg_score: number
    xp_earned: number
    time_spent_minutes: number
    topics_mastered: number
    streak: number
  }
}

// ─── Data fetching ──────────────────────────────────────────────

function getServiceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function verifyParentStudentLink(
  supabase: ReturnType<typeof getServiceClient>,
  parentId: string,
  studentId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('guardian_student_links')
    .select('id')
    .eq('guardian_id', parentId)
    .eq('student_id', studentId)
    .in('status', ['active', 'approved'])
    .limit(1)
    .maybeSingle()

  return !error && !!data
}

async function fetchWeeklyStats(
  supabase: ReturnType<typeof getServiceClient>,
  studentId: string,
): Promise<WeeklyStats> {
  const now = new Date()
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
  const weekAgoISO = weekAgo.toISOString()
  const twoWeeksAgoISO = twoWeeksAgo.toISOString()

  // Fetch all data in parallel
  const [
    thisWeekQuizzes,
    lastWeekQuizzes,
    studentData,
    masteryChanges,
  ] = await Promise.all([
    // This week's quiz sessions
    supabase
      .from('quiz_sessions')
      .select('id, subject, score_percent, time_taken_seconds, correct_answers, total_questions, completed_at')
      .eq('student_id', studentId)
      .gte('completed_at', weekAgoISO)
      .order('completed_at', { ascending: false }),

    // Last week's quiz sessions (for trend comparison)
    supabase
      .from('quiz_sessions')
      .select('id, score_percent, time_taken_seconds')
      .eq('student_id', studentId)
      .gte('completed_at', twoWeeksAgoISO)
      .lt('completed_at', weekAgoISO),

    // Student profile for XP and streak
    supabase
      .from('students')
      .select('name, xp_total, streak_days')
      .eq('id', studentId)
      .single(),

    // Concept mastery for topics gained/lost
    supabase
      .from('concept_mastery')
      .select('topic_id, mastery_level, updated_at, topics(title)')
      .eq('student_id', studentId)
      .gte('updated_at', weekAgoISO)
      .order('updated_at', { ascending: false })
      .limit(50),
  ])

  const quizzes = thisWeekQuizzes.data || []
  const prevQuizzes = lastWeekQuizzes.data || []

  // Calculate stats
  const quizzesCompleted = quizzes.length
  const avgScore = quizzesCompleted > 0
    ? Math.round(quizzes.reduce((sum, q) => sum + (q.score_percent || 0), 0) / quizzesCompleted)
    : 0
  const avgScoreLastWeek = prevQuizzes.length > 0
    ? Math.round(prevQuizzes.reduce((sum, q) => sum + (q.score_percent || 0), 0) / prevQuizzes.length)
    : 0

  const totalSeconds = quizzes.reduce((sum, q) => sum + (q.time_taken_seconds || 0), 0)
  const timeSpentMinutes = Math.round(totalSeconds / 60)

  // Subjects studied this week
  const subjectSet = new Set<string>()
  quizzes.forEach(q => { if (q.subject) subjectSet.add(q.subject) })

  // XP earned this week (approximate from quiz scores)
  // We use a rough estimate since exact XP tracking per-week requires xp_history table
  const xpEarned = quizzes.reduce((sum, q) => {
    let xp = (q.correct_answers || 0) * 10
    if ((q.score_percent || 0) >= 80) xp += 25
    if ((q.score_percent || 0) === 100) xp += 50
    return sum + xp
  }, 0)

  // XP from last week
  const xpLastWeek = prevQuizzes.reduce((sum, q) => {
    // Rough estimate since we don't have correct_answers for prev week
    return sum + ((q.score_percent || 0) > 0 ? 30 : 0)
  }, 0)

  // Mastery changes
  const masteryData = masteryChanges.data || []
  const masteryGained: string[] = []
  const masteryLost: string[] = []
  for (const m of masteryData) {
    const topicTitle = (m.topics as unknown as { title: string } | null)?.title || 'Unknown topic'
    if ((m.mastery_level || 0) >= 80) {
      masteryGained.push(topicTitle)
    } else if ((m.mastery_level || 0) < 40) {
      masteryLost.push(topicTitle)
    }
  }

  // Error pattern detection (simplified: check for low-scoring subjects)
  let topErrorType: string | null = null
  const subjectScores: Record<string, { total: number; count: number }> = {}
  quizzes.forEach(q => {
    if (!q.subject) return
    if (!subjectScores[q.subject]) subjectScores[q.subject] = { total: 0, count: 0 }
    subjectScores[q.subject].total += q.score_percent || 0
    subjectScores[q.subject].count++
  })
  let lowestAvg = 100
  for (const [subject, data] of Object.entries(subjectScores)) {
    const avg = data.total / data.count
    if (avg < lowestAvg && avg < 50) {
      lowestAvg = avg
      topErrorType = `Low performance in ${subject} (${Math.round(avg)}% avg)`
    }
  }

  return {
    quizzes_completed: quizzesCompleted,
    avg_score: avgScore,
    xp_earned: xpEarned,
    time_spent_minutes: timeSpentMinutes,
    topics_mastered: masteryGained.length,
    streak: studentData.data?.streak_days || 0,
    xp_last_week: xpLastWeek,
    avg_score_last_week: avgScoreLastWeek,
    subjects: Array.from(subjectSet),
    top_error_type: topErrorType,
    mastery_gained: masteryGained.slice(0, 5),
    mastery_lost: masteryLost.slice(0, 5),
  }
}

// ─── Report period formatting ───────────────────────────────────

function formatPeriod(language: string): string {
  const now = new Date()
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  if (language === 'hi') {
    const months: Record<number, string> = {
      0: 'जनवरी', 1: 'फरवरी', 2: 'मार्च', 3: 'अप्रैल',
      4: 'मई', 5: 'जून', 6: 'जुलाई', 7: 'अगस्त',
      8: 'सितंबर', 9: 'अक्टूबर', 10: 'नवंबर', 11: 'दिसंबर',
    }
    return `${weekAgo.getDate()} ${months[weekAgo.getMonth()]} - ${now.getDate()} ${months[now.getMonth()]}, ${now.getFullYear()}`
  }

  const opts: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric' }
  const start = weekAgo.toLocaleDateString('en-US', opts)
  const end = now.toLocaleDateString('en-US', opts)
  return `${start} - ${end}, ${now.getFullYear()}`
}

// ─── Template fallback (no AI) ──────────────────────────────────

function buildFallbackReport(stats: WeeklyStats, language: string, studentName: string): WeeklyReport {
  const isHi = language === 'hi'
  const period = formatPeriod(language)
  const highlights: string[] = []
  const concerns: string[] = []

  if (stats.quizzes_completed > 0) {
    highlights.push(
      isHi
        ? `${studentName} ने इस सप्ताह ${stats.quizzes_completed} क्विज़ पूरी की`
        : `${studentName} completed ${stats.quizzes_completed} quizzes this week`
    )
  }

  if (stats.streak >= 3) {
    highlights.push(
      isHi
        ? `${stats.streak} दिनों की लगातार स्ट्रीक बनाए रखी!`
        : `Maintained a ${stats.streak}-day learning streak!`
    )
  }

  if (stats.topics_mastered > 0) {
    highlights.push(
      isHi
        ? `${stats.topics_mastered} नए विषय पर महारत हासिल की`
        : `Mastered ${stats.topics_mastered} new topic${stats.topics_mastered > 1 ? 's' : ''}`
    )
  }

  if (stats.avg_score >= 80) {
    highlights.push(
      isHi
        ? `${stats.avg_score}% औसत स्कोर - बहुत अच्छा!`
        : `${stats.avg_score}% average score - excellent!`
    )
  }

  if (stats.avg_score > 0 && stats.avg_score < 50) {
    concerns.push(
      isHi
        ? `औसत स्कोर ${stats.avg_score}% - अधिक अभ्यास की जरूरत`
        : `Average score is ${stats.avg_score}% - needs more practice`
    )
  }

  if (stats.top_error_type) {
    concerns.push(
      isHi
        ? `कमजोर क्षेत्र: ${stats.top_error_type}`
        : stats.top_error_type
    )
  }

  if (stats.quizzes_completed === 0) {
    concerns.push(
      isHi
        ? `इस सप्ताह कोई क्विज़ नहीं दी गई`
        : `No quizzes attempted this week`
    )
  }

  // Ensure at least one highlight
  if (highlights.length === 0) {
    highlights.push(
      isHi
        ? `${studentName} ने Alfanumrik पर पढ़ाई जारी रखी`
        : `${studentName} continued learning on Alfanumrik`
    )
  }

  const suggestion = stats.quizzes_completed === 0
    ? (isHi
        ? 'अपने बच्चे को रोज़ 10-15 मिनट Alfanumrik पर अभ्यास करने के लिए प्रोत्साहित करें'
        : 'Encourage your child to practice on Alfanumrik for 10-15 minutes daily')
    : stats.avg_score < 60
      ? (isHi
          ? 'कमजोर विषयों पर Foxy AI ट्यूटर से मदद लेने के लिए कहें'
          : 'Suggest using Foxy AI tutor for help with weaker topics')
      : (isHi
          ? 'शानदार प्रगति! बच्चे की मेहनत की सराहना करें'
          : 'Great progress! Appreciate your child\'s effort and consistency')

  return {
    period,
    highlights: highlights.slice(0, 4),
    concerns: concerns.slice(0, 2),
    suggestion,
    stats: {
      quizzes_completed: stats.quizzes_completed,
      avg_score: stats.avg_score,
      xp_earned: stats.xp_earned,
      time_spent_minutes: stats.time_spent_minutes,
      topics_mastered: stats.topics_mastered,
      streak: stats.streak,
    },
  }
}

// ─── AI report generation ───────────────────────────────────────

async function generateAIReport(
  stats: WeeklyStats,
  language: string,
  studentName: string,
): Promise<WeeklyReport | null> {
  if (!ANTHROPIC_API_KEY) return null
  if (!circuitBreaker.canRequest()) return null

  const period = formatPeriod(language)
  const lang = language === 'hi' ? 'Hindi (Devanagari script)' : 'English'

  const prompt = `You are generating a weekly learning report for a parent about their child's progress on an educational app.

STUDENT NAME: ${studentName}
REPORTING PERIOD: ${period}
LANGUAGE: Respond ONLY in ${lang}.

THIS WEEK'S DATA:
- Quizzes completed: ${stats.quizzes_completed}
- Average score: ${stats.avg_score}% (last week: ${stats.avg_score_last_week}%)
- XP earned: ${stats.xp_earned} (last week: ${stats.xp_last_week})
- Time spent: ${stats.time_spent_minutes} minutes
- Subjects studied: ${stats.subjects.join(', ') || 'none'}
- Learning streak: ${stats.streak} days
- Topics mastered this week: ${stats.mastery_gained.join(', ') || 'none'}
- Topics needing attention: ${stats.mastery_lost.join(', ') || 'none'}
- Weak area: ${stats.top_error_type || 'none identified'}

INSTRUCTIONS:
1. Generate 3-4 highlights (positive observations, achievements, improvements)
2. Generate 1-2 concerns (if any; skip if everything is good)
3. Generate 1 actionable suggestion for the parent (specific, practical)
4. Tone: warm, encouraging, no educational jargon
5. Keep each point to 1 sentence
6. If the child had no activity, be gentle and encouraging, not critical

Return ONLY valid JSON with this exact structure:
{
  "highlights": ["string", "string", "string"],
  "concerns": ["string"],
  "suggestion": "string"
}`

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15_000)

    // eslint-disable-next-line alfanumrik/no-direct-ai-calls -- TODO(phase-4-cleanup): parent-report-generator is analytics narrative generation, not student-facing; exempt from grounded-answer routing.
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!res.ok) {
      circuitBreaker.recordFailure()
      return null
    }

    circuitBreaker.recordSuccess()

    const data = await res.json()
    const text = data.content?.[0]?.text || ''

    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    const parsed = JSON.parse(jsonMatch[0])

    // Validate structure
    if (!Array.isArray(parsed.highlights) || typeof parsed.suggestion !== 'string') {
      return null
    }

    return {
      period,
      highlights: parsed.highlights.slice(0, 4),
      concerns: Array.isArray(parsed.concerns) ? parsed.concerns.slice(0, 2) : [],
      suggestion: parsed.suggestion,
      stats: {
        quizzes_completed: stats.quizzes_completed,
        avg_score: stats.avg_score,
        xp_earned: stats.xp_earned,
        time_spent_minutes: stats.time_spent_minutes,
        topics_mastered: stats.topics_mastered,
        streak: stats.streak,
      },
    }
  } catch (err) {
    circuitBreaker.recordFailure()
    console.error('AI report generation failed:', err instanceof Error ? err.message : String(err))
    return null
  }
}

// ─── Main handler ──────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  const cors = getCorsHeaders(origin)

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405, origin)
  }

  try {
    const body = await req.json()
    const { student_id, parent_id, language = 'en' } = body

    // ── Input validation ──
    if (!student_id || typeof student_id !== 'string') {
      return errorResponse('student_id is required', 400, origin)
    }
    if (!parent_id || typeof parent_id !== 'string') {
      return errorResponse('parent_id is required', 400, origin)
    }
    const safeLanguage = ['en', 'hi'].includes(language) ? language : 'en'

    // ── Rate limit: 1 report per student per day ──
    if (!checkDailyRateLimit(student_id)) {
      return errorResponse('Report already generated today. Try again tomorrow.', 429, origin)
    }

    const supabase = getServiceClient()

    // ── Verify parent-student link (P11: no unverified access) ──
    const isLinked = await verifyParentStudentLink(supabase, parent_id, student_id)
    if (!isLinked) {
      return errorResponse('Parent is not linked to this student', 403, origin)
    }

    // ── Fetch student name (no PII in logs per P13) ──
    const { data: studentProfile } = await supabase
      .from('students')
      .select('name')
      .eq('id', student_id)
      .single()

    const studentName = studentProfile?.name || 'Your child'

    // ── Fetch weekly stats ──
    const stats = await fetchWeeklyStats(supabase, student_id)

    // ── Generate report (AI with fallback) ──
    let report = await generateAIReport(stats, safeLanguage, studentName)

    if (!report) {
      // Fallback: template-based report without AI
      report = buildFallbackReport(stats, safeLanguage, studentName)
    }

    return jsonResponse(
      {
        report,
        generated_at: new Date().toISOString(),
      },
      200,
      {},
      origin,
    )
  } catch (err) {
    console.error('parent-report-generator error:', err instanceof Error ? err.message : String(err))
    return errorResponse('Internal server error', 500, origin)
  }
})
