import { describe, expect, it } from 'vitest';
import { buildFallbackStudentSnapshot, normalizeStudentSnapshot } from '@alfanumrik/lib/student-snapshot';

describe('student snapshot honest-data adapter', () => {
  it('preserves genuine zero values from the snapshot RPC', () => {
    expect(normalizeStudentSnapshot({
      total_xp: 0,
      current_streak: 0,
      topics_mastered: 0,
      topics_in_progress: 0,
      quizzes_taken: 0,
      avg_score: 0,
    })).toEqual({
      total_xp: 0,
      current_streak: 0,
      topics_mastered: 0,
      topics_in_progress: 0,
      quizzes_taken: 0,
      avg_score: 0,
    });
  });

  it('keeps absent and failed fallback fields unavailable instead of fabricating zero', () => {
    expect(buildFallbackStudentSnapshot({
      profilesResult: { data: null, error: new Error('unavailable') },
      masteredResult: { count: null, error: new Error('unavailable') },
      inProgressResult: { count: null, error: new Error('unavailable') },
      quizzesResult: { count: null, error: new Error('unavailable') },
    })).toEqual({
      total_xp: null,
      current_streak: null,
      topics_mastered: null,
      topics_in_progress: null,
      quizzes_taken: null,
      avg_score: null,
    });
  });

  it('preserves legitimate empty counts while leaving an undefined average unavailable', () => {
    expect(buildFallbackStudentSnapshot({
      profilesResult: { data: [] },
      masteredResult: { count: 0 },
      inProgressResult: { count: 0 },
      quizzesResult: { count: 0 },
    })).toEqual({
      total_xp: 0,
      current_streak: 0,
      topics_mastered: 0,
      topics_in_progress: 0,
      quizzes_taken: 0,
      avg_score: null,
    });
  });
});
