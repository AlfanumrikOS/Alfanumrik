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
import XPDailyStatus from '@alfanumrik/ui/xp/XPDailyStatus';
import type { CurriculumTopic, Student } from '@alfanumrik/lib/types';
import type { Subject as AllowedSubject } from '@alfanumrik/lib/subjects.types';
import { useFeatureFlags, useLearnerNext } from '@alfanumrik/lib/swr';
import { actionDisplay, actionPrimaryCta } from '@alfanumrik/lib/state/learner-loop/action-display';
import type { LearnerAction } from '@alfanumrik/lib/state/learner-loop/types';
import { trackDashboardCta } from '@alfanumrik/lib/posthog/dashboard-cta';
import { calculateLevel } from '@alfanumrik/lib/xp-config';

interface AboveFoldHeroProps {
  student: Student;
  streak: number;
  isHi: boolean;
  nextTopics: CurriculumTopic[];
  allowedSubjects: AllowedSubject[];
  selectedSubjects: string[];
  onPickSubjects: () => void;
  /** Optional XP total — drives the level pill in the stat strip. */
  totalXp?: number;
}

export default function AboveFoldHero({
  student,
  streak,
  isHi,
  nextTopics,
  allowedSubjects,
  selectedSubjects,
  onPickSubjects,
  totalXp = 0,
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
  const level = calculateLevel(totalXp);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-fluid-4)' }}>
      {/* 1. EDITORIAL NAME + STAT STRIP — the hero's hero.
            Fraunces serif name turns "school portal" into "editorial
            product". 3-cell strip below it: streak / XP / level. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-fluid-3)' }}>
        <h1 className="editorial-name" data-testid="dashboard-greeting-name">
          {student.name}
        </h1>
        <div className="dashboard-stat-strip" data-testid="dashboard-stat-strip">
          <div className="dashboard-stat-cell">
            <p className="dashboard-stat-cell__value">
              {streak}
            </p>
            <p className="dashboard-stat-cell__label">
              <span aria-hidden="true">🔥</span>{' '}
              {isHi ? 'दिन की लय' : streak === 1 ? 'day streak' : 'day streak'}
            </p>
          </div>
          <div className="dashboard-stat-cell">
            <p className="dashboard-stat-cell__value">
              {totalXp.toLocaleString('en-IN')}
            </p>
            <p className="dashboard-stat-cell__label">
              {isHi ? 'कुल XP' : 'Total XP'}
            </p>
          </div>
          <div className="dashboard-stat-cell">
            <p className="dashboard-stat-cell__value">
              {level}
            </p>
            <p className="dashboard-stat-cell__label">
              {isHi ? 'स्तर' : 'Level'}
            </p>
          </div>
        </div>
      </div>

      {/* 2. PRIMARY CTA — the single dominant button. Orange accent,
            full-width, impossible to miss on 360px. Bigger min-height,
            fluid padding so it scales smoothly to tablet/desktop. */}
      {(() => {
        const cta = loopAction ? actionPrimaryCta(loopAction) : null;
        const url = loopAction?.url ?? '/quiz';
        const icon = loopAction ? actionDisplay(loopAction).icon : '⚡';
        const labelEn = cta?.en ?? "Start Today's Quiz";
        const labelHi = cta?.hi ?? 'आज का क्विज़ शुरू करो';
        return (
          <button
            onClick={() => {
              trackDashboardCta({
                section: 'above_fold_hero',
                action: loopAction ? 'loop_primary_cta' : 'default_primary_cta',
                destination: url,
              });
              router.push(url);
            }}
            className="dashboard-hero-cta"
            data-testid="dashboard-primary-cta"
          >
            <span aria-hidden="true" style={{ fontSize: 22, lineHeight: 1 }}>{icon}</span>
            <span>{isHi ? labelHi : labelEn}</span>
          </button>
        );
      })()}

      {/* 3. TODAY'S XP STRIP — quiz + chat caps from XPDailyStatus.
            Kept as-is (assessment owns this widget) but now nests
            cleanly inside the editorial layout below the CTA. */}
      <XPDailyStatus studentId={student.id} streak={streak} isHi={isHi} />

      {/* 4. NEXT ACTION CARD — Learner Loop resolver when flag on,
            else legacy BKT Continue card, else zero-state subject
            picker. Now uses .editorial-card chrome for visual
            consistency with every other dashboard section. */}
      {loopAction ? (
        (() => {
          const d = actionDisplay(loopAction);
          return (
            <button
              onClick={() => {
                trackDashboardCta({
                  section: 'above_fold_hero',
                  action: 'loop_action_card',
                  destination: loopAction.url,
                });
                router.push(loopAction.url);
              }}
              className="editorial-card w-full text-left flex items-center gap-4 active:scale-[0.99] transition-transform"
              data-testid="dashboard-loop-action-card"
            >
              <div
                className="rounded-xl flex items-center justify-center flex-shrink-0"
                style={{
                  width: 52,
                  height: 52,
                  background: `${d.tint}15`,
                  color: d.tint,
                  fontSize: 22,
                }}
                aria-hidden="true"
              >
                {d.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p
                  className="editorial-eyebrow"
                  style={{ marginBottom: 4 }}
                >
                  {isHi ? d.eyebrowHi : d.eyebrowEn}
                </p>
                <p
                  className="truncate"
                  style={{
                    fontFamily: 'var(--font-serif)',
                    fontWeight: 500,
                    fontSize: 'var(--text-lg)',
                    color: 'var(--ink)',
                    letterSpacing: '-0.01em',
                  }}
                >
                  {isHi ? d.titleHi : d.titleEn}
                </p>
                <p
                  className="truncate"
                  style={{
                    fontSize: 'var(--text-xs)',
                    color: 'var(--ink-3)',
                    marginTop: 2,
                  }}
                >
                  {isHi ? d.subHi : d.subEn}
                </p>
              </div>
              <span
                style={{ color: 'var(--ink-3)', fontSize: 22, lineHeight: 1 }}
                aria-hidden="true"
              >
                →
              </span>
            </button>
          );
        })()
      ) : topTopic ? (
        <button
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
          className="editorial-card w-full text-left flex items-center gap-4 active:scale-[0.99] transition-transform"
        >
          <div
            className="rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              width: 52,
              height: 52,
              background: `${meta?.color ?? 'var(--accent)'}15`,
              fontSize: 22,
            }}
            aria-hidden="true"
          >
            {meta?.icon ?? '📚'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="editorial-eyebrow" style={{ marginBottom: 4 }}>
              {isHi ? 'जारी रखो' : 'Continue'}
            </p>
            <p
              className="truncate"
              style={{
                fontFamily: 'var(--font-serif)',
                fontWeight: 500,
                fontSize: 'var(--text-lg)',
                color: 'var(--ink)',
                letterSpacing: '-0.01em',
              }}
            >
              {topTopic.title}
            </p>
            <p
              className="truncate"
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--ink-3)',
                marginTop: 2,
              }}
            >
              {topTopic.chapter_number
                ? (isHi ? `अध्याय ${topTopic.chapter_number}` : `Chapter ${topTopic.chapter_number}`)
                : (isHi ? 'Foxy के साथ सीखो' : 'Learn with Foxy')}
            </p>
          </div>
          <span
            style={{ color: 'var(--ink-3)', fontSize: 22, lineHeight: 1 }}
            aria-hidden="true"
          >
            →
          </span>
        </button>
      ) : (
        <div className="editorial-card">
          <p
            style={{
              fontFamily: 'var(--font-serif)',
              fontWeight: 500,
              fontSize: 'var(--text-lg)',
              color: 'var(--ink)',
              letterSpacing: '-0.01em',
            }}
          >
            {hasSubjects
              ? (isHi ? 'पहला विषय शुरू करो' : 'Pick a subject to start')
              : (isHi ? 'अपने विषय चुनो' : 'Choose your subjects')}
          </p>
          <p
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--ink-3)',
              marginTop: 6,
            }}
          >
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
              className="dashboard-hero-cta"
              style={{ marginTop: 16 }}
            >
              {isHi ? '+ विषय चुनो' : '+ Choose subjects'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
