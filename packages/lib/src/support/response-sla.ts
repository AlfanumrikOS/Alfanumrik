/**
 * Published support response SLA — THE single source of truth.
 *
 * ── PROVENANCE ─────────────────────────────────────────────────────────────
 * These numbers are CEO-set (decided 2026-08-11, closing OD-A in
 * `docs/runbooks/support-reply-channel-and-sla.md`). They are a staffing
 * commitment, not an engineering constant: no agent may change them without
 * the user. Read that runbook before touching this file.
 *
 * PUBLISHED promise : first response within 2 business days.
 * Coverage window   : Monday–Saturday, 10:00–19:00 IST, excluding Indian
 *                     public holidays.
 *
 * ── WHY IT LIVES HERE ──────────────────────────────────────────────────────
 * Every student/parent/guest-facing surface composes its copy from the helpers
 * below rather than inlining "2 business days". The number WILL move once
 * first-response time is actually measured (the instrumentation gap in the
 * runbook), and when it does this must be a one-line edit — not a hunt across
 * `/help`, `/support`, `/support/new`, `/parent/support` and `/contact`, which
 * is exactly how those five surfaces ended up publishing four mutually
 * contradictory promises before this module existed.
 *
 * ── DELIBERATE OMISSIONS ───────────────────────────────────────────────────
 * 1. The INTERNAL target (faster than the published one) is not in this file
 *    and must never be. It is an ops goal, not a commitment; publishing it
 *    would turn an internal stretch into a promise we did not make.
 * 2. There are NO per-category and NO per-plan SLAs. One promise, one number,
 *    until first-response time is measurable. Do not add a `billing: 1` here.
 * 3. No countdown / deadline timestamp is derived from these values. A visible
 *    timer that runs out is worse than no promise at all, so this module
 *    deliberately exposes copy only — never a target Date.
 *
 * ── CONSUMERS ──────────────────────────────────────────────────────────────
 * Copy helpers  : /help, /support, /support/new, /support/[ticket_id],
 *                 /parent/support, /contact.
 * Measurement   : `./first-response-metrics.ts` derives
 *                 SLA_FIRST_RESPONSE_BUSINESS_MINUTES from the same constant,
 *                 so the promise students read and the breach threshold ops
 *                 measures can never disagree. Move the number here and both
 *                 move. (The SQL read model documented in
 *                 apps/host/src/app/api/internal/admin/support/metrics/route.ts
 *                 restates these values as Postgres literals and CANNOT import
 *                 them — a drift test on that pair is owed to testing.)
 *
 * P7: every helper is bilingual. "IST" is a technical term and stays
 * untranslated in both languages.
 */

/** Days of the week the coverage window can start/end on. */
type CoverageDay = 'monday' | 'saturday';

export const SUPPORT_RESPONSE_SLA = {
  /** Published first-response commitment, in business days. CEO-set. */
  firstResponseBusinessDays: 2,
  coverage: {
    /** First covered day of the week (inclusive). */
    firstDay: 'monday' as CoverageDay,
    /** Last covered day of the week (inclusive). */
    lastDay: 'saturday' as CoverageDay,
    /** Window opens, 24h clock, in the timezone below. */
    startHour: 10,
    /** Window closes, 24h clock, in the timezone below. */
    endHour: 19,
    /** Technical term — never translated (P7). */
    timezone: 'IST',
    /** Indian public holidays are outside the window. */
    excludesPublicHolidays: true,
  },
} as const;

/* ── Formatting internals ─────────────────────────────────────── */

const DAY_NAMES: Record<CoverageDay, { longEn: string; shortEn: string; longHi: string; shortHi: string }> = {
  monday: { longEn: 'Monday', shortEn: 'Mon', longHi: 'सोमवार', shortHi: 'सोम' },
  saturday: { longEn: 'Saturday', shortEn: 'Sat', longHi: 'शनिवार', shortHi: 'शनि' },
};

/** 10 -> "10 AM", 19 -> "7 PM". */
function hour12En(hour24: number): string {
  const suffix = hour24 < 12 ? 'AM' : 'PM';
  const display = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${display} ${suffix}`;
}

/**
 * 10 -> "सुबह 10", 19 -> "शाम 7". Hindi marks the part of day rather than
 * using AM/PM, which is how a clock time is actually spoken.
 */
function hour12Hi(hour24: number): string {
  const display = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const partOfDay =
    hour24 < 12 ? 'सुबह' : hour24 < 16 ? 'दोपहर' : hour24 < 20 ? 'शाम' : 'रात';
  return `${partOfDay} ${display}`;
}

/* ── Public copy helpers ──────────────────────────────────────── */

/**
 * The promise fragment alone: "within 2 business days" / "2 कार्य-दिवस के भीतर".
 * Never render this without the coverage window beside it — on its own it is
 * misleading to anyone filing at 21:00 on a Saturday.
 */
export function supportFirstResponseText(isHi: boolean): string {
  // Widened from the `as const` literal on purpose: the English plural must
  // still be correct if the CEO moves the promise to 1 day, and tsc rejects a
  // `=== 1` comparison against the narrowed literal type otherwise.
  const days: number = SUPPORT_RESPONSE_SLA.firstResponseBusinessDays;
  if (isHi) return `${days} कार्य-दिवस के भीतर`;
  return `within ${days} business day${days === 1 ? '' : 's'}`;
}

/**
 * The coverage window alone:
 *   "Mon–Sat, 10 AM–7 PM IST" / "सोम–शनि, सुबह 10 से शाम 7 बजे तक, IST"
 */
export function supportCoverageText(isHi: boolean): string {
  const { firstDay, lastDay, startHour, endHour, timezone } = SUPPORT_RESPONSE_SLA.coverage;
  const from = DAY_NAMES[firstDay];
  const to = DAY_NAMES[lastDay];
  if (isHi) {
    return `${from.shortHi}–${to.shortHi}, ${hour12Hi(startHour)} से ${hour12Hi(endHour)} बजे तक, ${timezone}`;
  }
  return `${from.shortEn}–${to.shortEn}, ${hour12En(startHour)}–${hour12En(endHour)} ${timezone}`;
}

/**
 * Compact single line carrying BOTH the promise and the window. Use where
 * space is tight (list headers, card subtitles).
 */
export function supportSlaLine(isHi: boolean): string {
  if (isHi) {
    return `पहला जवाब ${supportFirstResponseText(true)} · ${supportCoverageText(true)}`;
  }
  return `First reply ${supportFirstResponseText(false)} · ${supportCoverageText(false)}`;
}

/**
 * Full plain-language version, including the public-holiday carve-out. Written
 * to be understood by a 12-year-old and by a parent. Use where there is room
 * to be complete (ticket form header, confirmation screens).
 */
export function supportSlaFull(isHi: boolean): string {
  const { firstDay, lastDay, startHour, endHour, timezone, excludesPublicHolidays } =
    SUPPORT_RESPONSE_SLA.coverage;
  const from = DAY_NAMES[firstDay];
  const to = DAY_NAMES[lastDay];

  if (isHi) {
    const holidays = excludesPublicHolidays
      ? ' सार्वजनिक छुट्टियों पर टीम बंद रहती है।'
      : '';
    return (
      `हम आपका पहला जवाब ${supportFirstResponseText(true)} भेजते हैं। ` +
      `हमारी सपोर्ट टीम ${from.longHi} से ${to.longHi} तक, ` +
      `${hour12Hi(startHour)} से ${hour12Hi(endHour)} बजे तक (${timezone}) उपलब्ध रहती है।` +
      holidays
    );
  }

  const holidays = excludesPublicHolidays ? ' We are closed on public holidays.' : '';
  return (
    `We send your first reply ${supportFirstResponseText(false)}. ` +
    `Our support team is here ${from.longEn} to ${to.longEn}, ` +
    `${hour12En(startHour)} to ${hour12En(endHour)} ${timezone}.` +
    holidays
  );
}
