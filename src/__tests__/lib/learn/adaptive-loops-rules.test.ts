/**
 * Unit tests for src/lib/learn/adaptive-loops-rules.ts
 *
 * Pure logic layer for Phase A Loops B (inactivity) & C (at-risk
 * concentration) + the cross-loop arbiter (anti-storm core). Pins:
 *
 *   - Ratified B/C constants + the structural rule that the band boundary is
 *     IMPORTED from PULSE_THRESHOLDS, not redefined (guardrail B/C-6).
 *   - Loop B planner: trigger-on-'broken'-only, onboarding grace (exclusive
 *     boundary), one-active-max, nudge cooldown (exclusive +N boundary),
 *     cross-loop ceiling deference, decision precedence.
 *   - Loop B evaluateReturn: returned / pending / expired; rolling-ms window,
 *     inclusive ends, 'expired' only strictly after windowEnd, return-at-
 *     boundary beats same-instant expiry, malformed → pending.
 *   - Loop C planner: trigger-on-'high'-only, one-active-per-(student,subject),
 *     A↔C coexistence, subject cooldown, ceiling deference, precedence.
 *   - Loop C evaluateConcentrationResolution: resolved / pending / expired;
 *     band exactly at 'high' boundary (count 4/5/6), latest-snapshot decides,
 *     window boundary, malformed → pending.
 *   - Arbiter: ceiling at 0/1, precedence A>C>B, same-loop severity tie-break,
 *     empty/null inputs.
 *
 * Style mirrors src/__tests__/lib/learn/recovery-evaluation.test.ts and
 * src/__tests__/lib/irt/fisher-info.test.ts.
 */

import { describe, it, expect } from 'vitest';
import {
  ADAPTIVE_LOOPS_BC_RULES,
  INACTIVITY_SENTINEL_SUBJECT,
  INACTIVITY_SENTINEL_CHAPTER,
  triggerSignalForLoop,
  loopForTriggerSignal,
  planInactivityIntervention,
  evaluateReturn,
  inactivityReturnWindowEndMs,
  planConcentrationIntervention,
  evaluateConcentrationResolution,
  concentrationReturnWindowEndMs,
  arbitrateInterventions,
  type PlanInactivityInput,
  type InactivityInterventionRecord,
  type ActivityObservation,
  type PlanConcentrationInput,
  type ConcentrationInterventionRecord,
  type SubjectSnapshotObservation,
  type InterventionCandidate,
  type ActiveInterventionRef,
  type TerminalInterventionRef,
} from '@/lib/learn/adaptive-loops-rules';
import { PULSE_THRESHOLDS } from '@/lib/pulse/signals';

const MS_PER_DAY = 86_400_000;
const NOW = 1_750_000_000_000;

// ════════════════════════════════════════════════════════════════════════════
// CONSTANTS — ratified values + the no-duplicate-threshold structural rule
// ════════════════════════════════════════════════════════════════════════════

describe('ADAPTIVE_LOOPS_BC_RULES — ratified constants', () => {
  it('pins the Loop B constants', () => {
    expect(ADAPTIVE_LOOPS_BC_RULES.inactivity_return_window_days).toBe(3);
    expect(ADAPTIVE_LOOPS_BC_RULES.nudge_cooldown_days).toBe(7);
    expect(ADAPTIVE_LOOPS_BC_RULES.onboarding_grace_days).toBe(7);
  });

  it('pins the Loop C constants', () => {
    expect(ADAPTIVE_LOOPS_BC_RULES.concentration_return_window_days).toBe(14);
    expect(ADAPTIVE_LOOPS_BC_RULES.concentration_cooldown_days).toBe(7);
  });

  it('pins the cross-loop daily ceiling', () => {
    expect(ADAPTIVE_LOOPS_BC_RULES.per_student_daily_intervention_ceiling).toBe(1);
  });

  // B/C-6: the band boundary must be the SAME value as the signal layer, never
  // redefined. This is the structural anti-drift test.
  it('reuses concentration_high_min from PULSE_THRESHOLDS (no duplicate threshold)', () => {
    expect(ADAPTIVE_LOOPS_BC_RULES.concentration_high_min).toBe(
      PULSE_THRESHOLDS.concentration_high_min,
    );
  });

  it('cooldown strictly exceeds the return window for both loops (no instant re-open)', () => {
    // A row that just expired cannot immediately re-open under the same drift.
    expect(ADAPTIVE_LOOPS_BC_RULES.nudge_cooldown_days).toBeGreaterThan(
      ADAPTIVE_LOOPS_BC_RULES.inactivity_return_window_days,
    );
    expect(ADAPTIVE_LOOPS_BC_RULES.concentration_cooldown_days).toBeLessThanOrEqual(
      ADAPTIVE_LOOPS_BC_RULES.concentration_return_window_days,
    );
  });
});

describe('trigger-signal <-> loop mapping', () => {
  it('maps loop -> trigger_signal', () => {
    expect(triggerSignalForLoop('A')).toBe('mastery_cliff');
    expect(triggerSignalForLoop('B')).toBe('inactivity');
    expect(triggerSignalForLoop('C')).toBe('at_risk_concentration');
  });
  it('maps trigger_signal -> loop (round trip)', () => {
    expect(loopForTriggerSignal('mastery_cliff')).toBe('A');
    expect(loopForTriggerSignal('inactivity')).toBe('B');
    expect(loopForTriggerSignal('at_risk_concentration')).toBe('C');
  });
  it('sentinels are the reserved Loop B target columns', () => {
    expect(INACTIVITY_SENTINEL_SUBJECT).toBe('_inactivity');
    expect(INACTIVITY_SENTINEL_CHAPTER).toBe(0);
    // sentinel subject passes the `subject_code = lower(subject_code)` CHECK
    expect(INACTIVITY_SENTINEL_SUBJECT).toBe(INACTIVITY_SENTINEL_SUBJECT.toLowerCase());
  });
});

// ════════════════════════════════════════════════════════════════════════════
// LOOP B — planInactivityIntervention
// ════════════════════════════════════════════════════════════════════════════

function bInput(over: Partial<PlanInactivityInput> = {}): PlanInactivityInput {
  return {
    inactivityVerdict: 'broken',
    daysSinceActive: 2,
    // created well outside the 7-day onboarding grace
    studentCreatedAtMs: NOW - 30 * MS_PER_DAY,
    activeInterventions: [],
    recentTerminalInterventions: [],
    ceilingAlreadySpent: false,
    nowMs: NOW,
    ...over,
  };
}

describe('planInactivityIntervention', () => {
  it('opens when all guardrails pass on a broken verdict', () => {
    const r = planInactivityIntervention(bInput());
    expect(r.open).toBe(true);
    expect(r.decision).toBe('open');
  });

  it.each([['ok'], ['at_risk'], ['never'], ['unknown']] as const)(
    'does NOT open on verdict %s (only broken triggers — B3)',
    (verdict) => {
      const r = planInactivityIntervention(bInput({ inactivityVerdict: verdict }));
      expect(r.open).toBe(false);
      expect(r.decision).toBe('not_broken');
    },
  );

  it('grace day at_risk never opens (handled by the streak system)', () => {
    expect(planInactivityIntervention(bInput({ inactivityVerdict: 'at_risk' })).decision).toBe(
      'not_broken',
    );
  });

  describe('onboarding grace (B-G6) — exclusive boundary', () => {
    it('blocks an account younger than the grace window', () => {
      const r = planInactivityIntervention(
        bInput({ studentCreatedAtMs: NOW - 6 * MS_PER_DAY }),
      );
      expect(r.decision).toBe('onboarding_grace');
    });
    it('blocks just-inside grace (one ms before the boundary)', () => {
      const r = planInactivityIntervention(
        bInput({ studentCreatedAtMs: NOW - 7 * MS_PER_DAY + 1 }),
      );
      expect(r.decision).toBe('onboarding_grace');
    });
    it('allows exactly at the grace boundary (created exactly 7 days ago — grace-exclusive)', () => {
      const r = planInactivityIntervention(
        bInput({ studentCreatedAtMs: NOW - 7 * MS_PER_DAY }),
      );
      expect(r.open).toBe(true);
    });
    it('treats unparseable created-at as in-grace (degrade, do not nudge)', () => {
      expect(
        planInactivityIntervention(bInput({ studentCreatedAtMs: NaN })).decision,
      ).toBe('onboarding_grace');
    });
  });

  it('blocks when a Loop B inactivity row is already active (B-G1)', () => {
    const active: ActiveInterventionRef[] = [
      {
        triggerSignal: 'inactivity',
        subjectCode: INACTIVITY_SENTINEL_SUBJECT,
        chapterNumber: INACTIVITY_SENTINEL_CHAPTER,
      },
    ];
    expect(
      planInactivityIntervention(bInput({ activeInterventions: active })).decision,
    ).toBe('active_exists');
  });

  it('an active A or C row does NOT count as an active inactivity row', () => {
    const active: ActiveInterventionRef[] = [
      { triggerSignal: 'mastery_cliff', subjectCode: 'math', chapterNumber: 4 },
      { triggerSignal: 'at_risk_concentration', subjectCode: 'science', chapterNumber: 2 },
    ];
    // Still opens (those are not inactivity rows); ceiling is the cross-loop guard.
    expect(planInactivityIntervention(bInput({ activeInterventions: active })).open).toBe(
      true,
    );
  });

  describe('nudge cooldown (B-G3) — exclusive +N boundary', () => {
    const terminal = (deltaDays: number): TerminalInterventionRef[] => [
      {
        triggerSignal: 'inactivity',
        subjectCode: INACTIVITY_SENTINEL_SUBJECT,
        chapterNumber: INACTIVITY_SENTINEL_CHAPTER,
        terminalAtMs: NOW - deltaDays * MS_PER_DAY,
      },
    ];
    it('blocks within the 7-day cooldown', () => {
      expect(
        planInactivityIntervention(bInput({ recentTerminalInterventions: terminal(6) }))
          .decision,
      ).toBe('cooldown');
    });
    it('blocks just inside the boundary (one ms before +7d)', () => {
      const t: TerminalInterventionRef[] = [
        {
          triggerSignal: 'inactivity',
          subjectCode: INACTIVITY_SENTINEL_SUBJECT,
          chapterNumber: INACTIVITY_SENTINEL_CHAPTER,
          terminalAtMs: NOW - 7 * MS_PER_DAY + 1,
        },
      ];
      expect(
        planInactivityIntervention(bInput({ recentTerminalInterventions: t })).decision,
      ).toBe('cooldown');
    });
    it('allows exactly at +7 days (exclusive end)', () => {
      expect(
        planInactivityIntervention(bInput({ recentTerminalInterventions: terminal(7) }))
          .open,
      ).toBe(true);
    });
    it('a terminal A/C row does not start an inactivity cooldown', () => {
      const t: TerminalInterventionRef[] = [
        {
          triggerSignal: 'at_risk_concentration',
          subjectCode: 'science',
          chapterNumber: 3,
          terminalAtMs: NOW - 1 * MS_PER_DAY,
        },
      ];
      expect(
        planInactivityIntervention(bInput({ recentTerminalInterventions: t })).open,
      ).toBe(true);
    });
  });

  it('defers when the daily ceiling was already spent by A/C (X3)', () => {
    expect(
      planInactivityIntervention(bInput({ ceilingAlreadySpent: true })).decision,
    ).toBe('ceiling_spent');
  });

  it('decision precedence: not_broken outranks every other gate', () => {
    // Even with grace + active + cooldown + ceiling all tripped, a non-broken
    // verdict short-circuits to not_broken (cheapest, most-fundamental gate).
    const r = planInactivityIntervention(
      bInput({
        inactivityVerdict: 'ok',
        studentCreatedAtMs: NOW, // in grace
        ceilingAlreadySpent: true,
      }),
    );
    expect(r.decision).toBe('not_broken');
  });

  it('decision precedence: onboarding_grace outranks ceiling', () => {
    const r = planInactivityIntervention(
      bInput({ studentCreatedAtMs: NOW, ceilingAlreadySpent: true }),
    );
    expect(r.decision).toBe('onboarding_grace');
  });

  it('handles null/empty inputs without throwing', () => {
    // @ts-expect-error — exercise the defensive null-input path
    expect(planInactivityIntervention(undefined).open).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// LOOP B — evaluateReturn
// ════════════════════════════════════════════════════════════════════════════

const B_CREATED = NOW;
const B_WINDOW_END = B_CREATED + 3 * MS_PER_DAY;

function bRecord(
  over: Partial<InactivityInterventionRecord> = {},
): InactivityInterventionRecord {
  return { createdAtMs: B_CREATED, windowDays: 3, ...over };
}
function act(atMs: number): ActivityObservation {
  return { observedAtMs: atMs };
}

describe('inactivityReturnWindowEndMs', () => {
  it('computes createdAt + windowDays * 1 day', () => {
    expect(inactivityReturnWindowEndMs(bRecord())).toBe(B_WINDOW_END);
  });
  it('falls back to the canonical window on a non-positive windowDays', () => {
    expect(inactivityReturnWindowEndMs(bRecord({ windowDays: 0 }))).toBe(B_WINDOW_END);
    expect(inactivityReturnWindowEndMs(bRecord({ windowDays: NaN }))).toBe(B_WINDOW_END);
  });
});

describe('evaluateReturn', () => {
  it('returned: qualifying activity inside the window', () => {
    const r = evaluateReturn(bRecord(), [act(B_CREATED + 1 * MS_PER_DAY)], B_CREATED + 1 * MS_PER_DAY);
    expect(r.verdict).toBe('returned');
    expect(r.returnedAtMs).toBe(B_CREATED + 1 * MS_PER_DAY);
    expect(r.daysToReturn).toBe(1);
  });

  it('returned: earliest qualifying activity wins when several are in-window', () => {
    const r = evaluateReturn(
      bRecord(),
      [act(B_CREATED + 2 * MS_PER_DAY), act(B_CREATED + 1 * MS_PER_DAY)],
      B_WINDOW_END,
    );
    expect(r.returnedAtMs).toBe(B_CREATED + 1 * MS_PER_DAY);
  });

  it('returned: activity at the exact creation instant counts (inclusive start)', () => {
    const r = evaluateReturn(bRecord(), [act(B_CREATED)], B_CREATED);
    expect(r.verdict).toBe('returned');
    expect(r.daysToReturn).toBe(0);
  });

  it('returned: activity at the exact window-end boundary beats same-instant expiry', () => {
    const r = evaluateReturn(bRecord(), [act(B_WINDOW_END)], B_WINDOW_END);
    expect(r.verdict).toBe('returned');
  });

  it('pending: window open, no qualifying activity (day 2 of 3)', () => {
    const r = evaluateReturn(bRecord(), [], B_CREATED + 2 * MS_PER_DAY);
    expect(r.verdict).toBe('pending');
    expect(r.returnedAtMs).toBeNull();
    expect(r.daysToReturn).toBeNull();
  });

  it('pending: at exactly the window-end boundary, still no activity (not yet expired)', () => {
    const r = evaluateReturn(bRecord(), [], B_WINDOW_END);
    expect(r.verdict).toBe('pending');
  });

  it('expired: strictly after the window, still no activity (day 4)', () => {
    const r = evaluateReturn(bRecord(), [], B_CREATED + 4 * MS_PER_DAY);
    expect(r.verdict).toBe('expired');
  });

  it('expired: one ms after the boundary', () => {
    const r = evaluateReturn(bRecord(), [], B_WINDOW_END + 1);
    expect(r.verdict).toBe('expired');
  });

  it('ignores activity BEFORE the nudge (not a return to it)', () => {
    const r = evaluateReturn(bRecord(), [act(B_CREATED - 1)], B_CREATED + 4 * MS_PER_DAY);
    expect(r.verdict).toBe('expired');
  });

  it('ignores activity AFTER the window even if before now', () => {
    const r = evaluateReturn(
      bRecord(),
      [act(B_WINDOW_END + MS_PER_DAY)],
      B_WINDOW_END + 2 * MS_PER_DAY,
    );
    expect(r.verdict).toBe('expired');
  });

  it('ignores future activity readings (observedAt > now)', () => {
    const r = evaluateReturn(bRecord(), [act(B_CREATED + 2 * MS_PER_DAY)], B_CREATED + 1 * MS_PER_DAY);
    // The only activity is in the future relative to now → not yet a return.
    expect(r.verdict).toBe('pending');
  });

  it('malformed record/clock → pending (never falsely escalates to parent)', () => {
    expect(evaluateReturn(bRecord({ createdAtMs: NaN }), [], NOW).verdict).toBe('pending');
    expect(evaluateReturn(bRecord(), [], NaN).verdict).toBe('pending');
    // @ts-expect-error — null record
    expect(evaluateReturn(null, [], NOW).verdict).toBe('pending');
  });

  it('skips malformed observation timestamps without throwing', () => {
    const r = evaluateReturn(
      bRecord(),
      [act(NaN), act(B_CREATED + 1 * MS_PER_DAY)],
      B_CREATED + 1 * MS_PER_DAY,
    );
    expect(r.verdict).toBe('returned');
  });

  it('empty/undefined observations → pending inside window', () => {
    // @ts-expect-error — undefined observation array
    expect(evaluateReturn(bRecord(), undefined, B_CREATED + 1 * MS_PER_DAY).verdict).toBe(
      'pending',
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// LOOP C — planConcentrationIntervention
// ════════════════════════════════════════════════════════════════════════════

function cInput(over: Partial<PlanConcentrationInput> = {}): PlanConcentrationInput {
  return {
    subjectCode: 'math',
    band: 'high',
    activeInterventions: [],
    recentTerminalInterventions: [],
    ceilingAlreadySpent: false,
    nowMs: NOW,
    ...over,
  };
}

describe('planConcentrationIntervention', () => {
  it('opens on band high with all guardrails passing', () => {
    const r = planConcentrationIntervention(cInput());
    expect(r.open).toBe(true);
    expect(r.decision).toBe('open');
  });

  it.each([['none'], ['low'], ['medium']] as const)(
    'does NOT open on band %s (only high triggers — C1)',
    (band) => {
      const r = planConcentrationIntervention(cInput({ band }));
      expect(r.open).toBe(false);
      expect(r.decision).toBe('not_high');
    },
  );

  it('blocks when a Loop C row is already active for this subject (C-G1)', () => {
    const active: ActiveInterventionRef[] = [
      { triggerSignal: 'at_risk_concentration', subjectCode: 'math', chapterNumber: 7 },
    ];
    expect(
      planConcentrationIntervention(cInput({ activeInterventions: active })).decision,
    ).toBe('active_exists');
  });

  it('an active C row in a DIFFERENT subject does not block', () => {
    const active: ActiveInterventionRef[] = [
      { triggerSignal: 'at_risk_concentration', subjectCode: 'science', chapterNumber: 7 },
    ];
    expect(
      planConcentrationIntervention(cInput({ activeInterventions: active })).open,
    ).toBe(true);
  });

  describe('A↔C coexistence (C-G3)', () => {
    it('blocks when an active Loop A row exists on ANY chapter in this subject', () => {
      const active: ActiveInterventionRef[] = [
        { triggerSignal: 'mastery_cliff', subjectCode: 'math', chapterNumber: 11 },
      ];
      expect(
        planConcentrationIntervention(cInput({ activeInterventions: active })).decision,
      ).toBe('coexists_with_a');
    });
    it('does NOT block when the active Loop A row is in a different subject', () => {
      const active: ActiveInterventionRef[] = [
        { triggerSignal: 'mastery_cliff', subjectCode: 'science', chapterNumber: 11 },
      ];
      expect(
        planConcentrationIntervention(cInput({ activeInterventions: active })).open,
      ).toBe(true);
    });
    it('active_exists (C-G1) is evaluated before coexistence', () => {
      const active: ActiveInterventionRef[] = [
        { triggerSignal: 'at_risk_concentration', subjectCode: 'math', chapterNumber: 3 },
        { triggerSignal: 'mastery_cliff', subjectCode: 'math', chapterNumber: 4 },
      ];
      expect(
        planConcentrationIntervention(cInput({ activeInterventions: active })).decision,
      ).toBe('active_exists');
    });
  });

  describe('subject cooldown (C-G2) — exclusive +N boundary, per (student,subject)', () => {
    const terminal = (subject: string, deltaDays: number): TerminalInterventionRef[] => [
      {
        triggerSignal: 'at_risk_concentration',
        subjectCode: subject,
        chapterNumber: 5,
        terminalAtMs: NOW - deltaDays * MS_PER_DAY,
      },
    ];
    it('blocks within 7 days of a terminal concentration row for the subject', () => {
      expect(
        planConcentrationIntervention(
          cInput({ recentTerminalInterventions: terminal('math', 6) }),
        ).decision,
      ).toBe('cooldown');
    });
    it('allows exactly at +7 days (exclusive end)', () => {
      expect(
        planConcentrationIntervention(
          cInput({ recentTerminalInterventions: terminal('math', 7) }),
        ).open,
      ).toBe(true);
    });
    it('a terminal concentration row in a DIFFERENT subject does not start this subject cooldown', () => {
      expect(
        planConcentrationIntervention(
          cInput({ recentTerminalInterventions: terminal('science', 1) }),
        ).open,
      ).toBe(true);
    });
  });

  it('defers when the daily ceiling was already spent by A (X3)', () => {
    expect(
      planConcentrationIntervention(cInput({ ceilingAlreadySpent: true })).decision,
    ).toBe('ceiling_spent');
  });

  it('decision precedence: not_high outranks every other gate', () => {
    const r = planConcentrationIntervention(
      cInput({
        band: 'low',
        activeInterventions: [
          { triggerSignal: 'at_risk_concentration', subjectCode: 'math', chapterNumber: 2 },
        ],
        ceilingAlreadySpent: true,
      }),
    );
    expect(r.decision).toBe('not_high');
  });

  it('handles null input without throwing', () => {
    // @ts-expect-error — exercise the defensive null-input path
    expect(planConcentrationIntervention(undefined).open).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// LOOP C — evaluateConcentrationResolution
// ════════════════════════════════════════════════════════════════════════════

const C_CREATED = NOW;
const C_WINDOW_END = C_CREATED + 14 * MS_PER_DAY;

function cRecord(
  over: Partial<ConcentrationInterventionRecord> = {},
): ConcentrationInterventionRecord {
  return { subjectCode: 'math', createdAtMs: C_CREATED, windowDays: 14, ...over };
}
function snap(
  count: number,
  atMs: number,
  over: Partial<SubjectSnapshotObservation> = {},
): SubjectSnapshotObservation {
  return { subjectCode: 'math', atRiskChapterCount: count, observedAtMs: atMs, ...over };
}

describe('concentrationReturnWindowEndMs', () => {
  it('computes createdAt + 14 days', () => {
    expect(concentrationReturnWindowEndMs(cRecord())).toBe(C_WINDOW_END);
  });
  it('falls back to the canonical window on a non-positive windowDays', () => {
    expect(concentrationReturnWindowEndMs(cRecord({ windowDays: -1 }))).toBe(C_WINDOW_END);
  });
});

describe('evaluateConcentrationResolution — band boundary at high_min (5)', () => {
  const HIGH_MIN = PULSE_THRESHOLDS.concentration_high_min; // 5

  it('count 6 (above high_min) → still high → pending inside window', () => {
    const r = evaluateConcentrationResolution(
      cRecord(),
      [snap(HIGH_MIN + 1, C_CREATED + 1 * MS_PER_DAY)],
      C_CREATED + 1 * MS_PER_DAY,
    );
    expect(r.bandNow).toBe('high');
    expect(r.verdict).toBe('pending');
  });

  it('count 5 (exactly high_min) → still high → NOT resolved', () => {
    const r = evaluateConcentrationResolution(
      cRecord(),
      [snap(HIGH_MIN, C_CREATED + 1 * MS_PER_DAY)],
      C_CREATED + 1 * MS_PER_DAY,
    );
    expect(r.bandNow).toBe('high');
    expect(r.verdict).toBe('pending');
  });

  it('count 4 (just below high_min) → band medium → resolved', () => {
    const r = evaluateConcentrationResolution(
      cRecord(),
      [snap(HIGH_MIN - 1, C_CREATED + 2 * MS_PER_DAY)],
      C_CREATED + 2 * MS_PER_DAY,
    );
    expect(r.bandNow).toBe('medium');
    expect(r.verdict).toBe('resolved');
    expect(r.atRiskChapterCountNow).toBe(HIGH_MIN - 1);
    expect(r.daysToResolve).toBe(2);
  });

  it('count 0 → band none → resolved', () => {
    const r = evaluateConcentrationResolution(
      cRecord(),
      [snap(0, C_CREATED + 3 * MS_PER_DAY)],
      C_CREATED + 3 * MS_PER_DAY,
    );
    expect(r.bandNow).toBe('none');
    expect(r.verdict).toBe('resolved');
  });
});

describe('evaluateConcentrationResolution — latest-snapshot & windows', () => {
  it('latest snapshot decides: a mid-window dip that climbs back to high is NOT resolved', () => {
    const r = evaluateConcentrationResolution(
      cRecord(),
      [
        snap(3, C_CREATED + 2 * MS_PER_DAY), // transient dip (medium)
        snap(6, C_CREATED + 5 * MS_PER_DAY), // climbed back to high (latest)
      ],
      C_CREATED + 5 * MS_PER_DAY,
    );
    expect(r.bandNow).toBe('high');
    expect(r.verdict).toBe('pending');
  });

  it('latest snapshot decides: a mid-window high followed by a drop IS resolved', () => {
    const r = evaluateConcentrationResolution(
      cRecord(),
      [
        snap(6, C_CREATED + 2 * MS_PER_DAY),
        snap(2, C_CREATED + 6 * MS_PER_DAY), // latest → low
      ],
      C_CREATED + 6 * MS_PER_DAY,
    );
    expect(r.verdict).toBe('resolved');
    expect(r.bandNow).toBe('low');
  });

  it('resolution at the exact window-end boundary beats same-instant expiry', () => {
    const r = evaluateConcentrationResolution(
      cRecord(),
      [snap(2, C_WINDOW_END)],
      C_WINDOW_END,
    );
    expect(r.verdict).toBe('resolved');
  });

  it('pending at exactly the window-end boundary while still high', () => {
    const r = evaluateConcentrationResolution(cRecord(), [snap(6, C_WINDOW_END)], C_WINDOW_END);
    expect(r.verdict).toBe('pending');
  });

  it('expired: strictly after the window, still high', () => {
    const r = evaluateConcentrationResolution(
      cRecord(),
      [snap(6, C_CREATED + 10 * MS_PER_DAY)],
      C_WINDOW_END + 1,
    );
    expect(r.verdict).toBe('expired');
    expect(r.bandNow).toBe('high');
  });

  it('expired: no snapshot at all after the window', () => {
    const r = evaluateConcentrationResolution(cRecord(), [], C_WINDOW_END + 1);
    expect(r.verdict).toBe('expired');
    expect(r.atRiskChapterCountNow).toBeNull();
    expect(r.bandNow).toBeNull();
  });

  it('ignores snapshots for a different subject', () => {
    const r = evaluateConcentrationResolution(
      cRecord(),
      [snap(2, C_CREATED + 2 * MS_PER_DAY, { subjectCode: 'science' })],
      C_CREATED + 2 * MS_PER_DAY,
    );
    // No matching-subject snapshot → pending inside window.
    expect(r.verdict).toBe('pending');
  });

  it('ignores pre-intervention and future snapshots', () => {
    const r = evaluateConcentrationResolution(
      cRecord(),
      [snap(2, C_CREATED - 1), snap(2, C_CREATED + 20 * MS_PER_DAY)],
      C_CREATED + 5 * MS_PER_DAY,
    );
    expect(r.verdict).toBe('pending');
  });

  it('malformed record/clock → pending (never falsely re-notifies)', () => {
    expect(
      evaluateConcentrationResolution(cRecord({ createdAtMs: NaN }), [], NOW).verdict,
    ).toBe('pending');
    expect(evaluateConcentrationResolution(cRecord(), [], NaN).verdict).toBe('pending');
    // @ts-expect-error — null record
    expect(evaluateConcentrationResolution(null, [], NOW).verdict).toBe('pending');
  });

  it('skips malformed snapshot fields without throwing', () => {
    const r = evaluateConcentrationResolution(
      cRecord(),
      [snap(NaN, C_CREATED + 1 * MS_PER_DAY), snap(2, C_CREATED + 2 * MS_PER_DAY)],
      C_CREATED + 2 * MS_PER_DAY,
    );
    expect(r.verdict).toBe('resolved');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CROSS-LOOP ARBITER
// ════════════════════════════════════════════════════════════════════════════

function cand(
  loop: 'A' | 'B' | 'C',
  over: Partial<InterventionCandidate> = {},
): InterventionCandidate {
  return { loop, subjectCode: 'math', chapterNumber: 1, ...over };
}

describe('arbitrateInterventions — ceiling', () => {
  it('opens nothing when the slot was already spent tonight (ceiling = 1, at 1)', () => {
    const r = arbitrateInterventions([cand('A'), cand('C'), cand('B')], true);
    expect(r.selected).toBeNull();
    expect(r.reason).toBe('ceiling_already_spent');
  });

  it('opens one when the slot is free (ceiling at 0)', () => {
    const r = arbitrateInterventions([cand('B')], false);
    expect(r.selected?.loop).toBe('B');
    expect(r.reason).toBe('opened');
  });

  it('no candidates → null, reason no_candidates', () => {
    expect(arbitrateInterventions([], false).reason).toBe('no_candidates');
  });

  it('null candidate array → null, reason no_candidates', () => {
    // @ts-expect-error — defensive null path
    expect(arbitrateInterventions(undefined, false).reason).toBe('no_candidates');
  });
});

describe('arbitrateInterventions — precedence A > C > B', () => {
  it('A wins over C and B when all three fire', () => {
    const r = arbitrateInterventions([cand('B'), cand('C'), cand('A')], false);
    expect(r.selected?.loop).toBe('A');
  });

  it('C wins over B when A is absent', () => {
    const r = arbitrateInterventions([cand('B'), cand('C')], false);
    expect(r.selected?.loop).toBe('C');
  });

  it('B opens when it is the only candidate', () => {
    expect(arbitrateInterventions([cand('B')], false).selected?.loop).toBe('B');
  });

  it('precedence is independent of input order (C before A still picks A)', () => {
    expect(arbitrateInterventions([cand('C'), cand('A')], false).selected?.loop).toBe('A');
  });
});

describe('arbitrateInterventions — same-loop severity tie-break', () => {
  it('picks the higher-severity candidate within the winning loop', () => {
    const r = arbitrateInterventions(
      [
        cand('A', { subjectCode: 'math', chapterNumber: 2, severity: 0.2 }),
        cand('A', { subjectCode: 'science', chapterNumber: 5, severity: 0.8 }),
      ],
      false,
    );
    expect(r.selected?.subjectCode).toBe('science');
    expect(r.selected?.severity).toBe(0.8);
  });

  it('null/non-finite severity sorts after any known severity', () => {
    const r = arbitrateInterventions(
      [
        cand('C', { subjectCode: 'aaa', chapterNumber: 1, severity: null }),
        cand('C', { subjectCode: 'zzz', chapterNumber: 9, severity: 0.1 }),
      ],
      false,
    );
    expect(r.selected?.subjectCode).toBe('zzz');
  });

  it('equal severity breaks by subjectCode asc then chapterNumber asc (deterministic)', () => {
    const r = arbitrateInterventions(
      [
        cand('A', { subjectCode: 'math', chapterNumber: 9, severity: 0.5 }),
        cand('A', { subjectCode: 'math', chapterNumber: 3, severity: 0.5 }),
        cand('A', { subjectCode: 'english', chapterNumber: 12, severity: 0.5 }),
      ],
      false,
    );
    expect(r.selected?.subjectCode).toBe('english');
  });

  it('filters out malformed candidates with an unknown loop', () => {
    const r = arbitrateInterventions(
      // @ts-expect-error — bad loop id is filtered out
      [{ loop: 'X', subjectCode: 'math', chapterNumber: 1 }, cand('B')],
      false,
    );
    expect(r.selected?.loop).toBe('B');
  });
});
