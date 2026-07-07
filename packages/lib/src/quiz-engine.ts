/**
 * ALFANUMRIK — Quiz Engine v2
 * Pure-function library for quiz selection, chapter completion, exam generation.
 * No database calls — this is logic only.
 */

import type { BloomLevel } from './cognitive-engine';

// ─── Types ──────────────────────────────────────────────────

export type QuestionTypeV2 = 'mcq' | 'assertion_reason' | 'case_based' | 'short_answer' | 'long_answer';
export type DifficultyMode = 'easy' | 'medium' | 'hard' | 'mixed' | 'progressive';
export type QuizSize = 5 | 10 | 15 | 20;

export const VALID_QUIZ_SIZES: QuizSize[] = [5, 10, 15, 20];

export interface QuizQuestion {
  id: string;
  question_text: string;
  question_hi: string | null;
  question_type: string;
  question_type_v2: QuestionTypeV2;
  options: string[];
  correct_answer_index: number;
  explanation: string | null;
  explanation_hi: string | null;
  hint: string | null;
  difficulty: number;
  bloom_level: string;
  chapter_number: number;
  chapter_title: string | null;
  concept_tag: string | null;
  case_passage: string | null;
  case_passage_hi: string | null;
  expected_answer: string | null;
  expected_answer_hi: string | null;
  max_marks: number;
  is_ncert: boolean;
  ncert_exercise: string | null;
}

export interface QuizConfig {
  subject: string;
  grade: string;
  chapterNumber: number | null;
  questionCount: QuizSize;
  difficultyMode: DifficultyMode;
  questionTypes: QuestionTypeV2[];
  mode: 'practice' | 'cognitive' | 'exam';
}

export interface ChapterProgressData {
  chapterId: string;
  chapterNumber: number;
  title: string;
  titleHi: string | null;
  questionsAttempted: number;
  questionsCorrect: number;
  uniqueQuestionsSeen: number;
  totalQuestionsInChapter: number;
  poolCoveragePercent: number;
  accuracyPercent: number;
  conceptsAttempted: number;
  conceptsMastered: number;
  totalConcepts: number;
  isCompleted: boolean;
  testModeUnlocked: boolean;
  lastActivityAt: string | null;
}

export interface ExamSectionDef {
  name: string;
  nameHi: string;
  questionType: QuestionTypeV2;
  marksPerQuestion: number;
  totalQuestions: number;
  attemptQuestions: number;
  instructions: string;
  instructionsHi: string;
}

export interface ExamPaperConfig {
  templateName: string;
  templateNameHi: string;
  grade: string;
  subject: string;
  totalMarks: number;
  durationMinutes: number;
  sections: ExamSectionDef[];
}

export interface ConceptSlot {
  tag: string;
  mastery: number;
  available: number;
}

export interface QuestionHistoryStats {
  totalPool: number;
  questionsSeen: number;
  coveragePercent: number;
  willResetAt: number;
  questionsUntilReset: number;
  shouldReset: boolean;
}

// ─── Constants ──────────────────────────────────────────────

export const CHAPTER_COMPLETION = {
  MIN_POOL_COVERAGE: 80,
  MIN_ACCURACY: 60,
  MIN_CONCEPT_COVERAGE: 70,
} as const;

export const TEST_MODE_UNLOCK = {
  CHAPTER_COMPLETED: true,
  MIN_CONCEPT_MASTERY_PERCENT: 70,
} as const;

export const NON_REPETITION = {
  RESET_THRESHOLD: 0.80,
  FALLBACK_TO_LEAST_RECENT: true,
} as const;

export const PROGRESSIVE_DIFFICULTY = {
  EASY_PERCENT: 30,
  MEDIUM_PERCENT: 40,
  HARD_PERCENT: 30,
} as const;

export const CONCEPT_BALANCE = {
  WEAK_WEIGHT: 1.0,
  MEDIUM_WEIGHT: 0.6,
  STRONG_WEIGHT: 0.3,
  WEAK_THRESHOLD: 0.3,
  STRONG_THRESHOLD: 0.7,
  MIN_SLOT_PER_CONCEPT: 1,
} as const;

export const QUESTION_TYPE_LABELS: Record<QuestionTypeV2, { en: string; hi: string; icon: string; description: string; descriptionHi: string }> = {
  mcq: { en: 'MCQ', hi: 'बहुविकल्पीय', icon: '🔘', description: 'Choose one correct option', descriptionHi: 'एक सही विकल्प चुनें' },
  assertion_reason: { en: 'Assertion-Reason', hi: 'अभिकथन-कारण', icon: '⚖️', description: 'Evaluate two statements', descriptionHi: 'दो कथनों का मूल्यांकन करें' },
  case_based: { en: 'Case Study', hi: 'केस स्टडी', icon: '📋', description: 'Read passage and answer', descriptionHi: 'गद्यांश पढ़ें और उत्तर दें' },
  short_answer: { en: 'Short Answer', hi: 'लघु उत्तर', icon: '✏️', description: 'Answer in 2-3 sentences', descriptionHi: '2-3 वाक्यों में उत्तर दें' },
  long_answer: { en: 'Long Answer', hi: 'दीर्घ उत्तर', icon: '📝', description: 'Detailed answer with explanation', descriptionHi: 'व्याख्या सहित विस्तृत उत्तर' },
};

// ─── Functions ──────────────────────────────────────────────

/** Fisher-Yates shuffle — returns new array */
export function shuffleArray<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Calculate difficulty assignment for each question slot */
export function calculateDifficultySlots(count: number, mode: DifficultyMode): number[] {
  if (count <= 0) return [];
  switch (mode) {
    case 'easy': return Array(count).fill(1);
    case 'medium': return Array(count).fill(2);
    case 'hard': return Array(count).fill(3);
    case 'progressive': {
      const easyCount = Math.round(count * PROGRESSIVE_DIFFICULTY.EASY_PERCENT / 100);
      const medCount = Math.round(count * PROGRESSIVE_DIFFICULTY.MEDIUM_PERCENT / 100);
      const hardCount = count - easyCount - medCount;
      return [
        ...Array(easyCount).fill(1),
        ...Array(medCount).fill(2),
        ...Array(Math.max(0, hardCount)).fill(3),
      ];
    }
    case 'mixed':
    default: {
      const slots: number[] = [];
      for (let i = 0; i < count; i++) {
        slots.push((i % 3) + 1); // 1,2,3,1,2,3,...
      }
      return slots;
    }
  }
}

/** Get concept weight based on mastery — lower mastery = higher weight */
export function getConceptWeight(mastery: number): number {
  if (mastery < CONCEPT_BALANCE.WEAK_THRESHOLD) return CONCEPT_BALANCE.WEAK_WEIGHT;
  if (mastery > CONCEPT_BALANCE.STRONG_THRESHOLD) return CONCEPT_BALANCE.STRONG_WEIGHT;
  return CONCEPT_BALANCE.MEDIUM_WEIGHT;
}

/** Distribute question slots across concepts, weighted by weakness */
export function calculateConceptSlots(
  concepts: ConceptSlot[],
  totalSlots: number,
): Map<string, number> {
  const result = new Map<string, number>();
  if (concepts.length === 0 || totalSlots <= 0) return result;

  // Calculate weights
  const weighted = concepts
    .filter(c => c.available > 0)
    .map(c => ({ ...c, weight: getConceptWeight(c.mastery) }));

  if (weighted.length === 0) return result;

  const totalWeight = weighted.reduce((sum, c) => sum + c.weight, 0);

  // Allocate slots proportionally
  let remaining = totalSlots;
  for (const c of weighted) {
    const raw = (c.weight / totalWeight) * totalSlots;
    const allocated = Math.max(
      CONCEPT_BALANCE.MIN_SLOT_PER_CONCEPT,
      Math.round(raw),
    );
    const capped = Math.min(allocated, c.available, remaining);
    result.set(c.tag, capped);
    remaining -= capped;
  }

  // Distribute remaining slots to weakest concepts with available capacity
  if (remaining > 0) {
    const sorted = [...weighted].sort((a, b) => a.mastery - b.mastery);
    for (const c of sorted) {
      if (remaining <= 0) break;
      const current = result.get(c.tag) || 0;
      const canAdd = Math.min(remaining, c.available - current);
      if (canAdd > 0) {
        result.set(c.tag, current + canAdd);
        remaining -= canAdd;
      }
    }
  }

  // If we over-allocated, trim from strongest
  let total = 0;
  result.forEach(v => { total += v; });
  if (total > totalSlots) {
    const sorted = [...weighted].sort((a, b) => b.mastery - a.mastery);
    let excess = total - totalSlots;
    for (const c of sorted) {
      if (excess <= 0) break;
      const current = result.get(c.tag) || 0;
      const canRemove = Math.min(excess, current - CONCEPT_BALANCE.MIN_SLOT_PER_CONCEPT);
      if (canRemove > 0) {
        result.set(c.tag, current - canRemove);
        excess -= canRemove;
      }
    }
  }

  return result;
}

/** Check if a chapter is completed based on 3 rules */
export function isChapterCompleted(progress: ChapterProgressData): boolean {
  const poolOk = progress.poolCoveragePercent >= CHAPTER_COMPLETION.MIN_POOL_COVERAGE;
  const accuracyOk = progress.accuracyPercent >= CHAPTER_COMPLETION.MIN_ACCURACY;
  const conceptCoverage = progress.totalConcepts > 0
    ? (progress.conceptsAttempted / progress.totalConcepts) * 100
    : 100; // if no concepts defined, consider coverage met
  const conceptsOk = conceptCoverage >= CHAPTER_COMPLETION.MIN_CONCEPT_COVERAGE;
  return poolOk && accuracyOk && conceptsOk;
}

/** Check if test mode should be unlocked */
export function isTestModeUnlocked(progress: ChapterProgressData): boolean {
  if (isChapterCompleted(progress)) return true;
  const masteryPct = progress.totalConcepts > 0
    ? (progress.conceptsMastered / progress.totalConcepts) * 100
    : 0;
  return masteryPct >= TEST_MODE_UNLOCK.MIN_CONCEPT_MASTERY_PERCENT;
}

/** Calculate pool coverage and whether history should reset */
export function calculatePoolCoverage(seen: number, total: number): { percent: number; shouldReset: boolean } {
  const percent = total > 0 ? Math.round((seen / total) * 100) : 0;
  const shouldReset = total > 0 && (seen / total) >= NON_REPETITION.RESET_THRESHOLD;
  return { percent, shouldReset };
}

/** Get human-readable question history stats */
export function getQuestionHistoryStats(seen: number, total: number): QuestionHistoryStats {
  const willResetAt = Math.ceil(total * NON_REPETITION.RESET_THRESHOLD);
  return {
    totalPool: total,
    questionsSeen: seen,
    coveragePercent: total > 0 ? Math.round((seen / total) * 100) : 0,
    willResetAt,
    questionsUntilReset: Math.max(0, willResetAt - seen),
    shouldReset: total > 0 && seen >= willResetAt,
  };
}

/** Safely parse question options from DB */
export function parseQuestionOptions(options: unknown): string[] {
  if (Array.isArray(options)) {
    return options.map(o => String(o || '')).filter(o => o.length > 0);
  }
  if (typeof options === 'string') {
    try {
      const parsed = JSON.parse(options);
      if (Array.isArray(parsed)) {
        return parsed.map((o: unknown) => String(o || '')).filter(o => o.length > 0);
      }
    } catch { /* not valid JSON */ }
  }
  return [];
}

/** P6-compliant question validation, extended for all question types */
export function validateQuestionForQuiz(q: Partial<QuizQuestion>): boolean {
  // Must have question text
  if (!q.question_text || typeof q.question_text !== 'string') return false;
  if (q.question_text.length < 15) return false;
  if (q.question_text.includes('{{') || q.question_text.includes('[BLANK]')) return false;

  // Reject template/garbage patterns
  const text = q.question_text.toLowerCase();
  if (text.includes('unrelated topic')) return false;
  if (text.startsWith('a student studying') && text.includes('should focus on')) return false;
  if (text.startsWith('which of the following best describes the main topic')) return false;
  if (text.startsWith('why is') && text.includes('important for grade')) return false;
  if (text.startsWith('the chapter') && text.includes('most closely related to which area')) return false;
  if (text.startsWith('what is the primary purpose of studying')) return false;

  const type = q.question_type_v2 || 'mcq';

  // MCQ, assertion-reason, case-based: need 4 options
  if (type === 'mcq' || type === 'assertion_reason' || type === 'case_based') {
    const opts = q.options || [];
    if (opts.length !== 4) return false;
    if (q.correct_answer_index == null || q.correct_answer_index < 0 || q.correct_answer_index > 3) return false;
    const optTexts = opts.map(o => (o || '').toLowerCase().trim());
    if (new Set(optTexts).size < 3) return false;
    // Reject garbage options
    if (optTexts.some(o =>
      o.includes('unrelated topic') || o.includes('physical education') ||
      o.includes('art and craft') || o.includes('music theory') ||
      o.includes('it is not important') || o.includes('no board exam')
    )) return false;
  }

  // Case-based must have passage
  if (type === 'case_based') {
    if (!q.case_passage || q.case_passage.length < 20) return false;
  }

  // Short/long answer must have expected answer
  if (type === 'short_answer' || type === 'long_answer') {
    if (!q.expected_answer || q.expected_answer.length < 10) return false;
  }

  // Explanation quality
  if (!q.explanation || q.explanation.length < 20) return false;
  const expl = q.explanation.toLowerCase();
  if (expl.includes('does not match any option') ||
      expl.includes('suggesting a possible error') ||
      expl.includes('assuming a typo') ||
      expl.includes('not listed') ||
      expl.includes('however, the correct') ||
      expl.includes('none of the options') ||
      expl.includes('there seems to be') ||
      expl.includes('closest plausible')) return false;

  return true;
}

/** Get default CBSE exam template by grade */
export function getDefaultExamTemplate(grade: string): ExamPaperConfig {
  const g = parseInt(grade) || 9;

  if (g <= 8) {
    return {
      templateName: `CBSE Standard - Class ${grade}`,
      templateNameHi: `सीबीएसई मानक - कक्षा ${grade}`,
      grade,
      subject: '',
      totalMarks: 50,
      durationMinutes: 120,
      sections: [
        { name: 'Section A', nameHi: 'खंड अ', questionType: 'mcq', marksPerQuestion: 1, totalQuestions: 15, attemptQuestions: 15, instructions: 'Answer all questions', instructionsHi: 'सभी प्रश्नों के उत्तर दें' },
        { name: 'Section B', nameHi: 'खंड ब', questionType: 'short_answer', marksPerQuestion: 2, totalQuestions: 10, attemptQuestions: 10, instructions: 'Answer in 2-3 sentences', instructionsHi: '2-3 वाक्यों में उत्तर दें' },
        { name: 'Section C', nameHi: 'खंड स', questionType: 'long_answer', marksPerQuestion: 5, totalQuestions: 3, attemptQuestions: 3, instructions: 'Answer in detail', instructionsHi: 'विस्तार से उत्तर दें' },
      ],
    };
  }

  if (g <= 10) {
    return {
      templateName: `CBSE Standard - Class ${grade}`,
      templateNameHi: `सीबीएसई मानक - कक्षा ${grade}`,
      grade,
      subject: '',
      totalMarks: 80,
      durationMinutes: 180,
      sections: [
        { name: 'Section A - MCQ', nameHi: 'खंड अ - बहुविकल्पीय', questionType: 'mcq', marksPerQuestion: 1, totalQuestions: 20, attemptQuestions: 16, instructions: 'Choose the correct option', instructionsHi: 'सही विकल्प चुनें' },
        { name: 'Section B - Assertion Reason', nameHi: 'खंड ब - अभिकथन कारण', questionType: 'assertion_reason', marksPerQuestion: 1, totalQuestions: 5, attemptQuestions: 4, instructions: 'Read both statements', instructionsHi: 'दोनों कथन पढ़ें' },
        { name: 'Section C - Short Answer (2m)', nameHi: 'खंड स - लघु उत्तर (2 अंक)', questionType: 'short_answer', marksPerQuestion: 2, totalQuestions: 6, attemptQuestions: 5, instructions: 'Answer in 30-50 words', instructionsHi: '30-50 शब्दों में उत्तर दें' },
        { name: 'Section D - Short Answer (3m)', nameHi: 'खंड द - लघु उत्तर (3 अंक)', questionType: 'short_answer', marksPerQuestion: 3, totalQuestions: 7, attemptQuestions: 6, instructions: 'Answer in 50-80 words', instructionsHi: '50-80 शब्दों में उत्तर दें' },
        { name: 'Section E - Long Answer', nameHi: 'खंड इ - दीर्घ उत्तर', questionType: 'long_answer', marksPerQuestion: 5, totalQuestions: 3, attemptQuestions: 2, instructions: 'Answer in detail with diagrams', instructionsHi: 'चित्र सहित विस्तार से उत्तर दें' },
        { name: 'Section F - Case Based', nameHi: 'खंड फ - केस आधारित', questionType: 'case_based', marksPerQuestion: 4, totalQuestions: 3, attemptQuestions: 2, instructions: 'Read the passage and answer', instructionsHi: 'गद्यांश पढ़ें और उत्तर दें' },
      ],
    };
  }

  // Grades 11-12
  return {
    templateName: `CBSE Standard - Class ${grade}`,
    templateNameHi: `सीबीएसई मानक - कक्षा ${grade}`,
    grade,
    subject: '',
    totalMarks: 70,
    durationMinutes: 180,
    sections: [
      { name: 'Section A - MCQ', nameHi: 'खंड अ - बहुविकल्पीय', questionType: 'mcq', marksPerQuestion: 1, totalQuestions: 24, attemptQuestions: 20, instructions: 'Choose the correct option', instructionsHi: 'सही विकल्प चुनें' },
      { name: 'Section B - Assertion Reason', nameHi: 'खंड ब - अभिकथन कारण', questionType: 'assertion_reason', marksPerQuestion: 1, totalQuestions: 6, attemptQuestions: 5, instructions: 'Read both statements', instructionsHi: 'दोनों कथन पढ़ें' },
      { name: 'Section C - Short Answer (2m)', nameHi: 'खंड स - लघु उत्तर (2 अंक)', questionType: 'short_answer', marksPerQuestion: 2, totalQuestions: 7, attemptQuestions: 6, instructions: 'Answer in 30-50 words', instructionsHi: '30-50 शब्दों में उत्तर दें' },
      { name: 'Section D - Short Answer (3m)', nameHi: 'खंड द - लघु उत्तर (3 अंक)', questionType: 'short_answer', marksPerQuestion: 3, totalQuestions: 6, attemptQuestions: 5, instructions: 'Answer in 50-80 words', instructionsHi: '50-80 शब्दों में उत्तर दें' },
      { name: 'Section E - Long Answer', nameHi: 'खंड इ - दीर्घ उत्तर', questionType: 'long_answer', marksPerQuestion: 5, totalQuestions: 3, attemptQuestions: 2, instructions: 'Answer in detail with diagrams', instructionsHi: 'चित्र सहित विस्तार से उत्तर दें' },
      { name: 'Section F - Case Based', nameHi: 'खंड फ - केस आधारित', questionType: 'case_based', marksPerQuestion: 4, totalQuestions: 3, attemptQuestions: 2, instructions: 'Read the passage and answer', instructionsHi: 'गद्यांश पढ़ें और उत्तर दें' },
    ],
  };
}

/** Distribute questions to exam sections by type */
export function distributeQuestionsToSections(
  questions: QuizQuestion[],
  sectionDefs: ExamSectionDef[],
): (ExamSectionDef & { questions: QuizQuestion[] })[] {
  return sectionDefs.map(section => {
    const matching = questions.filter(q => q.question_type_v2 === section.questionType);
    const shuffled = shuffleArray(matching);
    return {
      ...section,
      questions: shuffled.slice(0, section.totalQuestions),
    };
  });
}

/** Format duration in seconds to "Xm Ys" */
export function formatQuizDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  if (secs === 0) return `${mins}m`;
  return `${mins}m ${secs}s`;
}
