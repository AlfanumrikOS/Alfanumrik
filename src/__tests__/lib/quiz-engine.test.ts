/**
 * quiz-engine.ts — unit tests.
 *
 * src/lib/quiz-engine.ts is the pure-function library for quiz selection,
 * chapter completion, exam template generation, and question validation.
 * Zero database calls. Tests cover:
 *   - shuffleArray returns a permutation (same length, same multiset)
 *   - calculateDifficultySlots: easy/medium/hard/mixed/progressive shapes
 *   - getConceptWeight: WEAK / MEDIUM / STRONG threshold tiers
 *   - calculateConceptSlots: weighted distribution, capacity limits,
 *     remaining-slots redistribution, over-allocation trimming
 *   - isChapterCompleted: 3-rule AND check, no-concepts edge case
 *   - isTestModeUnlocked: completed-chapter shortcut + mastery-only path
 *   - calculatePoolCoverage / getQuestionHistoryStats: percent + reset flag
 *   - parseQuestionOptions: array passthrough, JSON-string parse, garbage
 *   - validateQuestionForQuiz: P6-compliant happy path + every reject path
 *   - getDefaultExamTemplate: grade-band branches (≤8 / ≤10 / 11-12)
 *   - distributeQuestionsToSections: filters by question_type_v2
 *   - formatQuizDuration: "Xm Ys" formatting branches
 */

import { describe, it, expect } from 'vitest';
import {
  VALID_QUIZ_SIZES,
  CHAPTER_COMPLETION,
  TEST_MODE_UNLOCK,
  NON_REPETITION,
  PROGRESSIVE_DIFFICULTY,
  CONCEPT_BALANCE,
  QUESTION_TYPE_LABELS,
  shuffleArray,
  calculateDifficultySlots,
  getConceptWeight,
  calculateConceptSlots,
  isChapterCompleted,
  isTestModeUnlocked,
  calculatePoolCoverage,
  getQuestionHistoryStats,
  parseQuestionOptions,
  validateQuestionForQuiz,
  getDefaultExamTemplate,
  distributeQuestionsToSections,
  formatQuizDuration,
  type QuizQuestion,
  type ChapterProgressData,
} from '@/lib/quiz-engine';

// Helper: build a minimum-viable QuizQuestion
function makeQuestion(overrides: Partial<QuizQuestion> = {}): QuizQuestion {
  return {
    id: 'q1',
    question_text: 'What is the capital of India? Provide the official name.',
    question_hi: null,
    question_type: 'mcq',
    question_type_v2: 'mcq',
    options: ['Mumbai', 'Delhi', 'Kolkata', 'Chennai'],
    correct_answer_index: 1,
    explanation: 'Delhi is the capital of India per the Constitution of India.',
    explanation_hi: null,
    hint: null,
    difficulty: 1,
    bloom_level: 'remember',
    chapter_number: 1,
    chapter_title: null,
    concept_tag: null,
    case_passage: null,
    case_passage_hi: null,
    expected_answer: null,
    expected_answer_hi: null,
    max_marks: 1,
    is_ncert: true,
    ncert_exercise: null,
    ...overrides,
  };
}

describe('Constants', () => {
  it('VALID_QUIZ_SIZES is the canonical [5, 10, 15, 20]', () => {
    expect(VALID_QUIZ_SIZES).toEqual([5, 10, 15, 20]);
  });

  it('CHAPTER_COMPLETION rules expose 80/60/70 thresholds', () => {
    expect(CHAPTER_COMPLETION.MIN_POOL_COVERAGE).toBe(80);
    expect(CHAPTER_COMPLETION.MIN_ACCURACY).toBe(60);
    expect(CHAPTER_COMPLETION.MIN_CONCEPT_COVERAGE).toBe(70);
  });

  it('TEST_MODE_UNLOCK exposes mastery threshold', () => {
    expect(TEST_MODE_UNLOCK.MIN_CONCEPT_MASTERY_PERCENT).toBe(70);
  });

  it('NON_REPETITION reset threshold is 80%', () => {
    expect(NON_REPETITION.RESET_THRESHOLD).toBe(0.8);
  });

  it('PROGRESSIVE_DIFFICULTY percentages sum to 100', () => {
    const sum = PROGRESSIVE_DIFFICULTY.EASY_PERCENT
      + PROGRESSIVE_DIFFICULTY.MEDIUM_PERCENT
      + PROGRESSIVE_DIFFICULTY.HARD_PERCENT;
    expect(sum).toBe(100);
  });

  it('CONCEPT_BALANCE weights are weak > medium > strong', () => {
    expect(CONCEPT_BALANCE.WEAK_WEIGHT).toBeGreaterThan(CONCEPT_BALANCE.MEDIUM_WEIGHT);
    expect(CONCEPT_BALANCE.MEDIUM_WEIGHT).toBeGreaterThan(CONCEPT_BALANCE.STRONG_WEIGHT);
  });

  it('QUESTION_TYPE_LABELS has all five question types', () => {
    expect(Object.keys(QUESTION_TYPE_LABELS).sort()).toEqual([
      'assertion_reason', 'case_based', 'long_answer', 'mcq', 'short_answer',
    ]);
  });
});

describe('shuffleArray', () => {
  it('returns a new array with the same elements', () => {
    const arr = [1, 2, 3, 4, 5];
    const out = shuffleArray(arr);
    expect(out).not.toBe(arr); // new array reference
    expect(out.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('handles empty input', () => {
    expect(shuffleArray([])).toEqual([]);
  });

  it('handles single-element input', () => {
    expect(shuffleArray(['x'])).toEqual(['x']);
  });
});

describe('calculateDifficultySlots', () => {
  it('returns empty array when count <= 0', () => {
    expect(calculateDifficultySlots(0, 'easy')).toEqual([]);
    expect(calculateDifficultySlots(-1, 'mixed')).toEqual([]);
  });

  it('"easy" returns all 1s', () => {
    expect(calculateDifficultySlots(5, 'easy')).toEqual([1, 1, 1, 1, 1]);
  });

  it('"medium" returns all 2s', () => {
    expect(calculateDifficultySlots(3, 'medium')).toEqual([2, 2, 2]);
  });

  it('"hard" returns all 3s', () => {
    expect(calculateDifficultySlots(4, 'hard')).toEqual([3, 3, 3, 3]);
  });

  it('"progressive" returns 30/40/30 split (rounded), preserving total', () => {
    const slots = calculateDifficultySlots(10, 'progressive');
    expect(slots).toHaveLength(10);
    const easyN = slots.filter(s => s === 1).length;
    const medN = slots.filter(s => s === 2).length;
    const hardN = slots.filter(s => s === 3).length;
    expect(easyN).toBe(3);
    expect(medN).toBe(4);
    expect(hardN).toBe(3);
  });

  it('"mixed" cycles 1/2/3 deterministically', () => {
    expect(calculateDifficultySlots(6, 'mixed')).toEqual([1, 2, 3, 1, 2, 3]);
  });

  it('falls back to mixed for unknown DifficultyMode values', () => {
    // The function's default branch (case 'mixed': default:) handles this.
    const slots = calculateDifficultySlots(3, 'unknown' as any);
    expect(slots).toEqual([1, 2, 3]);
  });
});

describe('getConceptWeight', () => {
  it('returns WEAK_WEIGHT for mastery below 0.3', () => {
    expect(getConceptWeight(0)).toBe(CONCEPT_BALANCE.WEAK_WEIGHT);
    expect(getConceptWeight(0.15)).toBe(CONCEPT_BALANCE.WEAK_WEIGHT);
    expect(getConceptWeight(0.299)).toBe(CONCEPT_BALANCE.WEAK_WEIGHT);
  });

  it('returns MEDIUM_WEIGHT in the middle band [0.3, 0.7]', () => {
    expect(getConceptWeight(0.3)).toBe(CONCEPT_BALANCE.MEDIUM_WEIGHT);
    expect(getConceptWeight(0.5)).toBe(CONCEPT_BALANCE.MEDIUM_WEIGHT);
    expect(getConceptWeight(0.7)).toBe(CONCEPT_BALANCE.MEDIUM_WEIGHT);
  });

  it('returns STRONG_WEIGHT above 0.7', () => {
    expect(getConceptWeight(0.71)).toBe(CONCEPT_BALANCE.STRONG_WEIGHT);
    expect(getConceptWeight(1)).toBe(CONCEPT_BALANCE.STRONG_WEIGHT);
  });
});

describe('calculateConceptSlots', () => {
  it('returns empty Map for empty concepts', () => {
    expect(calculateConceptSlots([], 10).size).toBe(0);
  });

  it('returns empty Map when totalSlots <= 0', () => {
    expect(calculateConceptSlots([{ tag: 'a', mastery: 0.2, available: 5 }], 0).size).toBe(0);
  });

  it('returns empty Map when no concept has available capacity', () => {
    const out = calculateConceptSlots([{ tag: 'a', mastery: 0.2, available: 0 }], 5);
    expect(out.size).toBe(0);
  });

  it('allocates more slots to weaker concepts', () => {
    const out = calculateConceptSlots(
      [
        { tag: 'weak', mastery: 0.1, available: 10 },
        { tag: 'strong', mastery: 0.9, available: 10 },
      ],
      10,
    );
    expect((out.get('weak') ?? 0)).toBeGreaterThanOrEqual(out.get('strong') ?? 0);
  });

  it('respects each concept\'s available cap', () => {
    const out = calculateConceptSlots(
      [
        { tag: 'limited', mastery: 0.1, available: 2 },
        { tag: 'plenty',  mastery: 0.5, available: 100 },
      ],
      20,
    );
    expect(out.get('limited')).toBeLessThanOrEqual(2);
  });

  it('does not over-allocate beyond totalSlots', () => {
    const out = calculateConceptSlots(
      [
        { tag: 'a', mastery: 0.2, available: 100 },
        { tag: 'b', mastery: 0.5, available: 100 },
        { tag: 'c', mastery: 0.8, available: 100 },
      ],
      10,
    );
    let sum = 0;
    out.forEach(v => { sum += v; });
    expect(sum).toBeLessThanOrEqual(10);
  });
});

describe('isChapterCompleted', () => {
  function makeProgress(over: Partial<ChapterProgressData> = {}): ChapterProgressData {
    return {
      chapterId: 'c1',
      chapterNumber: 1,
      title: 'T',
      titleHi: null,
      questionsAttempted: 0,
      questionsCorrect: 0,
      uniqueQuestionsSeen: 0,
      totalQuestionsInChapter: 0,
      poolCoveragePercent: 0,
      accuracyPercent: 0,
      conceptsAttempted: 0,
      conceptsMastered: 0,
      totalConcepts: 10,
      isCompleted: false,
      testModeUnlocked: false,
      lastActivityAt: null,
      ...over,
    };
  }

  it('returns true when all three rules pass', () => {
    expect(isChapterCompleted(makeProgress({
      poolCoveragePercent: 80,
      accuracyPercent: 60,
      conceptsAttempted: 7,
      totalConcepts: 10,
    }))).toBe(true);
  });

  it('returns false when pool coverage falls short', () => {
    expect(isChapterCompleted(makeProgress({
      poolCoveragePercent: 79,
      accuracyPercent: 60,
      conceptsAttempted: 10,
    }))).toBe(false);
  });

  it('returns false when accuracy falls short', () => {
    expect(isChapterCompleted(makeProgress({
      poolCoveragePercent: 80,
      accuracyPercent: 59,
      conceptsAttempted: 10,
    }))).toBe(false);
  });

  it('returns false when concept coverage falls short', () => {
    expect(isChapterCompleted(makeProgress({
      poolCoveragePercent: 80,
      accuracyPercent: 60,
      conceptsAttempted: 6,
      totalConcepts: 10,
    }))).toBe(false);
  });

  it('treats no-concepts chapter as concept-coverage-met', () => {
    expect(isChapterCompleted(makeProgress({
      poolCoveragePercent: 80,
      accuracyPercent: 60,
      totalConcepts: 0,
    }))).toBe(true);
  });
});

describe('isTestModeUnlocked', () => {
  function makeProgress(over: Partial<ChapterProgressData> = {}): ChapterProgressData {
    return {
      chapterId: 'c1',
      chapterNumber: 1,
      title: 'T',
      titleHi: null,
      questionsAttempted: 0,
      questionsCorrect: 0,
      uniqueQuestionsSeen: 0,
      totalQuestionsInChapter: 0,
      poolCoveragePercent: 0,
      accuracyPercent: 0,
      conceptsAttempted: 0,
      conceptsMastered: 0,
      totalConcepts: 10,
      isCompleted: false,
      testModeUnlocked: false,
      lastActivityAt: null,
      ...over,
    };
  }

  it('unlocks when chapter is completed', () => {
    expect(isTestModeUnlocked(makeProgress({
      poolCoveragePercent: 80, accuracyPercent: 60, conceptsAttempted: 10,
    }))).toBe(true);
  });

  it('unlocks when concept mastery reaches 70%, even if not completed', () => {
    expect(isTestModeUnlocked(makeProgress({
      poolCoveragePercent: 0,
      conceptsMastered: 7, totalConcepts: 10,
    }))).toBe(true);
  });

  it('stays locked when nothing meets the threshold', () => {
    expect(isTestModeUnlocked(makeProgress({
      conceptsMastered: 5, totalConcepts: 10,
    }))).toBe(false);
  });

  it('stays locked when chapter has no concepts and pool coverage is low', () => {
    expect(isTestModeUnlocked(makeProgress({
      poolCoveragePercent: 0, totalConcepts: 0,
    }))).toBe(false);
  });
});

describe('calculatePoolCoverage', () => {
  it('returns 0% with shouldReset=false when total is 0', () => {
    expect(calculatePoolCoverage(0, 0)).toEqual({ percent: 0, shouldReset: false });
  });

  it('rounds percent and flips shouldReset at 80%', () => {
    expect(calculatePoolCoverage(40, 100)).toEqual({ percent: 40, shouldReset: false });
    expect(calculatePoolCoverage(80, 100)).toEqual({ percent: 80, shouldReset: true });
    expect(calculatePoolCoverage(79, 100)).toEqual({ percent: 79, shouldReset: false });
    expect(calculatePoolCoverage(100, 100)).toEqual({ percent: 100, shouldReset: true });
  });
});

describe('getQuestionHistoryStats', () => {
  it('reports willResetAt and questionsUntilReset', () => {
    const s = getQuestionHistoryStats(50, 100);
    expect(s.totalPool).toBe(100);
    expect(s.questionsSeen).toBe(50);
    expect(s.coveragePercent).toBe(50);
    expect(s.willResetAt).toBe(80);
    expect(s.questionsUntilReset).toBe(30);
    expect(s.shouldReset).toBe(false);
  });

  it('reports shouldReset=true when seen >= willResetAt', () => {
    const s = getQuestionHistoryStats(80, 100);
    expect(s.shouldReset).toBe(true);
    expect(s.questionsUntilReset).toBe(0);
  });

  it('handles total=0 with non-negative fields', () => {
    const s = getQuestionHistoryStats(0, 0);
    expect(s.coveragePercent).toBe(0);
    expect(s.questionsUntilReset).toBe(0);
    expect(s.shouldReset).toBe(false);
  });
});

describe('parseQuestionOptions', () => {
  it('passes through string arrays unchanged (modulo coercion)', () => {
    expect(parseQuestionOptions(['a', 'b', 'c', 'd'])).toEqual(['a', 'b', 'c', 'd']);
  });

  it('strips empty / falsy entries from array input', () => {
    expect(parseQuestionOptions(['a', '', null, 'b'])).toEqual(['a', 'b']);
  });

  it('parses JSON-string arrays', () => {
    expect(parseQuestionOptions('["x","y","z"]')).toEqual(['x', 'y', 'z']);
  });

  it('returns [] for malformed JSON', () => {
    expect(parseQuestionOptions('{not json')).toEqual([]);
  });

  it('returns [] for null / number / object input', () => {
    expect(parseQuestionOptions(null)).toEqual([]);
    expect(parseQuestionOptions(42)).toEqual([]);
    expect(parseQuestionOptions({ a: 1 })).toEqual([]);
  });

  it('returns [] when JSON parses to a non-array', () => {
    expect(parseQuestionOptions('"just a string"')).toEqual([]);
  });
});

describe('validateQuestionForQuiz', () => {
  it('accepts a valid MCQ question', () => {
    expect(validateQuestionForQuiz(makeQuestion())).toBe(true);
  });

  it('rejects missing or empty question_text', () => {
    expect(validateQuestionForQuiz(makeQuestion({ question_text: '' }))).toBe(false);
    expect(validateQuestionForQuiz({ ...makeQuestion(), question_text: undefined as any })).toBe(false);
  });

  it('rejects question_text with template markers', () => {
    expect(validateQuestionForQuiz(makeQuestion({ question_text: 'What is {{topic}} about it really?' }))).toBe(false);
    expect(validateQuestionForQuiz(makeQuestion({ question_text: 'Fill in the [BLANK] correctly here please.' }))).toBe(false);
  });

  it('rejects garbage template phrases', () => {
    expect(validateQuestionForQuiz(makeQuestion({ question_text: 'A student studying this should focus on something useful.' }))).toBe(false);
    expect(validateQuestionForQuiz(makeQuestion({ question_text: 'Which of the following best describes the main topic of this chapter?' }))).toBe(false);
    expect(validateQuestionForQuiz(makeQuestion({ question_text: 'Why is photosynthesis important for grade 6?' }))).toBe(false);
  });

  it('rejects too-short question text (< 15 chars)', () => {
    expect(validateQuestionForQuiz(makeQuestion({ question_text: 'Too short?' }))).toBe(false);
  });

  it('rejects MCQ with !== 4 options', () => {
    expect(validateQuestionForQuiz(makeQuestion({ options: ['a', 'b', 'c'] }))).toBe(false);
    expect(validateQuestionForQuiz(makeQuestion({ options: ['a', 'b', 'c', 'd', 'e'] }))).toBe(false);
  });

  it('rejects MCQ with out-of-range correct_answer_index', () => {
    expect(validateQuestionForQuiz(makeQuestion({ correct_answer_index: -1 }))).toBe(false);
    expect(validateQuestionForQuiz(makeQuestion({ correct_answer_index: 4 }))).toBe(false);
    expect(validateQuestionForQuiz({ ...makeQuestion(), correct_answer_index: undefined as any })).toBe(false);
  });

  it('rejects MCQ with too many duplicate options (< 3 distinct)', () => {
    expect(validateQuestionForQuiz(makeQuestion({
      options: ['Same', 'Same', 'Same', 'Different'],
    }))).toBe(false);
  });

  it('rejects MCQ with garbage option phrases', () => {
    expect(validateQuestionForQuiz(makeQuestion({
      options: ['Delhi', 'Mumbai', 'Unrelated topic option here', 'Chennai'],
    }))).toBe(false);
  });

  it('rejects case-based without a passage', () => {
    expect(validateQuestionForQuiz(makeQuestion({
      question_type_v2: 'case_based',
      case_passage: null,
    }))).toBe(false);
  });

  it('rejects case-based with too-short passage', () => {
    expect(validateQuestionForQuiz(makeQuestion({
      question_type_v2: 'case_based',
      case_passage: 'too short',
    }))).toBe(false);
  });

  it('accepts case-based with sufficient passage and 4 options', () => {
    expect(validateQuestionForQuiz(makeQuestion({
      question_type_v2: 'case_based',
      case_passage: 'A reasonably long passage that the student must read before answering.',
    }))).toBe(true);
  });

  it('rejects short_answer / long_answer without expected_answer', () => {
    expect(validateQuestionForQuiz(makeQuestion({
      question_type_v2: 'short_answer',
      expected_answer: null,
    }))).toBe(false);
    expect(validateQuestionForQuiz(makeQuestion({
      question_type_v2: 'long_answer',
      expected_answer: 'too short',
    }))).toBe(false);
  });

  it('accepts short_answer with sufficient expected_answer', () => {
    expect(validateQuestionForQuiz(makeQuestion({
      question_type_v2: 'short_answer',
      // Cleared options because validator only enforces 4-option rule for
      // mcq/assertion/case_based types. The explanation must still be valid.
      options: [],
      expected_answer: 'A reasonably detailed model answer of sufficient length.',
    }))).toBe(true);
  });

  it('rejects question with too-short explanation', () => {
    expect(validateQuestionForQuiz(makeQuestion({
      explanation: 'short',
    }))).toBe(false);
  });

  it('rejects question with garbage explanation patterns', () => {
    expect(validateQuestionForQuiz(makeQuestion({
      explanation: 'However, the correct answer does not match any option as listed here.',
    }))).toBe(false);
  });
});

describe('getDefaultExamTemplate', () => {
  it('grade 6 → 50 marks, 120 min, 3 sections', () => {
    const t = getDefaultExamTemplate('6');
    expect(t.grade).toBe('6');
    expect(t.totalMarks).toBe(50);
    expect(t.durationMinutes).toBe(120);
    expect(t.sections).toHaveLength(3);
  });

  it('grade 9 → 80 marks, 180 min, 6 sections', () => {
    const t = getDefaultExamTemplate('9');
    expect(t.totalMarks).toBe(80);
    expect(t.durationMinutes).toBe(180);
    expect(t.sections).toHaveLength(6);
  });

  it('grade 12 → 70 marks, 180 min, 6 sections', () => {
    const t = getDefaultExamTemplate('12');
    expect(t.totalMarks).toBe(70);
    expect(t.durationMinutes).toBe(180);
    expect(t.sections).toHaveLength(6);
  });

  it('handles unparseable grade by defaulting to grade 9 path', () => {
    // parseInt('abc') is NaN → falls back to 9 → 80-mark template
    const t = getDefaultExamTemplate('abc');
    expect(t.totalMarks).toBe(80);
  });

  it('every section carries marksPerQuestion and totalQuestions', () => {
    const t = getDefaultExamTemplate('10');
    for (const s of t.sections) {
      expect(s.marksPerQuestion).toBeGreaterThan(0);
      expect(s.totalQuestions).toBeGreaterThan(0);
      expect(s.attemptQuestions).toBeGreaterThan(0);
    }
  });
});

describe('distributeQuestionsToSections', () => {
  it('groups questions by question_type_v2 into matching sections', () => {
    const questions: QuizQuestion[] = [
      makeQuestion({ id: 'q-mcq-1', question_type_v2: 'mcq' }),
      makeQuestion({ id: 'q-mcq-2', question_type_v2: 'mcq' }),
      makeQuestion({ id: 'q-sa-1', question_type_v2: 'short_answer' }),
    ];
    const sections = [
      { name: 'A', nameHi: 'अ', questionType: 'mcq' as const, marksPerQuestion: 1, totalQuestions: 5, attemptQuestions: 5, instructions: '', instructionsHi: '' },
      { name: 'B', nameHi: 'ब', questionType: 'short_answer' as const, marksPerQuestion: 2, totalQuestions: 5, attemptQuestions: 5, instructions: '', instructionsHi: '' },
    ];
    const out = distributeQuestionsToSections(questions, sections);
    expect(out[0].questions).toHaveLength(2);
    expect(out[1].questions).toHaveLength(1);
    expect(out[0].questions.every(q => q.question_type_v2 === 'mcq')).toBe(true);
    expect(out[1].questions.every(q => q.question_type_v2 === 'short_answer')).toBe(true);
  });

  it('caps each section at totalQuestions', () => {
    const questions = Array.from({ length: 20 }, (_, i) =>
      makeQuestion({ id: `q${i}`, question_type_v2: 'mcq' }),
    );
    const sections = [
      { name: 'A', nameHi: 'अ', questionType: 'mcq' as const, marksPerQuestion: 1, totalQuestions: 5, attemptQuestions: 5, instructions: '', instructionsHi: '' },
    ];
    const out = distributeQuestionsToSections(questions, sections);
    expect(out[0].questions).toHaveLength(5);
  });
});

describe('formatQuizDuration', () => {
  it('seconds-only when under one minute', () => {
    expect(formatQuizDuration(45)).toBe('45s');
  });

  it('minutes-only when seconds component is zero', () => {
    expect(formatQuizDuration(120)).toBe('2m');
  });

  it('"Xm Ys" for mixed durations', () => {
    expect(formatQuizDuration(90)).toBe('1m 30s');
    expect(formatQuizDuration(3661)).toBe('61m 1s');
  });

  it('zero seconds → "0s"', () => {
    expect(formatQuizDuration(0)).toBe('0s');
  });
});
