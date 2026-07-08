import { describe, it, expect } from 'vitest';

/**
 * Anti-Cheat Regression Tests — P3 (Speed-Hack on Written-Only Quizzes)
 *
 * Bug fixed: src/app/quiz/page.tsx previously gated the 3s/question speed
 * check on `mcqResponses.length > 0`. Pure short-answer (SA) or long-answer
 * (LA) quizzes have zero MCQ responses (selected_option === -1), so the
 * speed-hack rejection was silently bypassed for those quizzes.
 *
 * The fix changes the gate to `totalResponses > 0`, so the check fires for
 * ANY non-empty response array regardless of type.
 *
 * This file mirrors the post-fix logic in quiz/page.tsx lines 765-787 and
 * proves the rejection now triggers for SA-only / LA-only / mixed quizzes.
 *
 * Catalog: extends REG-45 / P3 coverage to written-only paths.
 */

type Response = {
  question_id: string;
  selected_option: number; // -1 for written (SA/LA), 0..3 for MCQ
  is_correct: boolean;
  time_spent: number;
};

type AntiCheatVerdict = 'reject_speed' | 'accept';

/**
 * Mirrors the post-fix anti-cheat speed gate in src/app/quiz/page.tsx.
 * Returns 'reject_speed' if total wall-clock divided by total responses
 * is < 3s, regardless of response type.
 */
function checkSpeedGate(allResponses: Response[], totalTimeSeconds: number): AntiCheatVerdict {
  const totalResponses = allResponses.length;
  const avgTimePerQ = totalResponses > 0 ? totalTimeSeconds / totalResponses : 0;
  if (totalResponses > 0 && avgTimePerQ < 3) {
    return 'reject_speed';
  }
  return 'accept';
}

function makeWrittenResponse(id: string, time: number): Response {
  return { question_id: id, selected_option: -1, is_correct: false, time_spent: time };
}

function makeMcqResponse(id: string, opt: number, time: number): Response {
  return { question_id: id, selected_option: opt, is_correct: opt === 0, time_spent: time };
}

describe('P3 (Bug 1): speed gate fires on pure SA/LA quizzes', () => {
  it('SA-only: 5 short-answer responses in 5 seconds (1s avg) is REJECTED', () => {
    // Pure SA quiz — every response carries selected_option = -1.
    // Pre-fix: mcqResponses.length === 0 -> guard short-circuits -> ACCEPT (bug).
    // Post-fix: totalResponses > 0 -> guard fires -> REJECT.
    const responses = [
      makeWrittenResponse('sa1', 1),
      makeWrittenResponse('sa2', 1),
      makeWrittenResponse('sa3', 1),
      makeWrittenResponse('sa4', 1),
      makeWrittenResponse('sa5', 1),
    ];
    expect(checkSpeedGate(responses, 5)).toBe('reject_speed');
  });

  it('LA-only: 3 long-answer responses in 6 seconds (2s avg) is REJECTED', () => {
    const responses = [
      makeWrittenResponse('la1', 2),
      makeWrittenResponse('la2', 2),
      makeWrittenResponse('la3', 2),
    ];
    expect(checkSpeedGate(responses, 6)).toBe('reject_speed');
  });

  it('mixed MCQ + SA: 4 responses in 8s (2s avg) is REJECTED', () => {
    const responses = [
      makeMcqResponse('mcq1', 0, 2),
      makeMcqResponse('mcq2', 1, 2),
      makeWrittenResponse('sa1', 2),
      makeWrittenResponse('sa2', 2),
    ];
    expect(checkSpeedGate(responses, 8)).toBe('reject_speed');
  });

  it('SA-only: 5 responses with 4s avg (20s total) is ACCEPTED', () => {
    const responses = [
      makeWrittenResponse('sa1', 4),
      makeWrittenResponse('sa2', 4),
      makeWrittenResponse('sa3', 4),
      makeWrittenResponse('sa4', 4),
      makeWrittenResponse('sa5', 4),
    ];
    expect(checkSpeedGate(responses, 20)).toBe('accept');
  });

  it('LA-only: 2 responses in 60s (30s avg, realistic for LA) is ACCEPTED', () => {
    const responses = [
      makeWrittenResponse('la1', 30),
      makeWrittenResponse('la2', 30),
    ];
    expect(checkSpeedGate(responses, 60)).toBe('accept');
  });

  it('boundary: SA-only at exactly 3s avg is ACCEPTED', () => {
    const responses = [
      makeWrittenResponse('sa1', 3),
      makeWrittenResponse('sa2', 3),
      makeWrittenResponse('sa3', 3),
    ];
    expect(checkSpeedGate(responses, 9)).toBe('accept');
  });

  it('empty response array does not crash and is ACCEPTED', () => {
    expect(checkSpeedGate([], 0)).toBe('accept');
  });
});

describe('P3 (Bug 1): regression — pre-fix bypass logic would have ACCEPTED these', () => {
  // These cases prove the old gate was broken — they would all have
  // returned 'accept' under the pre-fix `mcqResponses.length > 0` guard.
  // With the post-fix `totalResponses > 0` gate they correctly reject.

  it('SA-only 10 responses in 10s would have been accepted by buggy gate', () => {
    const responses = Array.from({ length: 10 }, (_, i) =>
      makeWrittenResponse(`sa${i}`, 1)
    );
    // Pre-fix gate (buggy): mcqResponses.length === 0 -> skip check -> accept.
    // Verify the buggy logic would have wrongly accepted:
    const mcqResponses = responses.filter((r) => r.selected_option >= 0);
    const buggyVerdict = mcqResponses.length > 0 && 10 / 10 < 3 ? 'reject_speed' : 'accept';
    expect(buggyVerdict).toBe('accept'); // documents the historical bug
    // Post-fix gate: total > 0 -> avg 1s < 3s -> reject.
    expect(checkSpeedGate(responses, 10)).toBe('reject_speed');
  });
});
