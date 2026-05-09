import { describe, it, expect } from 'vitest';
import { dueReviewsToCards, type DueReviewRow } from '../learn/due-reviews-adapter';

describe('dueReviewsToCards', () => {
  it('emits one DueSm2Card per row when a question mapping exists', () => {
    const rows: DueReviewRow[] = [
      { topic_id: 't1', mastery_probability: 0.2, last_attempted_at: null, review_interval_days: 1 },
      { topic_id: 't2', mastery_probability: 0.5, last_attempted_at: null, review_interval_days: 1 },
    ];
    const out = dueReviewsToCards({
      rows,
      conceptToQuestion: new Map([['t1', 'q1'], ['t2', 'q2']]),
      aheadOfGradeConceptIds: new Set(),
    });
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.questionId).sort()).toEqual(['q1', 'q2']);
    expect(out.map((c) => c.topicId).sort()).toEqual(['t1', 't2']);
  });

  it('flags ahead-of-grade concepts when listed in the set', () => {
    const rows: DueReviewRow[] = [
      { topic_id: 't1', mastery_probability: 0.3, last_attempted_at: null, review_interval_days: 1 },
    ];
    const out = dueReviewsToCards({
      rows,
      conceptToQuestion: new Map([['t1', 'q1']]),
      aheadOfGradeConceptIds: new Set(['t1']),
    });
    expect(out[0].isAheadOfGrade).toBe(true);
  });

  it('orders by mastery_probability ascending (most-forgotten first)', () => {
    const rows: DueReviewRow[] = [
      { topic_id: 't1', mastery_probability: 0.6, last_attempted_at: null, review_interval_days: 7 },
      { topic_id: 't2', mastery_probability: 0.1, last_attempted_at: null, review_interval_days: 1 },
      { topic_id: 't3', mastery_probability: 0.4, last_attempted_at: null, review_interval_days: 3 },
    ];
    const out = dueReviewsToCards({
      rows,
      conceptToQuestion: new Map([['t1', 'q1'], ['t2', 'q2'], ['t3', 'q3']]),
      aheadOfGradeConceptIds: new Set(),
    });
    expect(out.map((c) => c.questionId)).toEqual(['q2', 'q3', 'q1']);
  });

  it('drops rows that have no mapped question (skips silently)', () => {
    const rows: DueReviewRow[] = [
      { topic_id: 't1', mastery_probability: 0.2, last_attempted_at: null, review_interval_days: 1 },
      { topic_id: 'tX', mastery_probability: 0.2, last_attempted_at: null, review_interval_days: 1 },
    ];
    const out = dueReviewsToCards({
      rows,
      conceptToQuestion: new Map([['t1', 'q1']]),
      aheadOfGradeConceptIds: new Set(),
    });
    expect(out).toHaveLength(1);
    expect(out[0].questionId).toBe('q1');
  });

  it('handles null mastery_probability by treating it as 1.0 (least forgotten, sorted last)', () => {
    const rows: DueReviewRow[] = [
      { topic_id: 't1', mastery_probability: null, last_attempted_at: null, review_interval_days: 1 },
      { topic_id: 't2', mastery_probability: 0.3, last_attempted_at: null, review_interval_days: 1 },
    ];
    const out = dueReviewsToCards({
      rows,
      conceptToQuestion: new Map([['t1', 'q1'], ['t2', 'q2']]),
      aheadOfGradeConceptIds: new Set(),
    });
    expect(out.map((c) => c.questionId)).toEqual(['q2', 'q1']);
  });

  it('returns empty array when input rows is empty', () => {
    const out = dueReviewsToCards({
      rows: [],
      conceptToQuestion: new Map(),
      aheadOfGradeConceptIds: new Set(),
    });
    expect(out).toEqual([]);
  });
});
