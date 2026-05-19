'use client';

/**
 * TodaysFocusSection — collapsed below-fold accordion content.
 *
 * Houses focus-shaped widgets (what to do RIGHT NOW):
 *   - FocusDashboard (3-card "One Thing at a Time")
 *   - DailyChallengeCard (Concept Chain) — gated by todaySubject prop
 *   - Getting started checklist (< 5 quizzes taken)
 *   - Welcome card (zero-state, 0 XP)
 *   - Top nudge (max 1, no anxiety stack)
 *   - Due reviews quick link
 *   - Today's plan (after 50 XP unlock)
 *
 * Note: per Wave 1 the legacy <DailyChallenge> hero stays removed —
 * only DailyChallengeCard renders here.
 *
 * Owned by frontend. Composed of existing widgets.
 */

import FocusDashboard from '@/components/dashboard/FocusDashboard';
import DailyChallengeCard from '@/components/challenge/DailyChallengeCard';
import TodaysPlan from '@/components/dashboard/TodaysPlan';
import type { CurriculumTopic, StudentSnapshot } from '@/lib/types';
import { trackDashboardCta } from '@/lib/posthog/dashboard-cta';

interface KnowledgeGap {
  id: string;
  topic_title?: string;
  description: string;
  description_hi?: string;
}

interface Nudge {
  id: string;
  nudge_type: string;
  message: string;
  message_hi?: string;
  priority: number;
}

interface TodaysFocusSectionProps {
  isHi: boolean;
  router: { push: (path: string) => void };
  studentId: string;
  studentName: string;
  studentGrade: string;
  preferredSubject: string | null;
  totalXp: number;
  level: number;
  streak: number;
  snapshot: StudentSnapshot | null;
  profilesLength: number;
  // Daily challenge state
  challengeUnlocked: boolean;
  challengeStreak: number;
  challengeSolved: boolean;
  todaySubject?: string;
  todaySubjectHi?: string;
  todayTopic?: string;
  // Reviews & nudges
  dueCount: number;
  spacedRepetitionEnabled: boolean;
  nudges: Nudge[];
  onDismissNudge: (nudgeId: string) => void;
  // Today's plan inputs
  knowledgeGaps: KnowledgeGap[];
  nextTopics: CurriculumTopic[];
}

export default function TodaysFocusSection({
  isHi,
  router,
  studentId,
  studentName,
  studentGrade,
  preferredSubject,
  totalXp,
  level,
  streak,
  snapshot,
  profilesLength,
  challengeUnlocked,
  challengeStreak,
  challengeSolved,
  todaySubject,
  todaySubjectHi,
  todayTopic,
  dueCount,
  spacedRepetitionEnabled,
  nudges,
  onDismissNudge,
  knowledgeGaps,
  nextTopics,
}: TodaysFocusSectionProps) {
  const cleanGrade = (studentGrade || '9').replace('Grade ', '').trim();
  const quizzesTaken = snapshot?.quizzes_taken ?? 0;
  const showWelcome = totalXp === 0 && profilesLength <= 1;
  const showGettingStarted = quizzesTaken < 5 && quizzesTaken > 0;

  return (
    <div className="space-y-4 pt-3">
      {/* FOCUS ZONE: 3 cards */}
      <FocusDashboard
        studentId={studentId}
        studentName={studentName}
        isHi={isHi}
        grade={cleanGrade}
        xp={totalXp}
        level={level}
        streak={streak}
        preferredSubject={preferredSubject ?? undefined}
      />

      {/* CONCEPT CHAIN (single daily-challenge surface) */}
      {todaySubject && (
        <DailyChallengeCard
          studentId={studentId}
          grade={studentGrade}
          isHi={isHi}
          isUnlocked={challengeUnlocked}
          streak={challengeStreak}
          todaySubject={todaySubject}
          todaySubjectHi={todaySubjectHi}
          todayTopic={todayTopic}
          isSolved={challengeSolved}
        />
      )}

      {/* DUE REVIEWS — quick link */}
      {dueCount > 0 && spacedRepetitionEnabled && (
        <button
          onClick={() => {
            trackDashboardCta({
              section: 'todays_focus',
              action: 'due_reviews',
              destination: '/review',
            });
            router.push('/review');
          }}
          className="w-full rounded-2xl p-4 flex items-center gap-3 transition-all"
          style={{ background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.2)' }}
        >
          <span className="text-2xl" aria-hidden="true">🔄</span>
          <div className="text-left flex-1">
            <div className="font-semibold text-sm" style={{ color: 'var(--gold)' }}>
              {dueCount} {isHi ? 'रिव्यू बाकी है!' : 'topics due for review!'}
            </div>
            <div className="text-xs text-[var(--text-3)]">
              {isHi ? 'रोज़ रिव्यू = परीक्षा में फ़र्क' : 'Daily review = better exam score'}
            </div>
          </div>
          <span className="ml-auto" style={{ color: 'var(--gold)' }}>→</span>
        </button>
      )}

      {/* WELCOME — zero-state */}
      {showWelcome && (
        <div
          className="rounded-2xl p-5"
          style={{
            background: 'linear-gradient(135deg, #FFF7ED, #FEF3E2)',
            border: '1px solid #FDBA7420',
          }}
        >
          <div className="flex items-center gap-3 mb-4">
            <span className="text-3xl" aria-hidden="true">🦊</span>
            <div>
              <h2 className="text-base font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}>
                {isHi ? `स्वागत है, ${studentName}!` : `Welcome, ${studentName}!`}
              </h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
                {isHi
                  ? 'अपना पहला अध्याय शुरू करो — बस एक टैप!'
                  : 'Start your first lesson — just one tap!'}
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              trackDashboardCta({
                section: 'todays_focus',
                action: 'welcome_start_learning',
                destination: '/learn',
              });
              router.push('/learn');
            }}
            className="w-full py-3.5 rounded-xl text-sm font-bold text-white transition-all active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, #E8581C, #F5A623)' }}
          >
            📚 {isHi ? 'पढ़ना शुरू करो →' : 'Start Learning →'}
          </button>
          <button
            onClick={() => {
              trackDashboardCta({
                section: 'todays_focus',
                action: 'welcome_ask_foxy',
                destination: '/foxy',
              });
              router.push('/foxy');
            }}
            className="w-full mt-2 py-2.5 rounded-xl text-xs font-semibold transition-all active:scale-[0.98]"
            style={{ background: 'rgba(232,88,28,0.08)', color: 'var(--orange)' }}
          >
            🦊 {isHi ? 'या Foxy से कोई डाउट पूछो' : 'Or ask Foxy a question'}
          </button>
        </div>
      )}

      {/* GETTING STARTED CHECKLIST */}
      {showGettingStarted && (
        <div className="rounded-2xl p-4" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg" aria-hidden="true">🚀</span>
            <h3 className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}>
              {isHi ? 'शुरुआत करो' : 'Getting Started'}
            </h3>
            <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'var(--orange)', color: '#fff' }}>
              {[
                quizzesTaken >= 1,
                totalXp > 0 && profilesLength > 0,
                quizzesTaken >= 3,
                (snapshot?.topics_mastered ?? 0) > 0 || (snapshot?.topics_in_progress ?? 0) > 0,
              ].filter(Boolean).length}/4
            </span>
          </div>
          <div className="space-y-2">
            {[
              {
                done: quizzesTaken >= 1,
                icon: '✏️',
                label: isHi ? 'पहला क्विज़ दो' : 'Take your first quiz',
                actionKey: 'getting_started_first_quiz',
                dest: '/quiz',
              },
              {
                done: totalXp > 0 && profilesLength > 0,
                icon: '🦊',
                label: isHi ? 'Foxy से कोई सवाल पूछो' : 'Ask Foxy a question',
                actionKey: 'getting_started_ask_foxy',
                dest: '/foxy',
              },
              {
                done: quizzesTaken >= 3,
                icon: '📚',
                label: isHi ? 'कम से कम 3 क्विज़ पूरा करो' : 'Complete at least 3 quizzes',
                actionKey: 'getting_started_three_quizzes',
                dest: '/quiz',
              },
              {
                done: (snapshot?.topics_mastered ?? 0) > 0 || (snapshot?.topics_in_progress ?? 0) > 0,
                icon: '📈',
                label: isHi ? 'अपनी प्रगति देखो' : 'Check your progress',
                actionKey: 'getting_started_view_progress',
                dest: '/progress',
              },
            ].map((step, i) => (
              <button
                key={i}
                onClick={() => {
                  trackDashboardCta({
                    section: 'todays_focus',
                    action: step.actionKey,
                    destination: step.dest,
                  });
                  router.push(step.dest);
                }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all active:scale-[0.98]"
                style={{
                  background: step.done ? 'rgba(22,163,74,0.06)' : 'rgba(232,88,28,0.04)',
                  border: `1px solid ${step.done ? 'rgba(22,163,74,0.15)' : 'var(--border)'}`,
                }}
              >
                <span className="text-base flex-shrink-0" aria-hidden="true">{step.done ? '✅' : step.icon}</span>
                <span
                  className="text-xs font-medium flex-1"
                  style={{
                    color: step.done ? '#16A34A' : 'var(--text-2)',
                    textDecoration: step.done ? 'line-through' : 'none',
                  }}
                >
                  {step.label}
                </span>
                {!step.done && (
                  <span className="text-[10px] font-bold" style={{ color: 'var(--orange)' }}>
                    {isHi ? 'करो →' : 'Go →'}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* TOP NUDGE — max 1 */}
      {nudges.length > 0 && (() => {
        const nudge = nudges[0];
        const nudgeIcons: Record<string, string> = {
          schedule_behind: '⚠️', revision_due: '🔄', streak_risk: '🔥',
          exam_approaching: '📋', weak_topic: '📉', milestone: '🎉', encouragement: '💪',
        };
        const nudgeColors: Record<string, string> = {
          schedule_behind: '#F59E0B', revision_due: '#0891B2', streak_risk: '#EF4444',
          exam_approaching: '#DC2626', weak_topic: '#8B5CF6', milestone: '#16A34A', encouragement: '#E8581C',
        };
        return (
          <div
            key={nudge.id}
            className="rounded-xl p-3 flex items-start gap-2.5"
            style={{
              background: `${nudgeColors[nudge.nudge_type] ?? 'var(--orange)'}08`,
              border: `1px solid ${nudgeColors[nudge.nudge_type] ?? 'var(--orange)'}20`,
            }}
          >
            <span className="text-base flex-shrink-0 mt-0.5" aria-hidden="true">
              {nudgeIcons[nudge.nudge_type] ?? '💡'}
            </span>
            <p className="text-xs text-[var(--text-2)] leading-relaxed flex-1">
              {isHi && nudge.message_hi ? nudge.message_hi : nudge.message}
            </p>
            <button
              onClick={() => onDismissNudge(nudge.id)}
              className="text-[var(--text-3)] text-xs flex-shrink-0"
              aria-label={isHi ? 'बंद करो' : 'Dismiss'}
            >
              ✕
            </button>
          </div>
        );
      })()}

      {/* TODAYS PLAN — unlocked after 50 XP */}
      {totalXp >= 50 && (
        <TodaysPlan
          isHi={isHi}
          dueCount={dueCount}
          knowledgeGaps={knowledgeGaps.map((g) => ({ id: g.id, topic_title: g.topic_title ?? g.description }))}
          nextTopics={nextTopics}
          preferredSubject={preferredSubject ?? ''}
          streak={streak}
        />
      )}
    </div>
  );
}
