/**
 * ncert-question-engine – Alfanumrik Edge Function
 *
 * Two actions:
 *
 * 1. fetch_questions
 *    Fetches NCERT questions from ncert_exercises + rag_content_chunks for a
 *    given subject/grade/chapter and question type (mcq|short_answer|medium_answer|
 *    long_answer|mixed).  Returns up to `count` deduplicated questions.
 *
 * 2. evaluate_answer
 *    Evaluates a student's written answer against the NCERT model answer
 *    retrieved from RAG. Returns marks, CBSE examiner feedback, and key points
 *    the student hit/missed.  Uses Claude (no Voyage needed for evaluation –
 *    model answer is fetched directly from DB by question_id).
 *
 * POST body for fetch_questions:
 * {
 *   action: 'fetch_questions',
 *   student_id: string,
 *   subject: string,     e.g. "science"
 *   grade: string,       e.g. "9" or "Grade 9"
 *   chapter: number,
 *   question_type: 'mcq'|'short_answer'|'medium_answer'|'long_answer'|'mixed'|'all',
 *   count?: number       default 10
 * }
 *
 * POST body for evaluate_answer:
 * {
 *   action: 'evaluate_answer',
 *   student_id: string,
 *   question_id: string (uuid),
 *   source_table: 'ncert_exercises'|'rag_content_chunks',
 *   question_text: string,
 *   student_answer: string,
 *   marks_possible: number,
 *   question_type: string
 * }
 *
 * POST body for save_attempt:
 * {
 *   action: 'save_attempt',
 *   student_id: string,
 *   question_id: string,
 *   source_table: string,
 *   subject: string,
 *   grade: string,
 *   chapter_number: number,
 *   question_type: string,
 *   marks_possible: number,
 *   student_answer?: string,
 *   selected_option?: number,
 *   marks_awarded: number,
 *   is_correct: boolean,
 *   ai_feedback?: string,
 *   ai_key_points?: {point: string, hit: boolean}[],
 *   model_answer?: string,
 *   time_spent?: number,
 *   session_id?: string
 * }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')!

// CBSE marks → question type mapping
const CBSE_TYPE_MAP: Record<string, { label: string; marksRange: [number, number]; timeSeconds: number; wordLimit: number }> = {
  mcq:           { label: 'MCQ',           marksRange: [1, 1],  timeSeconds: 60,  wordLimit: 0   },
  short_answer:  { label: 'Short Answer',  marksRange: [1, 2],  timeSeconds: 120, wordLimit: 40  },
  medium_answer: { label: 'Medium Answer', marksRange: [3, 4],  timeSeconds: 240, wordLimit: 100 },
  long_answer:   { label: 'Long Answer',   marksRange: [5, 6],  timeSeconds: 480, wordLimit: 200 },
  hots:          { label: 'HOTS',          marksRange: [4, 5],  timeSeconds: 360, wordLimit: 150 },
  numerical:     { label: 'Numerical',     marksRange: [2, 3],  timeSeconds: 180, wordLimit: 60  },
  intext:        { label: 'Intext',        marksRange: [1, 3],  timeSeconds: 150, wordLimit: 80  },
}

// ─── Helper: normalise grade string ──────────────────────────────────────────
function normaliseGrade(grade: string): string {
  return grade.replace(/^Grade\s*/i, '').trim()
}

// ─── Action: fetch_questions ──────────────────────────────────────────────────
async function fetchQuestions(body: Record<string, unknown>): Promise<Response> {
  const origin = body._origin as string | undefined
  const { student_id, subject, grade, chapter, question_type = 'all', count = 10 } = body as {
    student_id: string; subject: string; grade: string; chapter: number;
    question_type?: string; count?: number
  }

  if (!student_id || !subject || !grade || !chapter) {
    return errorResponse('student_id, subject, grade, chapter are required', 400, origin)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // Resolve "mixed" into multiple types
  const typeParam = question_type === 'mixed' ? 'all' : question_type

  const { data: rows, error } = await supabase.rpc('get_ncert_questions', {
    p_subject: subject,
    p_grade: grade,
    p_chapter: chapter,
    p_question_type: typeParam,
    p_limit: Math.min(count * 2, 60), // fetch extra for dedup
  })

  if (error) {
    console.error('get_ncert_questions error:', error)
    return errorResponse('Failed to fetch NCERT questions', 500, origin)
  }

  // Dedup by question_text prefix (first 80 chars)
  const seen = new Set<string>()
  const deduped = (rows ?? []).filter((q: Record<string, unknown>) => {
    const key = String(q.question_text ?? '').slice(0, 80).toLowerCase().trim()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // For mixed mode, enforce CBSE paper balance: ~40% MCQ, ~30% SA, ~20% MA, ~10% LA
  let selected = deduped
  if (question_type === 'mixed') {
    const mcq = deduped.filter((q: Record<string, unknown>) => q.question_type === 'mcq')
    const sa  = deduped.filter((q: Record<string, unknown>) => ['short_answer','intext'].includes(String(q.question_type)) && Number(q.marks_possible) <= 2)
    const ma  = deduped.filter((q: Record<string, unknown>) => Number(q.marks_possible) >= 3 && Number(q.marks_possible) <= 4)
    const la  = deduped.filter((q: Record<string, unknown>) => Number(q.marks_possible) >= 5 || ['long_answer','hots'].includes(String(q.question_type)))
    const n   = Math.max(count, 10)
    selected  = [
      ...mcq.slice(0, Math.ceil(n * 0.4)),
      ...sa.slice(0,  Math.ceil(n * 0.3)),
      ...ma.slice(0,  Math.ceil(n * 0.2)),
      ...la.slice(0,  Math.ceil(n * 0.1)),
    ].slice(0, count)
  } else {
    selected = deduped.slice(0, count)
  }

  // Enrich with CBSE metadata
  const enriched = selected.map((q: Record<string, unknown>) => {
    const qt = String(q.question_type ?? 'short_answer')
    const marks = Number(q.marks_possible ?? 1)
    let cbseType = qt
    if (qt === 'intext' || (qt === 'short_answer' && marks <= 2)) cbseType = 'short_answer'
    else if (qt === 'short_answer' && marks >= 3)                  cbseType = 'medium_answer'
    else if (qt === 'long_answer')                                  cbseType = 'long_answer'
    const meta = CBSE_TYPE_MAP[cbseType] ?? CBSE_TYPE_MAP.short_answer
    return { ...q, cbse_type: cbseType, cbse_label: meta.label, time_estimate: meta.timeSeconds, word_limit: meta.wordLimit }
  })

  return jsonResponse({ questions: enriched, total: enriched.length, chapter, subject, grade }, 200, {}, origin)
}

// ─── Rate limiter: evaluate_answer (Anthropic call, most expensive path) ─────
// 30 evaluations per student per 10-minute window stored in Supabase KV via
// a simple counter row in student_ncert_attempts aggregation.
// Uses a lightweight in-memory store keyed by student_id for the current
// Edge Function instance. At scale, use Upstash Redis or Supabase realtime.
const _evalWindows = new Map<string, { count: number; windowStart: number }>()
const EVAL_LIMIT = 30
const EVAL_WINDOW_MS = 10 * 60 * 1000 // 10 minutes

function checkEvalRateLimit(studentId: string): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now()
  const entry = _evalWindows.get(studentId)

  if (!entry || (now - entry.windowStart) > EVAL_WINDOW_MS) {
    _evalWindows.set(studentId, { count: 1, windowStart: now })
    return { allowed: true, retryAfterMs: 0 }
  }

  if (entry.count >= EVAL_LIMIT) {
    const retryAfterMs = EVAL_WINDOW_MS - (now - entry.windowStart)
    return { allowed: false, retryAfterMs }
  }

  entry.count++
  return { allowed: true, retryAfterMs: 0 }
}

// ─── Action: evaluate_answer ──────────────────────────────────────────────────
async function evaluateAnswer(body: Record<string, unknown>): Promise<Response> {
  const origin = body._origin as string | undefined
  const {
    student_id, question_id, source_table, question_text,
    student_answer, marks_possible, question_type
  } = body as {
    student_id: string; question_id: string; source_table: string;
    question_text: string; student_answer: string;
    marks_possible: number; question_type: string
  }

  if (!student_id || !question_id || !student_answer || !question_text) {
    return errorResponse('student_id, question_id, question_text, student_answer required', 400, origin)
  }
  if (!marks_possible || marks_possible < 1) {
    return errorResponse('marks_possible must be >= 1', 400, origin)
  }

  // Rate limit: 30 evaluations / 10 min per student (Anthropic cost protection)
  const rl = checkEvalRateLimit(student_id)
  if (!rl.allowed) {
    const retryAfterSec = Math.ceil(rl.retryAfterMs / 1000)
    return new Response(
      JSON.stringify({ error: 'Too many evaluation requests. Please wait before submitting more answers.', retry_after_seconds: retryAfterSec }),
      { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSec), ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}) } }
    )
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // Fetch model answer from source table
  let modelAnswer = ''
  let solutionSteps = ''
  if (source_table === 'ncert_exercises') {
    const { data } = await supabase.from('ncert_exercises').select('answer_text, solution_steps').eq('id', question_id).single()
    modelAnswer   = data?.answer_text ?? ''
    solutionSteps = data?.solution_steps ?? ''
  } else {
    const { data } = await supabase.from('rag_content_chunks').select('answer_text, chunk_text').eq('id', question_id).single()
    modelAnswer = data?.answer_text ?? data?.chunk_text ?? ''
  }

  // If no model answer in DB, use RAG to retrieve context
  if (!modelAnswer) {
    const { data: ragData } = await supabase
      .from('rag_content_chunks')
      .select('chunk_text')
      .ilike('question_text', `%${question_text.slice(0, 40)}%`)
      .limit(2)
    modelAnswer = (ragData ?? []).map((r: Record<string, string>) => r.chunk_text).join('\n')
  }

  // Build CBSE examiner prompt
  const cbseMeta = CBSE_TYPE_MAP[question_type] ?? CBSE_TYPE_MAP.short_answer
  const marksLabel = marks_possible === 1 ? '1 mark' : `${marks_possible} marks`

  const evalPrompt = `You are a strict but fair CBSE examiner evaluating a student's answer.

QUESTION (${cbseMeta.label}, ${marksLabel}):
${question_text}

MODEL ANSWER / KEY CONTENT:
${modelAnswer}
${solutionSteps ? `\nSOLUTION STEPS:\n${solutionSteps}` : ''}

STUDENT'S ANSWER:
${student_answer}

CBSE MARKING RULES:
- Total marks: ${marks_possible}
- Award full marks only if ALL key points are present
- Partial marks for partially correct answers (round to nearest 0.5)
- Deduct 0 marks for spelling mistakes unless it changes meaning
- Award 0 for irrelevant/blank answers
- For ${cbseMeta.label}: expected ~${cbseMeta.wordLimit} words

EVALUATE and respond in this EXACT JSON format (no extra text):
{
  "marks_awarded": <integer 0 to ${marks_possible}>,
  "percentage": <0-100>,
  "feedback": "<2-3 sentences: what was correct, what was missing, how to improve>",
  "key_points": [
    {"point": "<key concept from model answer>", "hit": true/false},
    ...
  ],
  "model_answer_summary": "<concise 1-3 sentence model answer suitable for a student to learn from>",
  "grade": "<Excellent|Good|Satisfactory|Needs Improvement>"
}`

  const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: evalPrompt }],
    }),
  })

  if (!aiResp.ok) {
    console.error('Anthropic eval error:', await aiResp.text())
    // Fallback: rough word-match scoring
    const wordMatch = roughWordMatch(student_answer, modelAnswer, marks_possible)
    return jsonResponse(wordMatch, 200, {}, origin)
  }

  const aiData = await aiResp.json()
  const rawText = aiData.content?.[0]?.text ?? '{}'

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(rawText)
  } catch {
    // Try to extract JSON from response
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    try { parsed = JSON.parse(jsonMatch?.[0] ?? '{}') } catch { parsed = {} }
  }

  const result = {
    marks_awarded:          Math.min(Math.max(0, Math.round(Number(parsed.marks_awarded ?? 0))), marks_possible),
    marks_possible,
    percentage:             Number(parsed.percentage ?? 0),
    feedback:               String(parsed.feedback ?? 'Please review the model answer.'),
    key_points:             Array.isArray(parsed.key_points) ? parsed.key_points : [],
    model_answer_summary:   String(parsed.model_answer_summary ?? modelAnswer.slice(0, 300)),
    grade:                  String(parsed.grade ?? 'Needs Improvement'),
    is_correct:             Number(parsed.marks_awarded ?? 0) >= marks_possible,
  }

  return jsonResponse(result, 200, {}, origin)
}

// ─── Fallback: rough word match scoring ──────────────────────────────────────
function roughWordMatch(studentAnswer: string, modelAnswer: string, maxMarks: number) {
  const studentWords = new Set(studentAnswer.toLowerCase().split(/\W+/).filter(w => w.length > 3))
  const modelWords   = modelAnswer.toLowerCase().split(/\W+/).filter(w => w.length > 3)
  const keyWords     = modelWords.slice(0, 20)
  const hits         = keyWords.filter(w => studentWords.has(w)).length
  const ratio        = keyWords.length > 0 ? hits / keyWords.length : 0
  const marks        = Math.round(ratio * maxMarks)
  return {
    marks_awarded: marks, marks_possible: maxMarks, percentage: Math.round(ratio * 100),
    feedback: 'Answer evaluated. Review the model answer to see key points.',
    key_points: keyWords.slice(0, 5).map(w => ({ point: w, hit: studentWords.has(w) })),
    model_answer_summary: modelAnswer.slice(0, 300),
    grade: ratio >= 0.8 ? 'Good' : ratio >= 0.5 ? 'Satisfactory' : 'Needs Improvement',
    is_correct: marks >= maxMarks,
  }
}

// ─── Action: save_attempt ────────────────────────────────────────────────────
async function saveAttempt(body: Record<string, unknown>): Promise<Response> {
  const origin = body._origin as string | undefined
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  const row = {
    student_id:     body.student_id,
    source_table:   body.source_table,
    question_id:    body.question_id,
    subject:        body.subject,
    grade:          normaliseGrade(String(body.grade ?? '')),
    chapter_number: body.chapter_number,
    question_type:  body.question_type,
    marks_possible: body.marks_possible,
    student_answer: body.student_answer ?? null,
    selected_option: body.selected_option ?? null,
    marks_awarded:  body.marks_awarded,
    is_correct:     body.is_correct,
    ai_feedback:    body.ai_feedback ?? null,
    ai_key_points:  body.ai_key_points ?? [],
    model_answer:   body.model_answer ?? null,
    time_spent:     body.time_spent ?? null,
    session_id:     body.session_id ?? null,
  }

  const { data, error } = await supabase.from('student_ncert_attempts').insert(row).select('id').single()
  if (error) {
    console.error('save_attempt error:', error)
    return errorResponse('Failed to save attempt', 500, origin)
  }
  return jsonResponse({ id: data.id, saved: true }, 200, {}, origin)
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  const corsH  = getCorsHeaders(origin)

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsH })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsH })
  }

  // Auth check
  const authHeader = req.headers.get('authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return errorResponse('Unauthorized', 401, origin)
  }
  const jwt = authHeader.split(' ')[1]
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const { error: authError } = await supabase.auth.getUser(jwt)
  if (authError) return errorResponse('Unauthorized', 401, origin)

  let body: Record<string, unknown>
  try {
    body = await req.json()
    body._origin = origin
  } catch {
    return errorResponse('Invalid JSON body', 400, origin)
  }

  const action = String(body.action ?? '')

  switch (action) {
    case 'fetch_questions': return fetchQuestions(body)
    case 'evaluate_answer': return evaluateAnswer(body)
    case 'save_attempt':    return saveAttempt(body)
    default:
      return errorResponse(`Unknown action "${action}". Valid: fetch_questions, evaluate_answer, save_attempt`, 400, origin)
  }
})
