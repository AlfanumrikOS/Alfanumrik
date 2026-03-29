'use client';

import { useRouter } from 'next/navigation';

interface KnowledgeGap {
  id: string;
  topic_title: string;
}

interface NextTopic {
  id: string;
  title: string;
  title_hi?: string | null;
  chapter_number?: number | null;
}

interface Props {
  isHi: boolean;
  dueCount: number;
  knowledgeGaps: KnowledgeGap[];
  nextTopics: NextTopic[];
  preferredSubject: string;
  streak: number;
}

/**
 * TodaysPlan — "What to do next" widget for the student dashboard.
 *
 * Shows 3-4 actionable items based on the student's current state:
 * 1. Fix a knowledge gap (highest priority — links to Foxy)
 * 2. Review due cards (if any — links to /review)
 * 3. Continue next topic (links to Foxy learn mode)
 * 4. Take a quiz (links to /quiz)
 *
 * This replaces the passive stats-only dashboard with an action-oriented
 * daily learning path that Indian students can follow like a tuition schedule.
 */
export default function TodaysPlan({ isHi, dueCount, knowledgeGaps, nextTopics, preferredSubject, streak }: Props) {
  const router = useRouter();

  const items: { icon: string; label: string; sublabel: string; action: () => void; urgency: 'high' | 'medium' | 'low' }[] = [];

  // Priority 1: Fix knowledge gap
  if (knowledgeGaps.length > 0) {
    const gap = knowledgeGaps[0];
    items.push({
      icon: '🔴',
      label: isHi ? `${gap.topic_title} में सुधार करो` : `Fix gap: ${gap.topic_title}`,
      sublabel: isHi ? 'फॉक्सी से सीखो' : 'Learn with Foxy',
      action: () => router.push(`/foxy?topic=${encodeURIComponent(gap.topic_title)}&mode=doubt`),
      urgency: 'high',
    });
  }

  // Priority 2: Review due cards
  if (dueCount > 0) {
    items.push({
      icon: '🔄',
      label: isHi ? `${dueCount} कार्ड रिवीज़ करो` : `Review ${dueCount} cards`,
      sublabel: isHi ? 'भूलने से पहले दोहराओ' : 'Revise before you forget',
      action: () => router.push('/review'),
      urgency: dueCount > 5 ? 'high' : 'medium',
    });
  }

  // Priority 3: Continue next topic
  if (nextTopics.length > 0) {
    const topic = nextTopics[0];
    const topicName = isHi && topic.title_hi ? topic.title_hi : topic.title;
    items.push({
      icon: '📖',
      label: isHi ? `अगला: ${topicName}` : `Next: ${topicName}`,
      sublabel: isHi ? 'नया सीखो' : 'Learn something new',
      action: () => router.push(`/foxy?topic=${encodeURIComponent(topic.title)}&mode=learn`),
      urgency: 'low',
    });
  }

  // Priority 4: Take a quiz
  items.push({
    icon: '⚡',
    label: isHi ? 'आज का क्विज़ लो' : 'Take today\'s quiz',
    sublabel: isHi ? '10 सवाल, 10 मिनट' : '10 questions, 10 minutes',
    action: () => router.push(`/quiz?subject=${preferredSubject}`),
    urgency: 'low',
  });

  // Show max 4 items
  const plan = items.slice(0, 4);

  return (
    <div className="rounded-2xl p-4" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)' }}>
          {isHi ? '📋 आज का प्लान' : '📋 Today\'s Plan'}
        </h2>
        {streak > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(232,88,28,0.08)', color: 'var(--orange)' }}>
            🔥 {streak} {isHi ? 'दिन' : 'day streak'}
          </span>
        )}
      </div>
      <div className="space-y-2">
        {plan.map((item, i) => (
          <button
            key={i}
            onClick={item.action}
            className="w-full flex items-center gap-3 p-3 rounded-xl transition-all active:scale-[0.98]"
            style={{
              background: item.urgency === 'high'
                ? 'rgba(220,38,38,0.04)'
                : 'rgba(0,0,0,0.02)',
              border: `1px solid ${item.urgency === 'high' ? 'rgba(220,38,38,0.12)' : 'var(--border)'}`,
            }}
          >
            <span className="text-lg flex-shrink-0">{item.icon}</span>
            <div className="flex-1 min-w-0 text-left">
              <div className="text-sm font-semibold truncate">{item.label}</div>
              <div className="text-xs text-[var(--text-3)]">{item.sublabel}</div>
            </div>
            <span className="text-[var(--text-3)] text-lg">›</span>
          </button>
        ))}
      </div>
    </div>
  );
}
