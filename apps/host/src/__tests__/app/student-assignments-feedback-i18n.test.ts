/**
 * P7 (Phase 3 item 3.10) — teacher-feedback language-aware display.
 *
 * The student assignments page renders a single teacher-feedback line per
 * graded assignment. Before this change it showed the English
 * `teacher_feedback` verbatim regardless of the student's language. It now
 * picks the Hindi variant (`teacher_feedback_hi`) when the student prefers
 * Hindi AND a Hindi variant exists, and falls back to English otherwise.
 *
 * This pins the fallback matrix so a Hindi-preferring student with no Hindi
 * variant still sees the English feedback (never a blank box).
 */

import { describe, it, expect } from 'vitest';
import { pickTeacherFeedback } from '@/lib/assignment-feedback';

describe('pickTeacherFeedback — P7 language-aware fallback', () => {
  it('Hindi student + Hindi variant present → shows Hindi', () => {
    expect(pickTeacherFeedback(true, 'Great work', 'बहुत बढ़िया')).toBe('बहुत बढ़िया');
  });

  it('Hindi student + NO Hindi variant → falls back to English (never blank)', () => {
    expect(pickTeacherFeedback(true, 'Great work', null)).toBe('Great work');
    expect(pickTeacherFeedback(true, 'Great work', '')).toBe('Great work');
    expect(pickTeacherFeedback(true, 'Great work', '   ')).toBe('Great work');
  });

  it('English student → always shows English, even when a Hindi variant exists', () => {
    expect(pickTeacherFeedback(false, 'Great work', 'बहुत बढ़िया')).toBe('Great work');
  });

  it('English student + no English but Hindi exists → still shows the Hindi (never hide feedback)', () => {
    // Edge case: a teacher filled only the Hindi box. An English-preferring
    // student should still see *some* feedback rather than nothing.
    expect(pickTeacherFeedback(false, null, 'बहुत बढ़िया')).toBe('बहुत बढ़िया');
  });

  it('no feedback in either language → returns null so the caller renders nothing', () => {
    expect(pickTeacherFeedback(true, null, null)).toBeNull();
    expect(pickTeacherFeedback(false, '', '')).toBeNull();
    expect(pickTeacherFeedback(true, '   ', '   ')).toBeNull();
    expect(pickTeacherFeedback(false, undefined, undefined)).toBeNull();
  });
});
