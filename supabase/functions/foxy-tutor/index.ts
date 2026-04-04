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
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ─── CORS (inlined to avoid relative-import path issues across deploy methods) ─
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

// ─── Environment ────────────────────────────────────────────────
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

// ─── Circuit breaker for Claude API ─────────────────────────────
// Prevents hammering a failing API. Trips after 5 consecutive failures,
// reopens after 60 seconds (half-open: allows 1 test request).
const circuitBreaker = {
  failures: 0,
  lastFailureAt: 0,
  state: 'closed' as 'closed' | 'open' | 'half-open',
  FAILURE_THRESHOLD: 5,
  RESET_TIMEOUT: 60_000, // 60 seconds

  canRequest(): boolean {
    if (this.state === 'closed') return true
    if (this.state === 'open') {
      // Check if reset timeout has elapsed
      if (Date.now() - this.lastFailureAt > this.RESET_TIMEOUT) {
        this.state = 'half-open'
        return true // Allow one test request
      }
      return false
    }
    // half-open: already allowed one request, block further until result
    return false
  },

  recordSuccess(): void {
    this.failures = 0
    this.state = 'closed'
  },

  recordFailure(): void {
    this.failures++
    this.lastFailureAt = Date.now()
    if (this.failures >= this.FAILURE_THRESHOLD) {
      this.state = 'open'
    }
  },
}

const FALLBACK_REPLIES: Record<string, string> = {
  en: "I'm having trouble connecting right now. Please try again in a moment! In the meantime, you can review your notes or try a quiz. 🦊",
  hi: "अभी कनेक्ट करने में समस्या हो रही है। कृपया कुछ देर बाद पुनः प्रयास करें! 🦊",
  hinglish: "Abhi connection mein thodi problem aa rahi hai. Please thodi der baad try karo! 🦊",
}

// ─── Rate limiter (in-memory, per-isolate, bounded) ─────────────
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_WINDOW = 60_000
const RATE_MAX = 30 // 30 messages per minute per student
const RATE_MAP_MAX_SIZE = 5_000 // Prevent unbounded memory growth

function checkRateLimit(key: string): boolean {
  const now = Date.now()
  const e = rateLimitMap.get(key)
  if (!e || now > e.resetAt) {
    // Evict oldest entries if at capacity
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
  for (const [k, v] of rateLimitMap) {
    if (now > v.resetAt) rateLimitMap.delete(k)
  }
}, 120_000)

// ─── Usage limits by plan ──────────────────────────────────────
const PLAN_LIMITS: Record<string, number> = {
  free: 5,
  starter: 30,
  pro: 100,
  unlimited: 999999,
}

const PLAN_ALIAS: Record<string, string> = {
  basic: 'starter', premium: 'pro', ultimate: 'unlimited',
}

function normalizePlan(plan: string): string {
  const base = plan.replace(/_(monthly|yearly)$/, '')
  return PLAN_ALIAS[base] ?? base
}

// ─── System prompt ─────────────────────────────────────────────
function buildSystemPrompt(
  grade: string,
  subject: string,
  language: string,
  mode: string,
  topicTitle: string | null,
  chapters: string | null,
  lessonStep: string | null,
  ragContext: string | null,
): string {
  const lang =
    language === 'hi' ? 'Hindi (Devanagari script)'
    : language === 'hinglish' ? 'Hinglish (Hindi+English mix)'
    : 'English'

  const modeInstr: Record<string, string> = {
    learn: 'Teach concepts step-by-step with examples. Use the Socratic method — ask guiding questions.',
    quiz: 'Ask one question at a time. Wait for the student to answer before revealing the correct answer. Give encouraging feedback.',
    revision: 'Provide concise revision notes with key points, formulas, and common exam mistakes.',
    doubt: 'The student has a specific doubt. Give a clear, direct explanation with an example.',
  }

  const stepInstr = lessonStep ? {
    hook: 'Start with a captivating real-life hook that makes the topic feel relevant and exciting.',
    visualization: 'Use a visual analogy, diagram description, or mental model to explain the concept.',
    guided_examples: 'Walk through 2 solved examples step-by-step, narrating your thought process.',
    active_recall: 'Ask 2-3 recall questions. Let the student answer FIRST. Then reveal the answer.',
    application: 'Give 2 CBSE board-style application/analysis questions for the student to attempt.',
    spaced_revision: 'Provide a quick revision summary: key points, formulas, and common mistakes.',
  }[lessonStep] || '' : ''

  let prompt = `You are Foxy 🦊, a warm, encouraging AI tutor for Indian students.

STUDENT: Grade ${grade} | Subject: ${subject}
LANGUAGE: Respond in ${lang}. Use simple, age-appropriate language.
MODE: ${modeInstr[mode] || modeInstr.learn}
${stepInstr ? `\nLESSON STEP: ${stepInstr}` : ''}
${topicTitle ? `\nACTIVE TOPIC: ${topicTitle}` : ''}
${chapters ? `\nSELECTED CHAPTERS: ${chapters}` : ''}

RULES:
- Be concise. Aim for 150-300 words per response.
- Use markdown: **bold** for key terms, \`code\` for formulas.
- Include [KEY: term] tags for important concepts.
- For math/science, use [FORMULA: expression] tags.
- For exam tips, use [TIP: advice] tags.
- End teaching responses with a follow-up question to keep engagement.
- Award XP: 5 for good questions, 10 for correct answers, 15 for explanations.
- Never reveal you're Claude or an AI model. You are Foxy the fox tutor.
- Follow NCERT/CBSE curriculum strictly for Indian board exams.
- If unsure, say so honestly rather than giving wrong information.`

  if (ragContext) {
    prompt += `\n\nREFERENCE MATERIAL (use if relevant, don't mention "reference material" to student):\n${ragContext}`
  }

  return prompt
}

// ─── RAG retrieval (best-effort) ───────────────────────────────
async function fetchRAGContext(
  supabase: ReturnType<typeof createClient>,
  query: string,
  subject: string,
  grade: string,
  board: string | null = null,
): Promise<string | null> {
  try {
    // Try to call the match_rag_chunks RPC if it exists
    const { data, error } = await supabase.rpc('match_rag_chunks', {
      query_text: query,
      p_subject: subject,
      p_grade: grade,
      match_count: 3,
      p_board: board,       // Filter content to student's curriculum board
      p_min_quality: 0.5,   // Exclude low-quality/malformed chunks
    })

    if (error || !data || data.length === 0) return null

    return data
      .map((chunk: { content: string; similarity?: number }) => chunk.content)
      .join('\n\n---\n\n')
  } catch {
    // RAG not available — proceed without context
    return null
  }
}

// ─── JWT verification ───────────────────────────────────────────
async function verifyAndGetStudentId(
  req: Request,
): Promise<{ studentId: string; authUserId: string } | { error: string; status: number }> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: 'Missing or invalid Authorization header', status: 401 }
  }

  const token = authHeader.replace('Bearer ', '')

  // Create a client scoped to the user's JWT — this validates the token
  // against Supabase Auth server (not just local decode)
  const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') || '', {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) {
    return { error: 'Invalid or expired token', status: 401 }
  }

  // Look up student_id from verified auth user — NEVER trust client-supplied student_id
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const { data: student, error: studentError } = await adminClient
    .from('students')
    .select('id')
    .eq('auth_user_id', user.id)
    .eq('is_active', true)
    .maybeSingle()

  if (studentError || !student) {
    return { error: 'No active student profile linked to this account', status: 403 }
  }

  return { studentId: student.id, authUserId: user.id }
}

// ─── Main handler ──────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  const cors = getCorsHeaders(origin)

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405, origin)
  }

  if (!ANTHROPIC_API_KEY) {
    return errorResponse('Tutor not configured', 503, origin)
  }

  try {
    // ── Verify JWT and resolve student_id from auth ──
    const authResult = await verifyAndGetStudentId(req)
    if ('error' in authResult) {
      return errorResponse(authResult.error, authResult.status, origin)
    }
    const { studentId: student_id, authUserId: _authUserId } = authResult

    const body = await req.json()
    const {
      message,
      student_name,
      grade,
      subject,
      language = 'en',
      mode = 'learn',
      topic_id,
      topic_title,
      session_id,
      selected_chapters,
      lesson_step,
    } = body

    if (!message || typeof message !== 'string') {
      return errorResponse('message is required', 400, origin)
    }
    if (!grade || !subject) {
      return errorResponse('grade and subject are required', 400, origin)
    }

    // ── Message sanitization ──
    // Strip HTML tags to prevent injection of markup into the prompt.
    // Pattern only matches tags that start with a letter (real HTML tags),
    // so mathematical operators like "2 < 3" or "x > 0" are preserved.
    // Length cap prevents token exhaustion attacks (~1500 tokens max).
    const MAX_MESSAGE_LENGTH = 5000
    const safeMessage = message
      .replace(/<\/?\s*[a-zA-Z][^>]{0,500}>/g, '')  // strip HTML tags (bounded, no ReDoS)
      .trim()
      .slice(0, MAX_MESSAGE_LENGTH)
    if (!safeMessage) {
      return errorResponse('Message is empty after sanitization', 400, origin)
    }

    // Whitelist mode to prevent prompt injection via arbitrary mode strings
    const VALID_MODES = ['learn', 'quiz', 'revision', 'doubt']
    const safeMode = VALID_MODES.includes(mode) ? mode : 'learn'

    // Whitelist language
    const VALID_LANGUAGES = ['en', 'hi', 'hinglish']
    const safeLanguage = VALID_LANGUAGES.includes(language) ? language : 'en'

    // Sanitize topic_title: strip anything that looks like prompt injection
    const safeTopicTitle = topic_title
      ? topic_title.replace(/<[^>]*>/g, '').replace(/[{}`]/g, '').slice(0, 200)
      : null

    // Sanitize selected_chapters
    const safeChapters = selected_chapters
      ? selected_chapters.replace(/<[^>]*>/g, '').replace(/[{}`]/g, '').slice(0, 500)
      : null

    // Whitelist lesson_step
    const VALID_LESSON_STEPS = ['hook', 'visualization', 'guided_examples', 'active_recall', 'application', 'spaced_revision']
    const safeLessonStep = lesson_step && VALID_LESSON_STEPS.includes(lesson_step) ? lesson_step : null

    // Sanitize student_name
    const safeName = student_name
      ? student_name.replace(/<[^>]*>/g, '').replace(/[{}`]/g, '').slice(0, 100)
      : null

    // ── Rate limit ──
    if (!checkRateLimit(student_id)) {
      return errorResponse('Too many messages. Please slow down.', 429, origin)
    }

    // ── Supabase admin client (for privileged DB operations) ──
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const today = new Date().toISOString().slice(0, 10)

    // ── Parallel DB lookups (plan, chat history, RAG) ──
    // Usage check is now handled atomically below — no pre-read needed.
    // Fetch student profile first — plan + board are needed before parallel lookups
    const studentResult = await supabase
      .from('students')
      .select('subscription_plan, board')
      .eq('id', student_id)
      .maybeSingle()
    const studentBoard = studentResult.data?.board ?? null

    // Fetch chat history + RAG context in parallel (board now available)
    const [sessionResult, ragContext] = await Promise.all([
      session_id
        ? supabase.from('chat_sessions').select('messages').eq('id', session_id).eq('student_id', student_id).maybeSingle()
        : Promise.resolve({ data: null }),
      fetchRAGContext(supabase, safeMessage, subject, grade, studentBoard),
    ])

    const plan = normalizePlan(studentResult.data?.subscription_plan || 'free')
    const limit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free

    // ── Atomic usage enforcement (check + increment in one DB transaction) ──
    // Eliminates the TOCTOU race where concurrent requests could both pass the
    // count check before either increment landed. FOR UPDATE inside the RPC
    // serialises concurrent requests on the same row.
    const { data: usageRows, error: usageErr } = await supabase.rpc('check_and_record_usage', {
      p_student_id: student_id,
      p_feature: 'foxy_chat',
      p_limit: limit,
      p_usage_date: today,
    })
    if (usageErr) {
      // Fail closed: deny request if usage can't be tracked
      console.error('check_and_record_usage failed:', usageErr.message)
      return errorResponse('Usage tracking unavailable, please try again', 503, origin)
    }
    const usageRow = usageRows?.[0]
    if (!usageRow?.allowed) {
      const currentCount = usageRow?.current_count ?? limit
      return jsonResponse(
        {
          error: 'Daily chat limit reached',
          code: 'CHAT_LIMIT',
          reply: safeLanguage === 'hi'
            ? `आज के ${limit} संदेश पूरे हो गए। कल फिर आना! 🦊`
            : `You've used all ${limit} messages for today. Come back tomorrow! 🦊`,
          xp_earned: 0,
          session_id: session_id || null,
          used: currentCount,
          limit,
        },
        429,
        {},
        origin,
      )
    }

    // ── Parse chat history from session ──
    let chatHistory: Array<{ role: string; content: string }> = []
    let activeSessionId = session_id || null

    if (sessionResult.data?.messages) {
      const msgs = Array.isArray(sessionResult.data.messages) ? sessionResult.data.messages : []
      chatHistory = msgs.slice(-10).map((m: { role: string; content: string }) => ({
        role: m.role === 'student' ? 'user' : 'assistant',
        content: m.content,
      }))
    }

    // ── Build messages for Claude ──
    const systemPrompt = buildSystemPrompt(
      grade, subject, safeLanguage, safeMode,
      safeTopicTitle,
      safeChapters,
      safeLessonStep,
      ragContext,
    )

    const messages = [
      ...chatHistory,
      { role: 'user', content: safeMessage },
    ]

    // ── Call Claude API (with circuit breaker, timeout, retry) ──
    const startTime = Date.now()

    // Circuit breaker: if API has been failing, return fallback immediately
    if (!circuitBreaker.canRequest()) {
      console.warn('Circuit breaker OPEN — returning fallback response')
      return jsonResponse(
        {
          reply: FALLBACK_REPLIES[safeLanguage] || FALLBACK_REPLIES.en,
          xp_earned: 5,
          session_id: activeSessionId,
          fallback: true,
        },
        200,
        {},
        origin,
      )
    }

    // Helper: single Claude API call with 20s timeout
    async function callClaude(): Promise<Response> {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 20_000)
      try {
        return await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1024,
            system: systemPrompt,
            messages,
          }),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeoutId)
      }
    }

    // Try up to 2 times (initial + 1 retry on transient errors)
    let claudeRes: Response | null = null
    let lastError: string | null = null

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        claudeRes = await callClaude()
        if (claudeRes.ok) {
          circuitBreaker.recordSuccess()
          break
        }

        // Transient errors: retry after brief delay
        if ([429, 500, 502, 503].includes(claudeRes.status) && attempt === 0) {
          lastError = `HTTP ${claudeRes.status}`
          console.warn(`Claude API transient error (${claudeRes.status}), retrying in 1s...`)
          await new Promise(resolve => setTimeout(resolve, 1000))
          claudeRes = null
          continue
        }

        // Non-transient error: don't retry
        lastError = `HTTP ${claudeRes.status}`
        break
      } catch (fetchErr) {
        lastError = fetchErr instanceof DOMException && fetchErr.name === 'AbortError'
          ? 'Timeout (20s)'
          : String(fetchErr)

        if (attempt === 0) {
          console.warn(`Claude API fetch error: ${lastError}, retrying in 1s...`)
          await new Promise(resolve => setTimeout(resolve, 1000))
          continue
        }
      }
    }

    const latencyMs = Date.now() - startTime

    if (!claudeRes?.ok) {
      circuitBreaker.recordFailure()
      console.error('Claude API failed after retries:', lastError, `(${latencyMs}ms)`)

      // Return friendly fallback instead of error
      return jsonResponse(
        {
          reply: FALLBACK_REPLIES[safeLanguage] || FALLBACK_REPLIES.en,
          xp_earned: 5,
          session_id: activeSessionId,
          fallback: true,
        },
        200,
        {},
        origin,
      )
    }

    const claudeData = await claudeRes.json()
    const reply = claudeData.content?.[0]?.text || 'Hmm, let me think about that...'

    // ── Determine XP ──
    // Fixed XP per interaction to prevent inflation via keyword stuffing.
    // Quality-based XP should be determined by analyzing the AI response,
    // not the student's input (which is fully client-controlled).
    const xpEarned = 5

    // ── Persist chat session ──
    const now = new Date().toISOString()
    const newMessages = [
      { role: 'student', content: safeMessage, ts: now },
      { role: 'assistant', content: reply, ts: now, meta: { xp: xpEarned, latency: latencyMs } },
    ]

    if (activeSessionId) {
      // Append to existing session — cap total messages to prevent unbounded growth
      const MAX_SESSION_MESSAGES = 200
      const prevMessages = Array.isArray(sessionResult.data?.messages) ? sessionResult.data.messages : []
      // If at capacity, drop oldest messages (keep last MAX - 2 to make room for new pair)
      const trimmedPrev = prevMessages.length >= MAX_SESSION_MESSAGES
        ? prevMessages.slice(-(MAX_SESSION_MESSAGES - 2))
        : prevMessages
      const updatedMessages = [...trimmedPrev, ...newMessages]

      // Include student_id in WHERE to prevent cross-student session hijack
      supabase
        .from('chat_sessions')
        .update({
          messages: updatedMessages,
          message_count: updatedMessages.length,
          updated_at: now,
        })
        .eq('id', activeSessionId)
        .eq('student_id', student_id)
        .then(() => {}).catch(() => {})
    } else {
      // Create new session
      const { data: newSession } = await supabase
        .from('chat_sessions')
        .insert({
          student_id,
          subject,
          grade,
          title: safeTopicTitle || `${subject} chat`,
          messages: newMessages,
          message_count: 2,
          is_active: true,
          created_at: now,
          updated_at: now,
        })
        .select('id')
        .maybeSingle()

      activeSessionId = newSession?.id || null
    }

    // ── Update XP (fire-and-forget) ──
    if (xpEarned > 0) {
      supabase.rpc('add_xp', {
        p_student_id: student_id,
        p_xp: xpEarned,
        p_source: `foxy_${subject}`,
      }).then(() => {}).catch((e: Error) => console.error('add_xp failed:', e.message))
    }

    // ── Log for analytics (fire-and-forget) ──
    supabase.from('ai_tutor_logs').insert({
      student_id,
      session_id: activeSessionId,
      subject,
      grade,
      mode,
      topic_id: topic_id || null,
      lesson_step: safeLessonStep,
      message_length: safeMessage.length,
      reply_length: reply.length,
      latency_ms: latencyMs,
      model: 'claude-haiku-4-5-20251001',
      xp_earned: xpEarned,
      language: safeLanguage,
      created_at: now,
    }).then(() => {}).catch(() => {})

    return jsonResponse(
      {
        reply,
        xp_earned: xpEarned,
        session_id: activeSessionId,
      },
      200,
      {},
      origin,
    )
  } catch (err) {
    console.error('foxy-tutor error:', err)
    return errorResponse('Internal server error', 500, origin)
  }
})
