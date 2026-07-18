// Ops note (2026-07-13): get_cron_secret() was rotated in-database the same
// day the DB-fallback below shipped; pg_cron jobs read the identical value
// from vault ('cron_secret'). Rotate BOTH together — see the runbook entry in
// docs/runbooks/edge-function-drift-report.md execution log.
import { checkBearerToken, constantTimeEqual } from '../auth.ts'
import { buildCanonicalInternalRequest, sha256Hex, verifyInternalRequestSignature } from './request-signature.ts'
import { writeSecurityAudit } from './audit.ts'

type SupabaseClientLike = {
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>
}

export type InternalCronAuthResult =
  | { ok: true; callerName: string; authMethod: 'signed_internal' | 'cron_secret'; internalCallerId: string | null }
  | { ok: false; status: number; code: string; message: string }

export async function verifyInternalCronRequest(args: {
  req: Request
  route: string
  sb?: SupabaseClientLike | null
  requestId?: string
  bodyText?: string
  nowMs?: number
  cronSecret?: string
  serviceRoleKey?: string
  signingSecret?: string
}): Promise<InternalCronAuthResult> {
  const cronSecret = args.cronSecret ?? Deno.env.get('CRON_SECRET') ?? ''
  const providedCron = args.req.headers.get('x-cron-secret') ?? ''
  if (cronSecret && providedCron && constantTimeEqual(providedCron, cronSecret)) {
    return { ok: true, callerName: args.route, authMethod: 'cron_secret', internalCallerId: null }
  }

  // get_cron_secret() DB RPC fallback — implements the contract already
  // documented (daily-cron header + contract.test.ts §1 comment) but never
  // wired: pg_cron jobs authenticate with the DB-held secret (readable
  // in-database only; service-role EXECUTE), which rotates independently of
  // the CRON_SECRET env var. 2026-07-09 incident: the env var rotated,
  // pg_cron was left with no valid credential path, and synthetic-host-monitor
  // 401'd on every tick for 17 days. Fail-closed: RPC error, non-string, or
  // mismatch falls through to the bearer/signed-internal path (which rejects
  // unsigned callers), never opens access.
  if (providedCron && args.sb) {
    try {
      const rpcRes = await args.sb.rpc('get_cron_secret')
      const dbSecret = typeof rpcRes.data === 'string' ? rpcRes.data : ''
      if (!rpcRes.error && dbSecret && constantTimeEqual(providedCron, dbSecret)) {
        return { ok: true, callerName: args.route, authMethod: 'cron_secret', internalCallerId: null }
      }
    } catch {
      // fall through to bearer/signed-internal path
    }
  }

  const serviceRoleKey = args.serviceRoleKey ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!checkBearerToken(args.req.headers.get('authorization'), serviceRoleKey)) {
    return { ok: false, status: 401, code: 'deny_auth', message: 'missing valid internal caller signature or CRON_SECRET' }
  }

  const timestamp = args.req.headers.get('x-internal-timestamp')
  const signature = args.req.headers.get('x-internal-signature')
  const callerName = args.req.headers.get('x-internal-caller') ?? args.route
  const requestId = args.requestId ?? args.req.headers.get('x-request-id') ?? crypto.randomUUID()
  if (!timestamp || !signature) {
    return { ok: false, status: 401, code: 'deny_signature', message: 'missing internal caller signature' }
  }
  const timestampSeconds = Number(timestamp)
  const skewMs = Math.abs((args.nowMs ?? Date.now()) - timestampSeconds * 1000)
  if (!Number.isFinite(timestampSeconds) || skewMs > 300_000) {
    return { ok: false, status: 401, code: 'deny_signature', message: 'stale internal request timestamp' }
  }
  const signingSecret = args.signingSecret ?? Deno.env.get('INTERNAL_CALLER_SIGNING_SECRET') ?? ''
  if (!signingSecret) {
    return { ok: false, status: 500, code: 'deny_signature', message: 'internal caller signing secret not configured' }
  }

  let internalCallerId: string | null = null
  if (args.sb) {
    const callerRes = await args.sb.rpc('security_resolve_internal_caller', { p_caller_name: callerName })
    if (callerRes.error || !callerRes.data || typeof callerRes.data !== 'object' || (callerRes.data as Record<string, unknown>).found !== true) {
      return { ok: false, status: 403, code: 'deny_auth', message: 'unregistered internal caller' }
    }
    const caller = callerRes.data as Record<string, unknown>
    if (String(caller.status ?? '') !== 'active') {
      return { ok: false, status: 403, code: 'deny_auth', message: 'internal caller not active' }
    }
    internalCallerId = String(caller.id ?? '') || null
    const policyRes = await args.sb.rpc('security_resolve_route_policy', {
      p_route: args.route,
      p_school_id: null,
      p_role: 'internal_service',
      p_caller_type: 'internal_service',
      p_internal_caller_id: internalCallerId,
    })
    if (policyRes.error || !policyRes.data || typeof policyRes.data !== 'object' || (policyRes.data as Record<string, unknown>).found !== true) {
      return { ok: false, status: 403, code: 'deny_policy', message: 'no enabled internal route policy' }
    }
    const policy = policyRes.data as Record<string, unknown>
    if (policy.allow_signed_internal !== true || policy.allow_service_role !== true) {
      return { ok: false, status: 403, code: 'deny_policy', message: 'internal route policy does not allow signed service-role callers' }
    }
  }

  const bodyHash = await sha256Hex(args.bodyText ?? '')
  const canonical = buildCanonicalInternalRequest({
    method: args.req.method,
    // Deployed edge functions have the `/functions/v1` prefix stripped by the
    // platform; buildCanonicalInternalRequest canonicalizes to the bare
    // function path so signer and verifier converge (masked today because crons
    // take the cron-secret short-circuit above, but fixed for correctness).
    path: new URL(args.req.url).pathname,
    requestId,
    timestamp,
    bodyHash,
    caller: callerName,
  })
  const ok = await verifyInternalRequestSignature(signingSecret, canonical, signature)
  if (!ok) {
    return { ok: false, status: 401, code: 'deny_signature', message: 'invalid internal caller signature' }
  }
  return { ok: true, callerName, authMethod: 'signed_internal', internalCallerId }
}

export async function auditInternalCronInvocation(args: {
  sb: SupabaseClientLike | null
  route: string
  requestId: string
  started: number
  auth: InternalCronAuthResult
  statusCode: number
  errorCode?: string | null
}): Promise<void> {
  if (!args.sb) return
  try {
    await writeSecurityAudit(args.sb, {
      requestId: args.requestId,
      route: args.route,
      schoolId: null,
      userId: null,
      role: 'internal_service',
      callerType: 'internal_service',
      serviceName: args.auth.ok ? args.auth.callerName : args.route,
      cronJob: args.route,
      internalWorker: null,
      internalCallerId: args.auth.ok ? args.auth.internalCallerId : null,
      quotaDecision: args.auth.ok ? `allow_${args.auth.authMethod}` : args.auth.code,
      latencyMs: Math.round(performance.now() - args.started),
      statusCode: args.statusCode,
      enforcementMode: 'enforce',
      breakerState: 'closed',
      errorCode: args.errorCode ?? (args.auth.ok ? null : args.auth.code),
    })
  } catch (err) {
    console.error(`[${args.route}] security audit write failed: ${String(err instanceof Error ? err.message : err)}`)
  }
}

export function internalCronUnauthorizedResponse(auth: InternalCronAuthResult, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify({ error: 'Unauthorized', code: auth.ok ? 'deny_auth' : auth.code }), {
    status: auth.ok ? 401 : auth.status,
    headers: { ...headers, 'content-type': 'application/json' },
  })
}
