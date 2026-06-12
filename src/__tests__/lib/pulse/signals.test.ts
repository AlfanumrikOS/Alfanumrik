/**
 * Unit tests for src/lib/pulse/signals.ts
 *
 * Locks down the Student Pulse signal-derivation math against the EXISTING
 * platform conventions it is anchored to:
 *   - at-risk mastery line = 0.4 (phase3b_school_reporting + cognitive-engine)
 *   - streak-reset window = UTC-calendar-day boundary (daily-cron
 *     resetMissedStreaks: last activity < yesterday-00:00 UTC => reset)
 *   - mastery_changed payload shape = { fromMastery: number|null, toMastery }
 *
 * Covers EVERY verdict branch + threshold boundary + edge case:
 *   inactivity: ok / at_risk / broken / never / unknown, freeze softening,
 *               exactly-at-boundary day counts.
 *   mastery-cliff: none / flagged (drop path + decline path + cross-below-0.4)
 *                  / unknown (no history), exactly-at-threshold drop + streak.
 *   concentration: none / low / medium / high bands, exact band boundaries,
 *                  empty subjects, worst-first ordering, worstBand rollup.
 */

import { describe, it, expect } from 'vitest';
import {
  deriveSignals,
  deriveInactivity,
  deriveMasteryCliff,
  deriveAtRiskConcentration,
  PULSE_THRESHOLDS,
  type PulseRawInput,
} from '@/lib/pulse/signals';

const MS_PER_DAY = 86_400_000;

// A fixed "now" pinned to a UTC-midnight-ish instant so calendar-day math is
// deterministic. 2026-06-12T12:00:00Z — noon on the 12th.
const NOW = Date.UTC(2026, 5, 12, 12, 0, 0);

/** ms epoch for noon `n` whole UTC days before NOW's UTC date. */
function daysAgoNoon(n: number): number {
  return Date.UTC(2026, 5, 12 - n, 12, 0, 0);
}

function baseInput(overrides: Partial<PulseRawInput> = {}): PulseRawInput {
  return { nowMs: NOW, ...overrides };
}

// ════════════════════════════════════════════════════════════════════════════
// INACTIVITY
// ════════════════════════════════════════════════════════════════════════════

describe('deriveInactivity', () => {
  it("verdict 'ok' when active today (0 UTC days ago)", () => {
    const r = deriveInactivity(baseInput({ lastActiveMs: daysAgoNoon(0) }));
    expect(r.verdict).toBe('ok');
    expect(r.daysSinceActive).toBe(0);
  });

  it("verdict 'ok' at the exact same-UTC-day boundary (earlier today)", () => {
    // Active at 00:01 UTC today, now is noon today — still same UTC day => ok.
    const earlierToday = Date.UTC(2026, 5, 12, 0, 1, 0);
    const r = deriveInactivity(baseInput({ lastActiveMs: earlierToday }));
    expect(r.verdict).toBe('ok');
    expect(r.daysSinceActive).toBe(0);
  });

  it("verdict 'at_risk' on the grace day (active yesterday, 1 UTC day ago)", () => {
    const r = deriveInactivity(baseInput({ lastActiveMs: daysAgoNoon(1) }));
    expect(r.verdict).toBe('at_risk');
    expect(r.daysSinceActive).toBe(1);
  });

  it("grace day is at_risk even WITH a freeze (streak intact today, resets tonight)", () => {
    const r = deriveInactivity(
      baseInput({ lastActiveMs: daysAgoNoon(1), hasStreakFreeze: true }),
    );
    expect(r.verdict).toBe('at_risk');
  });

  it("verdict 'broken' once 2 UTC days have passed (streak eligible for reset)", () => {
    const r = deriveInactivity(baseInput({ lastActiveMs: daysAgoNoon(2) }));
    expect(r.verdict).toBe('broken');
    expect(r.daysSinceActive).toBe(2);
  });

  it("broken softens to 'at_risk' when a streak freeze is available", () => {
    const r = deriveInactivity(
      baseInput({ lastActiveMs: daysAgoNoon(3), hasStreakFreeze: true }),
    );
    expect(r.verdict).toBe('at_risk');
    expect(r.daysSinceActive).toBe(3);
  });

  it("verdict 'broken' for long inactivity with no freeze", () => {
    const r = deriveInactivity(baseInput({ lastActiveMs: daysAgoNoon(30) }));
    expect(r.verdict).toBe('broken');
    expect(r.daysSinceActive).toBe(30);
  });

  it("verdict 'never' when lastActiveMs is null (never active)", () => {
    const rNull = deriveInactivity(baseInput({ lastActiveMs: null }));
    expect(rNull.verdict).toBe('never');
    expect(rNull.daysSinceActive).toBeNull();
  });

  it("verdict 'never' when lastActiveMs is undefined", () => {
    const r = deriveInactivity(baseInput()); // no lastActiveMs
    expect(r.verdict).toBe('never');
    expect(r.daysSinceActive).toBeNull();
  });

  it("verdict 'unknown' when lastActiveMs is non-finite (NaN/Infinity)", () => {
    const rNaN = deriveInactivity(baseInput({ lastActiveMs: NaN }));
    expect(rNaN.verdict).toBe('unknown');
    expect(rNaN.daysSinceActive).toBeNull();

    const rInf = deriveInactivity(baseInput({ lastActiveMs: Infinity }));
    expect(rInf.verdict).toBe('unknown');
  });

  it("clamps a future last-active to 0 days (verdict 'ok', never negative)", () => {
    const future = NOW + 5 * MS_PER_DAY;
    const r = deriveInactivity(baseInput({ lastActiveMs: future }));
    expect(r.verdict).toBe('ok');
    expect(r.daysSinceActive).toBe(0);
  });

  it('uses the UTC-calendar boundary, not a rolling 24h window', () => {
    // Active at 23:59 UTC yesterday; now is 00:01 UTC today. Only ~2 minutes
    // of wall-clock, but it crosses the UTC-midnight boundary => 1 day => grace.
    const nowEarly = Date.UTC(2026, 5, 12, 0, 1, 0);
    const lastLateYesterday = Date.UTC(2026, 5, 11, 23, 59, 0);
    const r = deriveInactivity({
      nowMs: nowEarly,
      lastActiveMs: lastLateYesterday,
    });
    expect(r.daysSinceActive).toBe(1);
    expect(r.verdict).toBe('at_risk');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// MASTERY-CLIFF
// ════════════════════════════════════════════════════════════════════════════

describe('deriveMasteryCliff', () => {
  it("verdict 'unknown' with no history at all (no events, no scores)", () => {
    const r = deriveMasteryCliff(baseInput());
    expect(r.verdict).toBe('unknown');
    expect(r.largestDrop).toBeNull();
    expect(r.declineStreak).toBe(0);
    expect(r.worstSubject).toBeNull();
    expect(r.worstChapter).toBeNull();
  });

  it("verdict 'unknown' when events have only null fromMastery (first attempts) and <2 scores", () => {
    const r = deriveMasteryCliff(
      baseInput({
        masteryEvents: [
          { subjectCode: 'math', chapterNumber: 3, fromMastery: null, toMastery: 0.5 },
        ],
        recentQuizScores: [80], // only one score
      }),
    );
    expect(r.verdict).toBe('unknown');
    expect(r.largestDrop).toBeNull();
  });

  it("verdict 'none' when a mastery delta exists but no drop qualifies", () => {
    const r = deriveMasteryCliff(
      baseInput({
        masteryEvents: [
          // a small drop below the cliff threshold, staying above 0.4
          { subjectCode: 'science', chapterNumber: 2, fromMastery: 0.8, toMastery: 0.72 },
        ],
      }),
    );
    expect(r.verdict).toBe('none');
    expect(r.largestDrop).toBeCloseTo(0.08, 6);
  });

  it("verdict 'flagged' on a single-event drop exactly at the threshold (0.15)", () => {
    const drop = PULSE_THRESHOLDS.mastery_cliff_drop; // 0.15
    const r = deriveMasteryCliff(
      baseInput({
        masteryEvents: [
          { subjectCode: 'math', chapterNumber: 5, fromMastery: 0.9, toMastery: 0.9 - drop },
        ],
      }),
    );
    expect(r.verdict).toBe('flagged');
    expect(r.largestDrop).toBeCloseTo(drop, 6);
    expect(r.worstSubject).toBe('math');
    expect(r.worstChapter).toBe(5);
  });

  it("does NOT flag a drop just under the threshold that stays above 0.4", () => {
    const justUnder = PULSE_THRESHOLDS.mastery_cliff_drop - 0.001;
    const r = deriveMasteryCliff(
      baseInput({
        masteryEvents: [
          { subjectCode: 'math', chapterNumber: 5, fromMastery: 0.9, toMastery: 0.9 - justUnder },
        ],
      }),
    );
    expect(r.verdict).toBe('none');
  });

  it("verdict 'flagged' when a SMALL drop crosses below the 0.4 at-risk line", () => {
    // drop is only 0.06 (< 0.15), but it crosses from >=0.4 to <0.4 => cliff.
    const r = deriveMasteryCliff(
      baseInput({
        masteryEvents: [
          { subjectCode: 'english', chapterNumber: 1, fromMastery: 0.42, toMastery: 0.36 },
        ],
      }),
    );
    expect(r.verdict).toBe('flagged');
    expect(r.largestDrop).toBeCloseTo(0.06, 6);
  });

  it("a drop that stays at exactly 0.4 does NOT count as crossing below", () => {
    // from 0.5 -> 0.4: toMastery is NOT < 0.4, and drop 0.1 < 0.15 => none.
    const r = deriveMasteryCliff(
      baseInput({
        masteryEvents: [
          { subjectCode: 'hindi', chapterNumber: 4, fromMastery: 0.5, toMastery: 0.4 },
        ],
      }),
    );
    expect(r.verdict).toBe('none');
  });

  it("reports the LARGEST drop across multiple decline events", () => {
    const r = deriveMasteryCliff(
      baseInput({
        masteryEvents: [
          { subjectCode: 'math', chapterNumber: 1, fromMastery: 0.7, toMastery: 0.62 }, // 0.08
          { subjectCode: 'science', chapterNumber: 9, fromMastery: 0.9, toMastery: 0.5 }, // 0.40
          { subjectCode: 'english', chapterNumber: 2, fromMastery: 0.6, toMastery: 0.58 }, // 0.02
        ],
      }),
    );
    expect(r.verdict).toBe('flagged');
    expect(r.largestDrop).toBeCloseTo(0.4, 6);
    expect(r.worstSubject).toBe('science');
    expect(r.worstChapter).toBe(9);
  });

  it("ignores increases and null-from events when measuring drops", () => {
    const r = deriveMasteryCliff(
      baseInput({
        masteryEvents: [
          { subjectCode: 'math', chapterNumber: 1, fromMastery: 0.3, toMastery: 0.6 }, // increase
          { subjectCode: 'math', chapterNumber: 2, fromMastery: null, toMastery: 0.1 }, // first attempt
        ],
      }),
    );
    // No usable drop. fromMastery exists on event 1 (delta history present) so
    // not 'unknown' — verdict 'none'.
    expect(r.verdict).toBe('none');
    expect(r.largestDrop).toBeNull();
  });

  it("verdict 'flagged' via the decline-streak path at exactly 3 declines", () => {
    // 4 scores, each lower than the last => 3 decline STEPS == threshold.
    const r = deriveMasteryCliff(
      baseInput({ recentQuizScores: [90, 80, 70, 60] }),
    );
    expect(r.verdict).toBe('flagged');
    expect(r.declineStreak).toBe(PULSE_THRESHOLDS.mastery_cliff_decline_streak);
  });

  it("does NOT flag the decline path at only 2 consecutive declines", () => {
    const r = deriveMasteryCliff(
      baseInput({ recentQuizScores: [90, 80, 70] }),
    );
    expect(r.verdict).toBe('none');
    expect(r.declineStreak).toBe(2);
  });

  it("resets the decline run on a non-decline (longest run wins, stays sub-threshold)", () => {
    // declines: 90>80 (run 1), 85 breaks it, 85>80>70 (run 2). Longest run is
    // 2 < threshold(3) => 'none'. Verifies the run resets at the 80->85 bump.
    const r = deriveMasteryCliff(
      baseInput({ recentQuizScores: [90, 80, 85, 80, 70] }),
    );
    expect(r.declineStreak).toBe(2);
    expect(r.verdict).toBe('none');
  });

  it("picks the LONGEST decline run after a reset (flags when the 2nd run >=3)", () => {
    // 90>80 (run 1), 90 bumps it (reset), then 90>70>60>50 (run 3) => flagged.
    const r = deriveMasteryCliff(
      baseInput({ recentQuizScores: [90, 80, 90, 70, 60, 50] }),
    );
    expect(r.declineStreak).toBe(3);
    expect(r.verdict).toBe('flagged');
  });

  it("flags a long uninterrupted decline run (>=3)", () => {
    const r = deriveMasteryCliff(
      baseInput({ recentQuizScores: [100, 90, 80, 70, 60, 50] }),
    );
    expect(r.verdict).toBe('flagged');
    expect(r.declineStreak).toBe(5);
  });

  it("treats equal adjacent scores as NOT a decline (strict)", () => {
    const r = deriveMasteryCliff(
      baseInput({ recentQuizScores: [70, 70, 70, 70] }),
    );
    expect(r.verdict).toBe('none');
    expect(r.declineStreak).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// AT-RISK CONCENTRATION
// ════════════════════════════════════════════════════════════════════════════

describe('deriveAtRiskConcentration', () => {
  it('empty subjects => no bands, worstBand none, zero total', () => {
    const r = deriveAtRiskConcentration(baseInput({ subjectSnapshots: [] }));
    expect(r.bySubject).toEqual([]);
    expect(r.worstBand).toBe('none');
    expect(r.totalAtRiskChapters).toBe(0);
  });

  it("undefined subjectSnapshots => empty result", () => {
    const r = deriveAtRiskConcentration(baseInput());
    expect(r.bySubject).toEqual([]);
    expect(r.worstBand).toBe('none');
  });

  it("band 'none' when zero chapters are below 0.4", () => {
    const r = deriveAtRiskConcentration(
      baseInput({
        subjectSnapshots: [{ subject: 'math', chapterMasteries: [0.4, 0.5, 0.9] }],
      }),
    );
    expect(r.bySubject[0].atRiskChapterCount).toBe(0);
    expect(r.bySubject[0].band).toBe('none');
    expect(r.worstBand).toBe('none');
  });

  it("mastery exactly at 0.4 is NOT at-risk (strict < 0.4)", () => {
    const r = deriveAtRiskConcentration(
      baseInput({
        subjectSnapshots: [{ subject: 'math', chapterMasteries: [0.4, 0.4, 0.4] }],
      }),
    );
    expect(r.bySubject[0].atRiskChapterCount).toBe(0);
    expect(r.bySubject[0].band).toBe('none');
  });

  it("band 'low' at exactly 1 at-risk chapter (lower boundary)", () => {
    const r = deriveAtRiskConcentration(
      baseInput({
        subjectSnapshots: [{ subject: 'science', chapterMasteries: [0.39, 0.5] }],
      }),
    );
    expect(r.bySubject[0].atRiskChapterCount).toBe(1);
    expect(r.bySubject[0].band).toBe('low');
    expect(r.worstBand).toBe('low');
  });

  it("band 'low' at 2 (just below medium boundary)", () => {
    const r = deriveAtRiskConcentration(
      baseInput({
        subjectSnapshots: [{ subject: 'science', chapterMasteries: [0.1, 0.2] }],
      }),
    );
    expect(r.bySubject[0].atRiskChapterCount).toBe(2);
    expect(r.bySubject[0].band).toBe('low');
  });

  it("band 'medium' at exactly 3 at-risk chapters (medium boundary)", () => {
    const r = deriveAtRiskConcentration(
      baseInput({
        subjectSnapshots: [{ subject: 'english', chapterMasteries: [0.1, 0.2, 0.3] }],
      }),
    );
    expect(r.bySubject[0].atRiskChapterCount).toBe(3);
    expect(r.bySubject[0].band).toBe('medium');
    expect(r.worstBand).toBe('medium');
  });

  it("band 'medium' at 4 (just below high boundary)", () => {
    const r = deriveAtRiskConcentration(
      baseInput({
        subjectSnapshots: [{ subject: 'english', chapterMasteries: [0.1, 0.2, 0.3, 0.35] }],
      }),
    );
    expect(r.bySubject[0].atRiskChapterCount).toBe(4);
    expect(r.bySubject[0].band).toBe('medium');
  });

  it("band 'high' at exactly 5 at-risk chapters (high boundary)", () => {
    const r = deriveAtRiskConcentration(
      baseInput({
        subjectSnapshots: [
          { subject: 'math', chapterMasteries: [0.0, 0.1, 0.2, 0.3, 0.39] },
        ],
      }),
    );
    expect(r.bySubject[0].atRiskChapterCount).toBe(5);
    expect(r.bySubject[0].band).toBe('high');
    expect(r.worstBand).toBe('high');
  });

  it("band 'high' for many at-risk chapters", () => {
    const r = deriveAtRiskConcentration(
      baseInput({
        subjectSnapshots: [
          { subject: 'math', chapterMasteries: [0.0, 0.1, 0.2, 0.3, 0.35, 0.39, 0.05] },
        ],
      }),
    );
    expect(r.bySubject[0].atRiskChapterCount).toBe(7);
    expect(r.bySubject[0].band).toBe('high');
  });

  it('orders subjects worst-first and rolls up the worst band + total', () => {
    const r = deriveAtRiskConcentration(
      baseInput({
        subjectSnapshots: [
          { subject: 'english', chapterMasteries: [0.39] }, // 1 -> low
          { subject: 'math', chapterMasteries: [0.1, 0.2, 0.3, 0.35, 0.05] }, // 5 -> high
          { subject: 'science', chapterMasteries: [0.1, 0.2, 0.3] }, // 3 -> medium
        ],
      }),
    );
    // worst-first: math(5) > science(3) > english(1)
    expect(r.bySubject.map((s) => s.subject)).toEqual(['math', 'science', 'english']);
    expect(r.bySubject.map((s) => s.band)).toEqual(['high', 'medium', 'low']);
    expect(r.worstBand).toBe('high');
    expect(r.totalAtRiskChapters).toBe(1 + 5 + 3);
  });

  it('ties on count are ordered stably by subject name', () => {
    const r = deriveAtRiskConcentration(
      baseInput({
        subjectSnapshots: [
          { subject: 'science', chapterMasteries: [0.1, 0.2] }, // 2
          { subject: 'hindi', chapterMasteries: [0.1, 0.2] }, // 2
        ],
      }),
    );
    expect(r.bySubject.map((s) => s.subject)).toEqual(['hindi', 'science']);
  });

  it('ignores non-finite chapter mastery values when counting', () => {
    const r = deriveAtRiskConcentration(
      baseInput({
        subjectSnapshots: [
          { subject: 'math', chapterMasteries: [0.1, NaN, 0.2, Infinity] },
        ],
      }),
    );
    expect(r.bySubject[0].atRiskChapterCount).toBe(2);
  });

  it('a subject with an empty chapter list is band none', () => {
    const r = deriveAtRiskConcentration(
      baseInput({ subjectSnapshots: [{ subject: 'math', chapterMasteries: [] }] }),
    );
    expect(r.bySubject[0].atRiskChapterCount).toBe(0);
    expect(r.bySubject[0].band).toBe('none');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// END-TO-END deriveSignals
// ════════════════════════════════════════════════════════════════════════════

describe('deriveSignals (composite)', () => {
  it('composes all three signals from one raw bundle', () => {
    const out = deriveSignals(
      baseInput({
        lastActiveMs: daysAgoNoon(2),
        masteryEvents: [
          { subjectCode: 'math', chapterNumber: 5, fromMastery: 0.9, toMastery: 0.5 },
        ],
        recentQuizScores: [80, 60, 40],
        subjectSnapshots: [
          { subject: 'math', chapterMasteries: [0.1, 0.2, 0.3] }, // medium
        ],
      }),
    );

    expect(out.inactivity.verdict).toBe('broken');
    expect(out.masteryCliff.verdict).toBe('flagged');
    expect(out.atRiskConcentration.worstBand).toBe('medium');
  });

  it('degrades gracefully for a brand-new student (never active, no history)', () => {
    const out = deriveSignals(baseInput({ lastActiveMs: null }));
    expect(out.inactivity.verdict).toBe('never');
    expect(out.masteryCliff.verdict).toBe('unknown');
    expect(out.atRiskConcentration.worstBand).toBe('none');
    expect(out.atRiskConcentration.bySubject).toEqual([]);
  });

  it('is pure — same input yields identical output', () => {
    const input = baseInput({
      lastActiveMs: daysAgoNoon(1),
      recentQuizScores: [70, 60, 50, 40],
      subjectSnapshots: [{ subject: 'science', chapterMasteries: [0.1, 0.2, 0.3, 0.35, 0.05] }],
    });
    expect(deriveSignals(input)).toEqual(deriveSignals(input));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CONSTANTS — pin them to the platform conventions they are anchored to
// ════════════════════════════════════════════════════════════════════════════

describe('PULSE_THRESHOLDS anchoring', () => {
  it('at_risk_mastery is 0.4 (platform-wide at-risk line)', () => {
    expect(PULSE_THRESHOLDS.at_risk_mastery).toBe(0.4);
  });

  it('inactivity window matches the streak grace boundary (0 ok, 1 grace)', () => {
    expect(PULSE_THRESHOLDS.inactivity_ok_max_days).toBe(0);
    expect(PULSE_THRESHOLDS.inactivity_grace_days).toBe(1);
  });

  it('concentration bands are ordered 1 < 3 < 5', () => {
    expect(PULSE_THRESHOLDS.concentration_low_min).toBe(1);
    expect(PULSE_THRESHOLDS.concentration_medium_min).toBe(3);
    expect(PULSE_THRESHOLDS.concentration_high_min).toBe(5);
    expect(PULSE_THRESHOLDS.concentration_low_min).toBeLessThan(
      PULSE_THRESHOLDS.concentration_medium_min,
    );
    expect(PULSE_THRESHOLDS.concentration_medium_min).toBeLessThan(
      PULSE_THRESHOLDS.concentration_high_min,
    );
  });
});
