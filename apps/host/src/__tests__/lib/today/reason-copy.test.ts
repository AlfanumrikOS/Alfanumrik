/**
 * /today — the reason→copy contract and the no-jargon guard (Phase 4).
 *
 * The Learner Loop resolver emits opaque machine `reason` strings. They are
 * telemetry identifiers. `todayReasonCopy` is the ONLY bridge from one of them
 * to something a child reads, and this suite pins both halves of that bridge:
 *
 *   1. COMPLETENESS — every `reason` literal declared in the resolver's own
 *      type module maps to a phrase. The list is EXTRACTED FROM SOURCE rather
 *      than hardcoded here, so adding a 13th resolver branch without adding a
 *      phrase fails this suite instead of shipping a card with no justification
 *      (or, worse, a raw `decay_above_threshold` on screen).
 *
 *   2. VOCABULARY — the output is always one of the six approved phrases, and
 *      no string anywhere in the Today copy table contains an internal model or
 *      metric name. The product audit found live jargon leaks elsewhere (`ZPD:`
 *      badges, Cohen's `d=0.54`, "Fatigue 47%"); this is the mechanical stop
 *      that keeps /today out of that list.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  todayReasonCopy,
  todayExamReasonCopy,
  todayCopy,
  isSilentTodayReason,
} from '@alfanumrik/lib/today/copy';

const REPO_ROOT = path.resolve(__dirname, '../../../../../..');
const LOOP_TYPES = path.join(
  REPO_ROOT,
  'packages/lib/src/state/learner-loop/types.ts',
);
const TODAY_COPY = path.join(REPO_ROOT, 'packages/lib/src/today/copy.ts');

/** Every `reason: 'x' | 'y'` literal declared on a LearnerAction variant. */
function resolverReasons(): string[] {
  const src = readFileSync(LOOP_TYPES, 'utf8');
  const out = new Set<string>();
  for (const line of src.split('\n')) {
    const m = /^\s*reason:\s*(.+);\s*$/.exec(line);
    if (!m) continue;
    for (const lit of m[1].matchAll(/'([a-z_]+)'/g)) out.add(lit[1]);
  }
  return [...out].sort();
}

/** Every user-visible `en:` / `hi:` string literal in the Today copy table. */
function copyStrings(): string[] {
  const src = readFileSync(TODAY_COPY, 'utf8');
  return [...src.matchAll(/\b(?:en|hi):\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
}

/** The six approved learner-facing phrases, EN. */
const APPROVED_EN = [
  'Review due',
  'Continue where you stopped',
  'Build this prerequisite',
  'Teacher assigned',
  'Prepare for your test',
  'Ready for the next concept',
];

/**
 * Internal vocabulary that must never reach a student. `\b` anchored so
 * legitimate words are not caught — note `decay` is listed, `due` is not.
 */
const JARGON = [
  'IRT', 'BKT', 'DKT', 'CME', 'SRS', 'ZPD', 'theta',
  'decay', 'probability', 'confidence', 'fatigue', 'cognitive load',
];

/**
 * The reasons that DELIBERATELY render no chip, enumerated here as an
 * INDEPENDENT copy of the production list.
 *
 * Why enumerate rather than relax the completeness rule to "phrase or null":
 * a blanket allow would make the suite pass for a brand-new resolver branch
 * that nobody mapped, which is the exact regression this file exists to catch.
 * By naming the silent set, "maps to an approved phrase OR is one of THESE
 * three" keeps the self-extending property — a 13th reason satisfies neither
 * arm and fails.
 *
 * The list is duplicated rather than imported so it is a real assertion about
 * production and not a tautology: `isSilentTodayReason` is checked AGAINST this
 * literal below, so silencing a fourth reason in production without a
 * deliberate edit here fails the suite.
 *
 * Each entry's justification (a reason line is a CLAIM ABOUT THE LEARNER; a
 * branch that consulted only the calendar has no claim to make):
 *   - sunday_default   → predicate is `isSundayIst(now)` alone; the item is a
 *     Curiosity Dive, deliberately outside the concept sequence.
 *   - month_end_default → predicate is `isMonthEndDayIst(now)` alone; nothing
 *     is due and nothing is being reviewed, and "Review due" collides with
 *     `today.item.srs_due.label` ("Reviews due").
 *   - no_signals_yet   → fires because we know NOTHING about this learner, and
 *     contradicts its own card ("Find your starting point / a quick
 *     diagnostic").
 */
const SILENT_REASONS = ['sunday_default', 'month_end_default', 'no_signals_yet'];

describe('resolver reason → learner copy: completeness', () => {
  it('extracts the resolver reason set from source (sanity: it found them)', () => {
    const reasons = resolverReasons();
    expect(reasons.length).toBeGreaterThanOrEqual(12);
    // Spot-check a few so a broken regex cannot silently pass the suite.
    expect(reasons).toContain('todays_zpd');
    expect(reasons).toContain('decay_above_threshold');
    expect(reasons).toContain('teacher_assigned');
  });

  it('the deliberate no-chip set is exactly the three calendar-driven reasons', () => {
    // Pins production's silent set against this file's enumeration in BOTH
    // directions, so neither can drift without the other.
    for (const reason of SILENT_REASONS) {
      expect(isSilentTodayReason(reason), `${reason} should be a known silent reason`).toBe(true);
    }
    for (const reason of resolverReasons()) {
      if (SILENT_REASONS.includes(reason)) continue;
      expect(
        isSilentTodayReason(reason),
        `${reason} was silenced in production without being enumerated in this test`,
      ).toBe(false);
    }
    // Every silent reason must be a REAL resolver reason, not a stale literal.
    for (const reason of SILENT_REASONS) {
      expect(resolverReasons()).toContain(reason);
    }
  });

  it.each(resolverReasons())(
    'maps %s to an approved phrase (EN), or deliberately to no chip',
    (reason) => {
      const copy = todayReasonCopy(reason, false);
      if (SILENT_REASONS.includes(reason)) {
        // Silence is the CONTRACT for these, not an oversight: the branch
        // determined nothing about the learner, so there is no honest claim.
        expect(copy, `reason "${reason}" must render no chip`).toBeNull();
        return;
      }
      expect(copy, `reason "${reason}" has no learner-facing phrase`).not.toBeNull();
      expect(APPROVED_EN).toContain(copy);
    },
  );

  it.each(resolverReasons())(
    'maps %s to a non-empty Hindi phrase, or deliberately to no chip',
    (reason) => {
      const hi = todayReasonCopy(reason, true);
      if (SILENT_REASONS.includes(reason)) {
        expect(hi).toBeNull();
        return;
      }
      expect(hi).toBeTruthy();
      // Hindi copy must actually be Hindi, not the English string echoed back.
      expect(hi).not.toBe(todayReasonCopy(reason, false));
      expect(hi).toMatch(/[ऀ-ॿ]/);
    },
  );

  it('a silent reason renders nothing in BOTH languages (no half-suppressed chip)', () => {
    for (const reason of SILENT_REASONS) {
      expect(todayReasonCopy(reason, false)).toBeNull();
      expect(todayReasonCopy(reason, true)).toBeNull();
    }
  });

  it('the two dishonest mappings are gone: no reason claims readiness or a due review from a DATE', () => {
    // Regression pin for the Phase 4 assessment finding. `sunday_default`
    // asserted "Ready for the next concept" off `isSundayIst` alone, and
    // `month_end_default` asserted "Review due" off `isMonthEndDayIst` alone
    // — the latter colliding with the SRS card's own "Reviews due" label.
    expect(todayReasonCopy('sunday_default', false)).not.toBe('Ready for the next concept');
    expect(todayReasonCopy('month_end_default', false)).not.toBe('Review due');
    expect(todayReasonCopy('no_signals_yet', false)).not.toBe('Ready for the next concept');
    // "Review due" must remain reachable from a reason that REALLY means it.
    expect(todayReasonCopy('decay_above_threshold', false)).toBe('Review due');
    // And the SRS card label it used to collide with is untouched.
    expect(todayCopy('today.item.srs_due.label', false)).toBe('Reviews due');
  });

  it('returns null (renders nothing) for an unknown reason rather than the raw key', () => {
    expect(todayReasonCopy('some_future_branch', false)).toBeNull();
    expect(todayReasonCopy('some_future_branch', true)).toBeNull();
    // …and an unknown reason is NOT a "deliberately silent" one. This is the
    // distinction that keeps the completeness test above from degenerating
    // into a blanket allow.
    expect(isSilentTodayReason('some_future_branch')).toBe(false);
  });

  it('never returns the machine reason itself', () => {
    for (const reason of resolverReasons()) {
      expect(todayReasonCopy(reason, false)).not.toBe(reason);
      expect(todayReasonCopy(reason, true)).not.toBe(reason);
    }
  });

  it('exposes the sixth approved phrase via the exam reminder', () => {
    // No resolver reason produces "Prepare for your test" — the loop has no
    // exam branch — so it is emitted from the real exam schedule instead of
    // being fabricated from a learner-state reason.
    expect(todayExamReasonCopy(false)).toBe('Prepare for your test');
    expect(todayExamReasonCopy(true)).toMatch(/[ऀ-ॿ]/);
    const mapped = resolverReasons().map((r) => todayReasonCopy(r, false));
    expect(mapped).not.toContain('Prepare for your test');
  });
});

describe('Today copy table: no internal vocabulary', () => {
  const strings = copyStrings();

  it('found copy strings to check (sanity)', () => {
    expect(strings.length).toBeGreaterThan(40);
  });

  it.each(JARGON)('no user-visible string contains "%s"', (term) => {
    const re = new RegExp(`\\b${term}\\b`, 'i');
    const offenders = strings.filter((s) => re.test(s));
    expect(offenders, `jargon "${term}" found in: ${offenders.join(' | ')}`).toEqual([]);
  });

  it('every approved phrase is actually reachable from the copy table', () => {
    const keys = [
      'today.reason.review',
      'today.reason.continue',
      'today.reason.prerequisite',
      'today.reason.teacher',
      'today.reason.exam',
      'today.reason.nextConcept',
    ];
    expect(keys.map((k) => todayCopy(k, false)).sort()).toEqual([...APPROVED_EN].sort());
  });
});
