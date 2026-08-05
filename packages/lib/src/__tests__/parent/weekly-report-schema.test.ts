/**
 * Unit tests for the K8 weekly-report zod schema — pins the parent renderer's
 * contract against the EF response shape.
 */
import { describe, expect, it } from 'vitest';
import {
  WeeklyReportSchema,
  parseWeeklyReport,
} from '../../parent/weekly-report-schema';

const validStats = {
  quizzes_completed: 5,
  avg_score: 82,
  xp_earned: 120,
  time_spent_minutes: 45,
  topics_mastered: 2,
  streak: 3,
};

describe('WeeklyReportSchema', () => {
  it('accepts a legacy report without conversation_prompts', () => {
    const legacy = {
      period: 'Aug 1 – Aug 7',
      highlights: ['Great streak', 'New topic mastered'],
      concerns: [],
      suggestion: 'Keep going',
      stats: validStats,
    };
    const parsed = WeeklyReportSchema.safeParse(legacy);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.conversation_prompts).toBeUndefined();
    }
  });

  it('accepts 0..3 conversation_prompts', () => {
    for (const prompts of [
      [],
      ['One'],
      ['One', 'Two'],
      ['One', 'Two', 'Three'],
    ]) {
      const r = WeeklyReportSchema.safeParse({
        period: 'w', highlights: [], concerns: [], suggestion: 's', stats: validStats,
        conversation_prompts: prompts,
      });
      expect(r.success).toBe(true);
    }
  });

  it('rejects more than 3 conversation_prompts', () => {
    const r = WeeklyReportSchema.safeParse({
      period: 'w', highlights: [], concerns: [], suggestion: 's', stats: validStats,
      conversation_prompts: ['a', 'b', 'c', 'd'],
    });
    expect(r.success).toBe(false);
  });

  it('rejects non-string entries in conversation_prompts', () => {
    const r = WeeklyReportSchema.safeParse({
      period: 'w', highlights: [], concerns: [], suggestion: 's', stats: validStats,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      conversation_prompts: [42] as any,
    });
    expect(r.success).toBe(false);
  });
});

describe('parseWeeklyReport', () => {
  it('returns null on unrecoverable shape', () => {
    expect(parseWeeklyReport({ garbage: true })).toBeNull();
  });

  it('returns the parsed report on valid input', () => {
    const out = parseWeeklyReport({
      period: 'w', highlights: [], concerns: [], suggestion: 's', stats: validStats,
      conversation_prompts: ['ask?'],
    });
    expect(out?.conversation_prompts).toEqual(['ask?']);
  });
});
