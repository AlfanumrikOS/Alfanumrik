// supabase/functions/_shared/mol/router.ts

import type { TaskType, StudentContext } from './types.ts'
import { determineUseCase, USE_CASES } from './use-cases.ts'
import { GENERATED_BASE_MATRIX, MODEL_IDS } from './generated-matrix.ts'

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

// R3 consolidation (Foxy North-Star Phase 4, 2026-08-05):
// BASE_MATRIX is now GENERATED from packages/lib/src/ai/gateway/registry.ts
// via scripts/gen-mol-matrix.mjs. Rename a model id in the registry and this
// chain stays in lockstep automatically. The remaining router logic below
// (hybrid toggle, openai_default flip, per-task weight, use-cases override)
// is CALL-SITE POLICY that stays hand-authored here.
const HAIKU = MODEL_IDS.ANTHROPIC_HAIKU_ID
const SONNET = MODEL_IDS.ANTHROPIC_SONNET_ID
const GPT_MINI = MODEL_IDS.OPENAI_MINI_ID
const GPT_FULL = MODEL_IDS.OPENAI_FULL_ID

const BASE_MATRIX = GENERATED_BASE_MATRIX

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

      // Per-task weight: probabilistic routing
      let w = opts.weights[task]
      if (typeof w !== 'number') {
        w = 0.8
      }
      
      if (Math.random() < w) {
        passes = passes.map((p) => {
          const anthropicTarget = p.chain.find((t) => t.provider === 'anthropic')
          if (!anthropicTarget) return p
          const reordered = [anthropicTarget, ...p.chain.filter((t) => t !== anthropicTarget)]
          return { ...p, chain: reordered }
        })
      } else {
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

  // Hybrid toggle — Anthropic primary (CEO directive 2026-08-26)
  if (task === 'doubt_solving' && !opts.hybrid_enabled) {
    passes = [{
      role: 'single',
      chain: [
        { provider: 'anthropic', model: SONNET },
        { provider: 'anthropic', model: HAIKU },
        { provider: 'openai', model: GPT_FULL },
        { provider: 'openai', model: GPT_MINI },
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

  // Per-task weight: probabilistic routing — Anthropic primary (CEO directive 2026-08-26)
  let w = opts.weights[task]
  if (typeof w !== 'number') {
    w = 0.8
  }

  if (Math.random() < w) {
    passes = passes.map((p) => {
      const anthropicTarget = p.chain.find((t) => t.provider === 'anthropic')
      if (!anthropicTarget) return p
      const reordered = [anthropicTarget, ...p.chain.filter((t) => t !== anthropicTarget)]
      return { ...p, chain: reordered }
    })
  } else {
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
