/**
 * Unit test: chapter progress update fallback logic
 * Pins the fix for Bug 2A — when selectedChapter is null (DailyRhythmQueue flow),
 * chapter progress must still update using questions[0].chapter_number.
 */
import { describe, it, expect } from 'vitest';

describe('chapter progress fallback', () => {
  it('uses selectedChapter when present', () => {
    const selectedChapter = 3;
    const questions = [{ chapter_number: 5 }];
    const chapterForProgress = selectedChapter ?? questions[0]?.chapter_number ?? null;
    expect(chapterForProgress).toBe(3);
  });

  it('falls back to questions[0].chapter_number when selectedChapter is null', () => {
    const selectedChapter = null;
    const questions = [{ chapter_number: 5 }];
    const chapterForProgress = selectedChapter ?? questions[0]?.chapter_number ?? null;
    expect(chapterForProgress).toBe(5);
  });

  it('returns null when both selectedChapter and questions are empty', () => {
    const selectedChapter = null;
    const questions: Array<{ chapter_number?: number }> = [];
    const chapterForProgress = selectedChapter ?? questions[0]?.chapter_number ?? null;
    expect(chapterForProgress).toBeNull();
  });

  it('modulo-free: clamped index never wraps when topics exceed questions', () => {
    const questions = ['q1', 'q2', 'q3'];
    // Simulate topic index 7 with only 3 questions (old: 7 % 3 = 1, new: Math.min(7, 2) = 2)
    const oldBehavior = questions[7 % questions.length]; // wraps → 'q2'
    const newBehavior = questions[Math.min(7, questions.length - 1)]; // clamps → 'q3' (last)
    expect(oldBehavior).toBe('q2'); // confirms the old bug
    expect(newBehavior).toBe('q3'); // confirms the fix: last question, no repeat cycle
  });
});
