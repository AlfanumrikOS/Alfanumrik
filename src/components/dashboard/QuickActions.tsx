'use client';

import { useRouter } from 'next/navigation';

/**
 * QuickActions — "What to do now?" smart CTA.
 *
 * Replaces the old 6-tile grid (which caused choice paralysis) with:
 * 1. ONE primary action card — AI-chosen based on student context.
 * 2. Three secondary tiles for quick access to other tools.
 *
 * Design mandate: students should never wonder "what should I do now?"
 * The platform should tell them, not offer 6 equal-weight options.
 *
 * Upgrade rule: add smarter context signals to improve recommendation.
 * Never revert to the 6-tile undifferentiated grid.
 */

interface QuickActionsProps {
  isHi: boolean;
  // Context for smart recommendation (all optional for backward compat)
  dueCount?: number;          // spaced-repetition cards due
  nextTopic?: string | null;  // next topic title from CME
  streak?: number;            // current streak
  quizzesTaken?: number;      // total quizzes taken
}

function getRecommendation(props: QuickActionsProps): {
  icon: string; label: string; labelHi: string; href: string; color: string; reason: string; reasonHi: string;
} {
  const { dueCount = 0, nextTopic, streak = 0, quizzesTaken = 0 } = props;

  // Priority 1: Spaced repetition due — high retention impact
  if (dueCount >= 3) {
    return {
      icon: '🔄', label: 'Revise Due Cards', labelHi: 'रिव्यू करो',
      href: '/review', color: '#0D9488',
      reason: `${dueCount} cards due for review — revise before they fade!`,
      reasonHi: `${dueCount} कार्ड रिव्यू के लिए तैयार — भूलने से पहले दोहराओ!`,
    };
  }
  // Priority 2: New topic to study from curriculum
  if (nextTopic) {
    return {
      icon: '📖', label: 'Continue Learning', labelHi: 'पढ़ाई जारी रखो',
      href: '/learn', color: '#2563EB',
      reason: `Next up: ${nextTopic}`,
      reasonHi: `अगला: ${nextTopic}`,
    };
  }
  // Priority 3: First-ever quiz (on-board students quickly)
  if (quizzesTaken === 0) {
    return {
      icon: '⚡', label: 'Take Your First Quiz', labelHi: 'पहला क्विज़ दो',
      href: '/quiz', color: '#F59E0B',
      reason: 'See where you stand — it takes 5 minutes!',
      reasonHi: 'देखो तुम कहाँ हो — सिर्फ 5 मिनट!',
    };
  }
  // Priority 4: Keep streak alive
  if (streak > 0 && streak < 7) {
    return {
      icon: '🔥', label: 'Keep Your Streak', labelHi: 'स्ट्रीक बनाए रखो',
      href: '/quiz', color: '#EF4444',
      reason: `${streak}-day streak — don't break it!`,
      reasonHi: `${streak} दिन की स्ट्रीक — तोड़ना मत!`,
    };
  }
  // Default: ask Foxy a question
  return {
    icon: '🦊', label: 'Ask Foxy', labelHi: 'फॉक्सी से पूछो',
    href: '/foxy', color: '#7C3AED',
    reason: 'Got a doubt? Ask Foxy — she explains it simply.',
    reasonHi: 'कोई डाउट है? फॉक्सी से पूछो — वो सरल भाषा में समझाएगी।',
  };
}

const SECONDARY_ACTIONS = [
  { href: '/quiz', icon: '⚡', label: 'Quiz', labelHi: 'क्विज़' },
  { href: '/review', icon: '🔄', label: 'Revise', labelHi: 'रिव्यू' },
  { href: '/foxy', icon: '🦊', label: 'Foxy', labelHi: 'फॉक्सी' },
  { href: '/learn', icon: '📖', label: 'Learn', labelHi: 'पढ़ो' },
];

export default function QuickActions({ isHi, dueCount, nextTopic, streak, quizzesTaken }: QuickActionsProps) {
  const router = useRouter();
  const rec = getRecommendation({ isHi, dueCount, nextTopic, streak, quizzesTaken });

  return (
    <div className="space-y-2">
      {/* Primary recommendation card */}
      <button
        onClick={() => router.push(rec.href)}
        className="w-full rounded-2xl p-4 text-left transition-all active:scale-[0.98]"
        style={{
          background: `${rec.color}0F`,
          border: `1.5px solid ${rec.color}30`,
        }}
      >
        <div className="flex items-center gap-3">
          <span className="text-3xl">{rec.icon}</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold" style={{ color: rec.color }}>
              {isHi ? rec.labelHi : rec.label}
            </div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
              {isHi ? rec.reasonHi : rec.reason}
            </div>
          </div>
          <span className="text-lg" style={{ color: rec.color }}>→</span>
        </div>
      </button>

      {/* Secondary: compact 4-tile row for quick access */}
      <div className="grid grid-cols-4 gap-1.5">
        {SECONDARY_ACTIONS.filter(a => a.href !== rec.href).slice(0, 4).map((a) => (
          <button
            key={a.href}
            onClick={() => router.push(a.href)}
            className="rounded-xl p-2 flex flex-col items-center gap-1 transition-all active:scale-[0.95]"
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
            }}
          >
            <span className="text-base">{a.icon}</span>
            <span className="text-[10px] font-semibold" style={{ color: 'var(--text-3)' }}>
              {isHi ? a.labelHi : a.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
