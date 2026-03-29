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

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

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

    // ── Step 1: Parse question ──
    const parsed = parseQuestion(question, subject, grade, options, marks)

    // ── Step 2: Retrieve NCERT context ──
    const ragContext = await fetchRAGContext(supabase, question, subject, grade, chapter)

    // ── Step 3: Route to solver ──
    const route = routeToSolver(parsed)

    // ── Step 4: Generate solution ──
    const gradeStyle = getGradeStyle(grade)
    const solverPrompt = buildSolverPrompt(parsed, route, ragContext, gradeStyle)

    const solutionRaw = await callClaude(solverPrompt, route.maxResponseTokens)

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
      const verifyPrompt = buildVerificationPrompt(parsed, JSON.stringify(solution))
      const verifyRaw = await callClaude(verifyPrompt, 300)

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

async function callClaude(prompt: string, maxTokens: number): Promise<string> {
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
        system: 'You are an NCERT/CBSE answer verification and solving engine. Always output valid JSON. Be precise and curriculum-aligned.',
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    })

    const data = await res.json()
    return data.content?.[0]?.text || ''
  } finally {
    clearTimeout(timeout)
  }
}

// ─── RAG Retrieval ───────────────────────────────────────

async function fetchRAGContext(
  supabase: ReturnType<typeof createClient>,
  query: string,
  subject: string,
  grade: string,
  chapter?: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('match_rag_chunks', {
      query_text: query,
      p_subject: subject,
      p_grade: grade,
      match_count: 5, // more context for solver than chat
    })
    if (error || !data || data.length === 0) return null
    return data.map((c: { content: string }) => c.content).join('\n\n---\n\n')
  } catch {
    return null
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

function buildSolverPrompt(parsed: ParsedQuestion, _route: any, ragContext: string | null, gradeStyle: string): string {
  const { type, originalText, marks, options } = parsed
  const formatRules = type === 'mcq'
    ? `Select correct option. Options: ${options.map((o, i) => `${String.fromCharCode(65 + i)}) ${o}`).join(' | ')}`
    : type === 'numerical'
    ? 'Show complete step-by-step working with Given, Formula, Substitution, Calculation, Answer with units.'
    : ''
  const marksGuide = marks <= 1 ? '1-2 sentences.' : marks <= 3 ? '3-5 sentences with concept.' : 'Detailed with definition, explanation, example.'

  return `Solve this CBSE question precisely.
QUESTION: ${originalText}
MARKS: ${marks} | TYPE: ${type}
${formatRules}
${ragContext ? `\nNCERT REFERENCE:\n${ragContext}` : ''}

RULES: Follow NCERT exactly. ${marksGuide} ${gradeStyle}

Output JSON: {"answer":"...","steps":["..."],"concept":"...","explanation":"...","common_mistake":"...","formula_used":"..."}`
}

function buildVerificationPrompt(parsed: ParsedQuestion, proposedAnswer: string): string {
  return `VERIFY this CBSE answer.
QUESTION: ${parsed.originalText}
${parsed.options.length > 0 ? `OPTIONS: ${parsed.options.map((o, i) => `${String.fromCharCode(65 + i)}) ${o}`).join(' | ')}` : ''}
PROPOSED: ${proposedAnswer}
${parsed.hasNumerical ? 'RECOMPUTE all calculations independently. Check units.' : 'Check key concepts against NCERT.'}
Output JSON: {"passed":boolean,"confidence":0-1,"correct_answer":"...","errors_found":["..."]}`
}

function estimateConfidence(solver: string, verified: boolean, hasRAG: boolean): number {
  let c = solver === 'deterministic' ? 0.9 : solver === 'rule_based' ? 0.8 : solver === 'hybrid' ? 0.75 : 0.65
  if (hasRAG) c += 0.1
  if (verified) c += 0.05
  else c -= 0.15
  return Math.max(0, Math.min(1, c))
}
