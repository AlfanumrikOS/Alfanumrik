/**
 * Pedagogy v2 — Phase 3 (Wave 1C): real-ability ZPD targeting.
 *
 * Lane: NORMAL (pure orchestrator unit test — no DB, no network, no React).
 *
 * These tests drive the PURE daily-rhythm orchestrator
 * (src/lib/learn/daily-rhythm-orchestrator.ts) directly through its exported
 * `composeDailyRhythm` API. They pin the Phase-3 behavioural contract that the
 * route now feeds the orchestrator REAL signal:
 *
 *   - studentAbility = student's irt_theta (logit scale; sigmoid → 0..1 target)
 *   - each CandidateProblem.difficulty already mapped onto the SAME 0..1 axis
 *
 * pickZpdItem (orchestrator line ~158) computes
 *   targetDifficulty = 1 / (1 + e^-studentAbility)
 * and selects the candidate whose 0..1 difficulty is CLOSEST to that target.
 *
 * Assertions:
 *   (a) MONOTONIC — a high-ability student (+1.5) is matched to a HARDER ZPD
 *       item than a low-ability student (-1.5), given the same easy→hard pool.
 *   (b) NEUTRAL — ability = 0 → target 0.5 (the prior hardcoded behaviour),
 *       so the candidate nearest 0.5 is picked.
 *   (c) SHAPE — the queue is ALWAYS 5 SRS + 1 ZPD + 1 reflection (7 items),
 *       regardless of ability / difficulty distribution, including the
 *       all-difficulty-missing pool and the empty due-cards case.
 *   (d) EMPTY POOL — an empty candidate pool yields the `__no_pool__` ZPD
 *       sentinel and NEVER throws; the queue shape is still 7.
 *
 * Persona choice: `school_topper`. Its ZPD problemFlavor is `intuition_led`,
 * whose flavor filter passes any candidate that is NOT board/jee/olympiad. By
 * leaving every candidate's flags false, the WHOLE easy→hard pool survives the
 * flavor filter, so difficulty proximity is the ONLY thing that decides the
 * pick — exactly the signal under test. (If we used pass_comfortably, the
 * board_pattern flavor filter would prune the pool and confound the test.)
 */

import { describe, it, expect } from 'vitest';
import {
  composeDailyRhythm,
  type DailyRhythmInput,
  type CandidateProblem,
  type DueSm2Card,
  type RhythmItem,
} from '@/lib/learn/daily-rhythm-orchestrator';

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** A candidate whose flags are all false so the intuition_led flavor filter
 *  (used by school_topper) passes it through — leaving difficulty as the only
 *  selection signal. */
function candidate(questionId: string, difficulty: number): CandidateProblem {
  return {
    questionId,
    difficulty,
    bloomLevel: 'understand',
    topicId: '',
    isAheadOfGrade: false,
    isBoardPattern: false,
    isOlympiad: false,
    isJeeNeet: false,
  };
}

/** An easy→hard candidate pool spanning the full 0..1 difficulty axis. */
function easyToHardPool(): CandidateProblem[] {
  return [
    candidate('q_easy', 0.1),
    candidate('q_lowmid', 0.3),
    candidate('q_mid', 0.5),
    candidate('q_highmid', 0.7),
    candidate('q_hard', 0.9),
  ];
}

function dueCards(n: number): DueSm2Card[] {
  return Array.from({ length: n }, (_, i) => ({
    questionId: `due_${i}`,
    topicId: `topic_${i}`,
    isAheadOfGrade: false,
  }));
}

function baseInput(overrides: Partial<DailyRhythmInput>): DailyRhythmInput {
  return {
    persona: 'school_topper',
    studentAbility: 0,
    dueSm2Cards: dueCards(5),
    candidateProblemPool: easyToHardPool(),
    reflectionPromptIndex: 0,
    ...overrides,
  };
}

function zpdItem(items: RhythmItem[]): Extract<RhythmItem, { kind: 'zpd_problem' }> {
  const zpd = items.find((i) => i.kind === 'zpd_problem');
  if (!zpd || zpd.kind !== 'zpd_problem') {
    throw new Error('no zpd_problem item in queue');
  }
  return zpd;
}

/** Difficulty of the candidate the orchestrator picked (looked up by id). */
function pickedDifficulty(items: RhythmItem[], pool: CandidateProblem[]): number {
  const picked = zpdItem(items);
  const match = pool.find((c) => c.questionId === picked.questionId);
  if (!match) throw new Error(`picked ${picked.questionId} not in pool`);
  return match.difficulty;
}

// ─── (a) Monotonic: higher ability → harder ZPD item ─────────────────────────

describe('Phase 3 ZPD targeting — ability drives difficulty (monotonic)', () => {
  it('high ability (+1.5) selects a HARDER ZPD item than low ability (-1.5)', () => {
    const pool = easyToHardPool();

    const lowAbility = composeDailyRhythm(
      baseInput({ studentAbility: -1.5, candidateProblemPool: pool }),
    );
    const highAbility = composeDailyRhythm(
      baseInput({ studentAbility: 1.5, candidateProblemPool: pool }),
    );

    const lowDiff = pickedDifficulty(lowAbility.items, pool);
    const highDiff = pickedDifficulty(highAbility.items, pool);

    // The core directional invariant: ZPD difficulty rises with ability.
    expect(highDiff).toBeGreaterThan(lowDiff);

    // Concretely: sigmoid(-1.5) ≈ 0.18 → nearest is q_easy (0.1);
    //             sigmoid(+1.5) ≈ 0.82 → nearest is q_hard (0.9).
    expect(zpdItem(lowAbility.items).questionId).toBe('q_easy');
    expect(zpdItem(highAbility.items).questionId).toBe('q_hard');
  });

  it('is monotonic across an ability sweep (never picks an easier item for higher ability)', () => {
    const pool = easyToHardPool();
    const abilities = [-2.5, -1.5, -0.5, 0, 0.5, 1.5, 2.5];
    const picks = abilities.map((studentAbility) =>
      pickedDifficulty(
        composeDailyRhythm(baseInput({ studentAbility, candidateProblemPool: pool })).items,
        pool,
      ),
    );
    for (let i = 1; i < picks.length; i++) {
      expect(picks[i]).toBeGreaterThanOrEqual(picks[i - 1]);
    }
  });
});

// ─── (b) Neutral: ability 0 → target 0.5 (prior behaviour) ───────────────────

describe('Phase 3 ZPD targeting — ability 0 reproduces the neutral 0.5 target', () => {
  it('ability = 0 picks the candidate nearest 0.5', () => {
    const pool = easyToHardPool();
    const queue = composeDailyRhythm(
      baseInput({ studentAbility: 0, candidateProblemPool: pool }),
    );
    // sigmoid(0) = 0.5 exactly → q_mid (0.5) is the closest candidate.
    expect(zpdItem(queue.items).questionId).toBe('q_mid');
    expect(pickedDifficulty(queue.items, pool)).toBe(0.5);
  });

  it('ability 0 with an all-0.5 pool (prior placeholder) picks a 0.5 item', () => {
    // Mirrors the OLD route behaviour where every candidate defaulted to 0.5.
    const pool = [candidate('a', 0.5), candidate('b', 0.5), candidate('c', 0.5)];
    const queue = composeDailyRhythm(
      baseInput({ studentAbility: 0, candidateProblemPool: pool }),
    );
    expect(pickedDifficulty(queue.items, pool)).toBe(0.5);
  });
});

// ─── (c) Shape invariant: always 5 SRS + 1 ZPD + 1 reflection ────────────────

describe('Phase 3 ZPD targeting — queue shape is invariant to ability/difficulty', () => {
  function assertShape(items: RhythmItem[]): void {
    expect(items).toHaveLength(7);
    expect(items.filter((i) => i.kind === 'srs_review')).toHaveLength(5);
    expect(items.filter((i) => i.kind === 'zpd_problem')).toHaveLength(1);
    expect(items.filter((i) => i.kind === 'reflection')).toHaveLength(1);
    // Order contract: 5 SRS, then ZPD, then reflection.
    expect(items.slice(0, 5).every((i) => i.kind === 'srs_review')).toBe(true);
    expect(items[5].kind).toBe('zpd_problem');
    expect(items[6].kind).toBe('reflection');
  }

  it('holds at extreme low ability', () => {
    assertShape(composeDailyRhythm(baseInput({ studentAbility: -10 })).items);
  });

  it('holds at extreme high ability', () => {
    assertShape(composeDailyRhythm(baseInput({ studentAbility: 10 })).items);
  });

  it('holds when every candidate has the SAME difficulty (no signal)', () => {
    const pool = [candidate('a', 0.5), candidate('b', 0.5)];
    assertShape(
      composeDailyRhythm(baseInput({ studentAbility: 0.8, candidateProblemPool: pool })).items,
    );
  });

  it('holds when due cards are EMPTY (SRS slots pad to 5)', () => {
    const queue = composeDailyRhythm(baseInput({ dueSm2Cards: [] }));
    assertShape(queue.items);
    // The 5 SRS slots are all padding when there are no due cards.
    const srs = queue.items.filter((i) => i.kind === 'srs_review');
    expect(srs.every((i) => i.kind === 'srs_review' && i.isPadding)).toBe(true);
  });

  it('holds when due cards are FEWER than 5 (partial fill + padding)', () => {
    assertShape(composeDailyRhythm(baseInput({ dueSm2Cards: dueCards(2) })).items);
  });

  it('holds when difficulty is "all-missing"-style (every candidate at the 0.5 default)', () => {
    // The route maps any question with no difficulty signal to 0.5; simulate the
    // whole pool defaulting that way and confirm the queue is still well-formed.
    const pool = easyToHardPool().map((c) => candidate(c.questionId, 0.5));
    assertShape(
      composeDailyRhythm(baseInput({ studentAbility: -1.2, candidateProblemPool: pool })).items,
    );
  });
});

// ─── (d) Empty pool → __no_pool__ sentinel, no throw ─────────────────────────

describe('Phase 3 ZPD targeting — empty candidate pool degrades gracefully', () => {
  it('emits the __no_pool__ ZPD sentinel and does not throw', () => {
    let queue!: ReturnType<typeof composeDailyRhythm>;
    expect(() => {
      queue = composeDailyRhythm(baseInput({ candidateProblemPool: [] }));
    }).not.toThrow();

    expect(zpdItem(queue.items).questionId).toBe('__no_pool__');
    // Shape is still the full 7-item queue.
    expect(queue.items).toHaveLength(7);
    expect(queue.items[5].kind).toBe('zpd_problem');
  });

  it('empty pool sentinel is stable across abilities (still no throw, still 7 items)', () => {
    for (const studentAbility of [-3, 0, 3]) {
      const queue = composeDailyRhythm(
        baseInput({ studentAbility, candidateProblemPool: [] }),
      );
      expect(zpdItem(queue.items).questionId).toBe('__no_pool__');
      expect(queue.items).toHaveLength(7);
    }
  });
});
