/**
 * ALFANUMRIK — IST (Indian Standard Time) helpers for the WhatsApp bot.
 *
 * IST is a FIXED UTC+05:30 offset with no DST — no timezone library needed.
 * Used for the conversation-window day counters (`day_ist`) and quiet-hours
 * gating (alarms and parent notes only; session replies inside an open
 * window are always allowed).
 *
 * Pure functions, fully unit-testable.
 */

/** IST offset from UTC in minutes (fixed, no DST). */
export const IST_UTC_OFFSET_MINUTES = 330;

/**
 * Shift a Date so its UTC getters read IST wall-clock time.
 *
 * NOTE: the returned Date's epoch value is deliberately offset — use ONLY
 * its `getUTC*` accessors (or `toISOString()`) to read IST components.
 */
export function istNow(d: Date = new Date()): Date {
  return new Date(d.getTime() + IST_UTC_OFFSET_MINUTES * 60_000);
}

/** IST civil date as `YYYY-MM-DD` (the `day_ist` counter-reset key). */
export function istDate(d: Date = new Date()): string {
  return istNow(d).toISOString().slice(0, 10);
}

/** IST wall-clock time as an HHMM number, e.g. 21:30 IST → 2130. */
export function istHhmm(d: Date = new Date()): number {
  const shifted = istNow(d);
  return shifted.getUTCHours() * 100 + shifted.getUTCMinutes();
}

/**
 * Whether an HHMM time falls inside a quiet-hours window.
 *
 * Handles wrap-around windows (e.g. start 2130, end 0700 spans midnight).
 * Boundaries: start is inclusive, end is exclusive. `start === end` means
 * "no quiet window" and always returns false.
 */
export function isWithinQuietHours(hhmm: number, start: number, end: number): boolean {
  if (start === end) return false;
  if (start < end) return hhmm >= start && hhmm < end;
  // Wrap-around window crossing midnight.
  return hhmm >= start || hhmm < end;
}
