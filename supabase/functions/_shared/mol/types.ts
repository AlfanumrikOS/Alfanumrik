// supabase/functions/_shared/mol/types.ts

export type TaskType =
  | 'explanation'
  | 'concept_explanation'
  | 'step_by_step'
  | 'reasoning'
  | 'quiz_generation'
  | 'evaluation'
  | 'doubt_solving'
  | 'ocr_extraction'
  // C3 (MOL grounded-answer integration, 2026-05-18): grounded-answer's
  // strict-mode runs a second Haiku pass that fact-checks the candidate
  // answer against retrieved chunks. The shadow-log adapter labels that
  // call as task_type='grounding_check' so cost/latency dashboards can
  // separate fact-check spend from primary-answer spend.
  // Additive only — no router/classifier changes; current MOL provider
  // selection ignores unknown task_types and falls back to its default
  // plan-table entry.
  | 'grounding_check'

export type Language = 'en' | 'hi' | 'hinglish'

export type LearningSpeed = 'slow' | 'moderate' | 'fast'

export type ExamGoal = 'cbse' | 'jee' | 'neet' | 'general'

export type GradeTier = 'junior' | 'middle' | 'senior'

export interface StudentContext {
  student_id: string
  grade: string
  language: Language
  learning_speed?: LearningSpeed
  exam_goal?: ExamGoal
  subject?: string
  board?: string | null
}

export interface GenerateRequest {
  task_type?: TaskType                  // optional: classifier infers if absent
  input: {
    question?: string
    topic?: string
    instruction?: string
    chat_history?: Array<{ role: 'user' | 'assistant'; content: string }>
    image_url?: string                  // ocr_extraction only
    options?: string[]                  // quiz/evaluation
  }
  student_context: StudentContext
  rag_context?: string | null
  config?: {
    preferred_provider?: 'openai' | 'anthropic'
    max_tokens_override?: number
    temperature_override?: number
    request_id?: string                 // for trace correlation
    surface?: 'foxy' | 'quiz' | 'solver' | 'ocr'

    // ── C4.2a wire-up (2026-05-19): grounded-answer shadow routing ──
    // All three fields OPTIONAL. Pre-C4 callers (foxy-tutor, ncert-solver,
    // quiz-generator, and any direct MOL client) pass none of them and the
    // orchestrator behaves byte-identical to its pre-C4 contract.
    //
    // The grounded-answer shadow helper (mol-shadow.ts) is the only known
    // caller today; future shadow-routing call sites should reuse this
    // surface rather than inventing new flags.

    /**
     * When set, generateResponse() uses this string as the system prompt
     * VERBATIM and SKIPS the prompt-builder. This is the prompt-parity
     * fix from C4.1 review: shadow legs MUST send the EXACT same prompt
     * baseline sent to Claude so the offline grader can compare the two
     * responses to the SAME question. Without this, MOL's prompt-builder
     * would compose its own Foxy-persona-aware prompt, which differs
     * structurally from grounded-answer's RAG-templated prompt.
     *
     * Set ONLY by mol-shadow.ts. Direct MOL callers should leave undefined
     * so the prompt-builder runs normally.
     */
    system_prompt_override?: string

    /**
     * Tag for the auto-logged telemetry row. When set, the orchestrator
     * stamps it onto recordMolRequest's LogPayload.shadow_role so the row
     * inserted by generateResponse() (and ONLY that row — there is no
     * second row from the helper) carries the correct 'baseline' /
     * 'shadow' label. This is the de-dup fix from C4.1 review: the helper
     * no longer writes a SECOND row of its own.
     *
     * Pre-C4 callers leave this undefined and their auto-logged row reads
     * shadow_role=NULL (matching the legacy contract).
     */
    shadow_role?: 'baseline' | 'shadow'

    /**
     * JOIN key for shadow row → baseline row. When the shadow helper sets
     * shadow_role='shadow' it also sets this to the baseline's request_id
     * so mol_shadow_pairs_v1 can pair the two legs.
     *
     * Pre-C4 callers leave this undefined; the auto-logged row writes
     * shadow_of_request_id=NULL (legacy contract).
     */
    shadow_of_request_id?: string

    /**
     * Cross-service correlation: grounded_ai_traces.id when this MOL call
     * originated from grounded-answer. The orchestrator propagates it onto
     * the auto-logged row's LogPayload.trace_id column. Set by mol-shadow.ts
     * to the same trace_id the baseline grounded_ai_traces row carries.
     *
     * Pre-C4 callers leave this undefined and the auto-logged row writes
     * trace_id=NULL (legacy contract).
     */
    trace_id?: string | null
  }
}

export interface TokenUsage {
  prompt: number
  completion: number
}

export interface ProviderResponse {
  text: string
  provider: 'openai' | 'anthropic'
  model: string
  tokens: TokenUsage
  finish_reason: string
  raw?: unknown
}

export interface MolResult {
  text: string
  provider: 'openai' | 'anthropic' | 'hybrid'
  model: string
  task_type: TaskType
  latency_ms: number
  tokens: TokenUsage
  usd_cost: number
  inr_cost: number
  fallback_count: number
  passes: number
  request_id: string
}

export class MolError extends Error {
  constructor(
    public code:
      | 'NO_PROVIDER_AVAILABLE'
      | 'INVALID_INPUT'
      | 'TIMEOUT'
      | 'COST_CAP_EXCEEDED'
      | 'PROVIDER_CONFIG_MISSING',
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message)
  }
}
