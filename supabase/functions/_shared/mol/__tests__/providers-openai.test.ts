// supabase/functions/_shared/mol/__tests__/providers-openai.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OpenAIProvider } from '../providers/openai.ts'

describe('OpenAIProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // @ts-ignore
    globalThis.Deno = { env: { get: (k: string) => k === 'OPENAI_API_KEY' ? 'sk-test' : '' } }
  })

  it('returns parsed response on 200', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'Hi, scholar!' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 6 },
      model: 'gpt-4o-mini',
    }), { status: 200 })) as unknown as typeof fetch

    const r = await new OpenAIProvider().call('gpt-4o-mini', {
      system_prompt: 'sys',
      user_messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 100,
    })
    expect(r.text).toBe('Hi, scholar!')
    expect(r.provider).toBe('openai')
    expect(r.tokens).toEqual({ prompt: 12, completion: 6 })
  })

  it('throws on non-200', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('rate-limited', { status: 429 })) as unknown as typeof fetch
    await expect(new OpenAIProvider().call('gpt-4o-mini', {
      system_prompt: 'sys', user_messages: [{ role: 'user', content: 'hi' }], max_tokens: 100,
    })).rejects.toMatchObject({ message: expect.stringContaining('429') })
  })

  it('isConfigured returns true when key present', () => {
    expect(new OpenAIProvider().isConfigured()).toBe(true)
  })
})
