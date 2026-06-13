/**
 * Unit tests for src/lib/learn/recovery-evaluation.ts
 *
 * Pins the ratified recovery rule and window semantics:
 *   - Recovery branch A: masteryNow >= pre-cliff baseline (no at-risk floor).
 *   - Recovery branch B: gainFromTrough >= 0.15 AND masteryNow >= 0.4
 *     (thresholds reused from PULSE_THRESHOLDS via ADAPTIVE_REMEDIATION_RULES).
 *   - LATEST in-window observation decides (transient peaks don't count).
 *   - Window: rolling ms, inclusive ends for observations and for 'pending';
 *     'expired' only STRICTLY after windowEnd; 'recovered' beats late expiry.
 *   - Epsilon guard: IEEE-754 representation of an exactly-at-threshold gain
 *     (e.g. 0.7 - 0.55 = 0.1499999999...) still counts as >= 0.15.
 *   - Defensive degradation: corrupt record/clock → 'pending' with nulls
 *     (never falsely escalates to a teacher).
 *
 * Style mirrors src/__tests__/lib/irt/fisher-info.test.ts.
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateRecovery,
  verificationWindowEndMs,
  type InterventionRecord,
  type MasteryObservation,
} from '@/lib/learn/recovery-evaluation';
import { ADAPTIVE_REMEDIATION_RULES } from '@/lib/learn/remediation-queue-adapter';

const MS_PER_DAY = 86_400_000;
const CREATED = 1_750_000_000_000;
const WINDOW_END = CREATED + 7 * MS_PER_DAY;

function record(over: Partial<InterventionRecord> = {}): InterventionRecord {
  return {
    subjectCode: 'math',
    chapterNumber: 4,
    baselineMastery: 0.7,
    troughMastery: 0.45,
    createdAtMs: CREATED,
    windowDays: 7,
    ...over,
  };
}

function obs(
  mastery: number,
  atMs: number,
  over: Partial<MasteryObservation> = {},
): MasteryObservation {
  return {
    subjectCode: 'math',
    chapterNumber: 4,
    mastery,
    observedAtMs: atMs,
    ...over,
  };
}

const day = (n: number) => CREATED + n * MS_PER_DAY;

describe('verificationWindowEndMs', () => {
  it('computes createdAt + windowDays in rolling milliseconds', () => {
    expect(verificationWindowEndMs(record())).toBe(WINDOW_END);
  });

  it('falls back to the ratified 7-day default for non-finite windowDays', () => {
    expect(verificationWindowEndMs(record({ windowDays: Number.NaN }))).toBe(
      CREATED +
        ADAPTIVE_REMEDIATION_RULES.verification_window_days * MS_PER_DAY,
    );
  });

  it('falls back to the default for zero/negative windowDays', () => {
    expect(verificationWindowEndMs(record({ windowDays: 0 }))).toBe(WINDOW_END);
    expect(verificationWindowEndMs(record({ windowDays: -2 }))).toBe(WINDOW_END);
  });
});

describe('evaluateRecovery — branch A: baseline restoration', () => {
  it('recovers when the latest observation is exactly at baseline (inclusive >=)', () => {
    const r = evaluateRecovery(record(), [obs(0.7, day(3))], day(4));
    expect(r.verdict).toBe('recovered');
    expect(r.masteryNow).toBe(0.7);
    expect(r.gainFromTrough).toBeCloseTo(0.25, 9);
  });

  it('stays pending when just below baseline (and gain branch not met)', () => {
    // 0.55: gain 0.10 < 0.15, below baseline 0.7 → not recovered.
    const r = evaluateRecovery(record(), [obs(0.55, day(3))], day(4));
    expect(r.verdict).toBe('pending');
    expect(r.masteryNow).toBe(0.55);
  });

  it('branch A has NO at-risk floor: a sub-0.4 baseline restored is recovered', () => {
    const rec = record({ baselineMastery: 0.35, troughMastery: 0.15 });
    const r = evaluateRecovery(rec, [obs(0.35, day(2))], day(3));
    expect(r.verdict).toBe('recovered');
    expect(r.masteryNow).toBe(0.35);
  });

  it('null baseline disables branch A (only the gain branch can recover)', () => {
    const rec = record({ baselineMastery: null, troughMastery: 0.3 });
    // 0.38: gain 0.08 < 0.15 and below floor → pending.
    const r = evaluateRecovery(rec, [obs(0.38, day(2))], day(3));
    expect(r.verdict).toBe('pending');
  });

  it('branch A still works when troughMastery is corrupt (gain reported null)', () => {
    const rec = record({ baselineMastery: 0.6, troughMastery: Number.NaN });
    const r = evaluateRecovery(rec, [obs(0.6, day(2))], day(3));
    expect(r.verdict).toBe('recovered');
    expect(r.gainFromTrough).toBeNull();
  });
});

describe('evaluateRecovery — branch B: gain from trough + at-risk floor', () => {
  it('recovers at exactly gain 0.15 with mastery exactly at the 0.4 floor', () => {
    const rec = record({ baselineMastery: null, troughMastery: 0.25 });
    const r = evaluateRecovery(rec, [obs(0.4, day(3))], day(4));
    expect(r.verdict).toBe('recovered');
    expect(r.gainFromTrough).toBeCloseTo(0.15, 9);
  });

  it('epsilon guard: 0.7 - 0.55 (IEEE 0.1499999...) still counts as >= 0.15', () => {
    expect(0.7 - 0.55).toBeLessThan(0.15); // the raw FP hazard being guarded
    const rec = record({ baselineMastery: null, troughMastery: 0.55 });
    const r = evaluateRecovery(rec, [obs(0.7, day(3))], day(4));
    expect(r.verdict).toBe('recovered');
  });

  it('gain met but mastery below the 0.4 floor is NOT recovered', () => {
    const rec = record({ baselineMastery: null, troughMastery: 0.2 });
    // gain 0.16 >= 0.15 but 0.36 < 0.4 — still at-risk by the platform line.
    const r = evaluateRecovery(rec, [obs(0.36, day(3))], day(4));
    expect(r.verdict).toBe('pending');
    expect(r.gainFromTrough).toBeCloseTo(0.16, 9);
  });

  it('mastery above floor but gain below 0.15 is NOT recovered', () => {
    const rec = record({ baselineMastery: null, troughMastery: 0.3 });
    // gain 0.14 < 0.15, 0.44 >= 0.4 → pending.
    const r = evaluateRecovery(rec, [obs(0.44, day(3))], day(4));
    expect(r.verdict).toBe('pending');
  });
});

describe('evaluateRecovery — latest-observation semantics', () => {
  it('a transient early peak does not count: the LATEST reading decides', () => {
    const r = evaluateRecovery(
      record(),
      [obs(0.8, day(2)), obs(0.3, day(5))], // peak then relapse
      day(6),
    );
    expect(r.verdict).toBe('pending');
    expect(r.masteryNow).toBe(0.3);
    expect(r.gainFromTrough).toBeCloseTo(-0.15, 9); // negative gain reported
  });

  it('on equal timestamps the later array element wins (chronological input)', () => {
    const t = day(3);
    const recovered = evaluateRecovery(record(), [obs(0.3, t), obs(0.75, t)], day(4));
    expect(recovered.verdict).toBe('recovered');

    const relapsed = evaluateRecovery(record(), [obs(0.75, t), obs(0.3, t)], day(4));
    expect(relapsed.verdict).toBe('pending');
    expect(relapsed.masteryNow).toBe(0.3);
  });
});

describe('evaluateRecovery — window boundaries and verdict ordering', () => {
  it('no observations, inside the window → pending with null metrics', () => {
    const r = evaluateRecovery(record(), [], day(3));
    expect(r).toEqual({ verdict: 'pending', masteryNow: null, gainFromTrough: null });
  });

  it('no observations, nowMs exactly at windowEnd → still pending (inclusive)', () => {
    const r = evaluateRecovery(record(), [], WINDOW_END);
    expect(r.verdict).toBe('pending');
  });

  it('no observations, 1ms past windowEnd → expired with null metrics', () => {
    const r = evaluateRecovery(record(), [], WINDOW_END + 1);
    expect(r).toEqual({ verdict: 'expired', masteryNow: null, gainFromTrough: null });
  });

  it('an observation exactly at windowEnd counts (inclusive end)', () => {
    const r = evaluateRecovery(record(), [obs(0.7, WINDOW_END)], WINDOW_END);
    expect(r.verdict).toBe('recovered');
  });

  it('an observation 1ms after windowEnd is ignored → expired when past window', () => {
    const r = evaluateRecovery(record(), [obs(0.7, WINDOW_END + 1)], WINDOW_END + 2);
    expect(r).toEqual({ verdict: 'expired', masteryNow: null, gainFromTrough: null });
  });

  it('recovery inside the window beats a late evaluation (recovered, not expired)', () => {
    const r = evaluateRecovery(record(), [obs(0.72, day(6))], WINDOW_END + 5 * MS_PER_DAY);
    expect(r.verdict).toBe('recovered');
  });

  it('a non-recovering in-window observation still expires after the window', () => {
    const r = evaluateRecovery(record(), [obs(0.5, day(6))], WINDOW_END + 1);
    expect(r.verdict).toBe('expired');
    expect(r.masteryNow).toBe(0.5);
    expect(r.gainFromTrough).toBeCloseTo(0.05, 9);
  });
});

describe('evaluateRecovery — observation filtering', () => {
  it('ignores observations for another subject', () => {
    const r = evaluateRecovery(
      record(),
      [obs(0.9, day(3), { subjectCode: 'science' })],
      day(4),
    );
    expect(r.verdict).toBe('pending');
    expect(r.masteryNow).toBeNull();
  });

  it('ignores observations for another chapter', () => {
    const r = evaluateRecovery(
      record(),
      [obs(0.9, day(3), { chapterNumber: 9 })],
      day(4),
    );
    expect(r.masteryNow).toBeNull();
  });

  it('ignores pre-intervention observations (before createdAtMs)', () => {
    const r = evaluateRecovery(record(), [obs(0.9, CREATED - 1)], day(4));
    expect(r.verdict).toBe('pending');
    expect(r.masteryNow).toBeNull();
  });

  it('counts an observation exactly at createdAtMs (inclusive start)', () => {
    const r = evaluateRecovery(record(), [obs(0.7, CREATED)], day(1));
    expect(r.verdict).toBe('recovered');
  });

  it('ignores future observations (observedAtMs > nowMs)', () => {
    const r = evaluateRecovery(record(), [obs(0.9, day(5))], day(4));
    expect(r.verdict).toBe('pending');
    expect(r.masteryNow).toBeNull();
  });

  it('ignores observations with non-finite mastery or timestamp', () => {
    const r = evaluateRecovery(
      record(),
      [obs(Number.NaN, day(2)), obs(0.9, Number.NaN)],
      day(4),
    );
    expect(r.masteryNow).toBeNull();
    expect(r.verdict).toBe('pending');
  });
});

describe('evaluateRecovery — defensive degradation (never falsely escalate)', () => {
  it('non-finite createdAtMs → pending with nulls', () => {
    const r = evaluateRecovery(
      record({ createdAtMs: Number.NaN }),
      [obs(0.9, day(2))],
      day(4),
    );
    expect(r).toEqual({ verdict: 'pending', masteryNow: null, gainFromTrough: null });
  });

  it('non-finite nowMs → pending with nulls', () => {
    const r = evaluateRecovery(record(), [obs(0.9, day(2))], Number.NaN);
    expect(r).toEqual({ verdict: 'pending', masteryNow: null, gainFromTrough: null });
  });

  it('invalid windowDays uses the ratified 7-day default for expiry', () => {
    const rec = record({ windowDays: 0 });
    expect(evaluateRecovery(rec, [], day(7)).verdict).toBe('pending'); // boundary inclusive
    expect(evaluateRecovery(rec, [], day(7) + 1).verdict).toBe('expired');
  });

  it('empty/missing observations array degrades to pending inside the window', () => {
    const r = evaluateRecovery(
      record(),
      undefined as unknown as MasteryObservation[],
      day(2),
    );
    expect(r.verdict).toBe('pending');
  });
});
