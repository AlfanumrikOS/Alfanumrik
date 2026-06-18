import { describe, expect, it, vi } from 'vitest'
import { fetchWithTimeout, ProviderFetchError } from '../reliability.ts'

const noSleep = async () => undefined

describe('fetchWithTimeout', () => {
  it('times out slow providers', async () => {
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })) as unknown as typeof fetch

    await expect(fetchWithTimeout('https://api.mailgun.net/v3/example/messages', {
      provider: 'mailgun',
      timeoutMs: 1,
      fetcher,
      sleep: noSleep,
    })).rejects.toMatchObject({ classification: { kind: 'timeout', retryable: true } })
  })

  it('exhausts retries for idempotent retryable responses', async () => {
    const fetcher = vi.fn(async () => new Response('busy', { status: 503 })) as unknown as typeof fetch

    const response = await fetchWithTimeout('https://api.mailgun.net/v3/example/messages', {
      method: 'POST',
      provider: 'mailgun',
      retry: { maxAttempts: 3, baseDelayMs: 1 },
      idempotencyKey: 'email:test',
      fetcher,
      sleep: noSleep,
    })

    expect(response.status).toBe(503)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('does not retry non-retryable provider failures', async () => {
    const fetcher = vi.fn(async () => new Response('bad request', { status: 400 })) as unknown as typeof fetch

    const response = await fetchWithTimeout('https://graph.facebook.com/v18.0/phone/messages', {
      method: 'POST',
      provider: 'whatsapp',
      retry: { maxAttempts: 3 },
      idempotencyKey: 'whatsapp:test',
      fetcher,
      sleep: noSleep,
    })

    expect(response.status).toBe(400)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('returns successful responses without retrying', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('Idempotency-Key')).toBe('queue:test')
      return new Response('{"ok":true}', { status: 200 })
    }) as unknown as typeof fetch

    const response = await fetchWithTimeout('https://example.com/task', {
      method: 'POST',
      provider: 'internal',
      retry: { maxAttempts: 3 },
      idempotencyKey: 'queue:test',
      fetcher,
      sleep: noSleep,
    })

    expect(response.ok).toBe(true)
    expect(await response.json()).toEqual({ ok: true })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
