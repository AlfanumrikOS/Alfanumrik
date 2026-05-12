/**
 * src/lib/state/learner-loop/scheduled-actions.ts — pure bucket helpers
 * for the scheduled_actions projection. Computes day_bucket / week_bucket
 * / month_bucket date values in IST so the same wall-clock moment maps
 * to the same row regardless of UTC offset.
 *
 * Pure functions. No I/O. Exported so the route's upsert + the read
 * endpoint's filter share the same computation, and tests can pin
 * boundary behaviour (IST midnight, ISO week Monday, month rollover).
 *
 * Why IST: the product is India-only. Anchoring buckets to IST means
 * "today" is unambiguous for the student even if our server is in a
 * different region.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * IST start-of-day for `now`, formatted as YYYY-MM-DD (the date column
 * type in scheduled_actions). Used for horizon='daily'.
 */
export function dayBucketIst(now: Date): string {
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  const y = istNow.getUTCFullYear();
  const m = String(istNow.getUTCMonth() + 1).padStart(2, '0');
  const d = String(istNow.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * IST Monday of the ISO week containing `now`, formatted as YYYY-MM-DD.
 * Used for horizon='weekly'. ISO weeks start Monday (consistent with
 * Indian academic timetables; Sunday is the weekly_dive default day).
 */
export function weekBucketIst(now: Date): string {
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  // getUTCDay: Sun=0, Mon=1, …, Sat=6.
  // Days to subtract to get to Monday: (day===0 ? 6 : day-1).
  const dow = istNow.getUTCDay();
  const daysFromMonday = dow === 0 ? 6 : dow - 1;
  const monday = new Date(istNow.getTime() - daysFromMonday * DAY_MS);
  const y = monday.getUTCFullYear();
  const m = String(monday.getUTCMonth() + 1).padStart(2, '0');
  const d = String(monday.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * IST first-of-month for `now`, formatted as YYYY-MM-01. Used for
 * horizon='monthly'.
 */
export function monthBucketIst(now: Date): string {
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  const y = istNow.getUTCFullYear();
  const m = String(istNow.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

export type Horizon = 'daily' | 'weekly' | 'monthly';

/**
 * Bucket key for any horizon — small wrapper so the route can take a
 * horizon string and compute the right bucket without a switch.
 */
export function bucketForHorizon(horizon: Horizon, now: Date): string {
  switch (horizon) {
    case 'daily': return dayBucketIst(now);
    case 'weekly': return weekBucketIst(now);
    case 'monthly': return monthBucketIst(now);
  }
}

/**
 * Slot expiry for a horizon — the moment after which the row is stale.
 * Daily slots expire at IST next-midnight; weekly at next-Monday IST;
 * monthly at first-of-next-month IST. Returned as an ISO string for
 * direct insertion into the expires_at timestamptz column.
 */
export function expiresAtForHorizon(horizon: Horizon, now: Date): string {
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  switch (horizon) {
    case 'daily': {
      const nextMidnight = new Date(istNow);
      nextMidnight.setUTCHours(24, 0, 0, 0); // midnight tomorrow IST (as UTC components)
      return new Date(nextMidnight.getTime() - IST_OFFSET_MS).toISOString();
    }
    case 'weekly': {
      const dow = istNow.getUTCDay();
      const daysToNextMonday = dow === 0 ? 1 : 8 - dow;
      const nextMonday = new Date(istNow);
      nextMonday.setUTCHours(0, 0, 0, 0);
      nextMonday.setUTCDate(istNow.getUTCDate() + daysToNextMonday);
      return new Date(nextMonday.getTime() - IST_OFFSET_MS).toISOString();
    }
    case 'monthly': {
      const firstOfNextMonth = new Date(Date.UTC(
        istNow.getUTCFullYear(),
        istNow.getUTCMonth() + 1,
        1,
        0, 0, 0,
      ));
      return new Date(firstOfNextMonth.getTime() - IST_OFFSET_MS).toISOString();
    }
  }
}
