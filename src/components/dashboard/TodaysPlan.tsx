'use client';

import { useRouter } from 'next/navigation';
import type { CmeAction } from '@/lib/types';

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
  cmeAction?: CmeAction | null;
}

/**
 * TodaysPlan — "What to do next" widget for the student dashboard.
 *
 * Shows 3-4 actionable items based on the student's current state:
 * 1. Fix a knowledge gap (highest priority — links to Foxy)
 * 2. Review due cards (if any — links to /review)
 * 3. Continue next topic (links to Foxy learn mode)
 * 4. Take a quiz (links to /foxy)
 *
 * This replaces the passive stats-only dashboard with an action-oriented
 * daily learning path that Indian students can follow like a tuition schedule.
 */
const CME_ACTION_CONFIG: Record<CmeAction['type'], {
  icon: string;
  label: (title: string, isHi: boolean) => string;
  sublabel: (isHi: boolean) => string;
  mode: string;
  urgency: 'high' | 'medium' | 'low';
}> = {
  remediate: {
    icon: '\u{1F534}',
    label: (t, hi) => hi ? `\u092A\u0942\u0930\u094D\u0935-\u0906\u0935\u0936\u094D\u092F\u0915\u0924\u093E \u0920\u0940\u0915 \u0915\u0930\u094B: ${t}` : `Fix prerequisite: ${t}`,
    sublabel: (hi) => hi ? '\u092F\u0939 \u0906\u0917\u0947 \u092C\u0922\u093C\u0928\u0947 \u0915\u0947 \u0932\u093F\u090F \u091C\u093C\u0930\u0942\u0930\u0940 \u0939\u0948' : 'Required before moving forward',
    mode: 'doubt',
    urgency: 'high',
  },
  revise: {
    icon: '\u{1F504}',
    label: (t, hi) => hi ? `\u092D\u0942\u0932\u0928\u0947 \u0938\u0947 \u092A\u0939\u0932\u0947 \u0926\u094B\u0939\u0930\u093E\u0913: ${t}` : `Revise before you forget: ${t}`,
    sublabel: (hi) => hi ? '\u092F\u093E\u0926 \u0915\u092E\u091C\u094B\u0930 \u0939\u094B \u0930\u0939\u0940 \u0939\u0948' : 'Memory fading \u2014 quick revision',
    mode: 'revise',
    urgency: 'high',
  },
  re_teach: {
    icon: '\u{1F4D6}',
    label: (t, hi) => hi ? `\u0926\u094B\u092C\u093E\u0930\u093E \u0938\u0940\u0916\u094B: ${t}` : `Re-learn: ${t}`,
    sublabel: (hi) => hi ? '\u0928\u090F \u0924\u0930\u0940\u0915\u0947 \u0938\u0947 \u0938\u092E\u091D\u094B' : 'Try a different approach',
    mode: 'learn',
    urgency: 'high',
  },
  teach: {
    icon: '\u{1F4D6}',
    label: (t, hi) => hi ? `\u0928\u092F\u093E \u0938\u0940\u0916\u094B: ${t}` : `Learn: ${t}`,
    sublabel: (hi) => hi ? '\u0928\u092F\u093E \u091F\u0949\u092A\u093F\u0915 \u0936\u0941\u0930\u0942 \u0915\u0930\u094B' : 'Start a new topic',
    mode: 'learn',
    urgency: 'medium',
  },
  practice: {
    icon: '\u270F\uFE0F',
    label: (t, hi) => hi ? `\u0905\u092D\u094D\u092F\u093E\u0938: ${t}` : `Practice: ${t}`,
    sublabel: (hi) => hi ? '\u0914\u0930 \u0905\u092D\u094D\u092F\u093E\u0938 \u0915\u0930\u094B' : 'Needs more practice',
    mode: 'practice',
    urgency: 'medium',
  },
  challenge: {
    icon: '\u2B50',
    label: (t, hi) => hi ? `\u0916\u0941\u0926 \u0915\u094B \u091A\u0941\u0928\u094C\u0924\u0940 \u0926\u094B: ${t}` : `Challenge yourself: ${t}`,
    sublabel: (hi) => hi ? '\u092E\u093E\u0938\u094D\u091F\u0930\u0940 \u0915\u0947 \u0915\u0930\u0940\u092C' : 'Almost mastered \u2014 push further',
    mode: 'practice',
    urgency: 'low',
  },
  exam_prep: {
    icon: '\u{1F4CB}',
    label: (_t, hi) => hi ? '\u092A\u0930\u0940\u0915\u094D\u0937\u093E \u0924\u0948\u092F\u093E\u0930\u0940 \u092E\u094B\u0921' : 'Exam prep mode',
    sublabel: (hi) => hi ? '\u0938\u092C \u0915\u0941\u091B \u0938\u0940\u0916 \u0932\u093F\u092F\u093E \u2014 \u0905\u092C \u092A\u0930\u0940\u0915\u094D\u0937\u093E \u0915\u0940 \u0924\u0948\u092F\u093E\u0930\u0940 \u0915\u0930\u094B' : 'All mastered \u2014 exam practice',
    mode: 'exam',
    urgency: 'low',
  },
};

export default function TodaysPlan({ isHi, dueCount, knowledgeGaps, nextTopics, preferredSubject, streak, cmeAction }: Props) {
  const router = useRouter();

  const items: { icon: string; label: string; sublabel: string; action: () => void; urgency: 'high' | 'medium' | 'low' }[] = [];

  // Priority 0: CME Engine recommendation (if available)
  if (cmeAction) {
    const config = CME_ACTION_CONFIG[cmeAction.type];
    if (config) {
      const href = cmeAction.type === 'exam_prep'
        ? `/exams`
        : `/foxy?topic=${encodeURIComponent(cmeAction.title)}&mode=${config.mode}`;
      items.push({
        icon: config.icon,
        label: config.label(cmeAction.title, isHi),
        sublabel: config.sublabel(isHi),
        action: () => router.push(href),
        urgency: config.urgency,
      });
    }
  }

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
    action: () => router.push('/foxy'),
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
