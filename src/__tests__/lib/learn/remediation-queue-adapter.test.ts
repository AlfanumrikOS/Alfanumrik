/**
 * Unit tests for src/lib/learn/remediation-queue-adapter.ts
 *
 * Pins every guardrail of the adaptive closed loop's injection planner:
 *   - no_cliff gate (verdict + empty-candidate cases)
 *   - fatigue gate (strict > 0.6, mirrors cognitive-engine shouldEaseOff;
 *     exactly-at-threshold injects; null/NaN treated as not fatigued)
 *   - one-active-intervention-per-(subject, chapter)
 *   - 3-day same-chapter cooldown with exclusive end boundary
 *   - queue capacity: min(3 cards/day, 10 total - current size), fail-closed
 *     on unknown queue size
 *   - severity ordering, dedupe, deterministic tie-breaks, 1-based priority
 *   - deferred semantics (cooldown/capacity defer; active_exists does not)
 *
 * Style mirrors src/__tests__/lib/irt/fisher-info.test.ts.
 */

import { describe, it, expect } from 'vitest';
import type { MasteryCliffSignal } from '@/lib/pulse/signals';
import { PULSE_THRESHOLDS } from '@/lib/pulse/signals';
import {
  ADAPTIVE_REMEDIATION_RULES,
  compareBySeverity,
  planRemediationInjection,
  type AdaptiveInterventionCandidate,
  type PlanRemediationInput,
} from '@/lib/learn/remediation-queue-adapter';

const MS_PER_DAY = 86_400_000;
const NOW = 1_750_000_000_000;

function flagged(over: Partial<MasteryCliffSignal> = {}): MasteryCliffSignal {
  return {
    verdict: 'flagged',
    largestDrop: 0.3,
    declineStreak: 0,
    worstSubject: 'math',
    worstChapter: 4,
    ...over,
  };
}

function cand(
  over: Partial<AdaptiveInterventionCandidate> = {},
): AdaptiveInterventionCandidate {
  return {
    subjectCode: 'math',
    chapterNumber: 4,
    interventionId: 'iv-1',
    dropMagnitude: 0.3,
    ...over,
  };
}

function baseInput(over: Partial<PlanRemediationInput> = {}): PlanRemediationInput {
  return {
    cliffSignal: flagged(),
    candidates: [cand()],
    fatigueScore: null,
    activeInterventions: [],
    recentTerminalInterventions: [],
    currentQueueSize: 7, // base daily rhythm: 5 SRS + 1 ZPD + 1 reflection
    nowMs: NOW,
    ...over,
  };
}

describe('ADAPTIVE_REMEDIATION_RULES — ratified constants', () => {
  it('pins the ratified guardrail values', () => {
    expect(ADAPTIVE_REMEDIATION_RULES.max_remediation_cards_per_day).toBe(3);
    expect(ADAPTIVE_REMEDIATION_RULES.max_daily_queue_total).toBe(10);
    expect(ADAPTIVE_REMEDIATION_RULES.fatigue_skip_threshold).toBe(0.6);
    expect(ADAPTIVE_REMEDIATION_RULES.chapter_cooldown_days).toBe(3);
    expect(ADAPTIVE_REMEDIATION_RULES.verification_window_days).toBe(7);
  });

  it('REUSES Pulse thresholds for recovery (no duplicate constants)', () => {
    expect(ADAPTIVE_REMEDIATION_RULES.recovery_min_gain_from_trough).toBe(
      PULSE_THRESHOLDS.mastery_cliff_drop,
    );
    expect(ADAPTIVE_REMEDIATION_RULES.recovery_at_risk_floor).toBe(
      PULSE_THRESHOLDS.at_risk_mastery,
    );
  });
});

describe('planRemediationInjection — no_cliff gate', () => {
  it("verdict 'none' yields no_cliff even with candidates present", () => {
    const r = planRemediationInjection(
      baseInput({ cliffSignal: flagged({ verdict: 'none' }) }),
    );
    expect(r).toEqual({ inject: [], deferred: false, reason: 'no_cliff' });
  });

  it("verdict 'unknown' yields no_cliff", () => {
    const r = planRemediationInjection(
      baseInput({ cliffSignal: flagged({ verdict: 'unknown' }) }),
    );
    expect(r).toEqual({ inject: [], deferred: false, reason: 'no_cliff' });
  });

  it('flagged verdict with zero candidates yields no_cliff (nothing actionable)', () => {
    const r = planRemediationInjection(baseInput({ candidates: [] }));
    expect(r).toEqual({ inject: [], deferred: false, reason: 'no_cliff' });
  });
});

describe('planRemediationInjection — fatigue gate', () => {
  it('defers everything when fatigueScore is strictly above 0.6', () => {
    const r = planRemediationInjection(baseInput({ fatigueScore: 0.61 }));
    expect(r).toEqual({ inject: [], deferred: true, reason: 'fatigue' });
  });

  it('injects at exactly 0.6 (strict >, mirrors shouldEaseOff)', () => {
    const r = planRemediationInjection(baseInput({ fatigueScore: 0.6 }));
    expect(r.reason).toBe('ok');
    expect(r.inject).toHaveLength(1);
  });

  it('treats null fatigue (no recent session state) as not fatigued', () => {
    const r = planRemediationInjection(baseInput({ fatigueScore: null }));
    expect(r.reason).toBe('ok');
  });

  it('treats NaN fatigue as not fatigued (degrade, not block)', () => {
    const r = planRemediationInjection(baseInput({ fatigueScore: Number.NaN }));
    expect(r.reason).toBe('ok');
  });

  it('fatigue gate runs before per-candidate gates', () => {
    const r = planRemediationInjection(
      baseInput({
        fatigueScore: 0.9,
        activeInterventions: [{ subjectCode: 'math', chapterNumber: 4 }],
      }),
    );
    expect(r.reason).toBe('fatigue');
    expect(r.deferred).toBe(true);
  });
});

describe('planRemediationInjection — one active intervention per (subject, chapter)', () => {
  it('blocks a candidate whose chapter already has an active intervention', () => {
    const r = planRemediationInjection(
      baseInput({
        activeInterventions: [{ subjectCode: 'math', chapterNumber: 4 }],
      }),
    );
    // active_exists does NOT defer — the live intervention covers the chapter.
    expect(r).toEqual({ inject: [], deferred: false, reason: 'active_exists' });
  });

  it('an active intervention on a different chapter does not block', () => {
    const r = planRemediationInjection(
      baseInput({
        activeInterventions: [{ subjectCode: 'math', chapterNumber: 9 }],
      }),
    );
    expect(r.reason).toBe('ok');
    expect(r.inject).toHaveLength(1);
  });

  it('an active intervention on the same chapter of a different subject does not block', () => {
    const r = planRemediationInjection(
      baseInput({
        activeInterventions: [{ subjectCode: 'science', chapterNumber: 4 }],
      }),
    );
    expect(r.reason).toBe('ok');
  });
});

describe('planRemediationInjection — 3-day same-chapter cooldown', () => {
  const cooldownMs = ADAPTIVE_REMEDIATION_RULES.chapter_cooldown_days * MS_PER_DAY;

  it('blocks while inside the cooldown (1ms before it ends)', () => {
    const r = planRemediationInjection(
      baseInput({
        recentTerminalInterventions: [
          { subjectCode: 'math', chapterNumber: 4, terminalAtMs: NOW - cooldownMs + 1 },
        ],
      }),
    );
    expect(r).toEqual({ inject: [], deferred: true, reason: 'cooldown' });
  });

  it('allows at exactly cooldown end (exclusive end boundary)', () => {
    const r = planRemediationInjection(
      baseInput({
        recentTerminalInterventions: [
          { subjectCode: 'math', chapterNumber: 4, terminalAtMs: NOW - cooldownMs },
        ],
      }),
    );
    expect(r.reason).toBe('ok');
    expect(r.inject).toHaveLength(1);
  });

  it('terminal intervention on a different chapter does not block', () => {
    const r = planRemediationInjection(
      baseInput({
        recentTerminalInterventions: [
          { subjectCode: 'math', chapterNumber: 9, terminalAtMs: NOW - 1 },
        ],
      }),
    );
    expect(r.reason).toBe('ok');
  });

  it('a non-finite terminalAtMs is ignored (degrade, not block)', () => {
    const r = planRemediationInjection(
      baseInput({
        recentTerminalInterventions: [
          { subjectCode: 'math', chapterNumber: 4, terminalAtMs: Number.NaN },
        ],
      }),
    );
    expect(r.reason).toBe('ok');
  });
});

describe('planRemediationInjection — all-candidates-blocked aggregate reason', () => {
  const cooldownMs = ADAPTIVE_REMEDIATION_RULES.chapter_cooldown_days * MS_PER_DAY;

  it('reports the top-priority (deepest drop) blocker; cooldown elsewhere still defers', () => {
    const r = planRemediationInjection(
      baseInput({
        candidates: [
          cand({ subjectCode: 'math', chapterNumber: 4, interventionId: 'a', dropMagnitude: 0.5 }),
          cand({ subjectCode: 'science', chapterNumber: 2, interventionId: 'b', dropMagnitude: 0.2 }),
        ],
        activeInterventions: [{ subjectCode: 'math', chapterNumber: 4 }],
        recentTerminalInterventions: [
          { subjectCode: 'science', chapterNumber: 2, terminalAtMs: NOW - 1 },
        ],
      }),
    );
    expect(r.inject).toEqual([]);
    expect(r.reason).toBe('active_exists'); // blocker of the deepest-drop candidate
    expect(r.deferred).toBe(true); // a cooldown-blocked candidate becomes eligible later
  });

  it('reports cooldown when the deepest-drop candidate is cooldown-blocked', () => {
    const r = planRemediationInjection(
      baseInput({
        candidates: [
          cand({ subjectCode: 'math', chapterNumber: 4, interventionId: 'a', dropMagnitude: 0.5 }),
          cand({ subjectCode: 'science', chapterNumber: 2, interventionId: 'b', dropMagnitude: 0.2 }),
        ],
        recentTerminalInterventions: [
          { subjectCode: 'math', chapterNumber: 4, terminalAtMs: NOW - cooldownMs + 1 },
        ],
        activeInterventions: [{ subjectCode: 'science', chapterNumber: 2 }],
      }),
    );
    expect(r.inject).toEqual([]);
    expect(r.reason).toBe('cooldown');
    expect(r.deferred).toBe(true);
  });

  it('all blocked by active interventions only → not deferred', () => {
    const r = planRemediationInjection(
      baseInput({
        candidates: [
          cand({ subjectCode: 'math', chapterNumber: 4, interventionId: 'a' }),
          cand({ subjectCode: 'science', chapterNumber: 2, interventionId: 'b' }),
        ],
        activeInterventions: [
          { subjectCode: 'math', chapterNumber: 4 },
          { subjectCode: 'science', chapterNumber: 2 },
        ],
      }),
    );
    expect(r).toEqual({ inject: [], deferred: false, reason: 'active_exists' });
  });
});

describe('planRemediationInjection — queue capacity', () => {
  function manyCandidates(n: number): AdaptiveInterventionCandidate[] {
    return Array.from({ length: n }, (_, i) =>
      cand({
        subjectCode: 'math',
        chapterNumber: i + 1,
        interventionId: `iv-${i + 1}`,
        dropMagnitude: 0.5 - i * 0.05,
      }),
    );
  }

  it('base queue of 7 leaves capacity for exactly 3 cards', () => {
    const r = planRemediationInjection(
      baseInput({ candidates: manyCandidates(3), currentQueueSize: 7 }),
    );
    expect(r.inject).toHaveLength(3);
    expect(r.reason).toBe('ok');
    expect(r.deferred).toBe(false);
  });

  it('caps at 3 cards/day even with abundant queue headroom and candidates', () => {
    const r = planRemediationInjection(
      baseInput({ candidates: manyCandidates(5), currentQueueSize: 0 }),
    );
    expect(r.inject).toHaveLength(3);
    expect(r.reason).toBe('ok');
    expect(r.deferred).toBe(true); // 2 eligible candidates deferred by capacity
  });

  it('queue size 9 leaves room for exactly 1 card (10-total cap)', () => {
    const r = planRemediationInjection(
      baseInput({ candidates: manyCandidates(2), currentQueueSize: 9 }),
    );
    expect(r.inject).toHaveLength(1);
    expect(r.deferred).toBe(true);
    expect(r.reason).toBe('ok');
  });

  it('queue size 10 (exactly full) yields queue_full, deferred', () => {
    const r = planRemediationInjection(baseInput({ currentQueueSize: 10 }));
    expect(r).toEqual({ inject: [], deferred: true, reason: 'queue_full' });
  });

  it('queue size above the cap yields queue_full', () => {
    const r = planRemediationInjection(baseInput({ currentQueueSize: 12 }));
    expect(r.reason).toBe('queue_full');
  });

  it('negative queue size clamps to 0 (full 3-card capacity)', () => {
    const r = planRemediationInjection(
      baseInput({ candidates: manyCandidates(4), currentQueueSize: -5 }),
    );
    expect(r.inject).toHaveLength(3);
  });

  it('non-finite queue size fails closed as queue_full', () => {
    const r = planRemediationInjection(
      baseInput({ currentQueueSize: Number.NaN }),
    );
    expect(r).toEqual({ inject: [], deferred: true, reason: 'queue_full' });
  });
});

describe('planRemediationInjection — severity ordering, dedupe, priority', () => {
  it('orders by drop magnitude descending with 1-based priorities', () => {
    const r = planRemediationInjection(
      baseInput({
        candidates: [
          cand({ chapterNumber: 1, interventionId: 'small', dropMagnitude: 0.2 }),
          cand({ chapterNumber: 2, interventionId: 'big', dropMagnitude: 0.5 }),
          cand({ chapterNumber: 3, interventionId: 'mid', dropMagnitude: 0.3 }),
        ],
      }),
    );
    expect(r.inject.map((c) => c.interventionId)).toEqual(['big', 'mid', 'small']);
    expect(r.inject.map((c) => c.priority)).toEqual([1, 2, 3]);
    expect(r.inject.every((c) => c.kind === 'remediation_review')).toBe(true);
  });

  it('null dropMagnitude sorts after any known magnitude', () => {
    const r = planRemediationInjection(
      baseInput({
        candidates: [
          cand({ chapterNumber: 1, interventionId: 'unknown-mag', dropMagnitude: null }),
          cand({ chapterNumber: 2, interventionId: 'known', dropMagnitude: 0.16 }),
        ],
      }),
    );
    expect(r.inject.map((c) => c.interventionId)).toEqual(['known', 'unknown-mag']);
  });

  it('breaks magnitude ties by subjectCode asc then chapterNumber asc', () => {
    const r = planRemediationInjection(
      baseInput({
        candidates: [
          cand({ subjectCode: 'science', chapterNumber: 1, interventionId: 'c', dropMagnitude: 0.3 }),
          cand({ subjectCode: 'math', chapterNumber: 7, interventionId: 'b', dropMagnitude: 0.3 }),
          cand({ subjectCode: 'math', chapterNumber: 2, interventionId: 'a', dropMagnitude: 0.3 }),
        ],
      }),
    );
    expect(r.inject.map((c) => c.interventionId)).toEqual(['a', 'b', 'c']);
  });

  it('dedupes candidates on (subject, chapter), keeping the deepest drop', () => {
    const r = planRemediationInjection(
      baseInput({
        candidates: [
          cand({ chapterNumber: 4, interventionId: 'shallow', dropMagnitude: 0.16 }),
          cand({ chapterNumber: 4, interventionId: 'deep', dropMagnitude: 0.4 }),
        ],
      }),
    );
    expect(r.inject).toHaveLength(1);
    expect(r.inject[0].interventionId).toBe('deep');
    expect(r.inject[0].priority).toBe(1);
  });
});

describe('planRemediationInjection — partial injection deferral semantics', () => {
  it('active-blocked sibling does not defer when another candidate injects', () => {
    const r = planRemediationInjection(
      baseInput({
        candidates: [
          cand({ chapterNumber: 4, interventionId: 'blocked', dropMagnitude: 0.5 }),
          cand({ chapterNumber: 5, interventionId: 'free', dropMagnitude: 0.2 }),
        ],
        activeInterventions: [{ subjectCode: 'math', chapterNumber: 4 }],
      }),
    );
    expect(r.inject.map((c) => c.interventionId)).toEqual(['free']);
    expect(r.inject[0].priority).toBe(1); // priority ranks injected cards only
    expect(r.deferred).toBe(false);
    expect(r.reason).toBe('ok');
  });

  it('cooldown-blocked sibling defers even when another candidate injects', () => {
    const r = planRemediationInjection(
      baseInput({
        candidates: [
          cand({ chapterNumber: 4, interventionId: 'cooling', dropMagnitude: 0.5 }),
          cand({ chapterNumber: 5, interventionId: 'free', dropMagnitude: 0.2 }),
        ],
        recentTerminalInterventions: [
          { subjectCode: 'math', chapterNumber: 4, terminalAtMs: NOW - 1 },
        ],
      }),
    );
    expect(r.inject.map((c) => c.interventionId)).toEqual(['free']);
    expect(r.deferred).toBe(true);
    expect(r.reason).toBe('ok');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// compareBySeverity — exported comparator (Round 2, assessment cond 4)
// ════════════════════════════════════════════════════════════════════════════
//
// The comparator is now EXPORTED so /api/rhythm/today's lane builder reuses
// it instead of duplicating the ordering. These pins guarantee the export is
// a pure re-export of the planner's internal ordering — no behavior change.

describe('compareBySeverity — exported severity comparator', () => {
  it('ranks deepest known drop first', () => {
    const shallow = { subjectCode: 'math', chapterNumber: 1, dropMagnitude: 0.2 };
    const deep = { subjectCode: 'science', chapterNumber: 9, dropMagnitude: 0.5 };
    expect(compareBySeverity(deep, shallow)).toBeLessThan(0);
    expect(compareBySeverity(shallow, deep)).toBeGreaterThan(0);
  });

  it('ranks null / non-finite magnitudes after ANY known magnitude', () => {
    const known = { subjectCode: 'science', chapterNumber: 9, dropMagnitude: 0.01 };
    const unknown = { subjectCode: 'math', chapterNumber: 1, dropMagnitude: null };
    const nan = { subjectCode: 'math', chapterNumber: 1, dropMagnitude: Number.NaN };
    expect(compareBySeverity(known, unknown)).toBeLessThan(0);
    expect(compareBySeverity(unknown, known)).toBeGreaterThan(0);
    expect(compareBySeverity(known, nan)).toBeLessThan(0);
  });

  it('tie-breaks equal magnitudes by subjectCode asc, then chapterNumber asc (deterministic)', () => {
    const a = { subjectCode: 'math', chapterNumber: 2, dropMagnitude: 0.3 };
    const b = { subjectCode: 'science', chapterNumber: 1, dropMagnitude: 0.3 };
    expect(compareBySeverity(a, b)).toBeLessThan(0); // 'math' < 'science'

    const c1 = { subjectCode: 'math', chapterNumber: 1, dropMagnitude: 0.3 };
    const c2 = { subjectCode: 'math', chapterNumber: 5, dropMagnitude: 0.3 };
    expect(compareBySeverity(c1, c2)).toBeLessThan(0);
    expect(compareBySeverity(c1, c1)).toBe(0);
  });

  it('both-null magnitudes fall through to the deterministic tie-breaks (no NaN ordering)', () => {
    const a = { subjectCode: 'math', chapterNumber: 1, dropMagnitude: null };
    const b = { subjectCode: 'science', chapterNumber: 1, dropMagnitude: null };
    expect(compareBySeverity(a, b)).toBeLessThan(0);
    expect(compareBySeverity(b, a)).toBeGreaterThan(0);
  });

  it('agrees with planRemediationInjection ordering (single source of truth)', () => {
    const candidates = [
      cand({ subjectCode: 'science', chapterNumber: 2, interventionId: 'c-mid', dropMagnitude: 0.3 }),
      cand({ subjectCode: 'math', chapterNumber: 9, interventionId: 'c-null', dropMagnitude: null }),
      cand({ subjectCode: 'math', chapterNumber: 4, interventionId: 'c-deep', dropMagnitude: 0.5 }),
      cand({ subjectCode: 'math', chapterNumber: 1, interventionId: 'c-tie', dropMagnitude: 0.3 }),
    ];
    const expectedOrder = [...candidates]
      .sort(compareBySeverity)
      .map((c) => c.interventionId)
      .slice(0, 3); // capacity = min(3, 10 - 7)
    const plan = planRemediationInjection(baseInput({ candidates }));
    expect(plan.inject.map((c) => c.interventionId)).toEqual(expectedOrder);
    expect(expectedOrder).toEqual(['c-deep', 'c-tie', 'c-mid']);
  });
});
