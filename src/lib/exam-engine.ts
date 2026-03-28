/**
 * ALFANUMRIK — Exam Assessment Engine
 *
 * Cognitively sound exam configuration based on:
 * - grade level (6-12)
 * - subject category (STEM, language, humanities)
 * - difficulty level
 * - exam type preset
 *
 * Timing model: each question has a cognitive cost based on
 * Bloom's taxonomy level and subject complexity. Total exam
 * duration = sum of per-question time allocations.
 */

// ─── Subject Categories ─────────────────────────────────────

type SubjectCategory = 'stem_calc' | 'stem_concept' | 'language' | 'humanities';

const SUBJECT_CATEGORY: Record<string, SubjectCategory> = {
  math: 'stem_calc',
  physics: 'stem_calc',
  chemistry: 'stem_concept',
  biology: 'stem_concept',
  science: 'stem_concept',
  computer_science: 'stem_calc',
  coding: 'stem_calc',
  english: 'language',
  hindi: 'language',
  social_studies: 'humanities',
  economics: 'stem_concept',
  accountancy: 'stem_calc',
  business_studies: 'humanities',
  political_science: 'humanities',
  history_sr: 'humanities',
  geography: 'humanities',
};

// Time per question in seconds, by category and difficulty
const TIME_PER_QUESTION: Record<SubjectCategory, Record<string, number>> = {
  stem_calc:    { easy: 90, medium: 150, hard: 210, mixed: 150 },
  stem_concept: { easy: 75, medium: 120, hard: 180, mixed: 120 },
  language:     { easy: 60, medium: 90,  hard: 150, mixed: 90  },
  humanities:   { easy: 60, medium: 105, hard: 165, mixed: 105 },
};

// Grade multiplier: younger students get more time per question
const GRADE_TIME_MULTIPLIER: Record<string, number> = {
  '6': 1.3, '7': 1.25, '8': 1.2,
  '9': 1.1, '10': 1.05,
  '11': 1.0, '12': 1.0,
};

// ─── Exam Presets ────────────────────────────────────────────

export interface ExamPreset {
  id: string;
  label: string;
  labelHi: string;
  icon: string;
  desc: string;
  descHi: string;
  color: string;
  questionCount: number;
  difficulty: 'easy' | 'medium' | 'hard' | 'mixed';
  bloomMix: string; // human-readable description
  bloomMixHi: string;
  recommended?: boolean;
}

// Per-grade preset definitions
function getExamPresets(grade: string, subject: string): ExamPreset[] {
  const g = parseInt(grade) || 9;
  const isJunior = g <= 8;
  const isSenior = g >= 11;

  return [
    {
      id: 'quick_check',
      label: 'Quick Check',
      labelHi: 'त्वरित जाँच',
      icon: '⚡',
      desc: `${isJunior ? 5 : 8} questions · Recall + understanding`,
      descHi: `${isJunior ? 5 : 8} सवाल · याद + समझ`,
      color: '#16A34A',
      questionCount: isJunior ? 5 : 8,
      difficulty: 'easy',
      bloomMix: 'Mostly recall & understanding',
      bloomMixHi: 'ज़्यादातर याद और समझ',
    },
    {
      id: 'standard_test',
      label: 'Standard Test',
      labelHi: 'मानक परीक्षा',
      icon: '📝',
      desc: `${isJunior ? 10 : 15} questions · Balanced difficulty`,
      descHi: `${isJunior ? 10 : 15} सवाल · संतुलित कठिनाई`,
      color: '#F5A623',
      questionCount: isJunior ? 10 : 15,
      difficulty: 'medium',
      bloomMix: 'Understanding + application',
      bloomMixHi: 'समझ + प्रयोग',
      recommended: true,
    },
    {
      id: 'challenge',
      label: 'Challenge',
      labelHi: 'चुनौती',
      icon: '🔥',
      desc: `${isJunior ? 8 : 12} questions · Application + analysis`,
      descHi: `${isJunior ? 8 : 12} सवाल · प्रयोग + विश्लेषण`,
      color: '#DC2626',
      questionCount: isJunior ? 8 : 12,
      difficulty: 'hard',
      bloomMix: 'Application, analysis & reasoning',
      bloomMixHi: 'प्रयोग, विश्लेषण और तर्क',
    },
    {
      id: 'full_exam',
      label: isSenior ? 'Board Practice' : 'Full Exam',
      labelHi: isSenior ? 'बोर्ड अभ्यास' : 'पूर्ण परीक्षा',
      icon: '📋',
      desc: `${isJunior ? 15 : isSenior ? 25 : 20} questions · Mixed difficulty, timed`,
      descHi: `${isJunior ? 15 : isSenior ? 25 : 20} सवाल · मिश्रित कठिनाई, समयबद्ध`,
      color: '#7C3AED',
      questionCount: isJunior ? 15 : isSenior ? 25 : 20,
      difficulty: 'mixed',
      bloomMix: 'Full Bloom\'s range — recall to evaluation',
      bloomMixHi: 'पूरी ब्लूम श्रेणी — याद से मूल्यांकन तक',
    },
  ];
}

// ─── Duration Calculation ────────────────────────────────────

export interface ExamConfig {
  questionCount: number;
  durationMinutes: number;
  durationSeconds: number;
  difficulty: 'easy' | 'medium' | 'hard' | 'mixed';
  avgSecondsPerQuestion: number;
  presetId: string;
}

/**
 * Calculate exam duration based on cognitive timing model.
 * Duration = questionCount × timePerQuestion × gradeMultiplier + buffer
 */
export function calculateExamConfig(
  preset: ExamPreset,
  subject: string,
  grade: string,
): ExamConfig {
  const category = SUBJECT_CATEGORY[subject] || 'stem_concept';
  const baseTime = TIME_PER_QUESTION[category][preset.difficulty];
  const gradeMultiplier = GRADE_TIME_MULTIPLIER[grade] || 1.0;

  const rawSeconds = preset.questionCount * baseTime * gradeMultiplier;
  // Add 10% buffer for reading + review
  const totalSeconds = Math.ceil(rawSeconds * 1.1);
  const durationMinutes = Math.ceil(totalSeconds / 60);

  // Round to nearest 5 minutes for cleaner display
  const roundedMinutes = Math.ceil(durationMinutes / 5) * 5;

  return {
    questionCount: preset.questionCount,
    durationMinutes: roundedMinutes,
    durationSeconds: roundedMinutes * 60,
    difficulty: preset.difficulty,
    avgSecondsPerQuestion: Math.round(totalSeconds / preset.questionCount),
    presetId: preset.id,
  };
}

// ─── Validation ──────────────────────────────────────────────

interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validate a custom exam configuration.
 * Rejects nonsensical combinations.
 */
export function validateExamConfig(
  questionCount: number,
  durationMinutes: number,
  subject: string,
  grade: string,
  difficulty: string,
): ValidationResult {
  const category = SUBJECT_CATEGORY[subject] || 'stem_concept';
  const gradeMultiplier = GRADE_TIME_MULTIPLIER[grade] || 1.0;

  // Calculate min/max sensible time
  const minTimePerQ = TIME_PER_QUESTION[category].easy * 0.5 * gradeMultiplier;
  const maxTimePerQ = TIME_PER_QUESTION[category].hard * 1.5 * gradeMultiplier;

  const minDuration = Math.ceil((questionCount * minTimePerQ) / 60);
  const maxDuration = Math.ceil((questionCount * maxTimePerQ) / 60);

  if (durationMinutes < minDuration) {
    return { valid: false, reason: `Too little time. Minimum ${minDuration} minutes for ${questionCount} questions.` };
  }
  if (durationMinutes > maxDuration) {
    return { valid: false, reason: `Too much time. Maximum ${maxDuration} minutes for ${questionCount} questions.` };
  }

  // Question count limits by grade
  const g = parseInt(grade) || 9;
  const maxQuestions = g <= 8 ? 20 : g <= 10 ? 30 : 40;
  const minQuestions = 3;

  if (questionCount < minQuestions || questionCount > maxQuestions) {
    return { valid: false, reason: `Question count must be ${minQuestions}-${maxQuestions} for Grade ${grade}.` };
  }

  return { valid: true };
}

// ─── Exports ─────────────────────────────────────────────────

export { getExamPresets, SUBJECT_CATEGORY, TIME_PER_QUESTION, GRADE_TIME_MULTIPLIER };
