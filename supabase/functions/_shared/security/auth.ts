import { constantTimeEqual } from '../auth.ts';
import { buildCanonicalInternalRequest, verifyInternalRequestSignature } from './request-signature.ts';
import type { SecurityPrincipal } from './types.ts';

type SupabaseClientLike = {
  auth: { getUser(token: string): Promise<{ data: { user: { id: string } | null }; error: unknown }> };
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
};

function projectRefFromUrl(): string | null {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const match = url.match(/https:\/\/([^.]+)\.supabase\.co/);
  return match?.[1] ?? null;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

/** Accept legacy JWT service_role keys during Supabase API-key migration. */
function isLegacyServiceRoleJwtForProject(token: string): boolean {
  if (!token.startsWith('eyJ')) return false;
  const payload = decodeJwtPayload(token);
  if (!payload || payload.role !== 'service_role') return false;
  const ref = projectRefFromUrl();
  return ref != null && payload.ref === ref;
}

function collectServiceAuthTokens(): string[] {
  const tokens: string[] = [];
  const primary = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (primary) tokens.push(primary);
  try {
    const raw = Deno.env.get('SUPABASE_SECRET_KEYS') ?? '';
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const value of Object.values(parsed)) {
        if (typeof value === 'string' && value) tokens.push(value);
      }
    }
  } catch {
    // Ignore malformed secret-key JSON; fall back to primary + legacy JWT path.
  }
  return tokens;
}

/**
 * True when Authorization carries an elevated service token our internal
 * callers use: the edge env service key, any configured sb_secret_* key, or a
 * legacy service_role JWT for this project. Signature headers are still
 * required before admitting as internal_service.
 */
function checkServiceBearerToken(authHeader: string | null): boolean {
  if (!authHeader?.startsWith('Bearer ')) return false;
  const token = authHeader.slice('Bearer '.length);
  if (collectServiceAuthTokens().some((candidate) => constantTimeEqual(token, candidate))) {
    return true;
  }
  return isLegacyServiceRoleJwtForProject(token);
}

function normalizeRole(raw: string | null | undefined): SecurityPrincipal['role'] | null {
  switch (raw) {
    case 'student':
    case 'parent':
    case 'teacher':
    case 'school_admin':
    case 'internal_service':
      return raw;
    default:
      return null;
  }
}

export async function resolveSecurityPrincipal(args: {
  req: Request;
  sb: SupabaseClientLike;
  _route: string;
  requestId: string;
  bodyHash: string;
  requestBodyCaller: string;
}): Promise<{ ok: true; principal: SecurityPrincipal } | { ok: false; status: number; code: string; message: string }> {
  const authHeader = args.req.headers.get('authorization');
  const timestamp = args.req.headers.get('x-internal-timestamp');
  const signature = args.req.headers.get('x-internal-signature');
  const callerHeader = args.req.headers.get('x-internal-caller') ?? args.requestBodyCaller;

  if (!authHeader) {
    return { ok: false, status: 401, code: 'deny_auth', message: 'missing authorization header' };
  }

  if (checkServiceBearerToken(authHeader)) {
    if (!timestamp || !signature) {
      return { ok: false, status: 401, code: 'deny_signature', message: 'missing internal caller signature' };
    }
    const skewMs = Math.abs(Date.now() - Number(timestamp) * 1000);
    if (!Number.isFinite(Number(timestamp)) || skewMs > 300_000) {
      return { ok: false, status: 401, code: 'deny_signature', message: 'stale internal request timestamp' };
    }
    const signingSecret = Deno.env.get('INTERNAL_CALLER_SIGNING_SECRET') ?? '';
    if (!signingSecret) {
      return { ok: false, status: 500, code: 'deny_signature', message: 'internal caller signing secret not configured' };
    }
    const callerRes = await args.sb.rpc('security_resolve_internal_caller', {
      p_caller_name: callerHeader,
    });
    if (callerRes.error || !callerRes.data || typeof callerRes.data !== 'object' || (callerRes.data as Record<string, unknown>).found !== true) {
      return { ok: false, status: 403, code: 'deny_auth', message: 'unregistered internal caller' };
    }
    const caller = callerRes.data as Record<string, unknown>;
    if (String(caller.status ?? '') !== 'active') {
      return { ok: false, status: 403, code: 'deny_auth', message: 'internal caller not active' };
    }
    const canonical = buildCanonicalInternalRequest({
      method: args.req.method,
      path: new URL(args.req.url).pathname,
      requestId: args.requestId,
      timestamp,
      bodyHash: args.bodyHash,
      caller: callerHeader,
    });
    const ok = await verifyInternalRequestSignature(signingSecret, canonical, signature);
    if (!ok) {
      return { ok: false, status: 401, code: 'deny_signature', message: 'invalid internal caller signature' };
    }
    return {
      ok: true,
      principal: {
        callerType: 'internal_service',
        userId: null,
        schoolId: null,
        role: 'internal_service',
        serviceName: callerHeader,
        cronJob: String(caller.caller_kind ?? '') === 'cron_job' ? callerHeader : null,
        internalWorker: String(caller.caller_kind ?? '') === 'internal_worker' ? callerHeader : null,
        internalCallerId: String(caller.id ?? ''),
        internalCallerName: String(caller.name ?? callerHeader),
        internalCallerKind: normalizeCallerKind(String(caller.caller_kind ?? '')),
      },
    };
  }

  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  const { data: authData, error: authError } = await args.sb.auth.getUser(jwt);
  if (authError || !authData.user) {
    return { ok: false, status: 401, code: 'deny_auth', message: 'invalid jwt' };
  }

  const ctx = await args.sb.rpc('security_resolve_user_context', {
    p_auth_user_id: authData.user.id,
  });
  if (ctx.error || !ctx.data || typeof ctx.data !== 'object') {
    return { ok: false, status: 403, code: 'deny_auth', message: 'failed to resolve user context' };
  }

  const resolved = ctx.data as Record<string, unknown>;
  const role = normalizeRole(String(resolved.role ?? ''));
  if (!role) {
    return { ok: false, status: 403, code: 'deny_auth', message: 'user has no active platform role' };
  }

  return {
    ok: true,
    principal: {
      callerType: 'authenticated',
      userId: authData.user.id,
      schoolId: resolved.school_id ? String(resolved.school_id) : null,
      role,
      serviceName: args.requestBodyCaller,
      cronJob: null,
      internalWorker: null,
      internalCallerId: null,
      internalCallerName: null,
      internalCallerKind: null,
    },
  };
}

function normalizeCallerKind(value: string): SecurityPrincipal['internalCallerKind'] {
  if (value === 'service_name' || value === 'cron_job' || value === 'internal_worker') return value;
  return null;
}
