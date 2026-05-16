/**
 * Pure classification helpers for synthetic-host-monitor (Phase E.5).
 *
 * Extracted into a separate module so the JSON-parsing + status-bucketing
 * logic can be unit-tested under Vitest (the Edge Function entry point
 * imports from https://esm.sh + uses Deno.serve and cannot be loaded by
 * Node-side test runners — see src/__tests__/edge-functions/* for the
 * static-source-inspection pattern we apply to the rest of the function).
 *
 * Why this lives here and not in the Edge Function file:
 *   1. Testability: the classifier is pure (input → output) and has zero
 *      Deno-specific dependencies. Vitest can import it directly.
 *   2. Single source of truth: the failure-reason enum is consumed by
 *      both the Edge Function and the test suite. Keeping it in one file
 *      means a new failure mode cannot drift between the two.
 *   3. The Edge Function imports this with a relative `./classify.ts`
 *      path. `supabase functions deploy` bundles the directory so the
 *      file ships with the function.
 *
 * Deno-compatibility: this module only uses standard ECMAScript — no
 * `Deno.*`, no Node `fs`/`process`, no DOM. Both Deno and Vitest happily
 * parse and execute it.
 */

/**
 * Failure-reason enum. Pinned for downstream alerting / dashboards —
 * synthetic_monitor_results.failure_reason MUST come from this set.
 *
 * Ordering matters for the classifier: when multiple conditions could
 * apply (e.g. a 500 response with a non-JSON body), we report the
 * outer-most cause first (transport > status > body). The classifier
 * short-circuits accordingly.
 */
export type FailureReason =
  | 'timeout'           // fetch aborted by AbortController (10s default)
  | 'dns_error'         // hostname did not resolve / TCP connect failed
  | 'http_4xx'          // HTTP 400-499
  | 'http_5xx'          // HTTP 500-599
  | 'invalid_response'  // body could not be parsed as JSON, or had no id
  | 'tenant_mismatch'   // JSON parsed but school id differed from expected
  | 'fetch_error'       // catch-all for any other fetch error

export interface ClassifyInput {
  /** The school id we expected the host to resolve to. */
  expectedSchoolId: string
  /** Output of fetchProbe(): either an HTTP response we read or a failure. */
  probe:
    | { kind: 'response'; status: number; body: string; durationMs: number }
    | { kind: 'timeout';   durationMs: number }
    | { kind: 'dns';       durationMs: number; message: string }
    | { kind: 'error';     durationMs: number; message: string }
}

export interface ClassifyResult {
  ok: boolean
  failureReason: FailureReason | null
  httpStatus: number | null
  responseTimeMs: number
  /**
   * Parsed JSON body (if the response was 200 and parsed cleanly) — useful
   * for the rawResponse column. Trimmed of sensitive fields before writing.
   */
  parsedBody: Record<string, unknown> | null
  /** What we observed in the body, for the rawResponse column. */
  observedSchoolId: string | null
}

/**
 * Classify a probe outcome. Pure function — call with `expectedSchoolId`
 * for the school whose host we just probed, and the probe result.
 *
 * The school-config response shape (per src/app/api/school-config/route.ts):
 *
 *   {
 *     isSchoolContext: true,
 *     id: "<uuid>",            // ← primary id field (top-level)
 *     name, slug, logoUrl, primaryColor, secondaryColor
 *   }
 *
 * Spec referenced `response.school.id`. The actual route returns `id` at
 * the top level. We accept BOTH shapes (top-level `id` first, then
 * `school.id` fallback) so a future shape change is backwards-compatible.
 */
export function classifyProbe(input: ClassifyInput): ClassifyResult {
  const { expectedSchoolId, probe } = input

  // 1. Transport-level failures short-circuit before status / body inspection.
  if (probe.kind === 'timeout') {
    return {
      ok: false,
      failureReason: 'timeout',
      httpStatus: null,
      responseTimeMs: probe.durationMs,
      parsedBody: null,
      observedSchoolId: null,
    }
  }
  if (probe.kind === 'dns') {
    return {
      ok: false,
      failureReason: 'dns_error',
      httpStatus: null,
      responseTimeMs: probe.durationMs,
      parsedBody: null,
      observedSchoolId: null,
    }
  }
  if (probe.kind === 'error') {
    return {
      ok: false,
      failureReason: 'fetch_error',
      httpStatus: null,
      responseTimeMs: probe.durationMs,
      parsedBody: null,
      observedSchoolId: null,
    }
  }

  // 2. We have a response. Status comes first — a 5xx with garbage JSON is
  //    classified as http_5xx, not invalid_response (more useful for alerts).
  const { status, body, durationMs } = probe
  if (status >= 500) {
    return {
      ok: false,
      failureReason: 'http_5xx',
      httpStatus: status,
      responseTimeMs: durationMs,
      parsedBody: null,
      observedSchoolId: null,
    }
  }
  if (status >= 400) {
    return {
      ok: false,
      failureReason: 'http_4xx',
      httpStatus: status,
      responseTimeMs: durationMs,
      parsedBody: null,
      observedSchoolId: null,
    }
  }

  // 3. 2xx/3xx: parse body and compare tenant ids. 3xx is rare for this
  //    endpoint (school-config returns 200 unconditionally), but we treat
  //    it the same as 2xx for parsing — if a body comes through we still
  //    want to verify the tenant.
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return {
      ok: false,
      failureReason: 'invalid_response',
      httpStatus: status,
      responseTimeMs: durationMs,
      parsedBody: null,
      observedSchoolId: null,
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      ok: false,
      failureReason: 'invalid_response',
      httpStatus: status,
      responseTimeMs: durationMs,
      parsedBody: null,
      observedSchoolId: null,
    }
  }

  const body0 = parsed as Record<string, unknown>
  // Accept both shapes (top-level `id` first, `school.id` fallback).
  const topLevelId = typeof body0.id === 'string' ? (body0.id as string) : null
  const nestedSchool =
    body0.school && typeof body0.school === 'object'
      ? (body0.school as Record<string, unknown>)
      : null
  const nestedId =
    nestedSchool && typeof nestedSchool.id === 'string'
      ? (nestedSchool.id as string)
      : null
  const observedSchoolId = topLevelId ?? nestedId

  if (!observedSchoolId) {
    // Tenant context completely missing — proxy.ts likely didn't set the
    // headers, so the route returned `{ isSchoolContext: false }`. From
    // the monitor's perspective this is the *exact* failure mode we
    // built this for — but the right classification is invalid_response
    // (no id surfaced), not tenant_mismatch (which implies a wrong id).
    return {
      ok: false,
      failureReason: 'invalid_response',
      httpStatus: status,
      responseTimeMs: durationMs,
      parsedBody: body0,
      observedSchoolId: null,
    }
  }

  if (observedSchoolId !== expectedSchoolId) {
    return {
      ok: false,
      failureReason: 'tenant_mismatch',
      httpStatus: status,
      responseTimeMs: durationMs,
      parsedBody: body0,
      observedSchoolId,
    }
  }

  return {
    ok: true,
    failureReason: null,
    httpStatus: status,
    responseTimeMs: durationMs,
    parsedBody: body0,
    observedSchoolId,
  }
}

/**
 * Compute the host to probe for a school. Prefers `custom_domain` (the
 * branded URL the school's users actually hit), falls back to
 * `<slug>.alfanumrik.com` (the canonical Alfanumrik subdomain). If neither
 * is present we return null and the caller skips the row — a school with
 * no slug and no custom_domain has no white-label surface to monitor.
 *
 * The fallback domain `alfanumrik.com` matches proxy.ts:255 (the
 * <slug>.alfanumrik.com pattern). Override via env for staging
 * (e.g. ALFANUMRIK_BASE_DOMAIN=alfanumrik-staging.com) so the same
 * function can run against pre-prod without code changes.
 */
export function resolveHostForSchool(
  school: { slug: string | null; custom_domain: string | null },
  baseDomain: string = 'alfanumrik.com',
): string | null {
  if (school.custom_domain && school.custom_domain.trim().length > 0) {
    return school.custom_domain.trim().toLowerCase()
  }
  if (school.slug && school.slug.trim().length > 0) {
    return `${school.slug.trim().toLowerCase()}.${baseDomain}`
  }
  return null
}
