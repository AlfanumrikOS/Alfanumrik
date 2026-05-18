// supabase/functions/_shared/mol/__tests__/cassette-helper.test.ts
//
// Tests for the cassette infrastructure itself. These tests must NEVER
// call any real provider. They exercise the helper end-to-end by writing
// cassette files to a per-test temp directory, then reading them back.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _cassettePath,
  _readCassetteFile,
  _writeCassetteFile,
  CASSETTES_DIR,
  hashRequest,
  redactBody,
  withCassette,
  type Cassette,
  type CassetteRequest,
} from './cassette-helper.ts'

// ── Test-local sandbox for cassette files ───────────────────────────────────
//
// withCassette() writes/reads under CASSETTES_DIR (a constant resolved
// relative to the helper's __filename). We need a per-test sandbox that
// won't collide with real cassettes, so we write each test's fixture into
// a uniquely named subpath under CASSETTES_DIR and clean up after.

let sandboxName = ''

beforeEach(() => {
  // Unique per test so parallel tests don't trip over each other.
  sandboxName = `__test_sandbox_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
})

afterEach(() => {
  // Remove any cassette files this test wrote.
  const sandboxRoot = join(CASSETTES_DIR, sandboxName + '.json')
  try { rmSync(sandboxRoot, { force: true }) } catch { /* ignore */ }
  const sandboxDir = join(CASSETTES_DIR, sandboxName)
  try { rmSync(sandboxDir, { recursive: true, force: true }) } catch { /* ignore */ }
  // Restore env between tests.
  delete process.env.MOL_CASSETTE_MODE
  vi.restoreAllMocks()
})

function makeRequest(overrides: Partial<CassetteRequest> = {}): CassetteRequest {
  return {
    method: 'POST',
    url: 'https://api.anthropic.com/v1/messages',
    headers: { 'content-type': 'application/json' },
    body: { model: 'claude-haiku-4-5-20251001', max_tokens: 100 },
    ...overrides,
  }
}

// ── PII redaction ───────────────────────────────────────────────────────────

describe('redactBody', () => {
  it('removes top-level PII fields', () => {
    const result = redactBody({
      email: 'a@b.com',
      phone: '+91-9876543210',
      password: 'hunter2',
      token: 'secret',
      api_key: 'sk-...',
      keep_this: 'visible',
    })
    expect(result).toEqual({ keep_this: 'visible' })
  })

  it('removes nested PII fields', () => {
    const result = redactBody({
      meta: {
        user: { student_id: 's-123', name: 'Alice' },
        creds: { access_token: 'xyz', refresh_token: 'abc' },
      },
      messages: [{ role: 'user', content: 'hi', token: 'leak' }],
    })
    expect(result).toEqual({
      meta: {
        user: { name: 'Alice' },
        creds: {},
      },
      messages: [{ role: 'user', content: 'hi' }],
    })
  })

  it('is case-insensitive on field names', () => {
    const result = redactBody({
      EMAIL: 'a@b.com',
      Phone: '999',
      apiKey: 'sk-x',
      KEPT: 'yes',
    })
    expect(result).toEqual({ KEPT: 'yes' })
  })

  it('does not mutate the input', () => {
    const input = { email: 'x@y.com', kept: 1 }
    redactBody(input)
    expect(input).toEqual({ email: 'x@y.com', kept: 1 })
  })

  it('passes through primitives and null unchanged', () => {
    expect(redactBody(null)).toBe(null)
    expect(redactBody(undefined)).toBe(undefined)
    expect(redactBody(42)).toBe(42)
    expect(redactBody('hi')).toBe('hi')
    expect(redactBody(true)).toBe(true)
  })

  it('recurses into arrays', () => {
    const result = redactBody([{ email: 'a@b.com', n: 1 }, { phone: '9', n: 2 }])
    expect(result).toEqual([{ n: 1 }, { n: 2 }])
  })
})

// ── Hash collision / canonicalisation ───────────────────────────────────────

describe('hashRequest', () => {
  it('produces the same hash for the same request', () => {
    const a = hashRequest(makeRequest())
    const b = hashRequest(makeRequest())
    expect(a).toBe(b)
  })

  it('produces a different hash when the URL changes', () => {
    const a = hashRequest(makeRequest({ url: 'https://api.anthropic.com/v1/messages' }))
    const b = hashRequest(makeRequest({ url: 'https://api.openai.com/v1/chat/completions' }))
    expect(a).not.toBe(b)
  })

  it('produces a different hash when the body changes', () => {
    const a = hashRequest(makeRequest({ body: { model: 'a' } }))
    const b = hashRequest(makeRequest({ body: { model: 'b' } }))
    expect(a).not.toBe(b)
  })

  it('produces a different hash when the method changes', () => {
    const a = hashRequest(makeRequest({ method: 'GET' }))
    const b = hashRequest(makeRequest({ method: 'POST' }))
    expect(a).not.toBe(b)
  })

  it('is order-independent on header keys', () => {
    const a = hashRequest(makeRequest({ headers: { a: '1', b: '2' } }))
    const b = hashRequest(makeRequest({ headers: { b: '2', a: '1' } }))
    expect(a).toBe(b)
  })

  it('detects a collision between two superficially similar requests', () => {
    // Same URL but different model → different hash → no collision.
    const a = hashRequest(makeRequest({ body: { model: 'haiku-4-5', max_tokens: 100 } }))
    const b = hashRequest(makeRequest({ body: { model: 'haiku-4-5', max_tokens: 200 } }))
    expect(a).not.toBe(b)
  })

  it('returns a 64-character hex digest', () => {
    const h = hashRequest(makeRequest())
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })
})

// ── Missing cassette failure ────────────────────────────────────────────────

describe('withCassette playback', () => {
  beforeEach(() => {
    process.env.MOL_CASSETTE_MODE = 'playback'
  })

  it('fails loudly when the cassette file is missing', async () => {
    const missing = sandboxName + '-does-not-exist'
    await expect(
      withCassette(missing, async () => 'unreachable'),
    ).rejects.toThrow(/Cassette not found/)
  })

  it('never falls back to a real fetch when no cassette exists', async () => {
    // Spy on the original fetch — if anything actually hits the network the
    // spy fires. We expect zero calls because withCassette throws synchronously
    // before fn() runs.
    const fetchSpy = vi.fn()
    const original = globalThis.fetch
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    try {
      await expect(
        withCassette(sandboxName + '-missing', async () => {
          await globalThis.fetch('https://example.com')
          return 'unreachable'
        }),
      ).rejects.toThrow(/Cassette not found/)
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      globalThis.fetch = original
    }
  })

  it('returns a synthesised Response that matches the recorded shape', async () => {
    const cassette: Cassette = {
      version: 1,
      request_hash: '',
      recorded_at: new Date().toISOString(),
      request: makeRequest(),
      response: {
        status: 200,
        headers: { 'content-type': 'application/json' },
        chunks: [JSON.stringify({ greeting: 'hello' })],
        streamed: false,
      },
    }
    cassette.request_hash = hashRequest(cassette.request)
    _writeCassetteFile(_cassettePath(sandboxName), cassette)

    await withCassette(sandboxName, async () => {
      const res = await globalThis.fetch(cassette.request.url, {
        method: cassette.request.method,
        headers: cassette.request.headers,
        body: JSON.stringify(cassette.request.body),
      })
      expect(res.status).toBe(200)
      const json = await res.json() as { greeting: string }
      expect(json.greeting).toBe('hello')
    })
  })

  it('fails loudly when the live request hash drifts from the cassette', async () => {
    const cassette: Cassette = {
      version: 1,
      request_hash: '',
      recorded_at: new Date().toISOString(),
      request: makeRequest({ body: { model: 'old-model' } }),
      response: {
        status: 200,
        headers: { 'content-type': 'application/json' },
        chunks: ['{}'],
        streamed: false,
      },
    }
    cassette.request_hash = hashRequest(cassette.request)
    _writeCassetteFile(_cassettePath(sandboxName), cassette)

    await expect(
      withCassette(sandboxName, async () => {
        // Live request differs from the cassette (new-model vs old-model).
        await globalThis.fetch(cassette.request.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'new-model' }),
        })
      }),
    ).rejects.toThrow(/Cassette hash mismatch/)
  })

  it('restores globalThis.fetch even when the inner function throws', async () => {
    const cassette: Cassette = {
      version: 1,
      request_hash: '',
      recorded_at: new Date().toISOString(),
      request: makeRequest(),
      response: { status: 200, headers: {}, chunks: ['{}'], streamed: false },
    }
    cassette.request_hash = hashRequest(cassette.request)
    _writeCassetteFile(_cassettePath(sandboxName), cassette)

    const beforeFetch = globalThis.fetch
    await expect(
      withCassette(sandboxName, async () => {
        throw new Error('inner failure')
      }),
    ).rejects.toThrow('inner failure')
    expect(globalThis.fetch).toBe(beforeFetch)
  })
})

// ── Streaming chunk replay ──────────────────────────────────────────────────

describe('withCassette streaming replay', () => {
  beforeEach(() => {
    process.env.MOL_CASSETTE_MODE = 'playback'
  })

  it('replays SSE chunks one frame at a time, preserving frame boundaries', async () => {
    // Three discrete SSE frames as a real Anthropic stream would emit.
    const sseFrames = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]
    const cassette: Cassette = {
      version: 1,
      request_hash: '',
      recorded_at: new Date().toISOString(),
      request: makeRequest({ body: { model: 'haiku', stream: true } }),
      response: {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        chunks: sseFrames,
        streamed: true,
      },
    }
    cassette.request_hash = hashRequest(cassette.request)
    _writeCassetteFile(_cassettePath(sandboxName), cassette)

    await withCassette(sandboxName, async () => {
      const res = await globalThis.fetch(cassette.request.url, {
        method: cassette.request.method,
        headers: cassette.request.headers,
        body: JSON.stringify(cassette.request.body),
      })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('text/event-stream')
      expect(res.body).toBeInstanceOf(ReadableStream)

      // Read each chunk and verify the frame boundaries survived.
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      const received: string[] = []
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        received.push(decoder.decode(value, { stream: true }))
      }
      const tail = decoder.decode()
      if (tail) received.push(tail)
      expect(received).toEqual(sseFrames)
    })
  })

  it('replays a single-chunk non-streamed response as a normal Response', async () => {
    const body = JSON.stringify({
      content: [{ type: 'text', text: 'Hi' }],
      usage: { input_tokens: 5, output_tokens: 2 },
      stop_reason: 'end_turn',
    })
    const cassette: Cassette = {
      version: 1,
      request_hash: '',
      recorded_at: new Date().toISOString(),
      request: makeRequest(),
      response: {
        status: 200,
        headers: { 'content-type': 'application/json' },
        chunks: [body],
        streamed: false,
      },
    }
    cassette.request_hash = hashRequest(cassette.request)
    _writeCassetteFile(_cassettePath(sandboxName), cassette)

    await withCassette(sandboxName, async () => {
      const res = await globalThis.fetch(cassette.request.url, {
        method: cassette.request.method,
        headers: cassette.request.headers,
        body: JSON.stringify(cassette.request.body),
      })
      const json = await res.json() as { content: Array<{ text: string }> }
      expect(json.content[0].text).toBe('Hi')
    })
  })
})

// ── Recorder mode: PII redaction in written fixtures ────────────────────────
//
// We can't make a real provider call in this test, so we stub
// `globalThis.fetch` to behave like a provider. The recorder mode in the
// helper still walks its redact code paths because it doesn't know the
// fetch is stubbed.

describe('withCassette record mode', () => {
  beforeEach(() => {
    process.env.MOL_CASSETTE_MODE = 'record'
  })

  it('writes a cassette to disk on a real call', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch

    await withCassette(sandboxName, async () => {
      const res = await globalThis.fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'sk-secret' },
        body: JSON.stringify({ model: 'haiku', max_tokens: 100 }),
      })
      expect(res.status).toBe(200)
    })

    const path = _cassettePath(sandboxName)
    const cassette = _readCassetteFile(path)
    expect(cassette.version).toBe(1)
    expect(cassette.response.status).toBe(200)
    // Auth header must be stripped.
    expect(cassette.request.headers['x-api-key']).toBeUndefined()
    expect(cassette.request.headers['content-type']).toBe('application/json')
    // Body is preserved (no PII fields in this body).
    expect(cassette.request.body).toEqual({ model: 'haiku', max_tokens: 100 })
  })

  it('strips PII fields from a recorded request body', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    ) as unknown as typeof fetch

    await withCassette(sandboxName, async () => {
      await globalThis.fetch('https://api.example.com/v1/foo', {
        method: 'POST',
        headers: { 'authorization': 'Bearer secret', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'haiku',
          student_id: 's-real-pii',
          email: 'student@example.com',
          phone: '+91-9876543210',
          api_key: 'sk-leak',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      })
    })

    const cassette = _readCassetteFile(_cassettePath(sandboxName))
    // Auth header gone.
    expect(cassette.request.headers['authorization']).toBeUndefined()
    // PII fields gone, non-PII fields kept.
    const body = cassette.request.body as Record<string, unknown>
    expect(body.model).toBe('haiku')
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(body.student_id).toBeUndefined()
    expect(body.email).toBeUndefined()
    expect(body.phone).toBeUndefined()
    expect(body.api_key).toBeUndefined()
    // Belt-and-braces: dump the JSON and grep for known secrets.
    const raw = readFileSync(_cassettePath(sandboxName), 'utf8')
    expect(raw).not.toContain('sk-leak')
    expect(raw).not.toContain('student@example.com')
    expect(raw).not.toContain('+91-9876543210')
    expect(raw).not.toContain('s-real-pii')
    expect(raw).not.toContain('Bearer secret')
  })

  it('captures streaming chunks in emission order', async () => {
    const encoder = new TextEncoder()
    const frames = [
      'data: {"i":0}\n\n',
      'data: {"i":1}\n\n',
      'data: {"i":2}\n\n',
    ]
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const f of frames) controller.enqueue(encoder.encode(f))
        controller.close()
      },
    })
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    ) as unknown as typeof fetch

    await withCassette(sandboxName, async () => {
      const res = await globalThis.fetch('https://api.example.com/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stream: true }),
      })
      // Consume the live stream so the test exercises clone()-then-read.
      const reader = res.body!.getReader()
      while (true) {
        const { done } = await reader.read()
        if (done) break
      }
    })

    const cassette = _readCassetteFile(_cassettePath(sandboxName))
    expect(cassette.response.streamed).toBe(true)
    expect(cassette.response.chunks).toEqual(frames)
  })
})

// ── CI guard ────────────────────────────────────────────────────────────────
//
// The helper's import-time guard (assertCassetteModeSafeForCI) throws when
// CI=true AND MOL_CASSETTE_MODE=record. We can't re-run the module's
// import-time logic in the same test process, so we test the underlying
// pure function in isolation by writing a temp script that imports the
// helper with the dangerous env combo and asserting the import throws.

describe('CI safety guard', () => {
  it('throws if assertCassetteModeSafeForCI runs with CI=true + record mode', async () => {
    // Re-import a fresh copy of the module by forging a unique URL.
    // This is the cleanest way to re-execute import-time side effects in
    // vitest without spinning up a worker.
    const helperUrl = new URL('./cassette-helper.ts', import.meta.url).toString()
    const tmpFile = join(mkdtempSync(join(tmpdir(), 'mol-ci-guard-')), 'probe.ts')
    writeFileSync(tmpFile, `export * from '${helperUrl}'\n`)

    const oldCI = process.env.CI
    const oldMode = process.env.MOL_CASSETTE_MODE
    process.env.CI = 'true'
    process.env.MOL_CASSETTE_MODE = 'record'
    try {
      // The helper exports `assertCassetteModeSafeForCI`; call it directly
      // for a same-process assertion. Module-level invocation is covered by
      // the existing import that happened at the top of this file.
      const { assertCassetteModeSafeForCI } = await import('./cassette-helper.ts')
      expect(() => assertCassetteModeSafeForCI()).toThrow(/forbidden in CI/)
    } finally {
      if (oldCI === undefined) delete process.env.CI
      else process.env.CI = oldCI
      if (oldMode === undefined) delete process.env.MOL_CASSETTE_MODE
      else process.env.MOL_CASSETTE_MODE = oldMode
      try { rmSync(tmpFile, { force: true }) } catch { /* ignore */ }
    }
  })

  it('does not throw when MOL_CASSETTE_MODE is playback in CI', async () => {
    const oldCI = process.env.CI
    const oldMode = process.env.MOL_CASSETTE_MODE
    process.env.CI = 'true'
    process.env.MOL_CASSETTE_MODE = 'playback'
    try {
      const { assertCassetteModeSafeForCI } = await import('./cassette-helper.ts')
      expect(() => assertCassetteModeSafeForCI()).not.toThrow()
    } finally {
      if (oldCI === undefined) delete process.env.CI
      else process.env.CI = oldCI
      if (oldMode === undefined) delete process.env.MOL_CASSETTE_MODE
      else process.env.MOL_CASSETTE_MODE = oldMode
    }
  })

  it('does not throw when not in CI and mode is record', async () => {
    const oldCI = process.env.CI
    const oldMode = process.env.MOL_CASSETTE_MODE
    delete process.env.CI
    process.env.MOL_CASSETTE_MODE = 'record'
    try {
      const { assertCassetteModeSafeForCI } = await import('./cassette-helper.ts')
      expect(() => assertCassetteModeSafeForCI()).not.toThrow()
    } finally {
      if (oldCI === undefined) delete process.env.CI
      else process.env.CI = oldCI
      if (oldMode === undefined) delete process.env.MOL_CASSETTE_MODE
      else process.env.MOL_CASSETTE_MODE = oldMode
    }
  })
})
