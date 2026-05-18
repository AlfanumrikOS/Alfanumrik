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
    request_id?: string                 // for trace correlation
    surface?: 'foxy' | 'quiz' | 'solver' | 'ocr' | string
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
