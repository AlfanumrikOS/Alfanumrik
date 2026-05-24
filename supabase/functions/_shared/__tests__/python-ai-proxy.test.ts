// supabase/functions/_shared/__tests__/python-ai-proxy.test.ts
//
// Phase 1 (2026-05-24): unit tests for the Python AI services cutover
// proxy helper used by bulk-question-gen (and, in future Phase 1+ ports,
// every other Edge Function migrating to Cloud Run).
//
// What we verify:
//   1. Short-circuit precedence:
//        a. PYTHON_AI_BASE_URL empty   → should_proxy=false regardless of flag
//        b. envelope.enabled !== true  → should_proxy=false
//        c. envelope.kill_switch=true  → should_proxy=false
//        d. rollout_pct=0              → should_proxy=false (bucket >= 0 always)
//        e. flag-read fails defensively → should_proxy=false
//   2. Happy path: rollout_pct=100 → should_proxy=true regardless of request_id
//   3. Partial rollout: bucket < rollout_pct → proxy; bucket >= rollout_pct → no-proxy
//   4. target_url composition (trailing slash + leading slash tolerance)
//   5. forwardToPython:
//        a. body + headers forwarded byte-for-byte (no Authorization stripping)
//        b. non-2xx upstream → throws (caller decides fallback)
//        c. timeout → throws AbortError-wrapping
//        d. host header is dropped (cross-origin POST safety)
//
// Mocking strategy mirrors mol-shadow.test.ts:
//   - stub globalThis.Deno BEFORE importing the module
//   - vi.mock the feature-flag module so getFlagEnvelope is a spy
//   - stub global.fetch for forwardToPython tests

// @ts-ignore — stub Deno before module import; the helper reads Deno.env at
// shouldProxyToPython call time and we want each test to control that value.
globalThis.Deno = {
  env: {
    get: (k: string) => (mockEnv as Record<string, string | undefined>)[k] ?? '',
  },
} as unknown as typeof Deno

// Per-test env-var bag. Tests mutate this via setEnv() / clearEnv() helpers.
let mockEnv: Record<string, string | undefined> = {}
function setEnv(key: string, value: string): void {
  mockEnv[key] = value
}
function clearEnv(): void {
  mockEnv = {}
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── Hoisted spies (stable across the file; reset per test) ───────────────────
const getFlagEnvelopeSpy = vi.fn()

vi.mock('../mol/feature-flag.ts', () => ({
  getFlagEnvelope: (...args: unknown[]) =>
    (getFlagEnvelopeSpy as unknown as (...a: unknown[]) => Promise<unknown>)(...args),
}))

// Imports MUST come after vi.mock so the mocked bindings are in place.
import { shouldProxyToPython, forwardToPython } from '../python-ai-proxy.ts'

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a flag envelope as readEnvelope() will see it via getFlagEnvelope. */
function envelope(opts: {
  is_enabled?: boolean
  enabled?: boolean
  kill_switch?: boolean
  rollout_pct?: number
}) {
  return {
    is_enabled: opts.is_enabled ?? true,
    metadata: {
      enabled: opts.enabled,
      kill_switch: opts.kill_switch,
      rollout_pct: opts.rollout_pct,
    },
  }
}

beforeEach(() => {
  getFlagEnvelopeSpy.mockReset()
  clearEnv()
  // Default: Cloud Run URL is wired in for most tests; individual tests
  // can override (or call clearEnv() to test the missing-URL short-circuit).
  setEnv('PYTHON_AI_BASE_URL', 'https://ai-services-stub-asia-south1.run.app')
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── shouldProxyToPython — short-circuits ────────────────────────────────────

describe('shouldProxyToPython — short-circuit paths', () => {
  it('PYTHON_AI_BASE_URL empty → should_proxy=false even when flag fully on', async () => {
    clearEnv() // wipe the BASE_URL set in beforeEach
    getFlagEnvelopeSpy.mockResolvedValueOnce(
      envelope({ enabled: true, rollout_pct: 100 }),
    )

    const decision = await shouldProxyToPython({
      flag_name: 'ff_python_bulk_question_gen_v1',
      endpoint_path: '/v1/bulk-question-gen',
      request_id: 'req-1',
    })

    expect(decision.should_proxy).toBe(false)
    expect(decision.target_url).toBeNull()
    expect(decision.reason).toContain('PYTHON_AI_BASE_URL')
    // The flag should never even be read when BASE_URL is empty (architect
    // kill takes precedence — flag-read is a Supabase round-trip we skip).
    expect(getFlagEnvelopeSpy).not.toHaveBeenCalled()
  })

  it('envelope.enabled=false → should_proxy=false', async () => {
    getFlagEnvelopeSpy.mockResolvedValueOnce(
      envelope({ enabled: false, rollout_pct: 100 }),
    )

    const decision = await shouldProxyToPython({
      flag_name: 'ff_python_bulk_question_gen_v1',
      endpoint_path: '/v1/bulk-question-gen',
      request_id: 'req-1',
    })

    expect(decision.should_proxy).toBe(false)
    expect(decision.target_url).toBeNull()
    expect(decision.reason).toMatch(/disabled/)
  })

  it('rollout_pct=0 → should_proxy=false (bucket is always >= 0)', async () => {
    getFlagEnvelopeSpy.mockResolvedValueOnce(
      envelope({ enabled: true, rollout_pct: 0 }),
    )

    const decision = await shouldProxyToPython({
      flag_name: 'ff_python_bulk_question_gen_v1',
      endpoint_path: '/v1/bulk-question-gen',
      request_id: 'req-1',
    })

    expect(decision.should_proxy).toBe(false)
    expect(decision.target_url).toBeNull()
  })

  it('kill_switch=true → should_proxy=false (overrides enabled=true and rollout_pct=100)', async () => {
    getFlagEnvelopeSpy.mockResolvedValueOnce(
      envelope({ enabled: true, kill_switch: true, rollout_pct: 100 }),
    )

    const decision = await shouldProxyToPython({
      flag_name: 'ff_python_bulk_question_gen_v1',
      endpoint_path: '/v1/bulk-question-gen',
      request_id: 'req-1',
    })

    expect(decision.should_proxy).toBe(false)
    expect(decision.reason).toMatch(/kill_switch/)
  })

  it('getFlagEnvelope rejects → should_proxy=false (defensive default)', async () => {
    getFlagEnvelopeSpy.mockRejectedValueOnce(new Error('flag fetch failed'))

    const decision = await shouldProxyToPython({
      flag_name: 'ff_python_bulk_question_gen_v1',
      endpoint_path: '/v1/bulk-question-gen',
      request_id: 'req-1',
    })

    // Mirrors isMolAdminRoutingEnabled() — defensive default. Cost > correctness
    // for the duration of a flag-read outage.
    expect(decision.should_proxy).toBe(false)
  })

  it('envelope omitted → enabled defaults to is_enabled column; column=false → no proxy', async () => {
    getFlagEnvelopeSpy.mockResolvedValueOnce({
      is_enabled: false,
      metadata: { rollout_pct: 100 },
    })

    const decision = await shouldProxyToPython({
      flag_name: 'ff_python_bulk_question_gen_v1',
      endpoint_path: '/v1/bulk-question-gen',
      request_id: 'req-1',
    })

    expect(decision.should_proxy).toBe(false)
  })
})

// ─── shouldProxyToPython — happy path ────────────────────────────────────────

describe('shouldProxyToPython — happy path', () => {
  it('rollout_pct=100 + enabled=true → should_proxy=true for ANY request_id', async () => {
    getFlagEnvelopeSpy.mockResolvedValue(
      envelope({ enabled: true, rollout_pct: 100 }),
    )

    for (const reqId of ['req-1', 'req-2', 'zzz', '0', crypto.randomUUID()]) {
      const decision = await shouldProxyToPython({
        flag_name: 'ff_python_bulk_question_gen_v1',
        endpoint_path: '/v1/bulk-question-gen',
        request_id: reqId,
      })
      expect(decision.should_proxy).toBe(true)
      expect(decision.target_url).toBe(
        'https://ai-services-stub-asia-south1.run.app/v1/bulk-question-gen',
      )
    }
  })

  it('target_url composes correctly when BASE_URL has a trailing slash and path lacks a leading slash', async () => {
    setEnv('PYTHON_AI_BASE_URL', 'https://ai-services-stub-asia-south1.run.app/')
    getFlagEnvelopeSpy.mockResolvedValueOnce(
      envelope({ enabled: true, rollout_pct: 100 }),
    )

    const decision = await shouldProxyToPython({
      flag_name: 'ff_python_bulk_question_gen_v1',
      endpoint_path: 'v1/bulk-question-gen',
      request_id: 'req-1',
    })

    expect(decision.should_proxy).toBe(true)
    expect(decision.target_url).toBe(
      'https://ai-services-stub-asia-south1.run.app/v1/bulk-question-gen',
    )
  })

  it('rollout_pct=50 → partial sample: most ids land on one side or the other (deterministic)', async () => {
    getFlagEnvelopeSpy.mockResolvedValue(
      envelope({ enabled: true, rollout_pct: 50 }),
    )

    // Run a deterministic set of stable request ids; about half should proxy.
    // We don't assert exact 50/50 (the hash is xor-shift, not perfectly
    // uniform on small samples); we assert that BOTH outcomes occur AND
    // that the same request_id is stable across calls.
    const ids = Array.from({ length: 100 }, (_, i) => `stable-req-${i}`)
    const decisions = await Promise.all(
      ids.map((id) =>
        shouldProxyToPython({
          flag_name: 'ff_python_bulk_question_gen_v1',
          endpoint_path: '/v1/bulk-question-gen',
          request_id: id,
        }),
      ),
    )
    const proxied = decisions.filter((d) => d.should_proxy).length
    const skipped = decisions.length - proxied
    expect(proxied).toBeGreaterThan(0)
    expect(skipped).toBeGreaterThan(0)

    // Determinism: a second call for the same id returns the same decision.
    const same = await shouldProxyToPython({
      flag_name: 'ff_python_bulk_question_gen_v1',
      endpoint_path: '/v1/bulk-question-gen',
      request_id: 'stable-req-0',
    })
    expect(same.should_proxy).toBe(decisions[0].should_proxy)
  })
})

// ─── forwardToPython — body + header passthrough ─────────────────────────────

describe('forwardToPython — body + header passthrough', () => {
  it('forwards POST body byte-for-byte and preserves Authorization header', async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ generated: 10, inserted: 10 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    const incoming = new Request('https://edge.supabase.co/functions/v1/bulk-question-gen', {
      method: 'POST',
      headers: {
        authorization: 'Bearer admin-jwt-stub',
        'content-type': 'application/json',
        'x-request-id': 'req-789',
      },
      body: JSON.stringify({
        grade: '8',
        subject: 'science',
        chapter: 'Light',
        count: 10,
      }),
    })

    const resp = await forwardToPython({
      target_url: 'https://ai-services-stub.run.app/v1/bulk-question-gen',
      request: incoming,
    })

    expect(resp.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    const callArgs = fetchSpy.mock.calls[0]
    expect(callArgs[0]).toBe('https://ai-services-stub.run.app/v1/bulk-question-gen')
    const init = callArgs[1] as RequestInit

    // Method preserved
    expect(init.method).toBe('POST')

    // Authorization is forwarded — the Python service does its own JWT verify.
    const headers = new Headers(init.headers as HeadersInit)
    expect(headers.get('authorization')).toBe('Bearer admin-jwt-stub')
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('x-request-id')).toBe('req-789')

    // Body must arrive byte-identical. body in init is an ArrayBuffer.
    const body = init.body as ArrayBuffer
    const bodyText = new TextDecoder().decode(new Uint8Array(body))
    const parsed = JSON.parse(bodyText)
    expect(parsed).toEqual({ grade: '8', subject: 'science', chapter: 'Light', count: 10 })
  })

  it('strips the Host header before forwarding (cross-origin safety)', async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    const incoming = new Request('https://edge.supabase.co/functions/v1/bulk-question-gen', {
      method: 'POST',
      headers: {
        // Construct Host explicitly via a Headers object to bypass fetch's
        // forbidden-header filter that strips it from Request() init.
        authorization: 'Bearer stub',
      },
      body: '{}',
    })
    // Force-set Host on the Request headers (Node test env allows mutation
    // even though the browser fetch spec disallows it).
    try {
      incoming.headers.set('host', 'edge.supabase.co')
    } catch {
      // If the test runtime refuses, the assertion below is still valid
      // (host already wasn't there to forward).
    }

    await forwardToPython({
      target_url: 'https://ai-services-stub.run.app/v1/bulk-question-gen',
      request: incoming,
    })

    const init = fetchSpy.mock.calls[0][1] as RequestInit
    const headers = new Headers(init.headers as HeadersInit)
    expect(headers.get('host')).toBeNull()
  })
})

// ─── forwardToPython — error propagation ─────────────────────────────────────

describe('forwardToPython — error propagation', () => {
  it('upstream returns 503 → throws (caller decides whether to fall through)', async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce(
      new Response('upstream unavailable', { status: 503 }),
    )
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    const incoming = new Request('https://edge.supabase.co/x', {
      method: 'POST',
      body: '{}',
    })

    await expect(
      forwardToPython({
        target_url: 'https://ai-services-stub.run.app/v1/bulk-question-gen',
        request: incoming,
      }),
    ).rejects.toThrow(/HTTP 503/)
  })

  it('fetch network failure → throws with explanatory message', async () => {
    const fetchSpy = vi.fn().mockRejectedValueOnce(new TypeError('network down'))
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    const incoming = new Request('https://edge.supabase.co/x', { method: 'POST', body: '{}' })

    await expect(
      forwardToPython({
        target_url: 'https://ai-services-stub.run.app/v1/bulk-question-gen',
        request: incoming,
      }),
    ).rejects.toThrow(/network down/)
  })

  it('upstream slower than timeout → AbortError surfaces as a timeout throw', async () => {
    // Mock fetch to listen for the abort signal and reject when it fires.
    // This is a more reliable simulation than fake timers because vitest's
    // fake timers do not advance setTimeout inside an active fetch in this
    // configuration.
    const fetchSpy = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init.signal as AbortSignal
        if (signal) {
          signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          })
        }
        // Never resolves on its own — only the abort path completes.
      })
    })
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    const incoming = new Request('https://edge.supabase.co/x', { method: 'POST', body: '{}' })

    // Use a 25ms timeout so the test finishes quickly without fake-timer
    // gymnastics. The real production timeout is 30000ms but the same
    // code path is exercised here.
    await expect(
      forwardToPython({
        target_url: 'https://ai-services-stub.run.app/v1/bulk-question-gen',
        request: incoming,
        timeout_ms: 25,
      }),
    ).rejects.toThrow(/timeout after 25ms/)
  })
})
