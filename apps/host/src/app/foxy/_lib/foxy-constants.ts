/**
 * Foxy page-local constants.
 *
 * Extracted (verbatim) from `src/app/foxy/page.tsx` so the page module can
 * shed declarations without behavior change. Imported back into page.tsx
 * via `import { ... } from './_lib/foxy-constants'`.
 *
 * `FALLBACK_SCIENCE` references `SubjectConfig`, which lives in
 * `./foxy-types` (also extracted in this task).
 */

import type { SubjectConfig } from './foxy-types';

// Fallback used only when the subjects service hook hasn't returned yet (first paint)
export const FALLBACK_SCIENCE: SubjectConfig = { name: 'Science', icon: '⚛', color: '#10B981' };

export const LANGS = [
  { code: 'en', label: 'EN' },
  { code: 'hi', label: 'HI' },
  { code: 'hinglish', label: 'Hing' },
];

export const MODES = [
  { id: 'learn', emoji: '📖', label: 'Learn', labelHi: 'सीखो', autoPrompt: (topic: string) => topic ? `Teach me about: ${topic}` : 'Teach me the next concept step by step', autoPromptHi: (topic: string) => topic ? `मुझे सिखाओ: ${topic}` : 'मुझे अगला कॉन्सेप्ट सिखाओ' },
  { id: 'practice', emoji: '✏️', label: 'Practice', labelHi: 'अभ्यास', autoPrompt: (topic: string) => topic ? `Give me 3 practice problems on: ${topic}` : 'Give me practice problems to solve', autoPromptHi: (topic: string) => topic ? `मुझे 3 अभ्यास प्रश्न दो: ${topic}` : 'मुझे अभ्यास प्रश्न दो' },
  { id: 'quiz', emoji: '⚡', label: 'Quiz', labelHi: 'क्विज़', autoPrompt: (topic: string) => topic ? `Quiz me on: ${topic} (5 MCQ questions, board exam pattern)` : 'Quiz me with 5 MCQ questions on this chapter', autoPromptHi: (topic: string) => topic ? `मुझसे क्विज़ लो: ${topic} (5 MCQ प्रश्न, बोर्ड परीक्षा पैटर्न)` : 'मुझसे 5 MCQ प्रश्न पूछो' },
  { id: 'doubt', emoji: '❓', label: 'Doubt', labelHi: 'डाउट', autoPrompt: () => '', autoPromptHi: () => '' },
  { id: 'revision', emoji: '🔄', label: 'Revise', labelHi: 'रिवीज़', autoPrompt: (topic: string) => topic ? `Give me a quick revision summary of: ${topic}` : 'Summarize the key points for revision', autoPromptHi: (topic: string) => topic ? `${topic} का त्वरित पुनरावृत्ति सारांश दो` : 'रिवीज़न के लिए मुख्य बिंदु बताओ' },
  { id: 'notes', emoji: '📝', label: 'Notes', labelHi: 'नोट्स', autoPrompt: (topic: string) => topic ? `Create concise exam notes for: ${topic}` : 'Create exam-ready notes for this chapter', autoPromptHi: (topic: string) => topic ? `${topic} के लिए परीक्षा नोट्स बनाओ` : 'इस अध्याय के परीक्षा नोट्स बनाओ' },
  { id: 'lesson', emoji: '🎓', label: 'Lesson', labelHi: 'पाठ', autoPrompt: () => '', autoPromptHi: () => '' },
];

export const FOXY_FACES: Record<string, string> = { idle: '🦊', thinking: '🤔', happy: '😄' };

/**
 * MASTERY_COLORS — Foxy chapter-mastery band colours.
 *
 * Consumed as JS hex VALUES inside inline `style={{ ... }}` (page.tsx chapter
 * dropdown), NOT as CSS classes, so we keep them as plain hex strings. The
 * 5-band structure is unchanged; the values are re-aligned (Alfa Momentum
 * Wave 3) to the platform's semantic palette so a chapter's mastery pill in
 * Foxy reads consistently with the dashboard mastery bands and the design
 * tokens in globals.css. Mapping (hex chosen to MATCH the token it mirrors):
 *   not_started  → neutral tertiary text  (--text-3  #7D7264)
 *   beginner     → warning / saffron      (--gold    #F5A623)
 *   developing   → info / teal            (--teal    #0891B2)
 *   proficient   → purple accent          (--purple  #7C3AED)
 *   mastered     → success / green        (--green   #16A34A)
 */
export const MASTERY_COLORS: Record<string, string> = {
  not_started: '#7D7264', beginner: '#F5A623', developing: '#0891B2', proficient: '#7C3AED', mastered: '#16A34A',
};

export const REPORT_REASONS = [
  { value: 'wrong_answer', label: '❌ Wrong answer', labelHi: '❌ गलत उत्तर' },
  { value: 'wrong_formula', label: '📐 Wrong formula', labelHi: '📐 गलत फॉर्मूला' },
  { value: 'wrong_explanation', label: '📝 Wrong explanation', labelHi: '📝 गलत व्याख्या' },
  { value: 'incomplete', label: '⚠️ Incomplete', labelHi: '⚠️ अधूरा' },
  { value: 'irrelevant', label: '🔀 Off-topic', labelHi: '🔀 विषय से हटकर' },
  { value: 'confusing', label: '😕 Confusing', labelHi: '😕 भ्रमित करने वाला' },
  { value: 'other', label: '💬 Other', labelHi: '💬 अन्य' },
];
