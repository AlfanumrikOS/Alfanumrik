import { describe, it, expect } from 'vitest';
import {
  calculateExamConfig,
  validateExamConfig,
  getExamPresets,
  SUBJECT_CATEGORY,
  TIME_PER_QUESTION,
  GRADE_TIME_MULTIPLIER,
  type ExamPreset,
} from '@/lib/exam-engine';

/**
 * Exam Engine Tests — Exam Assessment Engine timing and validation
 *
 * Tests calculateExamConfig and validateExamConfig from src/lib/exam-engine.ts.
 * Covers:
 * - Duration calculation for different grade/subject/difficulty combos
 * - Grade multiplier effects (younger students get more time)
 * - Subject category time differences
 * - Exam preset generation by grade
 * - Custom exam validation (rejects nonsensical combos)
 *
 * Uses realistic CBSE data: grades "6" through "12", subjects science/math/english.
 */

// ─── Subject Categories ─────────────────────────────────────

describe('Subject Categories', () => {
  it('maps math and physics to stem_calc', () => {
    expect(SUBJECT_CATEGORY['math']).toBe('stem_calc');
    expect(SUBJECT_CATEGORY['physics']).toBe('stem_calc');
    expect(SUBJECT_CATEGORY['computer_science']).toBe('stem_calc');
    expect(SUBJECT_CATEGORY['accountancy']).toBe('stem_calc');
  });

  it('maps science, chemistry, biology to stem_concept', () => {
    expect(SUBJECT_CATEGORY['science']).toBe('stem_concept');
    expect(SUBJECT_CATEGORY['chemistry']).toBe('stem_concept');
    expect(SUBJECT_CATEGORY['biology']).toBe('stem_concept');
  });

  it('maps english and hindi to language', () => {
    expect(SUBJECT_CATEGORY['english']).toBe('language');
    expect(SUBJECT_CATEGORY['hindi']).toBe('language');
  });

  it('maps social_studies to humanities', () => {
    expect(SUBJECT_CATEGORY['social_studies']).toBe('humanities');
    expect(SUBJECT_CATEGORY['political_science']).toBe('humanities');
  });
});

// ─── Grade Time Multipliers ──────────────────────────────────

describe('Grade Time Multipliers', () => {
  it('grade "6" gets the highest multiplier (1.3)', () => {
    expect(GRADE_TIME_MULTIPLIER['6']).toBe(1.3);
  });

  it('grades "11" and "12" get 1.0 (no extra time)', () => {
    expect(GRADE_TIME_MULTIPLIER['11']).toBe(1.0);
    expect(GRADE_TIME_MULTIPLIER['12']).toBe(1.0);
  });

  it('multipliers decrease with grade level', () => {
    const grades = ['6', '7', '8', '9', '10', '11', '12'];
    for (let i = 0; i < grades.length - 1; i++) {
      const current = GRADE_TIME_MULTIPLIER[grades[i]];
      const next = GRADE_TIME_MULTIPLIER[grades[i + 1]];
      expect(current).toBeGreaterThanOrEqual(next);
    }
  });

  it('all grades 6-12 have defined multipliers', () => {
    for (let g = 6; g <= 12; g++) {
      expect(GRADE_TIME_MULTIPLIER[String(g)]).toBeDefined();
      expect(GRADE_TIME_MULTIPLIER[String(g)]).toBeGreaterThan(0);
    }
  });
});

// ─── Exam Presets ────────────────────────────────────────────

describe('Exam Presets', () => {
  it('returns 4 presets for any grade/subject combo', () => {
    const presets = getExamPresets('9', 'science');
    expect(presets).toHaveLength(4);
    expect(presets.map(p => p.id)).toEqual([
      'quick_check', 'standard_test', 'challenge', 'full_exam',
    ]);
  });

  it('marks standard_test as recommended', () => {
    const presets = getExamPresets('9', 'science');
    const standard = presets.find(p => p.id === 'standard_test');
    expect(standard?.recommended).toBe(true);
  });

  it('junior grades (6-8) get fewer questions per preset', () => {
    const junior = getExamPresets('7', 'science');
    const senior = getExamPresets('10', 'science');

    const juniorQuick = junior.find(p => p.id === 'quick_check')!;
    const seniorQuick = senior.find(p => p.id === 'quick_check')!;
    expect(juniorQuick.questionCount).toBe(5);
    expect(seniorQuick.questionCount).toBe(8);

    const juniorStandard = junior.find(p => p.id === 'standard_test')!;
    const seniorStandard = senior.find(p => p.id === 'standard_test')!;
    expect(juniorStandard.questionCount).toBe(10);
    expect(seniorStandard.questionCount).toBe(15);
  });

  it('senior grades (11-12) get 25 questions for full_exam', () => {
    const presets = getExamPresets('11', 'physics');
    const fullExam = presets.find(p => p.id === 'full_exam')!;
    expect(fullExam.questionCount).toBe(25);
    expect(fullExam.label).toBe('Board Practice');
  });

  it('every preset has bilingual labels', () => {
    const presets = getExamPresets('9', 'science');
    for (const preset of presets) {
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.labelHi.length).toBeGreaterThan(0);
      expect(preset.desc.length).toBeGreaterThan(0);
      expect(preset.descHi.length).toBeGreaterThan(0);
    }
  });
});

// ─── Duration Calculation ────────────────────────────────────

describe('calculateExamConfig', () => {
  it('calculates duration for Grade 9 Science medium difficulty', () => {
    const preset: ExamPreset = {
      id: 'standard_test', label: 'Standard Test', labelHi: 'मानक परीक्षा',
      icon: '📝', desc: '', descHi: '', color: '#F5A623',
      questionCount: 15, difficulty: 'medium',
      bloomMix: '', bloomMixHi: '',
    };
    const config = calculateExamConfig(preset, 'science', '9');
    // science = stem_concept, medium = 120s, grade 9 = 1.1
    // raw = 15 * 120 * 1.1 = 1980s, +10% = 2178, ceil = 2178s = 37 min -> ceil to 40
    expect(config.questionCount).toBe(15);
    expect(config.difficulty).toBe('medium');
    expect(config.durationMinutes).toBe(40);
    expect(config.durationSeconds).toBe(40 * 60);
    expect(config.presetId).toBe('standard_test');
    expect(config.avgSecondsPerQuestion).toBeGreaterThan(0);
  });

  it('gives more time to Grade 6 than Grade 12 for same preset', () => {
    const preset: ExamPreset = {
      id: 'standard_test', label: 'Test', labelHi: 'T',
      icon: '', desc: '', descHi: '', color: '',
      questionCount: 10, difficulty: 'medium',
      bloomMix: '', bloomMixHi: '',
    };
    const config6 = calculateExamConfig(preset, 'math', '6');
    const config12 = calculateExamConfig(preset, 'math', '12');
    expect(config6.durationMinutes).toBeGreaterThanOrEqual(config12.durationMinutes);
  });

  it('STEM calc (math) takes longer than language (english) at same difficulty', () => {
    const preset: ExamPreset = {
      id: 'test', label: 'T', labelHi: 'T',
      icon: '', desc: '', descHi: '', color: '',
      questionCount: 10, difficulty: 'medium',
      bloomMix: '', bloomMixHi: '',
    };
    const mathConfig = calculateExamConfig(preset, 'math', '9');
    const engConfig = calculateExamConfig(preset, 'english', '9');
    expect(mathConfig.durationMinutes).toBeGreaterThanOrEqual(engConfig.durationMinutes);
  });

  it('hard difficulty takes longer than easy difficulty', () => {
    const easyPreset: ExamPreset = {
      id: 'e', label: 'E', labelHi: 'E',
      icon: '', desc: '', descHi: '', color: '',
      questionCount: 10, difficulty: 'easy',
      bloomMix: '', bloomMixHi: '',
    };
    const hardPreset: ExamPreset = {
      id: 'h', label: 'H', labelHi: 'H',
      icon: '', desc: '', descHi: '', color: '',
      questionCount: 10, difficulty: 'hard',
      bloomMix: '', bloomMixHi: '',
    };
    const easy = calculateExamConfig(easyPreset, 'science', '9');
    const hard = calculateExamConfig(hardPreset, 'science', '9');
    expect(hard.durationMinutes).toBeGreaterThan(easy.durationMinutes);
  });

  it('rounds duration to nearest 5 minutes', () => {
    const preset: ExamPreset = {
      id: 'test', label: 'T', labelHi: 'T',
      icon: '', desc: '', descHi: '', color: '',
      questionCount: 10, difficulty: 'easy',
      bloomMix: '', bloomMixHi: '',
    };
    const config = calculateExamConfig(preset, 'science', '9');
    expect(config.durationMinutes % 5).toBe(0);
  });

  it('durationSeconds equals durationMinutes * 60', () => {
    const presets = getExamPresets('9', 'science');
    for (const preset of presets) {
      const config = calculateExamConfig(preset, 'science', '9');
      expect(config.durationSeconds).toBe(config.durationMinutes * 60);
    }
  });

  it('falls back to stem_concept for unknown subject', () => {
    const preset: ExamPreset = {
      id: 'test', label: 'T', labelHi: 'T',
      icon: '', desc: '', descHi: '', color: '',
      questionCount: 10, difficulty: 'medium',
      bloomMix: '', bloomMixHi: '',
    };
    const config = calculateExamConfig(preset, 'unknown_subject', '9');
    // Should use stem_concept defaults (120s for medium)
    expect(config.durationMinutes).toBeGreaterThan(0);
  });

  it('falls back to 1.0 multiplier for unknown grade', () => {
    const preset: ExamPreset = {
      id: 'test', label: 'T', labelHi: 'T',
      icon: '', desc: '', descHi: '', color: '',
      questionCount: 10, difficulty: 'medium',
      bloomMix: '', bloomMixHi: '',
    };
    const configUnknown = calculateExamConfig(preset, 'science', '99');
    const config12 = calculateExamConfig(preset, 'science', '12'); // grade 12 has 1.0
    expect(configUnknown.durationMinutes).toBe(config12.durationMinutes);
  });
});

// ─── Validation ──────────────────────────────────────────────

describe('validateExamConfig', () => {
  it('accepts valid configuration', () => {
    const result = validateExamConfig(10, 20, 'science', '9', 'medium');
    expect(result.valid).toBe(true);
  });

  it('rejects too little time for the question count', () => {
    const result = validateExamConfig(20, 1, 'math', '9', 'hard');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Too little time');
  });

  it('rejects too much time for the question count', () => {
    const result = validateExamConfig(5, 500, 'english', '9', 'easy');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Too much time');
  });

  it('rejects question count below minimum (3)', () => {
    const result = validateExamConfig(2, 10, 'science', '9', 'medium');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Question count');
  });

  it('rejects question count above grade maximum', () => {
    // Grade 7 (junior) max is 20
    const result = validateExamConfig(25, 60, 'science', '7', 'medium');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Question count');
  });

  it('allows up to 40 questions for grades 11-12', () => {
    const result = validateExamConfig(35, 120, 'physics', '11', 'medium');
    expect(result.valid).toBe(true);
  });

  it('handles unknown subject gracefully (uses stem_concept)', () => {
    const result = validateExamConfig(10, 20, 'unknown_subject', '9', 'medium');
    expect(result.valid).toBe(true);
  });
});
