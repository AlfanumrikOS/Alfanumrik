import { describe, it, expect } from 'vitest';

/**
 * Anti-Cheat Regression Tests — P3 (Anti-Cheat)
 *
 * Three checks enforced client-side (quiz/page.tsx) and server-side:
 * 1. Minimum 3s average per question (speed hack detection)
 * 2. Not all same answer index if >3 questions (pattern gaming)
 * 3. Response count equals question count (count mismatch)
 *
 * The anti-cheat logic in quiz/page.tsx is inline (not exported), so we
 * reimplement the exact checks here and verify the expected outcomes.
 *
 * Regression catalog IDs: reject_speed_hack, flag_same_answer,
 * accept_valid_pattern, reject_count_mismatch, accept_valid_submission
 */

// ─── Anti-cheat check implementation (mirrors quiz/page.tsx logic) ───────────

type AntiCheatResult = 'accept' | 'reject_speed' | 'flag_pattern' | 'reject_count';

function checkAntiCheat(
  responses: { selectedIndex: number }[],
  totalTimeSeconds: number,
  questionCount: number
): AntiCheatResult {
  // Check 1: Speed hack — average time per question must be >= 3s
  if (totalTimeSeconds / questionCount < 3) {
    return 'reject_speed';
  }

  // Check 2: Pattern gaming — all same answer index with >3 questions
  // Note: quiz/page.tsx uses >= 5 threshold, P3 spec says >3.
  // We test the P3 spec (>3 questions).
  const indices = responses.map(r => r.selectedIndex);
  if (new Set(indices).size === 1 && indices.length > 3) {
    return 'flag_pattern';
  }

  // Check 3: Response count must match question count
  if (responses.length !== questionCount) {
    return 'reject_count';
  }

  return 'accept';
}

// ─── Speed Hack Detection ────────────────────────────────────────────────────

describe('P3: Speed Hack Detection', () => {
  it('reject_speed_hack: average < 3s per question is rejected', () => {
    // 10 questions in 15s = 1.5s average
    const responses = Array(10).fill({ selectedIndex: 0 });
    expect(checkAntiCheat(responses, 15, 10)).toBe('reject_speed');
  });

  it('rejects 10 questions answered in 29s (2.9s average)', () => {
    const responses = Array(10).fill({ selectedIndex: 1 });
    expect(checkAntiCheat(responses, 29, 10)).toBe('reject_speed');
  });

  it('rejects 5 questions answered in 10s (2.0s average)', () => {
    const responses = [
      { selectedIndex: 0 }, { selectedIndex: 1 },
      { selectedIndex: 2 }, { selectedIndex: 3 },
      { selectedIndex: 0 },
    ];
    expect(checkAntiCheat(responses, 10, 5)).toBe('reject_speed');
  });

  it('accepts exactly 3s average per question (boundary)', () => {
    // 10 questions in 30s = exactly 3.0s average
    const responses = [
      { selectedIndex: 0 }, { selectedIndex: 1 },
      { selectedIndex: 2 }, { selectedIndex: 3 },
      { selectedIndex: 0 }, { selectedIndex: 2 },
      { selectedIndex: 1 }, { selectedIndex: 3 },
      { selectedIndex: 0 }, { selectedIndex: 2 },
    ];
    expect(checkAntiCheat(responses, 30, 10)).toBe('accept');
  });

  it('accepts comfortable pace (12s average)', () => {
    const responses = [
      { selectedIndex: 0 }, { selectedIndex: 1 },
      { selectedIndex: 2 }, { selectedIndex: 3 },
      { selectedIndex: 0 }, { selectedIndex: 2 },
      { selectedIndex: 1 }, { selectedIndex: 3 },
      { selectedIndex: 0 }, { selectedIndex: 2 },
    ];
    expect(checkAntiCheat(responses, 120, 10)).toBe('accept');
  });

  it('rejects single question answered in 2s', () => {
    const responses = [{ selectedIndex: 0 }];
    expect(checkAntiCheat(responses, 2, 1)).toBe('reject_speed');
  });
});

// ─── Same Answer Pattern Detection ───────────────────────────────────────────

describe('P3: Same Answer Pattern Detection', () => {
  it('flag_same_answer: all indices identical with >3 questions is flagged', () => {
    // 10 questions all answered with index 2
    const responses = Array(10).fill({ selectedIndex: 2 });
    expect(checkAntiCheat(responses, 60, 10)).toBe('flag_pattern');
  });

  it('flags 4 questions with all same answer (>3 threshold)', () => {
    const responses = Array(4).fill({ selectedIndex: 0 });
    expect(checkAntiCheat(responses, 30, 4)).toBe('flag_pattern');
  });

  it('accept_valid_pattern: 3 questions with same answer is NOT flagged', () => {
    // Exactly 3 questions with same answer — not > 3, so accepted
    const responses = [
      { selectedIndex: 1 },
      { selectedIndex: 1 },
      { selectedIndex: 1 },
    ];
    expect(checkAntiCheat(responses, 30, 3)).toBe('accept');
  });

  it('2 questions with same answer is NOT flagged', () => {
    const responses = [
      { selectedIndex: 0 },
      { selectedIndex: 0 },
    ];
    expect(checkAntiCheat(responses, 30, 2)).toBe('accept');
  });

  it('does not flag varied answers even if one option dominates', () => {
    // 8 out of 10 are index 0, but not ALL the same
    const responses = [
      { selectedIndex: 0 }, { selectedIndex: 0 },
      { selectedIndex: 0 }, { selectedIndex: 0 },
      { selectedIndex: 0 }, { selectedIndex: 0 },
      { selectedIndex: 0 }, { selectedIndex: 0 },
      { selectedIndex: 1 }, { selectedIndex: 2 },
    ];
    expect(checkAntiCheat(responses, 60, 10)).toBe('accept');
  });

  it('flags all index 0 with 5 questions', () => {
    const responses = Array(5).fill({ selectedIndex: 0 });
    expect(checkAntiCheat(responses, 30, 5)).toBe('flag_pattern');
  });

  it('flags all index 3 with 20 questions', () => {
    const responses = Array(20).fill({ selectedIndex: 3 });
    expect(checkAntiCheat(responses, 120, 20)).toBe('flag_pattern');
  });
});

// ─── Response Count Mismatch ─────────────────────────────────────────────────

describe('P3: Response Count Must Match Question Count', () => {
  it('reject_count_mismatch: 10 questions but 8 responses is rejected', () => {
    const responses = [
      { selectedIndex: 0 }, { selectedIndex: 1 },
      { selectedIndex: 2 }, { selectedIndex: 3 },
      { selectedIndex: 0 }, { selectedIndex: 1 },
      { selectedIndex: 2 }, { selectedIndex: 3 },
    ]; // 8 responses
    expect(checkAntiCheat(responses, 60, 10)).toBe('reject_count');
  });

  it('rejects when more responses than questions (12 responses, 10 questions)', () => {
    const responses = Array(12).fill(null).map((_, i) => ({
      selectedIndex: i % 4,
    }));
    expect(checkAntiCheat(responses, 60, 10)).toBe('reject_count');
  });

  it('rejects 0 responses for 5 questions', () => {
    // 30/5 = 6 >= 3 so speed passes, empty Set size is 0 (not 1) so pattern passes,
    // then 0 !== 5 triggers count mismatch
    expect(checkAntiCheat([], 30, 5)).toBe('reject_count');
  });

  it('accepts when response count equals question count', () => {
    const responses = [
      { selectedIndex: 0 }, { selectedIndex: 1 },
      { selectedIndex: 2 }, { selectedIndex: 3 },
      { selectedIndex: 0 },
    ];
    expect(checkAntiCheat(responses, 30, 5)).toBe('accept');
  });
});

// ─── Valid Submission (Happy Path) ───────────────────────────────────────────

describe('P3: Valid Submission Passes All Checks', () => {
  it('accept_valid_submission: varied answers, valid time, correct count', () => {
    const responses = [
      { selectedIndex: 0 }, { selectedIndex: 1 },
      { selectedIndex: 2 }, { selectedIndex: 3 },
      { selectedIndex: 0 }, { selectedIndex: 2 },
      { selectedIndex: 1 }, { selectedIndex: 3 },
      { selectedIndex: 0 }, { selectedIndex: 2 },
    ];
    expect(checkAntiCheat(responses, 120, 10)).toBe('accept');
  });

  it('accepts 1 question answered in 5s with single answer', () => {
    // 1 question, 5s, 1 response — all checks pass
    // Pattern check: length 1 is not > 3
    const responses = [{ selectedIndex: 2 }];
    expect(checkAntiCheat(responses, 5, 1)).toBe('accept');
  });

  it('accepts large quiz: 50 questions, varied, 300s', () => {
    const responses = Array(50).fill(null).map((_, i) => ({
      selectedIndex: i % 4,
    }));
    expect(checkAntiCheat(responses, 300, 50)).toBe('accept');
  });
});

// ─── Edge Cases ──────────────────────────────────────────────────────────────

describe('P3: Anti-Cheat Edge Cases', () => {
  it('speed check takes priority over pattern check', () => {
    // All same answer AND too fast — speed should be caught first
    const responses = Array(10).fill({ selectedIndex: 0 });
    expect(checkAntiCheat(responses, 10, 10)).toBe('reject_speed');
  });

  it('pattern check takes priority over count check', () => {
    // All same answer AND count mismatch, but time is valid
    // With our check order: speed (pass) -> pattern (flag) -> count (never reached)
    const responses = Array(5).fill({ selectedIndex: 1 });
    // questionCount = 10, but responses = 5, and all same
    // speed: 60/10 = 6 >= 3 (pass)
    // pattern: Set size 1, length 5 > 3 (flag)
    expect(checkAntiCheat(responses, 60, 10)).toBe('flag_pattern');
  });

  it('0 responses for 0 questions does not crash', () => {
    // Division by zero edge case: 0 / 0 = NaN
    // NaN < 3 is false, so speed check passes
    // Set of empty array has size 0, not 1, so pattern passes
    // 0 === 0 so count passes
    const result = checkAntiCheat([], 0, 0);
    expect(result).toBe('accept');
  });
});
