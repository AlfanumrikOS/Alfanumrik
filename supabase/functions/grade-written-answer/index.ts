/**
 * grade-written-answer — Phase 3 Edge Function
 *
 * Grades a student's free-text SA / LA answer against question_bank's
 * expected_answer + answer_rubric using Claude Haiku, persists the attempt
 * into student_ncert_attempts (reused; source_table='question_bank'
 * distinguishes from NCERT-pulled attempts), and returns a structured score
 * + per-point breakdown + feedback.
 *
 * POST body:
 *   { question_id: string, student_answer: string, time_spent?: number, session_id?: string }
 *
 * Response:
 *   { attempt_id, marks_awarded, marks_possible, is_correct,
 *     point_breakdown: [{point, marks_awarded, marks_possible, met}],
 *     overall_feedback, improvement_tip, evaluation_grade, word_count }
 *
 * Auth: student JWT. Resolves to students.id via auth.uid().
 *
 * Anti-cheat:
 *   - min student_answer length 20 chars
 *   - max 1500 chars
 *   - rejects answers >= 0.6 chars-overlap with the question stem
 *     (catches copy-paste-question)
 *   - 100 gradings/student/day cap (defensive against abuse)
 *
 * P12 (AI safety):
 *   - input sanitised before being placed in user prompt
 *   - JSON-only output, validated, never echoed raw to UI
 *   - Claude clamped to grade only against rubric, not invent new criteria
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── Config ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || ''
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001'
const MIN_ANSWER_CHARS = 20
const MAX_ANSWER_CHARS = 1500
const DAILY_CAP_PER_STUDENT = 100

// ── CORS ────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = ['https://alfanumrik.com','https://www.alfanumrik.com','https://alfanumrik.vercel.app']
function getCorsHeaders(origin) {
  const ok = origin && (ALLOWED_ORIGINS.includes(origin) || (origin.endsWith('.vercel.app') && origin.includes('alfanumrik')) || origin.startsWith('http://localhost'))
  return {
    'Access-Control-Allow-Origin': ok ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
}
function jsonResponse(body, status = 200, origin) {
  return new Response(JSON.stringify(body), { status, headers: { ...getCorsHeaders(origin), 'Content-Type': 'application/json' } })
}
function errorResponse(message, status, origin) { return jsonResponse({ error: message }, status, origin) }

// ── Sanitise student answer ────────────────────────────────────────────────
function sanitizeAnswer(input) {
  if (!input) return ''
  let s = input.replace(/<\/?\s*[a-zA-Z][^>]{0,500}>/g, '')
  // Neutralise prompt-injection openers
  const patterns = [
    /\bignore (?:all )?(?:previous|above) instructions\b/gi,
    /\bsystem prompt\b/gi,
    /\byou are now\b/gi,
    /\bdisregard\s+(?:the\s+)?rubric\b/gi,
  ]
  for (const p of patterns) s = s.replace(p, '[neutralised]')
  return s.slice(0, MAX_ANSWER_CHARS).trim()
}

// ── Crude similarity check (catch copy-paste-question) ─────────────────────
function charOverlapRatio(a, b) {
  if (!a || !b) return 0
  const aWords = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 3))
  const bWords = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 3))
  if (aWords.size === 0) return 0
  let shared = 0
  for (const w of aWords) if (bWords.has(w)) shared++
  return shared / aWords.size
}

// ── Build CBSE-examiner prompt ─────────────────────────────────────────────
function buildSystemPrompt(grade, subject, qType, maxMarks) {
  const tier = qType === 'long_answer' ? 'long-answer (5-mark)' : 'short-answer (2-mark)'
  return `You are a CBSE Grade ${grade} ${subject} examiner grading a ${tier} student response.

GRADING RULES:
- Use ONLY the marking rubric provided. Do not invent new criteria.
- For each rubric point, decide whether the student's answer demonstrates that idea (met=true) or does not (met=false). Award the point's marks fully (met) or zero (not met). No partial within a single rubric point.
- Total marks_awarded = sum of marks for met points. Cap at max_marks=${maxMarks}.
- Be lenient on phrasing/spelling/synonyms. Be strict on factual content and key concepts.
- The expected_answer is the model answer; use it as ground truth for what each rubric point means in context.
- Provide warm but honest feedback. Identify what the student did well and one specific improvement.
- Bilingual feedback is NOT required — respond in English only. Use simple language a Grade ${grade} student understands.
- Return ONLY a JSON object matching the schema. No markdown fences, no extra text.`
}

function buildUserPrompt(question, expectedAnswer, rubric, studentAnswer, maxMarks) {
  const points = (rubric?.points ?? []).map((p, i) => `  ${i+1}. (${p.marks} mark${p.marks > 1 ? 's' : ''}) ${p.point}`).join('\n')
  return `QUESTION: ${question}

MODEL ANSWER (ground truth, do not show to student):
${expectedAnswer}

MARKING RUBRIC (sum of point marks must equal max_marks=${maxMarks}):
${points}

STUDENT ANSWER:
${studentAnswer}

Return ONLY this JSON object:
{
  "point_breakdown": [
    { "point_index": 1, "point": "<rubric point text>", "marks_possible": <int>, "met": <true|false>, "marks_awarded": <0 or marks_possible>, "comment": "<one-sentence explanation>" }
  ],
  "marks_awarded": <int 0..${maxMarks}>,
  "overall_feedback": "<2-3 warm sentences summarising what student did well + one specific improvement>",
  "improvement_tip": "<one concrete actionable tip for next time>",
  "evaluation_grade": "<excellent|good|fair|weak>"
}

Guidelines for evaluation_grade:
  excellent: marks_awarded == max_marks
  good:      marks_awarded >= max_marks * 0.7
  fair:      marks_awarded >= max_marks * 0.4
  weak:      below that`
}

// ── Claude caller ──────────────────────────────────────────────────────────
async function callClaude(systemPrompt, userPrompt) {
  if (!ANTHROPIC_API_KEY) return { ok: false, error: 'ANTHROPIC_API_KEY not configured' }
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 1500, temperature: 0.2, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] }),
    })
    if (!res.ok) return { ok: false, error: `Claude API ${res.status}: ${(await res.text()).slice(0, 300)}` }
    const body = await res.json()
    const text = body.content?.find(c => c.type === 'text')?.text ?? ''
    if (!text) return { ok: false, error: 'Claude returned empty content' }
    return { ok: true, text }
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) } }
}

function parseGradingResponse(text, maxMarks, rubricPointsCount) {
  const stripped = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
  const start = stripped.indexOf('{'); const end = stripped.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let parsed
  try { parsed = JSON.parse(stripped.slice(start, end + 1)) } catch { return null }
  if (!parsed || typeof parsed !== 'object') return null
  if (!Array.isArray(parsed.point_breakdown)) return null
  // Validate per-point shape
  for (const p of parsed.point_breakdown) {
    if (typeof p.marks_possible !== 'number' || typeof p.marks_awarded !== 'number' || typeof p.met !== 'boolean') return null
    if (p.marks_awarded < 0 || p.marks_awarded > p.marks_possible) return null
  }
  // Recompute marks_awarded from breakdown to defend against Claude arithmetic errors
  const recomputed = parsed.point_breakdown.reduce((acc, p) => acc + (p.met ? p.marks_possible : 0), 0)
  const marksAwarded = Math.min(maxMarks, Math.max(0, recomputed))
  if (typeof parsed.overall_feedback !== 'string' || parsed.overall_feedback.trim().length < 5) return null
  if (typeof parsed.improvement_tip !== 'string') return null
  if (!['excellent','good','fair','weak'].includes(parsed.evaluation_grade)) return null
  return {
    point_breakdown: parsed.point_breakdown,
    marks_awarded: marksAwarded,
    overall_feedback: parsed.overall_feedback.trim(),
    improvement_tip: parsed.improvement_tip.trim(),
    evaluation_grade: parsed.evaluation_grade,
  }
}

// ── Main handler ───────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: getCorsHeaders(origin) })
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405, origin)

  // 1. Auth — student JWT
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return errorResponse('Missing or invalid Authorization header', 401, origin)
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } })
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) return errorResponse('Invalid or expired token', 401, origin)
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const { data: studentRow, error: studentRowErr } = await admin.from('students').select('id').eq('auth_user_id', user.id).maybeSingle()
  // Fail CLOSED (403) is already correct and is preserved. But "not a student"
  // and "we could not check" are different facts — the second would 403 every
  // student at once, with no signal. P13: no ids in the log.
  if (studentRowErr) {
    console.error('[grade-written-answer] student lookup failed:', studentRowErr.code, studentRowErr.message)
  }
  if (studentRowErr || !studentRow) return errorResponse('Student not found', 403, origin)
  const studentId = studentRow.id

  // 2. Parse + validate body
  let body
  try { body = await req.json() } catch { return errorResponse('Invalid JSON body', 400, origin) }
  const questionId = String(body.question_id ?? '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(questionId)) return errorResponse('question_id must be a UUID', 400, origin)
  const studentAnswerRaw = String(body.student_answer ?? '')
  const studentAnswer = sanitizeAnswer(studentAnswerRaw)
  if (studentAnswer.length < MIN_ANSWER_CHARS) return errorResponse(`Answer must be at least ${MIN_ANSWER_CHARS} characters`, 400, origin)
  const timeSpent = Number.isFinite(Number(body.time_spent)) ? Math.max(0, Math.floor(Number(body.time_spent))) : null
  const sessionId = typeof body.session_id === 'string' && /^[0-9a-f-]{36}$/i.test(body.session_id) ? body.session_id : null

  // 3. Daily cap
  const todayStart = new Date(); todayStart.setUTCHours(0,0,0,0)
  const { count: todayCount } = await admin.from('student_ncert_attempts')
    .select('*', { count: 'exact', head: true })
    .eq('student_id', studentId)
    .gte('created_at', todayStart.toISOString())
  if ((todayCount ?? 0) >= DAILY_CAP_PER_STUDENT) {
    return errorResponse('Daily grading limit reached. Try again tomorrow.', 429, origin)
  }

  // 4. Lookup question
  const { data: q, error: qErr } = await admin.from('question_bank').select('id, question_text, expected_answer, answer_rubric, max_marks, marks_expected, marks, subject, grade, chapter_number, question_type_v2').eq('id', questionId).maybeSingle()
  if (qErr || !q) return errorResponse('Question not found', 404, origin)
  const maxMarks = q.max_marks ?? q.marks_expected ?? q.marks ?? 2
  const expectedAnswer = q.expected_answer ?? q.question_text
  const rubric = q.answer_rubric ?? { points: [{ point: 'Answer demonstrates understanding of the topic', marks: maxMarks }] }
  const qType = q.question_type_v2 ?? 'short_answer'
  if (!['short_answer','long_answer'].includes(qType)) {
    return errorResponse('This question is not gradable as written-answer (use the MCQ flow instead).', 400, origin)
  }

  // 5. Anti-cheat: copy-paste-question detection
  const overlap = charOverlapRatio(studentAnswer, q.question_text ?? '')
  if (overlap >= 0.6 && studentAnswer.length < (q.question_text?.length ?? 0) * 1.2) {
    return errorResponse('Your answer looks like a copy of the question. Please write your own answer.', 400, origin)
  }

  // 6. Build prompts + call Claude
  const systemPrompt = buildSystemPrompt(q.grade, q.subject, qType, maxMarks)
  const userPrompt = buildUserPrompt(q.question_text, expectedAnswer, rubric, studentAnswer, maxMarks)
  const claudeResult = await callClaude(systemPrompt, userPrompt)
  if (!claudeResult.ok) return errorResponse(`Grading failed: ${claudeResult.error}`, 503, origin)

  const rubricPointsCount = Array.isArray(rubric.points) ? rubric.points.length : 1
  const parsed = parseGradingResponse(claudeResult.text, maxMarks, rubricPointsCount)
  if (!parsed) return errorResponse('Grader returned an unparseable response. Please try again.', 502, origin)

  const isCorrect = parsed.marks_awarded >= maxMarks * 0.7
  const wordCount = studentAnswer.split(/\s+/).filter(w => w.length > 0).length

  // 7. Persist attempt
  const { data: attemptRow, error: insErr } = await admin.from('student_ncert_attempts').insert({
    student_id: studentId,
    source_table: 'question_bank',
    question_id: questionId,
    subject: q.subject,
    grade: q.grade,
    chapter_number: q.chapter_number,
    question_type: qType,
    marks_possible: maxMarks,
    marks_awarded: parsed.marks_awarded,
    student_answer: studentAnswer,
    is_correct: isCorrect,
    ai_feedback: parsed.overall_feedback,
    ai_key_points: { breakdown: parsed.point_breakdown },
    model_answer: expectedAnswer,
    point_breakdown: parsed.point_breakdown,
    overall_feedback: parsed.overall_feedback,
    improvement_tip: parsed.improvement_tip,
    evaluation_grade: parsed.evaluation_grade,
    word_count: wordCount,
    time_spent: timeSpent,
    session_id: sessionId,
    attempt_number: 1,
    subject_code: q.subject,
  }).select('id').single()
  if (insErr) return errorResponse(`Could not save attempt: ${insErr.message.slice(0, 200)}`, 500, origin)

  // 8. Done. Return the structured result for the UI.
  return jsonResponse({
    attempt_id: attemptRow.id,
    marks_awarded: parsed.marks_awarded,
    marks_possible: maxMarks,
    is_correct: isCorrect,
    point_breakdown: parsed.point_breakdown,
    overall_feedback: parsed.overall_feedback,
    improvement_tip: parsed.improvement_tip,
    evaluation_grade: parsed.evaluation_grade,
    word_count: wordCount,
  }, 200, origin)
})
