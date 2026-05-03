'use client';

/**
 * StudentGoalBadge — small pill showing a student's chosen academic goal.
 *
 * Phase 3 of Goal-Adaptive Learning Layers. Renders nothing when the goal
 * is null, empty, or unknown (so default UI behavior is preserved when a
 * student has not set a goal). Used by parent/teacher visibility surfaces.
 *
 * Owner: frontend
 * Tone-driven background palette mirrors the GoalScorecardSentence pattern
 * shipped in Phase 1 (encouraging=green, analytical=blue, examiner=amber).
 *
 * P7 (bilingual): renders en label when isHi=false, hi label when isHi=true.
 * P13 (data privacy): consumes only the goal CODE; no PII.
 */

import {
  GOAL_PROFILES,
  isKnownGoalCode,
  type GoalCode,
} from '@/lib/goals/goal-profile';

interface StudentGoalBadgeProps {
  goal: string | null | undefined;
  isHi: boolean;
  size?: 'sm' | 'md';
}

const TONE_CLASSES: Record<string, string> = {
  encouraging: 'bg-green-50 text-green-800 border-green-200',
  analytical: 'bg-blue-50 text-blue-800 border-blue-200',
  examiner: 'bg-amber-50 text-amber-900 border-amber-200',
};

const SIZE_CLASSES: Record<NonNullable<StudentGoalBadgeProps['size']>, string> = {
  sm: 'text-xs px-2 py-0.5',
  md: 'text-sm px-3 py-1',
};

export default function StudentGoalBadge({
  goal,
  isHi,
  size = 'sm',
}: StudentGoalBadgeProps) {
  if (!isKnownGoalCode(goal)) return null;
  const profile = GOAL_PROFILES[goal as GoalCode];
  const toneClass = TONE_CLASSES[profile.scorecardTone] ?? TONE_CLASSES.analytical;
  const sizeClass = SIZE_CLASSES[size];
  const label = isHi ? profile.labelHi : profile.labelEn;

  return (
    <span
      data-testid="student-goal-badge"
      data-goal-code={profile.code}
      data-tone={profile.scorecardTone}
      className={`inline-flex items-center rounded-full border font-medium ${toneClass} ${sizeClass}`}
      title={isHi ? profile.labelEn : profile.labelHi}
    >
      {label}
    </span>
  );
}
