/**
 * Alfanumrik — Pedagogy v2 / Wave 2
 * Weekly Dive Orchestrator.
 *
 * Pure-function source of truth for the weekly Curiosity Dive surface:
 *   - Is the dive open this ISO week, or already completed?
 *   - Which picker option does the persona default to?
 *   - Which picker options are eligible to show, given upstream data
 *     availability (any phenomena rows? any weak-topic candidates?)?
 *
 * No persona conditionals appear elsewhere in the dive code — Task 5's
 * route handler reads the inputs from the DB and passes a context;
 * everything else flows through `planWeeklyDive`.
 *
 * ZERO IO, ZERO React, ZERO PII. Pure data + functions.
 *
 * Spec: docs/superpowers/specs/2026-05-08-pedagogy-v2-three-speed-rhythm-design.md §5.2
 * Plan: docs/superpowers/plans/2026-05-09-pedagogy-v2-wave-2-weekly-dive.md
 */

import type { GoalCode } from '../goals/goal-profile';
import { isKnownGoalCode } from '../goals/goal-profile';

// ─── Types ─────────────────────────────────────────────────────────────────

export type DiveState = 'open' | 'completed';
export type DivePickerOption = 'phenomenon' | 'weak_topic' | 'own_topic';

export interface WeeklyDiveContext {
  persona: GoalCode | string | null | undefined;
  studentGrade: string;
  nowIso: string;
  /** ISO week 'YYYY-Www' of the most recent completed dive, or null if never. */
  lastCompletedIsoWeek: string | null;
  weakTopicCount: number;
  eligiblePhenomenaCount: number;
}

export interface WeeklyDivePlan {
  state: DiveState;
  defaultPicker: DivePickerOption;
  showWeakTopicOption: boolean;
  showPhenomenonOption: boolean;
  /** Always true — own-topic is the universal escape hatch. */
  showOwnTopicOption: boolean;
}

// ─── ISO week ──────────────────────────────────────────────────────────────

/**
 * Compute ISO 8601 week-of-year for a given UTC date and return as
 * 'YYYY-Www' (e.g. '2026-W19'). Implements the "Thursday rule": the ISO
 * week containing 4 January is week 1; weeks start on Monday.
 *
 * Reference: https://en.wikipedia.org/wiki/ISO_week_date#Calculating_the_week_number_from_an_ordinal_date
 */
export function isoWeekOf(date: Date): string {
  // Work in UTC to avoid timezone drift.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // ISO weekday: Monday=1 .. Sunday=7. JS getUTCDay returns Sun=0..Sat=6.
  const dayNum = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  // Shift to the Thursday of this week (ISO week is anchored on Thursday).
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const isoYear = d.getUTCFullYear();
  // Find Jan 4 of the ISO year (always in week 1 by rule).
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const diffMs = d.getTime() - jan4.getTime();
  const week = 1 + Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));
  return `${isoYear}-W${week.toString().padStart(2, '0')}`;
}

// ─── Per-persona default picker ────────────────────────────────────────────

const DEFAULT_PICKER_BY_PERSONA: Record<GoalCode, DivePickerOption> = {
  improve_basics:    'weak_topic',
  pass_comfortably:  'weak_topic',
  school_topper:     'phenomenon',
  board_topper:      'weak_topic',
  competitive_exam:  'own_topic',
  olympiad:          'own_topic',
};

const FALLBACK_PICKER: DivePickerOption = 'phenomenon';

// ─── Public API ────────────────────────────────────────────────────────────

export function planWeeklyDive(ctx: WeeklyDiveContext): WeeklyDivePlan {
  const currentIsoWeek = isoWeekOf(new Date(ctx.nowIso));
  const state: DiveState =
    ctx.lastCompletedIsoWeek === currentIsoWeek ? 'completed' : 'open';

  const showPhenomenonOption = ctx.eligiblePhenomenaCount > 0;
  const showWeakTopicOption = ctx.weakTopicCount > 0;
  const showOwnTopicOption = true;

  // Resolve the persona-default, then downgrade to a visible option if the
  // default is currently hidden.
  const personaCode: GoalCode | null =
    ctx.persona && isKnownGoalCode(ctx.persona) ? ctx.persona : null;
  const personaDefault: DivePickerOption = personaCode
    ? DEFAULT_PICKER_BY_PERSONA[personaCode]
    : FALLBACK_PICKER;

  const isVisible = (opt: DivePickerOption): boolean => {
    if (opt === 'phenomenon') return showPhenomenonOption;
    if (opt === 'weak_topic') return showWeakTopicOption;
    return showOwnTopicOption; // own_topic is always visible
  };

  let defaultPicker: DivePickerOption = personaDefault;
  if (!isVisible(defaultPicker)) {
    // Fallback chain: phenomenon → weak_topic → own_topic, picking the first visible.
    const fallbackOrder: DivePickerOption[] = ['phenomenon', 'weak_topic', 'own_topic'];
    defaultPicker = fallbackOrder.find(isVisible) ?? 'own_topic';
  }

  return {
    state,
    defaultPicker,
    showPhenomenonOption,
    showWeakTopicOption,
    showOwnTopicOption,
  };
}
