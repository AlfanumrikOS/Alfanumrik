/**
 * ncert-solver — NCERT-Grounded Question Solver
 *
 * Pipeline:
 *   1. Parse question (type, subject, concepts)
 *   2. Retrieve NCERT context (RAG)
 *   3. Route to solver (deterministic / rule / LLM / hybrid)
 *   4. Generate solution
 *   5. Verify answer
 *   6. Return graded, verified solution
 *
 * POST body:
 * {
 *   question: string,
 *   subject: string,
 *   grade: string,
 *   options?: string[],    // for MCQ
 *   marks?: number,
 *   chapter?: string,
 *   student_id?: string,   // for personalization
 * }
 */

function logDeprecatedEdgeFunctionHit() {
  console.warn('api_deprecated_edge_function_hit', { workflow: 'ncert-solve', route: 'supabase/functions/ncert-solver/index.ts', canonical_route: '/api/scan-solve', compatibility_type: 'internal-only', metric: 'api_deprecated_route_hit' })
}

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts'
import { retrieveSolverContext } from './retrieval.ts'
import { shouldProxyToPython, forwardToPython } from '../_shared/python-ai-proxy.ts'
import { validateSubjectRpc } from '../_shared/subjects-validate.ts'
import {
  callGroundedAnswer,
  isFeatureFlagEnabled,
  type GroundedRequest,
} from '../_shared/grounded-client.ts'
import {
  admitAiRoute,
  finalizeAiRoute,
  createStaticAiRouteProfile,
  fetchWithProviderTimeout,
} from '../_shared/security/ai-admission.ts'
import { securityCorsHeaders } from '../_shared/security/cors.ts'
import { getRequestOrigin } from '../_shared/security/attribution.ts'
// P12 hardening (forensic audit): sanitize RAG chunks before they land in the
// legacy solver's system prompt (MEDIUM-4), same as grounded-answer/pipeline.ts.
import { sanitizeChunkForPrompt } from '../_shared/rag/sanitize.ts'
// P12 hardening (forensic audit): deterministic content backstop before any
// answer reaches the student (HIGH-2), same screen the Foxy grounded/streaming
// path applies (grounded-answer/pipeline-stream.ts). Canonical shared copy —
// see supabase/functions/_shared/rag/output-screen.ts header for provenance.
import { screenStudentFacingText } from '../_shared/rag/output-screen.ts'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

const ROUTE_NAME = 'ncert-solver'

// MEDIUM-6 (P12, forensic audit): unbounded `question` length was forwarded
// straight to retrieval + Claude. Mirrors Foxy's MAX_MESSAGE_LENGTH
// (apps/host/src/app/api/foxy/route.ts:268, currently 1000).
const MAX_QUESTION_LENGTH = 1000

// HIGH-1 (P12, forensic audit): mirrors normalizeEnrolledGrade
// (packages/lib/src/foxy-scope.ts) — students.grade has two production
// conventions (bare "6" vs "Grade 6"); normalize before comparing against
// the client-supplied grade so both forms of the true enrolled grade match.
function normalizeEnrolledGrade(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.replace(/^Grade\s*/i, '').trim()
  return normalized.length > 0 ? normalized : null
}

// LOW-1 (P12, forensic audit): mirrors REFUND_ABSTAIN_REASONS
// (apps/host/src/app/api/foxy/_lib/constants.ts) — reasons for which the
// student did not actually get served an answer that consumed Claude API
// tokens on their behalf. Service-side validation abstains (scope_mismatch,
// low_similarity, no_supporting_chunks, no_chunks_retrieved) are
// intentionally NOT in this set — the service still ran retrieval (and
// possibly Claude) for those.
const REFUND_ABSTAIN_REASONS: ReadonlySet<string> = new Set(['upstream_error', 'circuit_open', 'chapter_not_ready'])

// Best-effort quota refund. Mirrors apps/host/src/app/api/foxy/_lib/quota.ts
// refundQuota() — decrements today's student_daily_usage row for `feature`
// by one so a Claude-API/circuit-breaker failure the student didn't cause
// doesn't consume their daily NCERT-solver allowance. Never throws.
async function refundQuota(
  supabase: ReturnType<typeof createClient>,
  studentId: string,
  feature: string,
): Promise<void> {
  try {
    const today = new Date().toISOString().slice(0, 10)
    const { data: row, error: rowErr } = await supabase
      .from('student_daily_usage')
      .select('usage_count')
      .eq('student_id', studentId)
      .eq('feature', feature)
      .eq('usage_date', today)
      .single()
    // supabase-js resolves rather than throwing, so the catch below never saw a
    // query error — the refund was silently skipped and the student kept losing
    // an allowance they never spent. PGRST116 ("no rows") genuinely means there
    // is nothing to refund and is deliberately not logged.
    if (rowErr && rowErr.code !== 'PGRST116') {
      console.warn(
        'ncert-solver: quota refund read failed:',
        rowErr.code,
        rowErr.message,
        { feature },
      )
      return
    }
    if (row && typeof row.usage_count === 'number' && row.usage_count > 0) {
      await supabase
        .from('student_daily_usage')
        .update({ usage_count: row.usage_count - 1, updated_at: new Date().toISOString() })
        .eq('student_id', studentId)
        .eq('feature', feature)
        .eq('usage_date', today)
    }
  } catch (err) {
    console.warn(
      'ncert-solver: quota refund failed:',
      err instanceof Error ? err.message : String(err),
      { studentId, feature },
    )
  }
}

const NCERT_SOLVER_PROFILE = createStaticAiRouteProfile({
  route: ROUTE_NAME,
  callerTypes: ['student', 'internal_service'],
  modelProvider: 'anthropic',
  modelName: 'claude-haiku-4-5-20251001',
  inputTokenFloor: 512,
  outputTokens: 1024,
})

// ─── Circuit breaker for Claude API ─────────────────────────────
// Prevents cascade failures when Claude API is degraded.
// Trips after 5 consecutive failures, reopens after 60 seconds
// (half-open: allows 1 test request before fully closing).
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

Deno.serve(async (req) => {
  logDeprecatedEdgeFunctionHit()
  const origin = getRequestOrigin(req)
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: getCorsHeaders(origin ?? '') })
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405, origin ?? '')
  }

  // ── Read body as text for security layer hash ──
  let bodyText = ''
  try {
    bodyText = await req.text()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_body' }), { status: 400, headers: securityCorsHeaders(origin) })
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const admitResult = await admitAiRoute({ req, sb, profile: NCERT_SOLVER_PROFILE, bodyText })
  if (!admitResult.ok) return admitResult.response
  const admission = admitResult.admission

  let statusCode = 200
  let actualInputTokens: number | null = null
  let actualOutputTokens: number | null = null
  let errorCode: string | null = null

  try {
    const proxyTraceId =
      req.headers.get('x-request-id') ??
      (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `ncert-proxy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`)

    const proxyDecision = await shouldProxyToPython({
      flag_name: 'ff_python_ncert_solver_v1',
      endpoint_path: '/v1/ncert-solver',
      request_id: proxyTraceId,
    })

    if (proxyDecision.should_proxy && proxyDecision.target_url) {
      try {
        const proxyResp = await forwardToPython({
          target_url: proxyDecision.target_url,
          request: req,
        })
        statusCode = proxyResp.status
        await finalizeAiRoute({ sb, admission, statusCode, actualInputTokens, actualOutputTokens, actualCost: null, errorCode })
        return proxyResp
      } catch (err) {
        console.warn(`[python-ai-proxy] forward failed for ncert-solver: ${err instanceof Error ? err.message : String(err)}; falling back to TS path`)
      }
    }

    // ── Auth — admission already verified the JWT via resolveSecurityPrincipal;
    //    we still need the user id to resolve the student row. ──
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      statusCode = 401
      errorCode = 'unauthorized'
      await finalizeAiRoute({ sb, admission, statusCode, actualInputTokens, actualOutputTokens, actualCost: null, errorCode })
      return errorResponse('Unauthorized', 401, origin ?? '')
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // Verify JWT
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !user) {
      statusCode = 401
      errorCode = 'invalid_token'
      await finalizeAiRoute({ sb, admission, statusCode, actualInputTokens, actualOutputTokens, actualCost: null, errorCode })
      return errorResponse('Invalid token', 401, origin ?? '')
    }

    // ── Parse request ──
    let body: Record<string, unknown>
    try {
      body = bodyText ? JSON.parse(bodyText) : {}
    } catch {
      statusCode = 400
      errorCode = 'invalid_json'
      await finalizeAiRoute({ sb, admission, statusCode, actualInputTokens, actualOutputTokens, actualCost: null, errorCode })
      return errorResponse('Invalid JSON body', 400, origin ?? '')
    }
    const { question, subject, grade, options, marks, chapter } = body as {
      question?: string; subject?: string; grade?: string; options?: string[]; marks?: number; chapter?: string
    }

    if (!question || !subject || !grade) {
      statusCode = 400
      errorCode = 'missing_fields'
      const resp = errorResponse('question, subject, and grade are required', 400, origin ?? '')
      await finalizeAiRoute({ sb, admission, statusCode, actualInputTokens, actualOutputTokens, actualCost: null, errorCode })
      return resp
    }

    // ── MEDIUM-6 (P12): query-length cap, BEFORE any retrieval/Claude call ──
    if (question.length > MAX_QUESTION_LENGTH) {
      statusCode = 400
      errorCode = 'question_too_long'
      const resp = jsonResponse(
        { error: `question must be ${MAX_QUESTION_LENGTH} characters or fewer`, code: 'QUESTION_TOO_LONG' },
        400, {}, origin ?? '',
      )
      await finalizeAiRoute({ sb, admission, statusCode, actualInputTokens, actualOutputTokens, actualCost: null, errorCode })
      return resp
    }

    // ── Subject governance + daily-quota enforcement (P12) ──
    // Resolve the caller's student row, enforce subject availability via
    // get_available_subjects, then atomically check + increment the
    // per-student daily usage counter via check_and_record_usage. Without
    // this counter foxy-tutor was rate-limited per plan but ncert-solver
    // was not — a misbehaving or malicious student could rack up unlimited
    // Claude API spend by hitting this route.
    //
    // The DB's get_plan_limit() falls through to plan-tier defaults
    // (free=15, starter=50, pro=200, unlimited=999999) for any feature
    // code it doesn't have an explicit column for. 'ncert_solver' uses
    // that fallback today; if a different limit-per-plan is needed
    // later, add a subscription_plans column + a CASE branch to
    // get_plan_limit (no code change needed here).
    let resolvedStudentId: string | null = null
    try {
      const { data: studentRow, error: studentRowErr } = await supabase
        .from('students')
        .select('id, grade, onboarding_completed')
        .eq('auth_user_id', user.id)
        .eq('is_active', true)
        .is('deleted_at', null)
        .maybeSingle()
      // Fail CLOSED — this row feeds the HIGH-1 (P12) grade-spoof block below,
      // so an unresolved student must never proceed. That was already the
      // behaviour; what was missing is any way to tell a genuine
      // "no such student" from a students-table outage that would 422 every
      // solver request at once. P13: no ids in the log.
      if (studentRowErr) {
        console.error('[ncert-solver] student resolution failed:', studentRowErr.code, studentRowErr.message)
      }
      if (studentRowErr || !studentRow?.id) {
        statusCode = 422
        errorCode = 'subject_not_allowed'
        const resp = jsonResponse(
          { error: 'subject_not_allowed', reason: 'grade', subject },
          422, {}, origin ?? '',
        )
        await finalizeAiRoute({ sb, admission, statusCode, actualInputTokens, actualOutputTokens, actualCost: null, errorCode })
        return resp
      }
      resolvedStudentId = studentRow.id

      // ── HIGH-1 (P12) grade-spoof HARD BLOCK ──
      // Mirrors apps/host/src/app/api/foxy/route.ts (~line 715-782). The
      // client-supplied `grade` was previously trusted straight into RAG
      // scope + prompt assembly with no check against the student's actual
      // enrolled grade. Runs BEFORE subject validation, RAG retrieval, or
      // any prompt assembly. The enrolled grade is looked up from
      // `students.grade` via the authenticated JWT's user id — never from
      // the request body.
      const dbGrade = normalizeEnrolledGrade(studentRow.grade as string | null | undefined)
      const dbOnboardingCompleted = studentRow.onboarding_completed === true
      const gradeMismatch = dbGrade !== null && dbGrade !== grade
      // An ONBOARDED student with a null enrolled grade is either profile
      // corruption or a deliberate client-side patch (onboarding writes via
      // the anon client, so a student CAN set their own row's grade to
      // null) — treat as a spoof, same as Foxy. Pre-onboarding users with a
      // null grade are let through so the P15 signup funnel keeps working.
      const nullGradeSpoof = dbGrade === null && dbOnboardingCompleted
      if (gradeMismatch || nullGradeSpoof) {
        try {
          await supabase.rpc('log_audit', {
            p_auth_user_id: user.id,
            p_action: 'ncert_solver.grade_spoof_attempt',
            p_resource_type: 'students',
            p_resource_id: resolvedStudentId,
            p_details: {
              claimed_grade: grade,
              actual_grade: dbGrade,
              route: 'ncert-solver',
              ...(nullGradeSpoof ? { reason: 'onboarded_null_grade' } : {}),
            },
            p_status: 'denied',
          })
        } catch (auditErr) {
          console.error(
            'ncert-solver: audit write failed for grade_spoof_attempt:',
            auditErr instanceof Error ? auditErr.message : String(auditErr),
          )
        }
        statusCode = 403
        errorCode = 'grade_mismatch'
        const resp = jsonResponse(
          {
            success: false,
            error: 'Request grade does not match enrollment',
            error_hi: 'Aapki request ka grade aapke profile se match nahi karta.',
            code: 'GRADE_MISMATCH',
          },
          403, {}, origin ?? '',
        )
        await finalizeAiRoute({ sb, admission, statusCode, actualInputTokens, actualOutputTokens, actualCost: null, errorCode })
        return resp
      }

      const check = await validateSubjectRpc(supabase, studentRow.id, subject)
      if (!check.ok) {
        statusCode = 422
        errorCode = 'subject_not_allowed'
        const resp = jsonResponse(
          { error: 'subject_not_allowed', reason: check.reason, subject },
          422, {}, origin ?? '',
        )
        await finalizeAiRoute({ sb, admission, statusCode, actualInputTokens, actualOutputTokens, actualCost: null, errorCode })
        return resp
      }
    } catch (subjErr) {
      console.error('ncert-solver subject validation failed:', subjErr instanceof Error ? subjErr.message : String(subjErr))
      statusCode = 422
      errorCode = 'subject_not_allowed'
      const resp = jsonResponse(
        { error: 'subject_not_allowed', reason: 'grade', subject },
        422, {}, origin ?? '',
      )
      await finalizeAiRoute({ sb, admission, statusCode, actualInputTokens, actualOutputTokens, actualCost: null, errorCode })
      return resp
    }

    // Atomic quota check — DB derives the real limit from subscription_plans
    // (or get_plan_limit's fallback). p_limit intentionally omitted; the
    // RPC ignores it in v2.
    const usageDate = new Date().toISOString().slice(0, 10)
    const { data: usageRows, error: usageErr } = await supabase.rpc('check_and_record_usage', {
      p_student_id: resolvedStudentId!,
      p_feature: 'ncert_solver',
      p_usage_date: usageDate,
    })
    if (usageErr) {
      console.error('ncert-solver check_and_record_usage failed:', usageErr.message)
      statusCode = 503
      errorCode = 'usage_tracking_unavailable'
      const resp = errorResponse('Usage tracking unavailable, please try again', 503, origin ?? '')
      await finalizeAiRoute({ sb, admission, statusCode, actualInputTokens, actualOutputTokens, actualCost: null, errorCode })
      return resp
    }
    const usageRow = usageRows?.[0]
    if (!usageRow?.allowed) {
      statusCode = 429
      errorCode = 'daily_limit_reached'
      const resp = jsonResponse(
        {
          error: 'Daily NCERT-solver limit reached',
          code: 'NCERT_LIMIT',
          used: usageRow?.used_count ?? null,
          message: "You've used all your NCERT-solver requests for today. Come back tomorrow! 🦊",
        },
        429, {}, origin ?? '',
      )
      await finalizeAiRoute({ sb, admission, statusCode, actualInputTokens, actualOutputTokens, actualCost: null, errorCode })
      return resp
    }

    // ── Phase 3: feature-flag-gated grounded-answer service path ──
    // When ff_grounded_ai_ncert_solver is ON, delegate retrieval + Claude
    // generation + abstain logic to the shared grounded-answer Edge
    // Function. When OFF we fall through to the legacy inline pipeline
    // below (circuit breaker → parse → retrieve → Claude → verify).
    const useGroundedService = await isFeatureFlagEnabled('ff_grounded_ai_ncert_solver')
    if (useGroundedService) {
      const chapterNumParsed =
        typeof chapter === 'string' && /^\d+$/.test(chapter) ? parseInt(chapter, 10) : null
      const chapterTitle =
        typeof chapter === 'string' && chapterNumParsed === null ? chapter : null

      const groundedRequest: GroundedRequest = {
        caller: 'ncert-solver',
        student_id: null,
        // Response-cache v2: unconditionally 'shared' — this request is
        // personalization-free BY CONSTRUCTION (verify when editing):
        // student_id is null, there are no conversation_turns, and
        // template_variables carry only curriculum scope (grade / subject /
        // chapter). The quota gate (check_and_record_usage above) has
        // already run, so a cache hit can never bypass daily limits.
        cache_scope: 'shared',
        query: question,
        scope: {
          board: 'CBSE',
          grade,
          subject_code: subject,
          chapter_number: chapterNumParsed,
          chapter_title: chapterTitle,
        },
        mode: 'strict',
        generation: {
          model_preference: 'auto',
          max_tokens: 1024,
          temperature: 0.2,
          system_prompt_template: 'ncert_solver_v1',
          template_variables: {
            grade,
            subject,
            chapter: chapter || 'all',
            // NCERT_SOLVER_V1's "Answer Depth" block references {{marks}}
            // directly (grounded-answer/prompts/inline.ts) and pipeline.ts
            // has no built-in default for it (unlike pending_expectation /
            // next_topic), so an unset value would ship the literal string
            // "{{marks}}" into the live Claude system prompt. On this
            // grounded-service path parseQuestion()/detectType() (below,
            // legacy-branch only) haven't run yet, so the type-based
            // effectiveMarks inference (1 mcq / 2 short_answer / 5 other)
            // used by the legacy prompt builder isn't available here.
            // Default to 2 — the short-answer band — as a reasonable
            // mid-tier depth when the caller omits marks; this is a
            // simpler heuristic than the legacy path's and callers that
            // care about precise depth should pass marks explicitly.
            marks: String(marks ?? 2),
          },
        },
        retrieval: { match_count: 6 },
        timeout_ms: 30_000,
      }

      const grounded = await callGroundedAnswer(groundedRequest, { hopTimeoutMs: 35_000 })

      if (!grounded.grounded) {
        // LOW-1 (P12): refund the quota tick taken above when the abstain
        // reason means the student didn't actually get an LLM-backed answer
        // through no fault of their own. Mirrors Foxy's REFUND_ABSTAIN_REASONS.
        if (REFUND_ABSTAIN_REASONS.has(grounded.abstain_reason) && resolvedStudentId) {
          await refundQuota(supabase, resolvedStudentId, 'ncert_solver')
        }
        // Preserve the legacy "solution not available" client contract while
        // enriching it with trace_id + suggested_alternatives from the new
        // service. Existing clients that ignore the extra fields keep working.
        const resp = jsonResponse(
          {
            answer: '',
            steps: [],
            concept: '',
            explanation: 'NCERT solution not available for this question.',
            confidence: 0,
            verified: false,
            verification_issues: [`abstain:${grounded.abstain_reason}`],
            solver_type: 'grounded_service',
            question_type: 'unknown',
            marks: marks ?? 0,
            trace_id: grounded.trace_id,
            abstain_reason: grounded.abstain_reason,
            suggested_alternatives: grounded.suggested_alternatives,
            flow: 'grounded-answer',
          },
          200, {}, origin ?? '',
        )
        await finalizeAiRoute({ sb, admission, statusCode: 200, actualInputTokens, actualOutputTokens, actualCost: null })
        return resp
      }

      // ── HIGH-2 (P12) deterministic content screen ──
      // Screen the grounded answer before it reaches the student. Mirrors
      // the Foxy streaming path's backstop (grounded-answer/pipeline-stream.ts
      // screenStudentFacingText call) — this is ncert-solver's own backstop
      // as a non-streaming caller of the same service, so a regression in the
      // service's own screening (or a future non-streaming service path)
      // can't ship unfiltered text here.
      const groundedOutputScreen = screenStudentFacingText(grounded.answer)
      if (!groundedOutputScreen.safe) {
        console.warn(
          `ncert-solver: output_safety_blocked categories=${groundedOutputScreen.categories.join(',')} trace_id=${grounded.trace_id}`,
        )
        const resp = jsonResponse(
          {
            answer: '',
            steps: [],
            concept: '',
            explanation: 'NCERT solution not available for this question.',
            confidence: 0,
            verified: false,
            verification_issues: ['output_safety_blocked'],
            solver_type: 'grounded_service',
            question_type: 'unknown',
            marks: marks ?? 0,
            trace_id: grounded.trace_id,
            abstain_reason: 'output_safety_blocked',
            suggested_alternatives: [],
            flow: 'grounded-answer',
          },
          200, {}, origin ?? '',
        )
        await finalizeAiRoute({
          sb, admission, statusCode: 200, actualInputTokens, actualOutputTokens, actualCost: null,
          errorCode: 'output_safety_blocked',
        })
        return resp
      }

      // Service returned a grounded answer. Map to the legacy response shape
      // so existing clients (Foxy, ncert-solver front-end) see no breakage.
      // The service's rich citations are flattened into `explanation` / we
      // also surface them as `citations` for clients that want them.
      const resp = jsonResponse(
        {
          answer: grounded.answer,
          steps: [],
          concept: '',
          explanation: grounded.answer,
          common_mistake: '',
          formula_used: '',
          confidence: grounded.confidence,
          verified: true,
          verification_issues: [],
          solver_type: 'grounded_service',
          question_type: 'unknown',
          marks: marks ?? 0,
          trace_id: grounded.trace_id,
          citations: grounded.citations,
          flow: 'grounded-answer',
        },
        200, {}, origin ?? '',
      )
      await finalizeAiRoute({ sb, admission, statusCode: 200, actualInputTokens, actualOutputTokens, actualCost: null })
      return resp
    }

    // ── Circuit breaker check ──
    if (!circuitBreaker.canRequest()) {
      console.warn('ncert-solver: circuit breaker OPEN — returning 503')
      // LOW-1 (P12): refund — the student's quota tick was consumed above but
      // no Claude call happened on their behalf.
      if (resolvedStudentId) {
        await refundQuota(supabase, resolvedStudentId, 'ncert_solver')
      }
      statusCode = 503
      errorCode = 'circuit_open'
      const resp = jsonResponse(
        { error: 'Service temporarily unavailable, please try again shortly' },
        503, {}, origin ?? '',
      )
      await finalizeAiRoute({ sb, admission, statusCode, actualInputTokens, actualOutputTokens, actualCost: null, errorCode })
      return resp
    }

    // ── Step 1: Parse question ──
    const parsed = parseQuestion(question, subject, grade, options, marks)

    // ── Step 2: Retrieve NCERT context ──
    const { contextText: rawRagContext, error: retrievalError } = await retrieveSolverContext({ supabase, query: question, grade, subject, chapter })
    if (retrievalError) {
      console.warn(`ncert-solver: RAG retrieval degraded — ${retrievalError}`)
    }
    // MEDIUM-4 (P12): sanitize retrieved chunks before they reach the system
    // prompt — mirrors grounded-answer/pipeline.ts's per-chunk
    // sanitizeChunkForPrompt call, which this legacy solver path never had.
    const ragContext = sanitizeRagContext(rawRagContext)

    // ── Step 3: Route to solver ──
    const route = routeToSolver(parsed)

    // ── Step 4: Generate solution ──
    const gradeStyle = getGradeStyle(grade)
    const solverSystemPrompt = buildSolverSystemPrompt(parsed, ragContext)
    const solverPrompt = buildSolverPrompt(parsed, route, ragContext, gradeStyle)

    const solutionRaw = await callClaude(solverPrompt, route.maxResponseTokens, solverSystemPrompt)

    let solution: any
    try {
      // Try to parse structured JSON response
      const jsonMatch = solutionRaw.match(/\{[\s\S]*\}/)
      solution = jsonMatch ? JSON.parse(jsonMatch[0]) : { answer: solutionRaw, steps: [], concept: '', explanation: solutionRaw }
    } catch {
      solution = { answer: solutionRaw, steps: [], concept: '', explanation: solutionRaw }
    }

    // ── Step 5: Verify answer ──
    let verification = { passed: true, confidence: 0.7, issues: [] as string[] }

    if (route.requiresVerification && solution.answer) {
      const verifySystemPrompt = buildVerificationSystemPrompt(parsed)
      const verifyPrompt = buildVerificationPrompt(parsed, JSON.stringify(solution))
      const verifyRaw = await callClaude(verifyPrompt, 300, verifySystemPrompt)

      try {
        const verifyMatch = verifyRaw.match(/\{[\s\S]*\}/)
        const verifyResult = verifyMatch ? JSON.parse(verifyMatch[0]) : null
        if (verifyResult) {
          verification.passed = verifyResult.passed !== false
          verification.confidence = verifyResult.confidence ?? 0.7
          verification.issues = verifyResult.errors_found || []

          // If verification found the answer is wrong, use the corrected answer
          if (!verification.passed && verifyResult.correct_answer) {
            solution.answer = verifyResult.correct_answer
            if (verifyResult.recomputed_result) {
              solution.steps.push(`Verified: ${verifyResult.recomputed_result}`)
            }
          }
        }
      } catch {
        // Verification parse failed — proceed with lower confidence
        verification.confidence = 0.5
      }
    }

    // ── Step 6: Compute final confidence ──
    const confidence = estimateConfidence(route.solver, verification.passed, !!ragContext)

    // ── HIGH-2 (P12) deterministic content screen ──
    // The legacy solver path returned solution.answer/explanation/etc.
    // verbatim to the caller with no post-processing at all. Screen every
    // field that reaches the student — same backstop as the grounded-service
    // branch above — before returning it; on a hit, abstain instead of
    // serving unfiltered LLM output. P13: only category tags are logged,
    // never the answer text.
    const studentFacingText = [
      solution.answer,
      ...(Array.isArray(solution.steps) ? solution.steps : []),
      solution.explanation,
      solution.common_mistake,
      solution.formula_used,
    ]
      .filter((v: unknown): v is string => typeof v === 'string')
      .join('\n')
    const legacyOutputScreen = screenStudentFacingText(studentFacingText)
    if (!legacyOutputScreen.safe) {
      console.warn(`ncert-solver: output_safety_blocked categories=${legacyOutputScreen.categories.join(',')}`)
      const blockedResp = jsonResponse({
        answer: '',
        steps: [],
        concept: '',
        explanation: 'NCERT solution not available for this question.',
        common_mistake: '',
        formula_used: '',
        confidence: 0,
        verified: false,
        verification_issues: ['output_safety_blocked'],
        solver_type: route.solver,
        question_type: parsed.type,
        marks: parsed.marks,
      }, 200, {}, origin ?? '')
      await finalizeAiRoute({
        sb, admission, statusCode: 200, actualInputTokens, actualOutputTokens, actualCost: null,
        errorCode: 'output_safety_blocked',
      })
      return blockedResp
    }

    // ── Return ──
    const finalResp = jsonResponse({
      answer: solution.answer || '',
      steps: solution.steps || [],
      concept: solution.concept || '',
      explanation: solution.explanation || '',
      common_mistake: solution.common_mistake || '',
      formula_used: solution.formula_used || '',
      confidence,
      verified: verification.passed,
      verification_issues: verification.issues,
      solver_type: route.solver,
      question_type: parsed.type,
      marks: parsed.marks,
    }, 200, {}, origin ?? '')
    await finalizeAiRoute({ sb, admission, statusCode: 200, actualInputTokens, actualOutputTokens, actualCost: null })
    return finalResp

  } catch (err) {
    console.error('Solver error:', err)
    try {
      await finalizeAiRoute({ sb, admission, statusCode: 500, actualInputTokens, actualOutputTokens, actualCost: null, errorCode: 'internal_error' })
    } catch (finalizeErr) {
      console.error('[ncert-solver] finalize failed after solver error:', String(finalizeErr instanceof Error ? finalizeErr.message : finalizeErr))
    }
    return errorResponse('Solver failed', 500, origin ?? '')
  }
})

// ─── Claude API Call ─────────────────────────────────────

async function callClaude(prompt: string, maxTokens: number, systemPrompt: string): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 25000)

  try {
    // eslint-disable-next-line alfanumrik/no-direct-ai-calls -- TODO(phase-4-cleanup): ncert-solver already routes through grounded-answer behind ff_ncert_grounded flag; delete this fallback call once flag defaults to true.
    const res = await fetchWithProviderTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      circuitBreaker.recordFailure()
      console.error(`ncert-solver: Claude API non-2xx response ${res.status}`)
      throw new Error(`Claude API error: ${res.status}`)
    }

    const data = await res.json()
    circuitBreaker.recordSuccess()
    return data.content?.[0]?.text || ''
  } catch (err) {
    // Record failure for aborts (timeout) and network errors; avoid double-counting
    // non-2xx paths that already called recordFailure() above.
    if (!(err instanceof Error && err.message.startsWith('Claude API error:'))) {
      circuitBreaker.recordFailure()
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

// ─── Question Parser (Deno version) ─────────────────────

interface ParsedQuestion {
  originalText: string
  type: string
  subject: string
  grade: string
  concepts: string[]
  marks: number
  expectedDepth: string
  hasNumerical: boolean
  hasFormula: boolean
  options: string[]
}

function parseQuestion(text: string, subject: string, grade: string, options?: string[], marks?: number): ParsedQuestion {
  const lower = text.toLowerCase()
  const type = detectType(lower, options, marks)
  const hasNumerical = /\d+\s*[\+\-\×\÷\*\/\=]|\bcalculate\b|\bfind.*value\b|\bsolve\b/i.test(text)
  const hasFormula = /[=><≥≤±√]|x\^|sin|cos|formula/i.test(text)
  const effectiveMarks = marks || (type === 'mcq' ? 1 : type === 'short_answer' ? 2 : 5)

  return {
    originalText: text, type, subject, grade,
    concepts: [], marks: effectiveMarks,
    expectedDepth: effectiveMarks <= 1 ? 'brief' : effectiveMarks <= 3 ? 'moderate' : 'detailed',
    hasNumerical, hasFormula, options: options || [],
  }
}

function detectType(text: string, options?: string[], marks?: number): string {
  if (options && options.length >= 3) return 'mcq'
  if (/assertion.*reason/i.test(text)) return 'assertion_reasoning'
  if (/case.?study|passage|comprehension/i.test(text)) return 'case_based'
  if (/grammar|tense|voice|narration/i.test(text)) return 'grammar'
  if (/poem|stanza|character|novel/i.test(text)) return 'literature'
  if (/calculate|find.*value|solve|simplify|prove/i.test(text)) return 'numerical'
  if (marks && marks >= 5) return 'long_answer'
  return 'short_answer'
}

function routeToSolver(parsed: ParsedQuestion) {
  const { type, subject, hasNumerical } = parsed
  if (type === 'mcq') return { solver: hasNumerical ? 'hybrid' : 'retrieval', requiresVerification: true, maxResponseTokens: 400 }
  if (type === 'numerical' && ['math', 'physics', 'chemistry'].includes(subject)) return { solver: 'deterministic', requiresVerification: true, maxResponseTokens: 600 }
  if (type === 'grammar') return { solver: 'rule_based', requiresVerification: true, maxResponseTokens: 300 }
  if (type === 'literature') return { solver: 'llm_reasoning', requiresVerification: false, maxResponseTokens: 600 }
  if (type === 'long_answer') return { solver: 'llm_reasoning', requiresVerification: false, maxResponseTokens: 800 }
  return { solver: 'rule_based', requiresVerification: true, maxResponseTokens: 400 }
}

function getGradeStyle(grade: string): string {
  const g = parseInt(grade) || 9
  if (g <= 7) return 'Use simple language with real-life analogies. Be encouraging.'
  if (g <= 9) return 'Use clear language with proper terms. Give one example.'
  return 'Use precise academic language. Focus on board-exam depth.'
}

// ─── RAG Context Sanitization (MEDIUM-4, P12) ────────────
// The legacy solver path (this file) used to interpolate ragContext directly
// into buildSolverSystemPrompt with no sanitization — unlike the grounded-
// answer pipeline (supabase/functions/grounded-answer/pipeline.ts,
// pipeline-stream.ts), which runs every retrieved chunk through
// sanitizeChunkForPrompt before it reaches the Claude system prompt. Mirror
// that hardening here. fetchRAGContext (_shared/retrieval.ts formatContextText)
// joins chunks with the "\n\n---\n\n" separator — split on it, sanitize each
// chunk (strips leading injection-prefix tokens + caps each chunk at 1500
// chars — see _shared/rag/sanitize.ts), then rejoin. Chunk count is already
// bounded upstream (retrieveChunks defaults matchCount to 5), so this also
// bounds the total prompt contribution to a reasonable size.
function sanitizeRagContext(ragContext: string | null): string | null {
  if (!ragContext) return ragContext
  const sanitizedParts = ragContext
    .split('\n\n---\n\n')
    .map((part) => sanitizeChunkForPrompt(part))
    .filter((part) => part.length > 0)
  return sanitizedParts.length > 0 ? sanitizedParts.join('\n\n---\n\n') : null
}

function buildSolverSystemPrompt(parsed: ParsedQuestion, ragContext: string | null): string {
  const { grade, subject } = parsed
  const subjectLower = subject.toLowerCase()

  let subjectSafetyRule = ''
  if (['math', 'mathematics'].includes(subjectLower)) {
    subjectSafetyRule = `\nSUBJECT-SPECIFIC RULE (Math): Do NOT use formulas, theorems, or methods not taught in NCERT for Class ${grade}. For example, do not use L'Hopital's rule in Class 11, or integration by parts in Class 11 if it is a Class 12 topic. If you are unsure whether a method is in the NCERT syllabus for this grade, explicitly say so.`
  } else if (['physics', 'chemistry', 'science', 'biology'].includes(subjectLower)) {
    subjectSafetyRule = `\nSUBJECT-SPECIFIC RULE (Science): Do NOT state specific numerical values, constants, or experimental results unless you are CERTAIN they match NCERT for Class ${grade}. Use only the formulas and derivations presented in NCERT. If unsure about a specific value or constant, say "Please verify the exact value from your NCERT textbook."`
  } else if (['history', 'geography', 'civics', 'economics', 'social science', 'political science'].includes(subjectLower)) {
    subjectSafetyRule = `\nSUBJECT-SPECIFIC RULE (Social Studies): Do NOT state specific dates, events, names, or historical claims unless you are CERTAIN they match NCERT for Class ${grade}. If unsure about a specific date or fact, say "Please verify from your NCERT textbook."`
  }

  let prompt = `You are a CBSE Class ${grade} ${subject} problem-solving engine that strictly follows NCERT.

CORE RULES — FOLLOW WITHOUT EXCEPTION:
- You MUST solve this problem using ONLY methods, formulas, and concepts taught in the NCERT textbook for Class ${grade} ${subject}.
- Do NOT use advanced methods, shortcuts, or concepts not covered in NCERT for this grade.
- Do NOT invent facts, formulas, dates, or definitions not in NCERT.
- NEVER contradict NCERT. If your knowledge differs from NCERT, follow NCERT.
- If you are not confident in your answer, you MUST say so explicitly rather than guessing.
- If unsure about any fact, say "This should be verified against the NCERT textbook" rather than presenting uncertain information as fact.
- Always output valid JSON.
${subjectSafetyRule}`

  if (ragContext) {
    prompt += `

=== NCERT REFERENCE MATERIAL (Grade ${grade}, ${subject}) ===
${ragContext}
=== END REFERENCE ===

You MUST answer ONLY based on the NCERT content provided above. If the context doesn't contain relevant information, say so explicitly and set your confidence lower. NEVER make up information not present in the reference material. Your solution MUST be consistent with the above NCERT content. Do not contradict it. If the answer can be directly derived from this material, use it as the authoritative source.`
  } else {
    prompt += `

WARNING: No NCERT reference material was found for this question.
You may still solve using your general knowledge of the CBSE Class ${grade} ${subject} curriculum, but you MUST:
1. Use ONLY standard methods taught at this grade level
2. NOT fabricate specific NCERT page numbers, exercise numbers, or textbook quotes
3. Add a note in your explanation: "This solution should be verified against the NCERT textbook"
4. If you are uncertain about the correct method or answer, say so explicitly
5. Set your confidence appropriately — do not express high confidence without NCERT backing`
  }

  return prompt
}

function buildVerificationSystemPrompt(parsed: ParsedQuestion): string {
  const { grade, subject } = parsed
  return `You are a CBSE Class ${grade} ${subject} answer verification engine.

Your job is to rigorously verify a proposed solution against NCERT standards.

VERIFICATION CHECKLIST — check ALL of the following:
1. Does this solution use ONLY methods taught in NCERT for Class ${grade} ${subject}? Flag any advanced methods not in the syllabus.
2. Are all formulas and values consistent with NCERT for this grade? Check for incorrect constants, wrong formula application.
3. Is the answer format appropriate for a CBSE board exam? (proper units, significant figures, marks-appropriate depth)
4. Are the steps logically correct and complete? Check for arithmetic errors, sign errors, unit conversion errors.
5. Does the explanation match what NCERT teaches, or does it introduce concepts from a different grade level?

If ANY check fails, set "passed" to false and list the specific issues.
If the solution uses a method not in NCERT for this grade, flag it even if the final answer is numerically correct.
Always output valid JSON.`
}

function buildSolverPrompt(parsed: ParsedQuestion, _route: any, ragContext: string | null, gradeStyle: string): string {
  const { type, originalText, marks, options } = parsed
  const formatRules = type === 'mcq'
    ? `Select correct option. Options: ${options.map((o, i) => `${String.fromCharCode(65 + i)}) ${o}`).join(' | ')}`
    : type === 'numerical'
    ? 'Show complete step-by-step working with Given, Formula, Substitution, Calculation, Answer with units.'
    : ''
  const marksGuide = marks <= 1 ? '1-2 sentences.' : marks <= 3 ? '3-5 sentences with concept.' : 'Detailed with definition, explanation, example.'

  const noRagWarning = ragContext
    ? ''
    : '\nIMPORTANT: No NCERT reference material was retrieved. Include a note in your explanation that the student should verify this answer from their NCERT textbook.'

  return `Solve this CBSE Class ${parsed.grade} ${parsed.subject} question.
QUESTION: ${originalText}
MARKS: ${marks} | TYPE: ${type}
${formatRules}
${noRagWarning}

RULES: ${marksGuide} ${gradeStyle} Use ONLY NCERT-prescribed methods for this grade.

Output JSON: {"answer":"...","steps":["..."],"concept":"...","explanation":"...","common_mistake":"...","formula_used":"..."}`
}

function buildVerificationPrompt(parsed: ParsedQuestion, proposedAnswer: string): string {
  return `VERIFY this CBSE Class ${parsed.grade} ${parsed.subject} answer.

QUESTION: ${parsed.originalText}
${parsed.options.length > 0 ? `OPTIONS: ${parsed.options.map((o, i) => `${String.fromCharCode(65 + i)}) ${o}`).join(' | ')}` : ''}

PROPOSED SOLUTION: ${proposedAnswer}

VERIFICATION TASKS:
1. ${parsed.hasNumerical ? 'RECOMPUTE all calculations independently from scratch. Check units, significant figures, and sign.' : 'Check all key concepts, facts, and definitions against NCERT for Class ' + parsed.grade + '.'}
2. Does this solution use ONLY methods taught in NCERT for Class ${parsed.grade}? If it uses advanced methods, flag this.
3. Are all formulas and values consistent with NCERT for this grade?
4. Is the answer format appropriate for a CBSE board exam worth ${parsed.marks} mark(s)?
5. If any step is uncertain or potentially incorrect, flag it.

Output JSON: {"passed":boolean,"confidence":0-1,"correct_answer":"...","errors_found":["..."],"recomputed_result":"..."}`
}

function estimateConfidence(solver: string, verified: boolean, hasRAG: boolean): number {
  let c = solver === 'deterministic' ? 0.9 : solver === 'rule_based' ? 0.8 : solver === 'hybrid' ? 0.75 : 0.65
  if (hasRAG) c += 0.1
  else c -= 0.15 // Lower confidence when no NCERT reference material available
  if (verified) c += 0.05
  else c -= 0.15
  return Math.max(0, Math.min(1, c))
}
