/**
 * projector-health-check — Alfanumrik Edge Function
 *
 * Invoked every 2 minutes by pg_cron via pg_net.http_post (see migration
 * 20260526100000_projector_health_check_cron.sql). Reads
 * `public.subscriber_lag` (created in 20260524110001_state_runtime_per_subscriber.sql)
 * and emits one `projector_health_degraded` PostHog event per subscriber that
 * exceeds the SLO thresholds defined in docs/architecture/SLO.md.
 *
 * Thresholds (from docs/architecture/SLO.md "Projector lag" row):
 *   - warn      ≥ 5 s
 *   - critical  ≥ 30 s
 *
 * Severity gating:
 *   - A subscriber is only "lagged" if events_behind > 0. The view's
 *     `age_behind` column is `now() - last_processed_occurred_at`, which
 *     is non-zero even for caught-up subscribers; using it alone would
 *     page on healthy state.
 *   - events_dead_lettered > 0 is always at least `warn` regardless of age,
 *     because a dead letter is a stuck event by definition.
 *
 * Kill-switch: honors `ff_projector_runner_v1`. When the runner is OFF,
 * nothing is advancing the cursors, so monitoring lag is meaningless —
 * the function returns `{ skipped: true, reason: 'runner_flag_off' }`.
 * This matches the pattern in projector-runner/index.ts.
 *
 * Failure posture:
 *   - Env missing → 500 with structured error code
 *   - Flag read fails → 500 with structured error code
 *   - View query fails → 500 with structured error code
 *   - PostHog capture fails → swallowed (analytics must not page on its own
 *     failure; the response JSON is the ground truth for cron logs)
 *   - Any other throw → 500 with sanitized message
 *
 * Operator response runbook: docs/runbooks/projector-failure.md
 * Dead-letter triage runbook:  docs/runbooks/dead-letter-inspection.md
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { capture as posthogCapture } from '../_shared/posthog.ts'
import { auditInternalCronInvocation, internalCronUnauthorizedResponse, verifyInternalCronRequest } from '../_shared/security/internal-cron-auth.ts'

// ─── SLO thresholds ──────────────────────────────────────────────────────────
// Mirrors docs/architecture/SLO.md "Projector lag" row. Update both together.

const LAG_WARN_SECONDS = 5
const LAG_CRITICAL_SECONDS = 30

// ─── Env ─────────────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const PROJECTOR_RUNNER_FLAG = 'ff_projector_runner_v1'

// ─── Types ───────────────────────────────────────────────────────────────────

interface SubscriberLagRow {
  subscriber_name: string
  kind_filter: string
  last_processed_occurred_at: string | null
  events_processed: number
  events_dead_lettered: number
  events_behind: number
  events_in_retry: number
  /**
   * Postgres INTERVAL as serialized by PostgREST. Format is either
   * `HH:MM:SS[.fff]` for sub-day durations or `<n> days HH:MM:SS` for
   * longer. Parsed by intervalToSeconds().
   */
  age_behind: string
}

type Severity = 'ok' | 'warn' | 'critical'

interface Evaluation {
  subscriber_name: string
  kind_filter: string
  events_behind: number
  events_in_retry: number
  events_dead_lettered: number
  age_behind_seconds: number
  severity: Severity
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse a PostgREST-serialized Postgres INTERVAL into seconds.
 * Accepts:
 *   "00:00:30"             → 30
 *   "00:01:30.500"         → 90.5
 *   "1 day 02:30:00"       → 95400
 *   "2 days 00:00:00"      → 172800
 * Returns 0 for null/empty/unparseable input — a missing interval is
 * treated as "no lag" rather than as a parsing alert.
 */
function intervalToSeconds(interval: string | null | undefined): number {
  if (!interval || typeof interval !== 'string') return 0
  let totalSec = 0
  const dayMatch = interval.match(/(\d+)\s+days?/)
  if (dayMatch) totalSec += parseInt(dayMatch[1], 10) * 86400
  const timeMatch = interval.match(/(\d+):(\d+):(\d+)(?:\.(\d+))?/)
  if (timeMatch) {
    totalSec += parseInt(timeMatch[1], 10) * 3600
    totalSec += parseInt(timeMatch[2], 10) * 60
    totalSec += parseInt(timeMatch[3], 10)
    if (timeMatch[4]) totalSec += parseFloat(`0.${timeMatch[4]}`)
  }
  return totalSec
}

function evaluateRow(row: SubscriberLagRow): Evaluation {
  const ageSec = intervalToSeconds(row.age_behind)
  let severity: Severity = 'ok'

  // Lag is meaningful only when there are events to process.
  if (row.events_behind > 0) {
    if (ageSec >= LAG_CRITICAL_SECONDS) severity = 'critical'
    else if (ageSec >= LAG_WARN_SECONDS) severity = 'warn'
  }

  // Dead letters are always concerning. Promote to warn if not already
  // critical from lag.
  if (row.events_dead_lettered > 0 && severity === 'ok') {
    severity = 'warn'
  }

  return {
    subscriber_name: row.subscriber_name,
    kind_filter: row.kind_filter,
    events_behind: row.events_behind,
    events_in_retry: row.events_in_retry,
    events_dead_lettered: row.events_dead_lettered,
    age_behind_seconds: ageSec,
    severity,
  }
}

function thresholdFor(severity: Severity): number {
  return severity === 'critical' ? LAG_CRITICAL_SECONDS : LAG_WARN_SECONDS
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// ─── Entry point ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID()
  const authStarted = performance.now()
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return jsonResponse(
      {
        error: 'env_missing',
        detail:
          'projector-health-check: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is unset',
      },
      500,
    )
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  })
  const auth = await verifyInternalCronRequest({ req, route: 'projector-health-check', sb, requestId, bodyText: '' })
  if (!auth.ok) {
    await auditInternalCronInvocation({ sb, route: 'projector-health-check', requestId, started: authStarted, auth, statusCode: auth.status })
    return internalCronUnauthorizedResponse(auth)
  }
  await auditInternalCronInvocation({ sb, route: 'projector-health-check', requestId, started: authStarted, auth, statusCode: 200 })
  const start = performance.now()

  try {
    // Step 1: Honor the runner kill-switch. If the runner is OFF, nothing
    // is advancing cursors — monitoring lag would produce false positives.
    const { data: flagRow, error: flagErr } = await sb
      .from('feature_flags')
      .select('is_enabled')
      .eq('flag_name', PROJECTOR_RUNNER_FLAG)
      .maybeSingle()

    if (flagErr) {
      console.error('[projector-health-check] flag read failed:', flagErr.message)
      return jsonResponse(
        { error: 'flag_read_failed', detail: flagErr.message },
        500,
      )
    }

    if (!flagRow?.is_enabled) {
      const durationMs = Math.round(performance.now() - start)
      return jsonResponse({
        skipped: true,
        reason: 'runner_flag_off',
        duration_ms: durationMs,
      })
    }

    // Step 2: Read the lag view.
    const { data: rows, error: viewErr } = await sb
      .from('subscriber_lag')
      .select(
        'subscriber_name, kind_filter, last_processed_occurred_at, events_processed, events_dead_lettered, events_behind, events_in_retry, age_behind',
      )
      .returns<SubscriberLagRow[]>()

    if (viewErr) {
      console.error(
        '[projector-health-check] subscriber_lag query failed:',
        viewErr.message,
      )
      return jsonResponse(
        { error: 'view_query_failed', detail: viewErr.message },
        500,
      )
    }

    const subscribers = rows ?? []

    // Step 3: Evaluate.
    const evaluations: Evaluation[] = subscribers.map(evaluateRow)
    const degraded = evaluations.filter((e) => e.severity !== 'ok')
    const critical = degraded.filter((e) => e.severity === 'critical')

    // Step 4: Emit one PostHog event per degraded subscriber. Fire-and-forget;
    // analytics failures must not fail the response.
    await Promise.all(
      degraded.map((e) =>
        posthogCapture(
          'projector_health_degraded',
          'projector-health-check',
          {
            subscriber_name: e.subscriber_name,
            kind_filter: e.kind_filter,
            events_behind: e.events_behind,
            events_in_retry: e.events_in_retry,
            events_dead_lettered: e.events_dead_lettered,
            age_behind_seconds: e.age_behind_seconds,
            severity: e.severity,
            threshold_seconds: thresholdFor(e.severity),
          },
        ).catch(() => {
          /* analytics failures swallowed by design — see header comment */
        }),
      ),
    )

    const durationMs = Math.round(performance.now() - start)

    if (critical.length > 0) {
      // Surface critical state in Edge Function logs so the operator can
      // grep without leaving the Supabase dashboard.
      const names = critical.map((c) => c.subscriber_name).join(', ')
      console.warn(
        `[projector-health-check] CRITICAL: ${critical.length} subscriber(s) lagging >= ${LAG_CRITICAL_SECONDS}s -- ${names}`,
      )
    }

    return jsonResponse({
      checked_subscribers: subscribers.length,
      degraded_count: degraded.length,
      critical_count: critical.length,
      duration_ms: durationMs,
      evaluations,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[projector-health-check] fatal:', msg)
    return jsonResponse({ error: 'fatal', detail: msg.slice(0, 500) }, 500)
  }
})
