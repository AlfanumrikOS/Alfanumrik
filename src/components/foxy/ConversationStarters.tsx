'use client';

import { useMemo, useState } from 'react';

/* âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
   ConversationStarters â Smart topic-aware conversation prompts
   Shows contextual starter chips based on subject + mastery
   âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ */

interface StarterConfig {
  text: string;
  textHi: string;
  icon: string;
}

const UNIVERSAL_STARTERS: StarterConfig[] = [
  { text: 'What should I study today?', textHi: 'à¤à¤ à¤®à¥à¤à¥ à¤à¥à¤¯à¤¾ à¤ªà¤¢à¤¼à¤¨à¤¾ à¤à¤¾à¤¹à¤¿à¤?', icon: 'ð' },
  { text: 'Quick quiz', textHi: 'à¤à¥à¤µà¤¿à¤ à¤à¥à¤µà¤¿à¤à¤¼', icon: 'â¡' },
  { text: 'Explain last topic', textHi: 'à¤ªà¤¿à¤à¤²à¤¾ à¤à¥à¤ªà¤¿à¤ à¤¸à¤®à¤à¤¾à¤', icon: 'ð' },
  { text: 'Formula sheet', textHi: 'à¤«à¥à¤°à¥à¤®à¥à¤²à¤¾ à¤¶à¥à¤', icon: 'ð' },
  { text: 'My weak areas', textHi: 'à¤®à¥à¤°à¥ à¤à¤®à¤à¤¼à¥à¤° à¤µà¤¿à¤·à¤¯', icon: 'ð¯' },
];

const SUBJECT_STARTERS: Record<string, StarterConfig[]> = {
  math: [
    { text: 'Solve step by step', textHi: 'à¤¸à¥à¤à¥à¤ª à¤¬à¤¾à¤¯ à¤¸à¥à¤à¥à¤ª à¤¹à¤² à¤à¤°à¥', icon: 'ð' },
    { text: 'Visual explanation', textHi: 'à¤à¤¿à¤¤à¥à¤° à¤¸à¥ à¤¸à¤®à¤à¤¾à¤', icon: 'ð' },
    { text: 'Practice problems', textHi: 'à¤à¤­à¥à¤¯à¤¾à¤¸ à¤ªà¥à¤°à¤¶à¥à¤¨ à¤¦à¥', icon: 'âï¸' },
  ],
  science: [
    { text: 'Explain with an experiment', textHi: 'à¤ªà¥à¤°à¤¯à¥à¤ à¤¸à¥ à¤¸à¤®à¤à¤¾à¤', icon: 'ð¬' },
    { text: 'Real-world example', textHi: 'à¤à¤¸à¤²à¥ à¤à¤¦à¤¾à¤¹à¤°à¤£ à¤¦à¥', icon: 'ð' },
    { text: 'Diagram explanation', textHi: 'à¤à¤¿à¤¤à¥à¤° à¤¸à¥ à¤¸à¤®à¤à¤¾à¤', icon: 'ð¼ï¸' },
  ],
  physics: [
    { text: 'Derive the formula', textHi: 'à¤¸à¥à¤¤à¥à¤° à¤µà¥à¤¯à¥à¤¤à¥à¤ªà¤¨à¥à¤¨ à¤à¤°à¥', icon: 'â¡' },
    { text: 'Numerical problem', textHi: 'à¤¸à¤à¤à¥à¤¯à¤¾à¤¤à¥à¤®à¤ à¤ªà¥à¤°à¤¶à¥à¤¨', icon: 'ð¢' },
    { text: 'Explain with analogy', textHi: 'à¤à¤¦à¤¾à¤¹à¤°à¤£ à¤¸à¥ à¤¸à¤®à¤à¤¾à¤', icon: 'ð¡' },
  ],
  chemistry: [
    { text: 'Balance this equation', textHi: 'à¤¸à¤®à¥à¤à¤°à¤£ à¤¸à¤à¤¤à¥à¤²à¤¿à¤¤ à¤à¤°à¥', icon: 'âï¸' },
    { text: 'Explain the reaction', textHi: 'à¤à¤­à¤¿à¤à¥à¤°à¤¿à¤¯à¤¾ à¤¸à¤®à¤à¤¾à¤', icon: 'ð§ª' },
    { text: 'Memory tricks', textHi: 'à¤¯à¤¾à¤¦ à¤à¤°à¤¨à¥ à¤à¥ à¤à¥à¤°à¤¿à¤', icon: 'ð§ ' },
  ],
  biology: [
    { text: 'Explain the process', textHi: 'à¤ªà¥à¤°à¤à¥à¤°à¤¿à¤¯à¤¾ à¤¸à¤®à¤à¤¾à¤', icon: 'ð§¬' },
    { text: 'Compare and contrast', textHi: 'à¤¤à¥à¤²à¤¨à¤¾ à¤à¤°à¥', icon: 'âï¸' },
    { text: 'Diagram labels', textHi: 'à¤à¤¿à¤¤à¥à¤° à¤à¥ à¤²à¥à¤¬à¤²', icon: 'ð·ï¸' },
  ],
  english: [
    { text: 'Grammar check', textHi: 'à¤µà¥à¤¯à¤¾à¤à¤°à¤£ à¤à¤¾à¤à¤', icon: 'â' },
    { text: 'Essay outline', textHi: 'à¤¨à¤¿à¤¬à¤à¤§ à¤à¥ à¤°à¥à¤ªà¤°à¥à¤à¤¾', icon: 'ð' },
    { text: 'Vocabulary builder', textHi: 'à¤¶à¤¬à¥à¤¦à¤¾à¤µà¤²à¥ à¤¬à¤¨à¤¾à¤', icon: 'ð' },
  ],
  hindi: [
    { text: 'à¤µà¥à¤¯à¤¾à¤à¤°à¤£ à¤à¤­à¥à¤¯à¤¾à¤¸', textHi: 'à¤µà¥à¤¯à¤¾à¤à¤°à¤£ à¤à¤­à¥à¤¯à¤¾à¤¸', icon: 'âï¸' },
    { text: 'à¤à¤µà¤¿à¤¤à¤¾ à¤à¤¾ à¤­à¤¾à¤µà¤¾à¤°à¥à¤¥', textHi: 'à¤à¤µà¤¿à¤¤à¤¾ à¤à¤¾ à¤­à¤¾à¤µà¤¾à¤°à¥à¤¥', icon: 'ð' },
    { text: 'à¤ªà¤¤à¥à¤° à¤²à¥à¤à¤¨', textHi: 'à¤ªà¤¤à¥à¤° à¤²à¥à¤à¤¨', icon: 'âï¸' },
  ],
  social_studies: [
    { text: 'Timeline of events', textHi: 'à¤à¤à¤¨à¤¾à¤à¤ à¤à¥ à¤¸à¤®à¤¯à¤°à¥à¤à¤¾', icon: 'ð' },
    { text: 'Map-based question', textHi: 'à¤®à¤¾à¤¨à¤à¤¿à¤¤à¥à¤° à¤ªà¥à¤°à¤¶à¥à¤¨', icon: 'ðºï¸' },
    { text: 'Cause and effect', textHi: 'à¤à¤¾à¤°à¤£ à¤à¤° à¤ªà¥à¤°à¤­à¤¾à¤µ', icon: 'ð' },
  ],
  coding: [
    { text: 'Debug my code', textHi: 'à¤®à¥à¤°à¤¾ à¤à¥à¤¡ à¤ à¥à¤ à¤à¤°à¥', icon: 'ð' },
    { text: 'Explain this concept', textHi: 'à¤¯à¤¹ à¤à¥à¤¨à¥à¤¸à¥à¤ªà¥à¤ à¤¸à¤®à¤à¤¾à¤', icon: 'ð¡' },
    { text: 'Write a program', textHi: 'à¤ªà¥à¤°à¥à¤à¥à¤°à¤¾à¤® à¤²à¤¿à¤à¥', icon: 'ð»' },
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
        textHi: `à¤¸à¤¿à¤à¤¾à¤: ${topicTitle}`,
        icon: 'ð',
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
            ? (language === 'hi' ? 'à¤à¤® à¤¦à¤¿à¤à¤¾à¤ â²' : 'Less â²')
            : (language === 'hi' ? 'à¤à¤° à¤¸à¥à¤à¤¾à¤µ â¼' : 'More â¼')}
        </button>
      )}
    </div>
  );
}
