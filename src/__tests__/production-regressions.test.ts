import { describe, it, expect } from 'vitest';
import * as fs from 'fs';

describe('Production Regression Guards', () => {

  // INCIDENT: Chapter completion celebrated wrong answers
  // ROOT CAUSE: scoreGood = pct >= 60 || totalAnswered === 0
  // FIX: scoreGood = totalAnswered > 0 && pct >= 60
  it('R-CHAP-01: chapter completion requires 60% score AND answered questions', () => {
    const source = fs.readFileSync('src/app/learn/[subject]/[chapter]/page.tsx', 'utf-8');
    // Must NOT have the old pattern: totalAnswered === 0 treated as good
    expect(source).not.toMatch(/scoreGood\s*=.*\|\|\s*totalAnswered\s*===\s*0/);
    // Must require both conditions
    expect(source).toMatch(/totalAnswered\s*>\s*0\s*&&\s*pct\s*>=\s*60/);
  });

  // INCIDENT: Written answer 1/2 marks = WRONG
  // ROOT CAUSE: isCorrect = marksAwarded >= marksPossible (required 100%)
  // FIX: isCorrect = marksAwarded >= marksPossible * 0.5 (50% threshold)
  it('R-WRIT-01: written answer uses 50% threshold for partial credit', () => {
    const source = fs.readFileSync('src/app/quiz/page.tsx', 'utf-8');
    // Must have 0.5 threshold, not raw comparison
    expect(source).toMatch(/marksPossible\s*\*\s*0\.5/);
    // Must NOT have the old pattern: marksAwarded >= marksPossible without threshold
    // (This is tricky because the 0.5 line also contains marksPossible -- check for the fixed pattern)
    expect(source).toMatch(/isCorrect.*marksPossible\s*>\s*0\s*\?.*marksPossible\s*\*\s*0\.5/);
  });

  // INCIDENT: Quiz returns 2 instead of 20
  // ROOT CAUSE: No guaranteed count assembler
  // FIX: assembleQuiz() with 4-rung fallback
  it('R-QUIZ-01: quiz uses assembleQuiz for guaranteed count', () => {
    const source = fs.readFileSync('src/app/quiz/page.tsx', 'utf-8');
    expect(source).toContain('assembleQuiz');
    // Must NOT have the old scattered fetching pattern
    expect(source).not.toMatch(/allQuestions\s*=\s*\[\.\.\.allQuestions,\s*\.\.\.writtenQs\]\.slice/);
  });

  // INCIDENT: Foxy shows [FORMULA: x=5] garbage
  // ROOT CAUSE: cleanMd() converts backticks to [FORMULA:] markers
  // FIX: ReactMarkdown replaces cleanMd
  it('R-FOXY-01: RichContent uses ReactMarkdown not cleanMd', () => {
    const source = fs.readFileSync('src/components/foxy/RichContent.tsx', 'utf-8');
    expect(source).toContain('ReactMarkdown');
    // Must NOT have the destructive cleanMd function that CREATES [FORMULA:] markers
    expect(source).not.toMatch(/function\s+cleanMd/);
    // Legacy [FORMULA:] → backtick cleanup is acceptable (restores proper markdown).
    // What we prohibit is the creation direction: backtick → [FORMULA:].
    expect(source).not.toMatch(/replace\(.*`[^)]*\[FORMULA:/);
  });

  // INCIDENT: AI evaluation failure silently marks student WRONG
  // ROOT CAUSE: evalResult = null -> marksAwarded = 0 -> isCorrect = false
  // FIX: Retry button shown, answer not counted as wrong
  it('R-EVAL-01: evaluation failure shows retry, does not mark wrong', () => {
    const source = fs.readFileSync('src/app/quiz/page.tsx', 'utf-8');
    // Must have evalError state for retry UI
    expect(source).toMatch(/evalError|setEvalError/);
    // Must have retry mechanism
    expect(source).toMatch(/retry|Retry/i);
  });
});