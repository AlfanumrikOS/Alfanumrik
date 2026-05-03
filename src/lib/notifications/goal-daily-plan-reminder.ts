/**
 * Goal-Aware Daily Plan Reminder Builder (Phase 5 of Goal-Adaptive Layers)
 *
 * Pure function module - no IO, no React, no Supabase. Given a student
 * with an academic_goal + the resolved goal profile, produces the
 * notifications-table payload for a daily plan reminder.
 *
 * Owner: backend (notification logic) + frontend (display) +
 *        assessment (goal-tone + bilingual copy)
 * Reviewers: ops (notification delivery surface), testing
 *
 * Founder constraint: ships dormant. No code path inserts these
 * notifications until the cron route at /api/cron/goal-daily-plan-reminder
 * is invoked AND the ff_goal_daily_plan_reminder feature flag is enabled.
 *
 * P-invariants:
 *   - P7 bilingual: returns en + hi notification body separately so the
 *     consumer (notifications page / email template) renders the
 *     student's preferred language.
 *   - P13 data privacy: builder receives only studentId + goal code +
 *     totalMinutes; never receives email/phone/name.
 */

import {
  GOAL_PROFILES,
  isKnownGoalCode,
  type GoalCode,
} from '@/lib/goals/goal-profile';
import { buildDailyPlanByCode, type DailyPlan } from '@/lib/goals/daily-plan';

export interface DailyPlanReminderInput {
  studentId: string;
  goalCode: string | null | undefined;
  /** Optional override for the daily plan; when omitted, builder calls buildDailyPlanByCode. */
  plan?: DailyPlan;
  /** ISO timestamp for the reminder; defaults to now. Useful for tests. */
  now?: () => Date;
}

export interface ReminderPayload {
  recipient_id: string;
  recipient_type: 'student';
  type: 'daily_plan_reminder';
  notification_type: 'daily_plan_reminder';
  delivery_channel: 'in_app';
  title: string;
  message: string;
  body: string;
  data: {
    goal_code: GoalCode;
    total_minutes: number;
    item_count: number;
    item_kinds: string[];
    title_hi: string;
    message_hi: string;
    body_hi: string;
    plan_generated_at: string;
  };
  is_read: false;
  created_at: string;
}

/**
 * Build a daily plan reminder notification payload for a student.
 *
 * Returns null when:
 *  - studentId is empty/invalid
 *  - goalCode is null/empty/unknown (no goal => no reminder)
 *  - The resolved plan has zero items (defensive)
 *
 * The caller (cron route) treats null as "skip this student".
 */
export function buildDailyPlanReminderPayload(
  input: DailyPlanReminderInput,
): ReminderPayload | null {
  if (!input.studentId || typeof input.studentId !== 'string') return null;
  if (!isKnownGoalCode(input.goalCode)) return null;

  const goal = input.goalCode as GoalCode;
  const profile = GOAL_PROFILES[goal];
  const plan = input.plan ?? buildDailyPlanByCode(goal, { now: input.now });

  if (!plan || plan.items.length === 0) return null;

  const nowIso = (input.now ?? (() => new Date()))().toISOString();

  // Title: short bilingual hook + minutes
  const titleEn = "Today's plan is ready (" + plan.totalMinutes + " min)";
  const titleHi = 'आज की योजना तैयार है (' + plan.totalMinutes + ' मिनट)';

  // Body: per-goal one-liner that nudges towards the highest-impact item
  const bodyEn = buildBodyEn(profile.code, plan);
  const bodyHi = buildBodyHi(profile.code, plan);

  // Message vs body: notifications table has both - mirror existing pattern
  // (parent_digest also stores the same text in both fields).
  return {
    recipient_id: input.studentId,
    recipient_type: 'student',
    type: 'daily_plan_reminder',
    notification_type: 'daily_plan_reminder',
    delivery_channel: 'in_app',
    title: titleEn,
    message: bodyEn,
    body: bodyEn,
    data: {
      goal_code: goal,
      total_minutes: plan.totalMinutes,
      item_count: plan.items.length,
      item_kinds: plan.items.map((it) => it.kind),
      title_hi: titleHi,
      message_hi: bodyHi,
      body_hi: bodyHi,
      plan_generated_at: plan.generatedAt,
    },
    is_read: false,
    created_at: nowIso,
  };
}

function buildBodyEn(goal: GoalCode, plan: DailyPlan): string {
  const first = plan.items[0];
  const totalMin = plan.totalMinutes;
  switch (goal) {
    case 'improve_basics':
      return totalMin + ' min today: start with ' + first.titleEn + '. One step at a time.';
    case 'pass_comfortably':
      return totalMin + ' min today on your high-frequency board topics. Open with ' + first.titleEn + '.';
    case 'school_topper':
      return totalMin + ' min today. Today: ' + first.titleEn + '. Aim for that 90 percent.';
    case 'board_topper':
      return 'Board-prep ' + totalMin + ' min today. Top of the list: ' + first.titleEn + '.';
    case 'competitive_exam':
      return 'JEE/NEET ' + totalMin + ' min today. Start with ' + first.titleEn + ' - watch your pace.';
    case 'olympiad':
      return 'Olympiad ' + totalMin + ' min today. Today: ' + first.titleEn + '. Take your time.';
    default:
      return totalMin + ' minutes today. ' + first.titleEn + '.';
  }
}

function buildBodyHi(goal: GoalCode, plan: DailyPlan): string {
  const first = plan.items[0];
  const totalMin = plan.totalMinutes;
  switch (goal) {
    case 'improve_basics':
      return totalMin + ' मिनट आज: शुरुआत करो ' + first.titleHi + ' से। एक-एक कदम।';
    case 'pass_comfortably':
      return totalMin + ' मिनट आज बोर्ड के मुख्य विषयों पर। शुरू करो ' + first.titleHi + ' से।';
    case 'school_topper':
      return totalMin + ' मिनट आज। आज का: ' + first.titleHi + '। 90 प्रतिशत का लक्ष्य।';
    case 'board_topper':
      return 'बोर्ड तैयारी ' + totalMin + ' मिनट आज। पहला: ' + first.titleHi + '।';
    case 'competitive_exam':
      return 'JEE/NEET ' + totalMin + ' मिनट आज। शुरू करो ' + first.titleHi + ' से - गति पर ध्यान दो।';
    case 'olympiad':
      return 'ओलंपियाड ' + totalMin + ' मिनट आज। आज का: ' + first.titleHi + '। समय लो।';
    default:
      return totalMin + ' मिनट आज। ' + first.titleHi + '।';
  }
}
