/**
 * Exhaustive tests for the Phase 0 Adaptive Tutor picker. The resolver is
 * pure, so the entire decision tree is testable without Supabase.
 */

import { describe, it, expect } from 'vitest';
import { resolveNextConcept } from '@alfanumrik/lib/tutor/resolve-next-concept';
import { MASTERY_THRESHOLD, type TutorConceptRow, type ConceptMasteryRow } from '@alfanumrik/lib/tutor/types';

const concept = (
  id: string,
  subject: string,
  chapter: number,
  conceptNum: number,
  title = `Concept ${id}`,
): TutorConceptRow => ({
  id,
  grade: '7',
  subject,
  chapter_number: chapter,
  chapter_title: null,
  concept_number: conceptNum,
  title,
  title_hi: null,
  explanation: 'x'.repeat(200),
  explanation_hi: null,
  example_content: null,
  example_content_hi: null,
  key_formula: null,
  practice_question: 'q',
  practice_options: ['a', 'b', 'c', 'd'],
  practice_correct_index: 0,
  practice_explanation: 'e',
  practice_explanation_hi: null,
  difficulty: 1,
  bloom_level: 'understand',
  estimated_minutes: 5,
});

const mastery = (concept_id: string, mean: number | null): ConceptMasteryRow => ({
  concept_id,
  mastery_mean: mean,
  last_practiced_at: null,
});

describe('resolveNextConcept', () => {
  it('returns no_content when the student\'s grade has zero concepts', () => {
    const r = resolveNextConcept({
      conceptsInGrade: [],
      masteryRows: [],
    });
    expect(r.status).toBe('no_content');
    expect(r.reason).toBe('no_concepts_for_grade');
    expect(r.progress).toEqual({ mastered: 0, total: 0 });
  });

  it('returns the first concept when the student has zero mastery rows', () => {
    const concepts = [
      concept('c1', 'math', 1, 1),
      concept('c2', 'math', 1, 2),
      concept('c3', 'math', 1, 3),
    ];
    const r = resolveNextConcept({ conceptsInGrade: concepts, masteryRows: [] });
    expect(r.status).toBe('next_concept');
    expect(r.concept?.id).toBe('c1');
    expect(r.progress).toEqual({ mastered: 0, total: 3 });
  });

  it('skips concepts whose mastery_mean is at or above threshold', () => {
    const concepts = [
      concept('c1', 'math', 1, 1),
      concept('c2', 'math', 1, 2),
      concept('c3', 'math', 1, 3),
    ];
    const r = resolveNextConcept({
      conceptsInGrade: concepts,
      masteryRows: [
        mastery('c1', MASTERY_THRESHOLD),       // exactly mastered
        mastery('c2', MASTERY_THRESHOLD + 0.05),
      ],
    });
    expect(r.concept?.id).toBe('c3');
    expect(r.progress).toEqual({ mastered: 2, total: 3 });
  });

  it('treats a concept with mastery_mean below threshold as un-mastered', () => {
    const concepts = [concept('c1', 'math', 1, 1), concept('c2', 'math', 1, 2)];
    const r = resolveNextConcept({
      conceptsInGrade: concepts,
      masteryRows: [mastery('c1', MASTERY_THRESHOLD - 0.01)],
    });
    expect(r.concept?.id).toBe('c1');
    expect(r.progress).toEqual({ mastered: 0, total: 2 });
  });

  it('treats null mastery_mean as un-mastered (e.g. row written but BKT not yet updated)', () => {
    const concepts = [concept('c1', 'math', 1, 1)];
    const r = resolveNextConcept({
      conceptsInGrade: concepts,
      masteryRows: [mastery('c1', null)],
    });
    expect(r.concept?.id).toBe('c1');
  });

  it('falls through across subjects when one subject is fully mastered', () => {
    const concepts = [
      concept('m1', 'math', 1, 1),
      concept('m2', 'math', 1, 2),
      concept('s1', 'science', 1, 1),
    ];
    const r = resolveNextConcept({
      conceptsInGrade: concepts,
      masteryRows: [
        mastery('m1', 0.95),
        mastery('m2', 0.92),
      ],
    });
    expect(r.concept?.id).toBe('s1');
  });

  it('returns grade_complete when every concept is mastered', () => {
    const concepts = [concept('c1', 'math', 1, 1), concept('c2', 'science', 1, 1)];
    const r = resolveNextConcept({
      conceptsInGrade: concepts,
      masteryRows: [mastery('c1', 0.95), mastery('c2', 0.99)],
    });
    expect(r.status).toBe('grade_complete');
    expect(r.reason).toBe('no_unmastered_concepts');
    expect(r.concept).toBeUndefined();
    expect(r.progress).toEqual({ mastered: 2, total: 2 });
  });

  it('honors currentChapterHint: continues mid-chapter even when an earlier-sorted chapter has unmastered concepts', () => {
    // Math ch.1 first concept (m11) is un-mastered but the student is
    // currently mid-way through math ch.2 (m21 mastered, m22 not). We
    // should land on m22, not jump back to m11.
    const concepts = [
      concept('m11', 'math', 1, 1),
      concept('m12', 'math', 1, 2),
      concept('m21', 'math', 2, 1),
      concept('m22', 'math', 2, 2),
    ];
    const r = resolveNextConcept({
      conceptsInGrade: concepts,
      masteryRows: [mastery('m21', 0.95)],
      currentChapterHint: { subject: 'math', chapter_number: 2 },
    });
    expect(r.concept?.id).toBe('m22');
  });

  it('hint falls through to grade-wide scan when the hinted chapter is fully mastered', () => {
    const concepts = [
      concept('m11', 'math', 1, 1),
      concept('m21', 'math', 2, 1),
    ];
    const r = resolveNextConcept({
      conceptsInGrade: concepts,
      masteryRows: [mastery('m21', 0.95)],
      currentChapterHint: { subject: 'math', chapter_number: 2 },
    });
    expect(r.concept?.id).toBe('m11');
  });

  it('respects the caller-provided sort order (it does not re-sort)', () => {
    // Caller wants science before math today (e.g. exam-prep mode).
    // Resolver must honor that ordering.
    const concepts = [
      concept('s1', 'science', 1, 1),
      concept('m1', 'math', 1, 1),
    ];
    const r = resolveNextConcept({ conceptsInGrade: concepts, masteryRows: [] });
    expect(r.concept?.id).toBe('s1');
  });

  it('ignores mastery rows for concepts not in the student\'s grade', () => {
    const concepts = [concept('c1', 'math', 1, 1)];
    const r = resolveNextConcept({
      conceptsInGrade: concepts,
      masteryRows: [
        mastery('c1', 0.95),
        mastery('other-grade-concept', 0.95),  // noise — must not affect counts
      ],
    });
    expect(r.status).toBe('grade_complete');
    expect(r.progress).toEqual({ mastered: 1, total: 1 });
  });
});
