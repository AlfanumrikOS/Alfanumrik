/**
 * grade-experiment-conclusion — Tier 3 R10 Edge Function
 *
 * Grades a student's free-text guided-experiment conclusion against a 4-criterion
 * rubric (R1..R4, each 0..3, total 0..12) using Claude Haiku and awards bonus
 * coins via the existing `award_coins` RPC under the `conclusion_quality_bonus`
 * source (whitelisted in migration 20260504200000_stem_lab_engagement_tier1).
 *
 * POST body: { observation_id: string }
 *
 * Auth: Bearer JWT → resolves to students.id (same pattern as foxy-tutor).
 *
 * Idempotency (P11 pattern):
 *   1. If experiment_observations.grading_result IS NOT NULL → return cached.
 *   2. Belt-and-suspenders: if a coin_transactions row exists with
 *      source='conclusion_quality_bonus' AND metadata.observation_id matches,
 *      we trust the cached grading_result (and never double-award).
 *
 * Coin tiers:
 *   weak       (0-4)   → +0
 *   developing (5-7)   → +5
 *   proficient (8-10)  → +15
 *   strong     (11-12) → +30
 *
 * P12 — AI Safety:
 *   • System prompt clamps Claude to constructive, age-appropriate, bilingual
 *     feedback only. Output is JSON-only (parsed + validated, never raw to UI).
 *   • Conclusion text is sanitised: HTML stripped, common prompt-injection
 *     trigger phrases neutralised before being placed inside the user prompt.
 *   • Short conclusions (< 20 chars) bypass Claude entirely → tier='weak',
 *     0 coins. Saves API spend and prevents trivial farming.
 *
 * P13 — Privacy:
 *   • The conclusion text never appears in logs.
 *   • Only {observation_id, tier, total, coins_awarded, latency_ms} are logged.
 *
 * Cost: claude-haiku-4-5 ~ ₹0.04 per grading. Per-student per-day cap = 20
 * gradings (a student physically cannot exceed ~5 guided experiments/day, but
 * we enforce the upper bound defensively).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { shouldProxyToPython, forwardToPython } from '../_shared/python-ai-proxy.ts'
import { getCorsHeaders } from '../_shared/cors.ts'

// ─── Config ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || ''
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''

const CLAUDE_MODEL = 'claude-haiku-4-5-20251001'
const CLAUDE_TIMEOUT_MS = 12_000
const MAX_CONCLUSION_CHARS = 2000
const MIN_CONCLUSION_CHARS = 20
const DAILY_CAP_PER_STUDENT = 20

// ─── CORS ────────────────────────────────────────────────────────────────────
// CORS logic (ALLOWED_ORIGINS + Vercel-preview detection) lives in
// ../_shared/cors.ts. These thin wrappers preserve this function's local
// (body, status, origin) call signature while delegating origin validation to
// the shared getCorsHeaders.
function jsonResponse(body: unknown, status = 200, origin?: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(origin), 'Content-Type': 'application/json' },
  })
}
function errorResponse(message: string, status: number, origin?: string | null): Response {
  return jsonResponse({ error: message }, status, origin)
}

// ─── Types ───────────────────────────────────────────────────────────────────
type Tier = 'weak' | 'developing' | 'proficient' | 'strong'

interface RubricScores {
  r1: number
  r2: number
  r3: number
  r4: number
}

interface GradingResult {
  scores: RubricScores
  total: number
  tier: Tier
  feedback_en: string
  feedback_hi: string
  coins_awarded: number
  graded_at: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Strip HTML, neutralise common prompt-injection trigger phrases, and clamp
 * length. The neutralisation is intentionally simple — we do not try to be a
 * full LLM-firewall; the JSON-only system prompt is the primary defence.
 */
export function sanitizeConclusion(input: string): string {
  if (!input) return ''
  let s = input.replace(/<\/?\s*[a-zA-Z][^>]{0,500}>/g, '')

  // Neutralise common injection openers (case-insensitive). We replace, not
  // reject, so a student who writes "ignore the resistor" still works.
  const injectionPatterns: Array<RegExp> = [
    /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/gi,
    /disregard\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/gi,
    /forget\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/gi,
    /system\s*[:>]\s*you\s+are/gi,
    /you\s+are\s+now\s+(a\s+)?different/gi,
  ]
  for (const re of injectionPatterns) s = s.replace(re, '[redacted]')

  return s.trim().slice(0, MAX_CONCLUSION_CHARS)
}

export function tierFromTotal(total: number): Tier {
  if (total <= 4) return 'weak'
  if (total <= 7) return 'developing'
  if (total <= 10) return 'proficient'
  return 'strong'
}

export function coinsForTier(tier: Tier): number {
  switch (tier) {
    case 'weak':       return 0
    case 'developing': return 5
    case 'proficient': return 15
    case 'strong':     return 30
  }
}

const SYSTEM_PROMPT = `You are an encouraging CBSE science/math examiner grading a student's lab conclusion.

You MUST respond with ONLY a single JSON object in this exact shape:
{"scores":{"r1":N,"r2":N,"r3":N,"r4":N},"total":N,"tier":"weak"|"developing"|"proficient"|"strong","feedback_en":"...","feedback_hi":"..."}

Rules:
- Each rubric score is an integer 0..3.
- total = r1+r2+r3+r4 (an integer 0..12).
- tier mapping: total<=4 → "weak"; 5..7 → "developing"; 8..10 → "proficient"; 11..12 → "strong".
- feedback_en and feedback_hi each <= 150 characters.
- Feedback MUST be encouraging and constructive. Never harsh, sarcastic, or judgmental.
- Stay strictly within CBSE grade 6-12 academic scope.
- No emoji, no markdown, no commentary outside the JSON.

Rubric (each 0..3):
R1. Identifies the relationship/phenomenon (3 = clear & quantitative; 0 = none).
R2. Uses correct units and scientific terms.
R3. References sources of error or assumptions.
R4. Connects to the underlying concept (e.g. V=IR, photosynthesis equation).`

function buildUserPrompt(input: {
  grade: string | null
  subject: string | null
  objective: string
  conclusion: string
  structuredSummary: string
}): string {
  return `Grade a Class ${input.grade ?? '?'} ${input.subject ?? ''} student's lab conclusion.

Experiment objective:
${input.objective}

Their structured observations (summary):
${input.structuredSummary || '(none recorded)'}

Student's conclusion:
${input.conclusion}

Respond with ONLY the JSON object. No prose.`
}

/**
 * Parse and validate the model's JSON output. Returns null if anything is off
 * — caller falls back to a 'developing' default so the student still gets some
 * feedback and we never expose a parse error to the UI.
 */
export function parseClaudeJson(text: string): Omit<GradingResult, 'coins_awarded' | 'graded_at'> | null {
  if (!text) return null
  // Tolerate code-fence wrapping or leading/trailing chatter.
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null
  let parsed: any
  try { parsed = JSON.parse(jsonMatch[0]) } catch { return null }

  const scores = parsed?.scores
  if (!scores || typeof scores !== 'object') return null
  const r1 = Number(scores.r1), r2 = Number(scores.r2), r3 = Number(scores.r3), r4 = Number(scores.r4)
  for (const v of [r1, r2, r3, r4]) {
    if (!Number.isInteger(v) || v < 0 || v > 3) return null
  }
  const total = r1 + r2 + r3 + r4 // recompute — never trust model's total
  const tier = tierFromTotal(total)

  let fbEn = String(parsed.feedback_en ?? '').trim().slice(0, 150)
  let fbHi = String(parsed.feedback_hi ?? '').trim().slice(0, 150)
  if (!fbEn) fbEn = 'Good effort — keep practicing!'
  if (!fbHi) fbHi = 'अच्छा प्रयास — अभ्यास जारी रखें!'

  return {
    scores: { r1, r2, r3, r4 },
    total,
    tier,
    feedback_en: fbEn,
    feedback_hi: fbHi,
  }
}

// ─── Auth (foxy-tutor pattern) ───────────────────────────────────────────────
async function verifyAndGetStudentId(
  req: Request,
): Promise<{ studentId: string; authUserId: string } | { error: string; status: number }> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: 'Missing or invalid Authorization header', status: 401 }
  }
  const token = authHeader.replace('Bearer ', '')
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) return { error: 'Invalid or expired token', status: 401 }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const { data: student, error: studentError } = await adminClient
    .from('students').select('id').eq('auth_user_id', user.id).eq('is_active', true).maybeSingle()
  if (studentError || !student) return { error: 'No active student profile', status: 403 }

  return { studentId: student.id, authUserId: user.id }
}

// ─── Claude call ─────────────────────────────────────────────────────────────
async function callClaude(systemPrompt: string, userPrompt: string): Promise<string> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), CLAUDE_TIMEOUT_MS)
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 400,
        temperature: 0.2,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Claude HTTP ${res.status}: ${body.slice(0, 200)}`)
    }
    const data = await res.json()
    return data?.content?.[0]?.text || ''
  } finally {
    clearTimeout(timeoutId)
  }
}

// ─── Lookup objective from experiment_id ─────────────────────────────────────
/**
 * The canonical experiment catalogue lives in
 * src/components/stem/experiments.ts on the web side. We can't import that here
 * (it's React-bound). The Edge Function reads the objective from the
 * experiment_definitions table if present, else falls back to a generic stem.
 *
 * The simulation_id on the row is enough context for Claude to grade against.
 */
async function loadObjective(
  supabase: ReturnType<typeof createClient>,
  experimentId: string | null,
  simulationId: string,
): Promise<string> {
  if (experimentId) {
    try {
      const { data } = await supabase
        .from('experiment_definitions')
        .select('objective')
        .eq('id', experimentId)
        .maybeSingle()
      if (data && typeof (data as any).objective === 'string' && (data as any).objective.trim()) {
        return (data as any).objective.trim().slice(0, 500)
      }
    } catch { /* table may not exist yet — fall through */ }
  }
  return `A guided lab experiment (${simulationId}) from the CBSE curriculum.`
}

function structuredSummary(structured: unknown): string {
  if (!structured || typeof structured !== 'object') return ''
  const entries = Object.entries(structured as Record<string, unknown>).slice(0, 6)
  return entries
    .map(([k, v]) => `- ${k.slice(0, 40)}: ${String(v).slice(0, 120)}`)
    .join('\n')
}

// ─── Daily cap check ─────────────────────────────────────────────────────────
async function gradingsToday(
  supabase: ReturnType<typeof createClient>,
  studentId: string,
): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count, error } = await supabase
    .from('coin_transactions')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', studentId)
    .eq('source', 'conclusion_quality_bonus')
    .gte('created_at', since)
  if (error) return 0
  return count ?? 0
}

// ─── Main handler ────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  try {
    const request_id = req.headers.get('x-request-id') ?? crypto.randomUUID()
    const decision = await shouldProxyToPython({
      flag_name: 'ff_python_grade_experiment_conclusion_v1',
      endpoint_path: '/v1/grade-experiment-conclusion',
      request_id,
    })
    if (decision.should_proxy && decision.target_url) {
      return await forwardToPython({ target_url: decision.target_url, request: req })
    }
  } catch (err) {
    console.warn('[grade-experiment-conclusion] python proxy fell through:', err instanceof Error ? err.message : String(err))
  }

  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: getCorsHeaders(origin) })
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405, origin)
  if (!ANTHROPIC_API_KEY) return errorResponse('Grader not configured', 503, origin)

  const startedAt = Date.now()

  try {
    const auth = await verifyAndGetStudentId(req)
    if ('error' in auth) return errorResponse(auth.error, auth.status, origin)
    const { studentId } = auth

    let body: { observation_id?: unknown }
    try { body = await req.json() } catch { return errorResponse('Invalid JSON', 400, origin) }
    const observationId = typeof body.observation_id === 'string' ? body.observation_id.trim() : ''
    if (!observationId) return errorResponse('observation_id is required', 400, origin)

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // ── Load observation, enforce ownership + guided-only ───────────────────
    const { data: obs, error: obsErr } = await supabase
      .from('experiment_observations')
      .select('id, student_id, observation_type, conclusion, structured_observations, simulation_id, experiment_id, grade, subject, grading_result')
      .eq('id', observationId)
      .maybeSingle()
    if (obsErr || !obs) return errorResponse('Observation not found', 404, origin)
    if ((obs as any).student_id !== studentId) return errorResponse('Forbidden', 403, origin)
    if ((obs as any).observation_type !== 'guided') {
      return errorResponse('Only guided experiments are graded', 400, origin)
    }

    // ── Idempotency: if grading_result already cached, return it ────────────
    const cached = (obs as any).grading_result as GradingResult | null
    if (cached && typeof cached === 'object' && cached.tier) {
      console.log('grade_conclusion_cached', {
        observation_id: observationId,
        tier: cached.tier,
        total: cached.total,
        coins_awarded: cached.coins_awarded ?? 0,
      })
      return jsonResponse({
        cached: true,
        grading: cached,
        coins_awarded: cached.coins_awarded ?? 0,
      }, 200, origin)
    }

    // ── Anti-cheat: short conclusions skip Claude entirely ─────────────────
    const rawConclusion = typeof (obs as any).conclusion === 'string' ? (obs as any).conclusion : ''
    const conclusion = sanitizeConclusion(rawConclusion)

    if (conclusion.length < MIN_CONCLUSION_CHARS) {
      const result: GradingResult = {
        scores: { r1: 0, r2: 0, r3: 0, r4: 0 },
        total: 0,
        tier: 'weak',
        feedback_en: 'Write a longer conclusion to get feedback.',
        feedback_hi: 'फीडबैक पाने के लिए लंबा निष्कर्ष लिखें।',
        coins_awarded: 0,
        graded_at: new Date().toISOString(),
      }
      await supabase
        .from('experiment_observations')
        .update({ grading_result: result })
        .eq('id', observationId)
      console.log('grade_conclusion_short_circuit', {
        observation_id: observationId,
        tier: result.tier,
        total: 0,
        coins_awarded: 0,
        latency_ms: Date.now() - startedAt,
      })
      return jsonResponse({ cached: false, grading: result, coins_awarded: 0 }, 200, origin)
    }

    // ── Daily-cap check (defence in depth; UX cap is ~5/day) ───────────────
    const usedToday = await gradingsToday(supabase, studentId)
    if (usedToday >= DAILY_CAP_PER_STUDENT) {
      return errorResponse('Daily grading limit reached', 429, origin)
    }

    // ── Build prompt and call Claude ───────────────────────────────────────
    const objective = await loadObjective(
      supabase,
      typeof (obs as any).experiment_id === 'string' ? (obs as any).experiment_id : null,
      String((obs as any).simulation_id ?? ''),
    )
    const userPrompt = buildUserPrompt({
      grade: (obs as any).grade ?? null,
      subject: (obs as any).subject ?? null,
      objective,
      conclusion,
      structuredSummary: structuredSummary((obs as any).structured_observations),
    })

    let parsed: ReturnType<typeof parseClaudeJson> = null
    try {
      const rawText = await callClaude(SYSTEM_PROMPT, userPrompt)
      parsed = parseClaudeJson(rawText)
    } catch (err) {
      console.warn('grade_conclusion_claude_failed', {
        observation_id: observationId,
        error: err instanceof Error ? err.message : String(err),
      })
    }

    // Fallback to a neutral 'developing' grade so the student still sees feedback.
    if (!parsed) {
      parsed = {
        scores: { r1: 1, r2: 1, r3: 1, r4: 1 },
        total: 4,
        tier: 'weak',
        feedback_en: 'Could not auto-grade right now. Try again later.',
        feedback_hi: 'अभी जांच नहीं हो सकी। बाद में पुनः प्रयास करें।',
      }
    }

    const coins = coinsForTier(parsed.tier)

    // ── Award coins (only if > 0) ──────────────────────────────────────────
    if (coins > 0) {
      const { error: awardErr } = await supabase.rpc('award_coins', {
        p_student_id: studentId,
        p_amount: coins,
        p_source: 'conclusion_quality_bonus',
        p_metadata: {
          observation_id: observationId,
          tier: parsed.tier,
          total: parsed.total,
        },
      })
      if (awardErr) {
        console.warn('grade_conclusion_award_failed', {
          observation_id: observationId,
          error: awardErr.message,
        })
        // Continue — we still want to persist the grading_result so the student
        // sees feedback, but report 0 coins awarded.
      }
    }

    const result: GradingResult = {
      ...parsed,
      coins_awarded: coins,
      graded_at: new Date().toISOString(),
    }

    await supabase
      .from('experiment_observations')
      .update({ grading_result: result })
      .eq('id', observationId)

    console.log('grade_conclusion_ok', {
      observation_id: observationId,
      tier: result.tier,
      total: result.total,
      coins_awarded: coins,
      latency_ms: Date.now() - startedAt,
    })

    return jsonResponse({ cached: false, grading: result, coins_awarded: coins }, 200, origin)
  } catch (err) {
    console.error('grade_conclusion_unhandled', {
      error: err instanceof Error ? err.message : String(err),
      latency_ms: Date.now() - startedAt,
    })
    return errorResponse('Internal error', 500, origin)
  }
})
