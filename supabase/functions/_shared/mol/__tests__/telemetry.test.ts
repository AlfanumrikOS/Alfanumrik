// supabase/functions/_shared/mol/__tests__/telemetry.test.ts

// @ts-ignore — stub Deno before module import; telemetry.ts reads Deno.env at load time.
globalThis.Deno = { env: { get: (_k: string) => '' } }

import { describe, it, expect } from 'vitest'
import { calcCost } from '../telemetry.ts'

describe('calcCost', () => {
  it('computes openai gpt-4o-mini cost', () => {
    // input 0.15/1M, output 0.60/1M
    const usd = calcCost('openai', 'gpt-4o-mini', { prompt: 1_000_000, completion: 1_000_000 })
    expect(usd).toBeCloseTo(0.75, 4)
  })

  it('computes anthropic haiku cost', () => {
    // input 1/1M, output 5/1M
    const usd = calcCost('anthropic', 'claude-haiku-4-5-20251001', { prompt: 1_000_000, completion: 1_000_000 })
    expect(usd).toBeCloseTo(6.00, 4)
  })

  it('returns 0 for unknown model (no crash)', () => {
    expect(calcCost('openai', 'imaginary-model-9000', { prompt: 100, completion: 100 })).toBe(0)
  })
})
