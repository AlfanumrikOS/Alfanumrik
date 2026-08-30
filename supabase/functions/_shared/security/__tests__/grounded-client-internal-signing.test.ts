// Roundtrip test for the P0-01 signing fix (commit 52f5388f, 2026-08-25):
// `buildInternalCallerHeaders` (grounded-client.ts, the Deno caller used by
// verify-question-bank and friends) must produce headers that
// `resolveSecurityPrincipal` (auth.ts, the grounded-answer entry point's
// validator) actually accepts — and must fail closed when the signing
// secret is absent, rather than emitting a request the validator is
// guaranteed to reject. Neither half was covered by an existing test before
// this file; see docs/audit/launch-readiness/20-remediation-packets.md
// Packet 1.

import { buildInternalCallerHeaders } from '../../grounded-client.ts'
import { resolveSecurityPrincipal } from '../auth.ts'
import { sha256Hex } from '../request-signature.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const SIGNING_SECRET = 'test-internal-caller-signing-secret'
const SERVICE_ROLE_KEY = 'test-service-role-key'
const PROJECT_REF = 'abcdefghijklmnop'
const SIGNING_PATH = '/functions/v1/grounded-answer'

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T | Promise<T>): Promise<T> {
  const prev: Record<string, string | undefined> = {}
  for (const key of Object.keys(vars)) prev[key] = Deno.env.get(key)
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) Deno.env.delete(key)
      else Deno.env.set(key, value)
    }
    return await fn()
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) Deno.env.delete(key)
      else Deno.env.set(key, value)
    }
  }
}

function sbAcceptingCaller(callerName: string) {
  return {
    auth: {
      async getUser() {
        throw new Error('not expected on the internal_service path')
      },
    },
    async rpc(name: string, args?: Record<string, unknown>) {
      if (name === 'security_resolve_internal_caller' && args?.p_caller_name === callerName) {
        return { data: { found: true, id: 'caller-id', status: 'active', caller_kind: 'internal_worker' }, error: null }
      }
      return { data: { found: false }, error: null }
    },
  }
}

Deno.test('buildInternalCallerHeaders returns null (fail closed) when the signing secret is unset', async () => {
  const headers = await withEnv({ INTERNAL_CALLER_SIGNING_SECRET: undefined }, () =>
    buildInternalCallerHeaders('POST', SIGNING_PATH, '{}', 'quiz-generator'),
  )
  assert(headers === null, 'expected null when INTERNAL_CALLER_SIGNING_SECRET is unset')
})

Deno.test('resolveSecurityPrincipal accepts headers produced by buildInternalCallerHeaders', async () => {
  await withEnv(
    {
      INTERNAL_CALLER_SIGNING_SECRET: SIGNING_SECRET,
      SUPABASE_URL: `https://${PROJECT_REF}.supabase.co`,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
    },
    async () => {
      const body = JSON.stringify({ caller: 'quiz-generator', query: 'irrelevant' })
      const headers = await buildInternalCallerHeaders('POST', SIGNING_PATH, body, 'quiz-generator')
      assert(headers !== null, 'expected headers to be built when the signing secret is set')

      const req = new Request(`https://example.test${SIGNING_PATH}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${SERVICE_ROLE_KEY}`, ...headers },
        body,
      })

      const result = await resolveSecurityPrincipal({
        req,
        sb: sbAcceptingCaller('quiz-generator'),
        _route: 'grounded-answer',
        requestId: headers['x-request-id'],
        bodyHash: await sha256Hex(body),
        requestBodyCaller: 'quiz-generator',
      })

      assert(result.ok, `expected acceptance, got: ${JSON.stringify(result)}`)
      if (result.ok) {
        assert(result.principal.role === 'internal_service', `expected internal_service role, got ${result.principal.role}`)
        assert(result.principal.serviceName === 'quiz-generator', `expected serviceName quiz-generator, got ${result.principal.serviceName}`)
      }
    },
  )
})

Deno.test('resolveSecurityPrincipal rejects a tampered signature from buildInternalCallerHeaders', async () => {
  await withEnv(
    {
      INTERNAL_CALLER_SIGNING_SECRET: SIGNING_SECRET,
      SUPABASE_URL: `https://${PROJECT_REF}.supabase.co`,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
    },
    async () => {
      const body = JSON.stringify({ caller: 'quiz-generator', query: 'irrelevant' })
      const headers = await buildInternalCallerHeaders('POST', SIGNING_PATH, body, 'quiz-generator')
      assert(headers !== null, 'expected headers to be built when the signing secret is set')

      const tampered: Record<string, string> = { ...headers, 'x-internal-signature': `${headers['x-internal-signature']}tampered` }
      const req = new Request(`https://example.test${SIGNING_PATH}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${SERVICE_ROLE_KEY}`, ...tampered },
        body,
      })

      const result = await resolveSecurityPrincipal({
        req,
        sb: sbAcceptingCaller('quiz-generator'),
        _route: 'grounded-answer',
        requestId: tampered['x-request-id'],
        bodyHash: await sha256Hex(body),
        requestBodyCaller: 'quiz-generator',
      })

      assert(!result.ok, 'expected rejection of a tampered signature')
      if (!result.ok) {
        assert(result.code === 'deny_signature', `expected deny_signature, got ${result.code}`)
      }
    },
  )
})
