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
import { getCorsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { fetchRAGContext } from '../_shared/rag-retrieval.ts'

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

// ─── Input safety filter (P12: age-appropriate content) ───────
// Fast regex/keyword check to block clearly inappropriate inputs.
// Conservative: only blocks obviously harmful content outside educational scope.
// Does NOT block legitimate academic topics (e.g., "chemical reactions", "reproduction in plants").
interface SafetyResult {
  safe: boolean
  category?: string
}

function checkInputSafety(message: string): SafetyResult {
  // Normalize: lowercase, collapse whitespace, strip common obfuscation
  const normalized = message
    .toLowerCase()
    .replace(/[\s_\-.*+]+/g, ' ')  // collapse separators
    .replace(/[0@][o0]/gi, 'oo')   // basic leet-speak normalization
    .trim()

  // Each category has patterns that are clearly outside educational scope.
  // Patterns are designed to avoid false positives with legitimate CBSE topics
  // (e.g., "drug" alone is fine for pharmacy/biology context).
  const SAFETY_PATTERNS: Array<{ category: string; pattern: RegExp }> = [
    // Violence / weapons — but not "nuclear weapons in history" or "chemical weapons treaty"
    {
      category: 'violence',
      pattern: /\b(how to (make|build|create) (a )?(bomb|weapon|gun|explosive)|kill (someone|people|myself|yourself)|murder (someone|people)|school shoot|mass shoot|terrorist attack|how to hurt)\b/,
    },
    // Sexual content — but not "sexual reproduction" (biology)
    {
      category: 'sexual_content',
      pattern: /\b(porn|pornograph|sex video|nude photo|naked (photo|pic|image|video)|sexting|hookup|onlyfans|xxx rated)\b/,
    },
    // Self-harm
    {
      category: 'self_harm',
      pattern: /\b(how to (commit suicide|kill myself|end my life|cut myself|hurt myself)|suicide method|want to die|ways to die)\b/,
    },
    // Drug / substance abuse — but not "drugs and medicines" (biology/chemistry)
    {
      category: 'substance_abuse',
      pattern: /\b(how to (make|cook|brew|grow) (meth|cocaine|heroin|weed|drugs|lsd)|buy (drugs|weed|cocaine|meth)|get (high|drunk|stoned) (fast|easily|quickly))\b/,
    },
    // Hate speech
    {
      category: 'hate_speech',
      pattern: /\b(hate (all )?(muslims|hindus|christians|jews|blacks|whites|dalits)|kill (all )?(muslims|hindus|christians|jews|blacks|whites)|ethnic cleansing|racial supremacy|white power|genocide is good)\b/,
    },
    // Personal information harvesting
    {
      category: 'pii_request',
      pattern: /\b(give me (the )?(phone|mobile|address|email|password|aadhaar|aadhar) (number |of )|hack (into|someone|account)|stalk (someone|person)|find (someone|person).{0,20}(address|location|phone))\b/,
    },
  ]

  for (const { category, pattern } of SAFETY_PATTERNS) {
    if (pattern.test(normalized)) {
      return { safe: false, category }
    }
  }

  return { safe: true }
}

// ─── Usage limits by plan ──────────────────────────────────────
const PLAN_LIMITS: Record<string, number> = {
  free: 5,
  starter: 30,
  basic: 30,      // alias for starter
  pro: 100,
  premium: 100,   // alias for pro
  unlimited: 999999,
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
  syllabusContext: string | null = null,
  masteryContext: string | null = null,
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

  let prompt = `You are Foxy 🦊, a warm, encouraging AI tutor for Indian CBSE students.

STUDENT: Grade ${grade} | Subject: ${subject}
LANGUAGE: Respond in ${lang}. Use simple, age-appropriate language.
MODE: ${modeInstr[mode] || modeInstr.learn}
${stepInstr ? `\nLESSON STEP: ${stepInstr}` : ''}
${topicTitle ? `\nACTIVE TOPIC: ${topicTitle}` : ''}
${chapters ? `\nSELECTED CHAPTERS: ${chapters}` : ''}

CURRICULUM GROUNDING (CRITICAL):
- You MUST answer based on NCERT textbook content ONLY.
- If NCERT REFERENCE MATERIAL is provided below, use it as your PRIMARY source.
- Do NOT invent facts, formulas, dates, or definitions not in NCERT.
- If the reference material covers the topic, base your answer on it.
- If no reference material is available, clearly state the NCERT-standard answer and do not guess.
- For Math/Science: use ONLY formulas and methods taught in NCERT for this grade.
- For Social Studies: use ONLY facts, dates, events as per NCERT textbook.
- For English: follow CBSE grammar rules and board exam answer format.
- NEVER contradict NCERT. If your knowledge differs from NCERT, follow NCERT.

RESPONSE RULES:
- Be concise. Aim for 150-300 words per response.
- Use markdown: **bold** for key terms, \`code\` for formulas.
- Include [KEY: term] tags for important concepts.
- For math/science, use [FORMULA: expression] tags.
- For exam tips, use [TIP: advice] tags.
- End teaching responses with a follow-up question to keep engagement.
- Award XP: 5 for good questions, 10 for correct answers, 15 for explanations.
- Never reveal you are Claude or an AI model. You are Foxy the fox tutor.
- If unsure about any fact, say "Let me check — I want to make sure I give you the correct NCERT answer" rather than guessing.`

  // Inject student mastery state (Foxy adapts based on what student knows)
  if (masteryContext) {
    prompt += `\n\nSTUDENT MASTERY STATE (adapt your response based on this):\n${masteryContext}
USE THIS TO:
- If a concept has low mastery (<0.4): explain from basics, be patient, use simple examples
- If a concept has medium mastery (0.4-0.7): focus on application and practice
- If a concept has high mastery (>0.7): challenge with harder questions, skip basics
- Prioritize weak concepts over strong ones in your teaching`
  }

  // Inject syllabus graph (formulas, rules, answer patterns)
  if (syllabusContext) {
    prompt += `\n\nCBSE SYLLABUS REFERENCE (formulas, rules, answer patterns — AUTHORITATIVE):\n${syllabusContext}`
  }

  // Inject RAG textbook content
  if (ragContext) {
    prompt += `\n\n=== NCERT REFERENCE MATERIAL (Grade ${grade}, ${subject}) ===\n${ragContext}\n=== END REFERENCE ===

You MUST answer ONLY based on the NCERT content provided above. If the context doesn't contain relevant information, say 'This topic isn't in my current NCERT materials for your grade. Let me help with what I do know about ${subject}.' NEVER make up information. Do not contradict the reference material.`
  }

  if (!ragContext && !syllabusContext) {
    // Subject-specific safety rules to prevent confident-sounding wrong teaching
    const subjectLower = subject.toLowerCase()
    let subjectSafetyRule = ''
    if (['math', 'mathematics'].includes(subjectLower)) {
      subjectSafetyRule = `\nSUBJECT-SPECIFIC SAFETY (Math): Do NOT provide formulas not in NCERT for Class ${grade}. If you are unsure of the exact formula or method taught at this grade level, explicitly say so. Never present an advanced formula as if it is part of this grade's syllabus.`
    } else if (['science', 'physics', 'chemistry'].includes(subjectLower)) {
      subjectSafetyRule = `\nSUBJECT-SPECIFIC SAFETY (Science): Do NOT state specific numerical values, constants, or experimental results unless you are CERTAIN they match NCERT for Class ${grade}. If unsure about a specific value or constant, say "Please verify the exact value from your NCERT textbook."`
    } else if (['history', 'social studies', 'social science', 'geography', 'civics', 'economics', 'political science'].includes(subjectLower)) {
      subjectSafetyRule = `\nSUBJECT-SPECIFIC SAFETY (Social Studies): Do NOT state specific dates, events, names, or historical claims unless you are CERTAIN they match NCERT for Class ${grade}. If unsure about a specific date or fact, say "Please verify the exact details from your NCERT textbook."`
    }

    const disclaimerBadge = language === 'hi'
      ? '⚠️ **NCERT संदर्भ नहीं मिला** — यह उत्तर सामान्य CBSE पाठ्यक्रम ज्ञान पर आधारित है। कृपया अपनी पाठ्यपुस्तक से सत्यापित करें।'
      : '⚠️ **No NCERT reference found** — This answer is based on general CBSE curriculum knowledge. Please verify from your textbook.'

    const openingLine = language === 'hi'
      ? '📚 मेरे पास इसके लिए सटीक NCERT पृष्ठ नहीं है, लेकिन CBSE कक्षा ' + grade + ' ' + subject + ' पाठ्यक्रम के आधार पर मुझे यह पता है...'
      : '📚 I don\'t have the exact NCERT page for this, but here\'s what I know from the CBSE Class ' + grade + ' ' + subject + ' curriculum...'

    prompt += `\n\n⚠️ NO-REFERENCE SAFETY MODE (CRITICAL — follow ALL rules below):
No specific NCERT textbook content or syllabus reference was found for this question.
You may still help the student using your general knowledge of the CBSE curriculum for Class ${grade} ${subject}, but you MUST follow these rules STRICTLY:

1. You MUST begin your response with this EXACT disclaimer badge on its own line:
   "${disclaimerBadge}"

2. You MUST follow the disclaimer badge with this opening line:
   "${openingLine}"

3. Keep your answer strictly within the CBSE syllabus scope for Class ${grade}
4. Recommend the student verify your answer from their NCERT textbook
5. If the topic is clearly outside the CBSE syllabus for this grade, say so and suggest the correct grade/subject
6. Never fabricate specific page numbers, exercise numbers, or NCERT quotes
${subjectSafetyRule}

CONFIDENCE RATING (MANDATORY — include at the END of your response):
You MUST rate your confidence in a clearly visible block:
- **Confidence: HIGH** — Standard curriculum knowledge, very likely correct
- **Confidence: MEDIUM** — Likely correct but student should verify from textbook
- **Confidence: LOW** — Not sure about grade-specific details. "I recommend asking your teacher to confirm this."
If your confidence is LOW, you MUST explicitly recommend the student ask their teacher.

Do NOT refuse to help — provide your best curriculum-aligned response with ALL the above safety markers.`
  }

  return prompt
}

// ─── Syllabus graph retrieval ──────────────────────────────────
async function fetchSyllabusContext(
  supabase: ReturnType<typeof createClient>,
  query: string,
  subject: string,
  grade: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('match_syllabus_concept', {
      p_query: query,
      p_subject: subject,
      p_grade: grade,
      p_match_count: 2,
    })

    if (error || !data || data.length === 0) return null

    return data.map((c: any) => {
      let block = `CONCEPT: ${c.concept} (Ch.${c.chapter_number} ${c.chapter_title})`
      if (c.formulas && c.formulas.length > 0) {
        block += '\nFORMULAS: ' + c.formulas.map((f: any) => `${f.name}: ${f.expression}`).join(' | ')
      }
      if (c.rules && c.rules.length > 0) {
        block += '\nRULES: ' + c.rules.map((r: any) => r.rule).join(' | ')
      }
      if (c.common_mistakes && c.common_mistakes.length > 0) {
        block += '\nAVOID: ' + c.common_mistakes.join('; ')
      }
      if (c.answer_pattern) {
        block += '\nANSWER FORMAT: ' + c.answer_pattern
      }
      return block
    }).join('\n\n')
  } catch {
    return null
  }
}

// ─── Student mastery retrieval ─────────────────────────────────
async function fetchStudentMastery(
  supabase: ReturnType<typeof createClient>,
  studentId: string,
  subject: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('concept_mastery')
      .select('topic_id, mastery_level, total_attempts, correct_attempts, next_review_at')
      .eq('student_id', studentId)
      .order('mastery_level', { ascending: true })
      .limit(10)

    if (error || !data || data.length === 0) return null

    const weak = data.filter((c: any) => parseFloat(c.mastery_level) < 0.4)
    const medium = data.filter((c: any) => parseFloat(c.mastery_level) >= 0.4 && parseFloat(c.mastery_level) < 0.7)
    const strong = data.filter((c: any) => parseFloat(c.mastery_level) >= 0.7)
    const dueReview = data.filter((c: any) => c.next_review_at && new Date(c.next_review_at) <= new Date())

    let summary = `Concepts tracked: ${data.length}`
    if (weak.length > 0) summary += ` | WEAK (need help): ${weak.length}`
    if (medium.length > 0) summary += ` | Developing: ${medium.length}`
    if (strong.length > 0) summary += ` | Strong: ${strong.length}`
    if (dueReview.length > 0) summary += ` | Due for review: ${dueReview.length}`

    const avgMastery = data.reduce((a: number, c: any) => a + parseFloat(c.mastery_level || '0'), 0) / data.length
    summary += ` | Average mastery: ${Math.round(avgMastery * 100)}%`

    return summary
  } catch {
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

    // ── Input length and format validation ──
    // Cap message length to prevent token exhaustion attacks (~1500 tokens max)
    const MAX_MESSAGE_LENGTH = 5000
    if (message.length > MAX_MESSAGE_LENGTH) {
      return errorResponse(`Message too long (max ${MAX_MESSAGE_LENGTH} chars)`, 400, origin)
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

    // ── Input safety check (P12: age-appropriate content) ──
    // Fast keyword-based filter to block clearly inappropriate inputs
    // BEFORE rate limit so blocked messages don't consume usage quota.
    // Conservative: only blocks obviously off-topic harmful content.
    const inputSafetyResult = checkInputSafety(message)
    if (!inputSafetyResult.safe) {
      // Log blocked input for monitoring (redact actual content for privacy P13)
      console.warn(
        `[INPUT_SAFETY] Blocked message from student. Category: ${inputSafetyResult.category}. ` +
        `Length: ${message.length}. Grade: ${grade}. Subject: ${subject}.`
      )

      const safeReply = safeLanguage === 'hi'
        ? '🦊 अरे! इसमें मैं मदद नहीं कर सकता। मैं तुम्हारा CBSE स्टडी बडी हूँ — मुझसे गणित, विज्ञान, अंग्रेज़ी, या अपने किसी भी विषय के बारे में पूछो! क्या सीखना चाहोगे?'
        : '🦊 Hey! That\'s not something I can help with. I\'m your CBSE study buddy — ask me about Math, Science, English, or any of your school subjects! What would you like to learn?'

      return jsonResponse(
        {
          reply: safeReply,
          xp_earned: 0,
          session_id: session_id || null,
          blocked: true,
        },
        200,
        {},
        origin,
      )
    }

    // ── Rate limit ──
    if (!checkRateLimit(student_id)) {
      return errorResponse('Too many messages. Please slow down.', 429, origin)
    }

    // ── Supabase admin client (for privileged DB operations) ──
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const today = new Date().toISOString().slice(0, 10)

    // Derive single chapter for RAG filtering — pass null if zero or multiple chapters
    const chapterParts = safeChapters ? safeChapters.split(',').map((c: string) => c.trim()).filter(Boolean) : []
    const ragChapter = chapterParts.length === 1 ? chapterParts[0] : null

    // ── Parallel DB lookups (usage, plan, chat history, RAG, syllabus, mastery) ──
    const [usageResult, studentResult, sessionResult, ragContext, syllabusContext, masteryContext] = await Promise.all([
      supabase
        .from('student_daily_usage')
        .select('usage_count')
        .eq('student_id', student_id)
        .eq('feature', 'foxy_chat')
        .eq('usage_date', today)
        .maybeSingle(),
      // Use check_entitlement RPC (reads from student_subscriptions, the authoritative source)
      // to prevent split-brain where payment captured but students.subscription_plan not updated (P11).
      supabase.rpc('check_entitlement', { p_student_id: student_id }),
      session_id
        ? supabase.from('chat_sessions').select('messages').eq('id', session_id).eq('student_id', student_id).maybeSingle()
        : Promise.resolve({ data: null }),
      fetchRAGContext(supabase, message, subject, grade, ragChapter),
      fetchSyllabusContext(supabase, message, subject, grade),
      fetchStudentMastery(supabase, student_id, subject),
    ])

    const currentCount = usageResult.data?.usage_count ?? 0
    // check_entitlement returns TABLE from student_subscriptions (authoritative).
    // Supabase JS returns {data: [{...}]} for table-returning RPCs.
    // Fall back to 'free' if no subscription record or subscription inactive/expired.
    const entitlement = Array.isArray(studentResult.data) ? studentResult.data[0] : studentResult.data
    const plan = (entitlement?.has_access ? entitlement?.plan_code : null) || 'free'
    const limit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free

    // ── Usage enforcement (server-side, authoritative) ──
    if (currentCount >= limit) {
      return jsonResponse(
        {
          error: 'Daily chat limit reached',
          code: 'CHAT_LIMIT',
          reply: safeLanguage === 'hi'
            ? `आज के ${limit} संदेश पूरे हो गए। कल फिर आना! 🦊`
            : `You've used all ${limit} messages for today. Come back tomorrow! 🦊`,
          xp_earned: 0,
          session_id: session_id || null,
        },
        429,
        {},
        origin,
      )
    }

    // Record usage BEFORE processing — await to prevent TOCTOU bypass
    // where concurrent requests all pass the check before any increment completes
    const { error: usageIncErr } = await supabase.rpc('increment_daily_usage', {
      p_student_id: student_id,
      p_feature: 'foxy_chat',
      p_usage_date: today,
    })
    if (usageIncErr) {
      // Fail closed: deny request if usage can't be recorded
      console.error('Usage increment failed:', usageIncErr.message)
      return errorResponse('Usage tracking unavailable, please try again', 503, origin)
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

    // ── Log content gaps (fire-and-forget) ──
    if (!ragContext && !syllabusContext) {
      supabase.rpc('upsert_content_gap', {
        p_subject: subject,
        p_grade: grade,
        p_query: message.slice(0, 200),
        p_topic_title: safeTopicTitle || 'unknown',
      }).then(() => {}).catch(() => {})
    }

    // ── Build messages for Claude (with mastery awareness) ──
    const systemPrompt = buildSystemPrompt(
      grade, subject, safeLanguage, safeMode,
      safeTopicTitle,
      safeChapters,
      safeLessonStep,
      ragContext,
      syllabusContext,
      masteryContext,
    )

    const messages = [
      ...chatHistory,
      { role: 'user', content: message },
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

    // ── Determine XP based on study quality ──
    // Award XP only for substantive study interactions, not mere clicks.
    // Cap at 50 XP per session to prevent spam farming.
    let xpEarned = 0
    const msgTrimmed = message.trim()
    const msgLen = msgTrimmed.length
    const rawSessionMsgs = Array.isArray(sessionResult.data?.messages) ? sessionResult.data.messages : []
    const sessionMsgCount = rawSessionMsgs.length
    const isSubstantive = msgLen > 30 && !/^(hi|hello|ok|yes|no|thanks|bye|hm+)\s*$/i.test(msgTrimmed)

    // First message in session: 0 XP (just starting)
    // Substantive question (>30 chars, not a greeting): 5 XP
    if (sessionMsgCount > 0 && isSubstantive) {
      xpEarned = 5
    }

    // Milestone bonus: 5+ substantive student messages in session (10+ raw = 5 student+assistant pairs)
    if (sessionMsgCount >= 10 && isSubstantive) {
      xpEarned += 5
    }

    // Session XP cap: max 50 XP per session
    const sessionXpSoFar = rawSessionMsgs
      .filter((m: { role: string }) => m.role === 'assistant')
      .reduce((sum: number, m: { meta?: { xp?: number } }) => sum + ((m as any).meta?.xp || 0), 0)
    if (sessionXpSoFar >= 50) {
      xpEarned = 0
    } else if (sessionXpSoFar + xpEarned > 50) {
      xpEarned = 50 - sessionXpSoFar
    }

    // ── Persist chat session ──
    const now = new Date().toISOString()
    const newMessages = [
      { role: 'student', content: message, ts: now },
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
      message_length: message.length,
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
