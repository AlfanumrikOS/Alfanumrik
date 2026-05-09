import { describe, it, expect } from 'vitest';
import {
  resolvePedagogyRule,
  type RhythmLayer,
  type RhythmSlot,
} from '../learn/pedagogy-content-rules';
import type { GoalCode } from '../goals/goal-profile';

describe('resolvePedagogyRule — daily/zpd_problem slot', () => {
  it('improve_basics gets worked-example-first (productive failure inverted)', () => {
    const rule = resolvePedagogyRule('improve_basics', 'daily', 'zpd_problem');
    expect(rule.productiveFailure).toBe(false);
    expect(rule.workedExampleFirst).toBe(true);
    expect(rule.problemFlavor).toBe('prerequisite_repair');
  });

  it('pass_comfortably gets board-pattern productive failure', () => {
    const rule = resolvePedagogyRule('pass_comfortably', 'daily', 'zpd_problem');
    expect(rule.productiveFailure).toBe(true);
    expect(rule.workedExampleFirst).toBe(false);
    expect(rule.problemFlavor).toBe('board_pattern');
  });

  it('school_topper gets intuition-led productive failure', () => {
    const rule = resolvePedagogyRule('school_topper', 'daily', 'zpd_problem');
    expect(rule.productiveFailure).toBe(true);
    expect(rule.problemFlavor).toBe('intuition_led');
  });

  it('board_topper gets exam-rigorous productive failure', () => {
    const rule = resolvePedagogyRule('board_topper', 'daily', 'zpd_problem');
    expect(rule.productiveFailure).toBe(true);
    expect(rule.problemFlavor).toBe('board_pattern');
    expect(rule.depthCeiling).toBe('board_rigorous');
  });

  it('competitive_exam gets enrichment problems', () => {
    const rule = resolvePedagogyRule('competitive_exam', 'daily', 'zpd_problem');
    expect(rule.productiveFailure).toBe(true);
    expect(rule.problemFlavor).toBe('enrichment');
    expect(rule.depthCeiling).toBe('jee_neet');
  });

  it('olympiad gets puzzle-style problems', () => {
    const rule = resolvePedagogyRule('olympiad', 'daily', 'zpd_problem');
    expect(rule.productiveFailure).toBe(true);
    expect(rule.problemFlavor).toBe('puzzle');
    expect(rule.depthCeiling).toBe('olympiad');
  });
});

describe('resolvePedagogyRule — daily/srs_review slot', () => {
  it('all personas use SM-2 due-card pool; only sourceWeights vary', () => {
    const rules = (
      ['improve_basics', 'pass_comfortably', 'school_topper', 'board_topper', 'competitive_exam', 'olympiad'] as GoalCode[]
    ).map((p) => resolvePedagogyRule(p, 'daily', 'srs_review'));
    rules.forEach((r) => expect(r.useDueCardsPool).toBe(true));
    const basics = resolvePedagogyRule('improve_basics', 'daily', 'srs_review');
    expect(basics.allowAheadOfGrade).toBe(false);
    const comp = resolvePedagogyRule('competitive_exam', 'daily', 'srs_review');
    expect(comp.allowAheadOfGrade).toBe(true);
  });
});

describe('resolvePedagogyRule — daily/reflection slot', () => {
  it('all personas get a reflection prompt; XP for it is 0', () => {
    const rule = resolvePedagogyRule('school_topper', 'daily', 'reflection');
    expect(rule.xpAwarded).toBe(0);
    expect(rule.useReflectionPromptGenerator).toBe(true);
  });
});

describe('resolvePedagogyRule — totals and contracts', () => {
  it('returns no nulls for any (persona, layer, slot) tuple', () => {
    const personas: GoalCode[] = [
      'improve_basics', 'pass_comfortably', 'school_topper',
      'board_topper', 'competitive_exam', 'olympiad',
    ];
    const layers: RhythmLayer[] = ['daily'];
    const slots: RhythmSlot[] = ['srs_review', 'zpd_problem', 'reflection'];
    for (const p of personas) {
      for (const l of layers) {
        for (const s of slots) {
          const rule = resolvePedagogyRule(p, l, s);
          expect(rule).not.toBeNull();
          expect(rule.problemFlavor || rule.useDueCardsPool || rule.useReflectionPromptGenerator).toBeTruthy();
        }
      }
    }
  });

  it('falls back to pass_comfortably for unknown persona', () => {
    const rule = resolvePedagogyRule('not_a_persona', 'daily', 'zpd_problem');
    expect(rule.problemFlavor).toBe('board_pattern');
    expect(rule.productiveFailure).toBe(true);
  });

  it('falls back to pass_comfortably for null/undefined persona', () => {
    expect(resolvePedagogyRule(null, 'daily', 'zpd_problem').problemFlavor).toBe('board_pattern');
    expect(resolvePedagogyRule(undefined, 'daily', 'zpd_problem').problemFlavor).toBe('board_pattern');
  });
});
