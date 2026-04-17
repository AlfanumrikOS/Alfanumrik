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

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { fetchRAGContext } from '../_shared/rag-retrieval.ts'
import { validateSubjectRpc } from '../_shared/subjects-validate.ts'
import {
  callGroundedAnswer,
  isFeatureFlagEnabled,
  type GroundedRequest,
} from '../_shared/grounded-client.ts'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

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
  const origin = req.headers.get('origin') || ''
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: getCorsHeaders(origin) })
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405, origin)
  }

  try {
    // ── Auth ──
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return errorResponse('Unauthorized', 401, origin)

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // Verify JWT
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !user) return errorResponse('Invalid token', 401, origin)

    // ── Parse request ──
    const body = await req.json()
    const { question, subject, grade, options, marks, chapter } = body

    if (!question || !subject || !grade) {
      return errorResponse('question, subject, and grade are required', 400, origin)
    }

    // ── Subject governance (P12) ──
    // Resolve the caller's student row and enforce subject availability via
    // get_available_subjects. See:
    //   docs/superpowers/specs/2026-04-15-subject-governance-design.md §6.2
    try {
      const { data: studentRow } = await supabase
        .from('students')
        .select('id')
        .eq('auth_user_id', user.id)
        .eq('is_active', true)
        .is('deleted_at', null)
        .maybeSingle()
      if (!studentRow?.id) {
        return jsonResponse(
          { error: 'subject_not_allowed', reason: 'grade', subject },
          422,
          origin,
        )
      }
      const check = await validateSubjectRpc(supabase, studentRow.id, subject)
      if (!check.ok) {
        return jsonResponse(
          { error: 'subject_not_allowed', reason: check.reason, subject },
          422,
          origin,
        )
      }
    } catch (subjErr) {
      console.error('ncert-solver subject validation failed:', subjErr instanceof Error ? subjErr.message : String(subjErr))
      return jsonResponse(
        { error: 'subject_not_allowed', reason: 'grade', subject },
        422,
        origin,
      )
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
          },
        },
        retrieval: { match_count: 6 },
        timeout_ms: 30_000,
      }

      const grounded = await callGroundedAnswer(groundedRequest, { hopTimeoutMs: 35_000 })

      if (!grounded.grounded) {
        // Preserve the legacy "solution not available" client contract while
        // enriching it with trace_id + suggested_alternatives from the new
        // service. Existing clients that ignore the extra fields keep working.
        return jsonResponse(
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
          200,
          origin,
        )
      }

      // Service returned a grounded answer. Map to the legacy response shape
      // so existing clients (Foxy, ncert-solver front-end) see no breakage.
      // The service's rich citations are flattened into `explanation` / we
      // also surface them as `citations` for clients that want them.
      return jsonResponse(
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
        200,
        origin,
      )
    }

    // ── Circuit breaker check ──
    if (!circuitBreaker.canRequest()) {
      console.warn('ncert-solver: circuit breaker OPEN — returning 503')
      return jsonResponse(
        { error: 'Service temporarily unavailable, please try again shortly' },
        503,
        origin,
      )
    }

    // ── Step 1: Parse question ──
    const parsed = parseQuestion(question, subject, grade, options, marks)

    // ── Step 2: Retrieve NCERT context ──
    const ragContext = await fetchRAGContext(supabase, question, subject, grade, chapter)

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

    // ── Return ──
    return jsonResponse({
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
    }, 200, origin)

  } catch (err) {
    console.error('Solver error:', err)
    return errorResponse('Solver failed', 500, origin)
  }
})

// ─── Claude API Call ─────────────────────────────────────

async function callClaude(prompt: string, maxTokens: number, systemPrompt: string): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 25000)

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
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
