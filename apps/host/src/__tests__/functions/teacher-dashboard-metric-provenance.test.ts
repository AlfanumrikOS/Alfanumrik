import { describe, expect, it } from 'vitest';

import {
  averageFractionsAsPercent,
  averagePercentages,
  averageScopedMasteryByStudent,
  finiteMetricOrNull,
  resolveClassCurriculumScope,
} from '../../../../../supabase/functions/teacher-dashboard/metrics';

describe('teacher-dashboard metric provenance', () => {
  it('distinguishes an observed zero from an unavailable value', () => {
    expect(finiteMetricOrNull(null)).toBeNull();
    expect(finiteMetricOrNull(undefined)).toBeNull();
    expect(finiteMetricOrNull('')).toBeNull();
    expect(finiteMetricOrNull(0)).toBe(0);
  });

  it('averages only canonical mastery samples and keeps an empty signal null', () => {
    expect(averageFractionsAsPercent([])).toBeNull();
    expect(averageFractionsAsPercent([null, undefined])).toBeNull();
    expect(averageFractionsAsPercent([0.8, null, 0.6])).toBe(70);
    expect(averageFractionsAsPercent([0])).toBe(0);
  });

  it('preserves null when no class-level mastery percentages are observed', () => {
    expect(averagePercentages([null, undefined])).toBeNull();
    expect(averagePercentages([80, null, 60])).toBe(70);
  });

  it('keeps the owned class grade while allowing only a teacher-assigned subject', () => {
    expect(resolveClassCurriculumScope(
      'class-1',
      'Grade 7',
      'science',
      'math',
      ['math', 'science'],
    )).toEqual({ grade: '7', subjectCode: 'math' });

    expect(resolveClassCurriculumScope(
      'class-1',
      '7',
      'science',
      'history',
      ['math', 'science'],
    )).toEqual({ grade: '7', subjectCode: null });

    expect(resolveClassCurriculumScope(
      'class-1',
      '7',
      'science',
      'history',
      [],
    )).toEqual({ grade: '7', subjectCode: null });

    expect(resolveClassCurriculumScope(
      'grade-8',
      null,
      null,
      undefined,
      ['science'],
    )).toEqual({ grade: '8', subjectCode: 'science' });
  });

  it('excludes mastery samples outside the class curriculum topic set', () => {
    const averages = averageScopedMasteryByStudent(
      ['student-1', 'student-2'],
      ['topic-in-scope'],
      [
        { student_id: 'student-1', topic_id: 'topic-in-scope', p_know: 0.6 },
        { student_id: 'student-1', topic_id: 'other-subject-topic', p_know: 1 },
        { student_id: 'student-2', topic_id: 'other-subject-topic', p_know: 0.9 },
      ],
    );

    expect(averages.get('student-1')).toBe(60);
    expect(averages.get('student-2')).toBeNull();
  });
});
