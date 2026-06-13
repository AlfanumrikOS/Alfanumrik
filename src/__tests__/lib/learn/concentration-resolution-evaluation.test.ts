/**
 * Unit tests for src/lib/learn/concentration-resolution-evaluation.ts
 *
 * Loop C (at-risk concentration) VERIFY — the backend-facing resolution
 * contract (`evaluateConcentrationResolution` → { verdict, atRiskCountNow,
 * bandNow }). Pins every verdict branch + band/window boundary edge:
 *
 *   - resolved / pending / expired with count at 4 / 5 (exactly high_min) / 6.
 *   - band boundary read from PULSE_THRESHOLDS (no duplicate threshold).
 *   - latest-snapshot decides: a transient dip back to high is NOT resolved;
 *     a mid-window high then a sustained drop IS resolved.
 *   - INCLUSIVE ends; 'expired' only STRICTLY after windowEnd; resolution at the
 *     exact boundary beats same-instant expiry.
 *   - chapter churn is a non-issue (keyed on subject, not chapter); different-
 *     subject / pre-intervention / future snapshots ignored.
 *   - no-snapshot-after-window ⇒ expired (re-notify), never a false 'resolved'.
 *   - malformed record / clock / snapshots ⇒ 'pending' (never false re-notify).
 *
 * Style mirrors src/__tests__/lib/learn/recovery-evaluation.test.ts and
 * src/__tests__/lib/learn/adaptive-loops-rules.test.ts.
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateConcentrationResolution,
  concentrationReturnWindowEndMs,
  CONCENTRATION_RETURN_WINDOW_DAYS,
  type ConcentrationInterventionRecord,
  type SubjectSnapshotObservation,
} from '@/lib/learn/concentration-resolution-evaluation';
import { ADAPTIVE_LOOPS_BC_RULES } from '@/lib/learn/adaptive-loops-rules';
import { PULSE_THRESHOLDS } from '@/lib/pulse/signals';

const MS_PER_DAY = 86_400_000;
const NOW = 1_750_000_000_000;
const CREATED = NOW;
const WINDOW_END = CREATED + 14 * MS_PER_DAY;
const HIGH_MIN = PULSE_THRESHOLDS.concentration_high_min; // 5

function record(
  over: Partial<ConcentrationInterventionRecord> = {},
): ConcentrationInterventionRecord {
  return { subjectCode: 'math', createdAtMs: CREATED, windowDays: 14, ...over };
}
function snap(
  count: number,
  atMs: number,
  over: Partial<SubjectSnapshotObservation> = {},
): SubjectSnapshotObservation {
  return { subjectCode: 'math', atRiskChapterCount: count, observedAtMs: atMs, ...over };
}

describe('concentration-resolution-evaluation — canonical reuse', () => {
  it('re-exports the canonical 14-day return window constant', () => {
    expect(CONCENTRATION_RETURN_WINDOW_DAYS).toBe(14);
    expect(CONCENTRATION_RETURN_WINDOW_DAYS).toBe(
      ADAPTIVE_LOOPS_BC_RULES.concentration_return_window_days,
    );
  });

  it('window-end helper computes createdAt + 14 days', () => {
    expect(concentrationReturnWindowEndMs(record())).toBe(WINDOW_END);
  });

  it('window-end falls back to the canonical window on a non-positive windowDays', () => {
    expect(concentrationReturnWindowEndMs(record({ windowDays: -1 }))).toBe(WINDOW_END);
    expect(concentrationReturnWindowEndMs(record({ windowDays: NaN }))).toBe(WINDOW_END);
  });

  it('band boundary is read from PULSE_THRESHOLDS (high_min = 5)', () => {
    // Structural: the resolution boundary IS the signal boundary.
    expect(HIGH_MIN).toBe(5);
    expect(ADAPTIVE_LOOPS_BC_RULES.concentration_high_min).toBe(HIGH_MIN);
  });
});

describe('evaluateConcentrationResolution — band boundary at high_min (5)', () => {
  it('count 6 (above high_min) → still high → pending inside window', () => {
    const r = evaluateConcentrationResolution(
      record(),
      [snap(HIGH_MIN + 1, CREATED + 1 * MS_PER_DAY)],
      CREATED + 1 * MS_PER_DAY,
    );
    expect(r.bandNow).toBe('high');
    expect(r.atRiskCountNow).toBe(HIGH_MIN + 1);
    expect(r.verdict).toBe('pending');
  });

  it('count 5 (exactly high_min) → still high → NOT resolved (pending)', () => {
    const r = evaluateConcentrationResolution(
      record(),
      [snap(HIGH_MIN, CREATED + 1 * MS_PER_DAY)],
      CREATED + 1 * MS_PER_DAY,
    );
    expect(r.bandNow).toBe('high');
    expect(r.atRiskCountNow).toBe(HIGH_MIN);
    expect(r.verdict).toBe('pending');
  });

  it('count 4 (just below high_min) → band medium → resolved', () => {
    const r = evaluateConcentrationResolution(
      record(),
      [snap(HIGH_MIN - 1, CREATED + 2 * MS_PER_DAY)],
      CREATED + 2 * MS_PER_DAY,
    );
    expect(r.bandNow).toBe('medium');
    expect(r.verdict).toBe('resolved');
    expect(r.atRiskCountNow).toBe(HIGH_MIN - 1);
    expect(r.daysToResolve).toBe(2);
  });

  it('count 2 → band low → resolved', () => {
    const r = evaluateConcentrationResolution(
      record(),
      [snap(2, CREATED + 3 * MS_PER_DAY)],
      CREATED + 3 * MS_PER_DAY,
    );
    expect(r.bandNow).toBe('low');
    expect(r.verdict).toBe('resolved');
  });

  it('count 0 → band none → resolved', () => {
    const r = evaluateConcentrationResolution(
      record(),
      [snap(0, CREATED + 3 * MS_PER_DAY)],
      CREATED + 3 * MS_PER_DAY,
    );
    expect(r.bandNow).toBe('none');
    expect(r.verdict).toBe('resolved');
    expect(r.atRiskCountNow).toBe(0);
  });
});

describe('evaluateConcentrationResolution — latest snapshot decides', () => {
  it('a mid-window dip that climbs back to high is NOT resolved', () => {
    const r = evaluateConcentrationResolution(
      record(),
      [
        snap(3, CREATED + 2 * MS_PER_DAY), // transient dip (medium)
        snap(6, CREATED + 5 * MS_PER_DAY), // climbed back to high (latest)
      ],
      CREATED + 5 * MS_PER_DAY,
    );
    expect(r.bandNow).toBe('high');
    expect(r.verdict).toBe('pending');
  });

  it('a mid-window high followed by a sustained drop IS resolved', () => {
    const r = evaluateConcentrationResolution(
      record(),
      [
        snap(6, CREATED + 2 * MS_PER_DAY),
        snap(2, CREATED + 6 * MS_PER_DAY), // latest → low
      ],
      CREATED + 6 * MS_PER_DAY,
    );
    expect(r.verdict).toBe('resolved');
    expect(r.bandNow).toBe('low');
    expect(r.daysToResolve).toBe(6);
  });

  it('equal-timestamp snapshots resolve to the later array element', () => {
    const at = CREATED + 4 * MS_PER_DAY;
    const r = evaluateConcentrationResolution(
      record(),
      [snap(6, at), snap(2, at)], // later element wins → low
      at,
    );
    expect(r.bandNow).toBe('low');
    expect(r.verdict).toBe('resolved');
  });
});

describe('evaluateConcentrationResolution — window boundary', () => {
  it('resolution at the exact window-end boundary beats same-instant expiry', () => {
    const r = evaluateConcentrationResolution(record(), [snap(2, WINDOW_END)], WINDOW_END);
    expect(r.verdict).toBe('resolved');
    expect(r.daysToResolve).toBe(14);
  });

  it('pending at exactly the window-end boundary while still high', () => {
    const r = evaluateConcentrationResolution(record(), [snap(6, WINDOW_END)], WINDOW_END);
    expect(r.verdict).toBe('pending');
    expect(r.bandNow).toBe('high');
  });

  it('a late evaluation of an in-window resolution still reads resolved', () => {
    const r = evaluateConcentrationResolution(
      record(),
      [snap(1, CREATED + 3 * MS_PER_DAY)],
      WINDOW_END + 10 * MS_PER_DAY,
    );
    expect(r.verdict).toBe('resolved');
  });
});

describe('evaluateConcentrationResolution — expired (re-notify)', () => {
  it('expired: strictly after the window, still high', () => {
    const r = evaluateConcentrationResolution(
      record(),
      [snap(6, CREATED + 10 * MS_PER_DAY)],
      WINDOW_END + 1,
    );
    expect(r.verdict).toBe('expired');
    expect(r.bandNow).toBe('high');
    expect(r.daysToResolve).toBeNull();
  });

  it('expired: no snapshot at all after the window', () => {
    const r = evaluateConcentrationResolution(record(), [], WINDOW_END + 1);
    expect(r.verdict).toBe('expired');
    expect(r.atRiskCountNow).toBeNull();
    expect(r.bandNow).toBeNull();
  });

  it('expired: only out-of-window snapshots after the window — never false resolved', () => {
    const r = evaluateConcentrationResolution(
      record(),
      [snap(0, CREATED - 1), snap(0, WINDOW_END + 5 * MS_PER_DAY)],
      WINDOW_END + 6 * MS_PER_DAY,
    );
    expect(r.verdict).toBe('expired');
    expect(r.atRiskCountNow).toBeNull();
  });
});

describe('evaluateConcentrationResolution — snapshot filtering', () => {
  it('ignores snapshots for a different subject', () => {
    const r = evaluateConcentrationResolution(
      record(),
      [snap(2, CREATED + 2 * MS_PER_DAY, { subjectCode: 'science' })],
      CREATED + 2 * MS_PER_DAY,
    );
    expect(r.verdict).toBe('pending');
    expect(r.atRiskCountNow).toBeNull();
  });

  it('chapter churn is a non-issue: matches on subject only, resolved on subject count', () => {
    // Worst chapter at trigger fixed; subject count drops regardless of which
    // chapters are weak. The record has no chapter field — keyed on subject.
    const r = evaluateConcentrationResolution(
      record({ subjectCode: 'physics' }),
      [snap(3, CREATED + 4 * MS_PER_DAY, { subjectCode: 'physics' })],
      CREATED + 4 * MS_PER_DAY,
    );
    expect(r.verdict).toBe('resolved');
    expect(r.bandNow).toBe('medium');
  });

  it('ignores pre-intervention and future snapshots', () => {
    const r = evaluateConcentrationResolution(
      record(),
      [snap(2, CREATED - 1), snap(2, CREATED + 20 * MS_PER_DAY)],
      CREATED + 5 * MS_PER_DAY,
    );
    expect(r.verdict).toBe('pending');
  });
});

describe('evaluateConcentrationResolution — malformed / defensive', () => {
  it('malformed createdAt ⇒ pending', () => {
    expect(
      evaluateConcentrationResolution(record({ createdAtMs: NaN }), [], NOW).verdict,
    ).toBe('pending');
  });

  it('malformed clock ⇒ pending', () => {
    expect(evaluateConcentrationResolution(record(), [], NaN).verdict).toBe('pending');
  });

  it('null record ⇒ pending', () => {
    // @ts-expect-error — null record exercises the defensive path
    expect(evaluateConcentrationResolution(null, [], NOW).verdict).toBe('pending');
  });

  it('skips malformed snapshot fields without throwing', () => {
    const r = evaluateConcentrationResolution(
      record(),
      [snap(NaN, CREATED + 1 * MS_PER_DAY), snap(2, CREATED + 2 * MS_PER_DAY)],
      CREATED + 2 * MS_PER_DAY,
    );
    expect(r.verdict).toBe('resolved');
    expect(r.atRiskCountNow).toBe(2);
  });

  it('undefined snapshots ⇒ pending inside window', () => {
    // @ts-expect-error — undefined snapshot array exercises the defensive path
    expect(evaluateConcentrationResolution(record(), undefined, CREATED + 1 * MS_PER_DAY).verdict).toBe(
      'pending',
    );
  });

  it('null snapshot entries are skipped without throwing', () => {
    const r = evaluateConcentrationResolution(
      record(),
      // @ts-expect-error — a null entry in the array
      [null, snap(1, CREATED + 2 * MS_PER_DAY)],
      CREATED + 2 * MS_PER_DAY,
    );
    expect(r.verdict).toBe('resolved');
  });
});
