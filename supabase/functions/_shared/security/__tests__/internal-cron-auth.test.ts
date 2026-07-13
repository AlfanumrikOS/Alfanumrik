import { buildCanonicalInternalRequest, sha256Hex, signInternalRequest } from '../request-signature.ts'
import { verifyInternalCronRequest } from '../internal-cron-auth.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const route = 'daily-cron'
const requestId = '00000000-0000-4000-8000-000000000001'
const signingSecret = 'test-signing-secret'
const serviceRoleKey = 'test-service-role-key'
const nowMs = 1_800_000_000_000
const timestamp = String(Math.floor(nowMs / 1000))

function sb() {
  return {
    async rpc(name: string, args?: Record<string, unknown>) {
      if (name === 'security_resolve_internal_caller' && args?.p_caller_name === route) {
        return { data: { found: true, id: 'caller-id', status: 'active', caller_kind: 'cron_job' }, error: null }
      }
      if (name === 'security_resolve_route_policy') {
        return { data: { found: true, allow_signed_internal: true, allow_service_role: true }, error: null }
      }
      return { data: { found: false }, error: null }
    },
  }
}

async function signedRequest(overrides: { timestamp?: string; signature?: string; caller?: string } = {}) {
  const ts = overrides.timestamp ?? timestamp
  const caller = overrides.caller ?? route
  const canonical = buildCanonicalInternalRequest({
    method: 'POST',
    path: `/functions/v1/${route}`,
    requestId,
    timestamp: ts,
    bodyHash: await sha256Hex(''),
    caller,
  })
  const signature = overrides.signature ?? await signInternalRequest(signingSecret, canonical)
  return new Request(`https://example.test/functions/v1/${route}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${serviceRoleKey}`,
      'x-request-id': requestId,
      'x-internal-caller': caller,
      'x-internal-timestamp': ts,
      'x-internal-signature': signature,
    },
  })
}

Deno.test('internal cron auth rejects unauthenticated requests', async () => {
  const req = new Request(`https://example.test/functions/v1/${route}`, { method: 'POST' })
  const result = await verifyInternalCronRequest({ req, route, sb: sb(), requestId, bodyText: '', nowMs, cronSecret: 'cron', serviceRoleKey, signingSecret })
  assert(!result.ok, 'expected rejection')
  assert(result.status === 401, `expected 401, got ${result.status}`)
})

Deno.test('internal cron auth rejects stale signatures', async () => {
  const req = await signedRequest({ timestamp: String(Math.floor((nowMs - 600_000) / 1000)) })
  const result = await verifyInternalCronRequest({ req, route, sb: sb(), requestId, bodyText: '', nowMs, cronSecret: '', serviceRoleKey, signingSecret })
  assert(!result.ok, 'expected rejection')
  assert(result.code === 'deny_signature', `expected deny_signature, got ${result.code}`)
})

Deno.test('internal cron auth rejects invalid signatures', async () => {
  const req = await signedRequest({ signature: 'invalid-signature' })
  const result = await verifyInternalCronRequest({ req, route, sb: sb(), requestId, bodyText: '', nowMs, cronSecret: '', serviceRoleKey, signingSecret })
  assert(!result.ok, 'expected rejection')
  assert(result.code === 'deny_signature', `expected deny_signature, got ${result.code}`)
})

Deno.test('internal cron auth accepts valid signatures', async () => {
  const req = await signedRequest()
  const result = await verifyInternalCronRequest({ req, route, sb: sb(), requestId, bodyText: '', nowMs, cronSecret: '', serviceRoleKey, signingSecret })
  assert(result.ok, 'expected success')
  assert(result.authMethod === 'signed_internal', `expected signed_internal, got ${result.authMethod}`)
})

Deno.test('internal cron auth accepts approved CRON_SECRET without service-role bearer', async () => {
  const req = new Request(`https://example.test/functions/v1/${route}`, { method: 'POST', headers: { 'x-cron-secret': 'cron' } })
  const result = await verifyInternalCronRequest({ req, route, sb: sb(), requestId, bodyText: '', nowMs, cronSecret: 'cron', serviceRoleKey, signingSecret })
  assert(result.ok, 'expected success')
  assert(result.authMethod === 'cron_secret', `expected cron_secret, got ${result.authMethod}`)
})

Deno.test('internal cron auth accepts the get_cron_secret() DB fallback when the env secret mismatches', async () => {
  const dbSb = {
    async rpc(name: string) {
      if (name === 'get_cron_secret') return { data: 'db-held-secret', error: null }
      return { data: { found: false }, error: null }
    },
  }
  const req = new Request(`https://example.test/functions/v1/${route}`, { method: 'POST', headers: { 'x-cron-secret': 'db-held-secret' } })
  const result = await verifyInternalCronRequest({ req, route, sb: dbSb, requestId, bodyText: '', nowMs, cronSecret: 'rotated-env-value', serviceRoleKey, signingSecret })
  assert(result.ok, 'expected success via DB fallback')
  assert(result.authMethod === 'cron_secret', `expected cron_secret, got ${result.authMethod}`)
})

Deno.test('internal cron auth stays fail-closed when the DB fallback errors or mismatches', async () => {
  const failingSb = {
    async rpc(name: string) {
      if (name === 'get_cron_secret') return { data: null, error: { message: 'permission denied' } }
      return { data: { found: false }, error: null }
    },
  }
  const req = new Request(`https://example.test/functions/v1/${route}`, { method: 'POST', headers: { 'x-cron-secret': 'wrong-secret' } })
  const result = await verifyInternalCronRequest({ req, route, sb: failingSb, requestId, bodyText: '', nowMs, cronSecret: 'env-value', serviceRoleKey, signingSecret })
  assert(!result.ok, 'expected rejection')
  assert(result.status === 401, `expected 401, got ${result.status}`)
})
