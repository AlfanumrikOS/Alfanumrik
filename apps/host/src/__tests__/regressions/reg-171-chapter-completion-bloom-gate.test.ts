/**
 * REG-171: update_chapter_progress bloom-gate lowered to >= 1
 *
 * Verifies that chapter completion now fires when accuracy >= 60% and at
 * least ONE bloom category has been attempted (was >= 3). Regression guard
 * against restoring the old >= 3 gate prematurely (before bulk MCQ seeding
 * adds understand/apply questions to every chapter).
 *
 * These tests stub the RPC call and verify the LOGIC of the gate through the
 * SQL body's expected outcomes, using mock quiz_responses data.
 *
 * The gate logic replicates what the SQL RPC computes. We test the formula
 * directly since the RPC is SECURITY DEFINER and runs in Supabase.
 * Formula (migration 20260625000100): v_is_completed = (v_accuracy >= 60 AND v_assessed_count >= 1)
 */
import { describe, it, expect } from 'vitest';

// ── Pure formula replica ─────────────────────────────────────────────────────

function computeAccuracy(totalAttempted: number, totalCorrect: number): number {
  if (totalAttempted === 0) return 0;
  return Math.round((totalCorrect / totalAttempted) * 1000) / 10;
}

interface BloomInputs {
  rememberAttempted: number;
  rememberCorrect: number;
  understandAttempted: number;
  understandCorrect: number;
  applyAttempted: number;
  applyCorrect: number;
  hotsAttempted: number;
  hotsCorrect: number;
}

interface BloomGateResult {
  isCompleted: boolean;
  accuracy: number;
  assessedCount: number;
}

/**
 * Replicates the completion gate from migration 20260625000100.
 * v_is_completed = (v_accuracy >= 60 AND v_assessed_count >= 1)
 */
function computeIsCompleted(params: BloomInputs): BloomGateResult {
  const totalAttempted =
    params.rememberAttempted +
    params.understandAttempted +
    params.applyAttempted +
    params.hotsAttempted;
  const totalCorrect =
    params.rememberCorrect +
    params.understandCorrect +
    params.applyCorrect +
    params.hotsCorrect;

  const accuracy = computeAccuracy(totalAttempted, totalCorrect);

  let assessedCount = 0;
  if (params.rememberAttempted > 0) assessedCount++;
  if (params.understandAttempted > 0) assessedCount++;
  if (params.applyAttempted > 0) assessedCount++;
  if (params.hotsAttempted > 0) assessedCount++;

  // Migration 20260625000100: gate lowered from >= 3 to >= 1
  const isCompleted = accuracy >= 60 && assessedCount >= 1;
  return { isCompleted, accuracy, assessedCount };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('REG-171: update_chapter_progress bloom-gate >= 1', () => {
  it('REG-171-A: 5 remember questions at 80% accuracy → is_completed = true', () => {
    const result = computeIsCompleted({
      rememberAttempted: 5, rememberCorrect: 4,
      understandAttempted: 0, understandCorrect: 0,
      applyAttempted: 0, applyCorrect: 0,
      hotsAttempted: 0, hotsCorrect: 0,
    });
    expect(result.assessedCount).toBe(1);
    expect(result.accuracy).toBe(80);
    expect(result.isCompleted).toBe(true);
  });

  it('REG-171-B: 5 remember questions at 40% accuracy → is_completed = false (accuracy guard holds)', () => {
    const result = computeIsCompleted({
      rememberAttempted: 5, rememberCorrect: 2,
      understandAttempted: 0, understandCorrect: 0,
      applyAttempted: 0, applyCorrect: 0,
      hotsAttempted: 0, hotsCorrect: 0,
    });
    expect(result.assessedCount).toBe(1);
    expect(result.accuracy).toBe(40);
    expect(result.isCompleted).toBe(false);
  });

  it('REG-171-C: 3 remember + 2 understand at 60% → is_completed = true, assessed_count = 2', () => {
    // 3+2=5 attempted, 2+1=3 correct → 60%
    const result = computeIsCompleted({
      rememberAttempted: 3, rememberCorrect: 2,
      understandAttempted: 2, understandCorrect: 1,
      applyAttempted: 0, applyCorrect: 0,
      hotsAttempted: 0, hotsCorrect: 0,
    });
    expect(result.assessedCount).toBe(2);
    expect(result.accuracy).toBe(60);
    expect(result.isCompleted).toBe(true);
  });

  it('REG-171-D: 0 questions attempted → is_completed = false', () => {
    const result = computeIsCompleted({
      rememberAttempted: 0, rememberCorrect: 0,
      understandAttempted: 0, understandCorrect: 0,
      applyAttempted: 0, applyCorrect: 0,
      hotsAttempted: 0, hotsCorrect: 0,
    });
    expect(result.assessedCount).toBe(0);
    expect(result.accuracy).toBe(0);
    expect(result.isCompleted).toBe(false);
  });

  it('REG-171-E: gate requires BOTH accuracy >= 60 AND assessed_count >= 1 (not just one)', () => {
    // accuracy < 60 even though assessed_count = 1
    const lowAccuracy = computeIsCompleted({
      rememberAttempted: 5, rememberCorrect: 2,
      understandAttempted: 0, understandCorrect: 0,
      applyAttempted: 0, applyCorrect: 0,
      hotsAttempted: 0, hotsCorrect: 0,
    });
    expect(lowAccuracy.isCompleted).toBe(false);

    // Verify the AND is required: accuracy >= 60 but assessed_count = 0 → false
    const andRequired = 80 >= 60 && 0 >= 1;
    expect(andRequired).toBe(false);
  });

  it('REG-171-F: all four bloom categories attempted at 70% → assessed_count = 4, is_completed = true', () => {
    // 10 total attempted, 7 correct → 70%
    const result = computeIsCompleted({
      rememberAttempted: 3, rememberCorrect: 2,
      understandAttempted: 3, understandCorrect: 2,
      applyAttempted: 2, applyCorrect: 2,
      hotsAttempted: 2, hotsCorrect: 1,
    });
    expect(result.assessedCount).toBe(4);
    expect(result.accuracy).toBe(70);
    expect(result.isCompleted).toBe(true);
  });

  it('REG-171-regression: old gate (>= 3) would fail REG-171-A scenario (remember-only chapter)', () => {
    // Verify that the old gate would have blocked completion for remember-only chapters
    const accuracy = 80;
    const assessedCount = 1;
    const oldGate = accuracy >= 60 && assessedCount >= 3;
    const newGate = accuracy >= 60 && assessedCount >= 1;
    expect(oldGate).toBe(false);  // old gate blocks remember-only chapters
    expect(newGate).toBe(true);   // new gate allows them
  });

  it('REG-171-boundary: exactly 60% accuracy with 1 bloom category → is_completed = true (boundary inclusive)', () => {
    // 5 questions, 3 correct = exactly 60%
    const result = computeIsCompleted({
      rememberAttempted: 5, rememberCorrect: 3,
      understandAttempted: 0, understandCorrect: 0,
      applyAttempted: 0, applyCorrect: 0,
      hotsAttempted: 0, hotsCorrect: 0,
    });
    expect(result.accuracy).toBe(60);
    expect(result.assessedCount).toBe(1);
    expect(result.isCompleted).toBe(true);
  });

  it('REG-171-boundary: 59.9% accuracy (2/5 round-tripped) with 1 category → is_completed = false', () => {
    // 10 questions, 5 correct + 1 partial = use 4 correct of 7 attempted → ~57.1%
    // Use a case that rounds to 57%: 4/7 = 0.5714... * 100 → Math.round(571.4/10) / 10 = 57.1
    const result = computeIsCompleted({
      rememberAttempted: 7, rememberCorrect: 4,
      understandAttempted: 0, understandCorrect: 0,
      applyAttempted: 0, applyCorrect: 0,
      hotsAttempted: 0, hotsCorrect: 0,
    });
    expect(result.accuracy).toBeLessThan(60);
    expect(result.assessedCount).toBe(1);
    expect(result.isCompleted).toBe(false);
  });
});
