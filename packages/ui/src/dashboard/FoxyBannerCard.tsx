'use client';

import { useRouter } from 'next/navigation';
import { FoxyBanner } from '@alfanumrik/ui/ui';
import type { CurriculumTopic } from '@alfanumrik/lib/types';
import { useFeatureFlags } from '@alfanumrik/lib/swr';
import { reviewRoute } from '@alfanumrik/lib/routes/study-menu-routes';

/**
 * FoxyBannerCard — The single most important element on the dashboard.
 *
 * Picks ONE action based on priority:
 * 1. Streak at risk (urgent emotional trigger)
 * 2. Due reviews (forgetting prevention)
 * 3. Knowledge gaps (prerequisite fix)
 * 4. Continue learning (next topic)
 * 5. Daily challenge (default engagement)
 */

interface FoxyBannerCardProps {
  isHi: boolean;
  streak: number;
  dueCount: number;
  knowledgeGaps: Array<{ id: string; topic_title?: string }>;
  nextTopic: CurriculumTopic | null;
  subjectMeta?: { icon: string; name: string; color: string } | null;
}

export default function FoxyBannerCard({
  isHi,
  streak,
  dueCount,
  knowledgeGaps,
  nextTopic,
  subjectMeta,
}: FoxyBannerCardProps) {
  const router = useRouter();
  // Phase 5 Study-Menu v2 — route /review to /refresh when flag is on.
  const { data: flags } = useFeatureFlags();
  const flagsRecord = (flags ?? {}) as Record<string, boolean>;

  // Priority 1: Streak at risk
  if (streak > 0 && streak <= 2) {
    return (
      <FoxyBanner
        message={isHi ? `${streak} दिन की स्ट्रीक बचाओ! 1 क्विज़ लो` : `Save your ${streak}-day streak! Take a quiz`}
        actionLabel={isHi ? 'क्विज़ लो' : 'Take Quiz'}
        onAction={() => router.push('/quiz?mode=practice')}
        accent="#EF4444"
      />
    );
  }

  // Priority 2: Due reviews
  if (dueCount > 0) {
    return (
      <FoxyBanner
        message={isHi ? `${dueCount} चीज़ें भूलने वाली हैं — रिव्यू करो` : `${dueCount} topics need review before you forget`}
        actionLabel={isHi ? 'रिव्यू करो' : 'Review Now'}
        onAction={() => router.push(reviewRoute(flagsRecord))}
        accent="var(--gold)"
      />
    );
  }

  // Priority 3: Knowledge gaps
  if (knowledgeGaps.length > 0) {
    const gap = knowledgeGaps[0];
    return (
      <FoxyBanner
        message={isHi ? `"${gap.topic_title || 'एक टॉपिक'}" में कमज़ोरी है — ठीक करें` : `Let's fix your gap in "${gap.topic_title || 'a topic'}"`}
        actionLabel={isHi ? 'Foxy से ठीक करो' : 'Fix with Foxy'}
        onAction={() => router.push('/foxy')}
        accent="var(--purple)"
      />
    );
  }

  // Priority 4: Continue learning
  if (nextTopic) {
    return (
      <FoxyBanner
        message={isHi ? `आगे सीखो: ${nextTopic.title}` : `Continue: ${nextTopic.title}`}
        actionLabel={isHi ? 'सीखो' : 'Learn Now'}
        onAction={() => router.push('/foxy')}
        accent={subjectMeta?.color}
      />
    );
  }

  // Priority 5: Default — start learning
  return (
    <FoxyBanner
      message={isHi ? 'आज कुछ नया सीखो! Foxy तैयार है' : 'Ready to learn something new? Foxy is waiting!'}
      actionLabel={isHi ? 'शुरू करो' : 'Start Learning'}
      onAction={() => router.push('/foxy')}
    />
  );
}
