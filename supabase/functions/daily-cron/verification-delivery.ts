// verification-delivery.ts — pure decision logic for the silent
// verification-email failure monitor (CEO mandate, 2026-07-16).
//
// Failure mode this guards: the email provider silently disables the account
// (Mailgun, 2026-07) — Supabase keeps stamping auth.users.confirmation_sent_at
// on every signup, but no email ever arrives, so email_confirmed_at stays NULL
// forever and NOBODY notices. This module decides, from a redacted list of
// recent external signups, whether that signature is present.
//
// PURE by design: no I/O, no Deno globals, injectable clock. The daily-cron
// step (checkVerificationDelivery in index.ts) supplies rows from the
// service-role RPC get_recent_signup_verification_status (which does the
// internal/test/admin-created exclusions in SQL and returns TIMESTAMPS ONLY —
// no emails, no user ids — P13) plus the prior-alert dedup state read from
// ops_events.
//
// Trigger condition (exact, per CEO spec):
//   the VERIFICATION_STREAK_N most-recent external signups ALL have
//   confirmation_sent_at stamped, email_confirmed_at IS NULL, and
//   confirmation_sent_at older than VERIFICATION_STUCK_HOURS.
//
// Dedup: alert once per incident, keyed on the created-date of the EARLIEST
// signup in the stuck run (`verification-delivery:<YYYY-MM-DD>`); re-alert
// only if the streak GROWS (a new signup joined the stuck run) or the key
// changes (a distinct incident). Self-heal: any newer signup that confirms
// breaks the head of the streak, so the condition clears without operator
// action.

export const VERIFICATION_STREAK_N = 3
export const VERIFICATION_STUCK_HOURS = 24

// ops_events identity for this monitor. The seeded alert rule
// ('Verification email delivery stalled', migration 20260716093000) matches
// on this category at severity critical; the dedup read in the cron step
// filters on both.
export const VERIFICATION_MONITOR_CATEGORY = 'auth_email_delivery'
export const VERIFICATION_MONITOR_SOURCE = 'verification-delivery-monitor'

export interface SignupVerificationRow {
  /** auth.users.created_at (ISO timestamptz) */
  created_at: string
  /** auth.users.confirmation_sent_at — NULL means no confirmation email was ever triggered */
  confirmation_sent_at: string | null
  /** auth.users.email_confirmed_at — NULL means the user never verified */
  email_confirmed_at: string | null
}

export interface PriorVerificationAlert {
  dedup_key: string
  streak_length: number
}

export type VerificationVerdictReason =
  | 'no_rows'
  | 'head_not_stuck'
  | 'streak_below_threshold'
  | 'duplicate_incident'
  | 'alert'

export interface VerificationDeliveryVerdict {
  shouldAlert: boolean
  /** Consecutive stuck signups counted from the most recent backwards. */
  streakLength: number
  /** Stable incident key, present whenever streakLength >= threshold. */
  dedupKey: string | null
  /** created_at of the EARLIEST signup in the stuck run (ISO). */
  earliestStuckAt: string | null
  /** created_at of the LATEST signup in the stuck run (ISO). */
  latestStuckAt: string | null
  reason: VerificationVerdictReason
}

/**
 * A signup is "stuck" when a confirmation email was triggered
 * (confirmation_sent_at stamped), the user never confirmed
 * (email_confirmed_at IS NULL), and more than VERIFICATION_STUCK_HOURS have
 * passed since the send was stamped. A row with confirmation_sent_at NULL is
 * NOT stuck under this definition (that is a different failure — the send was
 * never triggered at all) and therefore breaks the streak.
 */
export function isStuckSignup(row: SignupVerificationRow, nowMs: number): boolean {
  if (!row.confirmation_sent_at || row.email_confirmed_at) return false
  const sentMs = Date.parse(row.confirmation_sent_at)
  if (Number.isNaN(sentMs)) return false
  return nowMs - sentMs > VERIFICATION_STUCK_HOURS * 3_600_000
}

/** `verification-delivery:<UTC date of the earliest stuck signup>` */
export function buildDedupKey(earliestStuckCreatedAt: string): string {
  return `verification-delivery:${earliestStuckCreatedAt.slice(0, 10)}`
}

/**
 * Decide whether to raise the stalled-verification alert.
 *
 * @param rows   Recent EXTERNAL signups (exclusions already applied by the
 *               RPC). Any order accepted; sorted most-recent-first internally
 *               so the decision is deterministic regardless of transport order.
 * @param prior  Dedup state from the last ops_event this monitor emitted, or
 *               null when none exists / state is unreadable. A null prior can
 *               only cause one duplicate alert — never a missed one.
 * @param now    Injectable clock.
 */
export function evaluateVerificationDelivery(
  rows: SignupVerificationRow[],
  prior: PriorVerificationAlert | null,
  now: Date,
): VerificationDeliveryVerdict {
  const nowMs = now.getTime()
  const none = (reason: VerificationVerdictReason, streakLength = 0): VerificationDeliveryVerdict => ({
    shouldAlert: false,
    streakLength,
    dedupKey: null,
    earliestStuckAt: null,
    latestStuckAt: null,
    reason,
  })

  if (!rows.length) return none('no_rows')

  const sorted = [...rows].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  )

  // Count the consecutive stuck run from the most recent signup backwards.
  let streak = 0
  while (streak < sorted.length && isStuckSignup(sorted[streak], nowMs)) streak++

  if (streak === 0) return none('head_not_stuck')
  if (streak < VERIFICATION_STREAK_N) return none('streak_below_threshold', streak)

  const earliest = sorted[streak - 1]
  const latest = sorted[0]
  const dedupKey = buildDedupKey(earliest.created_at)

  // Same incident, streak has not grown → stay silent.
  if (prior && prior.dedup_key === dedupKey && streak <= prior.streak_length) {
    return {
      shouldAlert: false,
      streakLength: streak,
      dedupKey,
      earliestStuckAt: earliest.created_at,
      latestStuckAt: latest.created_at,
      reason: 'duplicate_incident',
    }
  }

  return {
    shouldAlert: true,
    streakLength: streak,
    dedupKey,
    earliestStuckAt: earliest.created_at,
    latestStuckAt: latest.created_at,
    reason: 'alert',
  }
}
