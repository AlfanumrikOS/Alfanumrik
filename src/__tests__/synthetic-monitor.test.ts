/**
 * Phase E.5 — synthetic-host-monitor classifier unit tests.
 *
 * The Edge Function entry point (supabase/functions/synthetic-host-monitor/
 * index.ts) imports https://esm.sh and uses Deno.serve, so it cannot be
 * loaded under Vitest. Per the pattern in src/__tests__/edge-functions/*
 * we exercise the pure logic — the JSON-parsing classification — via a
 * separate `classify.ts` module that the Edge Function and these tests
 * both import.
 *
 * What's pinned by these tests:
 *   1. The failure-reason enum: every branch produces exactly the
 *      expected `FailureReason` string. The downstream PG CHECK
 *      constraint on synthetic_monitor_results.failure_reason mirrors
 *      this enum — drift in either direction breaks the INSERT.
 *   2. The OK predicate: ok = true ONLY when HTTP 200 + parsed body +
 *      `id` (or `school.id`) matches expected. Anything else is a fail.
 *   3. Precedence ordering: transport > status > body. A 500 with
 *      garbage JSON classifies as http_5xx, not invalid_response.
 *   4. Host resolution: custom_domain > slug fallback; whitespace
 *      trimmed; both nulled → null.
 *
 * Edge cases discovered while writing these (worth documenting because
 * they shaped the implementation):
 *
 *   - The /api/school-config route returns `id` at the TOP LEVEL of the
 *     response, not under a `school` key. The task spec said
 *     `response.school.id`; the live route says `response.id`. We accept
 *     BOTH shapes (top-level first, nested fallback) so the monitor
 *     keeps working if the response shape ever changes.
 *
 *   - When proxy.ts fails to inject tenant headers, /api/school-config
 *     returns `{ isSchoolContext: false }` (HTTP 200, no `id`). This is
 *     EXACTLY the failure mode we built this monitor to catch — but the
 *     correct classification is `invalid_response` (no id surfaced),
 *     NOT `tenant_mismatch` (which implies a wrong id was returned).
 *     Operators reading the failure_reason should be able to tell the
 *     two apart: missing-headers (likely proxy regression) vs.
 *     wrong-tenant (likely DNS / cache-key collision).
 *
 *   - DOMException-with-name=AbortError is the platform-correct way to
 *     detect timeouts in both Deno and Node 22 fetch. We also accept
 *     `/aborted/i` text as a belt-and-braces match in case a runtime
 *     surfaces a different error class.
 */

import { describe, it, expect } from 'vitest'
import {
  classifyProbe,
  resolveHostForSchool,
  type FailureReason,
} from '../../supabase/functions/synthetic-host-monitor/classify'

const EXPECTED_ID = '00000000-0000-0000-0000-000000000001'
const OTHER_ID    = '00000000-0000-0000-0000-000000000002'

// Mirrors the live /api/school-config success shape exactly (see
// src/app/api/school-config/route.ts).
function liveResponseBody(id: string): string {
  return JSON.stringify({
    isSchoolContext: true,
    id,
    name: 'Delhi Public School',
    slug: 'dps-noida',
    logoUrl: null,
    primaryColor: '#7C3AED',
    secondaryColor: '#F97316',
  })
}

describe('classifyProbe — happy path', () => {
  it('HTTP 200 + matching id at TOP LEVEL → OK', () => {
    const result = classifyProbe({
      expectedSchoolId: EXPECTED_ID,
      probe: {
        kind: 'response',
        status: 200,
        body: liveResponseBody(EXPECTED_ID),
        durationMs: 142,
      },
    })
    expect(result.ok).toBe(true)
    expect(result.failureReason).toBeNull()
    expect(result.httpStatus).toBe(200)
    expect(result.responseTimeMs).toBe(142)
    expect(result.observedSchoolId).toBe(EXPECTED_ID)
    expect(result.parsedBody).not.toBeNull()
  })

  it('HTTP 200 + matching id under NESTED school.id → OK (legacy shape)', () => {
    // Backwards-compat: if /api/school-config ever returns
    // `{ school: { id, ... } }` we still classify correctly.
    const body = JSON.stringify({ school: { id: EXPECTED_ID, name: 'X' } })
    const result = classifyProbe({
      expectedSchoolId: EXPECTED_ID,
      probe: { kind: 'response', status: 200, body, durationMs: 88 },
    })
    expect(result.ok).toBe(true)
    expect(result.observedSchoolId).toBe(EXPECTED_ID)
  })

  it('HTTP 200 records the response time without rounding errors', () => {
    const result = classifyProbe({
      expectedSchoolId: EXPECTED_ID,
      probe: {
        kind: 'response',
        status: 200,
        body: liveResponseBody(EXPECTED_ID),
        durationMs: 0,
      },
    })
    expect(result.responseTimeMs).toBe(0)
  })
})

describe('classifyProbe — failure modes', () => {
  it('HTTP 200 + mismatched id → FAIL with reason "tenant_mismatch"', () => {
    const result = classifyProbe({
      expectedSchoolId: EXPECTED_ID,
      probe: {
        kind: 'response',
        status: 200,
        body: liveResponseBody(OTHER_ID),
        durationMs: 200,
      },
    })
    expect(result.ok).toBe(false)
    expect(result.failureReason).toBe<FailureReason>('tenant_mismatch')
    expect(result.observedSchoolId).toBe(OTHER_ID)
    expect(result.parsedBody).not.toBeNull() // body preserved for forensics
  })

  it('HTTP 404 → FAIL with reason "http_4xx"', () => {
    const result = classifyProbe({
      expectedSchoolId: EXPECTED_ID,
      probe: {
        kind: 'response',
        status: 404,
        body: '<html>not found</html>',
        durationMs: 50,
      },
    })
    expect(result.ok).toBe(false)
    expect(result.failureReason).toBe<FailureReason>('http_4xx')
    expect(result.httpStatus).toBe(404)
    // Body is NOT parsed on a 4xx — we don't want to waste cycles on
    // an HTML error page from a CDN.
    expect(result.parsedBody).toBeNull()
  })

  it('HTTP 500 → FAIL with reason "http_5xx" (even if body is JSON)', () => {
    // A JSON body on a 5xx should NOT be classified as invalid_response
    // — the outermost cause (server error) wins.
    const result = classifyProbe({
      expectedSchoolId: EXPECTED_ID,
      probe: {
        kind: 'response',
        status: 500,
        body: JSON.stringify({ error: 'internal' }),
        durationMs: 350,
      },
    })
    expect(result.ok).toBe(false)
    expect(result.failureReason).toBe<FailureReason>('http_5xx')
    expect(result.httpStatus).toBe(500)
  })

  it('Timeout → FAIL with reason "timeout"', () => {
    const result = classifyProbe({
      expectedSchoolId: EXPECTED_ID,
      probe: { kind: 'timeout', durationMs: 10_000 },
    })
    expect(result.ok).toBe(false)
    expect(result.failureReason).toBe<FailureReason>('timeout')
    expect(result.httpStatus).toBeNull()
    expect(result.responseTimeMs).toBe(10_000)
  })

  it('DNS error → FAIL with reason "dns_error"', () => {
    const result = classifyProbe({
      expectedSchoolId: EXPECTED_ID,
      probe: { kind: 'dns', durationMs: 25, message: 'getaddrinfo ENOTFOUND' },
    })
    expect(result.ok).toBe(false)
    expect(result.failureReason).toBe<FailureReason>('dns_error')
    expect(result.httpStatus).toBeNull()
  })

  it('Non-JSON response body on a 200 → FAIL with reason "invalid_response"', () => {
    const result = classifyProbe({
      expectedSchoolId: EXPECTED_ID,
      probe: {
        kind: 'response',
        status: 200,
        body: 'this is not json at all',
        durationMs: 80,
      },
    })
    expect(result.ok).toBe(false)
    expect(result.failureReason).toBe<FailureReason>('invalid_response')
    expect(result.httpStatus).toBe(200)
    expect(result.observedSchoolId).toBeNull()
  })

  it('Empty body on a 200 → FAIL with reason "invalid_response"', () => {
    const result = classifyProbe({
      expectedSchoolId: EXPECTED_ID,
      probe: { kind: 'response', status: 200, body: '', durationMs: 12 },
    })
    expect(result.ok).toBe(false)
    expect(result.failureReason).toBe<FailureReason>('invalid_response')
  })

  it('JSON object with NO id field → FAIL with reason "invalid_response"', () => {
    // This is the proxy-regression failure mode: /api/school-config
    // returns `{ isSchoolContext: false }` (HTTP 200) because proxy.ts
    // didn't inject the x-school-id header. We classify this as
    // invalid_response, NOT tenant_mismatch — the distinction matters
    // for operators triaging the alert.
    const result = classifyProbe({
      expectedSchoolId: EXPECTED_ID,
      probe: {
        kind: 'response',
        status: 200,
        body: JSON.stringify({ isSchoolContext: false }),
        durationMs: 60,
      },
    })
    expect(result.ok).toBe(false)
    expect(result.failureReason).toBe<FailureReason>('invalid_response')
    expect(result.observedSchoolId).toBeNull()
    // Body IS preserved here so an operator can see the
    // isSchoolContext=false signature directly in raw_response.
    expect(result.parsedBody).toEqual({ isSchoolContext: false })
  })

  it('JSON ARRAY at the top level → FAIL with reason "invalid_response"', () => {
    // Arrays are objects too in JS; the classifier must reject them
    // because there is no `id` accessor.
    const result = classifyProbe({
      expectedSchoolId: EXPECTED_ID,
      probe: {
        kind: 'response',
        status: 200,
        body: JSON.stringify([{ id: EXPECTED_ID }]),
        durationMs: 20,
      },
    })
    expect(result.ok).toBe(false)
    // An array has no top-level `id`, no nested `school.id`. We get
    // invalid_response. (We deliberately don't unwrap a single-element
    // array — that'd be silently lenient about a wrong response shape.)
    expect(result.failureReason).toBe<FailureReason>('invalid_response')
  })

  it('Generic fetch error (non-timeout, non-DNS) → FAIL with reason "fetch_error"', () => {
    const result = classifyProbe({
      expectedSchoolId: EXPECTED_ID,
      probe: { kind: 'error', durationMs: 17, message: 'TLS handshake failed' },
    })
    expect(result.ok).toBe(false)
    expect(result.failureReason).toBe<FailureReason>('fetch_error')
  })
})

describe('classifyProbe — precedence', () => {
  it('5xx with garbage JSON classifies as http_5xx, not invalid_response', () => {
    const result = classifyProbe({
      expectedSchoolId: EXPECTED_ID,
      probe: { kind: 'response', status: 503, body: 'not-json', durationMs: 5 },
    })
    expect(result.failureReason).toBe<FailureReason>('http_5xx')
  })

  it('4xx with JSON-shaped tenant-mismatch body classifies as http_4xx', () => {
    // The status code is the outermost signal. We don't reach the
    // body-parse step at all.
    const result = classifyProbe({
      expectedSchoolId: EXPECTED_ID,
      probe: {
        kind: 'response',
        status: 401,
        body: liveResponseBody(OTHER_ID),
        durationMs: 30,
      },
    })
    expect(result.failureReason).toBe<FailureReason>('http_4xx')
  })
})

describe('resolveHostForSchool', () => {
  it('prefers custom_domain over slug fallback', () => {
    expect(
      resolveHostForSchool({ slug: 'dps', custom_domain: 'learn.dps.com' }),
    ).toBe('learn.dps.com')
  })

  it('falls back to <slug>.alfanumrik.com when custom_domain is null', () => {
    expect(
      resolveHostForSchool({ slug: 'dps-noida', custom_domain: null }),
    ).toBe('dps-noida.alfanumrik.com')
  })

  it('uses the configured base domain (staging override)', () => {
    expect(
      resolveHostForSchool(
        { slug: 'dps-noida', custom_domain: null },
        'alfanumrik-staging.com',
      ),
    ).toBe('dps-noida.alfanumrik-staging.com')
  })

  it('returns null when both slug and custom_domain are absent', () => {
    expect(resolveHostForSchool({ slug: null, custom_domain: null })).toBeNull()
    expect(resolveHostForSchool({ slug: '', custom_domain: '' })).toBeNull()
    expect(resolveHostForSchool({ slug: '   ', custom_domain: '   ' })).toBeNull()
  })

  it('trims and lowercases the host', () => {
    expect(
      resolveHostForSchool({ slug: null, custom_domain: '  Learn.DPS.com  ' }),
    ).toBe('learn.dps.com')
    expect(resolveHostForSchool({ slug: '  DPS  ', custom_domain: null })).toBe(
      'dps.alfanumrik.com',
    )
  })
})
