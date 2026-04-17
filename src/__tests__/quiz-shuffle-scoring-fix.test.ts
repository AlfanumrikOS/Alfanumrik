/**
 * Regression test for the quiz shuffle/scoring mismatch bug surfaced 2026-04-18.
 *
 * Symptom: student picks the visually-correct option (green-checkmarked), but
 * the banner says "Incorrect" and the score is 0/1. XP/mastery downstream are
 * all corrupted by the wrong `is_correct` flag.
 *
 * Root cause: `selectedOption` stores the SHUFFLED display index (what the
 * student clicked), but scoring compared it directly to `q.correct_answer_index`
 * which is the ORIGINAL pre-shuffle index. Meanwhile, the green-check render
 * correctly used `originalToShuffled` to map into the shuffled space.
 *
 * Fix: scoring must map `selectedOption` through `shuffledToOriginal` before
 * comparing to `q.correct_answer_index`. See src/app/quiz/page.tsx:453 and 950.
 *
 * This test re-implements the pure comparison logic exported from the page and
 * verifies the contract holds under all shuffle permutations.
 */

import { describe, it, expect } from 'vitest';

// Mirrors src/app/quiz/page.tsx:162-170
function shuffledToOriginal(displayIdx: number, shuffleMap: number[] | null): number {
  if (!shuffleMap) return displayIdx;
  return shuffleMap[displayIdx];
}

function originalToShuffled(origIdx: number, shuffleMap: number[] | null): number {
  if (!shuffleMap) return origIdx;
  return shuffleMap.indexOf(origIdx);
}

// After fix: the scoring logic used in confirmAnswer() + render banner
function scoreAnswer(
  selectedDisplayIdx: number,
  originalCorrectIdx: number,
  shuffleMap: number[] | null,
): boolean {
  const originalPicked = shuffledToOriginal(selectedDisplayIdx, shuffleMap);
  return originalPicked === originalCorrectIdx;
}

// The rendering logic that shows the green check + ✓ on the correct option
function isDisplayPositionCorrect(
  displayIdx: number,
  originalCorrectIdx: number,
  shuffleMap: number[] | null,
): boolean {
  return displayIdx === originalToShuffled(originalCorrectIdx, shuffleMap);
}

describe('quiz shuffle/scoring consistency (P1 invariant)', () => {
  it('no shuffle: correct pick scores correct', () => {
    expect(scoreAnswer(2, 2, null)).toBe(true);
    expect(isDisplayPositionCorrect(2, 2, null)).toBe(true);
  });

  it('no shuffle: wrong pick scores wrong', () => {
    expect(scoreAnswer(1, 2, null)).toBe(false);
    expect(isDisplayPositionCorrect(1, 2, null)).toBe(false);
  });

  it('regression: shuffle places correct answer at display D; student picks D → scored correct', () => {
    // Bug from 2026-04-18 screenshot: options shuffled, student picked visual D (idx 3),
    // original correct index was 0, shuffle map = [2, 1, 0, 3] meaning:
    //   displayIdx 0 → original 2
    //   displayIdx 1 → original 1
    //   displayIdx 2 → original 0 (the correct one — wait, let me redo)
    // Actually: shuffleMap[displayIdx] tells you which original index ended up at that display slot.
    // If original[0] = correct answer "3/8", and we want it shown at display idx 3:
    //   shuffleMap[3] === 0  → displayIdx 3 has original 0's content
    // So shuffleMap = [1, 2, 3, 0] (positions 0,1,2 get original 1,2,3; position 3 gets original 0)
    const shuffleMap = [1, 2, 3, 0];
    const originalCorrectIdx = 0;

    // Green check should be on display idx 3 (that's where original[0] ended up)
    expect(isDisplayPositionCorrect(3, originalCorrectIdx, shuffleMap)).toBe(true);
    expect(isDisplayPositionCorrect(0, originalCorrectIdx, shuffleMap)).toBe(false);
    expect(isDisplayPositionCorrect(1, originalCorrectIdx, shuffleMap)).toBe(false);
    expect(isDisplayPositionCorrect(2, originalCorrectIdx, shuffleMap)).toBe(false);

    // Student picks display idx 3 (D) → must be scored correct (this is the fix)
    expect(scoreAnswer(3, originalCorrectIdx, shuffleMap)).toBe(true);
    // Student picks any other → scored wrong
    expect(scoreAnswer(0, originalCorrectIdx, shuffleMap)).toBe(false);
    expect(scoreAnswer(1, originalCorrectIdx, shuffleMap)).toBe(false);
    expect(scoreAnswer(2, originalCorrectIdx, shuffleMap)).toBe(false);
  });

  it('shuffle + picking the visually-correct option always scores correct (all permutations)', () => {
    // Invariant: if isDisplayPositionCorrect(d) is true, then scoreAnswer(d) must also be true.
    // Previously (pre-fix) they disagreed, causing the "green check + Incorrect" contradiction.
    const allShuffles: number[][] = [
      [0, 1, 2, 3], [0, 1, 3, 2], [0, 2, 1, 3], [0, 2, 3, 1], [0, 3, 1, 2], [0, 3, 2, 1],
      [1, 0, 2, 3], [1, 0, 3, 2], [1, 2, 0, 3], [1, 2, 3, 0], [1, 3, 0, 2], [1, 3, 2, 0],
      [2, 0, 1, 3], [2, 0, 3, 1], [2, 1, 0, 3], [2, 1, 3, 0], [2, 3, 0, 1], [2, 3, 1, 0],
      [3, 0, 1, 2], [3, 0, 2, 1], [3, 1, 0, 2], [3, 1, 2, 0], [3, 2, 0, 1], [3, 2, 1, 0],
    ];

    for (const shuffleMap of allShuffles) {
      for (let origCorrect = 0; origCorrect < 4; origCorrect++) {
        // Find the display position where the correct answer ended up
        const correctDisplay = originalToShuffled(origCorrect, shuffleMap);

        // Picking that display position must score correct
        expect(
          scoreAnswer(correctDisplay, origCorrect, shuffleMap),
          `shuffle=${JSON.stringify(shuffleMap)} origCorrect=${origCorrect} correctDisplay=${correctDisplay}`,
        ).toBe(true);

        // And isDisplayPositionCorrect agrees
        expect(isDisplayPositionCorrect(correctDisplay, origCorrect, shuffleMap)).toBe(true);

        // Picking ANY other display position must score wrong
        for (let pick = 0; pick < 4; pick++) {
          if (pick === correctDisplay) continue;
          expect(
            scoreAnswer(pick, origCorrect, shuffleMap),
            `shuffle=${JSON.stringify(shuffleMap)} origCorrect=${origCorrect} wrongPick=${pick}`,
          ).toBe(false);
        }
      }
    }
  });

  it('PRE-FIX BEHAVIOR (for contrast): direct comparison without shuffle mapping was broken', () => {
    // This is what the old code did on line 453:
    //   const isCorrect = selectedOption === q.correct_answer_index;
    // i.e., comparing shuffled display index directly to original index.
    const brokenScore = (selectedDisplayIdx: number, originalCorrectIdx: number) =>
      selectedDisplayIdx === originalCorrectIdx;

    // With shuffleMap [1, 2, 3, 0], original 0 lands at display 3.
    // Student picks display 3 (visually correct, green-checked).
    const shuffleMap = [1, 2, 3, 0];
    expect(isDisplayPositionCorrect(3, 0, shuffleMap)).toBe(true);  // green check is here
    // Broken scoring: 3 === 0 → false → "Incorrect" banner despite green check
    expect(brokenScore(3, 0)).toBe(false);
    // Fixed scoring: through shuffle map → true
    expect(scoreAnswer(3, 0, shuffleMap)).toBe(true);
  });
});
