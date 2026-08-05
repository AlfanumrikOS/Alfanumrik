// src/__tests__/eval/irt/verdict.test.ts
//
// Phase 3 E2 — IRT shadow-eval harness verdict (eval/irt/harness/verdict.ts).
// Pure/offline lane. The three-state gate for ramping
// ff_irt_question_selection: PASS / FAIL / INCONCLUSIVE.

import { describe, it, expect } from 'vitest';
import {
  evaluateIrtVerdict,
  MIN_CALIBRATED_RESPONSES,
  MIN_STUDENTS,
  MIN_DELTA_AUC,
  MAX_DELTA_BRIER,
} from '../../../../eval/irt/harness/verdict';
import type { ModelComparison, ShadowSummary } from '../../../../eval/irt/harness/metrics';

function model(overrides: Partial<ModelComparison> = {}): ModelComparison {
  return {
    n: 600,
    nStudents: 60,
    auc2pl: 0.78,
    aucProxy: 0.72,
    deltaAUC: 0.06,
    brier2pl: 0.18,
    brierProxy: 0.2,
    deltaBrier: -0.02,
    ...overrides,
  };
}

function shadow(overrides: Partial<ShadowSummary> = {}): ShadowSummary {
  return {
    nSamples: 40,
    medianSpearman: 0.8,
    medianTop5Overlap: 0.7,
    medianTop10Overlap: 0.75,
    totalCandidatesScored: 400,
    totalCalibratedScored: 150,
    ...overrides,
  };
}

describe('gate constants (assessment-reviewed pins)', () => {
  it('pins the volume + delta thresholds', () => {
    expect(MIN_CALIBRATED_RESPONSES).toBe(500);
    expect(MIN_STUDENTS).toBe(50);
    expect(MIN_DELTA_AUC).toBe(0.03);
    expect(MAX_DELTA_BRIER).toBe(-0.005);
  });
});

describe('evaluateIrtVerdict — PASS', () => {
  it('passes when volume gates met and both deltas clear their thresholds', () => {
    const v = evaluateIrtVerdict(model(), shadow());
    expect(v.verdict).toBe('PASS');
    expect(v.reasons[0]).toMatch(/^PASS:/);
  });

  it('passes exactly AT the thresholds (>= / <= comparisons, not strict)', () => {
    const v = evaluateIrtVerdict(
      model({ deltaAUC: MIN_DELTA_AUC, deltaBrier: MAX_DELTA_BRIER, n: 500, nStudents: 50 }),
      shadow(),
    );
    expect(v.verdict).toBe('PASS');
  });
});

describe('evaluateIrtVerdict — INCONCLUSIVE (volume / measurability dominate)', () => {
  it('too few responses → INCONCLUSIVE even with stellar deltas', () => {
    const v = evaluateIrtVerdict(model({ n: 499 }), shadow());
    expect(v.verdict).toBe('INCONCLUSIVE');
    expect(v.reasons.join(' ')).toMatch(/499 calibrated responses/);
  });

  it('too few students → INCONCLUSIVE', () => {
    const v = evaluateIrtVerdict(model({ nStudents: 49 }), shadow());
    expect(v.verdict).toBe('INCONCLUSIVE');
    expect(v.reasons.join(' ')).toMatch(/49 distinct students/);
  });

  it('null deltaAUC → INCONCLUSIVE (never PASS/FAIL on unmeasurable metrics)', () => {
    const v = evaluateIrtVerdict(model({ deltaAUC: null }), shadow());
    expect(v.verdict).toBe('INCONCLUSIVE');
  });

  it('null deltaBrier → INCONCLUSIVE', () => {
    const v = evaluateIrtVerdict(model({ deltaBrier: null }), shadow());
    expect(v.verdict).toBe('INCONCLUSIVE');
  });

  it('INCONCLUSIVE dominates a would-be FAIL (thin data cannot declare failure)', () => {
    const v = evaluateIrtVerdict(model({ n: 10, deltaAUC: -0.5, deltaBrier: 0.5 }), shadow());
    expect(v.verdict).toBe('INCONCLUSIVE');
  });
});

describe('evaluateIrtVerdict — FAIL (measurable, sufficient volume, thresholds unmet)', () => {
  it('fails when deltaAUC is below threshold', () => {
    const v = evaluateIrtVerdict(model({ deltaAUC: 0.029 }), shadow());
    expect(v.verdict).toBe('FAIL');
    expect(v.reasons.join(' ')).toMatch(/deltaAUC/);
  });

  it('fails when deltaBrier does not improve enough', () => {
    const v = evaluateIrtVerdict(model({ deltaBrier: -0.004 }), shadow());
    expect(v.verdict).toBe('FAIL');
    expect(v.reasons.join(' ')).toMatch(/deltaBrier/);
  });

  it('needs BOTH thresholds — one passing metric does not rescue the other', () => {
    const v = evaluateIrtVerdict(model({ deltaAUC: 0.5, deltaBrier: 0 }), shadow());
    expect(v.verdict).toBe('FAIL');
  });
});

describe('evaluateIrtVerdict — shadow metrics are informational only', () => {
  it('terrible divergence numbers never change a PASS', () => {
    const v = evaluateIrtVerdict(
      model(),
      shadow({ medianSpearman: -0.9, medianTop5Overlap: 0, medianTop10Overlap: 0 }),
    );
    expect(v.verdict).toBe('PASS');
    expect(v.reasons.join(' ')).toMatch(/informational/);
  });

  it('zero shadow samples adds a note but does not gate', () => {
    const v = evaluateIrtVerdict(model(), shadow({ nSamples: 0 }));
    expect(v.verdict).toBe('PASS');
    expect(v.reasons.join(' ')).toMatch(/no irt_shadow_divergence telemetry/);
  });

  it('null shadow summary is tolerated (harness run before telemetry exists)', () => {
    const v = evaluateIrtVerdict(model(), null);
    expect(v.verdict).toBe('PASS');
  });

  it('echoes the applied gates in the result for the report artifact', () => {
    const v = evaluateIrtVerdict(model(), shadow());
    expect(v.gates).toEqual({
      minCalibratedResponses: 500,
      minStudents: 50,
      minDeltaAUC: 0.03,
      maxDeltaBrier: -0.005,
    });
  });
});
