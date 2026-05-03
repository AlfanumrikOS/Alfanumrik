/**
 * Tests for src/lib/notifications/goal-daily-plan-reminder.ts (Phase 5).
 * Pins the per-goal bilingual payload contract + null-handling.
 */
import { describe, it, expect } from 'vitest';
import { buildDailyPlanReminderPayload } from '@/lib/notifications/goal-daily-plan-reminder';
import type { GoalCode } from '@/lib/goals/goal-profile';

const ALL_GOALS: GoalCode[] = [
  'improve_basics', 'pass_comfortably', 'school_topper',
  'board_topper', 'competitive_exam', 'olympiad',
];

const STUDENT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('buildDailyPlanReminderPayload: null/empty handling', () => {
  it('returns null when studentId is missing', () => {
    expect(buildDailyPlanReminderPayload({
      studentId: '',
      goalCode: 'board_topper',
    })).toBeNull();
  });

  it('returns null when goal is null', () => {
    expect(buildDailyPlanReminderPayload({
      studentId: STUDENT_ID,
      goalCode: null,
    })).toBeNull();
  });

  it('returns null when goal is empty string', () => {
    expect(buildDailyPlanReminderPayload({
      studentId: STUDENT_ID,
      goalCode: '',
    })).toBeNull();
  });

  it('returns null when goal is unknown', () => {
    expect(buildDailyPlanReminderPayload({
      studentId: STUDENT_ID,
      goalCode: 'not_a_real_goal',
    })).toBeNull();
  });
});

describe('buildDailyPlanReminderPayload: per-goal payloads', () => {
  it.each(ALL_GOALS)('builds payload for %s', (goal) => {
    const p = buildDailyPlanReminderPayload({
      studentId: STUDENT_ID,
      goalCode: goal,
    });
    expect(p).not.toBeNull();
    expect(p!.recipient_id).toBe(STUDENT_ID);
    expect(p!.recipient_type).toBe('student');
    expect(p!.type).toBe('daily_plan_reminder');
    expect(p!.notification_type).toBe('daily_plan_reminder');
    expect(p!.delivery_channel).toBe('in_app');
    expect(p!.is_read).toBe(false);
    expect(p!.data.goal_code).toBe(goal);
    expect(p!.data.total_minutes).toBeGreaterThan(0);
    expect(p!.data.item_count).toBeGreaterThan(0);
    expect(Array.isArray(p!.data.item_kinds)).toBe(true);
    expect(p!.data.item_kinds.length).toBe(p!.data.item_count);
  });

  it('board_topper title contains 45 minutes', () => {
    const p = buildDailyPlanReminderPayload({
      studentId: STUDENT_ID,
      goalCode: 'board_topper',
    });
    expect(p!.title).toContain('45');
    expect(p!.data.title_hi).toContain('45');
  });

  it('improve_basics title contains 10 minutes', () => {
    const p = buildDailyPlanReminderPayload({
      studentId: STUDENT_ID,
      goalCode: 'improve_basics',
    });
    expect(p!.title).toContain('10');
  });
});

describe('buildDailyPlanReminderPayload: P7 bilingual contract', () => {
  it.each(ALL_GOALS)('%s: title and body have non-empty hi counterparts', (goal) => {
    const p = buildDailyPlanReminderPayload({
      studentId: STUDENT_ID,
      goalCode: goal,
    });
    expect(p!.title.length).toBeGreaterThan(0);
    expect(p!.body.length).toBeGreaterThan(0);
    expect(p!.data.title_hi.length).toBeGreaterThan(0);
    expect(p!.data.body_hi.length).toBeGreaterThan(0);
    expect(p!.data.message_hi.length).toBeGreaterThan(0);
  });

  it.each(ALL_GOALS)('%s: hi body uses Devanagari script', (goal) => {
    const p = buildDailyPlanReminderPayload({
      studentId: STUDENT_ID,
      goalCode: goal,
    });
    expect(p!.data.body_hi).toMatch(/[ऀ-ॿ]/);
  });

  it.each(ALL_GOALS)('%s: en body and hi body differ', (goal) => {
    const p = buildDailyPlanReminderPayload({
      studentId: STUDENT_ID,
      goalCode: goal,
    });
    expect(p!.body).not.toBe(p!.data.body_hi);
  });
});

describe('buildDailyPlanReminderPayload: clock injection', () => {
  it('honors opts.now for created_at and plan_generated_at', () => {
    const fixed = new Date('2026-05-04T08:30:00.000Z');
    const p = buildDailyPlanReminderPayload({
      studentId: STUDENT_ID,
      goalCode: 'board_topper',
      now: () => fixed,
    });
    expect(p!.created_at).toBe('2026-05-04T08:30:00.000Z');
    expect(p!.data.plan_generated_at).toBe('2026-05-04T08:30:00.000Z');
  });
});

describe('buildDailyPlanReminderPayload: P13 data privacy', () => {
  it('payload contains no email/phone/name fields', () => {
    const p = buildDailyPlanReminderPayload({
      studentId: STUDENT_ID,
      goalCode: 'olympiad',
    });
    const json = JSON.stringify(p);
    expect(json).not.toMatch(/email/i);
    expect(json).not.toMatch(/phone/i);
    expect(json).not.toMatch(/parent_name|student_name/);
  });
});
