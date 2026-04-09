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
      event:         'bulk_question_gen',
      function_name: 'bulk-question-gen',
      grade,
      subject:       safeSubject,
      chapter:       safeChapter,
      requested:     count,
      generated,
      inserted:      inserted.length,
      rejected:      rejectedCount.value,
      difficulty,
      bloom_level:   bloomLevel,
      model:         'claude-haiku-4-5-20251001',
      ts:            new Date().toISOString(),
    }))

    // ── 8. Return result ────────────────────────────────────────────────────
    return jsonResponse(
      {
        generated,
        inserted:  inserted.length,
        rejected:  rejectedCount.value > 0 ? rejectedCount.value : undefined,
        questions: inserted,
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
