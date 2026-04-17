/**
 * ⚠️ DEPRECATED — Legacy Foxy Tutor Edge Function
 *
 * This Edge Function is being replaced by src/app/api/foxy/route.ts
 * which uses the new AI orchestration layer (src/lib/ai/).
 *
 * DO NOT add new features here. All new Foxy features go in:
 * - src/lib/ai/workflows/ (workflow logic)
 * - src/lib/ai/prompts/ (prompt templates)
 * - src/app/api/foxy/route.ts (API endpoint)
 *
 * This file will be removed once all traffic is migrated.
 * Migration status: API route is primary, Edge Function is fallback.
 */

/**
 * foxy-tutor – Alfanumrik Edge Function
 *
 * AI Tutoring endpoint for the Foxy Learning Companion.
 * Uses Claude API with RAG context, enforces per-student daily usage limits,
 * persists chat sessions, and streams responses for low latency.
 *
 * POST body:
 * {
 *   message:           string   – student's question / response
 *   student_id:        string   – authenticated student ID
 *   student_name?:     string   – display name (for personalised prompts)
 *   grade:             string   – e.g. "9"
 *   subject:           string   – e.g. "science"
 *   language:          string   – "en" | "hi" | "hinglish"
 *   mode:              string   – "learn" | "quiz" | "revision" | "doubt"
 *   topic_id?:         string   – optional active topic UUID
 *   topic_title?:      string   – optional topic name
 *   session_id?:       string   – existing chat_sessions.id to continue
 *   selected_chapters?: string  – comma-separated chapter context
 *   lesson_step?:      string   – current lesson step (hook, visualization, etc.)
 * }
 *
 * Response:
 * {
 *   reply:       string   – Foxy's response (markdown)
 *   xp_earned:   number   – XP awarded for this interaction
 *   session_id:  string   – chat_sessions.id (created or continued)
 * }
 *
 * Changelog:
 *   v32 (2026-04-08):
 *     - Fix current_count → used_count to match check_and_record_usage return schema
 *     - Remove p_limit from RPC call (DB function derives limit from subscription plan)
 *     - Rename limit → displayLimit to clarify it's for 429 message display only
 *
 *   v33 (2026-04-08):
 *     - Add 'homework' mode: Socratic-only, never give direct answers
 *     - RAG-only enforcement: Foxy must not fabricate NCERT content
 *     - Mode-aware response length limits (concepts: 3 sentences, derivations: 5)
 *     - Remove foxy_chat XP: xpEarned = 0 (mastery events award XP separately)
 *     - Add "never change factual answer under pressure" rule
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { logOpsEvent } from '../_shared/ops-events.ts'
import { validateSubjectRpc } from '../_shared/subjects-validate.ts'

// ─── CORS ────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'https://alfanumrik.com',
  'https://www.alfanumrik.com',
  'https://alfanumrik.vercel.app',
  'https://alfanumrik-ten.vercel.app',
]
function getCorsHeaders(origin?: string | null): Record<string, string> {
  const isAllowed = origin && (
    ALLOWED_ORIGINS.includes(origin) ||
    (origin.endsWith('.vercel.app') && origin.includes('alfanumrik'))
  )
  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id, x-cron-secret',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
}
function jsonResponse(body: unknown, status = 200, extra: Record<string, string> = {}, origin?: string | null): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...getCorsHeaders(origin), 'Content-Type': 'application/json', ...extra } })
}
function errorResponse(message: string, status = 400, origin?: string | null): Response {
  return jsonResponse({ error: message }, status, {}, origin)
}

// ─── Environment ─────────────────────────────────────────────────────────────
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

// ─── Circuit breaker ──────────────────────────────────────────────────────────
const circuitBreaker = {
  failures: 0,
  lastFailureAt: 0,
  state: 'closed' as 'closed' | 'open' | 'half-open',
  FAILURE_THRESHOLD: 5,
  RESET_TIMEOUT: 60_000,

  canRequest(): boolean {
    if (this.state === 'closed') return true
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureAt > this.RESET_TIMEOUT) {
        this.state = 'half-open'
        return true
      }
      return false
    }
    return false
  },
  recordSuccess(): void { this.failures = 0; this.state = 'closed' },
  recordFailure(): void {
    this.failures++
    this.lastFailureAt = Date.now()
    if (this.failures >= this.FAILURE_THRESHOLD) this.state = 'open'
  },
}

const FALLBACK_REPLIES: Record<string, string> = {
  en: "I'm having trouble connecting right now. Please try again in a moment! In the meantime, you can review your notes or try a quiz. 🦊",
  hi: "अभी कनेक्ट करने में समस्या हो रही है। कृपया कुछ देर बाद पुनः प्रयास करें! 🦊",
  hinglish: "Abhi connection mein thodi problem aa rahi hai. Please thodi der baad try karo! 🦊",
}

// ─── Rate limiter (in-memory, bounded) ────────────────────────────────────────
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_WINDOW = 60_000
const RATE_MAX = 30
const RATE_MAP_MAX_SIZE = 5_000

function checkRateLimit(key: string): boolean {
  const now = Date.now()
  const e = rateLimitMap.get(key)
  if (!e || now > e.resetAt) {
    if (rateLimitMap.size >= RATE_MAP_MAX_SIZE) {
      const firstKey = rateLimitMap.keys().next().value
      if (firstKey) rateLimitMap.delete(firstKey)
    }
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_WINDOW })
    return true
  }
  if (e.count >= RATE_MAX) return false
  e.count++
  return true
}
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of rateLimitMap) { if (now > v.resetAt) rateLimitMap.delete(k) }
}, 120_000)

// ─── Plan limits (display only — enforcement uses DB-derived values) ──────────
const PLAN_LIMITS: Record<string, number> = {
  free: 5, starter: 30, pro: 100, unlimited: 999999,
}
const PLAN_ALIAS: Record<string, string> = {
  basic: 'starter', premium: 'pro', ultimate: 'unlimited',
}
function normalizePlan(plan: string): string {
  const base = plan.replace(/_(monthly|yearly)$/, '')
  return PLAN_ALIAS[base] ?? base
}

// ─── System prompt ─────────────────────────────────────────────────────────────
function buildSystemPrompt(
  grade: string, subject: string, language: string, mode: string,
  topicTitle: string | null, chapters: string | null,
  lessonStep: string | null, ragContext: string | null,
): string {
  const lang = language === 'hi' ? 'Hindi (Devanagari script)'
    : language === 'hinglish' ? 'Hinglish (Hindi+English mix)' : 'English'
  const modeInstr: Record<string, string> = {
    learn: 'Teach concepts step-by-step with examples. Use the Socratic method — ask guiding questions. Max 3 sentences for a concept explanation.',
    quiz: 'Ask one question at a time. Wait for the student to answer before revealing the correct answer. Give encouraging feedback. Max 2 sentences per hint.',
    revision: 'Provide concise revision notes with key points, formulas, and common exam mistakes. Max 5 bullet points per response.',
    doubt: 'The student has a specific doubt. Give a clear, direct explanation with ONE example. Max 4 sentences.',
    homework: 'The student is doing homework. NEVER give direct answers. Use ONLY the Socratic method: ask guiding questions that help the student discover the answer themselves. If pressed for answers, say: "I know you can figure this out! What happens when you [guiding question]?" Log all homework interactions separately.',
  }
  const stepInstr = lessonStep ? ({
    hook: 'Start with a captivating real-life hook that makes the topic feel relevant and exciting.',
    visualization: 'Use a visual analogy, diagram description, or mental model to explain the concept.',
    guided_examples: 'Walk through 2 solved examples step-by-step, narrating your thought process.',
    active_recall: 'Ask 2-3 recall questions. Let the student answer FIRST. Then reveal the answer.',
    application: 'Give 2 CBSE board-style application/analysis questions for the student to attempt.',
    spaced_revision: 'Provide a quick revision summary: key points, formulas, and common mistakes.',
  } as Record<string, string>)[lessonStep] || '' : ''

  let prompt = `You are Foxy 🦊, a warm, encouraging AI tutor for Indian students.

STUDENT: Grade ${grade} | Subject: ${subject}
LANGUAGE: Respond in ${lang}. Use simple, age-appropriate language.
MODE: ${modeInstr[mode] || modeInstr.learn}
${stepInstr ? `\nLESSON STEP: ${stepInstr}` : ''}
${topicTitle ? `\nACTIVE TOPIC: ${topicTitle}` : ''}
${chapters ? `\nSELECTED CHAPTERS: ${chapters}` : ''}

RULES:
- Follow the MODE length limit strictly. Never write paragraphs when 3 sentences will do.
- Use markdown: **bold** for key terms, \`code\` for formulas.
- Include [KEY: term] tags for important concepts.
- For math/science, use [FORMULA: expression] tags.
- For exam tips, use [TIP: advice] tags.
- End teaching responses with a follow-up question to keep engagement.
- Never reveal you're Claude or an AI model. You are Foxy the fox tutor.
- Follow NCERT/CBSE curriculum strictly for Indian board exams.
- FACTUAL INTEGRITY: If you have given a correct NCERT answer and the student insists it is wrong, DO NOT change your answer. Say: "I checked the NCERT material and my answer is correct. Let me explain why..."
- HOMEWORK MODE: Never directly solve homework problems. Guide only.`

  if (ragContext) {
    prompt += `\n\nNCERT REFERENCE MATERIAL:\n${ragContext}\n\nCRITICAL: Answer ONLY using the NCERT material above. If the answer is not in the material, say: "Let me check my NCERT materials for this — I want to give you the correct answer." Do NOT answer from general knowledge for factual/conceptual questions.`
  } else {
    prompt += `\n\nNOTE: No specific NCERT material was retrieved for this query. For factual questions, acknowledge the limitation and encourage the student to verify in their textbook.`
  }
  return prompt
}

// ─── RAG retrieval (FTS via match_rag_chunks, best-effort) ───────────────────
async function fetchRAGContext(
  supabase: ReturnType<typeof createClient>,
  query: string, subject: string, grade: string, board: string | null = null,
): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('match_rag_chunks', {
      query_text: query, p_subject: subject, p_grade: grade,
      match_count: 3, p_board: board, p_min_quality: 0.5,
    })
    if (error || !data || data.length === 0) return null
    return data.map((chunk: { content: string }) => chunk.content).join('\n\n---\n\n')
  } catch { return null }
}

// ─── JWT verification + student_id resolution ─────────────────────────────────
async function verifyAndGetStudentId(
  req: Request,
): Promise<{ studentId: string; authUserId: string } | { error: string; status: number }> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return { error: 'Missing or invalid Authorization header', status: 401 }

  const token = authHeader.replace('Bearer ', '')
  const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') || '', {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) return { error: 'Invalid or expired token', status: 401 }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const { data: student, error: studentError } = await adminClient
    .from('students').select('id').eq('auth_user_id', user.id).eq('is_active', true).maybeSingle()
  if (studentError || !student) return { error: 'No active student profile linked to this account', status: 403 }

  return { studentId: student.id, authUserId: user.id }
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  const cors = getCorsHeaders(origin)

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405, origin)
  if (!ANTHROPIC_API_KEY) return errorResponse('Tutor not configured', 503, origin)

  try {
    const authResult = await verifyAndGetStudentId(req)
    if ('error' in authResult) return errorResponse(authResult.error, authResult.status, origin)
    const { studentId: student_id } = authResult

    const body = await req.json()
    const {
      message, student_name, grade, subject,
      language = 'en', mode = 'learn',
      topic_id, topic_title, session_id, selected_chapters, lesson_step,
    } = body

    if (!message || typeof message !== 'string') return errorResponse('message is required', 400, origin)
    if (!grade || !subject) return errorResponse('grade and subject are required', 400, origin)

    const MAX_MESSAGE_LENGTH = 5000
    const safeMessage = message.replace(/<\/?\s*[a-zA-Z][^>]{0,500}>/g, '').trim().slice(0, MAX_MESSAGE_LENGTH)
    if (!safeMessage) return errorResponse('Message is empty after sanitization', 400, origin)

    const VALID_MODES = ['learn', 'quiz', 'revision', 'doubt', 'homework']
    const safeMode = VALID_MODES.includes(mode) ? mode : 'learn'
    const VALID_LANGUAGES = ['en', 'hi', 'hinglish']
    const safeLanguage = VALID_LANGUAGES.includes(language) ? language : 'en'
    const safeTopicTitle = topic_title ? topic_title.replace(/<[^>]*>/g, '').replace(/[{}`]/g, '').slice(0, 200) : null
    const safeChapters = selected_chapters ? selected_chapters.replace(/<[^>]*>/g, '').replace(/[{}`]/g, '').slice(0, 500) : null
    const VALID_LESSON_STEPS = ['hook', 'visualization', 'guided_examples', 'active_recall', 'application', 'spaced_revision']
    const safeLessonStep = lesson_step && VALID_LESSON_STEPS.includes(lesson_step) ? lesson_step : null
    void student_name // available but not interpolated into prompt to prevent injection

    if (!checkRateLimit(student_id)) return errorResponse('Too many messages. Please slow down.', 429, origin)

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const today = new Date().toISOString().slice(0, 10)

    // ── Subject governance (P12) ──────────────────────────────────────────────
    // Reject requests that address a subject the student is not enrolled in /
    // whose plan does not unlock. See:
    //   docs/superpowers/specs/2026-04-15-subject-governance-design.md §6.2
    try {
      const check = await validateSubjectRpc(supabase, student_id, subject)
      if (!check.ok) {
        return jsonResponse(
          { error: 'subject_not_allowed', reason: check.reason, subject },
          422,
          {},
          origin,
        )
      }
    } catch (subjErr) {
      console.error('subject validation failed:', subjErr instanceof Error ? subjErr.message : String(subjErr))
      return jsonResponse(
        { error: 'subject_not_allowed', reason: 'grade', subject },
        422,
        {},
        origin,
      )
    }

    const studentResult = await supabase.from('students').select('subscription_plan, board')
      .eq('id', student_id).maybeSingle()
    const studentBoard = studentResult.data?.board ?? null

    const [sessionResult, ragContext] = await Promise.all([
      session_id
        ? supabase.from('chat_sessions').select('messages').eq('id', session_id).eq('student_id', student_id).maybeSingle()
        : Promise.resolve({ data: null }),
      fetchRAGContext(supabase, safeMessage, subject, grade, studentBoard),
    ])

    const plan = normalizePlan(studentResult.data?.subscription_plan || 'free')
    const displayLimit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free   // for 429 message only

    // ── Atomic quota enforcement — DB derives real limit from subscription_plans ──
    // p_limit intentionally omitted: check_and_record_usage(v2) ignores it anyway
    const { data: usageRows, error: usageErr } = await supabase.rpc('check_and_record_usage', {
      p_student_id: student_id,
      p_feature:    'foxy_chat',
      p_usage_date: today,
    })
    if (usageErr) {
      console.error('check_and_record_usage failed:', usageErr.message)
      return errorResponse('Usage tracking unavailable, please try again', 503, origin)
    }
    const usageRow = usageRows?.[0]
    if (!usageRow?.allowed) {
      const usedCount = usageRow?.used_count ?? displayLimit  // v32: used_count (not current_count)
      return jsonResponse({
        error: 'Daily chat limit reached',
        code: 'CHAT_LIMIT',
        reply: safeLanguage === 'hi'
          ? `आज के ${displayLimit} संदेश पूरे हो गए। कल फिर आना! 🦊`
          : `You've used all ${displayLimit} messages for today. Come back tomorrow! 🦊`,
        xp_earned: 0,
        session_id: session_id || null,
        used: usedCount,
        limit: displayLimit,
      }, 429, {}, origin)
    }

    let chatHistory: Array<{ role: string; content: string }> = []
    let activeSessionId = session_id || null

    if (sessionResult.data?.messages) {
      const msgs = Array.isArray(sessionResult.data.messages) ? sessionResult.data.messages : []
      chatHistory = msgs.slice(-10).map((m: { role: string; content: string }) => ({
        role: m.role === 'student' ? 'user' : 'assistant', content: m.content,
      }))
    }

    const systemPrompt = buildSystemPrompt(grade, subject, safeLanguage, safeMode, safeTopicTitle, safeChapters, safeLessonStep, ragContext)
    const messages = [...chatHistory, { role: 'user', content: safeMessage }]
    const startTime = Date.now()

    if (!circuitBreaker.canRequest()) {
      console.warn('Circuit breaker OPEN — returning fallback response')
      return jsonResponse({ reply: FALLBACK_REPLIES[safeLanguage] || FALLBACK_REPLIES.en, xp_earned: 0, session_id: activeSessionId, fallback: true }, 200, {}, origin)
    }

    async function callClaude(): Promise<Response> {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 20_000)
      try {
        // eslint-disable-next-line alfanumrik/no-direct-ai-calls -- TODO(phase-4-cleanup): delete foxy-tutor Edge Function once ff_foxy_grounded_only defaults to true; all Foxy traffic flows through /api/foxy + grounded-answer.
        return await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1024, system: systemPrompt, messages }),
          signal: controller.signal,
        })
      } finally { clearTimeout(timeoutId) }
    }

    let claudeRes: Response | null = null
    let lastError: string | null = null
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        claudeRes = await callClaude()
        if (claudeRes.ok) { circuitBreaker.recordSuccess(); break }
        if ([429, 500, 502, 503].includes(claudeRes.status) && attempt === 0) {
          lastError = `HTTP ${claudeRes.status}`
          await new Promise(r => setTimeout(r, 1000)); claudeRes = null; continue
        }
        lastError = `HTTP ${claudeRes.status}`; break
      } catch (fetchErr) {
        lastError = fetchErr instanceof DOMException && fetchErr.name === 'AbortError' ? 'Timeout (20s)' : String(fetchErr)
        if (attempt === 0) { await new Promise(r => setTimeout(r, 1000)); continue }
      }
    }

    const latencyMs = Date.now() - startTime
    if (!claudeRes?.ok) {
      circuitBreaker.recordFailure()
      console.error('Claude API failed after retries:', lastError, `(${latencyMs}ms)`)
      return jsonResponse({ reply: FALLBACK_REPLIES[safeLanguage] || FALLBACK_REPLIES.en, xp_earned: 0, session_id: activeSessionId, fallback: true }, 200, {}, origin)
    }

    const claudeData = await claudeRes.json()
    const reply = claudeData.content?.[0]?.text || 'Hmm, let me think about that...'
    // XP for Foxy chat is 0: mastery-linked XP is awarded separately by quiz/topic
    // completion events, not by chat message count.
    const xpEarned = 0
    const now = new Date().toISOString()
    const newMessages = [
      { role: 'student', content: safeMessage, ts: now },
      { role: 'assistant', content: reply, ts: now, meta: { xp: xpEarned, latency: latencyMs } },
    ]

    if (activeSessionId) {
      const MAX_SESSION_MESSAGES = 200
      const prevMessages = Array.isArray(sessionResult.data?.messages) ? sessionResult.data.messages : []
      const trimmedPrev = prevMessages.length >= MAX_SESSION_MESSAGES ? prevMessages.slice(-(MAX_SESSION_MESSAGES - 2)) : prevMessages
      supabase.from('chat_sessions').update({
        messages: [...trimmedPrev, ...newMessages],
        message_count: trimmedPrev.length + newMessages.length,
        updated_at: now,
      }).eq('id', activeSessionId).eq('student_id', student_id).then(() => {}).catch(() => {})
    } else {
      const { data: newSession } = await supabase.from('chat_sessions').insert({
        student_id, subject, grade,
        title: safeTopicTitle || `${subject} chat`,
        messages: newMessages, message_count: 2, is_active: true, created_at: now, updated_at: now,
      }).select('id').maybeSingle()
      activeSessionId = newSession?.id || null
    }

    if (xpEarned > 0) {
      supabase.rpc('add_xp', { p_student_id: student_id, p_xp: xpEarned, p_source: `foxy_${subject}` })
        .then(() => {}).catch((e: Error) => console.error('add_xp failed:', e.message))
    }

    supabase.from('ai_tutor_logs').insert({
      student_id, session_id: activeSessionId, subject, grade, mode,
      topic_id: topic_id || null, lesson_step: safeLessonStep,
      message_length: safeMessage.length, reply_length: reply.length,
      latency_ms: latencyMs, model: 'claude-haiku-4-5-20251001',
      xp_earned: xpEarned, language: safeLanguage, created_at: now,
    }).then(() => {}).catch(() => {})

    logOpsEvent({
      category: 'ai',
      source: 'foxy-tutor',
      severity: 'info',
      message: `Foxy tutor response succeeded`,
      subjectType: 'student',
      subjectId: student_id,
      context: { subject, grade, mode: safeMode, latency_ms: latencyMs, session_id: activeSessionId },
    })

    return jsonResponse({ reply, xp_earned: xpEarned, session_id: activeSessionId }, 200, {}, origin)
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error('foxy-tutor error:', err)

    await logOpsEvent({
      category: 'ai',
      source: 'foxy-tutor',
      severity: 'error',
      message: `Foxy tutor unhandled error: ${errMsg.slice(0, 300)}`,
      context: { error: errMsg.slice(0, 500) },
    })

    return errorResponse('Internal server error', 500, origin)
  }
})
