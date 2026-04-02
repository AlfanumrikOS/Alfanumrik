import { describe, it, expect } from 'vitest';
import {
  GRADES,
  BOARDS,
  LANGUAGES,
  SUBJECT_META,
  GRADE_SUBJECTS,
  getSubjectsForGrade,
  FOXY_MODES,
  ROLE_CONFIG,
  BLOOM_LEVELS,
  MASTERY_LEVELS,
  QUIZ_MODES,
  ASSIGNMENT_TYPES,
  CBSE_QUESTION_TYPES,
  EXAM_TYPES,
  CBSE_SECTIONS,
  IMAGE_TYPES,
  BOARD_EXAM_YEARS,
} from '@/lib/constants';

/**
 * Constants Tests — src/lib/constants.ts
 *
 * Validates the correctness and completeness of all application constants.
 * Covers:
 * - Grade format (P5 compliance: strings, not integers)
 * - CBSE subject availability per grade
 * - Subject metadata completeness and uniqueness
 * - Role configuration for all user types
 * - Foxy modes, Bloom's levels, mastery levels
 * - Quiz modes, assignment types, exam types
 */

// ─── GRADES (P5 Compliance) ─────────────────────────────────

describe('GRADES', () => {
  it('has exactly 7 elements', () => {
    expect(GRADES).toHaveLength(7);
  });

  it('contains strings "6" through "12"', () => {
    expect(GRADES).toEqual(['6', '7', '8', '9', '10', '11', '12']);
  });

  it('all elements are strings, not integers (P5 compliance)', () => {
    for (const grade of GRADES) {
      expect(typeof grade).toBe('string');
    }
  });

  it('does not contain integer values', () => {
    for (const grade of GRADES) {
      expect(grade).not.toBe(6);
      expect(grade).not.toBe(7);
      expect(grade).not.toBe(8);
    }
  });

  it('covers exactly the CBSE 6-12 range', () => {
    for (let g = 6; g <= 12; g++) {
      expect(GRADES).toContain(String(g));
    }
    expect(GRADES).not.toContain('5');
    expect(GRADES).not.toContain('13');
  });
});

// ─── GRADE_SUBJECTS ─────────────────────────────────────────

describe('GRADE_SUBJECTS', () => {
  it('has entries for all 7 grades', () => {
    for (const grade of GRADES) {
      expect(GRADE_SUBJECTS[grade]).toBeDefined();
      expect(Array.isArray(GRADE_SUBJECTS[grade])).toBe(true);
      expect(GRADE_SUBJECTS[grade].length).toBeGreaterThan(0);
    }
  });

  it('every subject code maps to a valid SUBJECT_META entry', () => {
    const validCodes = SUBJECT_META.map(s => s.code);
    for (const grade of GRADES) {
      for (const code of GRADE_SUBJECTS[grade]) {
        expect(validCodes).toContain(code);
      }
    }
  });

  it('junior grades (6-8) include core subjects: math, science, english, hindi', () => {
    for (const grade of ['6', '7', '8']) {
      expect(GRADE_SUBJECTS[grade]).toContain('math');
      expect(GRADE_SUBJECTS[grade]).toContain('science');
      expect(GRADE_SUBJECTS[grade]).toContain('english');
      expect(GRADE_SUBJECTS[grade]).toContain('hindi');
    }
  });

  it('senior grades (11-12) include specialized subjects: physics, chemistry, biology', () => {
    for (const grade of ['11', '12']) {
      expect(GRADE_SUBJECTS[grade]).toContain('physics');
      expect(GRADE_SUBJECTS[grade]).toContain('chemistry');
      expect(GRADE_SUBJECTS[grade]).toContain('biology');
    }
  });

  it('junior grades do NOT include senior-only subjects', () => {
    for (const grade of ['6', '7', '8']) {
      expect(GRADE_SUBJECTS[grade]).not.toContain('physics');
      expect(GRADE_SUBJECTS[grade]).not.toContain('chemistry');
      expect(GRADE_SUBJECTS[grade]).not.toContain('biology');
      expect(GRADE_SUBJECTS[grade]).not.toContain('accountancy');
    }
  });

  it('has no duplicate subjects within any grade', () => {
    for (const grade of GRADES) {
      const subjects = GRADE_SUBJECTS[grade];
      const unique = new Set(subjects);
      expect(unique.size).toBe(subjects.length);
    }
  });
});

// ─── SUBJECT_META ───────────────────────────────────────────

describe('SUBJECT_META', () => {
  it('has at least 10 subjects', () => {
    expect(SUBJECT_META.length).toBeGreaterThanOrEqual(10);
  });

  it('codes are unique (no duplicates)', () => {
    const codes = SUBJECT_META.map(s => s.code);
    const unique = new Set(codes);
    expect(unique.size).toBe(codes.length);
  });

  it('every entry has required fields: code, name, icon, color', () => {
    for (const subject of SUBJECT_META) {
      expect(subject.code).toBeTruthy();
      expect(typeof subject.code).toBe('string');
      expect(subject.name).toBeTruthy();
      expect(typeof subject.name).toBe('string');
      expect(subject.icon).toBeTruthy();
      expect(subject.color).toBeTruthy();
    }
  });

  it('colors are valid hex color codes', () => {
    for (const subject of SUBJECT_META) {
      expect(subject.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('includes all core CBSE subjects', () => {
    const codes = SUBJECT_META.map(s => s.code);
    expect(codes).toContain('math');
    expect(codes).toContain('science');
    expect(codes).toContain('english');
    expect(codes).toContain('hindi');
    expect(codes).toContain('physics');
    expect(codes).toContain('chemistry');
    expect(codes).toContain('biology');
  });
});

// ─── getSubjectsForGrade ────────────────────────────────────

describe('getSubjectsForGrade', () => {
  it('returns valid subjects for each grade', () => {
    for (const grade of GRADES) {
      const subjects = getSubjectsForGrade(grade);
      expect(subjects.length).toBeGreaterThan(0);
      for (const subject of subjects) {
        expect(subject.code).toBeTruthy();
        expect(subject.name).toBeTruthy();
      }
    }
  });

  it('returns the correct number of subjects for grade 6', () => {
    const subjects = getSubjectsForGrade('6');
    expect(subjects).toHaveLength(GRADE_SUBJECTS['6'].length);
  });

  it('falls back to grade 9 subjects for invalid grade', () => {
    const subjects = getSubjectsForGrade('99');
    const grade9Subjects = getSubjectsForGrade('9');
    expect(subjects).toEqual(grade9Subjects);
  });

  it('handles "Grade 9" format by stripping prefix', () => {
    const subjects = getSubjectsForGrade('Grade 9');
    const expected = getSubjectsForGrade('9');
    expect(subjects).toEqual(expected);
  });

  it('each returned subject has code, name, icon, color', () => {
    const subjects = getSubjectsForGrade('10');
    for (const s of subjects) {
      expect(s).toHaveProperty('code');
      expect(s).toHaveProperty('name');
      expect(s).toHaveProperty('icon');
      expect(s).toHaveProperty('color');
    }
  });
});

// ─── ROLE_CONFIG ────────────────────────────────────────────

describe('ROLE_CONFIG', () => {
  it('has all required roles: student, teacher, guardian, none', () => {
    expect(ROLE_CONFIG.student).toBeDefined();
    expect(ROLE_CONFIG.teacher).toBeDefined();
    expect(ROLE_CONFIG.guardian).toBeDefined();
    expect(ROLE_CONFIG.none).toBeDefined();
  });

  it('each role has label, labelHi, icon, color, homePath, nav', () => {
    for (const role of ['student', 'teacher', 'guardian', 'none'] as const) {
      const config = ROLE_CONFIG[role];
      expect(config.label).toBeTruthy();
      expect(config.labelHi).toBeTruthy();
      expect(config.icon).toBeTruthy();
      expect(config.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(typeof config.homePath).toBe('string');
      expect(Array.isArray(config.nav)).toBe(true);
    }
  });

  it('student role has the most navigation items', () => {
    expect(ROLE_CONFIG.student.nav.length).toBeGreaterThan(ROLE_CONFIG.teacher.nav.length);
    expect(ROLE_CONFIG.student.nav.length).toBeGreaterThan(ROLE_CONFIG.guardian.nav.length);
  });

  it('none (guest) role has empty navigation', () => {
    expect(ROLE_CONFIG.none.nav).toHaveLength(0);
  });

  it('student home is /dashboard', () => {
    expect(ROLE_CONFIG.student.homePath).toBe('/dashboard');
  });

  it('teacher home is /teacher', () => {
    expect(ROLE_CONFIG.teacher.homePath).toBe('/teacher');
  });

  it('guardian home is /parent', () => {
    expect(ROLE_CONFIG.guardian.homePath).toBe('/parent');
  });

  it('nav items have href, icon, label, labelHi', () => {
    for (const role of ['student', 'teacher', 'guardian'] as const) {
      for (const item of ROLE_CONFIG[role].nav) {
        expect(item.href).toBeTruthy();
        expect(item.href.startsWith('/')).toBe(true);
        expect(item.icon).toBeTruthy();
        expect(item.label).toBeTruthy();
        expect(item.labelHi).toBeTruthy();
      }
    }
  });
});

// ─── FOXY_MODES ─────────────────────────────────────────────

describe('FOXY_MODES', () => {
  it('has at least 4 modes', () => {
    expect(FOXY_MODES.length).toBeGreaterThanOrEqual(4);
  });

  it('includes learn, doubt, quiz, revise', () => {
    const ids = FOXY_MODES.map(m => m.id);
    expect(ids).toContain('learn');
    expect(ids).toContain('doubt');
    expect(ids).toContain('quiz');
    expect(ids).toContain('revise');
  });

  it('each mode has id, label, labelHi, icon, desc', () => {
    for (const mode of FOXY_MODES) {
      expect(mode.id).toBeTruthy();
      expect(mode.label).toBeTruthy();
      expect(mode.labelHi).toBeTruthy();
      expect(mode.icon).toBeTruthy();
      expect(mode.desc).toBeTruthy();
    }
  });

  it('Hindi labels contain Hindi characters', () => {
    for (const mode of FOXY_MODES) {
      expect(mode.labelHi).toMatch(/[^\x00-\x7F]/);
    }
  });
});

// ─── BLOOM_LEVELS (from constants.ts) ───────────────────────

describe('BLOOM_LEVELS (constants)', () => {
  it('has exactly 6 levels', () => {
    expect(BLOOM_LEVELS).toHaveLength(6);
  });

  it('levels are in correct order with sequential order values', () => {
    for (let i = 0; i < BLOOM_LEVELS.length; i++) {
      expect(BLOOM_LEVELS[i].order).toBe(i);
    }
  });

  it('each level has id, label, labelHi, color, icon, order', () => {
    for (const level of BLOOM_LEVELS) {
      expect(level.id).toBeTruthy();
      expect(level.label).toBeTruthy();
      expect(level.labelHi).toBeTruthy();
      expect(level.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(level.icon).toBeTruthy();
      expect(typeof level.order).toBe('number');
    }
  });

  it('first level is remember, last is create', () => {
    expect(BLOOM_LEVELS[0].id).toBe('remember');
    expect(BLOOM_LEVELS[5].id).toBe('create');
  });
});

// ─── MASTERY_LEVELS ─────────────────────────────────────────

describe('MASTERY_LEVELS', () => {
  it('has 5 levels', () => {
    expect(MASTERY_LEVELS).toHaveLength(5);
  });

  it('starts with not_started and ends with mastered', () => {
    expect(MASTERY_LEVELS[0].id).toBe('not_started');
    expect(MASTERY_LEVELS[4].id).toBe('mastered');
  });

  it('each level has id, label, labelHi, color, icon', () => {
    for (const level of MASTERY_LEVELS) {
      expect(level.id).toBeTruthy();
      expect(level.label).toBeTruthy();
      expect(level.labelHi).toBeTruthy();
      expect(level.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(level.icon).toBeTruthy();
    }
  });
});

// ─── QUIZ_MODES ─────────────────────────────────────────────

describe('QUIZ_MODES', () => {
  it('has 3 modes: practice, cognitive, board', () => {
    const ids = QUIZ_MODES.map(m => m.id);
    expect(ids).toContain('practice');
    expect(ids).toContain('cognitive');
    expect(ids).toContain('board');
    expect(QUIZ_MODES).toHaveLength(3);
  });

  it('each mode has bilingual labels and descriptions', () => {
    for (const mode of QUIZ_MODES) {
      expect(mode.label).toBeTruthy();
      expect(mode.labelHi).toBeTruthy();
      expect(mode.desc).toBeTruthy();
      expect(mode.descHi).toBeTruthy();
      expect(mode.icon).toBeTruthy();
    }
  });
});

// ─── Other Constants ────────────────────────────────────────

describe('BOARDS', () => {
  it('includes CBSE as the first option', () => {
    expect(BOARDS[0]).toBe('CBSE');
  });

  it('includes ICSE', () => {
    expect(BOARDS).toContain('ICSE');
  });
});

describe('LANGUAGES', () => {
  it('includes English and Hindi', () => {
    const codes = LANGUAGES.map(l => l.code);
    expect(codes).toContain('en');
    expect(codes).toContain('hi');
  });

  it('each language has code, label, and native label', () => {
    for (const lang of LANGUAGES) {
      expect(lang.code).toBeTruthy();
      expect(lang.label).toBeTruthy();
      expect(lang.labelNative).toBeTruthy();
    }
  });
});

describe('ASSIGNMENT_TYPES', () => {
  it('includes practice and quiz types', () => {
    const ids = ASSIGNMENT_TYPES.map(a => a.id);
    expect(ids).toContain('practice');
    expect(ids).toContain('quiz');
  });
});

describe('CBSE_QUESTION_TYPES', () => {
  it('includes MCQ with 1 mark', () => {
    const mcq = CBSE_QUESTION_TYPES.find(q => q.id === 'mcq');
    expect(mcq).toBeDefined();
    expect(mcq!.marks).toBe(1);
  });

  it('includes case_based with 4 marks', () => {
    const cb = CBSE_QUESTION_TYPES.find(q => q.id === 'case_based');
    expect(cb).toBeDefined();
    expect(cb!.marks).toBe(4);
  });
});

describe('EXAM_TYPES', () => {
  it('includes unit_test, half_yearly, and annual', () => {
    const ids = EXAM_TYPES.map(e => e.id);
    expect(ids).toContain('unit_test');
    expect(ids).toContain('half_yearly');
    expect(ids).toContain('annual');
  });

  it('each exam type has duration in minutes', () => {
    for (const exam of EXAM_TYPES) {
      expect(exam.duration).toBeGreaterThan(0);
    }
  });
});

describe('CBSE_SECTIONS', () => {
  it('has 5 sections (A through E)', () => {
    expect(CBSE_SECTIONS).toHaveLength(5);
    expect(CBSE_SECTIONS.map(s => s.id)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('total marks across all sections is 90', () => {
    const total = CBSE_SECTIONS.reduce((sum, s) => sum + s.marks, 0);
    expect(total).toBe(90);
  });
});

describe('BOARD_EXAM_YEARS', () => {
  it('is sorted in descending order (most recent first)', () => {
    for (let i = 0; i < BOARD_EXAM_YEARS.length - 1; i++) {
      expect(BOARD_EXAM_YEARS[i]).toBeGreaterThan(BOARD_EXAM_YEARS[i + 1]);
    }
  });

  it('includes 2024 as most recent year', () => {
    expect(BOARD_EXAM_YEARS[0]).toBe(2024);
  });
});

describe('IMAGE_TYPES', () => {
  it('includes assignment and question_paper', () => {
    const ids = IMAGE_TYPES.map(t => t.id);
    expect(ids).toContain('assignment');
    expect(ids).toContain('question_paper');
  });

  it('each type has bilingual labels', () => {
    for (const type of IMAGE_TYPES) {
      expect(type.label).toBeTruthy();
      expect(type.labelHi).toBeTruthy();
    }
  });
});
