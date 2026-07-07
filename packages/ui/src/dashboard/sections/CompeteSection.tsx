'use client';

/**
 * CompeteSection — collapsed below-fold accordion content.
 *
 * Houses social/competitive widgets that previously stacked above-the-fold:
 *   - Mini leaderboard card (rank chip OR "Join the rankings!" zero-state)
 *   - Weekly challenge streak badge (Concept Chain) when student has any streak
 *
 * Lazy-loaded via next/dynamic from page.tsx — only mounts when the user
 * expands the "Compete" accordion. This prevents the leaderboard rank query
 * from inflating the dashboard's first-paint payload.
 *
 * Owned by frontend. JSX moved verbatim from page.tsx — no behavior changes.
 */

import ChallengeStreakBadge from '@alfanumrik/ui/challenge/StreakBadge';
import { trackDashboardCta } from '@alfanumrik/lib/posthog/dashboard-cta';

interface CompeteSectionProps {
  isHi: boolean;
  router: { push: (path: string) => void };
  studentRank: number | null;
  totalXp: number;
  challengeStreak: number;
  challengeBadges: string[];
}

export default function CompeteSection({
  isHi,
  router,
  studentRank,
  totalXp,
  challengeStreak,
  challengeBadges,
}: CompeteSectionProps) {
  const showLeaderboard = studentRank !== null || totalXp > 0;
  const showChallengeStreak = challengeStreak > 0;

  return (
    <div className="space-y-4 pt-1">
      {/* Leaderboard rank — HUGE serif number is the headline.
          Was a small text row; now it reads as an editorial hero. */}
      {showLeaderboard && (
        <button
          onClick={() => {
            trackDashboardCta({
              section: 'compete',
              action: studentRank !== null ? 'leaderboard_ranked' : 'leaderboard_zero_state',
              destination: '/leaderboard',
            });
            router.push('/leaderboard');
          }}
          className="editorial-card w-full text-left active:scale-[0.99] transition-transform"
          style={{
            background: 'linear-gradient(135deg, var(--accent-soft) 0%, var(--paper) 70%)',
            borderColor: 'var(--accent-quiet)',
          }}
          aria-label={
            studentRank !== null
              ? (isHi ? `तुम्हारी रैंक: ${studentRank}` : `Your rank: ${studentRank}`)
              : (isHi ? 'रैंकिंग में शामिल हो' : 'Join the rankings')
          }
        >
          <p className="editorial-eyebrow editorial-eyebrow--accent">
            <span aria-hidden="true">🏆</span>{' '}
            {isHi ? 'इस हफ्ते' : 'This Week'}
          </p>
          {studentRank !== null ? (
            <>
              <div className="flex items-baseline gap-1 mt-2">
                <span className="dashboard-rank-display dashboard-rank-display--hash">#</span>
                <span
                  className="dashboard-rank-display"
                  style={{ color: 'var(--accent)' }}
                  data-testid="dashboard-compete-rank"
                >
                  {studentRank}
                </span>
              </div>
              <p
                className="mt-1"
                style={{
                  fontFamily: 'var(--font-serif)',
                  fontSize: 'var(--text-md)',
                  color: 'var(--ink-2)',
                  letterSpacing: '-0.01em',
                }}
              >
                {isHi ? 'तुम्हारी रैंक है।' : 'is your rank.'}
              </p>
              <p
                className="mt-3 inline-flex items-center gap-1.5"
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 'var(--text-xs)',
                  fontWeight: 700,
                  color: 'var(--accent)',
                  letterSpacing: '0.04em',
                }}
              >
                {isHi ? 'पूरी रैंकिंग देखो' : 'See full rankings'} →
              </p>
            </>
          ) : (
            <>
              <p
                className="mt-2"
                style={{
                  fontFamily: 'var(--font-serif)',
                  fontSize: 'clamp(22px, 5vw, 28px)',
                  color: 'var(--ink)',
                  letterSpacing: '-0.015em',
                  lineHeight: 1.15,
                }}
              >
                {isHi ? 'रैंकिंग में आओ।' : 'Join the rankings.'}
              </p>
              <p
                className="mt-2"
                style={{
                  fontSize: 'var(--text-xs)',
                  color: 'var(--ink-3)',
                }}
              >
                {isHi
                  ? 'क्विज़ खेलो और टॉप पर जाओ।'
                  : 'Take quizzes to climb the leaderboard.'}
              </p>
              <p
                className="mt-3 inline-flex items-center gap-1.5"
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 'var(--text-xs)',
                  fontWeight: 700,
                  color: 'var(--accent)',
                  letterSpacing: '0.04em',
                }}
              >
                {isHi ? 'अभी देखो' : 'Take a look'} →
              </p>
            </>
          )}
        </button>
      )}

      {/* Weekly Challenge — Concept Chain streak summary */}
      {showChallengeStreak && (
        <button
          onClick={() => {
            trackDashboardCta({
              section: 'compete',
              action: 'weekly_challenge',
              destination: '/challenge',
            });
            router.push('/challenge');
          }}
          className="editorial-card w-full text-left flex items-center gap-3 active:scale-[0.99] transition-transform"
          style={{
            background: 'linear-gradient(135deg, rgba(124,58,237,0.06), var(--paper))',
            borderColor: 'rgba(124,58,237,0.2)',
          }}
        >
          <span
            className="rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              width: 44,
              height: 44,
              background: 'rgba(124,58,237,0.10)',
              fontSize: 22,
            }}
            aria-hidden="true"
          >
            🧩
          </span>
          <div className="flex-1 text-left">
            <p
              className="editorial-eyebrow"
              style={{ color: '#7C3AED' }}
            >
              {isHi ? 'साप्ताहिक चुनौती' : 'Weekly Challenge'}
            </p>
            <p
              className="mt-1"
              style={{
                fontFamily: 'var(--font-serif)',
                fontSize: 'var(--text-lg)',
                color: 'var(--ink)',
                letterSpacing: '-0.01em',
              }}
            >
              {isHi ? 'Concept Chain' : 'Concept Chain'}
            </p>
          </div>
          <ChallengeStreakBadge
            streak={challengeStreak}
            badges={challengeBadges}
            isHi={isHi}
            size="md"
          />
        </button>
      )}
    </div>
  );
}
