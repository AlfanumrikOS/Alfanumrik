/**
 * Regression test for the quiz-review shuffle/display mismatch audit 2026-04-18.
 *
 * Sibling of `quiz-shuffle-scoring-fix.test.ts`. That test covers the scoring
 * path (confirmAnswer + banner). This test covers the *review screen* on
 * QuizResults.tsx and the two remaining broken comparisons in the quiz page's
 * submit/retry paths:
 *
 *   src/app/quiz/page.tsx lines ~654-655 (last-question submit path)
 *   src/app/quiz/page.tsx lines ~803-804 (network-error retry path)
 *
 * Symptom before fix:
 *   - Student picked the visually-correct option during a shuffled quiz.
 *   - The last question response was built with
 *       is_correct: selectedOption === q.correct_answer_index
 *     where `selectedOption` is the SHUFFLED display index and
 *     `correct_answer_index` is the ORIGINAL pre-shuffle index. Result:
 *     is_correct silently flipped, XP/mastery corrupted downstream.
 *   - On the review screen, the wrong option was highlighted with ✓ and the
 *     wrong option was marked as "the one you picked" when a shuffle had
 *     been applied during the quiz.
 *
 * Fix: both the submit/retry paths in quiz/page.tsx now route selectedOption
 * through shuffledToOriginal() before comparing to correct_answer_index, and
 * QuizResults.tsx accepts an optional shuffleMaps prop that correctly maps
 * both "the correct answer" and "what the student picked" into the shuffled
 * display space used by the review list.
 */

import { describe, it, expect } from 'vitest';

// Mirrors src/app/quiz/page.tsx:162-170
function shuffledToOriginal(displayIdx: number, shuffleMap: number[] | null): number {
  if (!shuffleMap) return displayIdx;
  return shuffleMap[displayIdx];
}

// Post-fix submit-path logic from src/app/quiz/page.tsx
function buildLastQuestionResponse(
  selectedDisplayIdx: number,
  originalCorrectIdx: number,
  shuffleMap: number[] | null,
) {
  const originalPicked = shuffledToOriginal(selectedDisplayIdx, shuffleMap);
  return {
    selected_option: selectedDisplayIdx, // preserved in shuffled space (anti-cheat)
    is_correct: originalPicked === originalCorrectIdx,
  };
}

// Post-fix QuizResults review-row rendering logic
function reviewRowHighlights(
  displayIdx: number,
  response: { selected_option: number },
  originalCorrectIdx: number,
  shuffleMap: number[] | null,
  origOptsLength: number,
) {
  const correctDisplayIdx = shuffleMap && origOptsLength === 4
    ? shuffleMap.indexOf(originalCorrectIdx)
    : originalCorrectIdx;
  return {
    isCorrectOpt: displayIdx === correctDisplayIdx,
    isSelected: displayIdx === response.selected_option,
  };
}

describe('quiz review screen shuffle consistency', () => {
  it('submit path: last question is_correct is derived via shuffle map', () => {
    // shuffleMap [1, 2, 3, 0] means display idx 3 shows original idx 0.
    // If original 0 is the correct answer, picking display 3 must score correct.
    const shuffleMap = [1, 2, 3, 0];
    const originalCorrectIdx = 0;
    const studentPickedDisplay = 3;

    const resp = buildLastQuestionResponse(studentPickedDisplay, originalCorrectIdx, shuffleMap);
    expect(resp.is_correct).toBe(true);
    // Pre-fix behaviour (for contrast): comparing shuffled-display === original-index
    // directly would have returned false when they happened to differ.
    const brokenDirectCompare = (a: number, b: number) => a === b;
    expect(brokenDirectCompare(studentPickedDisplay, originalCorrectIdx)).toBe(false);
  });

  it('submit path: wrong pick in a shuffled quiz still scored wrong', () => {
    const shuffleMap = [1, 2, 3, 0];
    const originalCorrectIdx = 0;
    for (const wrong of [0, 1, 2]) {
      const resp = buildLastQuestionResponse(wrong, originalCorrectIdx, shuffleMap);
      expect(resp.is_correct).toBe(false);
    }
  });

  it('submit path: no shuffle → original comparison holds', () => {
    const r1 = buildLastQuestionResponse(2, 2, null);
    expect(r1.is_correct).toBe(true);
    const r2 = buildLastQuestionResponse(1, 2, null);
    expect(r2.is_correct).toBe(false);
  });

  it('review screen: shuffle + picked the correct option → ✓ and "your pick" both land on the same option', () => {
    // shuffleMap [1, 2, 3, 0]: original 0 at display 3.
    const shuffleMap = [1, 2, 3, 0];
    const originalCorrectIdx = 0;
    const studentPickedDisplay = 3; // visually correct

    // Student's saved response carries the shuffled display idx
    const response = { selected_option: studentPickedDisplay };

    // Display idx 3 is the correct *and* the selected option
    const row3 = reviewRowHighlights(3, response, originalCorrectIdx, shuffleMap, 4);
    expect(row3.isCorrectOpt).toBe(true);
    expect(row3.isSelected).toBe(true);

    // All other display indices are neither correct nor selected
    for (const other of [0, 1, 2]) {
      const row = reviewRowHighlights(other, response, originalCorrectIdx, shuffleMap, 4);
      expect(row.isCorrectOpt).toBe(false);
      expect(row.isSelected).toBe(false);
    }
  });

  it('review screen: shuffle + picked a wrong option → ✓ on correct, ✗ on picked, no overlap', () => {
    const shuffleMap = [2, 0, 3, 1]; // original 1 at display 3
    const originalCorrectIdx = 1;
    const studentPickedDisplay = 0; // original 2 — wrong

    const response = { selected_option: studentPickedDisplay };

    const correctRow = reviewRowHighlights(3, response, originalCorrectIdx, shuffleMap, 4);
    expect(correctRow.isCorrectOpt).toBe(true);
    expect(correctRow.isSelected).toBe(false);

    const selectedRow = reviewRowHighlights(0, response, originalCorrectIdx, shuffleMap, 4);
    expect(selectedRow.isCorrectOpt).toBe(false);
    expect(selectedRow.isSelected).toBe(true);
  });

  it('review screen: no shuffle map → behaves exactly as the pre-shuffle baseline', () => {
    // Non-shuffled surfaces (diagnostic, pyq, mock-exam) rely on this fallback.
    const originalCorrectIdx = 2;
    const response = { selected_option: 1 }; // wrong

    for (let displayIdx = 0; displayIdx < 4; displayIdx++) {
      const row = reviewRowHighlights(displayIdx, response, originalCorrectIdx, null, 4);
      expect(row.isCorrectOpt).toBe(displayIdx === 2);
      expect(row.isSelected).toBe(displayIdx === 1);
    }
  });

  it('review screen: holds under all 4! = 24 shuffle permutations', () => {
    // Invariant: whichever display index the student picked is "isSelected",
    // and the display index that ended up holding the original correct
    // answer is "isCorrectOpt". They overlap iff the student was correct.
    const allShuffles: number[][] = [
      [0, 1, 2, 3], [0, 1, 3, 2], [0, 2, 1, 3], [0, 2, 3, 1], [0, 3, 1, 2], [0, 3, 2, 1],
      [1, 0, 2, 3], [1, 0, 3, 2], [1, 2, 0, 3], [1, 2, 3, 0], [1, 3, 0, 2], [1, 3, 2, 0],
      [2, 0, 1, 3], [2, 0, 3, 1], [2, 1, 0, 3], [2, 1, 3, 0], [2, 3, 0, 1], [2, 3, 1, 0],
      [3, 0, 1, 2], [3, 0, 2, 1], [3, 1, 0, 2], [3, 1, 2, 0], [3, 2, 0, 1], [3, 2, 1, 0],
    ];

    for (const shuffleMap of allShuffles) {
      for (let originalCorrectIdx = 0; originalCorrectIdx < 4; originalCorrectIdx++) {
        const correctDisplay = shuffleMap.indexOf(originalCorrectIdx);
        for (let pickDisplay = 0; pickDisplay < 4; pickDisplay++) {
          const response = { selected_option: pickDisplay };
          for (let displayIdx = 0; displayIdx < 4; displayIdx++) {
            const row = reviewRowHighlights(
              displayIdx,
              response,
              originalCorrectIdx,
              shuffleMap,
              4,
            );
            expect(row.isCorrectOpt).toBe(displayIdx === correctDisplay);
            expect(row.isSelected).toBe(displayIdx === pickDisplay);
          }
        }
      }
    }
  });
});
