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

import ChallengeStreakBadge from '@/components/challenge/StreakBadge';

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
    <div className="space-y-4 pt-3">
      {/* Mini leaderboard card */}
      {showLeaderboard && (
        <button
          onClick={() => router.push('/leaderboard')}
          className="w-full rounded-2xl p-4 flex items-center gap-3 transition-all active:scale-[0.98]"
          style={{
            background: 'linear-gradient(135deg, rgba(245,166,35,0.06), rgba(232,88,28,0.06))',
            border: '1px solid rgba(245,166,35,0.2)',
          }}
        >
          <span className="text-2xl" aria-hidden="true">🏆</span>
          <div className="flex-1 text-left">
            {studentRank !== null ? (
              <>
                <div className="text-sm font-bold" style={{ color: 'var(--gold)' }}>
                  {isHi
                    ? `तुम #${studentRank} हो इस हफ्ते!`
                    : `You're #${studentRank} this week!`}
                </div>
                <div className="text-xs text-[var(--text-3)]">
                  {isHi ? 'पूरी रैंकिंग देखो →' : 'See full rankings →'}
                </div>
              </>
            ) : (
              <>
                <div className="text-sm font-bold" style={{ color: 'var(--gold)' }}>
                  {isHi ? 'रैंकिंग में आओ!' : 'Join the Rankings!'}
                </div>
                <div className="text-xs text-[var(--text-3)]">
                  {isHi
                    ? 'क्विज़ खेलो और टॉप पर जाओ'
                    : 'Take quizzes to climb the leaderboard'}
                </div>
              </>
            )}
          </div>
          <span className="text-[var(--text-3)]" aria-hidden="true">→</span>
        </button>
      )}

      {/* Weekly Challenge — Concept Chain streak summary */}
      {showChallengeStreak && (
        <button
          onClick={() => router.push('/challenge')}
          className="w-full rounded-2xl p-4 flex items-center gap-3 transition-all active:scale-[0.98]"
          style={{
            background: 'linear-gradient(135deg, rgba(124,58,237,0.06), rgba(139,92,246,0.06))',
            border: '1px solid rgba(124,58,237,0.2)',
          }}
        >
          <span className="text-2xl" aria-hidden="true">🧩</span>
          <div className="flex-1 text-left">
            <div className="text-sm font-bold" style={{ color: 'var(--purple)' }}>
              {isHi ? 'साप्ताहिक चुनौती' : 'Weekly Challenge'}
            </div>
            <div className="text-xs text-[var(--text-3)] mt-0.5">
              {isHi ? 'Concept Chain स्ट्रीक' : 'Concept Chain streak'}
            </div>
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
