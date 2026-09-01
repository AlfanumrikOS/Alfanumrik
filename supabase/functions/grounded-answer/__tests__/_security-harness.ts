// supabase/functions/grounded-answer/__tests__/_security-harness.ts
//
// Hermetic admission credentials for the two suites that drive the real HTTP
// entry point (e2e.test.ts and pipeline.test.ts's handleRequest test).
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
// handleRequest admits every request through resolveSecurityPrincipal
// (_shared/security/auth.ts) BEFORE the pipeline runs. Those suites used to
// send a bare unauthenticated Request, so admission returned 401 and every
// assertion downstream of it (abstain reasons, citations, 500-on-throw) was
// never actually reached. They only looked green for a developer whose ambient
// shell happened to carry real service credentials. That non-hermeticity — not
// "the environment" — was the defect.
//
// ── WHAT THIS DELIBERATELY DOES *NOT* DO ────────────────────────────────────
// It does not bypass, stub, relax or shortcut admission, and it adds no
// test-only branch to index.ts or to the security module. It provisions REAL
// credentials and computes a REAL HMAC-SHA256 signature using the very same
// signInternalRequest() / buildCanonicalInternalRequest() pair the production
// verifier uses, over the very same canonical string. Every check in the
// internal_service branch of resolveSecurityPrincipal still executes for real:
//
//   1. Authorization must carry the configured service token
//      (constantTimeEqual against SUPABASE_SERVICE_ROLE_KEY);
//   2. x-internal-timestamp must be present, numeric, and inside the 300s skew;
//   3. INTERNAL_CALLER_SIGNING_SECRET must be configured;
//   4. the caller name must resolve to a REGISTERED and ACTIVE internal caller;
//   5. the signature must verify against the canonical request
//      (METHOD, path, request-id, timestamp, sha256(body), caller — newline
//      joined by buildCanonicalInternalRequest).
//
// The internal_service path is chosen over the JWT path on purpose: it is the
// production caller shape for this route (/api/foxy signs its calls with the
// Node twin in packages/lib/src/security/internal-caller-signing.ts), and it is
// the STRICTER of the two — it exercises real cryptography instead of a stubbed
// auth.getUser(). e2e.test.ts pins that the gate is still live with negative
// tests built from this same helper (missing Authorization -> 401 deny_auth;
// tampered signature -> 401 deny_signature; stale timestamp -> 401
// deny_signature), so a regression that started admitting unsigned traffic
// fails the suite instead of passing it.

import {
  buildCanonicalInternalRequest,
  sha256Hex,
  signInternalRequest,
} from '../../_shared/security/request-signature.ts';

/** Fake-but-real-shaped service token. Only ever lives in this test process. */
export const TEST_SERVICE_ROLE_KEY = 'test-service-role-key-grounded-answer';
/** Fake-but-real-shaped HMAC secret. Only ever lives in this test process. */
export const TEST_SIGNING_SECRET = 'test-internal-caller-signing-secret';
/** Registered internal caller name the stubbed RPC resolves as ACTIVE. */
export const TEST_INTERNAL_CALLER = 'foxy';
/** Internal-caller row id the stubbed RPC returns. */
export const TEST_INTERNAL_CALLER_ID = '00000000-0000-4000-8000-0000000000ca';

/**
 * Provision the two secrets resolveSecurityPrincipal reads from the process
 * env. Idempotent and cheap, so callers invoke it per-request rather than once
 * at module scope: model-rollout-flag.test.ts deletes SUPABASE_SERVICE_ROLE_KEY
 * in its own fixtures, and Deno runs every test file in ONE process.
 *
 * SUPABASE_URL is deliberately NOT set — nothing in these suites may construct
 * a real Supabase client (the stub is injected via __setSupabaseClientForTests)
 * and leaving it unset keeps that guaranteed.
 */
export function installSecurityEnv(): void {
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', TEST_SERVICE_ROLE_KEY);
  Deno.env.set('INTERNAL_CALLER_SIGNING_SECRET', TEST_SIGNING_SECRET);
}

export interface SignedRequestOptions {
  /** Defaults to a fresh uuid; echoed in x-request-id so it is signable. */
  requestId?: string;
  /** Epoch SECONDS. Defaults to now. */
  timestampSeconds?: number;
  /** Caller name sent in x-internal-caller. Defaults to TEST_INTERNAL_CALLER. */
  caller?: string;
  /** Signing secret. Override to forge an INVALID signature in negative tests. */
  signingSecret?: string;
  /** Bearer token. `null` omits the Authorization header entirely. */
  bearerToken?: string | null;
  /** Replace the computed signature verbatim (negative tests). */
  overrideSignature?: string;
  /** Drop the signature + timestamp headers entirely (negative tests). */
  omitSignature?: boolean;
}

/**
 * Build a Request that resolveSecurityPrincipal admits as `internal_service`,
 * signed exactly the way the production Node signer signs.
 *
 * The body is serialised ONCE and reused for both the signature's body hash and
 * the Request body, so the hash the verifier recomputes over `await req.text()`
 * is byte-identical by construction.
 */
export async function signedRequest(
  url: string,
  body: unknown,
  opts: SignedRequestOptions = {},
): Promise<Request> {
  installSecurityEnv();

  const raw = JSON.stringify(body);
  const requestId = opts.requestId ?? crypto.randomUUID();
  const timestamp = String(opts.timestampSeconds ?? Math.floor(Date.now() / 1000));
  const caller = opts.caller ?? TEST_INTERNAL_CALLER;
  const bearer = opts.bearerToken === undefined ? TEST_SERVICE_ROLE_KEY : opts.bearerToken;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-request-id': requestId,
    'x-internal-caller': caller,
  };
  if (bearer !== null) headers['Authorization'] = `Bearer ${bearer}`;

  if (!opts.omitSignature) {
    const canonical = buildCanonicalInternalRequest({
      method: 'POST',
      path: new URL(url).pathname,
      requestId,
      timestamp,
      bodyHash: await sha256Hex(raw),
      caller,
    });
    headers['x-internal-timestamp'] = timestamp;
    headers['x-internal-signature'] = opts.overrideSignature ??
      (await signInternalRequest(opts.signingSecret ?? TEST_SIGNING_SECRET, canonical));
  }

  return new Request(url, { method: 'POST', headers, body: raw });
}

export interface SecurityRpcOverrides {
  callerFound?: boolean;
  callerStatus?: string;
  allowSignedInternal?: boolean;
  policyEnabled?: boolean;
  quotaAllowed?: boolean;
}

/**
 * Wrap a pipeline-level Supabase stub so the SECURITY-layer RPCs
 * (resolveSecurityPrincipal / resolveRoutePolicy / quota / audit / circuit)
 * resolve like a correctly-provisioned database, while every other RPC and
 * every table read still reaches the caller's own stub untouched.
 *
 * This models the DATABASE, not the auth decision: the rows returned here are
 * exactly what a registered active caller and an enabled enforce-mode policy
 * look like in production. resolveSecurityPrincipal still has to check the
 * bearer token, the timestamp skew and the HMAC signature for itself — none of
 * which this wrapper can influence.
 */
export function withSecurityRpcs(
  // deno-lint-ignore no-explicit-any
  sb: any,
  overrides: SecurityRpcOverrides = {},
  // deno-lint-ignore no-explicit-any
): any {
  return {
    ...sb,
    // Explicit delegation so a THROWING stub keeps throwing and `this` never
    // rebinds onto the wrapper object.
    from: (table: string) => sb.from(table),
    auth: sb.auth,
    rpc(name: string, args?: Record<string, unknown>) {
      switch (name) {
        case 'security_resolve_internal_caller':
          return Promise.resolve({
            data: {
              found: overrides.callerFound !== false,
              id: TEST_INTERNAL_CALLER_ID,
              name: String(args?.p_caller_name ?? TEST_INTERNAL_CALLER),
              caller_kind: 'service_name',
              status: overrides.callerStatus ?? 'active',
            },
            error: null,
          });
        case 'security_resolve_route_policy':
          return Promise.resolve({
            data: {
              found: true,
              id: '00000000-0000-4000-8000-00000000p01c'.replace(/[^0-9a-f-]/g, '0'),
              route: 'grounded-answer',
              school_id: null,
              role: null,
              caller_type: 'internal_service',
              internal_caller_id: null,
              quota_profile_id: '00000000-0000-4000-8000-0000000000q0'.replace(/[^0-9a-f-]/g, '0'),
              enforcement_mode: 'enforce',
              allow_signed_internal: overrides.allowSignedInternal !== false,
              allow_jwt: true,
              allow_service_role: true,
              is_enabled: overrides.policyEnabled !== false,
            },
            error: null,
          });
        case 'security_compute_ai_cost':
          return Promise.resolve({ data: 0, error: null });
        case 'security_reserve_quota':
          return Promise.resolve({
            data: {
              allowed: overrides.quotaAllowed !== false,
              decision: overrides.quotaAllowed === false ? 'deny_quota' : 'allow',
              enforcement_mode: 'enforce',
              circuit_state: 'closed',
            },
            error: null,
          });
        case 'security_settle_quota':
        case 'security_write_request_audit':
        case 'security_update_circuit_state':
          return Promise.resolve({ data: null, error: null });
        default:
          return sb.rpc(name, args);
      }
    },
  };
}
