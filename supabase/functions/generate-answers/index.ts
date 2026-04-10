/**
 * generate-answers -- Alfanumrik Edge Function
 *
 * Batch-generates CBSE-aligned answers for questions in question_bank
 * that have `answer_text IS NULL`.
 *
 * Uses Claude Haiku with RAG context from NCERT content chunks to produce
 * board-exam-style answers grounded in NCERT material.
 *
 * Authentication: requires `x-admin-key` header matching ADMIN_API_KEY env var.
 *
 * POST body (all optional):
 * {
 *   grade?:      string   -- filter by grade, e.g. "10"
 *   subject?:    string   -- filter by subject code, e.g. "science"
 *   batch_size?: number   -- questions per run (default 20, max 50)
 *   dry_run?:    boolean  -- if true, fetch questions but skip answer generation
 * }
 *
 * GET -- returns status: counts of questions with/without answers, by grade/subject.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { fetchRAGContext } from '../_shared/rag-retrieval.ts'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_BATCH_SIZE = 50
const DEFAULT_BATCH_SIZE = 20
const MAX_EXECUTION_MS = 120_000 // 2 minutes (stay under Supabase 150s gateway timeout)
const INTER_QUESTION_DELAY_MS = 300 // throttle between Claude API calls
const CLAUDE_TIMEOUT_MS = 30_000 // 30s timeout per Claude call

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''

const VALID_METHODOLOGIES = [
  'definition',
  'stepwise',
  'diagram',
  'derivation',
  'essay',
  'numerical',
  'comparison',
  'analysis',
] as const

type AnswerMethodology = typeof VALID_METHODOLOGIES[number]

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

// ---------------------------------------------------------------------------
// Question type definition
// ---------------------------------------------------------------------------

interface QuestionRow {
  id: string
  question_text: string
  subject: string
  grade: string
  chapter_number: number | null
  difficulty: number | null
  bloom_level: string | null
  question_type_v2: string | null
  options: unknown // JSONB
  correct_answer_index: number | null
  explanation: string | null
}

interface GeneratedAnswer {
  answer_text: string
  answer_methodology: AnswerMethodology
  marks_expected: number
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

function buildSystemPrompt(grade: string, subject: string, ragContext: string | null): string {
  let prompt = `You are a CBSE exam answer writer for Class ${grade} ${subject}.
Write answers that students can directly use in board exams.

Rules:
- Use ONLY NCERT content provided below
- Follow CBSE marking scheme conventions
- Be concise but complete
- For 1 mark: 1-2 sentences
- For 2-3 marks: paragraph with key points
- For 5 marks: structured answer with introduction, points, conclusion
- Use bullet points for clarity where appropriate
- Include formulas in proper notation for math/science
- Always output valid JSON
- Keep language student-friendly and appropriate for Class ${grade}`

  if (ragContext) {
    prompt += `

=== NCERT REFERENCE MATERIAL (Class ${grade}, ${subject}) ===
${ragContext}
=== END REFERENCE ===

You MUST ground your answer in the NCERT content above. Do NOT invent facts not present in the reference material.`
  } else {
    prompt += `

WARNING: No NCERT reference material was retrieved for this question.
Use only standard CBSE Class ${grade} ${subject} curriculum knowledge.
Add a note: "Answer should be verified against NCERT textbook."`
  }

  return prompt
}

function buildUserPrompt(question: QuestionRow): string {
  const isMCQ = question.question_type_v2 === 'mcq'
  const options = question.options as string[] | null
  const correctIndex = question.correct_answer_index

  let prompt = `Generate a CBSE board exam answer for this question.

QUESTION: ${question.question_text}
GRADE: ${question.grade}
SUBJECT: ${question.subject}
TYPE: ${question.question_type_v2 || 'unknown'}
DIFFICULTY: ${question.difficulty || 'unknown'} (1=easy, 2=medium, 3=hard)
BLOOM LEVEL: ${question.bloom_level || 'unknown'}`

  if (isMCQ && options && Array.isArray(options) && correctIndex !== null && correctIndex !== undefined) {
    const correctOption = options[correctIndex]
    prompt += `
OPTIONS: ${options.map((o: string, i: number) => `${String.fromCharCode(65 + i)}) ${o}`).join(' | ')}
CORRECT ANSWER: ${String.fromCharCode(65 + correctIndex)}) ${correctOption}`
  }

  if (question.explanation) {
    prompt += `
EXISTING EXPLANATION: ${question.explanation}`
  }

  if (isMCQ) {
    prompt += `

For this MCQ:
- Explain WHY the correct option is right (3-5 sentences)
- Briefly mention what is wrong with 1-2 common distractor options
- Keep concise — this is a 1-mark question
- Set marks_expected to 1`
  } else {
    prompt += `

Estimate appropriate marks_expected based on question depth and type.`
  }

  prompt += `

Determine the answer_methodology from EXACTLY one of: definition, stepwise, diagram, derivation, essay, numerical, comparison, analysis

Output ONLY valid JSON (no markdown, no code fences):
{"answer_text": "...", "answer_methodology": "...", "marks_expected": N}`

  return prompt
}

// ---------------------------------------------------------------------------
// Answer Parsing
// ---------------------------------------------------------------------------

function parseAnswerResponse(raw: string, isMCQ: boolean): GeneratedAnswer | null {
  try {
    // Extract JSON from response (handle potential wrapping text)
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    const parsed = JSON.parse(jsonMatch[0])

    const answerText = parsed.answer_text
    if (!answerText || typeof answerText !== 'string' || answerText.trim().length === 0) {
      return null
    }

    // Validate methodology
    let methodology: AnswerMethodology = 'definition'
    if (parsed.answer_methodology && VALID_METHODOLOGIES.includes(parsed.answer_methodology)) {
      methodology = parsed.answer_methodology
    }

    // Validate marks
    let marks = isMCQ ? 1 : 2
    if (typeof parsed.marks_expected === 'number' && parsed.marks_expected >= 1 && parsed.marks_expected <= 10) {
      marks = Math.round(parsed.marks_expected)
    }
    // MCQ is always 1 mark
    if (isMCQ) {
      marks = 1
    }

    return {
      answer_text: answerText.trim(),
      answer_methodology: methodology,
      marks_expected: marks,
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// GET handler -- answer generation status overview
// ---------------------------------------------------------------------------

async function handleGet(origin: string | null): Promise<Response> {
  const supabase = getSupabaseAdmin()

  // Count total active questions
  const { count: totalActive, error: totalErr } = await supabase
    .from('question_bank')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)

  if (totalErr) {
    return errorResponse(`DB error: ${totalErr.message}`, 500, origin)
  }

  // Count questions with answers
  const { count: withAnswer, error: ansErr } = await supabase
    .from('question_bank')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)
    .not('answer_text', 'is', null)

  if (ansErr) {
    return errorResponse(`DB error: ${ansErr.message}`, 500, origin)
  }

  // Breakdown by grade and subject
  const { data: gradeSubject, error: gsErr } = await supabase
    .from('question_bank')
    .select('grade, subject')
    .eq('is_active', true)

  let breakdown: Record<string, { total: number; with_answer: number; without_answer: number }> | null = null

  if (!gsErr && gradeSubject) {
    // Build breakdown manually since we don't have a dedicated RPC
    // Fetch questions with answers for the breakdown
    const { data: withAnswerRows } = await supabase
      .from('question_bank')
      .select('grade, subject')
      .eq('is_active', true)
      .not('answer_text', 'is', null)

    const withAnswerSet = new Set(
      (withAnswerRows || []).map((r: { grade: string; subject: string }) => `${r.grade}|${r.subject}`),
    )

    const counts: Record<string, { total: number; with_answer: number }> = {}
    for (const row of gradeSubject) {
      const key = `Grade ${row.grade} - ${row.subject}`
      if (!counts[key]) counts[key] = { total: 0, with_answer: 0 }
      counts[key].total++
    }

    // Count with_answer per group
    if (withAnswerRows) {
      const answerCounts: Record<string, number> = {}
      for (const row of withAnswerRows) {
        const key = `Grade ${row.grade} - ${row.subject}`
        answerCounts[key] = (answerCounts[key] || 0) + 1
      }
      for (const [key, count] of Object.entries(answerCounts)) {
        if (counts[key]) counts[key].with_answer = count
      }
    }

    breakdown = {}
    for (const [key, val] of Object.entries(counts)) {
      breakdown[key] = {
        total: val.total,
        with_answer: val.with_answer,
        without_answer: val.total - val.with_answer,
      }
    }
  }

  return jsonResponse(
    {
      total_active: totalActive ?? 0,
      with_answer: withAnswer ?? 0,
      without_answer: (totalActive ?? 0) - (withAnswer ?? 0),
      coverage_percent:
        totalActive && totalActive > 0
          ? Math.round(((withAnswer ?? 0) / totalActive) * 100)
          : 0,
      breakdown,
    },
    200,
    {},
    origin,
  )
}

// ---------------------------------------------------------------------------
// POST handler -- batch answer generation
// ---------------------------------------------------------------------------

interface PostParams {
  grade?: string
  subject?: string
  batch_size?: number
  dry_run?: boolean
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

  const batchSize = Math.min(
    Math.max(params.batch_size ?? DEFAULT_BATCH_SIZE, 1),
    MAX_BATCH_SIZE,
  )
  const dryRun = params.dry_run === true

  // Build query for questions needing answers
  let fetchQuery = supabase
    .from('question_bank')
    .select(
      'id, question_text, subject, grade, chapter_number, difficulty, bloom_level, question_type_v2, options, correct_answer_index, explanation',
    )
    .eq('is_active', true)
    .is('answer_text', null)
    .order('grade', { ascending: true })
    .order('subject', { ascending: true })
    .limit(batchSize)

  if (params.grade) {
    fetchQuery = fetchQuery.eq('grade', params.grade)
  }
  if (params.subject) {
    fetchQuery = fetchQuery.eq('subject', params.subject)
  }

  const { data: questions, error: fetchErr } = await fetchQuery

  if (fetchErr) {
    return errorResponse(`DB fetch error: ${fetchErr.message}`, 500, origin)
  }

  if (!questions || questions.length === 0) {
    return jsonResponse(
      {
        success: true,
        total_found: 0,
        processed: 0,
        succeeded: 0,
        failed: 0,
        errors: [],
        elapsed_ms: Date.now() - startTime,
        dry_run: dryRun,
      },
      200,
      {},
      origin,
    )
  }

  // Dry run: return the questions that would be processed
  if (dryRun) {
    return jsonResponse(
      {
        success: true,
        dry_run: true,
        total_found: questions.length,
        questions: questions.map((q: QuestionRow) => ({
          id: q.id,
          grade: q.grade,
          subject: q.subject,
          question_type_v2: q.question_type_v2,
          question_text: q.question_text.slice(0, 100) + (q.question_text.length > 100 ? '...' : ''),
        })),
        elapsed_ms: Date.now() - startTime,
      },
      200,
      {},
      origin,
    )
  }

  // Process each question
  let processed = 0
  let succeeded = 0
  let failed = 0
  const errors: string[] = []

  for (const question of questions as QuestionRow[]) {
    // Time check: stop if approaching the execution limit
    if (Date.now() - startTime >= MAX_EXECUTION_MS) {
      errors.push(`Stopped early: approaching ${MAX_EXECUTION_MS}ms execution limit after ${processed} questions`)
      break
    }

    processed++

    try {
      // Step 1: Retrieve NCERT RAG context
      const ragContext = await fetchRAGContext(
        supabase,
        question.question_text,
        question.subject,
        question.grade,
        question.chapter_number ? String(question.chapter_number) : null,
      )

      // Step 2: Build prompts
      const systemPrompt = buildSystemPrompt(question.grade, question.subject, ragContext)
      const userPrompt = buildUserPrompt(question)

      // Step 3: Call Claude
      const rawResponse = await callClaude(systemPrompt, userPrompt, 800)

      // Step 4: Parse response
      const isMCQ = question.question_type_v2 === 'mcq'
      const answer = parseAnswerResponse(rawResponse, isMCQ)

      if (!answer) {
        failed++
        errors.push(`question ${question.id}: failed to parse Claude response`)
        continue
      }

      // Step 5: Post-process safety check — verify no age-inappropriate content
      // Basic check: answer should not be empty and should be reasonable length
      if (answer.answer_text.length < 10) {
        failed++
        errors.push(`question ${question.id}: answer too short (${answer.answer_text.length} chars)`)
        continue
      }

      // Step 6: Update question_bank row
      const { error: updateErr } = await supabase
        .from('question_bank')
        .update({
          answer_text: answer.answer_text,
          answer_methodology: answer.answer_methodology,
          marks_expected: answer.marks_expected,
        })
        .eq('id', question.id)

      if (updateErr) {
        failed++
        errors.push(`question ${question.id}: DB update error: ${updateErr.message}`)
      } else {
        succeeded++
      }
    } catch (err) {
      failed++
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`question ${question.id}: ${msg}`)
    }

    // Cap errors list
    if (errors.length > 100) {
      errors.splice(50, errors.length - 100)
      errors.push('... (errors truncated)')
    }

    // Delay between questions to avoid Claude API rate limiting
    if (processed < questions.length) {
      await sleep(INTER_QUESTION_DELAY_MS)
    }
  }

  // Count remaining after this batch
  let countQuery = supabase
    .from('question_bank')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)
    .is('answer_text', null)

  if (params.grade) {
    countQuery = countQuery.eq('grade', params.grade)
  }
  if (params.subject) {
    countQuery = countQuery.eq('subject', params.subject)
  }

  const { count: remaining } = await countQuery

  return jsonResponse(
    {
      success: failed === 0 || succeeded > 0,
      total_found: questions.length,
      processed,
      succeeded,
      failed,
      errors: errors.slice(0, 50),
      elapsed_ms: Date.now() - startTime,
      remaining: remaining ?? 0,
      dry_run: false,
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
    console.error('[generate-answers] Unhandled error:', message)
    return errorResponse(`Internal error: ${message}`, 500, origin)
  }
})
