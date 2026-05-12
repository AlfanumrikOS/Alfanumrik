'use client';

/**
 * TodayLoopCard — surfaces the Learner Loop's next-action recommendation
 * at the top of the /study-plan page.
 *
 * Phase 3b (initial): consumed /api/learner/next directly.
 * Phase 3c follow-on: now prefers /api/learner/scheduled?horizon=daily
 * (the per-day pinned projection) and falls back to /api/learner/next
 * when no slot is pinned yet. When the scheduled slot exists, a small
 * "Pinned for today" pill appears so the student understands the
 * recommendation is stable for the day.
 *
 * Rendered when ALL of:
 *   - ff_learner_loop_dashboard_v1 is ON (same flag as the dashboard hero
 *     and the primary CTA; one flag toggles all consumers together).
 *   - The cascade returns a non-null action (server's ff_learner_loop_v1
 *     is ON AND the learner has a profile, OR ff_scheduled_actions_v1
 *     is ON AND has written a slot today).
 *
 * Otherwise: renders nothing.
 */

import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui';
import { useFeatureFlags, useLearnerActionForToday } from '@/lib/swr';
import { actionDisplay, actionPrimaryCta } from '@/lib/state/learner-loop/action-display';
import type { LearnerAction } from '@/lib/state/learner-loop/types';

interface TodayLoopCardProps {
  studentId: string;
  isHi: boolean;
}

export default function TodayLoopCard({ studentId, isHi }: TodayLoopCardProps) {
  const router = useRouter();
  const { data: flags } = useFeatureFlags();
  const dashboardLoopOn = flags?.ff_learner_loop_dashboard_v1 === true;
  const { data: resp } = useLearnerActionForToday(
    dashboardLoopOn ? studentId : undefined,
  );
  const action = (resp?.action as LearnerAction | undefined) ?? null;
  const isPinnedToday = resp?.source === 'scheduled';

  if (!action) return null;

  const d = actionDisplay(action);
  const cta = actionPrimaryCta(action);

  return (
    <Card
      accent={d.tint}
      className="!p-4"
      data-testid="study-plan-today-loop-card"
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <p
          className="text-[11px] font-bold uppercase tracking-widest"
          style={{ color: 'var(--text-3)' }}
        >
          {isHi ? 'अगर आज सिर्फ़ 15 मिनट हैं' : 'If you have 15 minutes today'}
        </p>
        <span
          className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
          style={{
            background: `${d.tint}15`,
            color: d.tint,
            border: `1px solid ${d.tint}30`,
          }}
          data-testid="study-plan-today-source-pill"
          data-source={isPinnedToday ? 'scheduled' : 'next'}
        >
          {isPinnedToday
            ? (isHi ? '📌 आज के लिए चुना' : '📌 Pinned for today')
            : (isHi ? 'Foxy की सलाह' : 'Foxy picks')}
        </span>
      </div>

      <div className="flex items-center gap-3 mb-3">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
          style={{ background: `${d.tint}12`, color: d.tint }}
        >
          {d.icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm md:text-base truncate">
            {isHi ? d.titleHi : d.titleEn}
          </p>
          <p className="text-xs text-[var(--text-3)] mt-0.5 truncate">
            {isHi ? d.subHi : d.subEn}
          </p>
        </div>
      </div>

      <button
        onClick={() => router.push(action.url)}
        className="w-full py-2.5 rounded-xl text-sm font-bold text-white transition-all active:scale-[0.98]"
        style={{ background: d.tint }}
        data-testid="study-plan-today-loop-cta"
      >
        {isHi ? cta.hi : cta.en} →
      </button>
    </Card>
  );
}
