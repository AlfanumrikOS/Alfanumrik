// supabase/functions/_shared/mol/__tests__/router.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { selectProviderChain, getMaxTokens } from '../router.ts'
import { GENERATED_BASE_MATRIX, MODEL_IDS } from '../generated-matrix.ts'
import type { TaskType } from '../types.ts'

// R3 consolidation parity — the generated Deno matrix must resolve, for every
// TaskType, to the same primary target as the gateway's LEGACY_FALLBACK_ORDER
// intent (auto/haiku/sonnet policy tokens). We DUPLICATE the mapping here on
// purpose — this test is the intent registry pin that catches drift between
// scripts/gen-mol-matrix.mjs's task-type -> chain mapping and the router's
// declared behaviour. A drift in either surface fails this test.
const EXPECTED_PRIMARY: Record<TaskType, { provider: 'openai' | 'anthropic'; model: string }> = {
  explanation: { provider: 'anthropic', model: MODEL_IDS.ANTHROPIC_HAIKU_ID },
  concept_explanation: { provider: 'anthropic', model: MODEL_IDS.ANTHROPIC_HAIKU_ID },
  step_by_step: { provider: 'anthropic', model: MODEL_IDS.ANTHROPIC_HAIKU_ID },
  reasoning: { provider: 'anthropic', model: MODEL_IDS.ANTHROPIC_SONNET_ID },
  quiz_generation: { provider: 'anthropic', model: MODEL_IDS.ANTHROPIC_HAIKU_ID },
  evaluation: { provider: 'anthropic', model: MODEL_IDS.ANTHROPIC_HAIKU_ID },
  doubt_solving: { provider: 'anthropic', model: MODEL_IDS.ANTHROPIC_SONNET_ID },
  ocr_extraction: { provider: 'anthropic', model: MODEL_IDS.ANTHROPIC_SONNET_ID },
  grounding_check: { provider: 'anthropic', model: MODEL_IDS.ANTHROPIC_HAIKU_ID },
}

describe('generated-matrix parity (R3 consolidation)', () => {
  it('every TaskType has an entry in GENERATED_BASE_MATRIX', () => {
    const declared = Object.keys(EXPECTED_PRIMARY) as TaskType[]
    for (const t of declared) {
      expect(GENERATED_BASE_MATRIX[t], `missing task_type in matrix: ${t}`).toBeDefined()
      expect(GENERATED_BASE_MATRIX[t].length, `empty passes for ${t}`).toBeGreaterThan(0)
    }
  })

  it('primary of each generated chain matches expected gateway intent', () => {
    for (const [task, want] of Object.entries(EXPECTED_PRIMARY) as [TaskType, typeof EXPECTED_PRIMARY[TaskType]][]) {
      const primary = GENERATED_BASE_MATRIX[task][0].chain[0]
      expect(primary, `no primary for ${task}`).toEqual(want)
    }
  })
})


describe('selectProviderChain', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1) // Ensures Anthropic is primary (0.1 < 0.8)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })
  it('routes explanation to anthropic primary (CEO directive 2026-08-26)', () => {
    const chain = selectProviderChain('explanation', { hybrid_enabled: true, openai_default: false, weights: {} })
    expect(chain.passes.length).toBe(1)
    expect(chain.passes[0].chain[0]).toEqual({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001' })
    expect(chain.passes[0].chain[1]).toEqual({ provider: 'openai', model: 'gpt-4o-mini' })
  })

  it('routes reasoning to anthropic claude-sonnet primary', () => {
    const chain = selectProviderChain('reasoning', { hybrid_enabled: true, openai_default: false, weights: {} })
    expect(chain.passes[0].chain[0]).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' })
  })

  it('returns two passes for doubt_solving when hybrid enabled', () => {
    const chain = selectProviderChain('doubt_solving', { hybrid_enabled: true, openai_default: false, weights: {} })
    expect(chain.passes.length).toBe(2)
    expect(chain.passes[0].chain[0].provider).toBe('anthropic')
    expect(chain.passes[1].chain[0].provider).toBe('anthropic')
  })

  it('collapses doubt_solving to single pass when hybrid disabled', () => {
    const chain = selectProviderChain('doubt_solving', { hybrid_enabled: false, openai_default: false, weights: {} })
    expect(chain.passes.length).toBe(1)
  })

  it('uses claude-sonnet as primary and claude-haiku as fallback for doubt_solving non-hybrid', () => {
    const chain = selectProviderChain('doubt_solving', { hybrid_enabled: false, openai_default: false, weights: {} })
    expect(chain.passes[0].chain[0]).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' })
    expect(chain.passes[0].chain[1]).toEqual({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001' })
  })

  it('forces openai primary when openai_default=true and task is step_by_step', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9) // Math.random >= w means openai wins
    const chain = selectProviderChain('step_by_step', { hybrid_enabled: true, openai_default: true, weights: {} })
    expect(chain.passes[0].chain[0].provider).toBe('openai')
  })

  it('caps max_tokens per task type', () => {
    expect(getMaxTokens('explanation')).toBe(1024)
    expect(getMaxTokens('reasoning')).toBe(3000)
    expect(getMaxTokens('evaluation')).toBe(400)
    expect(getMaxTokens('quiz_generation')).toBe(2000)
  })
})
