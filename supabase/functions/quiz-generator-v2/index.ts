/**
 * quiz-generator-v2 – Alfanumrik Edge Function
 *
 * Enhanced adaptive quiz generator supporting three modes:
 *   - practice  : Standard filtered question bank selection (default)
 *   - board     : CBSE board exam questions, ordered by paper section
 *   - cognitive : ZPD-aware selection using student mastery data,
 *                 Bloom's taxonomy targeting, and topic interleaving
 *
 * POST body:
 * {
 *   mode:        'cognitive' | 'board' | 'practice'  (default: 'practice')
 *   subject:     string        – subject code, e.g. "math"
 *   grade:       string        – e.g. "9" or "Grade 9"
 *   count?:      number        – number of questions (default 10, max 30)
 *   student_id?: string        – required for cognitive mode
 *   board_year?: number        – optional filter for board mode (e.g. 2025)
 *   difficulty?: number|null   – 1 | 2 | 3 (for practice mode)
 *   topic_id?:   string        – optional topic filter for practice mode
 * }
 *
 * Response:
 * {
 *   questions: Question[],
 *   metadata: {
 *     mode: string,
 *     bloom_distribution: Record<string, number>,
 *     interleaving_ratio: number,
 *     zpd_target: number,
 *   }
 * }
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, getCorsHeaders } from '../_shared/cors.ts'

// ─── In-memory rate limiter (first line of defence) ─────────────────────────
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 20

function checkRateLimitMemory(key: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(key)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
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
const DB_RATE_LIMIT_WINDOW_MS = 60_000
const DB_RATE_LIMIT_MAX = 20

async function checkRateLimitDb(studentId: string, supabase: SupabaseClient): Promise<boolean> {
  const windowStart = new Date(Date.now() - DB_RATE_LIMIT_WINDOW_MS).toISOString()
  const { count, error } = await supabase
    .from('quiz_sessions')
    .select('*', { count: 'exact', head: true })
    .eq('student_id', studentId)
    .gte('created_at', windowStart)

  if (error) {
    console.warn('checkRateLimitDb error, allowing request:', error.message)
    return true
  }

  return (count ?? 0) < DB_RATE_LIMIT_MAX
}

// ─── Types ────────────────────────────────────────────────────────────────────

type QuizMode = 'cognitive' | 'board' | 'practice'

interface RequestBody {
  mode?: QuizMode
  subject: string
  grade: string
  count?: number
  student_id?: string
  board_year?: number
  difficulty?: number | null
  topic_id?: string
}

interface ConceptMasteryRow {
  topic_id: string
  mastery_level: number
  bloom_level: string | null
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
  source: string | null
  board_year: number | null
  paper_section: string | null
}

interface SubjectRow {
  id: string
}

interface QuizMetadata {
  mode: string
  bloom_distribution: Record<string, number>
  interleaving_ratio: number
  zpd_target: number
}

// ─── Bloom's taxonomy levels (ordered) ────────────────────────────────────────

const BLOOM_LEVELS = [
  'remember',
  'understand',
  'apply',
  'analyze',
  'evaluate',
  'create',
] as const

type BloomLevel = typeof BLOOM_LEVELS[number]

function getNextBloomLevel(current: string | null): BloomLevel {
  if (!current) return 'understand'
  const idx = BLOOM_LEVELS.indexOf(current as BloomLevel)
  if (idx === -1) return 'understand'
  return BLOOM_LEVELS[Math.min(idx + 1, BLOOM_LEVELS.length - 1)]
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

/** Build a bloom distribution count from a list of questions. */
function computeBloomDistribution(questions: QuestionRow[]): Record<string, number> {
  const dist: Record<string, number> = {}
  for (const q of questions) {
    const level = q.bloom_level ?? 'unknown'
    dist[level] = (dist[level] ?? 0) + 1
  }
  return dist
}

/**
 * Compute an interleaving ratio: how often consecutive questions come from
 * different topics. A ratio of 1.0 means perfect interleaving (no two
 * consecutive questions share a topic).
 */
function computeInterleavingRatio(questions: QuestionRow[]): number {
  if (questions.length <= 1) return 1.0
  let switches = 0
  for (let i = 1; i < questions.length; i++) {
    if (questions[i].topic_id !== questions[i - 1].topic_id) {
      switches++
    }
  }
  return Number((switches / (questions.length - 1)).toFixed(3))
}

/**
 * Sort questions to maximise topic interleaving: no two consecutive
 * questions should share the same topic when possible.
 */
function interleaveByTopic(questions: QuestionRow[]): QuestionRow[] {
  if (questions.length <= 2) return questions

  // Group by topic
  const buckets = new Map<string, QuestionRow[]>()
  for (const q of questions) {
    const key = q.topic_id ?? '__none__'
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key)!.push(q)
  }

  // Sort bucket keys by descending size so the largest topic spreads first
  const sortedKeys = [...buckets.keys()].sort(
    (a, b) => buckets.get(b)!.length - buckets.get(a)!.length,
  )

  const result: QuestionRow[] = []
  let lastTopic: string | null = null

  while (result.length < questions.length) {
    let placed = false

    for (const key of sortedKeys) {
      const bucket = buckets.get(key)!
      if (bucket.length === 0) continue
      if (key === lastTopic && sortedKeys.some((k) => k !== key && buckets.get(k)!.length > 0)) {
        continue // skip to avoid same topic back-to-back
      }
      result.push(bucket.shift()!)
      lastTopic = key
      placed = true
      break
    }

    // If we couldn't avoid a repeat, just take the first available
    if (!placed) {
      for (const key of sortedKeys) {
        const bucket = buckets.get(key)!
        if (bucket.length > 0) {
          result.push(bucket.shift()!)
          lastTopic = key
          break
        }
      }
    }
  }

  return result
}

/** Map a mastery_level [0, 1] to a target difficulty bucket. */
function masteryToDifficulty(mastery: number): number {
  if (mastery < 0.3) return 1
  if (mastery < 0.65) return 2
  return 3
}

// ─── Resolve subject id ─────────────────────────────────────────────────────

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

// ─── Practice mode ──────────────────────────────────────────────────────────

async function selectPracticeQuestions(
  supabase: SupabaseClient,
  subjectId: string,
  grade: string,
  count: number,
  difficulty: number | null,
  topicId: string | null,
): Promise<QuestionRow[]> {
  const gradeNum = grade.replace(/\D/g, '')
  const gradeLabel = `Grade ${gradeNum}`

  let query = supabase
    .from('question_bank')
    .select('*')
    .eq('subject_id', subjectId)
    .eq('is_active', true)
    .or(`grade.eq.${gradeNum},grade.eq.${gradeLabel}`)
    .limit(count * 3)

  if (difficulty != null) {
    query = query.eq('difficulty', difficulty)
  }

  if (topicId) {
    query = query.eq('topic_id', topicId)
  }

  const { data: qs, error } = await query
  if (error) throw new Error(`selectPracticeQuestions: ${error.message}`)

  return shuffle((qs ?? []) as QuestionRow[]).slice(0, count)
}

// ─── Board mode ─────────────────────────────────────────────────────────────

async function selectBoardQuestions(
  supabase: SupabaseClient,
  subjectId: string,
  grade: string,
  count: number,
  boardYear: number | null,
): Promise<QuestionRow[]> {
  const gradeNum = grade.replace(/\D/g, '')
  const gradeLabel = `Grade ${gradeNum}`

  let query = supabase
    .from('question_bank')
    .select('*, subjects!inner(id, code)')
    .eq('subject_id', subjectId)
    .eq('source', 'cbse_board')
    .eq('is_active', true)
    .or(`grade.eq.${gradeNum},grade.eq.${gradeLabel}`)
    .order('paper_section', { ascending: true })
    .limit(count * 3)

  if (boardYear != null) {
    query = query.eq('board_year', boardYear)
  }

  const { data: qs, error } = await query
  if (error) throw new Error(`selectBoardQuestions: ${error.message}`)

  const pool = (qs ?? []) as QuestionRow[]

  // Group by paper_section, shuffle within each section, then concatenate
  const sectionMap = new Map<string, QuestionRow[]>()
  for (const q of pool) {
    const section = q.paper_section ?? '__none__'
    if (!sectionMap.has(section)) sectionMap.set(section, [])
    sectionMap.get(section)!.push(q)
  }

  const result: QuestionRow[] = []
  // Maintain section order (already sorted from the query)
  for (const [, sectionQs] of sectionMap) {
    shuffle(sectionQs)
    result.push(...sectionQs)
  }

  return result.slice(0, count)
}

// ─── Cognitive mode ─────────────────────────────────────────────────────────

async function selectCognitiveQuestions(
  supabase: SupabaseClient,
  studentId: string,
  subjectId: string,
  grade: string,
  count: number,
): Promise<{ questions: QuestionRow[]; zpdTarget: number }> {
  const gradeNum = grade.replace(/\D/g, '')
  const gradeLabel = `Grade ${gradeNum}`

  // 1. Fetch student's concept_mastery for topics in this subject
  const { data: masteryRows, error: masteryError } = await supabase
    .from('concept_mastery')
    .select(`
      topic_id,
      mastery_level,
      bloom_level,
      next_review_at,
      curriculum_topics!inner(subject_id)
    `)
    .eq('student_id', studentId)
    .eq('curriculum_topics.subject_id', subjectId)
    .order('mastery_level', { ascending: true })
    .limit(50)

  if (masteryError) {
    console.warn(`selectCognitiveQuestions mastery fetch: ${masteryError.message}`)
    return { questions: [], zpdTarget: 0 }
  }

  const mastery = (masteryRows ?? []) as ConceptMasteryRow[]

  // 2. Classify topics as weak (< 0.6) or strong (>= 0.8)
  const weakTopics = mastery.filter((m) => m.mastery_level < 0.6)
  const strongTopics = mastery.filter((m) => m.mastery_level >= 0.8)

  // Calculate ZPD target: average mastery of weak topics offset upward
  const avgWeakMastery =
    weakTopics.length > 0
      ? weakTopics.reduce((sum, m) => sum + m.mastery_level, 0) / weakTopics.length
      : 0.5
  const zpdTarget = Number(Math.min(avgWeakMastery + 0.15, 0.75).toFixed(3))

  // 3. Allocate question slots: 70% weak topics, 30% strong (retrieval practice)
  const weakSlots = Math.ceil(count * 0.7)
  const strongSlots = count - weakSlots

  const usedIds = new Set<string>()
  const questions: QuestionRow[] = []

  // ── Fetch from weak topics ──────────────────────────────────────────────
  if (weakTopics.length > 0) {
    const slotsPerWeakTopic = Math.max(1, Math.floor(weakSlots / weakTopics.length))
    const targetWeakTopics = weakTopics.slice(0, Math.ceil(weakSlots / slotsPerWeakTopic))

    for (const topic of targetWeakTopics) {
      if (questions.length >= weakSlots) break

      const targetDifficulty = masteryToDifficulty(topic.mastery_level)
      const targetBloom = getNextBloomLevel(topic.bloom_level)
      const need = Math.min(slotsPerWeakTopic, weakSlots - questions.length)

      // First try to match both difficulty and target bloom level
      let { data: qs } = await supabase
        .from('question_bank')
        .select('*')
        .eq('topic_id', topic.topic_id)
        .eq('difficulty', targetDifficulty)
        .eq('bloom_level', targetBloom)
        .eq('is_active', true)
        .or(`grade.eq.${gradeNum},grade.eq.${gradeLabel}`)
        .not(
          'id',
          'in',
          `(${usedIds.size > 0 ? [...usedIds].join(',') : '00000000-0000-0000-0000-000000000000'})`,
        )
        .limit(need * 2)

      // Fallback: match difficulty only (ignore bloom target)
      if (!qs || qs.length === 0) {
        const fallback = await supabase
          .from('question_bank')
          .select('*')
          .eq('topic_id', topic.topic_id)
          .eq('difficulty', targetDifficulty)
          .eq('is_active', true)
          .or(`grade.eq.${gradeNum},grade.eq.${gradeLabel}`)
          .not(
            'id',
            'in',
            `(${usedIds.size > 0 ? [...usedIds].join(',') : '00000000-0000-0000-0000-000000000000'})`,
          )
          .limit(need * 2)
        qs = fallback.data
      }

      // Further fallback: just match topic
      if (!qs || qs.length === 0) {
        const fallback = await supabase
          .from('question_bank')
          .select('*')
          .eq('topic_id', topic.topic_id)
          .eq('is_active', true)
          .or(`grade.eq.${gradeNum},grade.eq.${gradeLabel}`)
          .not(
            'id',
            'in',
            `(${usedIds.size > 0 ? [...usedIds].join(',') : '00000000-0000-0000-0000-000000000000'})`,
          )
          .limit(need * 2)
        qs = fallback.data
      }

      for (const q of shuffle((qs ?? []) as QuestionRow[]).slice(0, need)) {
        if (!usedIds.has(q.id)) {
          questions.push(q)
          usedIds.add(q.id)
        }
      }
    }
  }

  // ── Fetch from strong topics (retrieval practice) ───────────────────────
  if (strongTopics.length > 0 && questions.length < count) {
    const remainingStrong = Math.min(strongSlots, count - questions.length)
    const slotsPerStrongTopic = Math.max(1, Math.floor(remainingStrong / strongTopics.length))
    const targetStrongTopics = shuffle([...strongTopics]).slice(
      0,
      Math.ceil(remainingStrong / slotsPerStrongTopic),
    )

    for (const topic of targetStrongTopics) {
      if (questions.length >= count) break

      // For strong topics, target a higher difficulty to maintain challenge
      const need = Math.min(slotsPerStrongTopic, count - questions.length)

      const { data: qs } = await supabase
        .from('question_bank')
        .select('*')
        .eq('topic_id', topic.topic_id)
        .eq('is_active', true)
        .or(`grade.eq.${gradeNum},grade.eq.${gradeLabel}`)
        .gte('difficulty', 2)
        .not(
          'id',
          'in',
          `(${usedIds.size > 0 ? [...usedIds].join(',') : '00000000-0000-0000-0000-000000000000'})`,
        )
        .limit(need * 2)

      for (const q of shuffle((qs ?? []) as QuestionRow[]).slice(0, need)) {
        if (!usedIds.has(q.id)) {
          questions.push(q)
          usedIds.add(q.id)
        }
      }
    }
  }

  // 4. Fill any remaining slots with general questions from the subject
  if (questions.length < count) {
    const remaining = count - questions.length
    const { data: fillQs } = await supabase
      .from('question_bank')
      .select('*')
      .eq('subject_id', subjectId)
      .eq('is_active', true)
      .or(`grade.eq.${gradeNum},grade.eq.${gradeLabel}`)
      .not(
        'id',
        'in',
        `(${usedIds.size > 0 ? [...usedIds].join(',') : '00000000-0000-0000-0000-000000000000'})`,
      )
      .limit(remaining * 3)

    for (const q of shuffle((fillQs ?? []) as QuestionRow[]).slice(0, remaining)) {
      if (!usedIds.has(q.id)) {
        questions.push(q)
        usedIds.add(q.id)
      }
    }
  }

  // 5. Apply interleaving sort
  const interleaved = interleaveByTopic(questions)

  return { questions: interleaved, zpdTarget }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // Handle CORS preflight
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

    const {
      mode = 'practice',
      subject,
      grade,
      count: rawCount,
      student_id,
      board_year = null,
      difficulty = null,
      topic_id = null,
    } = body

    // Validate mode
    const validModes: QuizMode[] = ['cognitive', 'board', 'practice']
    if (!validModes.includes(mode)) {
      return new Response(
        JSON.stringify({
          error: `Invalid mode "${mode}". Must be one of: cognitive, board, practice`,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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

    if (mode === 'cognitive' && !student_id) {
      return new Response(
        JSON.stringify({ error: 'student_id is required for cognitive mode' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const count = Math.min(Math.max(Number(rawCount ?? 10), 1), 30)

    // ── Rate limiting ─────────────────────────────────────────────────────
    // Use student_id if available; fall back to a general key derived from
    // request metadata so unauthenticated practice/board modes are still
    // rate-limited.
    const rateLimitKey =
      student_id ??
      `anon:${req.headers.get('x-forwarded-for') ?? req.headers.get('cf-connecting-ip') ?? 'unknown'}`

    if (!checkRateLimitMemory(rateLimitKey)) {
      return new Response(
        JSON.stringify({ error: 'Too many requests. Please wait before generating another quiz.' }),
        {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '60' },
        },
      )
    }

    // ── Build Supabase client ───────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization')
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: { persistSession: false },
        global: authHeader ? { headers: { Authorization: authHeader } } : {},
      },
    )

    // ── DB-backed rate limit check (only when student_id is provided) ────
    if (student_id) {
      const dbRateOk = await checkRateLimitDb(student_id, supabase)
      if (!dbRateOk) {
        return new Response(
          JSON.stringify({
            error: 'Too many requests. Please wait before generating another quiz.',
          }),
          {
            status: 429,
            headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '60' },
          },
        )
      }
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

    // ── Select questions based on mode ──────────────────────────────────────
    let questions: QuestionRow[] = []
    let zpdTarget = 0

    switch (mode) {
      case 'practice': {
        questions = await selectPracticeQuestions(
          supabase,
          subjectId,
          grade,
          count,
          difficulty,
          topic_id,
        )
        break
      }

      case 'board': {
        questions = await selectBoardQuestions(
          supabase,
          subjectId,
          grade,
          count,
          board_year,
        )
        break
      }

      case 'cognitive': {
        const result = await selectCognitiveQuestions(
          supabase,
          student_id!,
          subjectId,
          grade,
          count,
        )
        questions = result.questions
        zpdTarget = result.zpdTarget
        break
      }
    }

    // ── Build response metadata ─────────────────────────────────────────────
    const bloomDistribution = computeBloomDistribution(questions)
    const interleavingRatio = computeInterleavingRatio(questions)

    const metadata: QuizMetadata = {
      mode,
      bloom_distribution: bloomDistribution,
      interleaving_ratio: interleavingRatio,
      zpd_target: zpdTarget,
    }

    return new Response(
      JSON.stringify({
        questions,
        metadata,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('quiz-generator-v2 error:', message)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
