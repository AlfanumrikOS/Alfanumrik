'use client';

import { useMemo } from 'react';

/* ═══════════════════════════════════════════════════════════════
   ConversationStarters — Smart topic-aware conversation prompts
   Shows contextual starter chips based on subject + mastery
   ═══════════════════════════════════════════════════════════════ */

interface StarterConfig {
  text: string;
  textHi: string;
  icon: string;
}

const UNIVERSAL_STARTERS: StarterConfig[] = [
  { text: 'What should I study today?', textHi: 'आज मुझे क्या पढ़ना चाहिए?', icon: '📚' },
  { text: 'Quick quiz', textHi: 'क्विक क्विज़', icon: '⚡' },
  { text: 'Explain last topic', textHi: 'पिछला टॉपिक समझाओ', icon: '🔄' },
  { text: 'Formula sheet', textHi: 'फॉर्मूला शीट', icon: '📋' },
  { text: 'My weak areas', textHi: 'मेरे कमज़ोर विषय', icon: '🎯' },
];

const SUBJECT_STARTERS: Record<string, StarterConfig[]> = {
  math: [
    { text: 'Solve step by step', textHi: 'स्टेप बाय स्टेप हल करो', icon: '📝' },
    { text: 'Visual explanation', textHi: 'चित्र से समझाओ', icon: '📐' },
    { text: 'Practice problems', textHi: 'अभ्यास प्रश्न दो', icon: '✏️' },
  ],
  science: [
    { text: 'Explain with an experiment', textHi: 'प्रयोग से समझाओ', icon: '🔬' },
    { text: 'Real-world example', textHi: 'असली उदाहरण दो', icon: '🌍' },
    { text: 'Diagram explanation', textHi: 'चित्र से समझाओ', icon: '🖼️' },
  ],
  physics: [
    { text: 'Derive the formula', textHi: 'सूत्र व्युत्पन्न करो', icon: '⚡' },
    { text: 'Numerical problem', textHi: 'संख्यात्मक प्रश्न', icon: '🔢' },
    { text: 'Explain with analogy', textHi: 'उदाहरण से समझाओ', icon: '💡' },
  ],
  chemistry: [
    { text: 'Balance this equation', textHi: 'समीकरण संतुलित करो', icon: '⚖️' },
    { text: 'Explain the reaction', textHi: 'अभिक्रिया समझाओ', icon: '🧪' },
    { text: 'Memory tricks', textHi: 'याद करने की ट्रिक', icon: '🧠' },
  ],
  biology: [
    { text: 'Explain the process', textHi: 'प्रक्रिया समझाओ', icon: '🧬' },
    { text: 'Compare and contrast', textHi: 'तुलना करो', icon: '⚖️' },
    { text: 'Diagram labels', textHi: 'चित्र के लेबल', icon: '🏷️' },
  ],
  english: [
    { text: 'Grammar check', textHi: 'व्याकरण जाँच', icon: '✅' },
    { text: 'Essay outline', textHi: 'निबंध की रूपरेखा', icon: '📝' },
    { text: 'Vocabulary builder', textHi: 'शब्दावली बनाओ', icon: '📖' },
  ],
  hindi: [
    { text: 'व्याकरण अभ्यास', textHi: 'व्याकरण अभ्यास', icon: '✏️' },
    { text: 'कविता का भावार्थ', textHi: 'कविता का भावार्थ', icon: '📜' },
    { text: 'पत्र लेखन', textHi: 'पत्र लेखन', icon: '✉️' },
  ],
  social_studies: [
    { text: 'Timeline of events', textHi: 'घटनाओं की समयरेखा', icon: '📅' },
    { text: 'Map-based question', textHi: 'मानचित्र प्रश्न', icon: '🗺️' },
    { text: 'Cause and effect', textHi: 'कारण और प्रभाव', icon: '🔗' },
  ],
  coding: [
    { text: 'Debug my code', textHi: 'मेरा कोड ठीक करो', icon: '🐛' },
    { text: 'Explain this concept', textHi: 'यह कॉन्सेप्ट समझाओ', icon: '💡' },
    { text: 'Write a program', textHi: 'प्रोग्राम लिखो', icon: '💻' },
  ],
};

interface ConversationStartersProps {
  subject: string;
  language: string;
  topicTitle?: string;
  onSelect: (text: string) => void;
}

export function ConversationStarters({ subject, language, topicTitle, onSelect }: ConversationStartersProps) {
  const starters = useMemo(() => {
    const subjectSpecific = SUBJECT_STARTERS[subject] || [];
    const all = [...UNIVERSAL_STARTERS, ...subjectSpecific];
    // If a topic is selected, add a topic-specific starter
    if (topicTitle) {
      all.unshift({
        text: `Teach me: ${topicTitle}`,
        textHi: `सिखाओ: ${topicTitle}`,
        icon: '🎓',
      });
    }
    return all.slice(0, 8); // Show max 8 chips
  }, [subject, topicTitle]);

  return (
    <div className="foxy-starters" role="group" aria-label="Conversation starters">
      {starters.map((s, i) => (
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
    </div>
  );
}
