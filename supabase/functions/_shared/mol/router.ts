// supabase/functions/_shared/mol/router.ts

import type { TaskType, StudentContext } from './types.ts'
import { determineUseCase, USE_CASES } from './use-cases.ts'

export type ProviderId = 'openai' | 'anthropic'

export interface ProviderTarget {
  provider: ProviderId
  model: string
}

export interface Pass {
  /** A primary target plus ordered fallbacks. First success in this list wins. */
  chain: ProviderTarget[]
  /** Optional purpose tag for telemetry. */
  role: 'single' | 'reason' | 'simplify' | 'vision'
}

export interface SelectedChain {
  task_type: TaskType
  passes: Pass[]
  mode: 'single' | 'hybrid' | 'vision'
}

export interface RouterOptions {
  hybrid_enabled: boolean
  openai_default: boolean
  /** Per-(task_type) weight in [0,1]. If weights[task] > 0.5, primary becomes openai. */
  weights: Record<string, number>
  student_context?: StudentContext
  query?: string
  use_cases_routing_enabled?: boolean
}

const HAIKU = 'claude-haiku-4-5-20251001'
const SONNET = 'claude-sonnet-4-6-20251022'
const GPT_MINI = 'gpt-4o-mini'
const GPT_FULL = 'gpt-4o'

const BASE_MATRIX: Record<TaskType, Pass[]> = {
  explanation: [{
    role: 'single',
    chain: [
      { provider: 'openai', model: GPT_MINI },
      { provider: 'anthropic', model: HAIKU },
    ],
  }],
  concept_explanation: [{
    role: 'single',
    chain: [
      { provider: 'openai', model: GPT_MINI },
      { provider: 'anthropic', model: HAIKU },
    ],
  }],
  step_by_step: [{
    role: 'single',
    chain: [
      { provider: 'openai', model: GPT_MINI },
      { provider: 'anthropic', model: HAIKU },
    ],
  }],
  reasoning: [{
    role: 'single',
    chain: [
      { provider: 'openai', model: GPT_FULL },
      { provider: 'anthropic', model: SONNET },
      { provider: 'anthropic', model: HAIKU },
    ],
  }],
  quiz_generation: [{
    role: 'single',
    chain: [
      { provider: 'openai', model: GPT_MINI },
      { provider: 'anthropic', model: HAIKU },
    ],
  }],
  evaluation: [{
    role: 'single',
    chain: [
      { provider: 'openai', model: GPT_MINI },
      { provider: 'anthropic', model: HAIKU },
    ],
  }],
  doubt_solving: [
    {
      role: 'reason',
      chain: [
        { provider: 'openai', model: GPT_FULL },
        { provider: 'anthropic', model: SONNET },
        { provider: 'anthropic', model: HAIKU },
      ],
    },
    {
      role: 'simplify',
      chain: [
        { provider: 'openai', model: GPT_MINI },
        { provider: 'anthropic', model: HAIKU },
      ],
    },
  ],
  ocr_extraction: [{
    role: 'vision',
    chain: [
      { provider: 'openai', model: GPT_FULL },
      { provider: 'anthropic', model: SONNET },
    ],
  }],
  grounding_check: [{
    role: 'single',
    chain: [
      { provider: 'openai', model: GPT_MINI },
      { provider: 'anthropic', model: HAIKU },
    ],
  }],
}

const MAX_TOKENS: Record<TaskType, number> = {
  explanation: 1024,
  concept_explanation: 1024,
  step_by_step: 1500,
  reasoning: 3000,
  quiz_generation: 2000,
  evaluation: 400,
  doubt_solving: 2500, // pass-1 cap; pass-2 uses simplifyMaxTokens
  ocr_extraction: 1500,
  grounding_check: 1024,
}

const PASS2_SIMPLIFY_MAX = 1200

export function selectProviderChain(task: TaskType, opts: RouterOptions): SelectedChain {
  // Check if a custom use case applies
  if (opts.use_cases_routing_enabled) {
    const useCaseKey = determineUseCase(task, opts.student_context, opts.query)
    if (useCaseKey && USE_CASES[useCaseKey]) {
      const uc = USE_CASES[useCaseKey]
      let passes: Pass[] = [{
        role: 'single',
        chain: [
          { provider: uc.primary.provider as any, model: uc.primary.model },
          ...uc.fallbacks.map((f) => ({ provider: f.provider as any, model: f.model }))
        ]
      }]

      // Per-task weight: weights[task] > 0.5 → ensure openai is primary
      const w = opts.weights[task]
      if (typeof w === 'number' && w > 0.5) {
        passes = passes.map((p) => {
          const openaiTarget = p.chain.find((t) => t.provider === 'openai')
          if (!openaiTarget) return p
          const reordered = [openaiTarget, ...p.chain.filter((t) => t !== openaiTarget)]
          return { ...p, chain: reordered }
        })
      }

      return {
        task_type: task,
        passes,
        mode: 'single',
      }
    }
  }

  // Clone so we never mutate BASE_MATRIX
  let passes: Pass[] = BASE_MATRIX[task].map((p) => ({ role: p.role, chain: [...p.chain] }))

  // Hybrid toggle
  if (task === 'doubt_solving' && !opts.hybrid_enabled) {
    passes = [{
      role: 'single',
      chain: [
        { provider: 'openai', model: GPT_FULL },
        { provider: 'openai', model: GPT_MINI },
        { provider: 'anthropic', model: SONNET },
        { provider: 'anthropic', model: HAIKU },
      ],
    }]
  }

  // openai_default flip for teaching tasks
  if (opts.openai_default && (task === 'step_by_step' || task === 'quiz_generation' || task === 'explanation')) {
    passes = passes.map((p) => ({
      ...p,
      chain: [
        { provider: 'openai', model: GPT_MINI },
        ...p.chain.filter((t) => !(t.provider === 'openai' && t.model === GPT_MINI)),
      ],
    }))
  }

  // Per-task weight: weights[task] > 0.5 → ensure openai is primary
  const w = opts.weights[task]
  if (typeof w === 'number' && w > 0.5) {
    passes = passes.map((p) => {
      const openaiTarget = p.chain.find((t) => t.provider === 'openai')
      if (!openaiTarget) return p
      const reordered = [openaiTarget, ...p.chain.filter((t) => t !== openaiTarget)]
      return { ...p, chain: reordered }
    })
  }

  return {
    task_type: task,
    passes,
    mode: task === 'doubt_solving' && opts.hybrid_enabled
      ? 'hybrid'
      : task === 'ocr_extraction'
        ? 'vision'
        : 'single',
  }
}

export function getMaxTokens(task: TaskType): number {
  return MAX_TOKENS[task]
}

export function getSimplifyMaxTokens(): number {
  return PASS2_SIMPLIFY_MAX
}
