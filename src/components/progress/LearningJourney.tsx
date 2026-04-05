'use client';

import { useRouter } from 'next/navigation';
import { Card, ProgressBar } from '@/components/ui';
import XPProgressRing from '@/components/xp/XPProgressRing';
import { calculateLevel, xpToNextLevel, getLevelName } from '@/lib/xp-rules';
import type { StudentSnapshot, LearningVelocity } from '@/lib/types';

/* ── Types ── */
interface LearningJourneyProps {
  totalXp: number;
  snapshot: StudentSnapshot | null;
  streakDays: number;
  accuracy: number;
  velocityData: LearningVelocity[];
  isHi: boolean;
}

/* ── Trend helpers ── */
function getTrend(velocityData: LearningVelocity[]): 'improving' | 'steady' | 'needs_attention' {
  if (velocityData.length < 2) return 'steady';
  const rates = velocityData.map(v => v.weekly_mastery_rate ?? 0);
  const recent = rates.slice(0, Math.ceil(rates.length / 2));
  const older = rates.slice(Math.ceil(rates.length / 2));
  const avgRecent = recent.reduce((a, b) => a + b, 0) / (recent.length || 1);
  const avgOlder = older.reduce((a, b) => a + b, 0) / (older.length || 1);
  if (avgRecent > avgOlder * 1.1) return 'improving';
  if (avgRecent < avgOlder * 0.85) return 'needs_attention';
  return 'steady';
}

function getPersonalizedMessage(
  trend: 'improving' | 'steady' | 'needs_attention',
  accuracy: number,
  topicsMastered: number,
  isHi: boolean,
): string {
  if (trend === 'improving') {
    return isHi
      ? 'शानदार! तुम्हारी गति बढ़ रही है। ऐसे ही आगे बढ़ो!'
      : 'Amazing! Your learning speed is picking up. Keep going!';
  }
  if (trend === 'needs_attention') {
    return isHi
      ? 'थोड़ा और अभ्यास करो -- Foxy तुम्हारी मदद के लिए तैयार है!'
      : 'A little more practice will help -- Foxy is ready to support you!';
  }
  if (accuracy >= 80) {
    return isHi
      ? 'बहुत अच्छा! तुम्हारी सटीकता शानदार है।'
      : 'Great job! Your accuracy is really strong.';
  }
  if (topicsMastered > 0) {
    return isHi
      ? `${topicsMastered} टॉपिक मास्टर किए। अगले लक्ष्य की ओर बढ़ो!`
      : `${topicsMastered} topics mastered. Onwards to the next goal!`;
  }
  return isHi
    ? 'हर रोज़ थोड़ा सीखो, बड़ा फ़र्क़ पड़ेगा!'
    : 'A little learning every day makes a big difference!';
}

/* ── Component ── */
export default function LearningJourney({
  totalXp,
  snapshot,
  streakDays,
  accuracy,
  velocityData,
  isHi,
}: LearningJourneyProps) {
  const router = useRouter();
  const level = calculateLevel(totalXp);
  const { current, needed } = xpToNextLevel(totalXp);
  const levelName = getLevelName(level);
  const trend = getTrend(velocityData);
  const topicsMastered = snapshot?.topics_mastered ?? 0;
  const topicsInProgress = snapshot?.topics_in_progress ?? 0;
  const message = getPersonalizedMessage(trend, accuracy, topicsMastered, isHi);

  return (
    <Card className="!p-5 animate-slide-up" accent="var(--orange)">
      <div className="flex items-start gap-4">
        {/* XP Ring */}
        <XPProgressRing totalXp={totalXp} size="lg" showLabel={false} isHi={isHi} />

        <div className="flex-1 min-w-0">
          {/* Level name + badge */}
          <h2
            className="text-base font-bold leading-tight"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--orange)' }}
          >
            {isHi ? `लेवल ${level}` : `Level ${level}`} — {levelName}
          </h2>

          {/* XP progress bar */}
          <div className="mt-2">
            <ProgressBar
              value={Math.round((current / needed) * 100)}
              color="var(--orange)"
              height={6}
            />
            <p className="text-[10px] text-[var(--text-3)] mt-0.5">
              {current}/{needed} XP {isHi ? `लेवल ${level + 1} तक` : `to Level ${level + 1}`}
            </p>
          </div>
        </div>
      </div>

      {/* Weekly summary */}
      <div className="mt-4 rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
        <p className="text-xs font-semibold text-[var(--text-2)] mb-2">
          {isHi ? 'इस हफ्ते आपने:' : 'This week you:'}
        </p>
        <div className="space-y-1.5">
          {topicsMastered > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <span className="shrink-0 w-5 text-center text-green-600">&#10003;</span>
              <span>
                {isHi
                  ? `${topicsMastered} नए टॉपिक मास्टर किए`
                  : `Mastered ${topicsMastered} new topics`}
              </span>
            </div>
          )}
          {accuracy > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <span className="shrink-0 w-5 text-center" style={{ color: 'var(--orange)' }}>&#9889;</span>
              <span>
                {isHi
                  ? `क्विज़ में ${accuracy}% औसत सटीकता`
                  : `Scored ${accuracy}% avg in quizzes`}
              </span>
            </div>
          )}
          {streakDays > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <span className="shrink-0 w-5 text-center text-orange-500">&#128293;</span>
              <span>
                {isHi
                  ? `${streakDays} दिन की स्ट्रीक जारी!`
                  : `${streakDays}-day streak going strong!`}
              </span>
            </div>
          )}
          {topicsInProgress > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <span className="shrink-0 w-5 text-center text-blue-500">&#128218;</span>
              <span>
                {isHi
                  ? `${topicsInProgress} टॉपिक पर काम चल रहा है`
                  : `${topicsInProgress} topics in progress`}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Personalized message */}
      <button
        onClick={() => router.push('/study-plan')}
        className="mt-3 w-full text-left rounded-xl p-3 transition-all active:scale-[0.98]"
        style={{
          background: 'linear-gradient(135deg, #FFF7ED, #FEF3E2)',
          border: '1.5px solid rgba(232,88,28,0.15)',
        }}
      >
        <p className="text-xs text-[var(--text-2)] leading-relaxed">
          <span className="font-semibold" style={{ color: 'var(--orange)' }}>
            {isHi ? 'Foxy कहता है: ' : 'Foxy says: '}
          </span>
          {message}
        </p>
      </button>
    </Card>
  );
}
