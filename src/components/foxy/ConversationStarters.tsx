'use client';

import { useMemo, useState } from 'react';

/* ─────────────────────────────────────────────────────────────
   ConversationStarters — Smart topic-aware conversation prompts
   Shows contextual starter chips based on subject + mastery
   ───────────────────────────────────────────────────────────── */

interface StarterConfig {
  text: string;
  textHi: string;
  icon: string;
}

const UNIVERSAL_STARTERS: StarterConfig[] = [
  { text: 'What should I study today?', textHi: '\u0906\u091C \u092E\u0941\u091D\u0947 \u0915\u094D\u092F\u093E \u092A\u0922\u093C\u0928\u093E \u091A\u093E\u0939\u093F\u090F?', icon: '\u{1F4DA}' },
  { text: 'Quick quiz', textHi: '\u0915\u094D\u0935\u093F\u0915 \u0915\u094D\u0935\u093F\u091C\u093C', icon: '\u26A1' },
  { text: 'Explain last topic', textHi: '\u092A\u093F\u091B\u0932\u093E \u091F\u0949\u092A\u093F\u0915 \u0938\u092E\u091D\u093E\u0913', icon: '\u{1F4D6}' },
  { text: 'Formula sheet', textHi: '\u092B\u0949\u0930\u094D\u092E\u0942\u0932\u093E \u0936\u0940\u091F', icon: '\u{1F4CB}' },
  { text: 'My weak areas', textHi: '\u092E\u0947\u0930\u0947 \u0915\u092E\u091C\u093C\u094B\u0930 \u0935\u093F\u0937\u092F', icon: '\u{1F3AF}' },
];

const SUBJECT_STARTERS: Record<string, StarterConfig[]> = {
  math: [
    { text: 'Solve step by step', textHi: '\u0938\u094D\u091F\u0947\u092A \u092C\u093E\u092F \u0938\u094D\u091F\u0947\u092A \u0939\u0932 \u0915\u0930\u094B', icon: '\u{1F9EE}' },
    { text: 'Visual explanation', textHi: '\u091A\u093F\u0924\u094D\u0930 \u0938\u0947 \u0938\u092E\u091D\u093E\u0913', icon: '\u{1F4CA}' },
    { text: 'Practice problems', textHi: '\u0905\u092D\u094D\u092F\u093E\u0938 \u092A\u094D\u0930\u0936\u094D\u0928 \u0926\u094B', icon: '\u270F\uFE0F' },
  ],
  science: [
    { text: 'Explain with an experiment', textHi: '\u092A\u094D\u0930\u092F\u094B\u0917 \u0938\u0947 \u0938\u092E\u091D\u093E\u0913', icon: '\u{1F52C}' },
    { text: 'Real-world example', textHi: '\u0905\u0938\u0932\u0940 \u0909\u0926\u093E\u0939\u0930\u0923 \u0926\u094B', icon: '\u{1F30D}' },
    { text: 'Diagram explanation', textHi: '\u091A\u093F\u0924\u094D\u0930 \u0938\u0947 \u0938\u092E\u091D\u093E\u0913', icon: '\u{1F5BC}\uFE0F' },
  ],
  physics: [
    { text: 'Derive the formula', textHi: '\u0938\u0942\u0924\u094D\u0930 \u0935\u094D\u092F\u0941\u0924\u094D\u092A\u0928\u094D\u0928 \u0915\u0930\u094B', icon: '\u26A1' },
    { text: 'Numerical problem', textHi: '\u0938\u0902\u0916\u094D\u092F\u093E\u0924\u094D\u092E\u0915 \u092A\u094D\u0930\u0936\u094D\u0928', icon: '\u{1F522}' },
    { text: 'Explain with analogy', textHi: '\u0909\u0926\u093E\u0939\u0930\u0923 \u0938\u0947 \u0938\u092E\u091D\u093E\u0913', icon: '\u{1F4A1}' },
  ],
  chemistry: [
    { text: 'Balance this equation', textHi: '\u0938\u092E\u0940\u0915\u0930\u0923 \u0938\u0902\u0924\u0941\u0932\u093F\u0924 \u0915\u0930\u094B', icon: '\u2696\uFE0F' },
    { text: 'Explain the reaction', textHi: '\u0905\u092D\u093F\u0915\u094D\u0930\u093F\u092F\u093E \u0938\u092E\u091D\u093E\u0913', icon: '\u{1F9EA}' },
    { text: 'Memory tricks', textHi: '\u092F\u093E\u0926 \u0915\u0930\u0928\u0947 \u0915\u0940 \u091F\u094D\u0930\u093F\u0915', icon: '\u{1F9E0}' },
  ],
  biology: [
    { text: 'Explain the process', textHi: '\u092A\u094D\u0930\u0915\u094D\u0930\u093F\u092F\u093E \u0938\u092E\u091D\u093E\u0913', icon: '\u{1F9EC}' },
    { text: 'Compare and contrast', textHi: '\u0924\u0941\u0932\u0928\u093E \u0915\u0930\u094B', icon: '\u2696\uFE0F' },
    { text: 'Diagram labels', textHi: '\u091A\u093F\u0924\u094D\u0930 \u0915\u0947 \u0932\u0947\u092C\u0932', icon: '\u{1F3F7}\uFE0F' },
  ],
  english: [
    { text: 'Grammar check', textHi: '\u0935\u094D\u092F\u093E\u0915\u0930\u0923 \u091C\u093E\u0901\u091A\u094B', icon: '\u2714\uFE0F' },
    { text: 'Essay outline', textHi: '\u0928\u093F\u092C\u0902\u0927 \u0915\u0940 \u0930\u0942\u092A\u0930\u0947\u0916\u093E', icon: '\u{1F4DD}' },
    { text: 'Vocabulary builder', textHi: '\u0936\u092C\u094D\u0926\u093E\u0935\u0932\u0940 \u092C\u0928\u093E\u0913', icon: '\u{1F4DA}' },
  ],
  hindi: [
    { text: '\u0935\u094D\u092F\u093E\u0915\u0930\u0923 \u0905\u092D\u094D\u092F\u093E\u0938', textHi: '\u0935\u094D\u092F\u093E\u0915\u0930\u0923 \u0905\u092D\u094D\u092F\u093E\u0938', icon: '\u270F\uFE0F' },
    { text: '\u0915\u0935\u093F\u0924\u093E \u0915\u093E \u092D\u093E\u0935\u093E\u0930\u094D\u0925', textHi: '\u0915\u0935\u093F\u0924\u093E \u0915\u093E \u092D\u093E\u0935\u093E\u0930\u094D\u0925', icon: '\u{1F4D6}' },
    { text: '\u092A\u0924\u094D\u0930 \u0932\u0947\u0916\u0928', textHi: '\u092A\u0924\u094D\u0930 \u0932\u0947\u0916\u0928', icon: '\u270F\uFE0F' },
  ],
  social_studies: [
    { text: 'Timeline of events', textHi: '\u0918\u091F\u0928\u093E\u0913\u0902 \u0915\u0940 \u0938\u092E\u092F\u0930\u0947\u0916\u093E', icon: '\u{1F4C5}' },
    { text: 'Map-based question', textHi: '\u092E\u093E\u0928\u091A\u093F\u0924\u094D\u0930 \u092A\u094D\u0930\u0936\u094D\u0928', icon: '\u{1F5FA}\uFE0F' },
    { text: 'Cause and effect', textHi: '\u0915\u093E\u0930\u0923 \u0914\u0930 \u092A\u094D\u0930\u092D\u093E\u0935', icon: '\u{1F517}' },
  ],
  coding: [
    { text: 'Debug my code', textHi: '\u092E\u0947\u0930\u093E \u0915\u094B\u0921 \u0920\u0940\u0915 \u0915\u0930\u094B', icon: '\u{1F41B}' },
    { text: 'Explain this concept', textHi: '\u092F\u0939 \u0915\u0949\u0928\u094D\u0938\u0947\u092A\u094D\u091F \u0938\u092E\u091D\u093E\u0913', icon: '\u{1F4A1}' },
    { text: 'Write a program', textHi: '\u092A\u094D\u0930\u094B\u0917\u094D\u0930\u093E\u092E \u0932\u093F\u0916\u094B', icon: '\u{1F4BB}' },
  ],
};

interface ConversationStartersProps {
  subject: string;
  language: string;
  topicTitle?: string;
  onSelect: (text: string) => void;
}

/** Hick's Law: show only 3 primary starters to reduce decision time.
 *  Additional starters are behind a "More" toggle for progressive disclosure. */
const PRIMARY_COUNT = 3;

export function ConversationStarters({ subject, language, topicTitle, onSelect }: ConversationStartersProps) {
  const [showMore, setShowMore] = useState(false);

  const starters = useMemo(() => {
    const subjectSpecific = SUBJECT_STARTERS[subject] || [];
    const all = [...UNIVERSAL_STARTERS, ...subjectSpecific];
    // If a topic is selected, add a topic-specific starter at the top
    if (topicTitle) {
      all.unshift({
        text: `Teach me: ${topicTitle}`,
        textHi: `\u0938\u093F\u0916\u093E\u0913: ${topicTitle}`,
        icon: '\u{1F4D6}',
      });
    }
    return all.slice(0, 8);
  }, [subject, topicTitle]);

  const visible = showMore ? starters : starters.slice(0, PRIMARY_COUNT);
  const hasMore = starters.length > PRIMARY_COUNT;

  return (
    <div className="foxy-starters" role="group" aria-label="Conversation starters">
      {visible.map((s, i) => (
        <button
          key={i}
          onClick={() => onSelect(language === 'hi' ? s.textHi : s.text)}
          className="foxy-starter-chip animate-slide-up"
          style={{ animationDelay: `${i * 60}ms` }}
          aria-label={language === 'hi' ? s.textHi : s.text}
        >
          <span className="mr-1" aria-hidden="true">{s.icon}</span>
          {language === 'hi' ? s.textHi : s.text}
        </button>
      ))}
      {hasMore && (
        <button
          onClick={() => setShowMore((v) => !v)}
          className="foxy-starter-chip animate-slide-up foxy-starter-more"
          style={{ animationDelay: `${visible.length * 60}ms` }}
          aria-expanded={showMore}
          aria-label={showMore ? 'Show fewer suggestions' : 'Show more suggestions'}
        >
          {showMore
            ? (language === 'hi' ? '\u0915\u092E \u0926\u093F\u0916\u093E\u0913 \u25B2' : 'Less \u25B2')
            : (language === 'hi' ? '\u0914\u0930 \u0938\u0941\u091D\u093E\u0935 \u25BC' : 'More \u25BC')}
        </button>
      )}
    </div>
  );
}
