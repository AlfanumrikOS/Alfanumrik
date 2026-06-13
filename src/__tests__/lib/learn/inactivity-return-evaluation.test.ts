/**
 * Unit tests for src/lib/learn/inactivity-return-evaluation.ts
 *
 * Loop B (inactivity) VERIFY — the backend-facing return contract
 * (`evaluateInactivityReturn` → { verdict, lastActiveMs, daysSinceIntervention }).
 * Pins every verdict branch + window/boundary edge:
 *
 *   - returned / pending / expired across day 2 / 3 (boundary) / 4.
 *   - INCLUSIVE start + end; 'expired' only STRICTLY after windowEnd.
 *   - return-at-exact-boundary beats same-instant expiry (student's favor).
 *   - earliest qualifying return wins; before-nudge / after-window / future
 *     observations ignored.
 *   - bias-to-escalation: no in-window observation after the window ⇒ 'expired',
 *     never a false 'returned'.
 *   - malformed record / clock / observations ⇒ 'pending' (never false parent
 *     escalation off corrupt data).
 *   - canonical window math reused from adaptive-loops-rules.ts (no drift).
 *
 * Style mirrors src/__tests__/lib/learn/recovery-evaluation.test.ts and
 * src/__tests__/lib/learn/adaptive-loops-rules.test.ts.
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateInactivityReturn,
  inactivityReturnWindowEndMs,
  INACTIVITY_RETURN_WINDOW_DAYS,
  type InactivityInterventionRecord,
  type ActivityObservation,
} from '@/lib/learn/inactivity-return-evaluation';
import { ADAPTIVE_LOOPS_BC_RULES } from '@/lib/learn/adaptive-loops-rules';

const MS_PER_DAY = 86_400_000;
const NOW = 1_750_000_000_000;
const CREATED = NOW;
const WINDOW_END = CREATED + 3 * MS_PER_DAY;

function record(
  over: Partial<InactivityInterventionRecord> = {},
): InactivityInterventionRecord {
  return { createdAtMs: CREATED, windowDays: 3, ...over };
}
function act(atMs: number): ActivityObservation {
  return { observedAtMs: atMs };
}

describe('inactivity-return-evaluation — canonical reuse', () => {
  it('re-exports the canonical 3-day return window constant', () => {
    expect(INACTIVITY_RETURN_WINDOW_DAYS).toBe(3);
    expect(INACTIVITY_RETURN_WINDOW_DAYS).toBe(
      ADAPTIVE_LOOPS_BC_RULES.inactivity_return_window_days,
    );
  });

  it('window-end helper computes createdAt + windowDays * 1 day', () => {
    expect(inactivityReturnWindowEndMs(record())).toBe(WINDOW_END);
  });

  it('window-end falls back to the canonical window on a non-positive windowDays', () => {
    expect(inactivityReturnWindowEndMs(record({ windowDays: 0 }))).toBe(WINDOW_END);
    expect(inactivityReturnWindowEndMs(record({ windowDays: NaN }))).toBe(WINDOW_END);
    expect(inactivityReturnWindowEndMs(record({ windowDays: -5 }))).toBe(WINDOW_END);
  });
});

describe('evaluateInactivityReturn — returned', () => {
  it('returned: qualifying activity inside the window (day 1)', () => {
    const at = CREATED + 1 * MS_PER_DAY;
    const r = evaluateInactivityReturn(record(), [act(at)], at);
    expect(r.verdict).toBe('returned');
    expect(r.lastActiveMs).toBe(at);
    expect(r.daysSinceIntervention).toBe(1);
  });

  it('returned: earliest qualifying activity wins when several are in-window', () => {
    const r = evaluateInactivityReturn(
      record(),
      [act(CREATED + 2 * MS_PER_DAY), act(CREATED + 1 * MS_PER_DAY)],
      WINDOW_END,
    );
    expect(r.verdict).toBe('returned');
    expect(r.lastActiveMs).toBe(CREATED + 1 * MS_PER_DAY);
    expect(r.daysSinceIntervention).toBe(1);
  });

  it('returned: activity at the exact creation instant counts (inclusive start, day 0)', () => {
    const r = evaluateInactivityReturn(record(), [act(CREATED)], CREATED);
    expect(r.verdict).toBe('returned');
    expect(r.lastActiveMs).toBe(CREATED);
    expect(r.daysSinceIntervention).toBe(0);
  });

  it('returned: activity at the exact window-end boundary beats same-instant expiry', () => {
    const r = evaluateInactivityReturn(record(), [act(WINDOW_END)], WINDOW_END);
    expect(r.verdict).toBe('returned');
    expect(r.lastActiveMs).toBe(WINDOW_END);
    expect(r.daysSinceIntervention).toBe(3);
  });

  it('returned: a late evaluation of an in-window return still reads returned', () => {
    // Activity landed at day 1 (in-window); the cron ran days later (past window).
    const at = CREATED + 1 * MS_PER_DAY;
    const r = evaluateInactivityReturn(record(), [act(at)], WINDOW_END + 5 * MS_PER_DAY);
    expect(r.verdict).toBe('returned');
    expect(r.lastActiveMs).toBe(at);
  });
});

describe('evaluateInactivityReturn — pending', () => {
  it('pending: window open, no qualifying activity (day 2 of 3)', () => {
    const r = evaluateInactivityReturn(record(), [], CREATED + 2 * MS_PER_DAY);
    expect(r.verdict).toBe('pending');
    expect(r.lastActiveMs).toBeNull();
    expect(r.daysSinceIntervention).toBeNull();
  });

  it('pending: at exactly the window-end boundary, still no activity (not yet expired)', () => {
    const r = evaluateInactivityReturn(record(), [], WINDOW_END);
    expect(r.verdict).toBe('pending');
  });

  it('pending: empty observations inside the window', () => {
    const r = evaluateInactivityReturn(record(), [], CREATED + 1 * MS_PER_DAY);
    expect(r.verdict).toBe('pending');
  });

  it('pending: only future activity (observedAt > now) — not yet a return', () => {
    const r = evaluateInactivityReturn(
      record(),
      [act(CREATED + 2 * MS_PER_DAY)],
      CREATED + 1 * MS_PER_DAY,
    );
    expect(r.verdict).toBe('pending');
  });
});

describe('evaluateInactivityReturn — expired (bias to parent escalation)', () => {
  it('expired: strictly after the window, still no activity (day 4)', () => {
    const r = evaluateInactivityReturn(record(), [], CREATED + 4 * MS_PER_DAY);
    expect(r.verdict).toBe('expired');
    expect(r.lastActiveMs).toBeNull();
    expect(r.daysSinceIntervention).toBeNull();
  });

  it('expired: one ms after the boundary', () => {
    const r = evaluateInactivityReturn(record(), [], WINDOW_END + 1);
    expect(r.verdict).toBe('expired');
  });

  it('expired: ignores activity BEFORE the nudge (not a return to it)', () => {
    const r = evaluateInactivityReturn(
      record(),
      [act(CREATED - 1)],
      CREATED + 4 * MS_PER_DAY,
    );
    expect(r.verdict).toBe('expired');
  });

  it('expired: ignores activity AFTER the window even if before now', () => {
    const r = evaluateInactivityReturn(
      record(),
      [act(WINDOW_END + MS_PER_DAY)],
      WINDOW_END + 2 * MS_PER_DAY,
    );
    expect(r.verdict).toBe('expired');
  });

  it('never fabricates returned: future + pre-nudge observations after the window ⇒ expired', () => {
    const r = evaluateInactivityReturn(
      record(),
      [act(CREATED - 5 * MS_PER_DAY), act(WINDOW_END + 100 * MS_PER_DAY)],
      WINDOW_END + 1,
    );
    expect(r.verdict).toBe('expired');
    expect(r.lastActiveMs).toBeNull();
  });
});

describe('evaluateInactivityReturn — malformed / defensive', () => {
  it('malformed createdAt ⇒ pending', () => {
    expect(evaluateInactivityReturn(record({ createdAtMs: NaN }), [], NOW).verdict).toBe(
      'pending',
    );
  });

  it('malformed clock ⇒ pending', () => {
    expect(evaluateInactivityReturn(record(), [], NaN).verdict).toBe('pending');
  });

  it('null record ⇒ pending', () => {
    // @ts-expect-error — null record exercises the defensive path
    expect(evaluateInactivityReturn(null, [], NOW).verdict).toBe('pending');
  });

  it('skips malformed observation timestamps without throwing', () => {
    const at = CREATED + 1 * MS_PER_DAY;
    const r = evaluateInactivityReturn(record(), [act(NaN), act(at)], at);
    expect(r.verdict).toBe('returned');
    expect(r.lastActiveMs).toBe(at);
  });

  it('undefined observations ⇒ pending inside window', () => {
    // @ts-expect-error — undefined observation array exercises the defensive path
    expect(evaluateInactivityReturn(record(), undefined, CREATED + 1 * MS_PER_DAY).verdict).toBe(
      'pending',
    );
  });

  it('null observation entries are skipped without throwing', () => {
    const at = CREATED + 1 * MS_PER_DAY;
    // @ts-expect-error — a null entry in the array
    const r = evaluateInactivityReturn(record(), [null, act(at)], at);
    expect(r.verdict).toBe('returned');
  });
});
