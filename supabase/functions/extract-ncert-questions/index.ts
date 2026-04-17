/**
 * extract-ncert-questions -- Alfanumrik Edge Function
 *
 * Extracts NCERT exercise questions from RAG content chunks and inserts them
 * into question_bank with proper source_type tagging ('ncert_exercise' or
 * 'ncert_intext').
 *
 * NCERT chapters contain 15-30+ exercise questions in their text (in
 * "Exercise", "Figure it Out", "Questions", "Try These" sections). This
 * function uses Claude Haiku to parse those sections and convert them into
 * properly formatted MCQ questions.
 *
 * Authentication: requires `x-admin-key` header matching ADMIN_API_KEY env var.
 *
 * POST body (all optional):
 * {
 *   grade?:          string  -- filter by grade, e.g. "7"
 *   subject?:        string  -- filter by subject code, e.g. "math"
 *   chapter_number?: number  -- process a single chapter
 *   batch_size?:     number  -- chapters per run (default 3, max 10)
 * }
 *
 * GET -- returns extraction status: chapters processed, questions extracted per grade/subject.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_BATCH_SIZE = 3
const MAX_BATCH_SIZE = 10
const MAX_EXECUTION_MS = 120_000 // 2 minutes
const INTER_CHAPTER_DELAY_MS = 1_000 // 1s delay between chapters (Claude calls are heavy)
const CLAUDE_TIMEOUT_MS = 60_000 // 60s per chapter — extraction is heavier than single-question answers
const MIN_EXISTING_QUESTIONS = 25 // skip chapters that already have > this many questions

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''

// Patterns that indicate exercise/question content in RAG chunks
const EXERCISE_PATTERNS = [
  '%exercise%',
  '%figure it out%',
  '%questions%',
  '%try these%',
  '%practice%',
  '%do this%',
  '%solve the following%',
  '%find the%',
  '%evaluate%',
  '%prove that%',
]

// Valid bloom levels for question_bank
const VALID_BLOOM_LEVELS = [
  'remember',
  'understand',
  'apply',
  'analyze',
  'evaluate',
  'create',
] as const

// Methodology mapping based on bloom_level
const BLOOM_TO_METHODOLOGY: Record<string, string> = {
  remember: 'definition',
  understand: 'definition',
  apply: 'stepwise',
  analyze: 'analysis',
  evaluate: 'analysis',
  create: 'essay',
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExtractedQuestion {
  question_text: string
  options: string[]
  correct_answer_index: number
  explanation: string
  source_type: 'ncert_exercise' | 'ncert_intext'
  ncert_exercise: string
  difficulty: number
  bloom_level: string
}

interface ChapterInfo {
  grade: string
  subject: string
  chapter_number: number
  chapter_title: string
}

interface ChapterResult {
  chapter: string
  questions_extracted: number
  questions_inserted: number
  skipped_reason?: string
  errors: string[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getSupabaseAdmin() {
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function authenticateAdmin(req: Request): boolean {
  const adminKey = Deno.env.get('ADMIN_API_KEY')
  if (!adminKey) return false
  const provided = req.headers.get('x-admin-key')
  return provided === adminKey
}

// Map subject codes to display names (used in chapter_title matching)
function subjectDisplayName(code: string): string {
  const map: Record<string, string> = {
    math: 'Mathematics',
    science: 'Science',
    physics: 'Physics',
    chemistry: 'Chemistry',
    biology: 'Biology',
    english: 'English',
    hindi: 'Hindi',
    social_studies: 'Social Studies',
    computer_science: 'Computer Science',
  }
  return map[code] || code
}

// ---------------------------------------------------------------------------
// RAG Chunk Retrieval — fetch exercise-related chunks for a chapter
// ---------------------------------------------------------------------------

async function fetchExerciseChunks(
  supabase: ReturnType<typeof createClient>,
  grade: string,
  subject: string,
  chapterNumber: number,
): Promise<{ chunks: string[]; chapterTitle: string | null }> {
  const dbSubject = subjectDisplayName(subject)

  // First, find chapter_title for this chapter_number by looking at RAG chunks
  // that mention "Chapter {N}" or start with the chapter number
  const chapterPatterns = [
    `%chapter ${chapterNumber}%`,
    `%ch ${chapterNumber}%`,
    `%ch. ${chapterNumber}%`,
  ]

  // Build OR conditions for chapter_title matching
  let chapterTitle: string | null = null
  let allChunks: Array<{ chunk_text: string; chapter_title: string }> = []

  for (const pattern of chapterPatterns) {
    const { data } = await supabase
      .from('rag_content_chunks')
      .select('chunk_text, chapter_title')
      .eq('subject', dbSubject)
      .eq('grade', grade)
      .eq('is_active', true)
      .ilike('chapter_title', pattern)
      .limit(50)

    if (data && data.length > 0) {
      chapterTitle = data[0].chapter_title
      allChunks = data
      break
    }
  }

  if (!chapterTitle || allChunks.length === 0) {
    return { chunks: [], chapterTitle: null }
  }

  // Now filter to chunks that contain exercise/question content
  const exerciseChunks: string[] = []

  for (const chunk of allChunks) {
    const lowerText = chunk.chunk_text.toLowerCase()
    const isExercise = EXERCISE_PATTERNS.some((p) => {
      const keyword = p.replace(/%/g, '')
      return lowerText.includes(keyword)
    })
    if (isExercise) {
      exerciseChunks.push(chunk.chunk_text)
    }
  }

  // If no exercise-specific chunks found, also try fetching chunks with exercise
  // patterns directly using ILIKE on chunk_text
  if (exerciseChunks.length === 0) {
    for (const pattern of EXERCISE_PATTERNS.slice(0, 4)) {
      // Use the top 4 patterns
      const { data } = await supabase
        .from('rag_content_chunks')
        .select('chunk_text')
        .eq('subject', dbSubject)
        .eq('grade', grade)
        .eq('is_active', true)
        .ilike('chapter_title', `%${chapterTitle}%`)
        .ilike('chunk_text', pattern)
        .limit(10)

      if (data) {
        for (const row of data) {
          if (!exerciseChunks.includes(row.chunk_text)) {
            exerciseChunks.push(row.chunk_text)
          }
        }
      }
    }
  }

  return { chunks: exerciseChunks, chapterTitle }
}

// ---------------------------------------------------------------------------
// Claude API Call
// ---------------------------------------------------------------------------

async function callClaude(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), CLAUDE_TIMEOUT_MS)

  try {
    // eslint-disable-next-line alfanumrik/no-direct-ai-calls -- TODO(phase-4-cleanup): extract-ncert-questions is ingestion-time content extraction, not student-facing.
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        temperature: 0.3, // factual — low hallucination risk
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: controller.signal,
    })

    const data = await res.json()
    return data.content?.[0]?.text || ''
  } finally {
    clearTimeout(timeout)
  }
}

// ---------------------------------------------------------------------------
// Prompt Builders
// ---------------------------------------------------------------------------

function buildExtractionSystemPrompt(grade: string, subject: string): string {
  return `You are a CBSE question extractor for Class ${grade} ${subject}.
From this NCERT chapter content, extract ALL exercise and practice questions.
Convert each into MCQ format with 4 options.

For each question:
- question_text: the question as written (or rephrased for MCQ)
- options: array of 4 options (correct + 3 plausible distractors)
- correct_answer_index: 0-3
- explanation: why the correct answer is right (2-3 sentences)
- source_type: "ncert_exercise" if from end-of-chapter exercise, "ncert_intext" if from within the chapter
- ncert_exercise: exercise reference like "Ex 1.1 Q3" or "Figure it Out Q2"
- difficulty: 1 (easy/remember), 2 (medium/apply), or 3 (hard/analyze)
- bloom_level: one of "remember", "understand", "apply", "analyze"

Rules:
- Extract at least 10 questions if the content has them. Maximum 20.
- Each question MUST have exactly 4 distinct non-empty options.
- correct_answer_index MUST be 0, 1, 2, or 3.
- Explanation MUST be non-empty (2-3 sentences minimum).
- question_text MUST NOT contain placeholders like "{{" or "[BLANK]".
- All content must be age-appropriate for Class ${grade} students.
- Stay within CBSE ${subject} curriculum scope.
- Output ONLY a valid JSON array. No markdown fences, no extra text.`
}

function buildExtractionUserPrompt(chapterTitle: string, chunks: string[]): string {
  const content = chunks.join('\n\n---\n\n')
  return `Extract NCERT exercise questions from this chapter content.

CHAPTER: ${chapterTitle}

=== CHAPTER CONTENT ===
${content}
=== END CONTENT ===

Output ONLY a valid JSON array of question objects. No other text.`
}

// ---------------------------------------------------------------------------
// Response Parsing & Validation
// ---------------------------------------------------------------------------

function parseExtractedQuestions(raw: string): ExtractedQuestion[] {
  try {
    // Try to find JSON array in response
    const jsonMatch = raw.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return []

    const parsed = JSON.parse(jsonMatch[0])
    if (!Array.isArray(parsed)) return []

    const validated: ExtractedQuestion[] = []

    for (const item of parsed) {
      // Validate required fields
      if (!item.question_text || typeof item.question_text !== 'string') continue
      if (item.question_text.trim().length === 0) continue
      // P6: no placeholders
      if (item.question_text.includes('{{') || item.question_text.includes('[BLANK]')) continue

      // Validate options: must be array of 4 distinct non-empty strings
      if (!Array.isArray(item.options) || item.options.length !== 4) continue
      const options = item.options.map((o: unknown) => String(o).trim())
      if (options.some((o: string) => o.length === 0)) continue
      const uniqueOptions = new Set(options)
      if (uniqueOptions.size !== 4) continue

      // Validate correct_answer_index
      const idx = Number(item.correct_answer_index)
      if (!Number.isInteger(idx) || idx < 0 || idx > 3) continue

      // Validate explanation
      if (!item.explanation || typeof item.explanation !== 'string' || item.explanation.trim().length === 0)
        continue

      // Validate source_type
      const sourceType =
        item.source_type === 'ncert_intext' ? 'ncert_intext' : 'ncert_exercise'

      // Validate difficulty (1-3)
      let difficulty = Number(item.difficulty)
      if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 3) {
        difficulty = 2 // default medium
      }

      // Validate bloom_level
      let bloomLevel = String(item.bloom_level || 'understand').toLowerCase()
      if (!VALID_BLOOM_LEVELS.includes(bloomLevel as typeof VALID_BLOOM_LEVELS[number])) {
        bloomLevel = 'understand'
      }

      // Validate ncert_exercise reference
      const ncertExercise = item.ncert_exercise
        ? String(item.ncert_exercise).trim()
        : 'Unknown'

      validated.push({
        question_text: item.question_text.trim(),
        options,
        correct_answer_index: idx,
        explanation: item.explanation.trim(),
        source_type: sourceType,
        ncert_exercise: ncertExercise,
        difficulty,
        bloom_level: bloomLevel,
      })
    }

    return validated
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Build answer_text from question data (consistent with generate-answers)
// ---------------------------------------------------------------------------

function buildAnswerText(q: ExtractedQuestion): string {
  const letter = String.fromCharCode(65 + q.correct_answer_index)
  const correctOption = q.options[q.correct_answer_index]
  return `Correct Answer: ${letter}) ${correctOption}\n\nExplanation: ${q.explanation}`
}

// ---------------------------------------------------------------------------
// Count existing questions for a chapter
// ---------------------------------------------------------------------------

async function countExistingQuestions(
  supabase: ReturnType<typeof createClient>,
  grade: string,
  subject: string,
  chapterNumber: number,
): Promise<number> {
  const { count, error } = await supabase
    .from('question_bank')
    .select('*', { count: 'exact', head: true })
    .eq('grade', grade)
    .eq('subject', subject)
    .eq('chapter_number', chapterNumber)
    .eq('is_active', true)
    .eq('is_ncert', true)

  if (error) return 0
  return count ?? 0
}

// ---------------------------------------------------------------------------
// Discover chapters to process
// ---------------------------------------------------------------------------

async function discoverChapters(
  supabase: ReturnType<typeof createClient>,
  grade?: string,
  subject?: string,
  chapterNumber?: number,
  batchSize?: number,
): Promise<ChapterInfo[]> {
  const limit = Math.min(Math.max(batchSize ?? DEFAULT_BATCH_SIZE, 1), MAX_BATCH_SIZE)

  // Get distinct chapters from question_bank (which has chapter_number)
  let query = supabase
    .from('question_bank')
    .select('grade, subject, chapter_number')
    .eq('is_active', true)
    .not('chapter_number', 'is', null)

  if (grade) query = query.eq('grade', grade)
  if (subject) query = query.eq('subject', subject)
  if (chapterNumber) query = query.eq('chapter_number', chapterNumber)

  const { data, error } = await query.order('grade').order('subject').order('chapter_number')

  if (error || !data) return []

  // Deduplicate chapters
  const seen = new Set<string>()
  const chapters: ChapterInfo[] = []

  for (const row of data) {
    if (!row.chapter_number) continue
    const key = `${row.grade}|${row.subject}|${row.chapter_number}`
    if (seen.has(key)) continue
    seen.add(key)

    chapters.push({
      grade: row.grade,
      subject: row.subject,
      chapter_number: row.chapter_number,
      chapter_title: '', // will be resolved during processing
    })

    if (chapters.length >= limit) break
  }

  return chapters
}

// ---------------------------------------------------------------------------
// Process a single chapter
// ---------------------------------------------------------------------------

async function processChapter(
  supabase: ReturnType<typeof createClient>,
  chapter: ChapterInfo,
): Promise<ChapterResult> {
  const chapterKey = `Grade ${chapter.grade} ${chapter.subject} Ch ${chapter.chapter_number}`
  const result: ChapterResult = {
    chapter: chapterKey,
    questions_extracted: 0,
    questions_inserted: 0,
    errors: [],
  }

  // Check existing NCERT question count
  const existingCount = await countExistingQuestions(
    supabase,
    chapter.grade,
    chapter.subject,
    chapter.chapter_number,
  )

  if (existingCount > MIN_EXISTING_QUESTIONS) {
    result.skipped_reason = `Already has ${existingCount} NCERT questions (threshold: ${MIN_EXISTING_QUESTIONS})`
    return result
  }

  // Fetch exercise chunks from RAG
  const { chunks, chapterTitle } = await fetchExerciseChunks(
    supabase,
    chapter.grade,
    chapter.subject,
    chapter.chapter_number,
  )

  if (!chapterTitle || chunks.length === 0) {
    result.skipped_reason = 'No exercise content found in RAG chunks'
    return result
  }

  chapter.chapter_title = chapterTitle
  result.chapter = `Grade ${chapter.grade} ${chapter.subject} - ${chapterTitle}`

  // Build prompts
  const systemPrompt = buildExtractionSystemPrompt(
    chapter.grade,
    subjectDisplayName(chapter.subject),
  )
  const userPrompt = buildExtractionUserPrompt(chapterTitle, chunks)

  // Call Claude — use higher max_tokens since we expect 10-20 questions
  let rawResponse: string
  try {
    rawResponse = await callClaude(systemPrompt, userPrompt, 4096)
  } catch (err) {
    result.errors.push(
      `Claude API error: ${err instanceof Error ? err.message : String(err)}`,
    )
    return result
  }

  // Parse and validate extracted questions
  const questions = parseExtractedQuestions(rawResponse)
  result.questions_extracted = questions.length

  if (questions.length === 0) {
    result.errors.push('Claude returned no valid questions')
    return result
  }

  // Insert into question_bank
  for (const q of questions) {
    const methodology = BLOOM_TO_METHODOLOGY[q.bloom_level] || 'definition'
    const answerText = buildAnswerText(q)

    const insertRow = {
      subject: chapter.subject,
      grade: chapter.grade, // P5: grade as string
      chapter_number: chapter.chapter_number,
      question_text: q.question_text,
      question_hi: null, // bilingual translation deferred
      question_type: 'mcq',
      question_type_v2: 'mcq',
      options: q.options, // JSONB array of 4 strings
      correct_answer_index: q.correct_answer_index,
      explanation: q.explanation,
      difficulty: q.difficulty,
      bloom_level: q.bloom_level,
      source_type: q.source_type,
      is_ncert: true,
      ncert_exercise: q.ncert_exercise,
      source_version: 'ncert_2025',
      is_active: true,
      answer_text: answerText,
      answer_methodology: methodology,
      marks_expected: 1, // MCQ = 1 mark
    }

    const { error: insertErr } = await supabase
      .from('question_bank')
      .insert(insertRow)

    if (insertErr) {
      result.errors.push(
        `Insert failed for "${q.question_text.slice(0, 60)}...": ${insertErr.message}`,
      )
    } else {
      result.questions_inserted++
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// GET handler — extraction status overview
// ---------------------------------------------------------------------------

async function handleGet(origin: string | null): Promise<Response> {
  const supabase = getSupabaseAdmin()

  // Count NCERT questions by source_type
  const { count: ncertExercise } = await supabase
    .from('question_bank')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)
    .eq('is_ncert', true)
    .eq('source_type', 'ncert_exercise')

  const { count: ncertIntext } = await supabase
    .from('question_bank')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)
    .eq('is_ncert', true)
    .eq('source_type', 'ncert_intext')

  const { count: totalActive } = await supabase
    .from('question_bank')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)

  // Get breakdown by grade/subject for NCERT questions
  const { data: ncertRows } = await supabase
    .from('question_bank')
    .select('grade, subject, chapter_number, source_type')
    .eq('is_active', true)
    .eq('is_ncert', true)

  const breakdown: Record<
    string,
    { ncert_exercise: number; ncert_intext: number; chapters: number[] }
  > = {}

  if (ncertRows) {
    for (const row of ncertRows) {
      const key = `Grade ${row.grade} - ${row.subject}`
      if (!breakdown[key]) {
        breakdown[key] = { ncert_exercise: 0, ncert_intext: 0, chapters: [] }
      }
      if (row.source_type === 'ncert_exercise') breakdown[key].ncert_exercise++
      else if (row.source_type === 'ncert_intext') breakdown[key].ncert_intext++

      if (row.chapter_number && !breakdown[key].chapters.includes(row.chapter_number)) {
        breakdown[key].chapters.push(row.chapter_number)
      }
    }

    // Sort chapter arrays
    for (const val of Object.values(breakdown)) {
      val.chapters.sort((a, b) => a - b)
    }
  }

  return jsonResponse(
    {
      total_active_questions: totalActive ?? 0,
      ncert_exercise_questions: ncertExercise ?? 0,
      ncert_intext_questions: ncertIntext ?? 0,
      ncert_total: (ncertExercise ?? 0) + (ncertIntext ?? 0),
      breakdown,
    },
    200,
    {},
    origin,
  )
}

// ---------------------------------------------------------------------------
// POST handler — batch extraction
// ---------------------------------------------------------------------------

interface PostParams {
  grade?: string
  subject?: string
  chapter_number?: number
  batch_size?: number
}

async function handlePost(req: Request, origin: string | null): Promise<Response> {
  const supabase = getSupabaseAdmin()
  const startTime = Date.now()

  // Validate Anthropic API key
  if (!ANTHROPIC_API_KEY) {
    return errorResponse('ANTHROPIC_API_KEY not configured', 500, origin)
  }

  // Parse params
  let params: PostParams = {}
  try {
    const body = await req.text()
    if (body.trim()) {
      params = JSON.parse(body)
    }
  } catch {
    return errorResponse('Invalid JSON body', 400, origin)
  }

  // P5: grade must be string if provided
  if (params.grade !== undefined && typeof params.grade !== 'string') {
    params.grade = String(params.grade)
  }

  // Discover chapters to process
  const chapters = await discoverChapters(
    supabase,
    params.grade,
    params.subject,
    params.chapter_number,
    params.batch_size,
  )

  if (chapters.length === 0) {
    return jsonResponse(
      {
        success: true,
        chapters_found: 0,
        chapters_processed: 0,
        total_extracted: 0,
        total_inserted: 0,
        results: [],
        elapsed_ms: Date.now() - startTime,
      },
      200,
      {},
      origin,
    )
  }

  // Process each chapter
  const results: ChapterResult[] = []
  let totalExtracted = 0
  let totalInserted = 0

  for (let i = 0; i < chapters.length; i++) {
    // Time check
    if (Date.now() - startTime >= MAX_EXECUTION_MS) {
      results.push({
        chapter: 'TIMEOUT',
        questions_extracted: 0,
        questions_inserted: 0,
        skipped_reason: `Stopped early: approaching ${MAX_EXECUTION_MS}ms execution limit`,
        errors: [],
      })
      break
    }

    const chapter = chapters[i]
    console.info(
      `[extract-ncert-questions] Processing ${i + 1}/${chapters.length}: Grade ${chapter.grade} ${chapter.subject} Ch ${chapter.chapter_number}`,
    )

    const result = await processChapter(supabase, chapter)
    results.push(result)
    totalExtracted += result.questions_extracted
    totalInserted += result.questions_inserted

    // Delay between chapters (Claude rate limiting)
    if (i < chapters.length - 1) {
      await sleep(INTER_CHAPTER_DELAY_MS)
    }
  }

  return jsonResponse(
    {
      success: totalInserted > 0 || results.every((r) => r.skipped_reason),
      chapters_found: chapters.length,
      chapters_processed: results.filter((r) => !r.skipped_reason).length,
      chapters_skipped: results.filter((r) => r.skipped_reason).length,
      total_extracted: totalExtracted,
      total_inserted: totalInserted,
      results,
      elapsed_ms: Date.now() - startTime,
    },
    200,
    {},
    origin,
  )
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        ...getCorsHeaders(origin),
        'Access-Control-Allow-Headers':
          'authorization, x-client-info, apikey, content-type, x-request-id, x-admin-key',
      },
    })
  }

  // Authenticate
  if (!authenticateAdmin(req)) {
    return errorResponse('Unauthorized: invalid or missing x-admin-key', 401, origin)
  }

  try {
    if (req.method === 'GET') {
      return await handleGet(origin)
    }

    if (req.method === 'POST') {
      return await handlePost(req, origin)
    }

    return errorResponse('Method not allowed', 405, origin)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[extract-ncert-questions] Unhandled error:', message)
    return errorResponse(`Internal error: ${message}`, 500, origin)
  }
})
