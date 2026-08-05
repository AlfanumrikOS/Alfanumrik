import { describe, it, expect } from 'vitest';
import {
  CASEL_COMPETENCIES,
  CASEL_BEHAVIOR_RULES,
  selectCaselMoment,
  type CaselSignals,
  type CaselCompetency,
} from '../../companion';

// ─── Structural checks ─────────────────────────────────────────

describe('CASEL_BEHAVIOR_RULES', () => {
  it('covers all 5 CASEL competencies verbatim', () => {
    expect(CASEL_COMPETENCIES).toEqual([
      'self_awareness',
      'self_management',
      'social_awareness',
      'relationship_skills',
      'responsible_decision_making',
    ]);
    for (const c of CASEL_COMPETENCIES) {
      expect(CASEL_BEHAVIOR_RULES[c]).toBeDefined();
    }
  });

  it('every rule ships at least one trigger, behavior, and bilingual prompt', () => {
    for (const c of CASEL_COMPETENCIES) {
      const rule = CASEL_BEHAVIOR_RULES[c];
      expect(rule.triggers.length).toBeGreaterThan(0);
      expect(rule.foxyBehaviors.length).toBeGreaterThan(0);
      expect(rule.reflectionPrompts.length).toBeGreaterThan(0);
      for (const p of rule.reflectionPrompts) {
        expect(typeof p.en).toBe('string');
        expect(typeof p.hi).toBe('string');
        expect(p.en.length).toBeGreaterThan(0);
        expect(p.hi.length).toBeGreaterThan(0);
        // Hindi prompts must contain at least one Devanagari codepoint.
        expect(/[ऀ-ॿ]/.test(p.hi)).toBe(true);
      }
    }
  });
});

// ─── Fail-safe behavior ─────────────────────────────────────────

describe('selectCaselMoment — fail-safe', () => {
  it('returns null on empty signals', () => {
    expect(selectCaselMoment({})).toBeNull();
  });

  it('returns null on null/undefined signals', () => {
    expect(selectCaselMoment(null)).toBeNull();
    expect(selectCaselMoment(undefined)).toBeNull();
  });

  it('returns null when NaN slips into numeric signals', () => {
    expect(
      selectCaselMoment({ consecutiveErrors: Number.NaN, consecutiveCorrect: Number.NaN }),
    ).toBeNull();
  });

  it('respects the per-session rate-limit flag even when a rule would otherwise fire', () => {
    const wouldFire: CaselSignals = { sessionLengthMinutes: 60, caselMomentAlreadyShown: true };
    expect(selectCaselMoment(wouldFire)).toBeNull();
  });
});

// ─── Rule coverage: each of the 5 competencies fires at least once ──

describe('selectCaselMoment — per-competency firing', () => {
  it('self_awareness fires on the 2nd consecutive error', () => {
    const m = selectCaselMoment({ consecutiveErrors: 2 });
    expect(m?.competency).toBe('self_awareness');
    expect(m?.prompt.en.length).toBeGreaterThan(0);
    expect(m?.prompt.hi.length).toBeGreaterThan(0);
  });

  it('self_management fires on long unbroken session', () => {
    const m = selectCaselMoment({ sessionLengthMinutes: 45 });
    expect(m?.competency).toBe('self_management');
  });

  it('social_awareness fires at evaluate/create Bloom levels', () => {
    const m = selectCaselMoment({ bloomLevel: 'evaluate' });
    expect(m?.competency).toBe('social_awareness');
  });

  it('relationship_skills fires on a strong daily streak', () => {
    // Use a signal profile that only relationship_skills matches (avoids
    // the higher-priority self_management/responsible_decision_making
    // triggers that fire at very long correct-streak lengths).
    const m = selectCaselMoment({ consecutiveCorrect: 5 });
    expect(m?.competency).toBe('relationship_skills');
  });

  it('responsible_decision_making fires after 4 consecutive errors', () => {
    const m = selectCaselMoment({ consecutiveErrors: 4 });
    expect(m?.competency).toBe('responsible_decision_making');
  });
});

// ─── Rate limit + priority ──────────────────────────────────────

describe('selectCaselMoment — at-most-one-per-session', () => {
  it('a caller that surfaces one moment and re-checks with the flag set gets null', () => {
    const base: CaselSignals = { sessionLengthMinutes: 60, consecutiveErrors: 4 };
    const first = selectCaselMoment(base);
    expect(first).not.toBeNull();
    const second = selectCaselMoment({ ...base, caselMomentAlreadyShown: true });
    expect(second).toBeNull();
  });

  it('deterministic priority: self_management outranks responsible_decision_making when both fire', () => {
    // sessionLengthMinutes>=40 fires self_management; consecutiveErrors>=4
    // fires responsible_decision_making. Priority order surfaces
    // self_management first.
    const m = selectCaselMoment({ sessionLengthMinutes: 45, consecutiveErrors: 6 });
    expect(m?.competency).toBe('self_management');
  });
});

// ─── Bilingual prompt structure ────────────────────────────────

describe('selectCaselMoment — output shape', () => {
  it('returns { competency, behavior, prompt: {en, hi} } for any firing signal', () => {
    const m = selectCaselMoment({ consecutiveErrors: 4 });
    expect(m).toMatchObject({
      competency: expect.any(String) as unknown as CaselCompetency,
      behavior: expect.any(String),
      prompt: {
        en: expect.any(String),
        hi: expect.any(String),
      },
    });
  });
});
