// verification-delivery.test.ts — offline unit tests for the pure decision
// logic of the silent verification-email failure monitor (CEO mandate
// 2026-07-16), plus a static canary over the migration SQL that owns the
// exclusion rules (the exclusions live in SQL so emails never leave the DB —
// P13 — which means they can only be pinned offline as source text, the same
// strategy as the sibling REG-118 contract canary).
//
// Run (matching the sibling canaries in the edge-function-tests CI job):
//   deno test --no-lock --allow-read --allow-env \
//     supabase/functions/daily-cron/__tests__/

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from 'https://deno.land/std@0.210.0/assert/mod.ts';
import {
  buildDedupKey,
  evaluateVerificationDelivery,
  isStuckSignup,
  VERIFICATION_MONITOR_CATEGORY,
  VERIFICATION_MONITOR_SOURCE,
  VERIFICATION_STREAK_N,
  VERIFICATION_STUCK_HOURS,
  type SignupVerificationRow,
} from '../verification-delivery.ts';

// Fixed clock for determinism.
const NOW = new Date('2026-07-16T06:00:00Z');
const HOUR = 3_600_000;

function hoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * HOUR).toISOString();
}

/** A signup created `createdH` hours ago whose confirmation email was stamped
 * shortly after creation and never confirmed. */
function stuck(createdH: number): SignupVerificationRow {
  return {
    created_at: hoursAgo(createdH),
    confirmation_sent_at: hoursAgo(createdH - 0.01),
    email_confirmed_at: null,
  };
}

function confirmed(createdH: number): SignupVerificationRow {
  return {
    created_at: hoursAgo(createdH),
    confirmation_sent_at: hoursAgo(createdH - 0.01),
    email_confirmed_at: hoursAgo(createdH - 1),
  };
}

// ─── constants pinned ─────────────────────────────────────────────────────────

Deno.test('constants: N=3 consecutive signups, 24h stuck threshold (CEO spec)', () => {
  assertEquals(VERIFICATION_STREAK_N, 3);
  assertEquals(VERIFICATION_STUCK_HOURS, 24);
  assertEquals(VERIFICATION_MONITOR_SOURCE, 'verification-delivery-monitor');
  assertEquals(VERIFICATION_MONITOR_CATEGORY, 'auth_email_delivery');
});

// ─── isStuckSignup ────────────────────────────────────────────────────────────

Deno.test('isStuckSignup: sent >24h ago + unconfirmed = stuck', () => {
  assert(isStuckSignup(stuck(30), NOW.getTime()));
});

Deno.test('isStuckSignup: unconfirmed but <24h since send is NOT stuck yet', () => {
  assert(!isStuckSignup(stuck(23), NOW.getTime()));
});

Deno.test('isStuckSignup: confirmed signups are never stuck', () => {
  assert(!isStuckSignup(confirmed(48), NOW.getTime()));
});

Deno.test('isStuckSignup: confirmation never sent (NULL) is NOT this failure signature', () => {
  // confirmation_sent_at NULL = the send was never triggered (a different
  // failure: send-auth-email broken). Per spec the condition requires the
  // send to have been STAMPED, so this row breaks the streak.
  assert(
    !isStuckSignup({ created_at: hoursAgo(48), confirmation_sent_at: null, email_confirmed_at: null }, NOW.getTime()),
  );
});

// ─── streak detection ─────────────────────────────────────────────────────────

Deno.test('alerts when the 3 most-recent external signups are all stuck >24h', () => {
  const v = evaluateVerificationDelivery([stuck(30), stuck(40), stuck(50)], null, NOW);
  assert(v.shouldAlert);
  assertEquals(v.streakLength, 3);
  assertEquals(v.reason, 'alert');
  assertEquals(v.earliestStuckAt, hoursAgo(50));
  assertEquals(v.latestStuckAt, hoursAgo(30));
  assertEquals(v.dedupKey, buildDedupKey(hoursAgo(50)));
});

Deno.test('no alert on only 2 stuck signups (below N)', () => {
  const v = evaluateVerificationDelivery([stuck(30), stuck(40), confirmed(50)], null, NOW);
  assert(!v.shouldAlert);
  assertEquals(v.streakLength, 2);
  assertEquals(v.reason, 'streak_below_threshold');
});

Deno.test('self-heal: most recent signup confirmed breaks the streak', () => {
  const v = evaluateVerificationDelivery([confirmed(2), stuck(30), stuck(40), stuck(50)], null, NOW);
  assert(!v.shouldAlert);
  assertEquals(v.streakLength, 0);
  assertEquals(v.reason, 'head_not_stuck');
});

Deno.test('a fresh (<24h) unconfirmed signup at the head clears the condition (strict spec)', () => {
  // The newest signup is unconfirmed but not yet past 24h — per the exact CEO
  // spec the N most-recent must ALL be stuck, so no alert (it will re-arm
  // once this signup crosses 24h unconfirmed).
  const v = evaluateVerificationDelivery([stuck(5), stuck(30), stuck(40), stuck(50)], null, NOW);
  assert(!v.shouldAlert);
  assertEquals(v.streakLength, 0);
  assertEquals(v.reason, 'head_not_stuck');
});

Deno.test('a never-sent (confirmation_sent_at NULL) row breaks the streak', () => {
  const rows: SignupVerificationRow[] = [
    stuck(30),
    { created_at: hoursAgo(35), confirmation_sent_at: null, email_confirmed_at: null },
    stuck(40),
    stuck(50),
  ];
  const v = evaluateVerificationDelivery(rows, null, NOW);
  assert(!v.shouldAlert);
  assertEquals(v.streakLength, 1);
});

Deno.test('streak longer than N alerts with the full run captured', () => {
  const v = evaluateVerificationDelivery([stuck(26), stuck(30), stuck(40), stuck(50), stuck(60)], null, NOW);
  assert(v.shouldAlert);
  assertEquals(v.streakLength, 5);
  assertEquals(v.earliestStuckAt, hoursAgo(60));
});

Deno.test('empty input never alerts', () => {
  const v = evaluateVerificationDelivery([], null, NOW);
  assert(!v.shouldAlert);
  assertEquals(v.reason, 'no_rows');
});

Deno.test('input order does not matter (sorted internally by created_at desc)', () => {
  const shuffled = [stuck(50), stuck(30), stuck(40)];
  const v = evaluateVerificationDelivery(shuffled, null, NOW);
  assert(v.shouldAlert);
  assertEquals(v.latestStuckAt, hoursAgo(30));
  assertEquals(v.earliestStuckAt, hoursAgo(50));
});

// ─── exclusion handling ───────────────────────────────────────────────────────
// Internal/test/admin-created signups are excluded IN SQL (they never appear
// in the rows this function receives). The load-bearing behavior here: the
// decision is computed over the external sequence ONLY — the pure function
// must not require any additional filtering, and rows it receives are all
// eligible streak members. The SQL predicates themselves are pinned by the
// static migration canary at the bottom of this file.

Deno.test('exclusions: decision operates on the already-filtered external sequence', () => {
  // 3 external stuck signups — in production an internal auto-confirmed
  // account may exist BETWEEN them in auth.users, but the RPC never returns
  // it, so the streak is unbroken.
  const v = evaluateVerificationDelivery([stuck(28), stuck(45), stuck(70)], null, NOW);
  assert(v.shouldAlert);
  assertEquals(v.streakLength, 3);
});

// ─── dedup semantics ──────────────────────────────────────────────────────────

Deno.test('dedup key: verification-delivery:<UTC date of earliest stuck signup>', () => {
  assertEquals(
    buildDedupKey('2026-07-12T22:15:00.000Z'),
    'verification-delivery:2026-07-12',
  );
});

Deno.test('dedup: same incident + same streak length does not re-alert', () => {
  const rows = [stuck(30), stuck(40), stuck(50)];
  const first = evaluateVerificationDelivery(rows, null, NOW);
  assert(first.shouldAlert);
  const next = evaluateVerificationDelivery(
    rows,
    { dedup_key: first.dedupKey!, streak_length: first.streakLength },
    NOW,
  );
  assert(!next.shouldAlert);
  assertEquals(next.reason, 'duplicate_incident');
});

Deno.test('dedup: re-alerts when the streak GROWS (new signup joined the stuck run)', () => {
  const prior = { dedup_key: buildDedupKey(hoursAgo(50)), streak_length: 3 };
  const grown = evaluateVerificationDelivery([stuck(26), stuck(30), stuck(40), stuck(50)], prior, NOW);
  assert(grown.shouldAlert);
  assertEquals(grown.streakLength, 4);
  // Same incident anchor — the earliest stuck signup is unchanged.
  assertEquals(grown.dedupKey, prior.dedup_key);
});

Deno.test('dedup: a distinct later incident (different earliest date) alerts again', () => {
  // Prior incident anchored days earlier; current run starts at a different
  // earliest-created date → new dedup key → alert.
  const prior = { dedup_key: 'verification-delivery:2026-07-01', streak_length: 3 };
  const v = evaluateVerificationDelivery([stuck(30), stuck(40), stuck(50)], prior, NOW);
  assert(v.shouldAlert);
  assert(v.dedupKey !== prior.dedup_key);
});

Deno.test('dedup: missing/unreadable prior state degrades to alerting (never to silence)', () => {
  const v = evaluateVerificationDelivery([stuck(30), stuck(40), stuck(50)], null, NOW);
  assert(v.shouldAlert);
});

// ─── static canary: migration SQL owns the exclusions (P13) ──────────────────

const MIGRATION_PATH = new URL(
  '../../../migrations/20260716093000_verification_delivery_monitor.sql',
  import.meta.url,
);

Deno.test('migration canary: RPC excludes internal/test/admin-created/invited accounts and returns timestamps only', () => {
  const sql = Deno.readTextFileSync(MIGRATION_PATH);
  // Redacted return shape — timestamps only, no email/id columns.
  assertStringIncludes(sql, 'RETURNS TABLE (');
  assert(
    /RETURNS TABLE \(\s*created_at timestamptz,\s*confirmation_sent_at timestamptz,\s*email_confirmed_at timestamptz\s*\)/.test(sql),
    'RPC must return exactly the three timestamp columns (P13 — no emails, no ids)',
  );
  // Exclusion predicates (the SQL twin of the "external signups" definition).
  assertStringIncludes(sql, "NOT ILIKE '%@alfanumrik.com'");
  assertStringIncludes(sql, "NOT ILIKE '%.test'");
  assertStringIncludes(sql, 'NOT (u.email_confirmed_at IS NOT NULL AND u.confirmation_sent_at IS NULL)');
  assertStringIncludes(sql, 'u.invited_at IS NULL');
  // Most-recent-first contract relied on by the streak logic.
  assertStringIncludes(sql, 'ORDER BY u.created_at DESC');
  // Service-role-only execute (P8/P13 posture).
  assertStringIncludes(sql, 'REVOKE ALL ON FUNCTION public.get_recent_signup_verification_status(int, int) FROM PUBLIC');
  assertStringIncludes(sql, 'GRANT EXECUTE ON FUNCTION public.get_recent_signup_verification_status(int, int) TO service_role');
  // The seeded rule matches the monitor identity pinned in the pure module.
  assertStringIncludes(sql, "'Verification email delivery stalled'");
  assertStringIncludes(sql, `'${VERIFICATION_MONITOR_CATEGORY}'`);
  assertStringIncludes(sql, "'critical'");
});
