'use client';

/**
 * DailyPlanCard — student dashboard card showing the goal-adaptive daily plan.
 *
 * Phase 3 of Goal-Adaptive Learning Layers.
 *
 * Behavior:
 *   - Fetches /api/student/daily-plan via SWR.
 *   - Renders nothing (returns null) when:
 *       a) the API returns flagEnabled=false (ff_goal_daily_plan is OFF), OR
 *       b) data.goal is null (student has no academic_goal set), OR
 *       c) data.items is empty.
 *   - Otherwise renders the card with the per-goal item list.
 *
 * This keeps the founder constraint: when the flag is OFF, the dashboard
 * markup tree is byte-identical to today (the card mounts but renders null).
 *
 * Owner: frontend
 * Reviewers: assessment (item rendering matches buildDailyPlan output),
 *            ops (visual fits dashboard tile palette).
 *
 * P7: renders en or hi labels based on isHi prop.
 * P10: ~100 LOC, no heavy deps. SWR is already in the project bundle.
 * P13: no PII rendered.
 */

import useSWR from 'swr';
import {
  GOAL_PROFILES,
  isKnownGoalCode,
  type GoalCode,
} from '@/lib/goals/goal-profile';
import type {
  DailyPlan,
  DailyPlanItem,
  DailyPlanItemKind,
} from '@/lib/goals/daily-plan';
import StudentGoalBadge from '@/components/goals/StudentGoalBadge';

interface DailyPlanCardProps {
  isHi: boolean;
}

interface DailyPlanResponse {
  success: boolean;
  data: DailyPlan;
  flagEnabled: boolean;
}

const KIND_ICONS: Record<DailyPlanItemKind, string> = {
  pyq: '📋',
  concept: '📖',
  practice: '✍️',
  challenge: '🧩',
  review: '🔁',
  reflection: '💭',
};

const fetcher = async (url: string): Promise<DailyPlanResponse> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

export default function DailyPlanCard({ isHi }: DailyPlanCardProps) {
  const { data, error, isLoading } = useSWR<DailyPlanResponse>(
    '/api/student/daily-plan',
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );

  if (isLoading) {
    return (
      <div
        data-testid="daily-plan-card-skeleton"
        className="rounded-2xl border border-gray-100 bg-white p-5 animate-pulse"
      >
        <div className="h-4 w-32 bg-gray-100 rounded mb-3" />
        <div className="space-y-2">
          <div className="h-3 bg-gray-100 rounded" />
          <div className="h-3 bg-gray-100 rounded" />
          <div className="h-3 bg-gray-100 rounded" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        data-testid="daily-plan-card-error"
        className="rounded-2xl border border-gray-100 bg-gray-50 p-5 text-sm text-gray-500"
        role="alert"
      >
        {isHi
          ? 'आज की योजना लोड नहीं हो सकी'
          : "Couldn't load today's plan"}
      </div>
    );
  }

  // Empty states - card renders null (default behavior preserved).
  if (!data?.success) return null;
  if (!data.flagEnabled) return null;
  if (!isKnownGoalCode(data.data.goal)) return null;
  if (data.data.items.length === 0) return null;

  const profile = GOAL_PROFILES[data.data.goal as GoalCode];
  const totalLabel = isHi
    ? `${data.data.totalMinutes} मिनट`
    : `${data.data.totalMinutes} minutes`;

  return (
    <div
      data-testid="daily-plan-card"
      data-goal-code={profile.code}
      className="rounded-2xl border border-orange/20 bg-gradient-to-br from-cream to-white p-5 shadow-sm"
    >
      <header className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">
            {isHi ? 'आज की योजना' : "Today's plan"}
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">{totalLabel}</p>
        </div>
        <StudentGoalBadge goal={profile.code} isHi={isHi} />
      </header>

      <ul className="space-y-2">
        {data.data.items.map((item: DailyPlanItem, idx: number) => (
          <li
            key={`${item.kind}-${idx}`}
            data-testid="daily-plan-item"
            data-item-kind={item.kind}
            className="flex items-center gap-3 rounded-lg bg-white/60 p-3"
          >
            <span aria-hidden="true" className="text-xl">
              {KIND_ICONS[item.kind] ?? '•'}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {isHi ? item.titleHi : item.titleEn}
              </p>
            </div>
            <span className="text-xs text-gray-500 whitespace-nowrap">
              {isHi ? `${item.estimatedMinutes} मिनट` : `${item.estimatedMinutes} min`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
