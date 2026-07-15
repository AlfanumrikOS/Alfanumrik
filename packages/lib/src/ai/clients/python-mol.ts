// packages/lib/src/ai/clients/python-mol.ts
//
// Foxy Perception (Phase 1C, 2026-07-15) — the Next.js-side (Node) client for
// the Python MOL AI service.
//
// Background:
//   The locked architecture puts the LLM PERCEPTION classification on the
//   Python MOL service (python/services/ai/, `POST /v1/classify`). The Deno
//   proxy (supabase/functions/_shared/python-ai-proxy.ts) is for Edge
//   Functions; the Next.js route (apps/host/src/app/api/foxy/route.ts) runs on
//   the Node runtime and needs its OWN small client. This is that client.
//
// Fail-closed posture (mirrors the Deno proxy verbatim in spirit):
//   * `PYTHON_AI_BASE_URL` empty/unset  → returns null unconditionally. This is
//     the architect-controlled kill: until the Cloud Run service URL is wired
//     in, perception is dead code even with `ff_foxy_perception_v1` flipped ON.
//   * ANY error / non-2xx / timeout      → returns null. NEVER throws. A down or
//     absent Python service must be a silent no-op, never a degraded turn.
//   * Short (4s default) timeout via AbortController so a slow Python service
//     can never wedge the caller. (The caller invokes this fire-and-forget so
//     the timeout is defence-in-depth, not a latency bound on the student.)
//
// Keyless Cloud Run invoker auth (2026-07-15):
//   The Python MOL service runs on Cloud Run with Invoker IAM enforced, so it
//   needs a Google-signed ID token (aud = the service URL) sent in
//   `X-Serverless-Authorization`. We mint that token per request, keyless, via
//   Vercel OIDC → Google STS (Workload Identity Federation) → SA impersonation
//   → iamcredentials generateIdToken. No JSON service-account key ever touches
//   Vercel. This layer is ADDITIVE and gated on four non-secret env vars
//   (GCP_PROJECT_NUMBER, GCP_SERVICE_ACCOUNT_EMAIL, GCP_WORKLOAD_IDENTITY_POOL_ID,
//   GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID). When they are ABSENT the mint is
//   dormant and behavior is exactly as before (no X-Serverless-Authorization).
//   When they are PRESENT and the mint cannot run (running off-Vercel where the
//   OIDC header is absent — the AWS path is DEFERRED; STS/impersonation error;
//   generateIdToken non-2xx; timeout) we return null and NEVER send an
//   unauthenticated request. The student JWT in `Authorization` is never
//   touched. The heavy Node deps (@vercel/oidc, google-auth-library) are
//   dynamic-imported on the armed path ONLY, so they never enter the dormant
//   path, the existing tests, or any client bundle (python-mol is server-only;
//   this keeps P10 intact).
//
// Deliberately generic: it forwards a JSON body + the caller's Authorization to
// a Python endpoint and returns the raw response text (the caller parses). It
// knows nothing about classification shape — that lives in
// packages/lib/src/foxy/perception.ts. No new HTTP lib: uses the Node global
// `fetch` (Node 20+).
//
// P13: this client never LOGS the request/response body (it may carry
// student-derived text destined for the classifier). It logs codes/status only.

import { logger } from '@alfanumrik/lib/logger';

/** Default per-call wall-clock timeout. Short by design — perception is best
 * effort and fire-and-forget, so a slow Python service must fail fast to null. */
const DEFAULT_TIMEOUT_MS = 4000;

/** Wall-clock bound for the keyless Google ID-token mint (STS exchange + SA
 * impersonation + generateIdToken). Independent of the request timeout so a
 * slow Google auth hop can never wedge perception — on timeout the mint
 * resolves to null and callPythonMol returns null (perception stays dark). */
const MINT_TIMEOUT_MS = 3000;

/** GCP Workload Identity Federation config, read from NON-SECRET env at request
 * time (never at module top-level — getVercelOidcToken is request-scoped). All
 * four must be present to arm the keyless mint; any missing → the mint is "not
 * configured" and callPythonMol falls back to legacy behavior (no
 * X-Serverless-Authorization header), exactly as before this change. */
interface GcpWifConfig {
  projectNumber: string;
  serviceAccountEmail: string;
  poolId: string;
  providerId: string;
}

function readGcpWifConfig(): GcpWifConfig | null {
  const projectNumber = (process.env.GCP_PROJECT_NUMBER ?? '').trim();
  const serviceAccountEmail = (process.env.GCP_SERVICE_ACCOUNT_EMAIL ?? '').trim();
  const poolId = (process.env.GCP_WORKLOAD_IDENTITY_POOL_ID ?? '').trim();
  const providerId = (process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID ?? '').trim();
  if (!projectNumber || !serviceAccountEmail || !poolId || !providerId) return null;
  return { projectNumber, serviceAccountEmail, poolId, providerId };
}

/**
 * Mint a Google-signed ID token (aud = the Cloud Run service URL) for the
 * impersonated invoker service account, using the request's Vercel OIDC token
 * as the federated subject. Keyless: no JSON service-account key on Vercel.
 *
 * Flow — all INSIDE the request handler (the Vercel OIDC token only exists as
 * the request-scoped `x-vercel-oidc-token` header at runtime):
 *   1. getVercelOidcToken() → the request's Vercel-signed OIDC JWT (subject).
 *   2. ExternalAccountClient exchanges it at Google STS and impersonates
 *      `serviceAccountEmail` (service_account_impersonation_url), yielding that
 *      SA's ACCESS token.
 *   3. Explicit second hop: iamcredentials generateIdToken on the SA (authed by
 *      the SA access token the client injects) → the Cloud Run ID token. We do
 *      this hop by hand rather than getIdTokenClient() to avoid the known
 *      google-auth-library WIF ID-token gaps.
 *
 * Returns null on ANY failure (no Vercel token — e.g. off-Vercel where the
 * header is absent, AWS path DEFERRED; STS/impersonation error; generateIdToken
 * non-2xx; timeout). NEVER throws. NEVER logs the token/body. The heavy Node
 * deps are dynamic-imported so they load only on the armed path.
 */
async function mintCloudRunIdToken(
  audience: string,
  cfg: GcpWifConfig,
  timeoutMs: number,
): Promise<string | null> {
  const mint = (async (): Promise<string | null> => {
    try {
      const [{ getVercelOidcToken }, { ExternalAccountClient }] = await Promise.all([
        import('@vercel/oidc'),
        import('google-auth-library'),
      ]);

      const stsAudience =
        `//iam.googleapis.com/projects/${cfg.projectNumber}` +
        `/locations/global/workloadIdentityPools/${cfg.poolId}` +
        `/providers/${cfg.providerId}`;

      const saGenerateAccessTokenUrl =
        `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/` +
        `${cfg.serviceAccountEmail}:generateAccessToken`;
      const saGenerateIdTokenUrl =
        `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/` +
        `${cfg.serviceAccountEmail}:generateIdToken`;

      const client = ExternalAccountClient.fromJSON({
        type: 'external_account',
        audience: stsAudience,
        subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
        token_url: 'https://sts.googleapis.com/v1/token',
        service_account_impersonation_url: saGenerateAccessTokenUrl,
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
        // The subject token IS the Vercel OIDC JWT, fetched per request. The
        // client does not cache it; getVercelOidcToken handles its own refresh.
        // getVercelOidcToken throws when the request header/env is absent; that
        // throw is caught below and degrades to null (fail-closed).
        subject_token_supplier: {
          getSubjectToken: () => getVercelOidcToken(),
        },
      });
      if (!client) return null;

      // Explicit second hop. The client injects the impersonated SA access
      // token as Authorization; the SA holds serviceAccountTokenCreator on
      // itself, so it may mint its own ID token for the Cloud Run audience.
      const res = await client.request<{ token?: string }>({
        url: saGenerateIdTokenUrl,
        method: 'POST',
        data: { audience, includeEmail: true },
      });

      const token = res.data?.token;
      return typeof token === 'string' && token.length > 0 ? token : null;
    } catch {
      // No Vercel OIDC token, STS/impersonation failure, generateIdToken gitleaks:allow
      // non-2xx, or network — perception stays dark. NEVER logs the token/body.
      return null;
    }
  })();

  // Bound the whole mint independently of the request timeout so a slow
  // STS/IAM hop cannot wedge perception.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([mint, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface CallPythonMolArgs {
  /**
   * Endpoint path on the Python service, e.g. `/v1/classify`. Combined with
   * `PYTHON_AI_BASE_URL` tolerating trailing/leading-slash combinations.
   */
  endpointPath: string;
  /**
   * The caller's bearer JWT (the STUDENT's Supabase access token). Forwarded as
   * `Authorization: Bearer <token>` so the Python service performs its own
   * `require_active_student` verification. When null (e.g. the client used
   * cookie auth with no Bearer header) the request is still sent, the Python
   * auth dependency rejects it (401), and this client returns null — the
   * correct fail-safe (perception only runs when a forwardable token exists,
   * exactly like the math-verify hop).
   */
  authToken: string | null;
  /** JSON-serializable request body. Never logged (P13). */
  body: unknown;
  /** Override the 4s default. Useful in tests. */
  timeoutMs?: number;
  /**
   * Test/override seam for the base URL. Production callers omit this and rely
   * on the `PYTHON_AI_BASE_URL` env var (the architect-controlled kill switch).
   */
  baseUrlOverride?: string;
}

/**
 * POST a JSON body to the Python MOL service and return the raw response text.
 *
 * Returns `null` when:
 *   - `PYTHON_AI_BASE_URL` (or `baseUrlOverride`) is empty  → perception dark
 *   - the WIF mint is ARMED (all four GCP_* env vars set) but the Google ID
 *     token cannot be minted (off-Vercel/no OIDC token, STS/impersonation gitleaks:allow
 *     error, generateIdToken non-2xx, or mint timeout) — we NEVER send an
 *     unauthenticated request to the Invoker-IAM-enforced Cloud Run service
 *   - the WIF mint is armed but the base URL is malformed (no derivable aud)
 *   - the fetch throws (network error / DNS / TLS)
 *   - the request times out (AbortController)
 *   - the response is non-2xx
 *   - reading the response body throws
 *
 * NEVER throws. NEVER logs the body. This is the single Node entry point to the
 * Python MOL service; every perception call goes through it so the fail-closed
 * posture stays in one place.
 */
export async function callPythonMol(args: CallPythonMolArgs): Promise<string | null> {
  const baseUrl = (args.baseUrlOverride ?? process.env.PYTHON_AI_BASE_URL ?? '').trim();
  if (!baseUrl) {
    // Architect-controlled kill: service URL not wired in → perception is dark.
    return null;
  }

  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Tolerate loose trailing/leading-slash conventions on the env var + path.
  const left = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const right = args.endpointPath.startsWith('/') ? args.endpointPath : `/${args.endpointPath}`;
  const url = `${left}${right}`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (args.authToken) headers.Authorization = `Bearer ${args.authToken}`;

  // Keyless Cloud Run invoker auth (additive, gated on the four GCP_* WIF env
  // vars). When they are present the target service enforces Invoker IAM, so we
  // MUST attach a Google-signed ID token (aud = service URL) in
  // X-Serverless-Authorization — the student JWT in Authorization is untouched.
  // If the mint is unavailable (off-Vercel, exchange failure, timeout) we return
  // null and NEVER send an unauthenticated request. When the WIF vars are ABSENT
  // this whole block is skipped and behavior is exactly as before (legacy: no
  // X-Serverless-Authorization header), which is also the test/dev seam posture.
  const wifConfig = readGcpWifConfig();
  if (wifConfig) {
    let audience: string;
    try {
      audience = new URL(baseUrl).origin;
    } catch {
      // Malformed base URL → cannot determine the ID-token audience → dark.
      return null;
    }
    const idToken = await mintCloudRunIdToken(audience, wifConfig, MINT_TIMEOUT_MS);
    if (!idToken) {
      // P13: static code + non-PII path only — never the token/body/reason detail.
      logger.warn('python_mol.mint_unavailable', { path: args.endpointPath });
      return null;
    }
    headers['X-Serverless-Authorization'] = `Bearer ${idToken}`;
  }

  let bodyStr: string;
  try {
    bodyStr = JSON.stringify(args.body);
  } catch {
    // Non-serializable body — treat as a no-op rather than throw.
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers,
      body: bodyStr,
    });
    clearTimeout(timer);

    if (!res.ok) {
      // P13: status code only — never the body.
      logger.warn('python_mol.non_2xx', { status: res.status, path: args.endpointPath });
      return null;
    }

    return await res.text();
  } catch (err) {
    clearTimeout(timer);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    // P13: error class only — never the body.
    logger.warn('python_mol.call_failed', {
      reason: isAbort ? 'timeout' : 'network_error',
      path: args.endpointPath,
    });
    return null;
  }
}
