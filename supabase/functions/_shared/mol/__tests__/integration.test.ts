// supabase/functions/_shared/mol/__tests__/integration.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest'

function mockDeno(env: Record<string, string>) {
  // @ts-ignore
  globalThis.Deno = { env: { get: (k: string) => env[k] || '' } }
}

function mockFlags(flags: Array<{ flag_name: string; is_enabled: boolean; rollout_percentage: number | null; target_environments: string[] | null }>) {
  return new Response(JSON.stringify(flags), { status: 200 })
}

function mockOpenAIResponse(text: string) {
  return new Response(JSON.stringify({
    choices: [{ message: { content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 50 },
    model: 'gpt-4o-mini',
  }), { status: 200 })
}

function mockAnthropicResponse(text: string) {
  return new Response(JSON.stringify({
    content: [{ type: 'text', text }],
    usage: { input_tokens: 100, output_tokens: 50 },
    stop_reason: 'end_turn',
  }), { status: 200 })
}

describe('MOL integration', () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    mockDeno({
      OPENAI_API_KEY: 'sk-test',
      ANTHROPIC_API_KEY: 'ant-test',
      SUPABASE_URL: 'https://supa.test',
      SUPABASE_SERVICE_ROLE_KEY: 'srv-key',
      USD_TO_INR: '83',
    })
    // Reset module caches (force re-import below)
    vi.resetModules()
  })

  it('routes explanation → openai gpt-4o-mini and computes cost', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/feature_flags')) return Promise.resolve(mockFlags([]))
      if (url.includes('mol_routing_weights')) return Promise.resolve(new Response('[]', { status: 200 }))
      if (url.includes('openai.com')) return Promise.resolve(mockOpenAIResponse('Photosynthesis is...'))
      if (url.includes('anthropic.com')) return Promise.resolve(mockAnthropicResponse('Shouldnt be called'))
      return Promise.resolve(new Response('{}', { status: 200 }))
    }) as unknown as typeof fetch

    const { generateResponse } = await import('../index.ts')
    const r = await generateResponse({
      input: { question: 'Explain photosynthesis' },
      student_context: { student_id: 's1', grade: '6', language: 'en' },
    })
    expect(r.provider).toBe('openai')
    expect(r.model).toBe('gpt-4o-mini')
    expect(r.task_type).toBe('explanation')
    expect(r.usd_cost).toBeGreaterThan(0)
    expect(r.fallback_count).toBe(0)
    expect(r.text).toMatch(/Photosynthesis/)
  })

  it('falls back to Anthropic when OpenAI returns 503', async () => {
    let openaiCalls = 0
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/feature_flags')) return Promise.resolve(mockFlags([]))
      if (url.includes('mol_routing_weights')) return Promise.resolve(new Response('[]', { status: 200 }))
      if (url.includes('openai.com')) {
        openaiCalls += 1
        return Promise.resolve(new Response('upstream', { status: 503 }))
      }
      if (url.includes('anthropic.com')) return Promise.resolve(mockAnthropicResponse('Reply from the fallback tutor'))
      return Promise.resolve(new Response('{}', { status: 200 }))
    }) as unknown as typeof fetch

    const { generateResponse } = await import('../index.ts')
    const r = await generateResponse({
      input: { question: 'Explain photosynthesis' },
      student_context: { student_id: 's1', grade: '6', language: 'en' },
    })
    expect(r.provider).toBe('anthropic')
    expect(r.fallback_count).toBeGreaterThanOrEqual(1)
    expect(openaiCalls).toBe(2) // 2 retries before fallback
    // NOTE: post-processor strips vendor names (claude, anthropic, openai, gpt, etc.).
    // The plan's original assertion `/From Claude/` would fail because "Claude" is stripped.
    // We use a vendor-neutral string so the test verifies fallback content survived post-processing.
    expect(r.text).toMatch(/fallback tutor/)
  })

  it('uses hybrid mode for doubt_solving when flag enabled', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/feature_flags')) {
        return Promise.resolve(mockFlags([
          { flag_name: 'ff_mol_hybrid_mode_v1', is_enabled: true, rollout_percentage: 100, target_environments: null },
        ]))
      }
      if (url.includes('mol_routing_weights')) return Promise.resolve(new Response('[]', { status: 200 }))
      if (url.includes('openai.com'))    return Promise.resolve(mockOpenAIResponse('Simplified for grade 11'))
      if (url.includes('anthropic.com')) return Promise.resolve(mockAnthropicResponse('Deep reasoning'))
      return Promise.resolve(new Response('{}', { status: 200 }))
    }) as unknown as typeof fetch

    const { generateResponse } = await import('../index.ts')
    const r = await generateResponse({
      input: { question: 'Why does moment of inertia depend on axis and how do I compute it for a rod?' },
      student_context: { student_id: 's1', grade: '11', language: 'en', exam_goal: 'jee' },
    })
    expect(r.task_type).toBe('doubt_solving')
    expect(r.provider).toBe('hybrid')
    expect(r.passes).toBe(2)
    expect(r.text).toMatch(/Simplified/)
  })
})
