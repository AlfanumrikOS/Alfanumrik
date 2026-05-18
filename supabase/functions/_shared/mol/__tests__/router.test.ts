// supabase/functions/_shared/mol/__tests__/router.test.ts

import { describe, it, expect } from 'vitest'
import { selectProviderChain, getMaxTokens } from '../router.ts'

describe('selectProviderChain', () => {
  it('routes explanation to openai primary', () => {
    const chain = selectProviderChain('explanation', { hybrid_enabled: true, openai_default: false, weights: {} })
    expect(chain.passes.length).toBe(1)
    expect(chain.passes[0].chain[0]).toEqual({ provider: 'openai', model: 'gpt-4o-mini' })
    expect(chain.passes[0].chain[1]).toEqual({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001' })
  })

  it('routes reasoning to anthropic sonnet primary', () => {
    const chain = selectProviderChain('reasoning', { hybrid_enabled: true, openai_default: false, weights: {} })
    expect(chain.passes[0].chain[0]).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-6-20251022' })
  })

  it('returns two passes for doubt_solving when hybrid enabled', () => {
    const chain = selectProviderChain('doubt_solving', { hybrid_enabled: true, openai_default: false, weights: {} })
    expect(chain.passes.length).toBe(2)
    expect(chain.passes[0].chain[0].provider).toBe('anthropic')
    expect(chain.passes[1].chain[0].provider).toBe('openai')
  })

  it('collapses doubt_solving to single pass when hybrid disabled', () => {
    const chain = selectProviderChain('doubt_solving', { hybrid_enabled: false, openai_default: false, weights: {} })
    expect(chain.passes.length).toBe(1)
  })

  it('forces openai primary when openai_default=true and task is step_by_step', () => {
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
