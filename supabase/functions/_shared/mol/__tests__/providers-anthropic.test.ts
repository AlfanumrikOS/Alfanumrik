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
    // cache_* default to 0 when Anthropic reports no caching, so an uncached
    // call is still distinguishable from one that was never measured.
    expect(r.tokens).toEqual({ prompt: 10, completion: 5, cache_read: 0, cache_write: 0 })
  })

  // Regression pin (2026-09-01): the provider used to read ONLY input_tokens.
  // Anthropic reports a cached request as a SMALL input_tokens plus a large
  // cache_read_input_tokens / cache_creation_input_tokens, so cached calls
  // logged ~15-35 prompt tokens against ~11,000 actually sent, and calcCost
  // priced the remainder at zero. Both counters must survive to telemetry or
  // Anthropic spend is silently under-reported and no caching work is provable.
  it('captures cache_read / cache_write counters when Anthropic reports them', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: 'text', text: 'cached answer' }],
      usage: {
        input_tokens: 15,
        output_tokens: 600,
        cache_read_input_tokens: 9000,
        cache_creation_input_tokens: 2000,
      },
      stop_reason: 'end_turn',
    }), { status: 200 })) as unknown as typeof fetch

    const r = await new AnthropicProvider().call('claude-haiku-4-5-20251001', {
      system_prompt: 'sys',
      user_messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 100,
    })
    expect(r.tokens).toEqual({
      prompt: 15,
      completion: 600,
      cache_read: 9000,
      cache_write: 2000,
    })
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
