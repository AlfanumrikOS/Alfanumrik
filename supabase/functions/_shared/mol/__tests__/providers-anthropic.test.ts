// supabase/functions/_shared/mol/__tests__/providers-anthropic.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AnthropicProvider } from '../providers/anthropic.ts'

describe('AnthropicProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // @ts-ignore - inject Deno shim for the unit test environment
    globalThis.Deno = { env: { get: (k: string) => k === 'ANTHROPIC_API_KEY' ? 'test-key' : '' } }
  })

  it('returns parsed response on 200', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: 'text', text: 'Hello, student!' }],
      usage: { input_tokens: 10, output_tokens: 5 },
      stop_reason: 'end_turn',
    }), { status: 200 }))
    globalThis.fetch = mockFetch as unknown as typeof fetch

    const p = new AnthropicProvider()
    const r = await p.call('claude-haiku-4-5-20251001', {
      system_prompt: 'sys',
      user_messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 100,
    })
    expect(r.text).toBe('Hello, student!')
    expect(r.provider).toBe('anthropic')
    expect(r.tokens).toEqual({ prompt: 10, completion: 5 })
  })

  it('throws on non-200', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('boom', { status: 503 })) as unknown as typeof fetch
    const p = new AnthropicProvider()
    await expect(p.call('claude-haiku-4-5-20251001', {
      system_prompt: 'sys', user_messages: [{ role: 'user', content: 'hi' }], max_tokens: 100,
    })).rejects.toMatchObject({ message: expect.stringContaining('503') })
  })

  it('isConfigured returns true when key present', () => {
    expect(new AnthropicProvider().isConfigured()).toBe(true)
  })
})
