'use client';

/**
 * AboveFoldHero — the only widget block visible without scrolling.
 *
 * Renders FOUR small cards under the page header (the greeting itself lives in
 * page.tsx so it can use the existing PlanBadge/CoinBalance chrome):
 *   1. Primary CTA   — "Start today's quiz" deep link to /quiz
 *   2. Streak chip   — current_streak with flame icon
 *   3. Today's XP    — XPDailyStatus (existing component) — quiz/chat caps
 *   4. Continue card — last topic via BKT, OR zero-state subject picker hint
 *
 * Mobile-first: at 360px width all four stack vertically with 16px gaps.
 *
 * Owned by frontend. No business logic — just composition of existing widgets.
 */

import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui';
import XPDailyStatus from '@/components/xp/XPDailyStatus';
import type { CurriculumTopic, Student } from '@/lib/types';
import type { Subject as AllowedSubject } from '@/lib/subjects.types';
import { useFeatureFlags, useLearnerNext } from '@/lib/swr';
import { actionDisplay, actionPrimaryCta } from '@/lib/state/learner-loop/action-display';
import type { LearnerAction } from '@/lib/state/learner-loop/types';
import { trackDashboardCta } from '@/lib/posthog/dashboard-cta';

interface AboveFoldHeroProps {
  student: Student;
  streak: number;
  isHi: boolean;
  nextTopics: CurriculumTopic[];
  allowedSubjects: AllowedSubject[];
  selectedSubjects: string[];
  onPickSubjects: () => void;
}

export default function AboveFoldHero({
  student,
  streak,
  isHi,
  nextTopics,
  allowedSubjects,
  selectedSubjects,
  onPickSubjects,
}: AboveFoldHeroProps) {
  const router = useRouter();
  const meta = allowedSubjects.find((s) => s.code === student.preferred_subject);
  const topTopic = nextTopics[0];
  const hasSubjects = selectedSubjects.length > 0 && allowedSubjects.length > 0;

  // ADR-001 Phase 3a — Learner Loop next-action card.
  // Renders only when ALL of:
  //   1. ff_learner_loop_dashboard_v1 is ON (client gate)
  //   2. /api/learner/next returns a 200 (server's ff_learner_loop_v1 is ON
  //      AND the learner has a profile)
  // Falls through to the legacy BKT-topic Continue card on any other state.
  const { data: flags } = useFeatureFlags();
  const dashboardLoopOn = flags?.ff_learner_loop_dashboard_v1 === true;
  const { data: nextResp } = useLearnerNext(dashboardLoopOn ? student.id : undefined);
  const loopAction = (nextResp?.action as LearnerAction | undefined) ?? null;

  return (
    <div className="space-y-3">
      {/* 1. PRIMARY CTA — single, opinionated, biggest tap target.
            Phase 3b: when the Loop action is available, the CTA's url +
            label come from it (the action might be a review, a revise,
            a dive, etc — not always a quiz). Falls back to the legacy
            hardcoded /quiz button when no action. */}
      {(() => {
        const cta = loopAction ? actionPrimaryCta(loopAction) : null;
        const url = loopAction?.url ?? '/quiz';
        const icon = loopAction ? actionDisplay(loopAction).icon : '⚡';
        const labelEn = cta?.en ?? "Start Today's Quiz";
        const labelHi = cta?.hi ?? 'आज का क्विज़ शुरू करो';
        return (
          <button
            onClick={() => {
              // Analytics — dashboard CTA tracking (mobile-first redesign).
              // PII-free: only the section + action key + destination route.
              trackDashboardCta({
                section: 'above_fold_hero',
                action: loopAction ? 'loop_primary_cta' : 'default_primary_cta',
                destination: url,
              });
              router.push(url);
            }}
            className="w-full py-4 rounded-2xl font-bold text-base text-white transition-all active:scale-[0.98] shadow-md flex items-center justify-center gap-2"
            style={{
              background: 'linear-gradient(135deg, var(--purple, #7C3AED), #6D28D9)',
              fontFamily: 'var(--font-display)',
              minHeight: 56, // mobile tap target
            }}
            data-testid="dashboard-primary-cta"
          >
            <span className="text-xl">{icon}</span>
            {isHi ? labelHi : labelEn}
          </button>
        );
      })()}

      {/* 2. STREAK CHIP — flame + day count + bilingual unit */}
      <div
        className="rounded-2xl px-4 py-3 flex items-center justify-between"
        style={{
          background: 'linear-gradient(135deg, rgba(245,166,35,0.10), rgba(232,88,28,0.08))',
          border: '1px solid rgba(245,166,35,0.20)',
        }}
      >
        <div className="flex items-center gap-3">
          <span className="text-3xl streak-flame" aria-hidden="true">🔥</span>
          <div>
            <p
              className="text-2xl font-extrabold leading-none"
              style={{ color: 'var(--orange)', fontFamily: 'var(--font-display)' }}
            >
              {streak}
            </p>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
              {isHi
                ? `${streak === 1 ? 'दिन' : 'दिन'} की लय`
                : `day${streak === 1 ? '' : 's'} streak`}
            </p>
          </div>
        </div>
        {streak === 0 && (
          <p className="text-[11px] text-right max-w-[55%]" style={{ color: 'var(--text-3)' }}>
            {isHi ? 'आज क्विज़ दो — लय शुरू करो' : 'Take a quiz today — start your streak'}
          </p>
        )}
      </div>

      {/* 3. TODAY'S XP STRIP — quiz + chat caps from XPDailyStatus */}
      <XPDailyStatus studentId={student.id} streak={streak} isHi={isHi} />

      {/* 4. NEXT ACTION — Learner Loop resolver when flag on, else legacy
              BKT Continue card, else zero-state subject picker. */}
      {loopAction ? (
        (() => {
          const d = actionDisplay(loopAction);
          return (
            <Card
              hoverable
              onClick={() => {
                trackDashboardCta({
                  section: 'above_fold_hero',
                  action: 'loop_action_card',
                  destination: loopAction.url,
                });
                router.push(loopAction.url);
              }}
              className="flex items-center gap-3 !p-4"
              data-testid="dashboard-loop-action-card"
            >
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                style={{ background: `${d.tint}15`, color: d.tint }}
              >
                {d.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                  {isHi ? d.eyebrowHi : d.eyebrowEn}
                </p>
                <p className="font-semibold text-sm md:text-base truncate mt-0.5">
                  {isHi ? d.titleHi : d.titleEn}
                </p>
                <p className="text-xs text-[var(--text-3)] mt-0.5 truncate">
                  {isHi ? d.subHi : d.subEn}
                </p>
              </div>
              <span className="text-[var(--text-3)] text-lg" aria-hidden="true">→</span>
            </Card>
          );
        })()
      ) : topTopic ? (
        <Card
          hoverable
          onClick={() => {
            const dest = topTopic.chapter_number
              ? `/learn/${student.preferred_subject}/${topTopic.chapter_number}`
              : '/foxy';
            trackDashboardCta({
              section: 'above_fold_hero',
              action: 'continue_topic_card',
              destination: dest,
            });
            router.push(dest);
          }}
          className="flex items-center gap-3 !p-4"
        >
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
            style={{ background: `${meta?.color ?? 'var(--orange)'}15` }}
          >
            {meta?.icon ?? '📚'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
              {isHi ? 'जारी रखो' : 'Continue'}
            </p>
            <p className="font-semibold text-sm md:text-base truncate mt-0.5">
              {topTopic.title}
            </p>
            <p className="text-xs text-[var(--text-3)] mt-0.5 truncate">
              {topTopic.chapter_number
                ? (isHi ? `अध्याय ${topTopic.chapter_number}` : `Chapter ${topTopic.chapter_number}`)
                : (isHi ? 'Foxy के साथ सीखो' : 'Learn with Foxy')}
            </p>
          </div>
          <span className="text-[var(--text-3)] text-lg" aria-hidden="true">→</span>
        </Card>
      ) : (
        <Card className="!p-4">
          <p className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>
            {hasSubjects
              ? (isHi ? 'पहला विषय शुरू करो' : 'Pick a subject to start')
              : (isHi ? 'अपने विषय चुनो' : 'Choose your subjects')}
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
            {hasSubjects
              ? (isHi ? 'नीचे "मेरे विषय" से चुनो' : 'Tap a subject below to begin')
              : (isHi ? 'पहले अपने विषय चुनना ज़रूरी है' : 'Select subjects to unlock learning')}
          </p>
          {!hasSubjects && (
            <button
              onClick={() => {
                trackDashboardCta({
                  section: 'above_fold_hero',
                  action: 'pick_subjects',
                  destination: 'modal:subject_picker',
                });
                onPickSubjects();
              }}
              className="mt-3 w-full py-2.5 rounded-xl text-sm font-bold text-white transition-all active:scale-[0.98]"
              style={{ background: 'var(--orange)' }}
            >
              {isHi ? '+ विषय चुनो' : '+ Choose subjects'}
            </button>
          )}
        </Card>
      )}
    </div>
  );
}
