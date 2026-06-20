/**
 * bulk-non-mcq-gen — Alfanumrik Edge Function (Phase 2 of non-MCQ seeding)
 *
 * Admin-only endpoint that generates short-answer or long-answer CBSE questions
 * for a given (grade, subject, chapter) and inserts them into question_bank
 * with verification_state='pending' (Phase 5 admin review gate).
 *
 * Sibling of bulk-question-gen (which handles MCQ only). Lives separately to:
 *   - Avoid touching the working MCQ generator
 *   - Skip the quiz-oracle path (oracle is MCQ-shape-specific)
 *   - Keep per-type prompt logic isolated
 *
 * POST body:
 * {
 *   grade:         string  – "6"–"12" (required)
 *   subject:       string  – e.g. "science", "math" (required)
 *   chapter_title: string  – chapter name (required)
 *   chapter_number: number – chapter number, used to key DB writes (required)
 *   question_type: 'short_answer' | 'long_answer'   (required)
 *   count?:        number  – questions to generate, 1–20 (default 5)
 *   bloom_level?:  string  – Bloom's level (default varies by type)
 * }
 *
 * Response:
 * {
 *   generated: number,
 *   inserted:  number,
 *   rejected:  number,
 *   rejection_reasons?: string[],
 *   questions: InsertedQuestion[],
 * }
 *
 * Auth:
 *   Bearer token whose auth_user_id is in admin_users with admin_level
 *   IN ('admin','super_admin'). Same as bulk-question-gen.
 *
 * Safety (P12):
 *   - All generated questions go in with verification_state='pending'.
 *     They are NOT served to students until an admin flips them to 'verified'
 *     via the (forthcoming Phase 5) admin verification UI.
 *   - System prompt enforces CBSE scope, NCERT-grounding, age-appropriateness.
 *   - Per-type validator rejects malformed output.
 *   - Circuit breaker: 3 Claude failures in 60s → return 503.
 *
 * Cost (Claude Haiku):
 *   - SA: ~500 output tokens × 5 questions = ~2,500 tokens per call ≈ $0.0006
 *   - LA: ~1,500 output tokens × 3 questions = ~4,500 tokens per call ≈ $0.0011
 *   - Full coverage (761 chapters × 5 SA + 3 LA) ≈ $1.30 total
 *
 * Note: Hindi translations are NOT generated here. The translation pipeline
 * runs as a separate Phase 4 backfill against rows where _hi columns are NULL.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { shouldProxyToPython, forwardToPython } from '../_shared/python-ai-proxy.ts'
import { admitAiRoute, finalizeAiRoute, createStaticAiRouteProfile } from '../_shared/security/ai-admission.ts'
// MoL (Model Orchestration Layer) — Phase 1A migration (2026-05-24).
// Routes SA/LA generation through the shared orchestrator (OpenAI gpt-4o-mini
// primary, Claude Haiku fallback). The per-type validator in isValidQuestion
// still runs AFTER MoL returns — content validation never moves into the LLM
// call, which is what makes this migration P6-safe.
//
// Rollback flag (2026-06-03): ff_mol_admin_functions_v1. When ops trips the
// kill switch, callClaude short-circuits to callClaudeLegacy below (pre-Phase-1A
// byte-for-byte direct-Anthropic-fetch path).
import { generateResponse, MolError } from '../_shared/mol/index.ts'
import { isMolAdminRoutingEnabled } from '../_shared/mol/admin-rollback-flag.ts'
import { fetchWithProviderTimeout } from '../_shared/security/ai-admission.ts'
import { getCorsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts'

// ─── Environment ─────────────────────────────────────────────────────────────
const ANTHROPIC_API_KEY    = Deno.env.get('ANTHROPIC_API_KEY')        || ''
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')             || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const SUPABASE_ANON_KEY    = Deno.env.get('SUPABASE_ANON_KEY')        || ''

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_COUNT = 20
const DEFAULT_SA_COUNT = 5
const DEFAULT_LA_COUNT = 3
const VALID_GRADES = ['6','7','8','9','10','11','12']
const VALID_QUESTION_TYPES = ['short_answer','long_answer'] as const
type QuestionType = typeof VALID_QUESTION_TYPES[number]

const VALID_SUBJECTS_BY_GRADE: Record<string, string[]> = {
  '6':  ['math','science','english','hindi','social_studies','sanskrit'],
  '7':  ['math','science','english','hindi','social_studies','sanskrit'],
  '8':  ['math','science','english','hindi','social_studies','sanskrit'],
  '9':  ['math','science','english','hindi','social_studies','physics','chemistry','biology'],
  '10': ['math','science','english','hindi','social_studies','physics','chemistry','biology'],
  '11': ['math','physics','chemistry','biology','english','hindi','economics','accountancy','business_studies','history','geography','political_science','computer_science'],
  '12': ['math','physics','chemistry','biology','english','hindi','economics','accountancy','business_studies','history','geography','political_science','computer_science'],
}
function isValidSubjectForGrade(grade: string, subject: string): boolean {
  return VALID_SUBJECTS_BY_GRADE[grade]?.includes(subject.toLowerCase().trim()) ?? false
}

// ─── Circuit breaker ─────────────────────────────────────────────────────────
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
  recordSuccess(): void { this.failures = 0; this.state = 'closed' },
  recordFailure(): void {
    this.failures++
    this.lastFailureAt = Date.now()
    if (this.failures >= this.FAILURE_THRESHOLD) this.state = 'open'
  },
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface RequestBody {
  grade:          string
  subject:        string
  chapter_title:  string
  chapter_number: number
  question_type:  QuestionType
  count?:         number
  bloom_level?:   string
}

interface GeneratedQuestion {
  question_text:    string
  expected_answer:  string
  marking_scheme:   { points: { point: string; marks: number }[] }
  max_marks:        number
  word_limit:       number
  bloom_level:      string
  difficulty:       number
}

interface InsertedQuestion extends GeneratedQuestion {
  id:             string
  subject:        string
  grade:          string
  chapter_number: number
  question_type_v2: QuestionType
}

// ─── Platform Security Layer — route profile (Phase 4 Wave 2) ───────────────

const BULK_NON_MCQ_GEN_ROUTE_PROFILE = createStaticAiRouteProfile({
  route: 'bulk-non-mcq-gen',
  callerTypes: ['internal_service'],
  modelProvider: 'anthropic',
  modelName: 'claude-haiku-4-5-20251001',
  inputTokenFloor: 512,
  outputTokens: 1536,
})

// ─── NCERT context retrieval ─────────────────────────────────────────────────
// Pull a few rag_content_chunks for the chapter to ground the generation.
// We're not running through grounded-answer (which is a 2-3s hop) — direct
// query is fine for an admin-only batch operation.

async function fetchChapterContext(
  grade: string,
  subject: string,
  chapterNumber: number,
): Promise<string> {
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const { data, error } = await admin
    .from('rag_content_chunks')
    .select('content')
    .eq('grade', grade)
    .eq('subject', subject)
    .eq('chapter_number', chapterNumber)
    .limit(8)
  if (error || !data || data.length === 0) return ''
  return data
    .map((r: { content: string | null }) => (r.content ?? '').trim())
    .filter(s => s.length > 0)
    .map(s => s.length > 1500 ? s.slice(0, 1500) + '…' : s)
    .join('\n\n---\n\n')
}

// ─── Prompt builders ─────────────────────────────────────────────────────────

function buildSystemPrompt(grade: string, subject: string, qType: QuestionType): string {
  const ageLow = String(10 + Number(grade) - 6)
  const ageHigh = String(11 + Number(grade) - 6)
  const role = qType === 'short_answer'
    ? 'short-answer (SA, 1–3 marks) questions'
    : 'long-answer (LA, 5–6 marks) questions'
  return `You are a CBSE curriculum question-generation assistant for an Indian K-12 EdTech platform.
You produce exam-quality ${role} for Grade ${grade} ${subject}.

RULES:
- Follow the NCERT/CBSE syllabus strictly. Do not go beyond the grade-level curriculum.
- All content must be age-appropriate for Grade ${grade} students (approx. ages ${ageLow}–${ageHigh}).
- No violence, adult content, political opinions, religion-based bias, or off-topic material.
- Questions must be factually accurate. The expected_answer must match the question and be self-consistent with the marking_scheme.
- Use the Reference Material (when provided) to ground every question and answer. Do not invent facts beyond it.
- The question stem must NOT leak the answer. Avoid hand-holding phrases like "Explain how X causes Y because of Z" — that's not a question, it's a statement.
- Return ONLY a valid JSON array as instructed. No markdown fences, no commentary.`
}

function buildSAUserPrompt(
  grade: string,
  subject: string,
  chapterTitle: string,
  count: number,
  bloomLevel: string,
  context: string,
): string {
  const refSection = context
    ? `Reference Material (NCERT chapter content — use this as ground truth):\n\n${context}\n\n`
    : ''
  return `${refSection}Generate ${count} CBSE Grade ${grade} ${subject} short-answer (SA) questions for chapter: "${chapterTitle}".

Per question:
- Worth 2 marks (SA standard)
- Expected answer is 30–60 words, single concept focus
- Marking scheme breaks the 2 marks into 1–3 key points; each key point gets a partial-mark allocation
- Bloom's level: ${bloomLevel}
- Difficulty: integer 1 (easy) to 3 (hard)

Return ONLY a JSON array — no markdown, no extra text — with this exact structure:
[{
  "question_text": "...",
  "expected_answer": "30–60 word model answer",
  "marking_scheme": { "points": [
    { "point": "first key idea student must mention", "marks": 1 },
    { "point": "second key idea", "marks": 1 }
  ]},
  "max_marks": 2,
  "word_limit": 60,
  "bloom_level": "${bloomLevel}",
  "difficulty": 2
}]

Do not include any other fields. The marks in the marking_scheme.points array must sum to max_marks.`
}

function buildLAUserPrompt(
  grade: string,
  subject: string,
  chapterTitle: string,
  count: number,
  bloomLevel: string,
  context: string,
): string {
  const refSection = context
    ? `Reference Material (NCERT chapter content — use this as ground truth):\n\n${context}\n\n`
    : ''
  return `${refSection}Generate ${count} CBSE Grade ${grade} ${subject} long-answer (LA) questions for chapter: "${chapterTitle}".

Per question:
- Worth 5 marks (LA standard)
- Expected answer is 150–250 words, structured as: introduction (1–2 sentences) → 4 main points → conclusion (1–2 sentences)
- Marking scheme breaks the 5 marks across the 4 main points + 1 mark for structure
- Bloom's level: ${bloomLevel}
- Difficulty: integer 2 (medium) or 3 (hard)

Return ONLY a JSON array — no markdown, no extra text — with this exact structure:
[{
  "question_text": "...",
  "expected_answer": "150–250 word model answer with intro / 4 main points / conclusion",
  "marking_scheme": { "points": [
    { "point": "introduction with definition / context", "marks": 1 },
    { "point": "first main idea (most important)", "marks": 1 },
    { "point": "second main idea", "marks": 1 },
    { "point": "third main idea", "marks": 1 },
    { "point": "conclusion / summary", "marks": 1 }
  ]},
  "max_marks": 5,
  "word_limit": 250,
  "bloom_level": "${bloomLevel}",
  "difficulty": 3
}]

Do not include any other fields. The marks in the marking_scheme.points array must sum to max_marks.`
}

// ─── Claude caller ───────────────────────────────────────────────────────────

async function callClaude(
  systemPrompt: string,
  userPrompt: string,
  grade: string,
  subject: string,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  // Local circuit-breaker stays in place — admin gate so a sustained outage
  // doesn't drown the batch in MoL retry latency. MoL has its own internal
  // circuit-breaker (providers/shared.ts) gating provider-level retries.
  if (!circuitBreaker.canRequest()) {
    return { ok: false, error: 'Circuit breaker open — too many recent failures' }
  }

  // ROLLBACK GATE (Phase 1A — 2026-06-03):
  // ff_mol_admin_functions_v1 OFF (or kill_switch=true) → legacy path.
  if (!(await isMolAdminRoutingEnabled())) {
    return callClaudeLegacy(systemPrompt, userPrompt)
  }

  try {
    // task_type='quiz_generation' — the router's quiz_generation chain matches
    // exactly what we want (gpt-4o-mini primary, Haiku fallback). Force OpenAI
    // primary via preferred_provider; preserves admin-only cost posture even
    // if routing weights drift.
    const molResult = await generateResponse({
      task_type: 'quiz_generation',
      input: { instruction: userPrompt },
      student_context: {
        // Synthetic admin namespace — no real student behind this call.
        student_id: `admin-bulk-non-mcq-gen-${grade}-${subject}`,
        grade,
        language: 'en',
      },
      config: {
        surface: 'quiz',
        preferred_provider: 'openai',
        temperature_override: 0.3,
        system_prompt_override: systemPrompt,
        max_tokens_override: 4096, // SA/LA batches: 5×500 or 3×1500 output tokens
      },
    })
    if (!molResult.text) {
      circuitBreaker.recordFailure()
      return { ok: false, error: 'MoL returned empty content' }
    }
    circuitBreaker.recordSuccess()
    return { ok: true, text: molResult.text }
  } catch (e) {
    circuitBreaker.recordFailure()
    if (e instanceof MolError) {
      return { ok: false, error: `MoL ${e.code}: ${e.message}` }
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * LEGACY PATH (pre-Phase-1A, kept byte-for-byte). Restored from git HEAD
 * snapshot so the rollback flag can revert to known-good behavior on
 * emergency. The circuit-breaker accounting matches the MoL path's
 * recordSuccess / recordFailure boundaries so a flag flip doesn't bias
 * the breaker.
 */
async function callClaudeLegacy(
  systemPrompt: string,
  userPrompt: string,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  if (!ANTHROPIC_API_KEY) {
    return { ok: false, error: 'ANTHROPIC_API_KEY not configured' }
  }

  try {
    // eslint-disable-next-line alfanumrik/no-direct-ai-calls -- legacy rollback path for ff_mol_admin_functions_v1; do not remove without retiring the rollback flag.
    const res = await fetchWithProviderTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        temperature: 0.4,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })
    if (!res.ok) {
      circuitBreaker.recordFailure()
      const errText = await res.text()
      return { ok: false, error: `Claude API ${res.status}: ${errText.slice(0, 400)}` }
    }
    const body = await res.json() as { content?: { type: string; text: string }[] }
    const text = body.content?.find(c => c.type === 'text')?.text ?? ''
    if (!text) {
      circuitBreaker.recordFailure()
      return { ok: false, error: 'Claude returned empty content' }
    }
    circuitBreaker.recordSuccess()
    return { ok: true, text }
  } catch (e) {
    circuitBreaker.recordFailure()
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ─── JSON extractor (tolerate markdown fences / leading text) ────────────────

function extractJsonArray(text: string): unknown[] | null {
  const stripped = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
  const start = stripped.indexOf('[')
  const end = stripped.lastIndexOf(']')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(stripped.slice(start, end + 1))
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

// ─── Per-type validator ──────────────────────────────────────────────────────

function isValidQuestion(
  q: unknown,
  qType: QuestionType,
): { valid: true; q: GeneratedQuestion } | { valid: false; reason: string } {
  if (!q || typeof q !== 'object') return { valid: false, reason: 'not_object' }
  const item = q as Record<string, unknown>

  // question_text
  if (typeof item.question_text !== 'string') return { valid: false, reason: 'question_text_missing' }
  const text = item.question_text.trim()
  if (text.length < 15 || text.length > 1000) return { valid: false, reason: 'question_text_length' }
  if (text.includes('{{') || text.includes('[BLANK]')) return { valid: false, reason: 'template_marker' }

  // expected_answer
  if (typeof item.expected_answer !== 'string') return { valid: false, reason: 'expected_answer_missing' }
  const expected = item.expected_answer.trim()
  const minExpected = qType === 'long_answer' ? 80 : 20
  const maxExpected = qType === 'long_answer' ? 2000 : 400
  if (expected.length < minExpected) return { valid: false, reason: 'expected_answer_too_short' }
  if (expected.length > maxExpected) return { valid: false, reason: 'expected_answer_too_long' }

  // No answer leakage in stem
  const stemLower = text.toLowerCase()
  const expectedLower = expected.toLowerCase()
  // Cheap heuristic: if any 8-word slice of the expected answer appears verbatim in the stem,
  // that's a clear answer leak.
  const expectedWords = expectedLower.split(/\s+/).filter(w => w.length > 0)
  for (let i = 0; i + 8 <= expectedWords.length; i++) {
    const slice = expectedWords.slice(i, i + 8).join(' ')
    if (slice.length > 30 && stemLower.includes(slice)) {
      return { valid: false, reason: 'answer_leakage' }
    }
  }

  // marking_scheme
  if (!item.marking_scheme || typeof item.marking_scheme !== 'object') {
    return { valid: false, reason: 'marking_scheme_missing' }
  }
  const ms = item.marking_scheme as Record<string, unknown>
  if (!Array.isArray(ms.points)) return { valid: false, reason: 'marking_scheme_points_not_array' }
  const points = ms.points as Record<string, unknown>[]
  const minPoints = qType === 'long_answer' ? 3 : 1
  const maxPoints = qType === 'long_answer' ? 8 : 5
  if (points.length < minPoints || points.length > maxPoints) {
    return { valid: false, reason: `marking_scheme_points_count_out_of_range_${points.length}` }
  }
  for (const p of points) {
    if (typeof p.point !== 'string' || (p.point as string).trim().length < 5) {
      return { valid: false, reason: 'marking_scheme_point_text_invalid' }
    }
    if (typeof p.marks !== 'number' || p.marks <= 0) {
      return { valid: false, reason: 'marking_scheme_point_marks_invalid' }
    }
  }

  // max_marks consistency
  if (typeof item.max_marks !== 'number') return { valid: false, reason: 'max_marks_missing' }
  const maxMarks = item.max_marks
  const expectedMaxMarks = qType === 'long_answer' ? 5 : 2
  if (maxMarks !== expectedMaxMarks) {
    return { valid: false, reason: `max_marks_must_be_${expectedMaxMarks}` }
  }
  const sumOfPointMarks = points.reduce((acc, p) => acc + (typeof p.marks === 'number' ? p.marks : 0), 0)
  if (Math.abs(sumOfPointMarks - maxMarks) > 0.01) {
    return { valid: false, reason: `marks_sum_${sumOfPointMarks}_!=_${maxMarks}` }
  }

  // word_limit
  if (typeof item.word_limit !== 'number') return { valid: false, reason: 'word_limit_missing' }
  const expectedWordLimit = qType === 'long_answer' ? 250 : 60
  if (item.word_limit < expectedWordLimit / 2 || item.word_limit > expectedWordLimit * 2) {
    return { valid: false, reason: `word_limit_out_of_range_${item.word_limit}` }
  }

  // bloom_level
  if (typeof item.bloom_level !== 'string') return { valid: false, reason: 'bloom_level_missing' }
  const validBloom = ['remember','understand','apply','analyze','evaluate','create']
  if (!validBloom.includes(item.bloom_level.toLowerCase())) {
    return { valid: false, reason: 'bloom_level_invalid' }
  }

  // difficulty
  if (typeof item.difficulty !== 'number' || !Number.isInteger(item.difficulty)) {
    return { valid: false, reason: 'difficulty_not_integer' }
  }
  if (item.difficulty < 1 || item.difficulty > 3) {
    return { valid: false, reason: 'difficulty_out_of_range' }
  }

  return {
    valid: true,
    q: {
      question_text: text,
      expected_answer: expected,
      marking_scheme: { points: points.map(p => ({ point: (p.point as string).trim(), marks: p.marks as number })) },
      max_marks: maxMarks,
      word_limit: item.word_limit,
      bloom_level: item.bloom_level.toLowerCase(),
      difficulty: item.difficulty,
    },
  }
}

// ─── DB insert ───────────────────────────────────────────────────────────────

async function insertQuestions(
  questions: GeneratedQuestion[],
  meta: { grade: string; subject: string; chapterNumber: number; qType: QuestionType },
): Promise<{ inserted: InsertedQuestion[]; rejected: string[] }> {
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const inserted: InsertedQuestion[] = []
  const rejected: string[] = []

  for (const q of questions) {
    const row = {
      subject: meta.subject,
      grade: meta.grade,
      chapter_number: meta.chapterNumber,
      question_text: q.question_text,
      question_type: meta.qType,
      question_type_v2: meta.qType,
      cbse_question_type: meta.qType === 'long_answer' ? 'la' : 'sa',
      options: [],
      correct_answer_index: null,
      expected_answer: q.expected_answer,
      answer_text: q.expected_answer,
      answer_rubric: q.marking_scheme,
      max_marks: q.max_marks,
      marks_expected: q.max_marks,
      marks: q.max_marks,
      time_estimate_seconds: meta.qType === 'long_answer' ? 600 : 180,
      explanation: q.expected_answer,
      difficulty: q.difficulty,
      bloom_level: q.bloom_level,
      paper_section: meta.qType === 'long_answer' ? 'C' : 'B',
      is_ncert: false,
      source: 'bulk_non_mcq_gen_2026',
      source_type: 'cbse_style',
      verification_state: 'pending',
      verified_against_ncert: false,
      quality_status: 'ok',
      is_active: true,
    }

    const { data, error } = await admin
      .from('question_bank')
      .insert(row)
      .select('id')
      .single()
    if (error) {
      rejected.push(`db_insert: ${error.message.slice(0, 200)}`)
      continue
    }
    inserted.push({
      ...q,
      id: data!.id as string,
      subject: meta.subject,
      grade: meta.grade,
      chapter_number: meta.chapterNumber,
      question_type_v2: meta.qType,
    })
  }

  return { inserted, rejected }
}

// ─── Main handler ────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // ── Python AI proxy (Pattern B — proxy check is first, before body read) ──
  // shouldProxyToPython reads ONLY headers/flags. forwardToPython consumes the
  // body stream and returns immediately, so req.text() below is never reached
  // on the proxy path.
  try {
    const request_id = req.headers.get('x-request-id') ?? crypto.randomUUID()
    const decision = await shouldProxyToPython({
      flag_name: 'ff_python_bulk_non_mcq_gen_v1',
      endpoint_path: '/v1/bulk-non-mcq-gen',
      request_id,
    })
    if (decision.should_proxy && decision.target_url) {
      return await forwardToPython({ target_url: decision.target_url, request: req })
    }
  } catch (err) {
    console.warn('[bulk-non-mcq-gen] python proxy fell through:', err instanceof Error ? err.message : String(err))
  }

  const origin = req.headers.get('origin')

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: getCorsHeaders(origin) })
  }
  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405, origin)
  }

  // Read body as text — admitAiRoute needs bodyText for request body hash.
  // Safe to call here: proxy path already returned above if active.
  const bodyText = await req.text()

  // Create Supabase admin client for security layer RPCs
  const adminSb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // ── Platform Security Layer admission (Phase 4 Wave 2) ──────────────────
  const admitResult = await admitAiRoute({ req, sb: adminSb, profile: BULK_NON_MCQ_GEN_ROUTE_PROFILE, bodyText })
  if (!admitResult.ok) return admitResult.response
  const { admission } = admitResult

  // ── 2. Parse + validate body ────────────────────────────────────────────────
  let body: RequestBody
  try {
    body = JSON.parse(bodyText) as RequestBody
  } catch {
    await finalizeAiRoute({ sb: adminSb, admission, statusCode: 400, errorCode: 'invalid_json' })
    return errorResponse('Invalid JSON body', 400, origin)
  }

  const grade = String(body.grade ?? '').trim()
  if (!VALID_GRADES.includes(grade)) {
    await finalizeAiRoute({ sb: adminSb, admission, statusCode: 400, errorCode: 'invalid_grade' })
    return errorResponse('grade must be one of "6"-"12"', 400, origin)
  }

  const subject = String(body.subject ?? '').toLowerCase().trim().replace(/\s+/g, '_')
  if (!isValidSubjectForGrade(grade, subject)) {
    await finalizeAiRoute({ sb: adminSb, admission, statusCode: 400, errorCode: 'invalid_subject' })
    return errorResponse(`subject "${subject}" not valid for grade ${grade}`, 400, origin)
  }

  const chapterTitle = String(body.chapter_title ?? '').trim()
  if (chapterTitle.length < 3) {
    await finalizeAiRoute({ sb: adminSb, admission, statusCode: 400, errorCode: 'invalid_chapter_title' })
    return errorResponse('chapter_title required', 400, origin)
  }

  const chapterNumber = Number(body.chapter_number)
  if (!Number.isInteger(chapterNumber) || chapterNumber < 1) {
    await finalizeAiRoute({ sb: adminSb, admission, statusCode: 400, errorCode: 'invalid_chapter_number' })
    return errorResponse('chapter_number must be a positive integer', 400, origin)
  }

  const qType = body.question_type
  if (!VALID_QUESTION_TYPES.includes(qType)) {
    await finalizeAiRoute({ sb: adminSb, admission, statusCode: 400, errorCode: 'invalid_question_type' })
    return errorResponse(`question_type must be one of: ${VALID_QUESTION_TYPES.join(', ')}`, 400, origin)
  }

  const defaultCount = qType === 'long_answer' ? DEFAULT_LA_COUNT : DEFAULT_SA_COUNT
  const count = Math.min(MAX_COUNT, Math.max(1, Number(body.count ?? defaultCount)))
  const bloomLevel = (body.bloom_level ?? (qType === 'long_answer' ? 'analyze' : 'understand')).toLowerCase()

  try {
    // ── 3. Fetch chapter context ─────────────────────────────────────────────
    const context = await fetchChapterContext(grade, subject, chapterNumber)

    // ── 4. Build prompts + call Claude ───────────────────────────────────────
    const systemPrompt = buildSystemPrompt(grade, subject, qType)
    const userPrompt = qType === 'long_answer'
      ? buildLAUserPrompt(grade, subject, chapterTitle, count, bloomLevel, context)
      : buildSAUserPrompt(grade, subject, chapterTitle, count, bloomLevel, context)

    const claudeResult = await callClaude(systemPrompt, userPrompt, grade, subject)
    if (!claudeResult.ok) {
      await finalizeAiRoute({ sb: adminSb, admission, statusCode: 503, errorCode: 'ai_generation_failed' })
      return errorResponse(`AI generation failed: ${claudeResult.error}`, 503, origin)
    }

    // ── 5. Parse + validate ──────────────────────────────────────────────────
    const rawArray = extractJsonArray(claudeResult.text)
    if (!rawArray) {
      await finalizeAiRoute({ sb: adminSb, admission, statusCode: 502, errorCode: 'ai_unparseable' })
      return errorResponse('AI returned an unparseable response. Please retry.', 502, origin)
    }

    const validQuestions: GeneratedQuestion[] = []
    const rejectionReasons: string[] = []
    for (const item of rawArray) {
      const result = isValidQuestion(item, qType)
      if (result.valid) {
        validQuestions.push(result.q)
      } else {
        rejectionReasons.push(result.reason)
      }
    }

    // ── 6. Insert with verification_state='pending' ──────────────────────────
    const { inserted, rejected: dbRejections } = await insertQuestions(validQuestions, {
      grade, subject, chapterNumber, qType,
    })

    rejectionReasons.push(...dbRejections)

    console.warn(JSON.stringify({
      event: 'bulk_non_mcq_gen',
      function_name: 'bulk-non-mcq-gen',
      grade, subject, chapter_number: chapterNumber, chapter_title: chapterTitle,
      question_type: qType, count_requested: count,
      generated: validQuestions.length,
      inserted: inserted.length,
      rejected: rejectionReasons.length,
      bloom_level: bloomLevel,
      has_context: context.length > 0,
      ts: new Date().toISOString(),
    }))

    await finalizeAiRoute({ sb: adminSb, admission, statusCode: 200 })
    return jsonResponse({
      generated: validQuestions.length,
      inserted: inserted.length,
      rejected: rejectionReasons.length,
      rejection_reasons: rejectionReasons.length > 0 ? rejectionReasons : undefined,
      questions: inserted,
    }, 200, {}, origin)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[bulk-non-mcq-gen] Unhandled error:', message)
    await finalizeAiRoute({ sb: adminSb, admission, statusCode: 500, errorCode: 'unhandled_error' })
    return errorResponse(`Internal error: ${message}`, 500, origin)
  }
})
