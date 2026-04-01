/**
 * quiz-generator – Alfanumrik Edge Function
 *
 * AI-enhanced adaptive quiz question selection.
 *
 * POST body:
 * {
 *   student_id: string        – UUID of the student
 *   subject:    string        – subject code, e.g. "math"
 *   grade:      string        – e.g. "9"
 *   count?:     number        – number of questions (default 10, max 30)
 *   difficulty?: number|null  – 1 | 2 | 3 | null (null = adaptive)
 * }
 *
 * Response:
 * {
 *   questions: Question[]
 *   meta: {
 *     strategy: 'adaptive' | 'random'
 *     weak_topics_targeted: number
 *     total_returned: number
 *   }
 * }
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, getCorsHeaders } from '../_shared/cors.ts'

// ─── In-memory rate limiter (first line of defence) ─────────────────────────
// NOTE: This Map is per-isolate and will reset on cold starts. It provides fast
// rejection but cannot enforce limits across multiple Edge Function instances.
// The DB-based check below (`checkRateLimitDb`) acts as the authoritative,
// cross-instance rate limiter.
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_WINDOW_MS = 60_000 // 1 minute
const RATE_LIMIT_MAX = 20 // max 20 quiz generations per minute per student

function checkRateLimitMemory(studentId: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(studentId)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(studentId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }
  if (entry.count >= RATE_LIMIT_MAX) return false
  entry.count++
  return true
}

// Periodically clean up stale rate limit entries
setInterval(() => {
  const now = Date.now()
  for (const [key, val] of rateLimitMap) {
    if (now > val.resetAt) rateLimitMap.delete(key)
  }
}, 120_000)

// ─── DB-backed rate limiter (cross-instance, authoritative) ─────────────────
// Counts recent quiz_sessions for the student to enforce a hard cap that
// survives cold starts and works across all Edge Function instances.
const DB_RATE_LIMIT_WINDOW_MS = 60_000 // 1 minute
const DB_RATE_LIMIT_MAX = 20

async function checkRateLimitDb(studentId: string, supabase: SupabaseClient): Promise<boolean> {
  const windowStart = new Date(Date.now() - DB_RATE_LIMIT_WINDOW_MS).toISOString()
  const { count, error } = await supabase
    .from('quiz_sessions')
    .select('*', { count: 'exact', head: true })
    .eq('student_id', studentId)
    .gte('created_at', windowStart)

  if (error) {
    // If the DB check fails, fall through and rely on the in-memory limiter
    console.warn('checkRateLimitDb error, allowing request:', error.message)
    return true
  }

  return (count ?? 0) < DB_RATE_LIMIT_MAX
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface RequestBody {
  student_id: string
  subject: string
  grade: string
  count?: number
  difficulty?: number | null
}

interface ConceptMasteryRow {
  topic_id: string
  mastery_level: number
  next_review_at: string | null
}

interface QuestionRow {
  id: string
  question_text: string
  question_hi: string | null
  question_type: string
  options: string | string[]
  correct_answer_index: number
  explanation: string | null
  explanation_hi: string | null
  hint: string | null
  difficulty: number
  bloom_level: string
  chapter_number: number
  topic_id: string | null
  subject_id: string | null
}

interface SubjectRow {
  id: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Shuffle an array in place (Fisher-Yates). */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/**
 * Map a mastery_level [0, 1] to a target difficulty bucket.
 *   < 0.3  => easy   (1)
 *   < 0.65 => medium (2)
 *   else   => hard   (3)
 */
function masteryToDifficulty(mastery: number): number {
  if (mastery < 0.3) return 1
  if (mastery < 0.65) return 2
  return 3
}

/**
 * Map a mastery_level to a minimum Bloom's taxonomy level.
 * Enforces scaffolded progression: students must demonstrate
 * lower-level mastery before being tested at higher levels.
 *
 * Bloom levels in order: remember, understand, apply, analyze, evaluate, create
 */
const BLOOM_LEVELS_ORDERED = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create']

function masteryToMinBloomLevel(mastery: number): string {
  // Low mastery → test recall and understanding first
  if (mastery < 0.3) return 'remember'
  // Building → test application
  if (mastery < 0.5) return 'understand'
  // Solid → test analysis and application
  if (mastery < 0.7) return 'apply'
  // Strong → test higher-order thinking
  if (mastery < 0.85) return 'analyze'
  // Near mastery → evaluate and create
  return 'evaluate'
}

function getBloomLevelsAtOrAbove(minLevel: string): string[] {
  const idx = BLOOM_LEVELS_ORDERED.indexOf(minLevel)
  if (idx < 0) return BLOOM_LEVELS_ORDERED
  return BLOOM_LEVELS_ORDERED.slice(idx)
}

/**
 * Prevent adjacent questions on the same topic.
 * Simple greedy reordering: if next question is same topic, swap with a later one.
 */
function deduplicateAdjacentTopics(questions: QuestionRow[]): QuestionRow[] {
  const result = [...questions]
  for (let i = 1; i < result.length; i++) {
    if (result[i].topic_id && result[i].topic_id === result[i - 1].topic_id) {
      // Find a question further down with a different topic
      for (let j = i + 1; j < result.length; j++) {
        if (result[j].topic_id !== result[i - 1].topic_id) {
          ;[result[i], result[j]] = [result[j], result[i]]
          break
        }
      }
    }
  }
  return result
}

// ─── Fetch subject id ─────────────────────────────────────────────────────────

async function resolveSubjectId(
  supabase: SupabaseClient,
  subjectCode: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('subjects')
    .select('id')
    .eq('code', subjectCode)
    .eq('is_active', true)
    .maybeSingle()

  if (error) {
    console.warn(`resolveSubjectId: ${error.message}`)
    return null
  }
  return (data as SubjectRow | null)?.id ?? null
}

// ─── Adaptive question selection ──────────────────────────────────────────────

/**
 * Select questions using the student's concept_mastery data.
 * Weak topics (mastery < 0.65 or past due for review) get priority.
 * Targets an appropriate difficulty for each weak concept.
 */
async function selectAdaptiveQuestions(
  supabase: SupabaseClient,
  studentId: string,
  subjectId: string,
  grade: string,
  count: number,
): Promise<{ questions: QuestionRow[]; weakTopicsTargeted: number }> {
  const now = new Date().toISOString()

  // 1. Fetch the student's mastery for topics in this subject
  const { data: masteryRows, error: masteryError } = await supabase
    .from('concept_mastery')
    .select(`
      topic_id,
      mastery_level,
      next_review_at,
      curriculum_topics!inner(subject_id)
    `)
    .eq('student_id', studentId)
    .eq('curriculum_topics.subject_id', subjectId)
    .lt('mastery_level', 0.95)
    .order('mastery_level', { ascending: true })
    .limit(20)

  if (masteryError) {
    console.warn(`selectAdaptiveQuestions mastery fetch: ${masteryError.message}`)
    return { questions: [], weakTopicsTargeted: 0 }
  }

  const weakTopics = (masteryRows ?? []) as ConceptMasteryRow[]

  // Prioritise topics that are also due for review
  const prioritised = weakTopics.sort((a, b) => {
    const aDue = a.next_review_at && a.next_review_at <= now ? 1 : 0
    const bDue = b.next_review_at && b.next_review_at <= now ? 1 : 0
    if (bDue !== aDue) return bDue - aDue // due-first
    return a.mastery_level - b.mastery_level // then lowest mastery first
  })

  const questions: QuestionRow[] = []
  const usedIds = new Set<string>()

  // Allocate slots per weak topic
  const slotsPerTopic = Math.max(1, Math.floor(count / Math.max(prioritised.length, 1)))
  const targetTopics = prioritised.slice(0, Math.ceil(count / slotsPerTopic))

  for (const topic of targetTopics) {
    if (questions.length >= count) break

    const targetDifficulty = masteryToDifficulty(topic.mastery_level)
    const minBloom = masteryToMinBloomLevel(topic.mastery_level)
    const allowedBlooms = getBloomLevelsAtOrAbove(minBloom)
    const need = Math.min(slotsPerTopic, count - questions.length)

    // First try: difficulty + bloom-level targeted
    let { data: qs } = await supabase
      .from('question_bank')
      .select('*')
      .eq('topic_id', topic.topic_id)
      .eq('difficulty', targetDifficulty)
      .in('bloom_level', allowedBlooms)
      .eq('is_active', true)
      .not('id', 'in', `(${usedIds.size > 0 ? [...usedIds].join(',') : '00000000-0000-0000-0000-000000000000'})`)
      .limit(need * 2)

    // Fallback: if not enough bloom-filtered questions, relax bloom constraint
    if (!qs || qs.length < need) {
      const fallback = await supabase
        .from('question_bank')
        .select('*')
        .eq('topic_id', topic.topic_id)
        .eq('difficulty', targetDifficulty)
        .eq('is_active', true)
        .not('id', 'in', `(${usedIds.size > 0 ? [...usedIds].join(',') : '00000000-0000-0000-0000-000000000000'})`)
        .limit(need * 2)
      qs = fallback.data ?? qs ?? []
    }

    for (const q of shuffle((qs ?? []) as QuestionRow[]).slice(0, need)) {
      if (!usedIds.has(q.id)) {
        questions.push(q)
        usedIds.add(q.id)
      }
    }
  }

  return { questions, weakTopicsTargeted: targetTopics.length }
}

// ─── Random / difficulty-filtered fallback ────────────────────────────────────

async function selectRandomQuestions(
  supabase: SupabaseClient,
  subjectId: string,
  grade: string,
  count: number,
  difficulty: number | null,
  excludeIds: Set<string>,
): Promise<QuestionRow[]> {
  // P5: grade is plain string "6" through "12"
  const normalizedGrade = grade.replace(/\D/g, '')

  let query = supabase
    .from('question_bank')
    .select('*')
    .eq('subject_id', subjectId)
    .eq('is_active', true)
    .eq('grade', normalizedGrade)
    .limit(count * 3)

  if (difficulty != null) {
    query = query.eq('difficulty', difficulty)
  }

  const { data: qs, error } = await query
  if (error) throw new Error(`selectRandomQuestions: ${error.message}`)

  const pool = ((qs ?? []) as QuestionRow[]).filter((q) => !excludeIds.has(q.id))
  return shuffle(pool).slice(0, count)
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
    // ── Authenticate caller ───────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const authSupabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        auth: { persistSession: false },
        global: { headers: { Authorization: authHeader } },
      },
    )

    const { data: { user }, error: authError } = await authSupabase.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
        status: 401,
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

    const { student_id, subject, grade, count: rawCount, difficulty = null } = body

    if (!student_id) {
      return new Response(JSON.stringify({ error: 'student_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Verify student belongs to authenticated user ────────────────────
    const { data: studentRow, error: studentError } = await authSupabase
      .from('students')
      .select('id')
      .eq('id', student_id)
      .eq('auth_user_id', user.id)
      .maybeSingle()

    if (studentError || !studentRow) {
      return new Response(JSON.stringify({ error: 'student_id does not belong to authenticated user' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // In-memory rate limit check (fast, per-isolate)
    if (!checkRateLimitMemory(student_id)) {
      return new Response(
        JSON.stringify({ error: 'Too many requests. Please wait before generating another quiz.' }),
        {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '60' },
        },
      )
    }
    if (!subject) {
      return new Response(JSON.stringify({ error: 'subject is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (!grade) {
      return new Response(JSON.stringify({ error: 'grade is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const count = Math.min(Math.max(Number(rawCount ?? 10), 1), 30)

    // ── Build Supabase client ───────────────────────────────────────────────
    // Use the caller's JWT when supplied (RLS-aware); fall back to service role
    // for internal calls (e.g. from another Edge Function).
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: { persistSession: false },
        global: authHeader ? { headers: { Authorization: authHeader } } : {},
      },
    )

    // ── DB-backed rate limit check (cross-instance, authoritative) ────────
    const dbRateOk = await checkRateLimitDb(student_id, supabase)
    if (!dbRateOk) {
      return new Response(
        JSON.stringify({ error: 'Too many requests. Please wait before generating another quiz.' }),
        {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '60' },
        },
      )
    }

    // ── Resolve subject to its UUID ─────────────────────────────────────────
    const subjectId = await resolveSubjectId(supabase, subject)
    if (!subjectId) {
      return new Response(
        JSON.stringify({ error: `Subject "${subject}" not found or inactive` }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // ── Attempt adaptive selection (skip if caller forced a difficulty) ─────
    let questions: QuestionRow[] = []
    let weakTopicsTargeted = 0
    let strategy: 'adaptive' | 'random' = 'adaptive'

    if (difficulty == null) {
      const adaptive = await selectAdaptiveQuestions(
        supabase,
        student_id,
        subjectId,
        grade,
        count,
      )
      questions = adaptive.questions
      weakTopicsTargeted = adaptive.weakTopicsTargeted
    }

    // ── Fill remaining slots with random questions (or full random if no mastery data) ──
    if (questions.length < count) {
      if (questions.length === 0) strategy = 'random'

      const usedIds = new Set(questions.map((q) => q.id))
      const remaining = count - questions.length

      const randomQs = await selectRandomQuestions(
        supabase,
        subjectId,
        grade,
        remaining,
        difficulty,
        usedIds,
      )
      questions = [...questions, ...randomQs]
    }

    // ── Final shuffle + interleave so adaptive + random are mixed ────────────
    // Also prevent adjacent questions on the same topic for better retention
    shuffle(questions)
    const interleaved = deduplicateAdjacentTopics(questions)

    // Compute Bloom's taxonomy distribution for the quiz
    const bloomDistribution: Record<string, number> = {}
    for (const q of interleaved) {
      const level = q.bloom_level || 'unknown'
      bloomDistribution[level] = (bloomDistribution[level] || 0) + 1
    }

    return new Response(
      JSON.stringify({
        questions: interleaved,
        meta: {
          strategy,
          weak_topics_targeted: weakTopicsTargeted,
          total_returned: interleaved.length,
          bloom_distribution: bloomDistribution,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('quiz-generator error:', message)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
