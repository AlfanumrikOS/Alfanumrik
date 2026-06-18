/**
 * synthetic-host-monitor — Alfanumrik Edge Function (Phase E.5).
 *
 * Catches white-label tenant-resolution regressions in production.
 *
 * Why this exists:
 *   Tenant resolution depends on a chain — DNS CNAME → Vercel routing →
 *   src/proxy.ts resolveTenantFromHost() (lines ~233-484) → /api/school-config
 *   returns the right tenant. If any link breaks (e.g. the known
 *   request-vs-response headers bug at src/proxy.ts:759-767, a DNS
 *   misconfig, or a regression in the proxy cache TTL logic), schools
 *   silently show the generic Alfanumrik page or a 404 instead of their
 *   branded site. Today we only notice via user reports. This function
 *   probes every active school on a 5-minute cron and writes the result
 *   to synthetic_monitor_results so:
 *     - operators see real-time host-resolution health,
 *     - failures escalate to console.error (picked up by Vercel/Supabase
 *       log dashboards; Sentry hook can be added once an Edge-Function
 *       Sentry pattern lands — see _shared/redact-pii.ts for the
 *       discipline, no Edge-Function Sentry helper exists yet),
 *     - downstream PagerDuty / Slack alerting reads the
 *       `synthetic_monitor_results WHERE ok=false AND checked_at > now() - '15 min'`
 *       view to alarm.
 *
 * Contract:
 *   POST {SUPABASE_URL}/functions/v1/synthetic-host-monitor
 *   Returns:
 *     200 { checked, ok, failed, duration_ms, failures: [...] }
 *     500 { error: '...' } on fatal startup failure
 *
 * Behaviour:
 *   1. SELECT id, name, slug, custom_domain FROM schools
 *      WHERE is_active = true AND deleted_at IS NULL.
 *      (Schema uses `is_active`, NOT `status` — confirmed against
 *      supabase/migrations/00000000000000_baseline_from_prod.sql:13484.)
 *   2. For each row, resolve the host via classify.ts:resolveHostForSchool()
 *      — custom_domain preferred, <slug>.alfanumrik.com fallback. Skip rows
 *      with neither (nothing to monitor).
 *   3. GET https://<host>/api/school-config with a 10s timeout. Probes run
 *      concurrently (Promise.all) with a small concurrency cap so a slow
 *      origin doesn't block the whole tick.
 *   4. Classify the outcome via classify.ts:classifyProbe(). One of:
 *      OK | timeout | dns_error | http_4xx | http_5xx | tenant_mismatch |
 *      invalid_response | fetch_error.
 *   5. Insert a row into synthetic_monitor_results. raw_response stores
 *      the parsed JSON (≤2KB after truncation) so an operator can inspect
 *      what the tenant returned without re-probing.
 *   6. On any FAIL, console.error a structured one-liner. Sentry-ready
 *      payload shape so a later PR can wire a real DSN with zero
 *      classifier changes.
 *
 * Idempotency / safety:
 *   - The function is read-only against `schools` and only INSERTs into
 *     `synthetic_monitor_results`. Re-running it never mutates other
 *     state. Two overlapping ticks at most double-write monitor rows;
 *     downstream dashboards de-dup by `(school_id, checked_at)`.
 *   - Per-school failures NEVER abort the batch. Each probe is wrapped
 *     in try/catch so a single misbehaving origin doesn't blind the
 *     monitor to the rest of the fleet.
 *   - We DO NOT auto-deploy the cron schedule. The companion migration
 *     `20260527000010_synthetic_monitor_results.sql` documents how to
 *     wire pg_cron + pg_net once the function URL is known.
 *
 * Retention:
 *   - Out of scope for this PR. A follow-up should add a 30-day purge
 *     cron — see migration comment. Until then, manual `DELETE FROM
 *     synthetic_monitor_results WHERE checked_at < now() - interval '30 days'`
 *     keeps the table small (~280 rows/school/day at 5-min cadence).
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { auditInternalCronInvocation, internalCronUnauthorizedResponse, verifyInternalCronRequest } from '../_shared/security/internal-cron-auth.ts'
import {
  classifyProbe,
  resolveHostForSchool,
  type FailureReason,
} from './classify.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// Tunable: per-request timeout. 10s is generous for /api/school-config
// (the route is a header read; p99 is well under 1s) but tolerant of cold
// Vercel functions. Bump if false-positive timeouts spike post-deploy.
const FETCH_TIMEOUT_MS = 10_000

// Cap concurrent probes so a tick against a 5000-school fleet doesn't
// open 5000 sockets at once. Sized to be comfortably above typical school
// counts while keeping memory + FD pressure low.
const CONCURRENCY = 25

// Base domain for the slug fallback. Defaults to prod; staging overrides
// via env so the same image can run against pre-prod with no code change.
const BASE_DOMAIN =
  Deno.env.get('ALFANUMRIK_BASE_DOMAIN')?.trim() || 'alfanumrik.com'

interface SchoolRow {
  id: string
  name: string
  slug: string | null
  custom_domain: string | null
}

interface ProbeResultRow {
  school_id: string
  school_name: string
  host: string
  http_status: number | null
  response_time_ms: number
  ok: boolean
  failure_reason: FailureReason | null
  observed_school_id: string | null
}

// ── Fetch with timeout + transport-error classification ───────────────────

/**
 * Probe a single host. Returns a discriminated union the classifier
 * consumes — we deliberately split "timeout" / "dns" / "error" / "response"
 * so the classifier never has to inspect raw fetch errors.
 *
 * Deno's fetch follows redirects by default. The school-config route
 * doesn't redirect so we leave that alone — if a misconfigured tenant
 * starts redirecting we want to see that as a follow-through to whatever
 * the final response is.
 */
async function fetchProbe(
  host: string,
): Promise<
  | { kind: 'response'; status: number; body: string; durationMs: number }
  | { kind: 'timeout';   durationMs: number }
  | { kind: 'dns';       durationMs: number; message: string }
  | { kind: 'error';     durationMs: number; message: string }
> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  const start = performance.now()
  try {
    const res = await fetch(`https://${host}/api/school-config`, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Alfanumrik-Synthetic-Monitor/1.0 (+ops@alfanumrik.com)',
        'Accept':     'application/json',
      },
      redirect: 'follow',
    })
    // Cap body read at 32KB — /api/school-config returns <1KB in practice;
    // anything bigger is almost certainly an HTML error page from a CDN
    // and we don't need to keep the whole thing.
    const text = await readBoundedText(res, 32_768)
    return {
      kind: 'response',
      status: res.status,
      body: text,
      durationMs: Math.round(performance.now() - start),
    }
  } catch (err) {
    const durationMs = Math.round(performance.now() - start)
    const message = err instanceof Error ? err.message : String(err)
    // Deno's AbortError surfaces as a DOMException with name='AbortError'.
    if (
      (err instanceof DOMException && err.name === 'AbortError') ||
      /aborted/i.test(message)
    ) {
      return { kind: 'timeout', durationMs }
    }
    // Connection-refused / DNS-failure errors. Deno wraps these as
    // TypeError with a message containing 'dns' or 'connection'.
    if (/dns|connection refused|getaddrinfo|enotfound|connect failed/i.test(message)) {
      return { kind: 'dns', durationMs, message }
    }
    return { kind: 'error', durationMs, message }
  } finally {
    clearTimeout(timer)
  }
}

/** Read at most `maxBytes` from the response body, decode as utf-8. */
async function readBoundedText(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      chunks.push(value)
      total += value.byteLength
      if (total >= maxBytes) break
    }
  } finally {
    try { reader.releaseLock() } catch { /* ignore */ }
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    merged.set(c.subarray(0, Math.min(c.byteLength, maxBytes - offset)), offset)
    offset += c.byteLength
    if (offset >= maxBytes) break
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged)
}

// ── Per-school orchestrator ───────────────────────────────────────────────

/** Run probes with a concurrency cap. */
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      results[idx] = await fn(items[idx])
    }
  }
  const workers: Promise<void>[] = []
  for (let w = 0; w < Math.min(limit, items.length); w++) {
    workers.push(worker())
  }
  await Promise.all(workers)
  return results
}

// ── Persistence ───────────────────────────────────────────────────────────

interface InsertRow {
  school_id: string
  host: string
  http_status: number | null
  response_time_ms: number
  ok: boolean
  failure_reason: string | null
  raw_response: Record<string, unknown> | null
}

async function insertResults(
  sb: SupabaseClient,
  probeRows: ProbeResultRow[],
  parsedBodies: Map<string, Record<string, unknown> | null>,
): Promise<{ inserted: number; error: string | null }> {
  if (probeRows.length === 0) return { inserted: 0, error: null }

  const insertRows: InsertRow[] = probeRows.map((r) => {
    // Trim the raw_response we persist to the bits that are useful for
    // forensics — full body could include long error pages.
    const parsed = parsedBodies.get(r.school_id) ?? null
    const compact = parsed ? compactBody(parsed) : null
    return {
      school_id: r.school_id,
      host: r.host,
      http_status: r.http_status,
      response_time_ms: r.response_time_ms,
      ok: r.ok,
      failure_reason: r.failure_reason,
      raw_response: compact === null ? null : { observed: compact, mismatch: !r.ok && r.observed_school_id ? { observed_school_id: r.observed_school_id } : undefined },
    }
  })

  const { error, count } = await sb
    .from('synthetic_monitor_results')
    .insert(insertRows, { count: 'exact' })

  if (error) {
    return { inserted: 0, error: error.message }
  }
  return { inserted: count ?? insertRows.length, error: null }
}

/**
 * Reduce a parsed body to the fields we want in raw_response. Drops
 * unknown keys so a future shape change in /api/school-config can't
 * leak unexpected data into the monitor table.
 */
function compactBody(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of [
    'isSchoolContext',
    'id',
    'slug',
    'name',
    'primaryColor',
    'secondaryColor',
  ]) {
    if (key in body) out[key] = body[key]
  }
  // Support legacy/nested `school.id` shape too.
  if (
    body.school &&
    typeof body.school === 'object' &&
    body.school !== null &&
    typeof (body.school as Record<string, unknown>).id === 'string'
  ) {
    out.school_id_nested = (body.school as Record<string, unknown>).id
  }
  return out
}

// ── Tick orchestrator ─────────────────────────────────────────────────────

export interface MonitorSummary {
  checked: number
  ok: number
  failed: number
  skipped: number
  duration_ms: number
  failures: Array<{
    school_id: string
    school_name: string
    host: string
    http_status: number | null
    failure_reason: FailureReason | null
    response_time_ms: number
  }>
}

export async function runTick(sb: SupabaseClient): Promise<MonitorSummary> {
  const start = performance.now()

  // Step 1 — fetch active schools.
  // Note on schema: schools.is_active is the active flag, NOT a status
  // column. We also exclude soft-deleted rows (deleted_at IS NULL).
  const { data: schools, error } = await sb
    .from('schools')
    .select('id, name, slug, custom_domain')
    .eq('is_active', true)
    .is('deleted_at', null)

  if (error) {
    throw new Error(`fetch schools: ${error.message}`)
  }
  const rows = (schools ?? []) as SchoolRow[]

  // Step 2 — probe with concurrency cap. We also keep a side-map of the
  // parsed body per school so we can persist a compacted form. This avoids
  // re-running JSON.parse later in the insert step.
  const parsedBodies = new Map<string, Record<string, unknown> | null>()
  const probeResults = await runWithConcurrency(rows, CONCURRENCY, async (school) => {
    const out = await probeSchoolWithBodyCapture(school, parsedBodies)
    return out
  })

  // Step 3 — count + persist.
  const filtered = probeResults.filter((r): r is ProbeResultRow => r !== null)
  const skipped = rows.length - filtered.length

  const insertOutcome = await insertResults(sb, filtered, parsedBodies)
  if (insertOutcome.error) {
    // Insert failure does NOT abort the tick — we still want to surface
    // the in-memory results to the operator who hit the endpoint.
    console.error('synthetic-host-monitor: insert failed', {
      error: insertOutcome.error,
      rows: filtered.length,
    })
  }

  // Step 4 — structured FAIL alerts. One console.error per failure with
  // a stable schema so log-aggregation rules can match on shape.
  for (const r of filtered) {
    if (r.ok) continue
    console.error('synthetic-host-monitor: FAIL', {
      event: 'synthetic_monitor.fail',
      school_id: r.school_id,
      school_name: r.school_name,
      host: r.host,
      http_status: r.http_status,
      response_time_ms: r.response_time_ms,
      failure_reason: r.failure_reason,
      observed_school_id: r.observed_school_id,
      // Sentry payload shape — when an Edge-Function Sentry helper lands
      // we can lift this object straight into captureMessage().
      sentry: {
        level: 'error',
        message: `synthetic-host-monitor: ${r.failure_reason ?? 'unknown'} for ${r.host}`,
        tags: { failure_reason: r.failure_reason ?? 'unknown', host: r.host },
      },
    })
  }

  return {
    checked: filtered.length,
    ok: filtered.filter((r) => r.ok).length,
    failed: filtered.filter((r) => !r.ok).length,
    skipped,
    duration_ms: Math.round(performance.now() - start),
    failures: filtered
      .filter((r) => !r.ok)
      .map((r) => ({
        school_id: r.school_id,
        school_name: r.school_name,
        host: r.host,
        http_status: r.http_status,
        failure_reason: r.failure_reason,
        response_time_ms: r.response_time_ms,
      })),
  }
}

/**
 * Same as probeSchool() but stashes the parsed JSON body in the supplied
 * map so insertResults() can persist a compacted form without re-parsing.
 */
async function probeSchoolWithBodyCapture(
  school: SchoolRow,
  parsedBodies: Map<string, Record<string, unknown> | null>,
): Promise<ProbeResultRow | null> {
  const host = resolveHostForSchool(
    { slug: school.slug, custom_domain: school.custom_domain },
    BASE_DOMAIN,
  )
  if (!host) {
    console.log('synthetic-host-monitor: skipping school with no host', {
      school_id: school.id,
      school_name: school.name,
    })
    return null
  }

  const probe = await fetchProbe(host)
  const classified = classifyProbe({ expectedSchoolId: school.id, probe })
  parsedBodies.set(school.id, classified.parsedBody)

  return {
    school_id: school.id,
    school_name: school.name,
    host,
    http_status: classified.httpStatus,
    response_time_ms: classified.responseTimeMs,
    ok: classified.ok,
    failure_reason: classified.failureReason,
    observed_school_id: classified.observedSchoolId,
  }
}

// ── HTTP entry ────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID()
  const authStarted = performance.now()
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return new Response(
      JSON.stringify({
        error:
          'synthetic-host-monitor: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is unset',
      }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    )
  }
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  })
  const auth = await verifyInternalCronRequest({ req, route: 'synthetic-host-monitor', sb, requestId, bodyText: '' })
  if (!auth.ok) {
    await auditInternalCronInvocation({ sb, route: 'synthetic-host-monitor', requestId, started: authStarted, auth, statusCode: auth.status })
    return internalCronUnauthorizedResponse(auth)
  }
  await auditInternalCronInvocation({ sb, route: 'synthetic-host-monitor', requestId, started: authStarted, auth, statusCode: 200 })
  try {
    const summary = await runTick(sb)
    console.log('synthetic-host-monitor: tick complete', {
      checked: summary.checked,
      ok: summary.ok,
      failed: summary.failed,
      skipped: summary.skipped,
      duration_ms: summary.duration_ms,
    })
    return new Response(JSON.stringify(summary), {
      headers: { 'content-type': 'application/json' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('synthetic-host-monitor: fatal', { error: message })
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
})
