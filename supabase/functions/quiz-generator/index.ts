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
import { retrieveChunks } from '../_shared/retrieval.ts'

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
  action?: 'generate' | 'next_question'
  student_id: string
  subject: string
  grade: string
  count?: number
  difficulty?: number | null
  chapter_number?: number | null
}

interface NextQuestionRequestBody {
  action: 'next_question'
  student_id: string
  subject: string
  grade: string
  session_id: string
  responses_so_far: ResponseSoFar[]
  exclude_ids: string[]
  chapter_number?: number | null
}

interface ResponseSoFar {
  question_id: string
  is_correct: boolean
  time_spent: number
}

interface ConceptMasteryRow {
  topic_id: string
  mastery_level: number
  next_review_at: string | null
  curriculum_topics: {
    subject_id: string
    chapter_number: number | null
    concept_tag: string | null
  }
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
  topic: string | null
  concept_tag: string | null
  subject: string | null
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
 * Map a mastery_level to a maximum allowed Bloom's taxonomy level (ceiling).
 * Students with low mastery are capped at lower-order Bloom levels to enforce
 * scaffolded progression:
 *   mastery < 0.3  → only 'remember', 'understand'
 *   mastery < 0.5  → up to 'apply'
 *   mastery < 0.7  → up to 'analyze'
 *   mastery < 0.85 → up to 'evaluate'
 *   else           → all levels allowed
 */
function masteryToMaxBloomLevel(mastery: number): string {
  if (mastery < 0.3) return 'understand'
  if (mastery < 0.5) return 'apply'
  if (mastery < 0.7) return 'analyze'
  if (mastery < 0.85) return 'evaluate'
  return 'create'
}

/** Return all Bloom levels from 'remember' up to and including the given maxLevel. */
function getBloomLevelsUpTo(maxLevel: string): string[] {
  const idx = BLOOM_LEVELS_ORDERED.indexOf(maxLevel)
  if (idx < 0) return BLOOM_LEVELS_ORDERED
  return BLOOM_LEVELS_ORDERED.slice(0, idx + 1)
}

/**
 * Prevent adjacent questions on the same topic.
 * Simple greedy reordering: if next question is same topic, swap with a later one.
 */
function deduplicateAdjacentTopics(questions: QuestionRow[]): QuestionRow[] {
  const result = [...questions]
  for (let i = 1; i < result.length; i++) {
    if (result[i].topic && result[i].topic === result[i - 1].topic) {
      // Find a question further down with a different topic
      for (let j = i + 1; j < result.length; j++) {
        if (result[j].topic !== result[i - 1].topic) {
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

// ─── Due review question selection (spaced repetition) ───────────────────────

/**
 * Fetch questions for concepts that are due for spaced-repetition review.
 * Queries concept_mastery WHERE next_review_at <= now(), ordered by lowest
 * current retention first (highest priority for review).
 *
 * Returns up to `maxCount` questions (caller should pass ~50% of total count).
 * Each returned question is tagged with `_source: 'review'` for metadata.
 */
async function fetchDueReviewQuestions(
  supabase: SupabaseClient,
  studentId: string,
  subjectId: string,
  subjectCode: string,
  grade: string,
  maxCount: number,
  excludeIds: Set<string>,
): Promise<{ questions: QuestionRow[]; reviewTopicCount: number }> {
  if (maxCount <= 0) return { questions: [], reviewTopicCount: 0 }

  const now = new Date().toISOString()

  // 1. Find concepts due for review, ordered by lowest retention (most urgent).
  //    current_retention may be NULL for topics that haven't decayed yet — treat
  //    those as lowest priority within the due set (NULLS LAST in ascending).
  const { data: dueRows, error: dueError } = await supabase
    .from('concept_mastery')
    .select(`
      topic_id,
      mastery_level,
      current_retention,
      next_review_at,
      curriculum_topics!inner(subject_id, chapter_number, concept_tag)
    `)
    .eq('student_id', studentId)
    .eq('curriculum_topics.subject_id', subjectId)
    .lte('next_review_at', now)
    .order('current_retention', { ascending: true, nullsFirst: true })
    .limit(15)

  if (dueError) {
    console.warn(`fetchDueReviewQuestions mastery fetch: ${dueError.message}`)
    return { questions: [], reviewTopicCount: 0 }
  }

  const dueTopics = (dueRows ?? []) as (ConceptMasteryRow & { current_retention: number | null })[]
  if (dueTopics.length === 0) return { questions: [], reviewTopicCount: 0 }

  const questions: QuestionRow[] = []
  const usedIds = new Set<string>(excludeIds)

  // Allocate slots per due topic
  const slotsPerTopic = Math.max(1, Math.floor(maxCount / Math.max(dueTopics.length, 1)))
  const targetTopics = dueTopics.slice(0, Math.ceil(maxCount / slotsPerTopic))

  for (const topic of targetTopics) {
    if (questions.length >= maxCount) break

    const chapterNum = topic.curriculum_topics?.chapter_number
    const conceptTag = topic.curriculum_topics?.concept_tag
    const targetDifficulty = masteryToDifficulty(topic.mastery_level)
    // Enforce Bloom ceiling for review questions too
    const maxBloom = masteryToMaxBloomLevel(topic.mastery_level)
    const allowedBlooms = getBloomLevelsUpTo(maxBloom)
    const need = Math.min(slotsPerTopic, maxCount - questions.length)

    const exclusionList = usedIds.size > 0
      ? [...usedIds].join(',')
      : '00000000-0000-0000-0000-000000000000'

    let query = supabase
      .from('question_bank')
      .select('*')
      .eq('subject', subjectCode)
      .eq('grade', grade)
      .eq('is_active', true)
      .not('id', 'in', `(${exclusionList})`)
      .eq('difficulty', targetDifficulty)
      .in('bloom_level', allowedBlooms)

    if (chapterNum != null) {
      query = query.eq('chapter_number', chapterNum)
    }
    if (conceptTag) {
      query = query.eq('concept_tag', conceptTag)
    }

    let { data: qs } = await query.limit(need * 2)

    // Fallback: relax concept_tag
    if ((!qs || qs.length < need) && conceptTag && chapterNum != null) {
      const fb = await supabase
        .from('question_bank')
        .select('*')
        .eq('subject', subjectCode)
        .eq('grade', grade)
        .eq('is_active', true)
        .not('id', 'in', `(${exclusionList})`)
        .eq('chapter_number', chapterNum)
        .eq('difficulty', targetDifficulty)
        .in('bloom_level', allowedBlooms)
        .limit(need * 2)
      qs = fb.data ?? qs ?? []
    }

    // Fallback: relax bloom constraint
    if (!qs || qs.length < need) {
      let fb2Query = supabase
        .from('question_bank')
        .select('*')
        .eq('subject', subjectCode)
        .eq('grade', grade)
        .eq('is_active', true)
        .not('id', 'in', `(${exclusionList})`)
        .eq('difficulty', targetDifficulty)
      if (chapterNum != null) {
        fb2Query = fb2Query.eq('chapter_number', chapterNum)
      }
      const fb2 = await fb2Query.limit(need * 2)
      qs = fb2.data ?? qs ?? []
    }

    for (const q of shuffle((qs ?? []) as QuestionRow[]).slice(0, need)) {
      if (!usedIds.has(q.id)) {
        questions.push(q)
        usedIds.add(q.id)
      }
    }
  }

  return { questions, reviewTopicCount: targetTopics.length }
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
  subjectCode: string,
  grade: string,
  count: number,
  excludeIds: Set<string>,
): Promise<{ questions: QuestionRow[]; weakTopicsTargeted: number }> {
  const now = new Date().toISOString()

  // 1. Fetch the student's mastery for topics in this subject.
  //    Include curriculum_topics.chapter_number and concept_tag so we can
  //    query question_bank (which has no topic_id column).
  const { data: masteryRows, error: masteryError } = await supabase
    .from('concept_mastery')
    .select(`
      topic_id,
      mastery_level,
      next_review_at,
      curriculum_topics!inner(subject_id, chapter_number, concept_tag)
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
  const usedIds = new Set<string>(excludeIds)

  // Allocate slots per weak topic
  const slotsPerTopic = Math.max(1, Math.floor(count / Math.max(prioritised.length, 1)))
  const targetTopics = prioritised.slice(0, Math.ceil(count / slotsPerTopic))

  for (const topic of targetTopics) {
    if (questions.length >= count) break

    const chapterNum = topic.curriculum_topics?.chapter_number
    const conceptTag = topic.curriculum_topics?.concept_tag
    const targetDifficulty = masteryToDifficulty(topic.mastery_level)
    // Use ceiling-based Bloom enforcement: students with low mastery
    // are capped at lower-order levels (scaffolded progression)
    const maxBloom = masteryToMaxBloomLevel(topic.mastery_level)
    const allowedBlooms = getBloomLevelsUpTo(maxBloom)
    const need = Math.min(slotsPerTopic, count - questions.length)

    // Build exclusion list for Supabase .not('id','in',...) filter
    const exclusionList = usedIds.size > 0
      ? [...usedIds].join(',')
      : '00000000-0000-0000-0000-000000000000'

    // Query question_bank by chapter_number + subject (TEXT code) + grade.
    // question_bank has no topic_id column — we match via chapter_number
    // and optionally concept_tag.
    let baseQuery = supabase
      .from('question_bank')
      .select('*')
      .eq('subject', subjectCode)
      .eq('grade', grade)
      .eq('is_active', true)
      .not('id', 'in', `(${exclusionList})`)

    if (chapterNum != null) {
      baseQuery = baseQuery.eq('chapter_number', chapterNum)
    }

    // First try: difficulty + bloom-level targeted + concept_tag
    let query = baseQuery
      .eq('difficulty', targetDifficulty)
      .in('bloom_level', allowedBlooms)
    if (conceptTag) {
      query = query.eq('concept_tag', conceptTag)
    }
    let { data: qs } = await query.limit(need * 2)

    // Fallback 1: relax concept_tag if not enough
    if ((!qs || qs.length < need) && conceptTag) {
      const fb1 = await supabase
        .from('question_bank')
        .select('*')
        .eq('subject', subjectCode)
        .eq('grade', grade)
        .eq('is_active', true)
        .not('id', 'in', `(${exclusionList})`)
        .eq('chapter_number', chapterNum!)
        .eq('difficulty', targetDifficulty)
        .in('bloom_level', allowedBlooms)
        .limit(need * 2)
      qs = fb1.data ?? qs ?? []
    }

    // Fallback 2: relax bloom constraint
    if (!qs || qs.length < need) {
      let fb2Query = supabase
        .from('question_bank')
        .select('*')
        .eq('subject', subjectCode)
        .eq('grade', grade)
        .eq('is_active', true)
        .not('id', 'in', `(${exclusionList})`)
        .eq('difficulty', targetDifficulty)
      if (chapterNum != null) {
        fb2Query = fb2Query.eq('chapter_number', chapterNum)
      }
      const fb2 = await fb2Query.limit(need * 2)
      qs = fb2.data ?? qs ?? []
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
  subjectCode: string,
  grade: string,
  count: number,
  difficulty: number | null,
  excludeIds: Set<string>,
  chapterNumber: number | null = null,
): Promise<QuestionRow[]> {
  // P5: grade is plain string "6" through "12"
  let query = supabase
    .from('question_bank')
    .select('*')
    .eq('subject', subjectCode)
    .eq('is_active', true)
    .eq('grade', grade)
    .limit(count * 3)

  if (difficulty != null) {
    query = query.eq('difficulty', difficulty)
  }
  if (chapterNumber != null) {
    query = query.eq('chapter_number', chapterNumber)
  }

  const { data: qs, error } = await query
  if (error) throw new Error(`selectRandomQuestions: ${error.message}`)

  const pool = ((qs ?? []) as QuestionRow[]).filter((q) => !excludeIds.has(q.id))
  return shuffle(pool).slice(0, count)
}

// ─── RAG Q&A question source ─────────────────────────────────────────────────

/**
 * Fetch quiz-ready questions from RAG Q&A chunks via the unified retrieval module.
 *
 * Uses retrieveChunks() with contentType: 'qa' so all callers go through the same
 * match_rag_chunks_v2 path (with automatic fallback to match_rag_chunks), vector
 * search, and retrieval trace logging.
 */
async function selectRAGQuestions(
  supabase: SupabaseClient,
  grade: string,
  subject: string,
  chapterNumber: number | null,
  count: number,
  excludeIds: Set<string>,
  requestingUserId?: string,
): Promise<QuestionRow[]> {
  // retrieveChunks expects the raw grade string ("9") and subject code ("math") —
  // match_rag_chunks_v2 handles normalisation internally via the RPC.
  const result = await retrieveChunks({
    supabase,
    query: subject, // topic-level query; vector search is filtered by chapter + subject
    grade,
    subject,
    chapterNumber: chapterNumber ?? undefined,
    contentType: 'qa',
    matchCount: count * 3, // over-fetch so we can filter + shuffle below
    caller: 'quiz-generator',
    userId: requestingUserId,
    logTrace: true,
    board: 'CBSE',
  })

  if (result.error || result.chunks.length === 0) return []

  // Convert RetrievedChunk Q&A fields → QuestionRow format for quiz compatibility.
  // Only include chunks that have a non-trivial question text (needed for quiz display).
  const questions: QuestionRow[] = []
  for (const chunk of result.chunks) {
    if (!chunk.questionText || excludeIds.has(chunk.id)) continue

    const qText = chunk.questionText
    if (qText.length < 10) continue // Skip very short fragments

    const marks = chunk.marksExpected ?? 2
    questions.push({
      id: chunk.id,
      question_text: qText,
      question_hi: null,
      question_type: chunk.questionType ?? 'short_answer',
      options: '[]', // RAG Q&A chunks do not carry MCQ options
      correct_answer_index: 0,
      explanation: chunk.answerText ?? null,
      explanation_hi: null,
      hint: null,
      difficulty: marks <= 2 ? 1 : marks >= 5 ? 3 : 2,
      bloom_level: chunk.bloomLevel ?? 'understand',
      chapter_number: chunk.chapterNumber ?? 0,
      topic: chunk.topic ?? null,
      concept_tag: chunk.concept ?? null,
      subject: null,
    })
  }

  return shuffle(questions).slice(0, count)
}

// ─── Question history (dedup + 80% pool reset) ──────────────────────────────

/**
 * Fetch IDs of questions this student has already seen for this scope.
 */
async function fetchSeenQuestionIds(
  supabase: SupabaseClient,
  studentId: string,
  subject: string,
  grade: string,
  chapterNumber: number | null,
): Promise<Set<string>> {
  let query = supabase
    .from('user_question_history')
    .select('question_id')
    .eq('student_id', studentId)
    .eq('subject', subject)
    .eq('grade', grade)
  if (chapterNumber != null) query = query.eq('chapter_number', chapterNumber)
  const { data, error } = await query.limit(500)
  if (error) {
    console.warn(`fetchSeenQuestionIds: ${error.message}`)
    return new Set()
  }
  return new Set((data ?? []).map((r: { question_id: string }) => r.question_id))
}

/**
 * If the student has seen >= 80% of the available pool, reset their history
 * for this scope so questions can repeat.
 */
async function checkAndResetHistory(
  supabase: SupabaseClient,
  studentId: string,
  subject: string,
  grade: string,
  chapterNumber: number | null,
  totalPool: number,
): Promise<void> {
  let countQuery = supabase
    .from('user_question_history')
    .select('*', { count: 'exact', head: true })
    .eq('student_id', studentId)
    .eq('subject', subject)
    .eq('grade', grade)
  if (chapterNumber != null) countQuery = countQuery.eq('chapter_number', chapterNumber)
  const { count: seenCount, error } = await countQuery

  if (error) {
    console.warn(`checkAndResetHistory count: ${error.message}`)
    return
  }

  if (totalPool > 0 && (seenCount ?? 0) / totalPool >= 0.80) {
    let deleteQuery = supabase
      .from('user_question_history')
      .delete()
      .eq('student_id', studentId)
      .eq('subject', subject)
      .eq('grade', grade)
    if (chapterNumber != null) deleteQuery = deleteQuery.eq('chapter_number', chapterNumber)
    const { error: delError } = await deleteQuery
    if (delError) console.warn(`checkAndResetHistory delete: ${delError.message}`)
  }
}

/**
 * Record questions shown to the student for future dedup.
 * Uses upsert so re-shown questions increment times_shown.
 */
async function recordShownQuestions(
  supabase: SupabaseClient,
  studentId: string,
  subject: string,
  grade: string,
  questions: QuestionRow[],
): Promise<void> {
  if (questions.length === 0) return
  const now = new Date().toISOString()
  const rows = questions.map((q) => ({
    student_id: studentId,
    question_id: q.id,
    subject,
    grade,
    chapter_number: q.chapter_number || null,
    first_shown_at: now,
    last_shown_at: now,
    times_shown: 1,
  }))
  const { error } = await supabase.from('user_question_history').upsert(rows, {
    onConflict: 'student_id,question_id',
    ignoreDuplicates: false,
  })
  if (error) console.warn(`recordShownQuestions: ${error.message}`)
}

// ─── Mid-quiz adaptive difficulty adjustment ─────────────────────────────────

/**
 * Analyze responses so far and compute the next target difficulty + Bloom ceiling.
 *
 * Rules (assessment-defined, ai-engineer-implemented):
 *   - 3+ consecutive correct → increase difficulty by 1 (max 3)
 *   - 2+ consecutive wrong  → decrease difficulty by 1 (min 1)
 *   - Avg time < 5s on correct answers → increase difficulty (too easy)
 *   - Avg time > 45s → decrease difficulty (struggling)
 *   - Bloom ceiling derived from running mastery estimate
 */
function computeAdaptiveDifficulty(
  responses: ResponseSoFar[],
): {
  adjustedDifficulty: number
  reason: string
  bloomCeiling: string
  runningScore: string
} {
  if (responses.length === 0) {
    return {
      adjustedDifficulty: 1,
      reason: 'no responses yet',
      bloomCeiling: 'understand',
      runningScore: '0/0 (0%)',
    }
  }

  const correctCount = responses.filter((r) => r.is_correct).length
  const totalCount = responses.length
  const scorePercent = Math.round((correctCount / totalCount) * 100)
  const runningScore = `${correctCount}/${totalCount} (${scorePercent}%)`

  // Compute current effective difficulty from recent questions' implied difficulty.
  // Start at difficulty 2 (medium) as the baseline.
  let currentDifficulty = 2

  // ── Streak detection ───────────────────────────────────────────────────────
  let consecutiveCorrect = 0
  let consecutiveWrong = 0

  // Walk from most recent backwards to find current streak
  for (let i = responses.length - 1; i >= 0; i--) {
    if (responses[i].is_correct) {
      if (consecutiveWrong > 0) break
      consecutiveCorrect++
    } else {
      if (consecutiveCorrect > 0) break
      consecutiveWrong++
    }
  }

  let reason = 'maintaining current difficulty'

  // ── Time-based adjustment ──────────────────────────────────────────────────
  // Only look at recent correct answers for "too easy" detection
  const recentCorrect = responses.filter((r) => r.is_correct).slice(-5)
  const avgCorrectTime =
    recentCorrect.length > 0
      ? recentCorrect.reduce((sum, r) => sum + r.time_spent, 0) / recentCorrect.length
      : 15 // neutral default

  const avgOverallTime =
    responses.reduce((sum, r) => sum + r.time_spent, 0) / responses.length

  // ── Apply rules (priority order) ───────────────────────────────────────────
  if (consecutiveCorrect >= 3) {
    currentDifficulty = Math.min(3, currentDifficulty + 1)
    reason = `${consecutiveCorrect} consecutive correct answers`
  } else if (consecutiveWrong >= 2) {
    currentDifficulty = Math.max(1, currentDifficulty - 1)
    reason = `${consecutiveWrong} consecutive wrong answers`
  } else if (avgCorrectTime < 5 && recentCorrect.length >= 2) {
    // Answering correctly very fast → too easy
    currentDifficulty = Math.min(3, currentDifficulty + 1)
    reason = `fast correct answers (avg ${avgCorrectTime.toFixed(1)}s)`
  } else if (avgOverallTime > 45) {
    // Taking too long overall → struggling
    currentDifficulty = Math.max(1, currentDifficulty - 1)
    reason = `slow average response time (${avgOverallTime.toFixed(1)}s)`
  }

  // ── Bloom ceiling from running mastery estimate ────────────────────────────
  // Use scorePercent as a proxy for mastery in this session
  const masteryEstimate = scorePercent / 100
  const bloomCeiling = masteryToMaxBloomLevel(masteryEstimate)

  return { adjustedDifficulty: currentDifficulty, reason, bloomCeiling, runningScore }
}

/**
 * Handle `action: 'next_question'` — fetch a single question at the
 * adaptively-adjusted difficulty for mid-quiz flow.
 */
async function handleNextQuestion(
  supabase: SupabaseClient,
  body: NextQuestionRequestBody,
): Promise<Response> {
  const { student_id, subject, grade, responses_so_far, exclude_ids, chapter_number } = body
  const chapterNumber = chapter_number ?? null

  // Compute adaptive difficulty
  const { adjustedDifficulty, reason, bloomCeiling, runningScore } =
    computeAdaptiveDifficulty(responses_so_far)

  const allowedBlooms = getBloomLevelsUpTo(bloomCeiling)
  const excludeSet = new Set(exclude_ids ?? [])

  // Build exclusion list for Supabase filter
  const exclusionList =
    excludeSet.size > 0
      ? [...excludeSet].join(',')
      : '00000000-0000-0000-0000-000000000000'

  // ── Primary query: exact difficulty + Bloom ceiling ────────────────────────
  let query = supabase
    .from('question_bank')
    .select('*')
    .eq('subject', subject)
    .eq('grade', grade)
    .eq('is_active', true)
    .not('id', 'in', `(${exclusionList})`)
    .eq('difficulty', adjustedDifficulty)
    .in('bloom_level', allowedBlooms)

  if (chapterNumber != null) {
    query = query.eq('chapter_number', chapterNumber)
  }

  let { data: candidates } = await query.limit(10)

  // ── Fallback 1: relax Bloom constraint ─────────────────────────────────────
  if (!candidates || candidates.length === 0) {
    let fb1 = supabase
      .from('question_bank')
      .select('*')
      .eq('subject', subject)
      .eq('grade', grade)
      .eq('is_active', true)
      .not('id', 'in', `(${exclusionList})`)
      .eq('difficulty', adjustedDifficulty)
    if (chapterNumber != null) fb1 = fb1.eq('chapter_number', chapterNumber)
    const { data: fb1Data } = await fb1.limit(10)
    candidates = fb1Data ?? []
  }

  // ── Fallback 2: relax difficulty (adjacent levels) ─────────────────────────
  if (!candidates || candidates.length === 0) {
    const adjacentDifficulties = [
      adjustedDifficulty - 1,
      adjustedDifficulty + 1,
    ].filter((d) => d >= 1 && d <= 3)

    let fb2 = supabase
      .from('question_bank')
      .select('*')
      .eq('subject', subject)
      .eq('grade', grade)
      .eq('is_active', true)
      .not('id', 'in', `(${exclusionList})`)
      .in('difficulty', adjacentDifficulties)
    if (chapterNumber != null) fb2 = fb2.eq('chapter_number', chapterNumber)
    const { data: fb2Data } = await fb2.limit(10)
    candidates = fb2Data ?? []
  }

  if (!candidates || candidates.length === 0) {
    return new Response(
      JSON.stringify({
        error: 'No questions available at the adjusted difficulty',
        meta: { adjustedDifficulty, reason, runningScore, bloomCeiling },
      }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  // Pick one random question from candidates
  const selected = candidates[Math.floor(Math.random() * candidates.length)] as QuestionRow

  // Record shown question for future dedup
  await recordShownQuestions(supabase, student_id, subject, grade, [selected])

  return new Response(
    JSON.stringify({
      question: selected,
      meta: {
        adjusted_difficulty: adjustedDifficulty,
        reason,
        running_score: runningScore,
        bloom_ceiling: bloomCeiling,
      },
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
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
    // deno-lint-ignore no-explicit-any
    let body: any
    try {
      body = await req.json()
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { student_id, subject, grade } = body

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

    // ── Route: next_question (mid-quiz adaptive) ─────────────────────────
    if (body.action === 'next_question') {
      if (!subject || !grade) {
        return new Response(JSON.stringify({ error: 'subject and grade are required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      if (!body.session_id) {
        return new Response(JSON.stringify({ error: 'session_id is required for next_question' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      if (!Array.isArray(body.responses_so_far)) {
        return new Response(JSON.stringify({ error: 'responses_so_far must be an array' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Build service-role client for question selection
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
        {
          auth: { persistSession: false },
          global: authHeader ? { headers: { Authorization: authHeader } } : {},
        },
      )

      return handleNextQuestion(supabase, body as NextQuestionRequestBody)
    }

    // ── Route: batch question generation (default) ───────────────────────
    const { count: rawCount, difficulty = null } = body as RequestBody
    const chapterNumber = body.chapter_number ?? null

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

    // ── Question history: pool reset + fetch seen IDs ───────────────────────
    // Count total available questions for this scope
    let poolCountQuery = supabase
      .from('question_bank')
      .select('*', { count: 'exact', head: true })
      .eq('subject', subject)
      .eq('grade', grade)
      .eq('is_active', true)
    if (chapterNumber != null) poolCountQuery = poolCountQuery.eq('chapter_number', chapterNumber)
    const { count: totalPool } = await poolCountQuery

    // Reset history if student has seen >= 80% of pool
    await checkAndResetHistory(supabase, student_id, subject, grade, chapterNumber, totalPool ?? 0)

    // Fetch already-seen question IDs for dedup
    const seenIds = await fetchSeenQuestionIds(supabase, student_id, subject, grade, chapterNumber)

    // ── Step 1: Fetch due review questions (spaced repetition) ───────────────
    // Review questions fill up to 50% of the requested count.
    // Only used when difficulty is not forced (adaptive mode).
    let reviewQuestions: QuestionRow[] = []
    let reviewTopicCount = 0

    if (difficulty == null) {
      const reviewSlots = Math.floor(count * 0.5)
      const review = await fetchDueReviewQuestions(
        supabase,
        student_id,
        subjectId,
        subject,
        grade,
        reviewSlots,
        seenIds,
      )
      reviewQuestions = review.questions
      reviewTopicCount = review.reviewTopicCount
    }

    // Track IDs already selected by review to avoid duplicates in adaptive/random
    const reviewIds = new Set(reviewQuestions.map((q) => q.id))
    const usedAfterReview = new Set([...seenIds, ...reviewIds])

    // ── Step 2: Adaptive selection for remaining slots ─────────────────────────
    let adaptiveQuestions: QuestionRow[] = []
    let weakTopicsTargeted = 0
    let strategy: 'adaptive' | 'random' = 'adaptive'

    const adaptiveSlots = count - reviewQuestions.length

    if (difficulty == null && adaptiveSlots > 0) {
      const adaptive = await selectAdaptiveQuestions(
        supabase,
        student_id,
        subjectId,
        subject,
        grade,
        adaptiveSlots,
        usedAfterReview,
      )
      adaptiveQuestions = adaptive.questions
      weakTopicsTargeted = adaptive.weakTopicsTargeted
    }

    // Merge review + adaptive
    let questions: QuestionRow[] = [...reviewQuestions, ...adaptiveQuestions]

    // ── Step 3: Fill remaining from random question_bank ──────────────────────
    if (questions.length < count) {
      const usedIds = new Set([...usedAfterReview, ...adaptiveQuestions.map((q) => q.id)])

      // RAG Q&A source (NCERT exercise / intext questions — short_answer type).
      // NOTE: RAG Q&A chunks do not have MCQ options (options: [], correct_answer_index: 0).
      // Mixing them into an MCQ quiz pool violates P6 (4 distinct options required).
      // This path is reserved for a future non-MCQ study/Q&A quiz mode.
      // TODO(ai-engineer): re-enable when request body includes question_mode !== 'mcq'.
      // if (chapterNumber != null) {
      //   const ragQs = await selectRAGQuestions(
      //     supabase, grade, subject, chapterNumber, count - questions.length, usedIds, user.id
      //   )
      //   for (const q of ragQs) {
      //     if (questions.length >= count) break
      //     if (!usedIds.has(q.id)) {
      //       questions.push(q)
      //       usedIds.add(q.id)
      //     }
      //   }
      // }

      // Fill remaining from question_bank (existing random fallback)
      if (questions.length < count) {
        if (questions.length === 0 && reviewQuestions.length === 0) strategy = 'random'
        const remaining = count - questions.length

        const randomQs = await selectRandomQuestions(
          supabase,
          subject,
          grade,
          remaining,
          difficulty,
          usedIds,
          chapterNumber,
        )
        questions = [...questions, ...randomQs]
      }
    }

    // ── Record shown questions for future dedup ──────────────────────────────
    await recordShownQuestions(supabase, student_id, subject, grade, questions)

    // ── Final shuffle + interleave so review + adaptive + random are mixed ───
    // Also prevent adjacent questions on the same topic for better retention
    shuffle(questions)
    const interleaved = deduplicateAdjacentTopics(questions)

    // Compute Bloom's taxonomy distribution for the quiz
    const bloomDistribution: Record<string, number> = {}
    for (const q of interleaved) {
      const level = q.bloom_level || 'unknown'
      bloomDistribution[level] = (bloomDistribution[level] || 0) + 1
    }

    // Compute source counts for response metadata
    const reviewCount = reviewQuestions.length
    const adaptiveCount = adaptiveQuestions.length
    const randomCount = interleaved.length - reviewCount - adaptiveCount

    // Tag review question IDs in the response so the client can display
    // review indicators (e.g. "Revision question") without changing QuestionRow shape
    const reviewQuestionIds = [...reviewIds]

    return new Response(
      JSON.stringify({
        questions: interleaved,
        meta: {
          strategy,
          weak_topics_targeted: weakTopicsTargeted,
          total_returned: interleaved.length,
          bloom_distribution: bloomDistribution,
          review_count: reviewCount,
          adaptive_count: adaptiveCount,
          random_count: randomCount,
          review_topic_count: reviewTopicCount,
          review_question_ids: reviewQuestionIds,
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
