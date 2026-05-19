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

  // ── PR audit 2026-05-19: date-pinned model alias prefix matching ──
  // OpenAI's response `model` field is the date-pinned variant (e.g.
  // `gpt-4o-2024-08-06`), not the alias we send in the request (`gpt-4o`).
  // mol_request_logs.model stores what OpenAI returned. Without alias
  // stripping, exact-match lookup fails → calcCost returns 0 → cost
  // dashboards under-report by 100%.
  it('matches date-pinned openai gpt-4o variant against the base alias', () => {
    // input 2.50/1M, output 10.00/1M — base alias 'gpt-4o' pricing.
    const usd = calcCost('openai', 'gpt-4o-2024-08-06', { prompt: 1_000_000, completion: 1_000_000 })
    expect(usd).toBeCloseTo(12.50, 4)
  })

  it('matches date-pinned openai gpt-4o-mini variant against the base alias', () => {
    // Regression guard: the alias strip must NOT prefix-collide with 'gpt-4o'.
    // gpt-4o-mini-2024-07-18 must resolve to gpt-4o-mini pricing (0.15/0.60),
    // not gpt-4o pricing (2.50/10.00).
    const usd = calcCost('openai', 'gpt-4o-mini-2024-07-18', { prompt: 1_000_000, completion: 1_000_000 })
    expect(usd).toBeCloseTo(0.75, 4)
  })

  it('still returns 0 when neither exact nor date-stripped alias is known', () => {
    // unknown-base-2026-01-01 → strip → unknown-base → still not in PRICING.
    expect(
      calcCost('openai', 'unknown-base-2026-01-01', { prompt: 100, completion: 100 }),
    ).toBe(0)
  })

  it('exact-key match still wins (preserves legacy behavior for non-dated keys)', () => {
    // Anthropic's claude-haiku-4-5-20251001 ends with -20251001 which DOES
    // NOT match the -YYYY-MM-DD regex (no hyphens inside the date). Lookup
    // must still succeed via the exact-match branch.
    const usd = calcCost('anthropic', 'claude-haiku-4-5-20251001', { prompt: 1_000_000, completion: 0 })
    expect(usd).toBeCloseTo(1.00, 4)
  })
})
