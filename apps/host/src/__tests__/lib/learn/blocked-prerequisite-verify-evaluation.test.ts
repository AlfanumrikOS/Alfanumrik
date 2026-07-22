/**
 * Unit tests for src/lib/learn/blocked-prerequisite-verify-evaluation.ts
 * (Loop D — blocked_prerequisite verify evaluation).
 *
 * Pins:
 *   - Resolution is delegated ENTIRELY to classifyPrerequisiteBlock: the
 *     latest in-window observation resolves iff classification returns
 *     `blocked: false`.
 *   - LATEST in-window observation decides (transient recoveries that
 *     regress again are not a resolution).
 *   - Window: rolling ms, inclusive ends for observations and for
 *     'still_blocked'; 'expired' only STRICTLY after windowEnd; 'resolved'
 *     beats a same-instant/late expiry sweep.
 *   - REGRESSION (assessment review, Phase 3 master action plan): a
 *     fully-unreadable observation (pKnow AND daysSinceStudy both
 *     null/non-finite) must NOT become `latest` — otherwise it is fed into
 *     classifyPrerequisiteBlock, which treats "unevaluable" as
 *     `blocked: false` (correct at INJECT time, a false-positive closure at
 *     VERIFY time). A partial reading (only one axis readable) is still a
 *     legitimately-evaluable observation and must pass through.
 *   - Defensive degradation: corrupt record/clock → 'still_blocked' with
 *     nulls (never falsely resolves off corrupt data).
 *
 * Style mirrors src/__tests__/lib/learn/recovery-evaluation.test.ts.
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateBlockedPrerequisiteResolution,
  blockedPrerequisiteVerifyWindowEndMs,
  type BlockedPrerequisiteInterventionRecord,
  type PrerequisiteMasteryObservation,
} from '@alfanumrik/lib/learn/blocked-prerequisite-verify-evaluation';
import { BLOCKED_PREREQUISITE_RULES } from '@alfanumrik/lib/learn/adaptive-loops-rules';

const MS_PER_DAY = 86_400_000;
const CREATED = 1_750_000_000_000;
const WINDOW_END = CREATED + 7 * MS_PER_DAY;

function record(
  over: Partial<BlockedPrerequisiteInterventionRecord> = {},
): BlockedPrerequisiteInterventionRecord {
  return {
    subjectCode: 'math',
    prereqChapterNumber: 2,
    dependentChapterNumber: 5,
    createdAtMs: CREATED,
    windowDays: 7,
    ...over,
  };
}

function obs(
  pKnow: number | null,
  daysSinceStudy: number | null,
  atMs: number,
  over: Partial<PrerequisiteMasteryObservation> = {},
): PrerequisiteMasteryObservation {
  return {
    subjectCode: 'math',
    prereqChapterNumber: 2,
    pKnow,
    daysSinceStudy,
    observedAtMs: atMs,
    ...over,
  };
}

const day = (n: number) => CREATED + n * MS_PER_DAY;

// mastery_floor = 0.4 (PULSE_THRESHOLDS.at_risk_mastery), decay_floor = 0.5.
// daysSinceStudy: 0 with default strength 1.0 => predictRetention = 1.0 (not decay-low).

describe('blockedPrerequisiteVerifyWindowEndMs', () => {
  it('computes createdAt + windowDays in rolling milliseconds', () => {
    expect(blockedPrerequisiteVerifyWindowEndMs(record())).toBe(WINDOW_END);
  });

  it('falls back to the ratified 7-day default for non-finite windowDays', () => {
    expect(
      blockedPrerequisiteVerifyWindowEndMs(record({ windowDays: Number.NaN })),
    ).toBe(CREATED + BLOCKED_PREREQUISITE_RULES.return_window_days * MS_PER_DAY);
  });

  it('falls back to the default for zero/negative windowDays', () => {
    expect(blockedPrerequisiteVerifyWindowEndMs(record({ windowDays: 0 }))).toBe(
      WINDOW_END,
    );
    expect(blockedPrerequisiteVerifyWindowEndMs(record({ windowDays: -3 }))).toBe(
      WINDOW_END,
    );
  });
});

describe('evaluateBlockedPrerequisiteResolution — resolution vs still-blocked', () => {
  it('resolves when the latest in-window reading clears both floors', () => {
    // pKnow 0.7 >= 0.4 floor; daysSinceStudy 0 => retention 1.0 >= 0.5 floor.
    const r = evaluateBlockedPrerequisiteResolution(
      record(),
      [obs(0.7, 0, day(3))],
      day(4),
    );
    expect(r.verdict).toBe('resolved');
    expect(r.prereqPKnowNow).toBe(0.7);
    expect(r.retentionNow).toBe(1);
  });

  it('stays still_blocked when the latest in-window reading fails the mastery floor', () => {
    const r = evaluateBlockedPrerequisiteResolution(
      record(),
      [obs(0.2, 0, day(3))],
      day(4),
    );
    expect(r.verdict).toBe('still_blocked');
    expect(r.prereqPKnowNow).toBe(0.2);
  });

  it('stays still_blocked when the latest in-window reading fails the decay floor only', () => {
    // pKnow 0.8 clears mastery; daysSinceStudy 5 => retention exp(-5) << 0.5.
    const r = evaluateBlockedPrerequisiteResolution(
      record(),
      [obs(0.8, 5, day(3))],
      day(4),
    );
    expect(r.verdict).toBe('still_blocked');
    expect(r.prereqPKnowNow).toBe(0.8);
    expect(r.retentionNow).toBeLessThan(0.5);
  });
});

describe('evaluateBlockedPrerequisiteResolution — REGRESSION: fully-unreadable observations never resolve', () => {
  it('an in-window observation with pKnow:null, daysSinceStudy:null does NOT resolve (still_blocked)', () => {
    const r = evaluateBlockedPrerequisiteResolution(
      record(),
      [obs(null, null, day(3))],
      day(4),
    );
    expect(r.verdict).toBe('still_blocked');
    expect(r.prereqPKnowNow).toBeNull();
    expect(r.retentionNow).toBeNull();
  });

  it('a fully-unreadable observation is excluded even when it is the ONLY observation and the row is past its window (expired, not resolved)', () => {
    const r = evaluateBlockedPrerequisiteResolution(
      record(),
      [obs(null, null, day(3))],
      WINDOW_END + 1,
    );
    expect(r.verdict).toBe('expired');
    expect(r.prereqPKnowNow).toBeNull();
  });

  it('a fully-unreadable LATEST observation does not mask an earlier readable still-blocked one — the unreadable one is skipped and the readable one decides', () => {
    const r = evaluateBlockedPrerequisiteResolution(
      record(),
      [obs(0.2, 0, day(2)), obs(null, null, day(5))],
      day(6),
    );
    expect(r.verdict).toBe('still_blocked');
    expect(r.prereqPKnowNow).toBe(0.2);
  });

  it('a partial reading (only pKnow readable) is still a legitimately-evaluable observation and passes through', () => {
    const r = evaluateBlockedPrerequisiteResolution(
      record(),
      [obs(0.7, null, day(3))],
      day(4),
    );
    // daysSinceStudy unreadable => decay axis not evaluated; mastery 0.7 clears
    // its floor => not blocked on the readable axis => resolved.
    expect(r.verdict).toBe('resolved');
    expect(r.prereqPKnowNow).toBe(0.7);
  });

  it('a partial reading (only daysSinceStudy readable) is still a legitimately-evaluable observation and passes through', () => {
    const r = evaluateBlockedPrerequisiteResolution(
      record(),
      [obs(null, 0, day(3))],
      day(4),
    );
    expect(r.verdict).toBe('resolved');
    expect(r.retentionNow).toBe(1);
  });
});

describe('evaluateBlockedPrerequisiteResolution — latest-observation semantics', () => {
  it('a transient early recovery does not count: the LATEST reading decides', () => {
    const r = evaluateBlockedPrerequisiteResolution(
      record(),
      [obs(0.8, 0, day(2)), obs(0.1, 0, day(5))], // recovered then relapsed
      day(6),
    );
    expect(r.verdict).toBe('still_blocked');
    expect(r.prereqPKnowNow).toBe(0.1);
  });

  it('on equal timestamps the later array element wins (chronological input)', () => {
    const t = day(3);
    const resolved = evaluateBlockedPrerequisiteResolution(
      record(),
      [obs(0.1, 0, t), obs(0.7, 0, t)],
      day(4),
    );
    expect(resolved.verdict).toBe('resolved');

    const relapsed = evaluateBlockedPrerequisiteResolution(
      record(),
      [obs(0.7, 0, t), obs(0.1, 0, t)],
      day(4),
    );
    expect(relapsed.verdict).toBe('still_blocked');
    expect(relapsed.prereqPKnowNow).toBe(0.1);
  });
});

describe('evaluateBlockedPrerequisiteResolution — window boundaries and verdict ordering', () => {
  it('no observations, inside the window → still_blocked with null metrics', () => {
    const r = evaluateBlockedPrerequisiteResolution(record(), [], day(3));
    expect(r).toEqual({ verdict: 'still_blocked', prereqPKnowNow: null, retentionNow: null });
  });

  it('no observations, nowMs exactly at windowEnd → still still_blocked (inclusive)', () => {
    const r = evaluateBlockedPrerequisiteResolution(record(), [], WINDOW_END);
    expect(r.verdict).toBe('still_blocked');
  });

  it('no observations, 1ms past windowEnd → expired with null metrics', () => {
    const r = evaluateBlockedPrerequisiteResolution(record(), [], WINDOW_END + 1);
    expect(r).toEqual({ verdict: 'expired', prereqPKnowNow: null, retentionNow: null });
  });

  it('an observation exactly at windowEnd counts (inclusive end)', () => {
    const r = evaluateBlockedPrerequisiteResolution(
      record(),
      [obs(0.7, 0, WINDOW_END)],
      WINDOW_END,
    );
    expect(r.verdict).toBe('resolved');
  });

  it('an observation 1ms after windowEnd is ignored → expired when past window', () => {
    const r = evaluateBlockedPrerequisiteResolution(
      record(),
      [obs(0.7, 0, WINDOW_END + 1)],
      WINDOW_END + 2,
    );
    expect(r).toEqual({ verdict: 'expired', prereqPKnowNow: null, retentionNow: null });
  });

  it('resolution inside the window beats a late evaluation (resolved, not expired)', () => {
    const r = evaluateBlockedPrerequisiteResolution(
      record(),
      [obs(0.7, 0, day(6))],
      WINDOW_END + 5 * MS_PER_DAY,
    );
    expect(r.verdict).toBe('resolved');
  });

  it('a non-resolving in-window observation still expires after the window', () => {
    const r = evaluateBlockedPrerequisiteResolution(
      record(),
      [obs(0.2, 0, day(6))],
      WINDOW_END + 1,
    );
    expect(r.verdict).toBe('expired');
    expect(r.prereqPKnowNow).toBe(0.2);
  });
});

describe('evaluateBlockedPrerequisiteResolution — observation filtering', () => {
  it('ignores observations for another subject', () => {
    const r = evaluateBlockedPrerequisiteResolution(
      record(),
      [obs(0.9, 0, day(3), { subjectCode: 'science' })],
      day(4),
    );
    expect(r.verdict).toBe('still_blocked');
    expect(r.prereqPKnowNow).toBeNull();
  });

  it('ignores observations for another prerequisite chapter', () => {
    const r = evaluateBlockedPrerequisiteResolution(
      record(),
      [obs(0.9, 0, day(3), { prereqChapterNumber: 9 })],
      day(4),
    );
    expect(r.prereqPKnowNow).toBeNull();
  });

  it('ignores pre-intervention observations (before createdAtMs)', () => {
    const r = evaluateBlockedPrerequisiteResolution(
      record(),
      [obs(0.9, 0, CREATED - 1)],
      day(4),
    );
    expect(r.verdict).toBe('still_blocked');
    expect(r.prereqPKnowNow).toBeNull();
  });

  it('counts an observation exactly at createdAtMs (inclusive start)', () => {
    const r = evaluateBlockedPrerequisiteResolution(
      record(),
      [obs(0.7, 0, CREATED)],
      day(1),
    );
    expect(r.verdict).toBe('resolved');
  });

  it('ignores future observations (observedAtMs > nowMs)', () => {
    const r = evaluateBlockedPrerequisiteResolution(
      record(),
      [obs(0.9, 0, day(5))],
      day(4),
    );
    expect(r.verdict).toBe('still_blocked');
    expect(r.prereqPKnowNow).toBeNull();
  });

  it('ignores observations with non-finite timestamp', () => {
    const r = evaluateBlockedPrerequisiteResolution(
      record(),
      [obs(0.9, 0, Number.NaN)],
      day(4),
    );
    expect(r.prereqPKnowNow).toBeNull();
    expect(r.verdict).toBe('still_blocked');
  });
});

describe('evaluateBlockedPrerequisiteResolution — defensive degradation (never falsely resolve)', () => {
  it('non-finite createdAtMs → still_blocked with nulls', () => {
    const r = evaluateBlockedPrerequisiteResolution(
      record({ createdAtMs: Number.NaN }),
      [obs(0.9, 0, day(2))],
      day(4),
    );
    expect(r).toEqual({ verdict: 'still_blocked', prereqPKnowNow: null, retentionNow: null });
  });

  it('non-finite nowMs → still_blocked with nulls', () => {
    const r = evaluateBlockedPrerequisiteResolution(
      record(),
      [obs(0.9, 0, day(2))],
      Number.NaN,
    );
    expect(r).toEqual({ verdict: 'still_blocked', prereqPKnowNow: null, retentionNow: null });
  });

  it('invalid windowDays uses the ratified 7-day default for expiry', () => {
    const rec = record({ windowDays: 0 });
    expect(evaluateBlockedPrerequisiteResolution(rec, [], day(7)).verdict).toBe(
      'still_blocked',
    ); // boundary inclusive
    expect(
      evaluateBlockedPrerequisiteResolution(rec, [], day(7) + 1).verdict,
    ).toBe('expired');
  });

  it('empty/missing observations array degrades to still_blocked inside the window', () => {
    const r = evaluateBlockedPrerequisiteResolution(
      record(),
      undefined as unknown as PrerequisiteMasteryObservation[],
      day(2),
    );
    expect(r.verdict).toBe('still_blocked');
  });
});
