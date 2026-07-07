import { describe, it, expect } from 'vitest';
import {
  planWeeklyDive,
  isoWeekOf,
  type WeeklyDiveContext,
} from '../learn/weekly-dive-orchestrator';
import type { GoalCode } from '../goals/goal-profile';

const baseCtx = (over: Partial<WeeklyDiveContext> = {}): WeeklyDiveContext => ({
  persona: 'school_topper',
  studentGrade: '9',
  nowIso: '2026-05-09T08:00:00.000Z', // Saturday — ISO 2026-W19
  lastCompletedIsoWeek: null,
  weakTopicCount: 3,
  eligiblePhenomenaCount: 5,
  ...over,
});

describe('isoWeekOf', () => {
  it('returns YYYY-Www format for a known date', () => {
    // 2026-05-09 is Saturday in ISO week 19 of 2026.
    expect(isoWeekOf(new Date('2026-05-09T08:00:00Z'))).toBe('2026-W19');
  });

  it('correctly rolls over at the year boundary (2026-01-01 is Thursday, ISO 2026-W01)', () => {
    expect(isoWeekOf(new Date('2026-01-01T12:00:00Z'))).toBe('2026-W01');
  });

  it('zero-pads single-digit weeks', () => {
    // 2026-01-05 is Monday, ISO 2026-W02.
    expect(isoWeekOf(new Date('2026-01-05T12:00:00Z'))).toBe('2026-W02');
  });

  it('treats the last days of December as week 53 of the same year when applicable (2026-12-31 is Thursday → 2026-W53)', () => {
    // 2026 has 53 ISO weeks because Jan 1 is Thursday (rule: years where Jan 1 is Thu, or leap years where Jan 1 is Wed, have 53 weeks).
    expect(isoWeekOf(new Date('2026-12-31T12:00:00Z'))).toBe('2026-W53');
  });
});

describe('planWeeklyDive — state', () => {
  it('returns "open" when last_completed_iso_week is null', () => {
    const plan = planWeeklyDive(baseCtx({ lastCompletedIsoWeek: null }));
    expect(plan.state).toBe('open');
  });

  it('returns "completed" when last_completed_iso_week equals the current ISO week', () => {
    const plan = planWeeklyDive(baseCtx({ lastCompletedIsoWeek: '2026-W19' }));
    expect(plan.state).toBe('completed');
  });

  it('returns "open" when last_completed_iso_week is an older week', () => {
    const plan = planWeeklyDive(baseCtx({ lastCompletedIsoWeek: '2026-W18' }));
    expect(plan.state).toBe('open');
  });
});

describe('planWeeklyDive — persona-driven default picker', () => {
  const cases: Array<{ persona: GoalCode; expected: 'phenomenon' | 'weak_topic' | 'own_topic' }> = [
    { persona: 'improve_basics',     expected: 'weak_topic' },
    { persona: 'pass_comfortably',   expected: 'weak_topic' },
    { persona: 'school_topper',      expected: 'phenomenon' },
    { persona: 'board_topper',       expected: 'weak_topic' },
    { persona: 'competitive_exam',   expected: 'own_topic' },
    { persona: 'olympiad',           expected: 'own_topic' },
  ];

  for (const c of cases) {
    it(`${c.persona} defaults picker to ${c.expected}`, () => {
      const plan = planWeeklyDive(baseCtx({ persona: c.persona }));
      expect(plan.defaultPicker).toBe(c.expected);
    });
  }

  it('null persona falls back to phenomenon (safe median curiosity)', () => {
    const plan = planWeeklyDive(baseCtx({ persona: null }));
    expect(plan.defaultPicker).toBe('phenomenon');
  });

  it('unknown persona string falls back to phenomenon', () => {
    const plan = planWeeklyDive(baseCtx({ persona: 'not_a_persona' as unknown as GoalCode }));
    expect(plan.defaultPicker).toBe('phenomenon');
  });
});

describe('planWeeklyDive — option visibility', () => {
  it('hides weak-topic option when weakTopicCount is 0', () => {
    const plan = planWeeklyDive(baseCtx({ weakTopicCount: 0 }));
    expect(plan.showWeakTopicOption).toBe(false);
  });

  it('hides phenomenon option when eligiblePhenomenaCount is 0', () => {
    const plan = planWeeklyDive(baseCtx({ eligiblePhenomenaCount: 0 }));
    expect(plan.showPhenomenonOption).toBe(false);
  });

  it('always shows own-topic option', () => {
    const plan = planWeeklyDive(baseCtx({ weakTopicCount: 0, eligiblePhenomenaCount: 0 }));
    expect(plan.showOwnTopicOption).toBe(true);
  });

  it('downgrades default picker to a visible option when the persona-default is hidden', () => {
    // school_topper default is phenomenon; if no phenomena are eligible,
    // the orchestrator must fall through to the next visible option.
    const plan = planWeeklyDive(baseCtx({
      persona: 'school_topper',
      eligiblePhenomenaCount: 0,
      weakTopicCount: 2,
    }));
    expect(plan.defaultPicker).not.toBe('phenomenon');
    expect(plan.defaultPicker === 'weak_topic' || plan.defaultPicker === 'own_topic').toBe(true);
  });

  it('falls through to own_topic when both phenomenon and weak_topic are hidden', () => {
    const plan = planWeeklyDive(baseCtx({
      persona: 'school_topper',
      eligiblePhenomenaCount: 0,
      weakTopicCount: 0,
    }));
    expect(plan.defaultPicker).toBe('own_topic');
  });
});
