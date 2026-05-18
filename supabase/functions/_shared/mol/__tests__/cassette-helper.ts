// supabase/functions/_shared/mol/__tests__/cassette-helper.ts
//
// Cassette infrastructure for MOL provider tests (Phase C1 prereq).
//
// Why this exists
// ---------------
// MOL has two HTTP providers (Anthropic, OpenAI) and we want to write
// provider-level tests against *real* response shapes without burning tokens
// on every CI run. The pattern is "record once, replay forever":
//
//   1. Engineer sets MOL_CASSETTE_MODE=record locally, runs a test once.
//      The helper intercepts fetch, makes the real call, redacts the
//      request, writes a JSON cassette to disk, then returns the live
//      response so the test can assert on it.
//   2. CI runs with MOL_CASSETTE_MODE=playback (the default). The helper
//      reads the cassette by deterministic request hash and returns a
//      synthesized Response — no network, no tokens, no flakiness.
//
// This file is Node-only. It uses node:fs, node:crypto, node:path. It must
// NEVER be imported from Edge Function runtime code (providers/anthropic.ts,
// providers/openai.ts, etc.). It lives under __tests__/ so Deno bundling
// skips it.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ── Mode handling ───────────────────────────────────────────────────────────

export type CassetteMode = 'record' | 'playback'

export function getCassetteMode(): CassetteMode {
  const raw = process.env.MOL_CASSETTE_MODE
  if (raw === 'record') return 'record'
  return 'playback'
}

/** True when the harness is running inside CI and must never make real calls. */
function isCI(): boolean {
  // GitHub Actions, Vercel, generic CI all set this.
  return process.env.CI === 'true' || process.env.CI === '1'
}

/**
 * Guard called at module init. Refuses to let CI burn provider tokens by
 * running in record mode. Throws synchronously so the test run aborts before
 * a single byte hits an external API.
 */
export function assertCassetteModeSafeForCI(): void {
  if (isCI() && getCassetteMode() === 'record') {
    throw new Error(
      'MOL_CASSETTE_MODE=record is forbidden in CI. ' +
      'Record cassettes locally, commit them, then run CI in playback mode.',
    )
  }
}

// Run the guard at import time so we fail fast.
assertCassetteModeSafeForCI()

// ── Paths ───────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/** Absolute path to the cassettes/ directory next to this file. */
export const CASSETTES_DIR = resolve(__dirname, 'cassettes')

// ── Cassette format ─────────────────────────────────────────────────────────

/**
 * One recorded HTTP exchange. The on-disk JSON schema is intentionally flat
 * and explicit — future maintainers can read a cassette without consulting
 * this file.
 *
 * Streaming responses store the body as a sequence of decoded UTF-8 chunks,
 * preserving the chunk boundaries the provider actually emitted (so SSE
 * frame splits on `\n\n` survive). For non-streaming responses, `chunks`
 * has exactly one element.
 */
export interface CassetteRequest {
  /** HTTP method, uppercase. */
  method: string
  /** Full request URL. */
  url: string
  /** Headers minus auth (Authorization, x-api-key stripped). */
  headers: Record<string, string>
  /**
   * Request body. Parsed JSON if the original body was JSON; otherwise a
   * string. PII redaction has already been applied.
   */
  body: unknown
}

export interface CassetteResponse {
  status: number
  /** Response headers. */
  headers: Record<string, string>
  /** Decoded body chunks in emission order. Single-element for non-streamed. */
  chunks: string[]
  /** True if the response was an SSE / chunked stream. */
  streamed: boolean
}

export interface Cassette {
  /** Schema version. Bumped if the on-disk shape ever changes. */
  version: 1
  /**
   * SHA-256 hex digest of the canonicalised request. Stored so cassette
   * files are self-verifying — playback recomputes the hash from the live
   * request and asserts equality.
   */
  request_hash: string
  /** When the cassette was recorded. ISO 8601 UTC. */
  recorded_at: string
  request: CassetteRequest
  response: CassetteResponse
}

// ── Header / body redaction ─────────────────────────────────────────────────

/**
 * Headers that contain authentication or session secrets. Stripped before
 * write so no key material ever lands on disk.
 */
const AUTH_HEADERS = new Set([
  'authorization',
  'x-api-key',
  'anthropic-api-key',
  'cookie',
  'set-cookie',
  'proxy-authorization',
])

/**
 * Body fields that contain PII or credentials. Removed recursively. Case-
 * insensitive match on the *key*, not the value.
 */
const PII_BODY_FIELDS = new Set([
  'token',
  'access_token',
  'refresh_token',
  'api_key',
  'apikey',
  'password',
  'email',
  'phone',
  'phone_number',
  'student_id',
])

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (AUTH_HEADERS.has(k.toLowerCase())) continue
    out[k] = v
  }
  return out
}

/**
 * Recursively strip PII fields from a JSON body. Returns a new object —
 * never mutates the input.
 */
export function redactBody(body: unknown): unknown {
  if (body === null || body === undefined) return body
  if (typeof body !== 'object') return body
  if (Array.isArray(body)) {
    return body.map((item) => redactBody(item))
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (PII_BODY_FIELDS.has(k.toLowerCase())) continue
    out[k] = redactBody(v)
  }
  return out
}

// ── Request hashing ─────────────────────────────────────────────────────────

/**
 * Canonicalise a request for hashing. Order-independent on header keys.
 *
 * Hash inputs (after redaction):
 *   - HTTP method (uppercase)
 *   - URL (verbatim)
 *   - Headers as sorted-key JSON
 *   - Body as JSON.stringify(body) — relies on the original body being
 *     deterministic. JSON.stringify is NOT key-order-canonical, but provider
 *     code builds bodies with stable key order, so this is good enough.
 */
export function hashRequest(req: CassetteRequest): string {
  const sortedHeaders = Object.fromEntries(
    Object.entries(req.headers).sort(([a], [b]) => a.localeCompare(b)),
  )
  const canonical = JSON.stringify({
    method: req.method.toUpperCase(),
    url: req.url,
    headers: sortedHeaders,
    body: req.body,
  })
  return createHash('sha256').update(canonical).digest('hex')
}

// ── Filesystem helpers ──────────────────────────────────────────────────────

function cassettePath(fixturePath: string): string {
  // Allow callers to pass a bare name like 'anthropic-explain-photosynthesis'
  // or an absolute / relative path. Normalise to an absolute path under
  // CASSETTES_DIR with a `.json` extension.
  if (fixturePath.endsWith('.json')) {
    return resolve(CASSETTES_DIR, fixturePath)
  }
  return resolve(CASSETTES_DIR, `${fixturePath}.json`)
}

function ensureDir(path: string): void {
  const dir = dirname(path)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function readCassetteFile(path: string): Cassette {
  if (!existsSync(path)) {
    throw new Error(
      `Cassette not found at ${path}. ` +
      `Run with MOL_CASSETTE_MODE=record to create it (locally only — never in CI).`,
    )
  }
  const raw = readFileSync(path, 'utf8')
  const parsed = JSON.parse(raw) as Cassette
  if (parsed.version !== 1) {
    throw new Error(`Cassette ${path} has unknown version ${parsed.version}`)
  }
  return parsed
}

function writeCassetteFile(path: string, cassette: Cassette): void {
  ensureDir(path)
  writeFileSync(path, JSON.stringify(cassette, null, 2) + '\n', 'utf8')
}

// ── Capturing a live fetch ──────────────────────────────────────────────────

/**
 * Convert an outbound `fetch` RequestInfo + RequestInit pair into a
 * normalised CassetteRequest with auth + PII stripped.
 */
async function buildCassetteRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<CassetteRequest> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()

  const rawHeaders: Record<string, string> = {}
  const headersInit = init?.headers ?? (input instanceof Request ? input.headers : undefined)
  if (headersInit) {
    if (headersInit instanceof Headers) {
      headersInit.forEach((v, k) => { rawHeaders[k] = v })
    } else if (Array.isArray(headersInit)) {
      for (const [k, v] of headersInit) rawHeaders[k] = v
    } else {
      Object.assign(rawHeaders, headersInit)
    }
  }

  // Body: read either init.body or the Request's body.
  let bodyStr: string | null = null
  if (init?.body !== undefined && init.body !== null) {
    if (typeof init.body === 'string') bodyStr = init.body
    else bodyStr = String(init.body) // ArrayBuffer / Blob / etc. — unsupported; stringify defensively
  } else if (input instanceof Request) {
    bodyStr = await input.clone().text()
  }

  let parsedBody: unknown = bodyStr
  if (bodyStr && bodyStr.length > 0) {
    try {
      parsedBody = JSON.parse(bodyStr)
    } catch {
      // Non-JSON body — keep as string.
      parsedBody = bodyStr
    }
  }

  return {
    method,
    url,
    headers: redactHeaders(rawHeaders),
    body: redactBody(parsedBody),
  }
}

/**
 * Read a Response into a recordable shape, preserving streaming chunks.
 *
 * For non-streamed responses we still pass through the streaming code path
 * (it produces a single-chunk array). For SSE responses, we read the
 * reader's chunks one at a time so we can replay the exact boundaries the
 * provider emitted.
 */
async function captureResponse(res: Response): Promise<CassetteResponse> {
  const headers: Record<string, string> = {}
  res.headers.forEach((v, k) => { headers[k] = v })

  const contentType = res.headers.get('content-type') || ''
  const streamed = contentType.includes('text/event-stream')

  const chunks: string[] = []
  if (res.body && streamed) {
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (value && value.byteLength > 0) {
        chunks.push(decoder.decode(value, { stream: true }))
      }
    }
    // Flush any decoder remainder.
    const tail = decoder.decode()
    if (tail.length > 0) chunks.push(tail)
  } else {
    chunks.push(await res.text())
  }

  return { status: res.status, headers, chunks, streamed }
}

// ── Building a synthetic Response from a cassette ───────────────────────────

/**
 * Build a Web `Response` that mimics a streamed SSE body by re-emitting the
 * recorded chunks in order. Each chunk becomes one ReadableStream enqueue.
 */
function makeStreamedResponse(cassette: Cassette): Response {
  const encoder = new TextEncoder()
  const chunks = cassette.response.chunks
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
  return new Response(stream, {
    status: cassette.response.status,
    headers: cassette.response.headers,
  })
}

function makeNonStreamedResponse(cassette: Cassette): Response {
  const body = cassette.response.chunks.join('')
  return new Response(body, {
    status: cassette.response.status,
    headers: cassette.response.headers,
  })
}

function responseFromCassette(cassette: Cassette): Response {
  return cassette.response.streamed
    ? makeStreamedResponse(cassette)
    : makeNonStreamedResponse(cassette)
}

// ── Public API: cassette fetch installer ────────────────────────────────────

/**
 * Bookkeeping context for one cassette session. Multiple intercepted
 * requests during a single test all read or write under one fixture path.
 *
 * In `playback` mode the fixture file is loaded once and reused — multiple
 * requests in the same test are expected to hash-match the same cassette
 * (typical case: one provider call per test).
 *
 * In `record` mode each intercepted request writes a fresh cassette,
 * keyed by request hash, under `cassettes/<fixturePath>/<hash>.json`.
 * Single-request tests collapse to just `cassettes/<fixturePath>.json`.
 */
interface SessionContext {
  fixturePath: string
  mode: CassetteMode
  /** Cassettes recorded during this session, indexed by request hash. */
  recorded: Map<string, Cassette>
  /** Cassette loaded from disk (single-fixture playback path). */
  loaded?: Cassette
}

/**
 * Install a `fetch` interceptor and run `fn` with cassette behaviour active.
 * Always restores the original `fetch` on the way out, even if `fn` throws.
 *
 * Callers must `await` `fn` — the helper does not detach `globalThis.fetch`
 * until the inner work has finished.
 */
export async function withCassette<T>(
  fixturePath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const mode = getCassetteMode()
  const originalFetch = globalThis.fetch

  const ctx: SessionContext = {
    fixturePath,
    mode,
    recorded: new Map(),
  }

  // Pre-load the cassette in playback mode so a missing file fails before
  // the test even makes its first call.
  if (mode === 'playback') {
    const path = cassettePath(fixturePath)
    ctx.loaded = readCassetteFile(path)
  }

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const liveRequest = await buildCassetteRequest(input, init)
    const hash = hashRequest(liveRequest)

    if (ctx.mode === 'playback') {
      // Single-fixture file path: cassette is already loaded. Verify the
      // hash matches so a drifted request fails loudly instead of silently
      // returning a stale fixture.
      const cassette = ctx.loaded!
      if (cassette.request_hash !== hash) {
        throw new Error(
          `Cassette hash mismatch for ${fixturePath}. ` +
          `Cassette was recorded against a different request — re-record with ` +
          `MOL_CASSETTE_MODE=record. Expected hash ${cassette.request_hash}, ` +
          `got ${hash}.`,
        )
      }
      return responseFromCassette(cassette)
    }

    // Record mode: real call, persist, return.
    const live = await originalFetch(input as RequestInfo, init)
    // Clone before reading so the test can still consume the body.
    const captured = await captureResponse(live.clone())
    const cassette: Cassette = {
      version: 1,
      request_hash: hash,
      recorded_at: new Date().toISOString(),
      request: liveRequest,
      response: captured,
    }
    ctx.recorded.set(hash, cassette)
    const path = cassettePath(fixturePath)
    writeCassetteFile(path, cassette)
    return live
  }) as typeof fetch

  try {
    return await fn()
  } finally {
    globalThis.fetch = originalFetch
  }
}

// ── Test-only helpers (exported for cassette-helper.test.ts) ────────────────

/** Test helper: synchronous read of a cassette file. */
export function _readCassetteFile(path: string): Cassette {
  return readCassetteFile(path)
}

/** Test helper: synchronous write of a cassette file. */
export function _writeCassetteFile(path: string, cassette: Cassette): void {
  writeCassetteFile(path, cassette)
}

/** Test helper: resolve a fixture name to its on-disk path. */
export function _cassettePath(fixturePath: string): string {
  return cassettePath(fixturePath)
}
