/**
 * bulk-question-gen – Alfanumrik Edge Function
 *
 * Admin-only endpoint: generates CBSE multiple-choice questions in bulk
 * using the Claude API and inserts them into the `question_bank` table.
 *
 * POST body:
 * {
 *   grade:       string  – "6" through "12" (required)
 *   subject:     string  – e.g. "science", "math" (required)
 *   chapter:     string  – chapter name / title (required)
 *   chapter_id?: string  – UUID of the chapter in curriculum_topics (optional)
 *   count?:      number  – questions to generate, 1-50 (default 10)
 *   difficulty?: number  – 1-5 scale (default 3)
 *   bloom_level?: string – Bloom's taxonomy level (default "remember")
 * }
 *
 * Response:
 * {
 *   generated: number     – questions produced by Claude
 *   inserted:  number     – questions successfully inserted into DB
 *   questions: Question[] – inserted question records
 * }
 *
 * Auth:
 *   Requires a valid Supabase user JWT whose auth_user_id is present in
 *   admin_users with admin_level IN ('admin', 'super_admin').
 *
 * Safety (P12):
 *   - Questions are CBSE curriculum-scoped via the system prompt
 *   - All Claude output is validated before being stored
 *   - Age-appropriate guardrails enforced in the system prompt
 *   - Circuit breaker: 3 failures in 60 s → return 503, no retry loop
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts'
import {
  callGroundedAnswer,
  isFeatureFlagEnabled,
  type GroundedRequest,
} from '../_shared/grounded-client.ts'
import {
  validateCandidate,
  parseLlmGraderResponse,
  makeCandidateCacheKey,
  getCachedResult,
  setCachedResult,
  type CandidateQuestion,
  type LlmGradeResult,
  type OracleResult,
} from '../_shared/quiz-oracle.ts'
import {
  QUIZ_ORACLE_GRADER_SYSTEM_PROMPT,
  buildQuizOracleGraderUserPrompt,
} from '../_shared/quiz-oracle-prompts.ts'
import { logOpsEvent } from '../_shared/ops-events.ts'

// ─── Environment ──────────────────────────────────────────────────────────────
const ANTHROPIC_API_KEY   = Deno.env.get('ANTHROPIC_API_KEY')   || ''
const SUPABASE_URL        = Deno.env.get('SUPABASE_URL')        || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_COUNT   = 50
const DEFAULT_COUNT      = 10
const DEFAULT_DIFFICULTY = 3
const DEFAULT_BLOOM      = 'remember'

const VALID_GRADES      = ['6','7','8','9','10','11','12']
const VALID_BLOOM_LEVELS = ['remember','understand','apply','analyze','evaluate','create']

// CBSE subject allowlist per grade (assessment requirement — prevent nonsense subjects)
// Subjects stored lowercase; input is normalised before lookup.
const VALID_SUBJECTS_BY_GRADE: Record<string, string[]> = {
  '6':  ['math', 'science', 'english', 'hindi', 'social_studies', 'social studies'],
  '7':  ['math', 'science', 'english', 'hindi', 'social_studies', 'social studies'],
  '8':  ['math', 'science', 'english', 'hindi', 'social_studies', 'social studies'],
  '9':  ['math', 'science', 'english', 'hindi', 'social_studies', 'social studies', 'physics', 'chemistry', 'biology'],
  '10': ['math', 'science', 'english', 'hindi', 'social_studies', 'social studies', 'physics', 'chemistry', 'biology'],
  '11': ['math', 'physics', 'chemistry', 'biology', 'english', 'hindi', 'economics', 'accountancy', 'business_studies', 'business studies', 'history', 'geography', 'political_science', 'political science'],
  '12': ['math', 'physics', 'chemistry', 'biology', 'english', 'hindi', 'economics', 'accountancy', 'business_studies', 'business studies', 'history', 'geography', 'political_science', 'political science'],
}

/** Returns true if the subject is a known CBSE subject for the given grade. */
function isValidSubjectForGrade(grade: string, subject: string): boolean {
  const allowed = VALID_SUBJECTS_BY_GRADE[grade]
  if (!allowed) return false
  return allowed.includes(subject.toLowerCase().trim())
}

// ─── Circuit breaker (P12 — must always have fallback) ───────────────────────
const circuitBreaker = {
  failures:         0,
  lastFailureAt:    0,
  state:            'closed' as 'closed' | 'open' | 'half-open',
  FAILURE_THRESHOLD: 3,
  RESET_TIMEOUT_MS:  60_000,

  canRequest(): boolean {
    if (this.state === 'closed') return true
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureAt > this.RESET_TIMEOUT_MS) {
        this.state = 'half-open'
        return true
      }
      return false
    }
    // half-open: allow one probe
    return true
  },
  recordSuccess(): void { this.failures = 0; this.state = 'closed' },
  recordFailure(): void {
    this.failures++
    this.lastFailureAt = Date.now()
    if (this.failures >= this.FAILURE_THRESHOLD) this.state = 'open'
  },
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface GeneratedQuestion {
  question_text:       string
  options:             string[]
  correct_answer_index: number
  explanation:         string
  hint:                string
  difficulty:          number
  bloom_level:         string
}

interface InsertedQuestion extends GeneratedQuestion {
  id:      string
  subject: string
  grade:   string
  chapter: string
}

// ─── Auth: service-role or admin/super_admin user ────────────────────────────

async function verifyAdminAuth(
  req: Request,
): Promise<{ authorized: true } | { authorized: false; error: string; status: number }> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return { authorized: false, error: 'Missing or invalid Authorization header', status: 401 }
  }

  const token = authHeader.replace('Bearer ', '')

  // Verify the JWT by calling getUser() against Supabase Auth.
  // Admin callers must supply a user JWT with role = "admin" or "super_admin"
  // in the profiles table.  The service-role key must NOT be passed as a bearer
  // token over the wire — use server-side Supabase admin client calls instead.
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
  const userClient = createClient(SUPABASE_URL, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  const { data: { user }, error: authError } = await userClient.auth.getUser()

  if (authError || !user) {
    return { authorized: false, error: 'Invalid or expired token', status: 401 }
  }

  // Require auth_user_id present in admin_users with admin_level IN ('admin', 'super_admin').
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const { data: adminRecord, error: adminErr } = await adminClient
    .from('admin_users')
    .select('admin_level')
    .eq('auth_user_id', user.id)
    .eq('is_active', true)
    .maybeSingle()

  if (adminErr || !adminRecord) {
    return { authorized: false, error: 'Admin access required', status: 403 }
  }

  const ADMIN_LEVELS = ['admin', 'super_admin']
  if (!ADMIN_LEVELS.includes(adminRecord.admin_level)) {
    return { authorized: false, error: 'Admin access required', status: 403 }
  }

  return { authorized: true }
}

// ─── Prompt builder ──────────────────────────────────────────────────────────

function buildPrompt(
  grade:      string,
  subject:    string,
  chapter:    string,
  count:      number,
  difficulty: number,
  bloomLevel: string,
): string {
  return `Generate ${count} CBSE Grade ${grade} ${subject} multiple-choice questions for chapter: "${chapter}".

Requirements:
- Each question must test a specific concept from this chapter
- 4 answer options, exactly one correct
- Include a clear explanation (2-3 sentences)
- Include a hint (one helpful clue without giving away the answer)
- Difficulty: ${difficulty} (1=easy, 3=medium, 5=hard)
- Bloom's level: ${bloomLevel}
- Age-appropriate for Grade ${grade} students
- Stay strictly within the CBSE curriculum scope for this chapter
- Do not include any violent, adult, or off-topic content

Return ONLY a valid JSON array — no markdown fences, no extra text — with this exact structure:
[{
  "question_text": "...",
  "options": ["A", "B", "C", "D"],
  "correct_answer_index": 0,
  "explanation": "...",
  "hint": "...",
  "difficulty": ${difficulty},
  "bloom_level": "${bloomLevel}"
}]`
}

function buildSystemPrompt(grade: string, subject: string): string {
  return `You are a CBSE curriculum question-generation assistant for an Indian K-12 EdTech platform.
You produce exam-quality multiple-choice questions for Grade ${grade} ${subject}.

RULES:
- Follow the NCERT/CBSE syllabus strictly. Do not go beyond the grade-level curriculum.
- All content must be age-appropriate for Grade ${grade} students (approx. ages ${String(10 + Number(grade) - 6)}–${String(11 + Number(grade) - 6)}).
- No violence, adult content, political opinions, religion-based bias, or off-topic material.
- Questions must be factually accurate; incorrect options must be plausible but clearly wrong on reflection.
- Explanations must be clear and educational — 2-3 sentences maximum.
- Return ONLY the JSON array as instructed. No commentary.`
}

// ─── Question validator (P6 compliance) ──────────────────────────────────────

function isValidQuestion(q: unknown): q is GeneratedQuestion {
  if (!q || typeof q !== 'object') return false
  const item = q as Record<string, unknown>

  // question_text: non-empty, no template placeholders
  if (typeof item.question_text !== 'string') return false
  const text = item.question_text.trim()
  if (!text || text.includes('{{') || text.includes('[BLANK]')) return false

  // options: exactly 4 distinct non-empty strings
  if (!Array.isArray(item.options) || item.options.length !== 4) return false
  const opts = item.options as unknown[]
  if (!opts.every(o => typeof o === 'string' && (o as string).trim().length > 0)) return false
  const uniqueOpts = new Set((opts as string[]).map(o => o.trim().toLowerCase()))
  if (uniqueOpts.size !== 4) return false

  // correct_answer_index: integer 0-3
  if (typeof item.correct_answer_index !== 'number') return false
  const idx = item.correct_answer_index
  if (!Number.isInteger(idx) || idx < 0 || idx > 3) return false

  // explanation: non-empty string
  if (typeof item.explanation !== 'string' || !item.explanation.trim()) return false

  // hint: non-empty string
  if (typeof item.hint !== 'string' || !item.hint.trim()) return false

  // difficulty: 1-5
  if (typeof item.difficulty !== 'number') return false
  const diff = item.difficulty
  if (!Number.isInteger(diff) || diff < 1 || diff > 5) return false

  // bloom_level: valid level
  if (typeof item.bloom_level !== 'string') return false
  if (!VALID_BLOOM_LEVELS.includes(item.bloom_level.toLowerCase())) return false

  return true
}

// ─── Claude API call ─────────────────────────────────────────────────────────

async function callClaude(
  systemPrompt: string,
  userPrompt:   string,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  if (!circuitBreaker.canRequest()) {
    return { ok: false, error: 'Claude API circuit breaker is open. Try again in a moment.' }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 45_000) // 45 s for bulk calls

  try {
    // eslint-disable-next-line alfanumrik/no-direct-ai-calls -- TODO(phase-4-cleanup): bulk-question-gen is a batch back-office ingestion path that predates grounded-answer; route through service when bulk grounding API is added.
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 8192, // up to 50 questions × ~150 tokens each
        temperature: 0.3, // factual generation — low temperature (P12 compliance)
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userPrompt }],
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      circuitBreaker.recordFailure()
      return { ok: false, error: `Claude API error ${res.status}: ${body.slice(0, 200)}` }
    }

    const data = await res.json()
    const text: string = data?.content?.[0]?.text || ''
    circuitBreaker.recordSuccess()
    return { ok: true, text }

  } catch (err) {
    circuitBreaker.recordFailure()
    const msg = err instanceof DOMException && err.name === 'AbortError'
      ? 'Claude API timeout (45 s)'
      : String(err)
    return { ok: false, error: msg }
  } finally {
    clearTimeout(timeoutId)
  }
}

// ─── JSON array extractor ─────────────────────────────────────────────────────

/**
 * Extracts the first JSON array from a string.
 * Claude occasionally wraps output in markdown fences despite instructions,
 * so we strip those before parsing.
 */
function extractJsonArray(text: string): unknown[] | null {
  // Strip markdown fences if present
  const stripped = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/,      '')
    .replace(/\s*```$/,      '')
    .trim()

  // Find the first '[' and last ']'
  const start = stripped.indexOf('[')
  const end   = stripped.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) return null

  try {
    const parsed = JSON.parse(stripped.slice(start, end + 1))
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

// ─── Quiz validation oracle (REG-54) ─────────────────────────────────────────
//
// Validates each candidate via deterministic P6 checks + an LLM grader
// (Claude Haiku). Gated by `ff_quiz_oracle_enabled` (default OFF in prod).
//
// Worst-case cost per accepted question:
//   - 1 generator call (status quo)
//   - 1 oracle LLM-grader call
//   - 1 retry generator call (when oracle rejects on first try)
//   - 1 retry oracle LLM-grader call
//   = 4 Claude calls absolute worst case for an accepted question.
//   Typical (oracle approves first try): 2 Claude calls.
//
// Rejections are logged to ops_events with category='quiz.oracle_rejection'
// (severity='info' — rejections are expected, that's the oracle working).

const ORACLE_LLM_GRADER_TIMEOUT_MS = 12_000 // single-turn JSON ~ small payload

/**
 * Call Claude as the oracle's LLM grader. Returns a structured verdict or
 * throws on hard failure (network, timeout, parse). The oracle module catches
 * thrown errors and surfaces them as 'llm_grader_unavailable' rejections.
 */
async function callOracleGrader(input: {
  question_text: string
  options: string[]
  correct_answer_index: number
  explanation: string
}): Promise<LlmGradeResult> {
  const userPrompt = buildQuizOracleGraderUserPrompt(input)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), ORACLE_LLM_GRADER_TIMEOUT_MS)

  try {
    // eslint-disable-next-line alfanumrik/no-direct-ai-calls -- TODO(phase-4-cleanup): oracle grader is a back-office content-audit path; route through grounded service when an unscoped LLM-grader API exists.
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256, // grader returns one-line JSON
        temperature: 0,  // factual audit — no creativity (P12)
        system: QUIZ_ORACLE_GRADER_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Oracle grader HTTP ${res.status}: ${body.slice(0, 200)}`)
    }
    const data = await res.json()
    const text: string = data?.content?.[0]?.text || ''
    const parsed = parseLlmGraderResponse(text)
    if (!parsed) {
      // Treat unparseable grader output as ambiguous — caller will reject.
      return { verdict: 'ambiguous', reasoning: 'grader returned unparseable JSON' }
    }
    return parsed
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Oracle grader timeout (12s)')
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Validate one candidate question with caching. Returns OracleResult.
 * Logs rejections (NOT acceptances) to ops_events for audit visibility.
 */
async function validateWithCacheAndLogging(
  candidate: CandidateQuestion,
  ctx: {
    grade: string
    subject: string
    chapter: string
    enableLlmGrader: boolean
  },
): Promise<OracleResult> {
  const cacheKey = makeCandidateCacheKey(candidate)
  const cached = getCachedResult(cacheKey)
  if (cached) return cached

  const result = await validateCandidate(candidate, {
    enableLlmGrader: ctx.enableLlmGrader,
    llmGrade: ctx.enableLlmGrader ? callOracleGrader : undefined,
  })
  setCachedResult(cacheKey, result)

  if (!result.ok) {
    // Log rejection (no PII — generated content is not student data per P13).
    await logOpsEvent({
      category: 'quiz.oracle_rejection',
      source: 'bulk-question-gen',
      severity: 'info',
      message: `Oracle rejected candidate: ${result.category}`,
      context: {
        grade: ctx.grade,
        subject: ctx.subject,
        chapter: ctx.chapter,
        category: result.category,
        reason: result.reason,
        suggested_correct_index: result.suggested_correct_index ?? null,
        llm_calls: result.llm_calls,
        // First 80 chars of question_text for triage (not PII).
        question_preview: candidate.question_text.slice(0, 80),
      },
    })
  }

  return result
}

// ─── Two-pass grounded generation + verification (Phase 3) ───────────────────
//
// When ff_grounded_ai_quiz_generator is ON, bulk-question-gen routes through
// the grounded-answer Edge Function for BOTH the draft question AND the
// verification pass. The verifier's job is to confirm that the draft
// question's claimed correct answer is supported by the NCERT chunks the
// generator cited. See spec §7.2.
//
// Contract with the verifier template (quiz_answer_verifier_v1):
//   query: JSON representation of { question_text, options, correct_answer_index }
//   → JSON response: { verified, reason, correct_option_index, supporting_chunk_ids }
//
// verification_state mapping:
//   verified=true  AND correct_option_index === draft.correct_answer_index → 'verified'
//   everything else (disagreement, parse error, abstain)                    → 'failed'
//
// Failed rows stay in question_bank with verified_against_ncert=false so
// admin review can intervene; they are NOT served to students because
// idx_question_bank_verified filters on verified_against_ncert=true.

interface DraftQuestionFromService {
  question_text: string
  options: string[]
  correct_answer_index: number
  explanation: string
  difficulty?: string | number
  bloom_level?: string
  supporting_chunk_ids?: string[]
}

interface VerifierResponse {
  verified: boolean
  reason: string
  correct_option_index: number | null
  supporting_chunk_ids: string[]
}

/**
 * Format a draft question for the verifier prompt template. The template
 * receives this as the {{question_json}} variable embedded inside the
 * verifier's system prompt.
 */
function formatForVerification(draft: DraftQuestionFromService): string {
  return JSON.stringify({
    question_text: draft.question_text,
    options: draft.options,
    claimed_correct_answer_index: draft.correct_answer_index,
  })
}

/**
 * Map the verifier-flavoured difficulty strings back to the question_bank
 * numeric scale used by the legacy path (1=easy, 3=medium, 5=hard).
 */
function normaliseDifficulty(raw: string | number | undefined, fallback: number): number {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= 5) return raw
  if (typeof raw === 'string') {
    const lower = raw.toLowerCase()
    if (lower === 'easy') return 1
    if (lower === 'medium') return 3
    if (lower === 'hard') return 5
  }
  return fallback
}

/**
 * Parse the generator's JSON answer. Returns null if parse fails or if the
 * service returned the sentinel `{"error": "insufficient_source"}` payload.
 */
function parseDraftJson(rawAnswer: string): DraftQuestionFromService | null {
  let parsed: unknown
  try {
    // The generator is instructed to return strict JSON. Some Claude runs
    // still wrap it in ```json fences — strip both patterns defensively.
    const stripped = rawAnswer
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/, '')
      .replace(/\s*```$/, '')
      .trim()
    parsed = JSON.parse(stripped)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>
  if ('error' in obj) return null // insufficient_source sentinel
  if (typeof obj.question_text !== 'string') return null
  if (!Array.isArray(obj.options) || obj.options.length !== 4) return null
  if (!obj.options.every((o) => typeof o === 'string')) return null
  if (typeof obj.correct_answer_index !== 'number') return null
  if (
    !Number.isInteger(obj.correct_answer_index) ||
    obj.correct_answer_index < 0 ||
    obj.correct_answer_index > 3
  ) {
    return null
  }
  if (typeof obj.explanation !== 'string') return null
  return {
    question_text: obj.question_text,
    options: obj.options as string[],
    correct_answer_index: obj.correct_answer_index,
    explanation: obj.explanation,
    difficulty: obj.difficulty as string | number | undefined,
    bloom_level: obj.bloom_level as string | undefined,
    supporting_chunk_ids: Array.isArray(obj.supporting_chunk_ids)
      ? (obj.supporting_chunk_ids as string[])
      : undefined,
  }
}

function parseVerifierJson(rawAnswer: string): VerifierResponse | null {
  try {
    const stripped = rawAnswer
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/, '')
      .replace(/\s*```$/, '')
      .trim()
    const parsed = JSON.parse(stripped) as Record<string, unknown>
    if (typeof parsed.verified !== 'boolean') return null
    const reason = typeof parsed.reason === 'string' ? parsed.reason : ''
    const idxRaw = parsed.correct_option_index
    const correct_option_index: number | null =
      idxRaw === null
        ? null
        : typeof idxRaw === 'number' && Number.isInteger(idxRaw) && idxRaw >= 0 && idxRaw <= 3
        ? idxRaw
        : null
    const supporting_chunk_ids = Array.isArray(parsed.supporting_chunk_ids)
      ? (parsed.supporting_chunk_ids as string[]).filter((x) => typeof x === 'string')
      : []
    return {
      verified: parsed.verified,
      reason,
      correct_option_index,
      supporting_chunk_ids,
    }
  } catch {
    return null
  }
}

interface GroundedInsertRow {
  question_text: string
  options: string[]
  correct_answer_index: number
  explanation: string
  hint: string
  difficulty: number
  bloom_level: string
  subject: string
  grade: string
  chapter_title: string
  topic_id?: string
  chapter_number?: number
  source: string
  is_active: boolean
  created_at: string
  verification_state: 'verified' | 'failed'
  verified_against_ncert: boolean
  verifier_chunk_ids: string[] | null
  verifier_model: string | null
  verifier_trace_id: string | null
  verified_at: string
  verifier_failure_reason?: string
}

async function generateAndVerifyOne(params: {
  grade: string
  subject: string
  chapter: string
  chapterNumber: number | null
  chapterId: string | null
  bloomLevel: string
  fallbackDifficulty: number
}): Promise<
  | { ok: true; row: GroundedInsertRow }
  | { ok: false; reason: string }
> {
  const { grade, subject, chapter, chapterNumber, chapterId, bloomLevel, fallbackDifficulty } =
    params

  // ── Pass 1: generator (strict mode) ────────────────────────────────────
  const generatorRequest: GroundedRequest = {
    caller: 'quiz-generator',
    student_id: null,
    query: `Generate one CBSE ${bloomLevel}-level MCQ for Grade ${grade} ${subject} on the topic: ${chapter}.`,
    scope: {
      board: 'CBSE',
      grade,
      subject_code: subject,
      chapter_number: chapterNumber,
      chapter_title: chapter,
    },
    mode: 'strict',
    generation: {
      model_preference: 'auto',
      max_tokens: 1024,
      temperature: 0.3,
      system_prompt_template: 'quiz_question_generator_v1',
      template_variables: {
        grade,
        subject,
        chapter_suffix: chapter ? ` (Chapter: ${chapter})` : '',
      },
    },
    retrieval: { match_count: 6 },
    timeout_ms: 45_000,
  }

  const draftResp = await callGroundedAnswer(generatorRequest, { hopTimeoutMs: 50_000 })
  if (!draftResp.grounded) {
    return { ok: false, reason: `generator_abstain:${draftResp.abstain_reason}` }
  }

  const draft = parseDraftJson(draftResp.answer)
  if (!draft) {
    return { ok: false, reason: 'generator_parse_error' }
  }

  // ── Pass 2: verifier (strict mode) ────────────────────────────────────
  const verifierRequest: GroundedRequest = {
    caller: 'quiz-generator',
    student_id: null,
    query: formatForVerification(draft),
    scope: {
      board: 'CBSE',
      grade,
      subject_code: subject,
      chapter_number: chapterNumber,
      chapter_title: chapter,
    },
    mode: 'strict',
    generation: {
      model_preference: 'auto',
      max_tokens: 512,
      temperature: 0,
      system_prompt_template: 'quiz_answer_verifier_v1',
      template_variables: {
        grade,
        subject,
        chapter_suffix: chapter ? ` (Chapter: ${chapter})` : '',
        question_json: formatForVerification(draft),
      },
    },
    retrieval: { match_count: 6 },
    timeout_ms: 20_000,
  }

  const verifyResp = await callGroundedAnswer(verifierRequest, { hopTimeoutMs: 25_000 })

  let verificationState: 'verified' | 'failed' = 'failed'
  let verifyFailureReason: string | undefined
  let verifierChunkIds: string[] = []
  let verifierModel: string | null = null
  let verifierTraceId: string | null = null

  // verifier_trace_id is a uuid column. Reject the client-synthesized
  // non-UUID sentinel trace ids (config-missing / hop-timeout / service-*).
  const UUID_RE_TRACE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const safeTraceId = (id: string | undefined): string | null =>
    id && UUID_RE_TRACE.test(id) ? id : null

  if (!verifyResp.grounded) {
    verifyFailureReason = `verifier_abstain:${verifyResp.abstain_reason}`
    verifierTraceId = safeTraceId(verifyResp.trace_id)
  } else {
    const parsedVerify = parseVerifierJson(verifyResp.answer)
    verifierModel = verifyResp.meta.claude_model
    verifierTraceId = safeTraceId(verifyResp.trace_id)
    if (!parsedVerify) {
      verifyFailureReason = 'verifier_parse_error'
    } else if (
      parsedVerify.verified &&
      parsedVerify.correct_option_index === draft.correct_answer_index
    ) {
      verificationState = 'verified'
      verifierChunkIds = parsedVerify.supporting_chunk_ids
    } else {
      verifyFailureReason = `verifier_disagree: ${parsedVerify.reason}`.slice(0, 300)
      verifierChunkIds = parsedVerify.supporting_chunk_ids
    }
  }

  const chapterId_trimmed = chapterId?.trim().slice(0, 36) || null

  // UUID validation. If `verifier_chunk_ids` comes back with non-UUID strings
  // (unlikely but possible under malformed Claude output), drop them so the
  // uuid[] column insert doesn't error. See question_bank.verifier_chunk_ids.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const cleanChunkIds = verifierChunkIds.filter((x) => UUID_RE.test(x))

  const row: GroundedInsertRow = {
    question_text: draft.question_text.trim(),
    options: draft.options.map((o) => o.trim()),
    correct_answer_index: draft.correct_answer_index,
    explanation: draft.explanation.trim(),
    hint: '', // generator doesn't produce a hint in grounded mode
    difficulty: normaliseDifficulty(draft.difficulty, fallbackDifficulty),
    bloom_level: (draft.bloom_level ?? bloomLevel).toLowerCase(),
    subject,
    grade,
    chapter_title: chapter,
    ...(chapterId_trimmed ? { topic_id: chapterId_trimmed } : {}),
    ...(chapterNumber !== null ? { chapter_number: chapterNumber } : {}),
    source: 'ai_generated_grounded',
    is_active: verificationState === 'verified',
    created_at: new Date().toISOString(),
    verification_state: verificationState,
    verified_against_ncert: verificationState === 'verified',
    verifier_chunk_ids: cleanChunkIds.length > 0 ? cleanChunkIds : null,
    verifier_model: verifierModel,
    verifier_trace_id: verifierTraceId,
    verified_at: new Date().toISOString(),
    ...(verifyFailureReason ? { verifier_failure_reason: verifyFailureReason } : {}),
  }

  return { ok: true, row }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  const cors   = getCorsHeaders(origin)

  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405, origin)
  }

  if (!ANTHROPIC_API_KEY) {
    return errorResponse('Bulk question generation is not configured (missing API key)', 503, origin)
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return errorResponse('Supabase not configured', 503, origin)
  }

  try {
    // ── 1. Auth check (admin-only) ──────────────────────────────────────────
    const authResult = await verifyAdminAuth(req)
    if (!authResult.authorized) {
      return errorResponse(authResult.error, authResult.status, origin)
    }

    // ── 2. Parse + validate request body ───────────────────────────────────
    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return errorResponse('Invalid JSON body', 400, origin)
    }

    const {
      grade,
      subject,
      chapter,
      chapter_id,
      count:       rawCount,
      difficulty:  rawDifficulty,
      bloom_level: rawBloom,
    } = body as {
      grade?:       unknown
      subject?:     unknown
      chapter?:     unknown
      chapter_id?:  unknown
      count?:       unknown
      difficulty?:  unknown
      bloom_level?: unknown
    }

    // Required fields
    if (typeof grade !== 'string' || !VALID_GRADES.includes(grade)) {
      return errorResponse('grade must be a string "6" through "12"', 400, origin)
    }
    if (typeof subject !== 'string' || !subject.trim()) {
      return errorResponse('subject is required', 400, origin)
    }
    if (!isValidSubjectForGrade(grade, subject)) {
      const allowed = VALID_SUBJECTS_BY_GRADE[grade]?.join(', ') ?? ''
      return errorResponse(
        `subject "${subject}" is not a valid CBSE subject for grade ${grade}. Allowed: ${allowed}`,
        400, origin,
      )
    }
    if (typeof chapter !== 'string' || !chapter.trim()) {
      return errorResponse('chapter is required', 400, origin)
    }

    // Optional with defaults
    const count: number = (() => {
      const n = Number(rawCount ?? DEFAULT_COUNT)
      if (!Number.isInteger(n) || n < 1 || n > MAX_COUNT) return DEFAULT_COUNT
      return n
    })()

    const difficulty: number = (() => {
      const d = Number(rawDifficulty ?? DEFAULT_DIFFICULTY)
      if (!Number.isInteger(d) || d < 1 || d > 5) return DEFAULT_DIFFICULTY
      return d
    })()

    const bloomLevel: string = (() => {
      const b = typeof rawBloom === 'string' ? rawBloom.toLowerCase() : DEFAULT_BLOOM
      return VALID_BLOOM_LEVELS.includes(b) ? b : DEFAULT_BLOOM
    })()

    // Sanitize string inputs — strip HTML tags and template injection chars
    const safeSubject = subject.replace(/<[^>]*>/g, '').replace(/[{}`]/g, '').trim().slice(0, 100)
    const safeChapter = chapter.replace(/<[^>]*>/g, '').replace(/[{}`]/g, '').trim().slice(0, 200)
    const safeChapterId = typeof chapter_id === 'string' ? chapter_id.trim().slice(0, 36) : null

    // ── Phase 3: feature-flag-gated two-pass grounded path ──────────────────
    // When ff_grounded_ai_quiz_generator is ON, generate each question via
    // the grounded-answer service (pass 1) and verify via a second grounded
    // call (pass 2). Results are inserted with verification_state='verified'
    // or 'failed' so admin review can triage failures. When the flag is OFF
    // we fall through to the legacy single-pass Claude path below.
    const useGroundedService = await isFeatureFlagEnabled('ff_grounded_ai_quiz_generator')

    if (useGroundedService) {
      const chapterNumberParsed = /^\d+$/.test(safeChapter) ? parseInt(safeChapter, 10) : null

      // Oracle gate (REG-54) — also active on the grounded path. The two-pass
      // grounded verifier validates against NCERT chunks; the oracle adds a
      // separate semantic check that the explanation logically supports the
      // marked correct option (independent of NCERT alignment). Both can
      // catch bugs the other misses.
      const oracleOnGroundedPath = await isFeatureFlagEnabled('ff_quiz_oracle_enabled')

      // Serial calls — service runs its own circuit breaker; 50 × 2 passes
      // is ~100 sub-requests so keep strict sequence for clarity and to
      // avoid hitting Claude rate limits.
      const resultRows: GroundedInsertRow[] = []
      const rejectionReasons: string[] = []
      let oracleRejectedOnGrounded = 0
      for (let i = 0; i < count; i++) {
        // First attempt
        let outcome = await generateAndVerifyOne({
          grade,
          subject: safeSubject,
          chapter: safeChapter,
          chapterNumber: chapterNumberParsed,
          chapterId: safeChapterId,
          bloomLevel,
          fallbackDifficulty: difficulty,
        })

        let acceptedRow: GroundedInsertRow | null = null
        if (outcome.ok) {
          if (!oracleOnGroundedPath) {
            acceptedRow = outcome.row
          } else {
            const oracleResult = await validateWithCacheAndLogging(
              {
                question_text: outcome.row.question_text,
                options: outcome.row.options,
                correct_answer_index: outcome.row.correct_answer_index,
                explanation: outcome.row.explanation,
                hint: outcome.row.hint,
                difficulty: outcome.row.difficulty,
                bloom_level: outcome.row.bloom_level,
              },
              {
                grade,
                subject: safeSubject,
                chapter: safeChapter,
                enableLlmGrader: true,
              },
            )
            if (oracleResult.ok) {
              acceptedRow = outcome.row
            } else {
              // Single retry — re-run the grounded generate+verify pipeline
              // once. Cost ceiling: at most 4 Claude calls for one accepted
              // question (1 gen + 1 grader + 1 retry-gen + 1 retry-grader).
              const retry = await generateAndVerifyOne({
                grade,
                subject: safeSubject,
                chapter: safeChapter,
                chapterNumber: chapterNumberParsed,
                chapterId: safeChapterId,
                bloomLevel,
                fallbackDifficulty: difficulty,
              })
              if (retry.ok) {
                const retryResult = await validateWithCacheAndLogging(
                  {
                    question_text: retry.row.question_text,
                    options: retry.row.options,
                    correct_answer_index: retry.row.correct_answer_index,
                    explanation: retry.row.explanation,
                    hint: retry.row.hint,
                    difficulty: retry.row.difficulty,
                    bloom_level: retry.row.bloom_level,
                  },
                  {
                    grade,
                    subject: safeSubject,
                    chapter: safeChapter,
                    enableLlmGrader: true,
                  },
                )
                if (retryResult.ok) {
                  acceptedRow = retry.row
                } else {
                  // Second oracle rejection — drop the slot.
                  oracleRejectedOnGrounded++
                  rejectionReasons.push(`oracle_reject_after_retry:${retryResult.category}`)
                  outcome = retry // for downstream rejection accounting
                }
              } else {
                oracleRejectedOnGrounded++
                rejectionReasons.push(`oracle_reject_then_generator_fail:${retry.reason}`)
                outcome = retry
              }
            }
          }
        }

        if (acceptedRow) {
          resultRows.push(acceptedRow)
        } else if (!outcome.ok) {
          rejectionReasons.push(outcome.reason)
        }
      }

      if (resultRows.length === 0) {
        return jsonResponse(
          {
            generated: 0,
            inserted: 0,
            rejected: rejectionReasons.length,
            rejection_reasons: rejectionReasons,
            warning: 'All grounded generations failed. See rejection_reasons.',
          },
          200,
          {},
          origin,
        )
      }

      const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
      const { data: insertedRows, error: insertError } = await adminClient
        .from('question_bank')
        .insert(resultRows)
        .select()

      if (insertError) {
        console.error('bulk-question-gen (grounded): DB insert failed:', insertError.message)
        return errorResponse(`Database insert failed: ${insertError.message}`, 500, origin)
      }

      const insertedArr = (insertedRows || []) as InsertedQuestion[]
      const verifiedCount = resultRows.filter((r) => r.verification_state === 'verified').length
      const failedCount = resultRows.length - verifiedCount

      console.warn(JSON.stringify({
        event:         'bulk_question_gen_grounded',
        function_name: 'bulk-question-gen',
        flow:          'grounded-two-pass',
        grade,
        subject:       safeSubject,
        chapter:       safeChapter,
        requested:     count,
        generated:     resultRows.length,
        inserted:      insertedArr.length,
        verified:      verifiedCount,
        failed:        failedCount,
        rejected:      rejectionReasons.length,
        oracle_enabled: oracleOnGroundedPath,
        oracle_rejected: oracleRejectedOnGrounded,
        difficulty,
        bloom_level:   bloomLevel,
        ts:            new Date().toISOString(),
      }))

      return jsonResponse(
        {
          generated: resultRows.length,
          inserted: insertedArr.length,
          verified: verifiedCount,
          failed: failedCount,
          rejected: rejectionReasons.length,
          oracle_enabled: oracleOnGroundedPath,
          oracle_rejected: oracleRejectedOnGrounded,
          rejection_reasons: rejectionReasons.length > 0 ? rejectionReasons : undefined,
          questions: insertedArr,
          flow: 'grounded-two-pass',
        },
        200,
        {},
        origin,
      )
    }

    // ── Legacy single-pass Claude path (kill-switch fallback) ───────────────
    // ── 3. Build prompts ────────────────────────────────────────────────────
    const systemPrompt = buildSystemPrompt(grade, safeSubject)
    const userPrompt   = buildPrompt(grade, safeSubject, safeChapter, count, difficulty, bloomLevel)

    // ── 4. Call Claude ──────────────────────────────────────────────────────
    const claudeResult = await callClaude(systemPrompt, userPrompt)
    if (!claudeResult.ok) {
      console.error('bulk-question-gen: Claude API failed:', claudeResult.error)
      return errorResponse(`AI generation failed: ${claudeResult.error}`, 503, origin)
    }

    // ── 5. Parse + validate questions ───────────────────────────────────────
    const rawArray = extractJsonArray(claudeResult.text)
    if (!rawArray) {
      console.error('bulk-question-gen: Failed to parse JSON array from Claude response')
      return errorResponse('AI returned an unparseable response. Please retry.', 502, origin)
    }

    const validQuestions: GeneratedQuestion[] = []
    const rejectedCount = { value: 0 }

    for (const item of rawArray) {
      if (isValidQuestion(item)) {
        validQuestions.push({
          question_text:        item.question_text.trim(),
          options:              (item.options as string[]).map((o: string) => o.trim()),
          correct_answer_index: item.correct_answer_index,
          explanation:          item.explanation.trim(),
          hint:                 item.hint.trim(),
          difficulty:           item.difficulty,
          bloom_level:          item.bloom_level.toLowerCase(),
        })
      } else {
        rejectedCount.value++
      }
    }

    if (rejectedCount.value > 0) {
      console.warn(`bulk-question-gen: ${rejectedCount.value} questions rejected by validator`)
    }

    // ── Oracle gate (REG-54) ───────────────────────────────────────────────
    // When ff_quiz_oracle_enabled is ON, run each candidate through the
    // validation oracle. Rejections are logged to ops_events with
    // category='quiz.oracle_rejection'. No retry on this path — the legacy
    // single-pass generator returns an entire batch in one Claude call;
    // selectively re-prompting one question would require a second batch
    // call and break the cost ceiling. Failed candidates are dropped.
    const oracleEnabled = await isFeatureFlagEnabled('ff_quiz_oracle_enabled')
    let oracleRejectedCount = 0
    const oracleAcceptedQuestions: GeneratedQuestion[] = []
    if (oracleEnabled) {
      for (const q of validQuestions) {
        const result = await validateWithCacheAndLogging(
          {
            question_text: q.question_text,
            options: q.options,
            correct_answer_index: q.correct_answer_index,
            explanation: q.explanation,
            hint: q.hint,
            difficulty: q.difficulty,
            bloom_level: q.bloom_level,
          },
          {
            grade,
            subject: safeSubject,
            chapter: safeChapter,
            enableLlmGrader: true,
          },
        )
        if (result.ok) {
          oracleAcceptedQuestions.push(q)
        } else {
          oracleRejectedCount++
        }
      }
    } else {
      // Flag OFF — pass through every P6-valid question as before.
      oracleAcceptedQuestions.push(...validQuestions)
    }

    if (oracleRejectedCount > 0) {
      console.warn(
        `bulk-question-gen: ${oracleRejectedCount} questions rejected by oracle (ff_quiz_oracle_enabled=ON)`,
      )
    }

    // Replace validQuestions downstream with the oracle-gated list.
    validQuestions.length = 0
    validQuestions.push(...oracleAcceptedQuestions)

    const generated = rawArray.length

    if (validQuestions.length === 0) {
      return jsonResponse({
        generated,
        inserted:  0,
        questions: [],
        warning:   'All generated questions failed validation. Please retry or adjust parameters.',
      }, 200, {}, origin)
    }

    // ── 6. Insert into `question_bank` table ────────────────────────────────
    // Uses service-role client — bypasses RLS intentionally for admin bulk insert.
    // Columns match the question_bank schema (000_core_schema.sql):
    //   chapter_title (not "chapter"), topic_id (not "chapter_id"), source = 'ai_generated'.
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    const rows = validQuestions.map(q => ({
      question_text:        q.question_text,
      question_type:        'mcq',
      options:              q.options,
      correct_answer_index: q.correct_answer_index,
      explanation:          q.explanation,
      hint:                 q.hint,
      difficulty:           q.difficulty,
      bloom_level:          q.bloom_level,
      subject:              safeSubject,
      grade:                grade,            // P5: grade is a string
      chapter_title:        safeChapter,
      ...(safeChapterId ? { topic_id: safeChapterId } : {}),
      source:               'ai_generated',
      is_active:            true,
      created_at:           new Date().toISOString(),
    }))

    const { data: insertedRows, error: insertError } = await adminClient
      .from('question_bank')
      .insert(rows)
      .select()

    if (insertError) {
      console.error('bulk-question-gen: DB insert failed:', insertError.message)
      return errorResponse(`Database insert failed: ${insertError.message}`, 500, origin)
    }

    const inserted: InsertedQuestion[] = (insertedRows || []) as InsertedQuestion[]

    // ── 7. Audit log (P12 — no PII, session/topic only) ─────────────────────
    // Log to structured console output; ai_generation_logs table does not yet
    // exist in the schema. A future migration can add it and wire this up.
    console.warn(JSON.stringify({
      event:           'bulk_question_gen',
      function_name:   'bulk-question-gen',
      grade,
      subject:         safeSubject,
      chapter:         safeChapter,
      requested:       count,
      generated,
      inserted:        inserted.length,
      rejected:        rejectedCount.value,
      oracle_enabled:  oracleEnabled,
      oracle_rejected: oracleRejectedCount,
      difficulty,
      bloom_level:     bloomLevel,
      model:           'claude-haiku-4-5-20251001',
      ts:              new Date().toISOString(),
    }))

    // ── 8. Return result ────────────────────────────────────────────────────
    return jsonResponse(
      {
        generated,
        inserted:        inserted.length,
        rejected:        rejectedCount.value > 0 ? rejectedCount.value : undefined,
        oracle_enabled:  oracleEnabled,
        oracle_rejected: oracleRejectedCount,
        questions:       inserted,
      },
      200,
      {},
      origin,
    )

  } catch (err) {
    console.error('bulk-question-gen: unexpected error:', err)
    return errorResponse('Internal server error', 500, origin)
  }
})
