/**
 * First-response-time (FRT) measurement — the falsifiability layer under the
 * published support SLA.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * `docs/runbooks/support-reply-channel-and-sla.md` (OD-A) states the rule
 * plainly: "Ops must be able to *measure* it before it is promised. There is
 * currently no first-response-time metric: `support_ticket_replies` now makes
 * it computable, but nothing computes or surfaces it yet." This module is that
 * computation. `response-sla.ts` owns the PROMISE; this file owns whether we
 * are keeping it.
 *
 * This module is PURE — no Supabase, no clock reads except the `now` you pass
 * in. It is the single definition of FRT; the API route
 * (`apps/host/src/app/api/internal/admin/support/metrics/route.ts`) and the SQL
 * view `public.support_ticket_first_response` (DDL specified in that route's
 * header, architect-owned) must both agree with it.
 *
 * ── THE DEFINITION (this is the whole deliverable) ─────────────────────────
 *   FRT = first_response_at - created_at
 *
 *   first_response_at = MIN(support_ticket_replies.created_at)
 *                       WHERE author_role IN ('operator','admin','system')
 *                         AND is_internal = false
 *
 * Deliberately EXCLUDED from "a response", each for a specific reason:
 *   * `is_internal = true` notes — the student never sees them. An operator
 *     writing a private note has not answered anybody.
 *   * requester-side replies ('student','parent','teacher','guest') — the
 *     student talking to themselves is not a response.
 *   * a bare status flip to 'resolved' with no written reply — this is the
 *     precise silent-treatment failure the whole reply channel exists to
 *     eliminate. Closing a ticket without writing to the student MUST NOT
 *     count as responding. It is counted separately and adversarially as
 *     `silentResolutions`.
 *
 * 'system' IS counted. An automated acknowledgement the student can read is a
 * real first response by the letter of the promise. If auto-ack is ever
 * shipped, this metric will get dramatically better overnight for reasons that
 * are not human effort — read `firstResponseByAuthorRole` before celebrating.
 *
 * ── UNANSWERED TICKETS COUNT AS BREACHES ───────────────────────────────────
 * A ticket with no first response whose age already exceeds the SLA is a
 * breach, not a missing data point. Excluding it would make "never reply to
 * anything" the highest-scoring strategy. See `summarizeFirstResponse`.
 *
 * ── P13 ────────────────────────────────────────────────────────────────────
 * Every input type here carries ticket UUIDs, a category string, a status
 * string and timestamps. There is deliberately no field for email, name,
 * phone, subject or message body, and none may be added — the types are the
 * enforcement.
 */

import { SUPPORT_RESPONSE_SLA } from './response-sla';

/* ══════════════════════════════════════════════════════════════════════════
 * 1. Constants
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Reply author roles that count as an operator-side response.
 *
 * Mirrors the `support_ticket_replies.author_role` CHECK's operator half
 * (migration 20260814000012). RLS pins `authenticated` inserts to
 * `author_role='student'`, so none of these is forgeable from a client
 * session — a student cannot manufacture a fast FRT for their own ticket.
 */
export const OPERATOR_AUTHOR_ROLES = ['operator', 'admin', 'system'] as const;
export type OperatorAuthorRole = (typeof OPERATOR_AUTHOR_ROLES)[number];

/**
 * Ticket statuses that mean "no longer in the operator's work queue".
 * Anything else (open, pending, and any legacy/unknown value) is treated as
 * still-open — fail toward "this needs attention" rather than silently
 * dropping a ticket off the queue because of an unrecognised status string
 * (`support_tickets.status` is free TEXT; only `priority` has a CHECK).
 */
export const CLOSED_TICKET_STATUSES = ['resolved', 'closed'] as const;

/** Minutes of coverage in one business day: 10:00 → 19:00 IST = 9h = 540m. */
export const BUSINESS_MINUTES_PER_DAY =
  (SUPPORT_RESPONSE_SLA.coverage.endHour - SUPPORT_RESPONSE_SLA.coverage.startHour) * 60;

/**
 * The PUBLISHED promise, in business minutes. Derived from
 * `SUPPORT_RESPONSE_SLA.firstResponseBusinessDays` — never hardcode "2" here.
 * If the CEO moves the promise, this moves with it and every breach number
 * re-derives automatically.
 */
export const SLA_FIRST_RESPONSE_BUSINESS_MINUTES =
  SUPPORT_RESPONSE_SLA.firstResponseBusinessDays * BUSINESS_MINUTES_PER_DAY;

/**
 * The INTERNAL stretch target (1 business day), in business minutes.
 *
 * It lives HERE and not in `response-sla.ts` on purpose: that module's
 * "Deliberate omissions" #1 forbids the internal target from sitting next to
 * the published one, because anything in a copy module can leak into
 * student-facing text and turn a stretch goal into a commitment we did not
 * make. This module is operator-only and never renders to a student.
 */
export const INTERNAL_TARGET_FIRST_RESPONSE_BUSINESS_DAYS = 1;
export const INTERNAL_TARGET_FIRST_RESPONSE_BUSINESS_MINUTES =
  INTERNAL_TARGET_FIRST_RESPONSE_BUSINESS_DAYS * BUSINESS_MINUTES_PER_DAY;

/**
 * IST is UTC+05:30 year-round. India observes no DST, so this fixed offset is
 * exact — not an approximation — and the business-hours arithmetic below needs
 * no timezone database. (The SQL twin uses `AT TIME ZONE 'Asia/Kolkata'`,
 * which resolves to the same +05:30 for every instant in the tickets' range.)
 */
const IST_OFFSET_MINUTES = 330;

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

/* ══════════════════════════════════════════════════════════════════════════
 * 2. Business-hours arithmetic
 *
 * DECISION: elapsed BUSINESS hours, not wall-clock. The promise is denominated
 * in business days over a Mon–Sat 10:00–19:00 IST window; measuring wall-clock
 * and calling it business days would be exactly the label-vs-reality defect
 * this work exists to fix. Wall-clock is still computed and returned, clearly
 * labelled `wallClock`, because it is what a student actually experiences.
 *
 * KNOWN INACCURACY — INDIAN PUBLIC HOLIDAYS ARE NOT EXCLUDED.
 * The published coverage window excludes Indian public holidays. No holiday
 * calendar exists in this repo and inventing one would be worse than omitting
 * it, so a public holiday is counted here as a normal working day.
 *
 * Direction of the error: CONSERVATIVE / PESSIMISTIC. We count hours that the
 * team was not actually on duty, so measured elapsed business time is >= the
 * true figure, and the breach count is an UPPER bound. The metric can accuse
 * us of missing the SLA when we did not; it can never quietly clear us of a
 * breach we committed. That is the safe direction for a number that exists to
 * hold us to a public promise. Worst case, a ticket filed just before a long
 * holiday weekend can over-count by up to
 * (holidays spanned x 540) business minutes.
 *
 * Feeding a holiday calendar in later is a pure additive change to
 * `businessMinutesBetween` and changes no caller.
 * ════════════════════════════════════════════════════════════════════════ */

/** Day-of-week for an IST epoch-day index. 0 = Sunday … 6 = Saturday. */
function istDayOfWeek(dayIndex: number): number {
  // Epoch day 0 (1970-01-01) was a Thursday → index 4 when 0 = Sunday.
  return (((dayIndex + 4) % 7) + 7) % 7;
}

/** True when this IST calendar day is inside the Mon–Sat coverage window. */
function isCoveredDay(dayIndex: number): boolean {
  return istDayOfWeek(dayIndex) !== 0; // Sunday is the only uncovered weekday
}

/** Count of covered (non-Sunday) days in the inclusive IST day range. */
function coveredDaysBetween(firstDay: number, lastDay: number): number {
  if (lastDay < firstDay) return 0;
  const total = lastDay - firstDay + 1;
  const fullWeeks = Math.floor(total / 7);
  let count = fullWeeks * 6; // every 7-day block holds exactly one Sunday
  const remainderStart = firstDay + fullWeeks * 7;
  for (let d = remainderStart; d <= lastDay; d++) {
    if (isCoveredDay(d)) count++;
  }
  return count;
}

/**
 * Minutes of [fromMs, toMs) that fall inside `dayIndex`'s coverage window.
 * Returns 0 for Sundays and for empty intersections.
 */
function coveredMinutesOnDay(dayIndex: number, fromMs: number, toMs: number): number {
  if (!isCoveredDay(dayIndex)) return 0;
  const dayStart = dayIndex * MS_PER_DAY;
  const open = dayStart + SUPPORT_RESPONSE_SLA.coverage.startHour * 60 * MS_PER_MINUTE;
  const close = dayStart + SUPPORT_RESPONSE_SLA.coverage.endHour * 60 * MS_PER_MINUTE;
  const overlap = Math.min(toMs, close) - Math.max(fromMs, open);
  return overlap > 0 ? overlap / MS_PER_MINUTE : 0;
}

/**
 * Elapsed BUSINESS minutes between two instants, counting only time inside
 * Mon–Sat 10:00–19:00 IST. Holidays not excluded (see the block comment above).
 *
 * Both arguments are epoch milliseconds (i.e. already timezone-independent).
 * Returns 0 when `toMs <= fromMs` — a reply that predates its ticket is a data
 * defect, not a negative response time, and clamping keeps one bad row from
 * dragging a median negative.
 *
 * Closed-form over whole days in the middle, so cost is O(1) in the span, not
 * O(days) — an unanswered ticket from two years ago is not a hot loop.
 */
export function businessMinutesBetween(fromMs: number, toMs: number): number {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return 0;
  if (toMs <= fromMs) return 0;

  // Shift into "IST wall-clock epoch" so day boundaries land on MS_PER_DAY
  // multiples and the arithmetic below needs no timezone lookups.
  const from = fromMs + IST_OFFSET_MINUTES * MS_PER_MINUTE;
  const to = toMs + IST_OFFSET_MINUTES * MS_PER_MINUTE;

  const firstDay = Math.floor(from / MS_PER_DAY);
  const lastDay = Math.floor(to / MS_PER_DAY);

  if (firstDay === lastDay) {
    return coveredMinutesOnDay(firstDay, from, to);
  }

  const head = coveredMinutesOnDay(firstDay, from, to);
  const tail = coveredMinutesOnDay(lastDay, from, to);
  const middle = coveredDaysBetween(firstDay + 1, lastDay - 1) * BUSINESS_MINUTES_PER_DAY;
  return head + middle + tail;
}

/** Elapsed wall-clock minutes. Clamped at 0 for the same reason as above. */
export function wallClockMinutesBetween(fromMs: number, toMs: number): number {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return 0;
  return toMs <= fromMs ? 0 : (toMs - fromMs) / MS_PER_MINUTE;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3. Percentiles
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Linear-interpolated percentile over an ASCENDING-sorted array.
 *
 * Deliberately matches PostgreSQL's `percentile_cont(p)` rather than
 * nearest-rank, so an operator who runs the SQL view by hand gets the same
 * number as the API. A metric that disagrees with itself depending on how you
 * ask is not a metric.
 */
export function percentileCont(sortedAsc: readonly number[], p: number): number | null {
  const n = sortedAsc.length;
  if (n === 0) return null;
  if (n === 1) return sortedAsc[0];
  const pos = p * (n - 1);
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return sortedAsc[lower];
  return sortedAsc[lower] + (sortedAsc[upper] - sortedAsc[lower]) * (pos - lower);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4. Types — P13 boundary. No PII field exists on any of these.
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * The only ticket fields this module ever sees. Note what is ABSENT and must
 * stay absent: email, user_name, subject, message, device_info, admin_notes.
 * The API route's `.select()` is narrowed to exactly these columns.
 */
export interface FrtTicketInput {
  /** support_tickets.id */
  id: string;
  /** support_tickets.category — a bounded enum-ish string, not free PII. */
  category: string | null;
  /** support_tickets.status */
  status: string | null;
  /** ISO-8601 */
  created_at: string;
  /** ISO-8601, or null. Used only to detect silent resolutions. */
  resolved_at?: string | null;
  /**
   * ISO-8601 of the first operator-authored, student-visible reply, or null.
   * The caller derives this with the exact definition above.
   */
  first_response_at: string | null;
  /** author_role of that first response, for the auto-ack sanity check. */
  first_response_author_role?: string | null;
}

/** One row of the operator work queue. P13: ids, category, status, age. */
export interface FrtQueueItem {
  ticket_id: string;
  category: string | null;
  status: string | null;
  created_at: string;
  age_business_minutes: number;
  age_wall_clock_minutes: number;
  /** Already past the published 2-business-day promise. */
  breached: boolean;
  /** Past the internal 1-business-day target but not yet the published one. */
  at_risk: boolean;
}

export interface FrtDistribution {
  median_minutes: number | null;
  p90_minutes: number | null;
}

export interface FrtSummary {
  tickets_total: number;
  responded_count: number;
  awaiting_first_response_count: number;
  /** responded / total, 0-100, 1dp. */
  response_rate_pct: number | null;
  /**
   * Resolved/closed tickets that NEVER received a student-visible operator
   * reply. The silent-treatment failure mode, counted adversarially. Every one
   * of these is also inside `breach_count` once past the SLA.
   */
  silent_resolutions: number;
  business_hours: FrtDistribution & {
    /** Published-SLA breaches: late replies + unanswered tickets past the SLA. */
    breach_count: number;
    breach_of_responded: number;
    breach_of_unanswered: number;
    breach_rate_pct: number | null;
    /** Missed the internal 1-business-day target (superset of breaches). */
    internal_target_miss_count: number;
  };
  wall_clock: FrtDistribution;
  /** Which side authored the first response. Guards against auto-ack flattery. */
  first_response_by_author_role: Record<string, number>;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5. Aggregation
 * ════════════════════════════════════════════════════════════════════════ */

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function roundNullable(n: number | null): number | null {
  return n === null ? null : round1(n);
}

function isClosed(status: string | null): boolean {
  return CLOSED_TICKET_STATUSES.includes((status ?? '') as (typeof CLOSED_TICKET_STATUSES)[number]);
}

/**
 * Reduce a set of tickets to the SLA summary.
 *
 * `nowMs` is injected (never `Date.now()` inside) so the whole thing is
 * deterministic under test — a time-dependent breach count that cannot be
 * pinned is not a verifiable metric.
 */
export function summarizeFirstResponse(
  tickets: readonly FrtTicketInput[],
  nowMs: number,
): FrtSummary {
  const businessLatencies: number[] = [];
  const wallLatencies: number[] = [];
  const byAuthorRole: Record<string, number> = {};

  let responded = 0;
  let awaiting = 0;
  let silentResolutions = 0;
  let breachResponded = 0;
  let breachUnanswered = 0;
  let internalMiss = 0;

  for (const t of tickets) {
    const createdMs = Date.parse(t.created_at);
    if (!Number.isFinite(createdMs)) continue; // unparseable row: skip, don't guess

    if (t.first_response_at) {
      const respondedMs = Date.parse(t.first_response_at);
      if (Number.isFinite(respondedMs)) {
        responded++;
        const bm = businessMinutesBetween(createdMs, respondedMs);
        businessLatencies.push(bm);
        wallLatencies.push(wallClockMinutesBetween(createdMs, respondedMs));
        if (bm > SLA_FIRST_RESPONSE_BUSINESS_MINUTES) breachResponded++;
        if (bm > INTERNAL_TARGET_FIRST_RESPONSE_BUSINESS_MINUTES) internalMiss++;
        const role = t.first_response_author_role ?? 'unknown';
        byAuthorRole[role] = (byAuthorRole[role] ?? 0) + 1;
        continue;
      }
    }

    // No first response. This is NOT a missing data point — it is an open
    // (or silently closed) obligation, and it breaches as soon as its age
    // passes the SLA. Excluding these would make "never reply" score best.
    awaiting++;
    if (isClosed(t.status) || t.resolved_at) silentResolutions++;
    const age = businessMinutesBetween(createdMs, nowMs);
    if (age > SLA_FIRST_RESPONSE_BUSINESS_MINUTES) breachUnanswered++;
    if (age > INTERNAL_TARGET_FIRST_RESPONSE_BUSINESS_MINUTES) internalMiss++;
  }

  businessLatencies.sort((a, b) => a - b);
  wallLatencies.sort((a, b) => a - b);

  const total = responded + awaiting;
  const breachCount = breachResponded + breachUnanswered;

  return {
    tickets_total: total,
    responded_count: responded,
    awaiting_first_response_count: awaiting,
    response_rate_pct: total === 0 ? null : round1((responded / total) * 100),
    silent_resolutions: silentResolutions,
    business_hours: {
      median_minutes: roundNullable(percentileCont(businessLatencies, 0.5)),
      p90_minutes: roundNullable(percentileCont(businessLatencies, 0.9)),
      breach_count: breachCount,
      breach_of_responded: breachResponded,
      breach_of_unanswered: breachUnanswered,
      breach_rate_pct: total === 0 ? null : round1((breachCount / total) * 100),
      internal_target_miss_count: internalMiss,
    },
    wall_clock: {
      median_minutes: roundNullable(percentileCont(wallLatencies, 0.5)),
      p90_minutes: roundNullable(percentileCont(wallLatencies, 0.9)),
    },
    first_response_by_author_role: byAuthorRole,
  };
}

/**
 * The operator's actual work queue: still-open tickets with no first response,
 * oldest first. More useful day-to-day than any average — this is the list you
 * work down to stop breaching.
 *
 * P13: emits ticket_id, category, status, created_at and ages. Nothing else is
 * derivable from `FrtTicketInput`, which is the point.
 */
export function buildNoResponseQueue(
  tickets: readonly FrtTicketInput[],
  nowMs: number,
  limit = 100,
): FrtQueueItem[] {
  const queue: FrtQueueItem[] = [];

  for (const t of tickets) {
    if (t.first_response_at) continue;
    if (isClosed(t.status)) continue; // silently-closed rows are counted in the
    // summary as silent_resolutions, but they are not live work
    const createdMs = Date.parse(t.created_at);
    if (!Number.isFinite(createdMs)) continue;

    const ageBusiness = businessMinutesBetween(createdMs, nowMs);
    queue.push({
      ticket_id: t.id,
      category: t.category ?? null,
      status: t.status ?? null,
      created_at: t.created_at,
      age_business_minutes: round1(ageBusiness),
      age_wall_clock_minutes: round1(wallClockMinutesBetween(createdMs, nowMs)),
      breached: ageBusiness > SLA_FIRST_RESPONSE_BUSINESS_MINUTES,
      at_risk:
        ageBusiness > INTERNAL_TARGET_FIRST_RESPONSE_BUSINESS_MINUTES &&
        ageBusiness <= SLA_FIRST_RESPONSE_BUSINESS_MINUTES,
    });
  }

  // Oldest first — the queue is worked from the top.
  queue.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  return queue.slice(0, limit);
}

/** Per-category breakdown. Category is a bounded label, never PII. */
export interface FrtCategoryRow {
  category: string;
  tickets: number;
  responded: number;
  awaiting_first_response: number;
  median_business_minutes: number | null;
  breach_count: number;
}

export function summarizeByCategory(
  tickets: readonly FrtTicketInput[],
  nowMs: number,
): FrtCategoryRow[] {
  const groups = new Map<string, FrtTicketInput[]>();
  for (const t of tickets) {
    const key = t.category ?? 'uncategorised';
    const bucket = groups.get(key);
    if (bucket) bucket.push(t);
    else groups.set(key, [t]);
  }

  const rows: FrtCategoryRow[] = [];
  for (const [category, group] of groups) {
    const s = summarizeFirstResponse(group, nowMs);
    rows.push({
      category,
      tickets: s.tickets_total,
      responded: s.responded_count,
      awaiting_first_response: s.awaiting_first_response_count,
      median_business_minutes: s.business_hours.median_minutes,
      breach_count: s.business_hours.breach_count,
    });
  }

  // Worst first: most breaches, then most tickets. The operator reads the top.
  rows.sort((a, b) => b.breach_count - a.breach_count || b.tickets - a.tickets);
  return rows;
}

/** Business minutes → business days, for human-readable reporting. */
export function businessMinutesToDays(minutes: number): number {
  return round1(minutes / BUSINESS_MINUTES_PER_DAY);
}

/**
 * Machine-readable statement of exactly what was measured, embedded in every
 * API response. A number without its definition attached is how "24 hours"
 * ended up meaning four different things across five surfaces.
 */
export const FRT_DEFINITION = {
  metric: 'first_response_time',
  measured_from: 'support_tickets.created_at',
  measured_to:
    "MIN(support_ticket_replies.created_at) WHERE author_role IN ('operator','admin','system') AND is_internal = false",
  excludes: [
    'internal operator notes (is_internal = true)',
    "requester-side replies (author_role IN ('student','parent','teacher','guest'))",
    'status flips to resolved with no written reply (counted as silent_resolutions, never as a response)',
  ],
  clock: 'business_hours',
  coverage_window: 'Mon-Sat 10:00-19:00 IST',
  business_minutes_per_day: BUSINESS_MINUTES_PER_DAY,
  published_sla_business_days: SUPPORT_RESPONSE_SLA.firstResponseBusinessDays,
  published_sla_business_minutes: SLA_FIRST_RESPONSE_BUSINESS_MINUTES,
  internal_target_business_days: INTERNAL_TARGET_FIRST_RESPONSE_BUSINESS_DAYS,
  internal_target_business_minutes: INTERNAL_TARGET_FIRST_RESPONSE_BUSINESS_MINUTES,
  unanswered_tickets_count_as_breach: true,
  known_inaccuracy:
    'Indian public holidays are NOT excluded — no holiday calendar exists in this repo and none was invented. Holiday hours are counted as working hours, so elapsed business time is an OVER-estimate and breach_count is an UPPER bound (conservative: it can over-report breaches, never hide one).',
  percentile_method: 'linear interpolation, matches PostgreSQL percentile_cont',
} as const;
