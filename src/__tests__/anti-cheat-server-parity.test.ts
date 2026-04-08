/**
 * Anti-Cheat Server Parity Tests
 *
 * Verifies that client-side anti-cheat checks (src/lib/anti-cheat.ts)
 * match the server-side logic in submit_quiz_results RPC
 * (supabase/migrations/20260408000001_add_p3_anticheat_checks_2_3.sql).
 *
 * These tests exercise the pure client functions that mirror RPC logic.
 * The RPC itself is tested via Supabase integration tests.
 *
 * Regression catalog IDs: reject_speed_hack, flag_same_answer,
 * accept_valid_pattern, reject_count_mismatch, accept_valid_submission
 */

import { describe, it, expect } from 'vitest';
import {
  checkMinimumTime,
  checkNotAllSameAnswer,
  checkResponseCount,
  validateAntiCheat,
} from '@/lib/anti-cheat';

// ─── checkMinimumTime ────────────────────────────────────────────────────────

describe('checkMinimumTime', () => {
  it('returns false for 0 questions (guard against division by zero)', () => {
    expect(checkMinimumTime(0, 0)).toBe(false);
    expect(checkMinimumTime(30, 0)).toBe(false);
  });

  it('returns true at exactly 3.0s average — boundary is inclusive', () => {
    // 30s / 10q = 3.0s exactly — must pass (>= 3, not > 3)
    expect(checkMinimumTime(30, 10)).toBe(true);
  });

  it('returns false when average is below 3s boundary', () => {
    // 29s / 10q = 2.9s — one second short
    expect(checkMinimumTime(29, 10)).toBe(false);
  });

  it('returns true for comfortable pace (12s average)', () => {
    // 60s / 5q = 12s average — clearly valid
    expect(checkMinimumTime(60, 5)).toBe(true);
  });

  it('returns false for 1s average (single fast question)', () => {
    expect(checkMinimumTime(1, 1)).toBe(false);
  });

  it('returns true at exactly 3s for single question', () => {
    expect(checkMinimumTime(3, 1)).toBe(true);
  });

  it('returns false for speed hack: 10s for 10 questions', () => {
    // 10s / 10q = 1.0s — flagrant speed hack
    expect(checkMinimumTime(10, 10)).toBe(false);
  });
});

// ─── checkNotAllSameAnswer ───────────────────────────────────────────────────

describe('checkNotAllSameAnswer', () => {
  it('returns true for <= 3 questions even when all same (exempt)', () => {
    // 3 questions all index 0 — below the >3 threshold, should pass
    const threeAllSame = [
      { selected_option: 0 },
      { selected_option: 0 },
      { selected_option: 0 },
    ];
    expect(checkNotAllSameAnswer(threeAllSame)).toBe(true);
  });

  it('returns true for 2 questions all same (exempt)', () => {
    const twoAllSame = [{ selected_option: 1 }, { selected_option: 1 }];
    expect(checkNotAllSameAnswer(twoAllSame)).toBe(true);
  });

  it('returns true for 1 question (always exempt)', () => {
    expect(checkNotAllSameAnswer([{ selected_option: 2 }])).toBe(true);
  });

  it('returns false for 4 questions all same option 0', () => {
    // Exactly at the >3 threshold — must be flagged
    const fourAllSame = [
      { selected_option: 0 },
      { selected_option: 0 },
      { selected_option: 0 },
      { selected_option: 0 },
    ];
    expect(checkNotAllSameAnswer(fourAllSame)).toBe(false);
  });

  it('returns true for 4 questions with mixed options', () => {
    const mixed = [
      { selected_option: 0 },
      { selected_option: 1 },
      { selected_option: 2 },
      { selected_option: 3 },
    ];
    expect(checkNotAllSameAnswer(mixed)).toBe(true);
  });

  it('returns true for 10 questions where 9 are same and 1 is different', () => {
    // NOT all same — the single different answer should clear the check
    const nineAndOne = [
      ...Array(9).fill({ selected_option: 2 }),
      { selected_option: 3 },
    ];
    expect(checkNotAllSameAnswer(nineAndOne)).toBe(true);
  });

  it('returns false for 10 questions all same option 2', () => {
    const tenAllSame = Array(10).fill({ selected_option: 2 });
    expect(checkNotAllSameAnswer(tenAllSame)).toBe(false);
  });

  it('returns false for 10 questions all same option 3 (mirrors RPC check 2)', () => {
    // Server-side: all same index when >3 questions → flagged
    const tenAllSame = Array(10).fill({ selected_option: 3 });
    expect(checkNotAllSameAnswer(tenAllSame)).toBe(false);
  });
});

// ─── checkResponseCount ──────────────────────────────────────────────────────

describe('checkResponseCount', () => {
  it('returns true when response count exactly equals question count', () => {
    expect(checkResponseCount(10, 10)).toBe(true);
  });

  it('returns false when responses are fewer than questions (8 vs 10)', () => {
    // Mirrors RPC check 3: jsonb_array_length(p_responses) != v_total → flagged
    expect(checkResponseCount(8, 10)).toBe(false);
  });

  it('returns false when responses exceed questions (11 vs 10)', () => {
    // Extra responses injected — must be rejected
    expect(checkResponseCount(11, 10)).toBe(false);
  });

  it('returns true for 0 responses and 0 questions (empty quiz edge case)', () => {
    // Edge case: no questions, no responses — counts match
    expect(checkResponseCount(0, 0)).toBe(true);
  });

  it('returns false for 0 responses with 5 questions', () => {
    expect(checkResponseCount(0, 5)).toBe(false);
  });

  it('returns true for 1 response and 1 question', () => {
    expect(checkResponseCount(1, 1)).toBe(true);
  });
});

// ─── validateAntiCheat (combined) ────────────────────────────────────────────

describe('validateAntiCheat', () => {
  it('rejects speed hack: 10s for 10 questions with mixed answers', () => {
    // 10s / 10q = 1.0s average — speed check fails first
    const mixedResponses = Array(10).fill(null).map((_, i) => ({
      selected_option: i % 4,
    }));
    const result = validateAntiCheat(10, mixedResponses, 10);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('speed_hack');
  });

  it('rejects same answer pattern: 40s for 4 questions all answering option 0', () => {
    // 40s / 4q = 10s average (speed passes), but all same with >3 questions
    const allZero = Array(4).fill({ selected_option: 0 });
    const result = validateAntiCheat(40, allZero, 4);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('same_answer_pattern');
  });

  it('rejects count mismatch: 40s for 10 questions but only 9 responses', () => {
    // 40s / 10q = 4s (speed passes), mixed answers (pattern passes), but count wrong
    const nineResponses = Array(9).fill(null).map((_, i) => ({
      selected_option: i % 4,
    }));
    // questionCount is 10 but we only supply 9 responses
    const result = validateAntiCheat(40, nineResponses, 10);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('count_mismatch');
  });

  it('accepts valid submission: 40s, mixed answers, count matches', () => {
    // All three checks must pass
    const tenMixed = Array(10).fill(null).map((_, i) => ({
      selected_option: i % 4,
    }));
    const result = validateAntiCheat(40, tenMixed, 10);
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('speed hack takes priority over same answer pattern', () => {
    // Both speed hack AND same answer — speed should be reported
    const allSame = Array(10).fill({ selected_option: 0 });
    const result = validateAntiCheat(10, allSame, 10);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('speed_hack');
  });

  it('same answer pattern takes priority over count mismatch', () => {
    // All same answer with >3 questions AND count mismatch — pattern caught first
    // 50s / 10q = 5s (speed passes), all same in 5 responses (pattern fails)
    const fiveAllSame = Array(5).fill({ selected_option: 1 });
    const result = validateAntiCheat(50, fiveAllSame, 10);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('same_answer_pattern');
  });

  it('accepts small quiz (3 questions) where all same is exempt', () => {
    // 3 questions, all same, 30s — should pass because <=3 exempts pattern check
    const threeAllSame = Array(3).fill({ selected_option: 2 });
    const result = validateAntiCheat(30, threeAllSame, 3);
    expect(result.valid).toBe(true);
  });

  it('returns { valid: false, reason: "count_mismatch" } when extra responses injected', () => {
    // 11 responses for 10 questions — stuffed responses
    const elevenMixed = Array(11).fill(null).map((_, i) => ({
      selected_option: i % 4,
    }));
    const result = validateAntiCheat(40, elevenMixed, 10);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('count_mismatch');
  });
});

// ─── RPC Parity Documentation ────────────────────────────────────────────────
//
// The following describe block documents the EXPECTED behavior of the server-side
// RPC checks added in migration 20260408000001_add_p3_anticheat_checks_2_3.sql.
// These are integration-style specifications — the SQL logic mirrors the pure
// functions above. When the Supabase integration test suite runs against a live
// DB, these same conditions should produce the same results in the RPC.
//
// Check 2 (SQL): IF (SELECT COUNT(DISTINCT(r->>'answer_index')) FROM
//                    jsonb_array_elements(p_responses) AS r) = 1
//                   AND jsonb_array_length(p_responses) > 3
//                THEN flag submission
//
// Check 3 (SQL): IF jsonb_array_length(p_responses) != v_total
//                THEN flag submission
//
// Both mirror checkNotAllSameAnswer() and checkResponseCount() respectively.

describe('RPC parity: server checks mirror client checks', () => {
  it('check 2 parity: client checkNotAllSameAnswer(4 x same) === false matches RPC flag', () => {
    // When RPC would flag: 4 responses all same index
    const responses = Array(4).fill({ selected_option: 0 });
    // Client returns false (invalid) — RPC should also reject/flag
    expect(checkNotAllSameAnswer(responses)).toBe(false);
  });

  it('check 2 parity: client checkNotAllSameAnswer(3 x same) === true matches RPC exemption', () => {
    // When RPC should NOT flag: 3 responses all same index (below threshold)
    const responses = Array(3).fill({ selected_option: 0 });
    // Client returns true (valid) — RPC should also allow
    expect(checkNotAllSameAnswer(responses)).toBe(true);
  });

  it('check 3 parity: client checkResponseCount(9, 10) === false matches RPC rejection', () => {
    // When RPC would reject: response array length != question count
    expect(checkResponseCount(9, 10)).toBe(false);
  });

  it('check 3 parity: client checkResponseCount(10, 10) === true matches RPC acceptance', () => {
    // When RPC should accept: response array length == question count
    expect(checkResponseCount(10, 10)).toBe(true);
  });
});
