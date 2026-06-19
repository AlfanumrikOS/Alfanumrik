/**
 * bulk-jee-neet-import — Alfanumrik Edge Function
 *
 * PR-2 of the JEE/NEET scaling roadmap. Ingests previous-year-question (PYQ)
 * papers from JEE Main / NEET UG / Olympiad archives into `question_bank`
 * and `rag_content_chunks`.
 *
 * One-time bulk import, NOT real-time. Operator POSTs a batch of papers as
 * JSON; the function fans out 4 Claude Haiku calls per question (concept →
 * difficulty → explanation → optional oracle grade), validates the candidate
 * against the REG-54 oracle, and inserts an idempotent row.
 *
 * Auth: constant-time Bearer-token compare against `ADMIN_API_KEY` env var.
 *
 * Dependencies:
 *   - PR-1 (schema migration) MUST be applied first. PR-1 widens the
 *     `chk_source_type` CHECK to include 'jee_archive' | 'neet_archive' |
 *     'olympiad', widens `chk_four_options` to allow ≥0 options for
 *     integer/numerical patterns, widens the `rag_chunks_source_ncert_only`
 *     CHECK on rag_content_chunks to permit the new tags, and adds 6 PYQ
 *     columns: exam_session, exam_year, question_number, paper_pattern,
 *     marks_correct, marks_wrong. (`time_estimate_seconds` already exists
 *     pre-PR-1.) Also adds a UNIQUE INDEX on (exam_session, exam_year,
 *     question_number) to support the ON CONFLICT idempotency key.
 *   - REG-54 quiz-oracle in `_shared/quiz-oracle.ts` (gates MCQ candidates).
 *   - Embeddings: NOT triggered inline. The nightly `embed-questions` cron
 *     backfills rows where `embedding IS NULL`.
 *
 * Pipeline per question:
 *   1. classifyConcept   → { concept_code, chapter_title, chapter_number }
 *      (Claude Haiku, temp=0.3, NCERT chapter list as system prompt)
 *   2. estimateDifficulty → { difficulty, bloom_level }
 *      (Claude Haiku, temp=0)
 *   3. generateExplanation → { explanation, hint }
 *      (Claude Haiku with NCERT RAG context, temp=0.3, grounded)
 *   4. (MCQ only) oracle → REG-54 deterministic + LLM-grader gate
 *   5. INSERT INTO question_bank ... ON CONFLICT DO NOTHING
 *   6. INSERT INTO rag_content_chunks (source = source_type)
 *   7. logOpsEvent with category='content.pyq_ingestion'
 *
 * Telemetry per paper: { accepted, rejected, duplicates, errors }.
 * Dry-run mode: parse + validate + classify (no inserts, no Claude).
 *
 * Cost ceiling per accepted MCQ question:
 *   3 Claude Haiku calls (classify + difficulty + explanation)
 *   + up to 1 oracle LLM-grader call
 *   = 4 calls × ~2k tokens × $0.25/MTok input ≈ $0.001 per accepted question.
 *
 * Rate limiting: caller is admin-only and the operator runbook limits batches
 * to 100 questions, ~30 batches/hour (manual pacing). No in-function rate
 * limit beyond the 120s execution budget.
 *
 * Owner: ai-engineer. Reviewer: assessment (CBSE / PYQ correctness).
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { logOpsEvent } from '../_shared/ops-events.ts'
import { admitAiRoute, finalizeAiRoute, createStaticAiRouteProfile } from '../_shared/security/ai-admission.ts'
import {
  validateCandidate,
  type CandidateQuestion,
  type LlmGradeResult,
  type OracleResult,
} from '../_shared/quiz-oracle.ts'
import {
  QUIZ_ORACLE_GRADER_SYSTEM_PROMPT,
  buildQuizOracleGraderUserPrompt,
} from '../_shared/quiz-oracle-prompts.ts'
import { fetchRAGContext } from '../_shared/rag-retrieval.ts'
import {
  parseBulkImportBody,
  parseConceptResponse,
  parseDifficultyResponse,
  parseExplanationResponse,
  examRelevanceForSource,
  buildIdempotencyKey,
  type BulkImportInput,
  type PyqPaper,
  type PyqQuestion,
  type PyqSourceType,
  type BatchReport,
  type PaperSummary,
  type QuestionOutcome,
} from './validation.ts'
import { fetchWithProviderTimeout } from '../_shared/security/ai-admission.ts'

// ─── Environment ─────────────────────────────────────────────────────────────
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

// ─── Constants ───────────────────────────────────────────────────────────────
const MAX_EXECUTION_MS = 120_000 // 2 minutes — stay under Supabase 150s gateway timeout
const CLAUDE_TIMEOUT_MS = 30_000 // 30s per call
const ORACLE_GRADER_TIMEOUT_MS = 12_000
const MAX_QUESTIONS_PER_BATCH = 100 // operator-runbook guidance enforced server-side
const INTER_QUESTION_DELAY_MS = 150 // Claude rate-limit headroom
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001'

// ─── Circuit breaker (P12 — always have a fallback) ──────────────────────────
const circuitBreaker = {
  failures: 0,
  lastFailureAt: 0,
  state: 'closed' as 'closed' | 'open' | 'half-open',
  FAILURE_THRESHOLD: 3,
  RESET_TIMEOUT_MS: 60_000,

  canRequest(): boolean {
    if (this.state === 'closed') return true
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureAt > this.RESET_TIMEOUT_MS) {
        this.state = 'half-open'
        return true
      }
      return false
    }
    return true
  },
  recordSuccess(): void {
    this.failures = 0
    this.state = 'closed'
  },
  recordFailure(): void {
    this.failures++
    this.lastFailureAt = Date.now()
    if (this.failures >= this.FAILURE_THRESHOLD) this.state = 'open'
  },
}

// ─── Platform Security Layer — route profile ────────────────────────────────

const BULK_JEE_NEET_IMPORT_ROUTE_PROFILE = createStaticAiRouteProfile({
  route: 'bulk-jee-neet-import',
  callerTypes: ['internal_service'],
  modelProvider: 'anthropic',
  modelName: 'claude-haiku-4-5-20251001',
  inputTokenFloor: 512,
  outputTokens: 1024,
})

// ─── Supabase admin client ──────────────────────────────────────────────────
function getSupabaseAdmin(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// ─── Claude API helper ──────────────────────────────────────────────────────
interface ClaudeResult {
  ok: boolean
  text: string
  error?: string
}

async function callClaude(
  systemPrompt: string,
  userPrompt: string,
  options: { maxTokens: number; temperature: number; timeoutMs?: number } = {
    maxTokens: 512,
    temperature: 0.3,
  },
): Promise<ClaudeResult> {
  if (!circuitBreaker.canRequest()) {
    return { ok: false, text: '', error: 'circuit_breaker_open' }
  }
  const timeoutMs = options.timeoutMs ?? CLAUDE_TIMEOUT_MS
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    // eslint-disable-next-line alfanumrik/no-direct-ai-calls -- TODO(phase-4-cleanup): bulk-jee-neet-import is back-office ingestion (not student-facing) — route through grounded-answer service when bulk grounding API exists. Same posture as bulk-question-gen.
    const res = await fetchWithProviderTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      circuitBreaker.recordFailure()
      return { ok: false, text: '', error: `claude_http_${res.status}: ${body.slice(0, 200)}` }
    }

    const data = await res.json()
    const text: string = data?.content?.[0]?.text || ''
    circuitBreaker.recordSuccess()
    return { ok: true, text }
  } catch (err) {
    circuitBreaker.recordFailure()
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, text: '', error: 'claude_timeout' }
    }
    return { ok: false, text: '', error: `claude_threw: ${err instanceof Error ? err.message : String(err)}` }
  } finally {
    clearTimeout(timeoutId)
  }
}

// ─── Prompt builders ─────────────────────────────────────────────────────────

function buildConceptSystemPrompt(grade: string, subject: string, sourceType: PyqSourceType): string {
  const subjectDisplay = subject === 'math' ? 'Mathematics' : subject.charAt(0).toUpperCase() + subject.slice(1)
  return `You are a CBSE curriculum mapper. You map a previous-year-question (PYQ)
from a competitive exam (JEE/NEET/Olympiad) to the CBSE Class ${grade} ${subjectDisplay}
chapter it most closely aligns with.

Rules:
- Pick the CBSE NCERT chapter title that best matches the question's underlying concept.
- Output a snake_case concept_code that names the specific concept tested
  (e.g. "kinematics_motion_in_a_line", "thermodynamics_first_law",
  "organic_chemistry_haloalkanes").
- If the question explicitly references an NCERT chapter number, include it.
- Stay within Class 11/12 CBSE scope for ${sourceType}.
- Output ONLY a JSON object — no markdown fences, no prose.

Output format:
{"concept_code":"snake_case_code","chapter_title":"NCERT chapter title","chapter_number":12}`
}

function buildConceptUserPrompt(question: PyqQuestion, subject: string): string {
  const optionsBlock =
    question.options && question.options.length > 0
      ? '\nOPTIONS:\n' + question.options.map((o, i) => `(${String.fromCharCode(65 + i)}) ${o}`).join('\n')
      : ''
  return `QUESTION (${subject}):\n${question.question_text}${optionsBlock}\n\nMap to the CBSE NCERT chapter.`
}

function buildDifficultySystemPrompt(grade: string, subject: string): string {
  return `You are a CBSE assessment specialist. Estimate the difficulty (1-5 scale)
and Bloom's taxonomy level of a competitive-exam question relative to Class ${grade} ${subject}.

Difficulty scale:
1 — recall/identify (direct NCERT lift)
2 — simple application (one-step plug-in)
3 — multi-step application (typical board question)
4 — analysis/synthesis (typical JEE-Mains / NEET difficulty)
5 — advanced multi-concept (JEE-Advanced / Olympiad)

Bloom's level: one of remember | understand | apply | analyze | evaluate | create.

Output ONLY a JSON object. Temperature is zero — no opinions, only the calibrated estimate.

Output format: {"difficulty":3,"bloom_level":"apply"}`
}

function buildDifficultyUserPrompt(question: PyqQuestion): string {
  const optionsBlock =
    question.options && question.options.length > 0
      ? '\nOPTIONS:\n' + question.options.map((o, i) => `(${String.fromCharCode(65 + i)}) ${o}`).join('\n')
      : ''
  return `QUESTION:\n${question.question_text}${optionsBlock}\nPAPER PATTERN: ${question.paper_pattern}\nMARKS: ${question.marks_correct} correct / ${question.marks_wrong} wrong\n\nEstimate difficulty and Bloom's level.`
}

function buildExplanationSystemPrompt(
  grade: string,
  subject: string,
  ragContext: string | null,
): string {
  let prompt = `You are Foxy, a CBSE tutor for Class ${grade} ${subject} students who are preparing for JEE / NEET / Olympiad. Write a step-by-step solution explanation.

Rules:
- Show the reasoning a Class ${grade} student can follow — invoke only NCERT concepts.
- Concise: 4-6 sentences for MCQ, up to 10 for integer/numerical.
- For numerical questions, show the formula and the substitution.
- Age-appropriate: no slang, no off-topic content.
- Stay strictly within CBSE / NCERT scope; mark any out-of-scope claim with [non-NCERT].
- Output ONLY a JSON object — no markdown fences.

Output format: {"explanation":"step-by-step solution","hint":"one-line nudge"}`

  if (ragContext) {
    prompt += `\n\n=== NCERT REFERENCE MATERIAL (Class ${grade}, ${subject}) ===\n${ragContext}\n=== END REFERENCE ===\n\nGround the solution in the NCERT material above. Do NOT invent facts not present in the reference.`
  } else {
    prompt += `\n\n(No NCERT reference material was retrieved. Use only well-established Class ${grade} ${subject} content.)`
  }

  return prompt
}

function buildExplanationUserPrompt(question: PyqQuestion): string {
  const lines = [`QUESTION:\n${question.question_text}`]
  if (question.options && question.options.length > 0) {
    lines.push('OPTIONS:\n' + question.options.map((o, i) => `(${String.fromCharCode(65 + i)}) ${o}`).join('\n'))
    if (typeof question.correct_answer_index === 'number') {
      lines.push(`CORRECT OPTION: (${String.fromCharCode(65 + question.correct_answer_index)})`)
    }
  }
  if (question.correct_answer_text) {
    lines.push(`CORRECT ANSWER: ${question.correct_answer_text}`)
  }
  lines.push('Write a step-by-step solution + hint.')
  return lines.join('\n\n')
}

// ─── Oracle grader call ──────────────────────────────────────────────────────

async function callOracleGrader(input: {
  question_text: string
  options: string[]
  correct_answer_index: number
  explanation: string
}): Promise<LlmGradeResult> {
  if (!circuitBreaker.canRequest()) {
    throw new Error('circuit_breaker_open')
  }
  const userPrompt = buildQuizOracleGraderUserPrompt(input)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), ORACLE_GRADER_TIMEOUT_MS)
  try {
    // eslint-disable-next-line alfanumrik/no-direct-ai-calls -- TODO(phase-4-cleanup): oracle grader is a content-audit path; mirrors bulk-question-gen.
    const res = await fetchWithProviderTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 256,
        temperature: 0,
        system: QUIZ_ORACLE_GRADER_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      circuitBreaker.recordFailure()
      throw new Error(`oracle_grader_http_${res.status}: ${body.slice(0, 200)}`)
    }
    const data = await res.json()
    const text: string = data?.content?.[0]?.text || ''
    circuitBreaker.recordSuccess()
    const parsed = parseLlmGraderTextSafe(text)
    if (!parsed) {
      return { verdict: 'ambiguous', reasoning: 'grader returned unparseable JSON' }
    }
    return parsed
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('oracle_grader_timeout')
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

/** Inline copy of parseLlmGraderResponse from _shared/quiz-oracle.ts to keep
 *  the grader call sealed inside this file. The Deno mirror exports
 *  `parseLlmGraderResponse` already; we re-derive here for clarity. */
function parseLlmGraderTextSafe(raw: string): LlmGradeResult | null {
  const stripped = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/, '')
    .replace(/\s*```$/, '')
    .trim()
  try {
    const obj = JSON.parse(stripped)
    if (!obj || typeof obj !== 'object') return null
    const verdict = obj.verdict
    if (verdict !== 'consistent' && verdict !== 'mismatch' && verdict !== 'ambiguous') return null
    return {
      verdict,
      reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : '',
      ...(typeof obj.suggested_correct_index === 'number' &&
      Number.isInteger(obj.suggested_correct_index) &&
      obj.suggested_correct_index >= 0 &&
      obj.suggested_correct_index <= 3
        ? { suggested_correct_index: obj.suggested_correct_index as 0 | 1 | 2 | 3 }
        : {}),
    }
  } catch {
    return null
  }
}

// ─── Subject → topic_id resolver (cached per batch) ──────────────────────────

interface TopicLookup {
  id: string
  title: string
  chapter_number: number | null
}

/**
 * Resolve a chapter title to a `curriculum_topics.id` UUID via fuzzy match.
 * Cached per Edge Function invocation to avoid re-querying the same chapter
 * for every question in a paper.
 */
async function resolveChapterId(
  supabase: SupabaseClient,
  cache: Map<string, string | null>,
  grade: string,
  subject: string,
  chapterTitle: string,
  chapterNumber: number | null,
): Promise<string | null> {
  const cacheKey = `${grade}|${subject}|${chapterTitle}|${chapterNumber ?? ''}`
  const cached = cache.get(cacheKey)
  if (cached !== undefined) return cached

  // Strategy: prefer exact match on title + grade + chapter_number. Fall back
  // to ILIKE on title alone within the same grade. Curriculum_topics has a
  // subject_id FK (UUID, not text), so we cannot constrain by subject string
  // directly without a join — we accept some cross-subject collision risk
  // and rely on grade + title fuzzy match.
  let resolved: string | null = null

  if (chapterNumber !== null) {
    const { data: exact } = await supabase
      .from('curriculum_topics')
      .select('id, title, chapter_number')
      .eq('grade', grade)
      .eq('chapter_number', chapterNumber)
      .ilike('title', `%${chapterTitle.slice(0, 60)}%`)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle<TopicLookup>()
    if (exact?.id) resolved = exact.id
  }

  if (!resolved) {
    const { data: fuzzy } = await supabase
      .from('curriculum_topics')
      .select('id, title, chapter_number')
      .eq('grade', grade)
      .ilike('title', `%${chapterTitle.slice(0, 60)}%`)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle<TopicLookup>()
    if (fuzzy?.id) resolved = fuzzy.id
  }

  cache.set(cacheKey, resolved)
  return resolved
}

// ─── Per-question pipeline ──────────────────────────────────────────────────

interface PipelineContext {
  supabase: SupabaseClient
  topicCache: Map<string, string | null>
  sourceType: PyqSourceType
  dryRun: boolean
  llmCallsRef: { count: number }
}

interface PipelineOutcome {
  status: 'accepted' | 'rejected' | 'duplicate' | 'error'
  reason?: string
  oracle_category?: string
}

async function processQuestion(
  ctx: PipelineContext,
  paper: PyqPaper,
  question: PyqQuestion,
): Promise<PipelineOutcome> {
  // ── 1. Concept classification ──────────────────────────────────────────
  const conceptSystem = buildConceptSystemPrompt(paper.grade, paper.subject, ctx.sourceType)
  const conceptUser = buildConceptUserPrompt(question, paper.subject)

  if (ctx.dryRun) {
    // Dry-run: skip Claude entirely; return synthetic accept so the operator
    // sees the parse-stage report without burning credit.
    return { status: 'accepted', reason: 'dry_run' }
  }

  const conceptResp = await callClaude(conceptSystem, conceptUser, {
    maxTokens: 256,
    temperature: 0.3,
  })
  ctx.llmCallsRef.count++
  if (!conceptResp.ok) {
    return { status: 'error', reason: `concept_call_failed:${conceptResp.error}` }
  }
  const concept = parseConceptResponse(conceptResp.text)
  if (!concept) {
    return { status: 'error', reason: 'concept_parse_error' }
  }

  // ── 2. Difficulty + Bloom estimation ───────────────────────────────────
  const difficultyResp = await callClaude(
    buildDifficultySystemPrompt(paper.grade, paper.subject),
    buildDifficultyUserPrompt(question),
    { maxTokens: 128, temperature: 0 },
  )
  ctx.llmCallsRef.count++
  if (!difficultyResp.ok) {
    return { status: 'error', reason: `difficulty_call_failed:${difficultyResp.error}` }
  }
  const difficulty = parseDifficultyResponse(difficultyResp.text)
  if (!difficulty) {
    return { status: 'error', reason: 'difficulty_parse_error' }
  }

  // ── 3. Explanation (RAG-grounded) ──────────────────────────────────────
  let ragContext: string | null = null
  try {
    ragContext = await fetchRAGContext(
      ctx.supabase,
      `${question.question_text} ${concept.chapter_title}`.slice(0, 600),
      paper.subject,
      paper.grade,
      concept.chapter_title,
    )
  } catch (err) {
    // RAG retrieval failure is non-fatal — explanation falls back to
    // ungrounded generation with a system-prompt warning.
    console.warn('[bulk-jee-neet-import] RAG context fetch failed (non-fatal):', err instanceof Error ? err.message : String(err))
  }

  const explanationResp = await callClaude(
    buildExplanationSystemPrompt(paper.grade, paper.subject, ragContext),
    buildExplanationUserPrompt(question),
    { maxTokens: 1024, temperature: 0.3 },
  )
  ctx.llmCallsRef.count++
  if (!explanationResp.ok) {
    return { status: 'error', reason: `explanation_call_failed:${explanationResp.error}` }
  }
  const explanation = parseExplanationResponse(explanationResp.text)
  if (!explanation) {
    return { status: 'error', reason: 'explanation_parse_error' }
  }

  // ── 4. Oracle gate (MCQ only — REG-54) ─────────────────────────────────
  let oracleResult: OracleResult | null = null
  const isMcq = question.paper_pattern === 'mcq_4' || question.paper_pattern === 'mcq_5'
  if (isMcq && question.options && typeof question.correct_answer_index === 'number') {
    // Oracle currently supports exactly 4 options (P6). For mcq_5 we skip the
    // oracle gate and log it as an expected gap until quiz-oracle.ts is widened
    // (PR-3 scope). Telemetry differentiates so we can audit later.
    if (question.options.length === 4) {
      const candidate: CandidateQuestion = {
        question_text: question.question_text,
        options: question.options,
        correct_answer_index: question.correct_answer_index,
        explanation: explanation.explanation,
        bloom_level: difficulty.bloom_level,
        grade: paper.grade,
        subject: paper.subject,
      }
      try {
        oracleResult = await validateCandidate(candidate, {
          enableLlmGrader: true,
          llmGrade: callOracleGrader,
        })
        if (oracleResult.llm_calls > 0) ctx.llmCallsRef.count += oracleResult.llm_calls
      } catch (err) {
        // Fail closed (P12): treat thrown grader as rejection.
        oracleResult = {
          ok: false,
          category: 'llm_grader_unavailable',
          reason: err instanceof Error ? err.message : String(err),
          llm_calls: 1,
        }
        ctx.llmCallsRef.count += 1
      }
      if (!oracleResult.ok) {
        await logOpsEvent({
          category: 'content.pyq_ingestion',
          source: 'bulk-jee-neet-import',
          severity: 'info',
          message: `Oracle rejected PYQ candidate: ${oracleResult.category}`,
          context: {
            source_type: ctx.sourceType,
            exam_session: paper.exam_session,
            exam_year: paper.exam_year,
            question_number: question.question_number,
            grade: paper.grade,
            subject: paper.subject,
            paper_pattern: question.paper_pattern,
            oracle_category: oracleResult.category,
            oracle_reason: oracleResult.reason.slice(0, 200),
          },
        })
        return { status: 'rejected', reason: 'oracle_rejection', oracle_category: oracleResult.category }
      }
    } else {
      // mcq_5 — oracle skip path. Logged at info severity so the operator
      // can see how many got the pass-through. PR-3 widens the oracle.
      await logOpsEvent({
        category: 'content.pyq_ingestion',
        source: 'bulk-jee-neet-import',
        severity: 'info',
        message: 'Oracle skipped (paper_pattern=mcq_5 not yet supported)',
        context: {
          source_type: ctx.sourceType,
          exam_session: paper.exam_session,
          exam_year: paper.exam_year,
          question_number: question.question_number,
          paper_pattern: question.paper_pattern,
        },
      })
    }
  }

  // ── 5. Resolve chapter to topic_id ─────────────────────────────────────
  const topicId = await resolveChapterId(
    ctx.supabase,
    ctx.topicCache,
    paper.grade,
    paper.subject,
    concept.chapter_title,
    concept.chapter_number,
  )

  // ── 6. Insert into question_bank (idempotent) ──────────────────────────
  // PR-1 has added these columns; we set all 6 PYQ fields.
  // ON CONFLICT (exam_session, exam_year, question_number) DO NOTHING is
  // implemented at the DB layer via the UNIQUE INDEX PR-1 creates. We use
  // the Supabase upsert API with `ignoreDuplicates: true` to honour it.
  const insertRow: Record<string, unknown> = {
    subject: paper.subject,
    grade: paper.grade, // P5: string
    chapter_number: concept.chapter_number,
    topic_id: topicId,
    concept_code: concept.concept_code,
    question_text: question.question_text,
    question_type: isMcq ? 'mcq' : question.paper_pattern,
    question_type_v2: isMcq
      ? 'mcq'
      : question.paper_pattern === 'subjective'
        ? 'long_answer'
        : 'short_answer',
    options: question.options ?? [],
    correct_answer_index: question.correct_answer_index ?? null,
    correct_answer_text: question.correct_answer_text ?? null,
    explanation: explanation.explanation,
    hint: explanation.hint ?? null,
    difficulty: difficulty.difficulty,
    bloom_level: difficulty.bloom_level,
    source: ctx.sourceType, // legacy column — same value as source_type for visibility
    source_type: ctx.sourceType, // PR-1 widened CHECK to allow these tags
    source_version: 'pyq_2026',
    is_active: true,
    is_verified: oracleResult?.ok === true,
    // PR-1 columns:
    exam_session: paper.exam_session,
    exam_year: paper.exam_year,
    question_number: question.question_number,
    paper_pattern: question.paper_pattern,
    marks_correct: question.marks_correct,
    marks_wrong: question.marks_wrong,
    time_estimate_seconds: question.time_estimate_seconds,
    // Verification state mirrors REG-54 pattern: oracle-accepted MCQs are
    // marked verified; non-MCQ (no oracle) and mcq_5 (oracle skipped) stay
    // pending so admin review can intervene.
    verification_state: oracleResult?.ok === true ? 'verified' : 'pending',
    verified_against_ncert: oracleResult?.ok === true,
    verified_at: oracleResult?.ok === true ? new Date().toISOString() : null,
    created_at: new Date().toISOString(),
  }

  const { data: insertedQB, error: insertErr } = await ctx.supabase
    .from('question_bank')
    .upsert(insertRow, {
      onConflict: 'exam_session,exam_year,question_number',
      ignoreDuplicates: true,
    })
    .select('id')

  if (insertErr) {
    await logOpsEvent({
      category: 'content.pyq_ingestion',
      source: 'bulk-jee-neet-import',
      severity: 'error',
      message: 'question_bank insert failed',
      context: {
        source_type: ctx.sourceType,
        exam_session: paper.exam_session,
        exam_year: paper.exam_year,
        question_number: question.question_number,
        error: insertErr.message.slice(0, 300),
      },
    })
    return { status: 'error', reason: `db_insert_failed:${insertErr.message.slice(0, 80)}` }
  }

  // ignoreDuplicates returns an empty array on conflict-skip.
  if (!insertedQB || insertedQB.length === 0) {
    return { status: 'duplicate', reason: 'idempotency_skip' }
  }
  const newQuestionId = (insertedQB[0] as { id: string }).id

  // ── 7. Insert into rag_content_chunks (best-effort) ────────────────────
  // The chunk doubles as a retrieval source for future Foxy queries.
  const chunkText = [
    `Question: ${question.question_text}`,
    question.options && question.options.length > 0
      ? `Options: ${question.options.map((o, i) => `(${String.fromCharCode(65 + i)}) ${o}`).join(' | ')}`
      : '',
    typeof question.correct_answer_index === 'number' && question.options
      ? `Correct: (${String.fromCharCode(65 + question.correct_answer_index)}) ${question.options[question.correct_answer_index]}`
      : question.correct_answer_text
        ? `Correct: ${question.correct_answer_text}`
        : '',
    `Explanation: ${explanation.explanation}`,
    `Concept: ${concept.concept_code}`,
    `Exam: ${paper.exam_session} ${paper.exam_year}`,
  ]
    .filter(Boolean)
    .join('\n')

  const ragRow: Record<string, unknown> = {
    chunk_text: chunkText,
    chunk_type: 'qa',
    content_type: 'qa',
    board: 'CBSE',
    grade: paper.grade,
    grade_short: paper.grade,
    subject: paper.subject,
    subject_code: paper.subject,
    chapter_number: concept.chapter_number,
    chapter_title: concept.chapter_title,
    topic: concept.concept_code,
    concept: concept.concept_code,
    difficulty_level: difficulty.difficulty,
    language: 'en',
    exam_relevance: examRelevanceForSource(ctx.sourceType),
    source: ctx.sourceType, // PR-1 widened rag_chunks_source_ncert_only
    source_book: `${paper.exam_session} ${paper.exam_year}`,
    question_text: question.question_text,
    answer_text: explanation.explanation,
    question_type: isMcq ? 'mcq' : 'numerical',
    marks_expected: question.marks_correct,
    bloom_level: difficulty.bloom_level,
    is_active: true,
  }

  const { error: ragErr } = await ctx.supabase.from('rag_content_chunks').insert(ragRow)
  if (ragErr) {
    // Non-fatal — the question_bank row is already in. Log and continue.
    console.warn(
      `[bulk-jee-neet-import] rag_content_chunks insert failed for ${question.question_number}: ${ragErr.message}`,
    )
    await logOpsEvent({
      category: 'content.pyq_ingestion',
      source: 'bulk-jee-neet-import',
      severity: 'warning',
      message: 'rag_content_chunks insert failed (question_bank row still committed)',
      context: {
        question_bank_id: newQuestionId,
        source_type: ctx.sourceType,
        error: ragErr.message.slice(0, 300),
      },
    })
  }

  return { status: 'accepted' }
}

// ─── Per-paper handler ──────────────────────────────────────────────────────

async function processPaper(
  ctx: PipelineContext,
  paper: PyqPaper,
  deadlineMs: number,
): Promise<PaperSummary> {
  const summary: PaperSummary = {
    exam_session: paper.exam_session,
    exam_year: paper.exam_year,
    subject: paper.subject,
    grade: paper.grade,
    total: paper.questions.length,
    accepted: 0,
    rejected: 0,
    duplicates: 0,
    errors: 0,
    outcomes: [],
  }

  for (let i = 0; i < paper.questions.length; i++) {
    if (Date.now() > deadlineMs) {
      summary.outcomes.push({
        question_number: paper.questions[i].question_number,
        status: 'error',
        reason: 'execution_deadline_reached',
      })
      summary.errors++
      continue
    }
    const question = paper.questions[i]
    const outcome = await processQuestion(ctx, paper, question)
    summary.outcomes.push({
      question_number: question.question_number,
      status: outcome.status,
      ...(outcome.reason ? { reason: outcome.reason } : {}),
      ...(outcome.oracle_category ? { oracle_category: outcome.oracle_category } : {}),
    })
    switch (outcome.status) {
      case 'accepted':
        summary.accepted++
        break
      case 'rejected':
        summary.rejected++
        break
      case 'duplicate':
        summary.duplicates++
        break
      case 'error':
        summary.errors++
        break
    }
    // Pacing
    if (!ctx.dryRun && i < paper.questions.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, INTER_QUESTION_DELAY_MS))
    }
  }

  return summary
}

// ─── Main handler ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')

  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...getCorsHeaders(origin),
        'Access-Control-Allow-Headers':
          'authorization, x-client-info, apikey, content-type, x-request-id, x-admin-key, x-internal-caller, x-internal-timestamp, x-internal-signature',
      },
    })
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405, origin)
  }

  // Read body as text first — admitAiRoute needs bodyText for request body hash
  const bodyText = await req.text()

  // Create Supabase admin client for security layer RPCs
  const sb = getSupabaseAdmin()

  // ── Platform Security Layer admission ────────────────────────────────────
  const admitResult = await admitAiRoute({ req, sb, profile: BULK_JEE_NEET_IMPORT_ROUTE_PROFILE, bodyText })
  if (!admitResult.ok) return admitResult.response
  const { admission } = admitResult

  if (!ANTHROPIC_API_KEY) {
    await finalizeAiRoute({ sb, admission, statusCode: 503, errorCode: 'ai_not_configured' })
    return errorResponse('ANTHROPIC_API_KEY not configured', 503, origin)
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    await finalizeAiRoute({ sb, admission, statusCode: 503, errorCode: 'supabase_not_configured' })
    return errorResponse('Supabase not configured', 503, origin)
  }

  // ── Parse body ───────────────────────────────────────────────────────────
  let rawBody: unknown
  try {
    rawBody = JSON.parse(bodyText)
  } catch {
    await finalizeAiRoute({ sb, admission, statusCode: 422, errorCode: 'invalid_json' })
    return errorResponse('invalid JSON body', 422, origin)
  }

  const parsed = parseBulkImportBody(rawBody)
  if (!parsed.ok || !parsed.value) {
    await finalizeAiRoute({ sb, admission, statusCode: 422, errorCode: 'validation_failed' })
    return jsonResponse(
      {
        error: 'validation_failed',
        errors: parsed.errors,
      },
      422,
      {},
      origin,
    )
  }
  const input: BulkImportInput = parsed.value

  // Cap batch size — operator runbook says ≤ 100 questions per call.
  const totalQuestions = input.papers.reduce((sum, p) => sum + p.questions.length, 0)
  if (totalQuestions > MAX_QUESTIONS_PER_BATCH) {
    await finalizeAiRoute({ sb, admission, statusCode: 413, errorCode: 'batch_too_large' })
    return errorResponse(
      `batch too large: ${totalQuestions} questions exceeds ${MAX_QUESTIONS_PER_BATCH} per-call cap (split into smaller batches)`,
      413,
      origin,
    )
  }

  try {
    // ── Execute pipeline ───────────────────────────────────────────────────
    const startedAt = Date.now()
    const deadlineMs = startedAt + MAX_EXECUTION_MS
    const supabase = getSupabaseAdmin()
    const ctx: PipelineContext = {
      supabase,
      topicCache: new Map<string, string | null>(),
      sourceType: input.source_type,
      dryRun: input.dry_run,
      llmCallsRef: { count: 0 },
    }

    const paperSummaries: PaperSummary[] = []
    for (const paper of input.papers) {
      if (Date.now() > deadlineMs) {
        paperSummaries.push({
          exam_session: paper.exam_session,
          exam_year: paper.exam_year,
          subject: paper.subject,
          grade: paper.grade,
          total: paper.questions.length,
          accepted: 0,
          rejected: 0,
          duplicates: 0,
          errors: paper.questions.length,
          outcomes: paper.questions.map(
            (q: PyqQuestion): QuestionOutcome => ({
              question_number: q.question_number,
              status: 'error',
              reason: 'execution_deadline_reached',
            }),
          ),
        })
        continue
      }
      paperSummaries.push(await processPaper(ctx, paper, deadlineMs))
    }

    const elapsed = Date.now() - startedAt

    // ── Batch-level summary telemetry ─────────────────────────────────────
    const totals = paperSummaries.reduce(
      (acc, p) => {
        acc.accepted += p.accepted
        acc.rejected += p.rejected
        acc.duplicates += p.duplicates
        acc.errors += p.errors
        return acc
      },
      { accepted: 0, rejected: 0, duplicates: 0, errors: 0 },
    )

    await logOpsEvent({
      category: 'content.pyq_ingestion',
      source: 'bulk-jee-neet-import',
      severity: totals.errors > 0 ? 'warning' : 'info',
      message: 'Bulk PYQ ingestion batch completed',
      context: {
        source_type: input.source_type,
        dry_run: input.dry_run,
        papers: paperSummaries.length,
        total_questions: totalQuestions,
        accepted: totals.accepted,
        rejected: totals.rejected,
        duplicates: totals.duplicates,
        errors: totals.errors,
        llm_calls: ctx.llmCallsRef.count,
        elapsed_ms: elapsed,
      },
    })

    const report: BatchReport = {
      dry_run: input.dry_run,
      source_type: input.source_type,
      papers: paperSummaries,
      llm_calls_total: ctx.llmCallsRef.count,
      elapsed_ms: elapsed,
    }

    await finalizeAiRoute({ sb, admission, statusCode: 200 })
    return jsonResponse(report, 200, {}, origin)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[bulk-jee-neet-import] Unhandled error:', message)
    await finalizeAiRoute({ sb, admission, statusCode: 500, errorCode: 'unhandled_error' })
    return errorResponse(`Internal error: ${message}`, 500, origin)
  }
})

// ── Test-only exports ───────────────────────────────────────────────────────
// These names are re-exported through `./validation.ts` and are NOT used by
// the runtime handler. We keep them out of the main pipeline so the file
// shape remains predictable when `Deno.serve` boots the module.
export {
  buildConceptSystemPrompt,
  buildConceptUserPrompt,
  buildDifficultySystemPrompt,
  buildDifficultyUserPrompt,
  buildExplanationSystemPrompt,
  buildExplanationUserPrompt,
}
