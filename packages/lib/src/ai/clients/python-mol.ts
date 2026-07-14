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
