// apps/host/src/__tests__/lib/ai/eval/response-eval.test.ts
//
// Phase 4 — Runtime `ResponseEval` observability sensor: PURE COMPOSER contract.
//
// Pins the per-dimension normalization (all 9 dims, incl. every boundary value)
// and the 6-condition observability verdict from the spec
// (docs/superpowers/specs/2026-07-24-runtime-response-eval-design.md, §3 + §4).
//
// This is OBSERVABILITY-ONLY: `scoreResponse` never blocks/alters a response —
// `flagged` is a dashboard signal, not enforcement. The two deferred dims
// (accuracy, learning_effectiveness) are always null/unavailable at runtime, and
// difficulty_fit + the deferred dims NEVER contribute a flag.
//
// Owner: testing. Reviewers per spec §8: assessment (dimension semantics),
// ai-engineer (signal plumbing). Source under test:
// packages/lib/src/ai/eval/response-eval.ts (imported via the barrel).

import { describe, it, expect } from 'vitest';

import {
  scoreResponse,
  HALLUCINATION_CONFIDENCE_FLOOR,
  UNGROUNDED_CONFIDENCE_CAP,
  LATENCY_HEALTHY_MS,
  LATENCY_DEGRADED_CEILING_MS,
  COST_PER_TURN_BUDGET_USD,
  COST_PER_TURN_CEILING_USD,
  type ResponseEvalSignals,
} from '@alfanumrik/lib/ai/eval';

// A fully-CLEAN, fully-healthy signal set: no dimension flags, every available
// dim at full health. Every case overrides only the field(s) under test so the
// assertion isolates one dimension / one flag condition.
function cleanSignals(overrides: Partial<ResponseEvalSignals> = {}): ResponseEvalSignals {
  return {
    curriculumInScope: true,
    curriculumReason: null,
    confidence: 0.9,
    groundedFromChunks: true,
    citationsCount: 2,
    screenCategories: [],
    gradeRangeSoftFail: false,
    masteryLevel: 0.6, // in ZPD [0.4,0.85) → difficulty_fit 1.0
    latencyMs: 500, // ≤ healthy → latency 1.0
    costUsd: 0.01, // ≤ budget → cost 1.0
    traceId: '11111111-1111-4111-8111-111111111111',
    sessionId: '22222222-2222-4222-8222-222222222222',
    messageId: '33333333-3333-4333-8333-333333333333',
    grade: '8',
    subject: 'science',
    ...overrides,
  };
}

describe('scoreResponse — constants bind to the live pipeline (no magic numbers)', () => {
  it('reuses the grounded-pipeline confidence thresholds and gateway anchors', () => {
    expect(HALLUCINATION_CONFIDENCE_FLOOR).toBe(0.75); // STRICT_CONFIDENCE_ABSTAIN_THRESHOLD
    expect(UNGROUNDED_CONFIDENCE_CAP).toBe(0.6); // SOFT_CONFIDENCE_BANNER_THRESHOLD
    expect(LATENCY_HEALTHY_MS).toBe(800); // HAIKU.p50LatencyMs
    expect(LATENCY_DEGRADED_CEILING_MS).toBe(8000);
    expect(COST_PER_TURN_CEILING_USD).toBe(0.25);
    // Derived budget = estimateCostUsd(HAIKU, 8192, 8192) ≈ $0.0492.
    expect(COST_PER_TURN_BUDGET_USD).toBeCloseTo(0.049152, 6);
  });
});

describe('scoreResponse — deferred dimensions (accuracy, learning_effectiveness)', () => {
  it('are always unavailable/null at runtime regardless of signals', () => {
    for (const signals of [cleanSignals(), cleanSignals({ curriculumInScope: false, confidence: 0.1 })]) {
      const e = scoreResponse(signals);
      for (const dim of [e.accuracy, e.learning_effectiveness]) {
        expect(dim.available).toBe(false);
        expect(dim.score).toBeNull();
        expect(dim.raw).toBeNull();
        expect(dim.source).toBe('deferred_llm_judge');
      }
    }
  });
});

describe('scoreResponse — curriculum_alignment normalization', () => {
  const cases: Array<{
    name: string;
    inScope: boolean;
    reason?: string | null;
    score: number;
    code: string;
  }> = [
    { name: 'in scope → 1', inScope: true, score: 1, code: 'in_scope' },
    {
      name: 'out of scope with reason → 0, code=reason',
      inScope: false,
      reason: 'scope_mismatch:physics',
      score: 0,
      code: 'scope_mismatch:physics',
    },
    {
      name: 'out of scope without reason → 0, code=out_of_scope',
      inScope: false,
      reason: null,
      score: 0,
      code: 'out_of_scope',
    },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const e = scoreResponse(cleanSignals({ curriculumInScope: c.inScope, curriculumReason: c.reason }));
      expect(e.curriculum_alignment.score).toBe(c.score);
      expect(e.curriculum_alignment.code).toBe(c.code);
      expect(e.curriculum_alignment.raw ?? null).toBeNull(); // boolean+reason source, no numeric scope
      expect(e.curriculum_alignment.source).toBe('curriculum');
      expect(e.curriculum_alignment.available).toBe(true);
    });
  }
});

describe('scoreResponse — hallucination_risk normalization (raw=confidence, capped when ungrounded)', () => {
  const cases: Array<{
    name: string;
    confidence: number | null;
    grounded: boolean;
    citations: number;
    score: number | null;
    code: string;
  }> = [
    { name: 'grounded + citations → health tracks confidence', confidence: 0.9, grounded: true, citations: 2, score: 0.9, code: 'grounded' },
    { name: 'grounded but 0 citations → no_citations + capped', confidence: 0.9, grounded: true, citations: 0, score: UNGROUNDED_CONFIDENCE_CAP, code: 'no_citations' },
    { name: 'ungrounded high-confidence → capped at UNGROUNDED_CONFIDENCE_CAP', confidence: 0.95, grounded: false, citations: 3, score: UNGROUNDED_CONFIDENCE_CAP, code: 'ungrounded' },
    { name: 'ungrounded at cap boundary (0.6) → 0.6', confidence: 0.6, grounded: false, citations: 3, score: 0.6, code: 'ungrounded' },
    { name: 'ungrounded below cap → uncapped (min wins)', confidence: 0.4, grounded: false, citations: 3, score: 0.4, code: 'ungrounded' },
    { name: 'confidence null → score null', confidence: null, grounded: true, citations: 2, score: null, code: 'grounded' },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const e = scoreResponse(
        cleanSignals({ confidence: c.confidence, groundedFromChunks: c.grounded, citationsCount: c.citations }),
      );
      expect(e.hallucination_risk.score).toBe(c.score);
      expect(e.hallucination_risk.raw ?? null).toBe(c.confidence);
      expect(e.hallucination_risk.code).toBe(c.code);
      expect(e.hallucination_risk.source).toBe('grounding');
    });
  }
});

describe('scoreResponse — age_appropriateness (deterministic 1.0 / 0.5 / 0.0)', () => {
  const cases: Array<{ name: string; cats: string[]; softFail?: boolean; score: number; code: string }> = [
    { name: 'clean → 1.0', cats: [], score: 1, code: 'clean' },
    { name: 'legacy_validator_flag → 0.5 advisory', cats: ['legacy_validator_flag'], score: 0.5, code: 'legacy_validator_flag' },
    { name: 'grade-range soft-fail → 0.5 advisory', cats: [], softFail: true, score: 0.5, code: 'grade_range_soft' },
    { name: 'blocklist → 0.0 hard-fail', cats: ['blocklist'], score: 0, code: 'blocklist' },
    { name: 'screen_error → 0.0 hard-fail', cats: ['screen_error'], score: 0, code: 'screen_error' },
    { name: 'blocklist wins over advisory', cats: ['blocklist', 'legacy_validator_flag'], score: 0, code: 'blocklist' },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const e = scoreResponse(cleanSignals({ screenCategories: c.cats, gradeRangeSoftFail: c.softFail ?? false }));
      expect(e.age_appropriateness.score).toBe(c.score);
      expect(e.age_appropriateness.code).toBe(c.code);
      expect(e.age_appropriateness.raw ?? null).toBeNull();
      expect(e.age_appropriateness.source).toBe('deterministic');
    });
  }
});

describe('scoreResponse — toxicity (binary blocklist/screen_error → 0 else 1)', () => {
  const cases: Array<{ name: string; cats: string[]; score: number; code: string }> = [
    { name: 'clean → 1', cats: [], score: 1, code: 'clean' },
    { name: 'blocklist → 0', cats: ['blocklist'], score: 0, code: 'blocklist' },
    { name: 'screen_error → 0', cats: ['screen_error'], score: 0, code: 'screen_error' },
    // legacy_validator_flag is an AGE advisory only — toxicity stays clean(1).
    { name: 'legacy_validator_flag alone → toxicity 1 (age-only signal)', cats: ['legacy_validator_flag'], score: 1, code: 'clean' },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const e = scoreResponse(cleanSignals({ screenCategories: c.cats }));
      expect(e.toxicity.score).toBe(c.score);
      expect(e.toxicity.code).toBe(c.code);
      expect(e.toxicity.raw ?? null).toBeNull();
      expect(e.toxicity.source).toBe('deterministic');
    });
  }
});

describe('scoreResponse — difficulty_fit mastery bands (advisory, raw=mastery)', () => {
  const cases: Array<{ name: string; mastery: number | null; score: number | null; code: string | null }> = [
    { name: 'below building max (0.39) → 0.5 building', mastery: 0.39, score: 0.5, code: 'building' },
    { name: 'boundary 0.4 (building max) → 1.0 in-ZPD developing', mastery: 0.4, score: 1, code: 'developing' },
    { name: 'mid ZPD 0.6 → 1.0 developing (<0.7)', mastery: 0.6, score: 1, code: 'developing' },
    { name: 'boundary 0.7 (secure min) → 1.0 secure', mastery: 0.7, score: 1, code: 'secure' },
    { name: 'just below ZPD ceiling 0.84 → 1.0 secure', mastery: 0.84, score: 1, code: 'secure' },
    { name: 'boundary 0.85 (ZPD ceiling) → 0.5 over_mastered', mastery: 0.85, score: 0.5, code: 'over_mastered' },
    { name: 'over-mastered 0.95 → 0.5 over_mastered', mastery: 0.95, score: 0.5, code: 'over_mastered' },
    { name: 'unknown mastery (null) → unavailable', mastery: null, score: null, code: null },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const e = scoreResponse(cleanSignals({ masteryLevel: c.mastery }));
      expect(e.difficulty_fit.score).toBe(c.score);
      expect(e.difficulty_fit.code ?? null).toBe(c.code);
      expect(e.difficulty_fit.raw ?? null).toBe(c.mastery);
      expect(e.difficulty_fit.source).toBe('mastery');
      expect(e.difficulty_fit.available).toBe(c.mastery !== null);
    });
  }
});

describe('scoreResponse — latency normalization (1.0 ≤800ms, linear to 0 at 8000ms)', () => {
  const cases: Array<{ name: string; ms: number | null; score: number | null; code: string | null }> = [
    { name: '500ms → 1.0 healthy', ms: 500, score: 1, code: 'healthy' },
    { name: 'boundary 800ms (healthy) → 1.0', ms: LATENCY_HEALTHY_MS, score: 1, code: 'healthy' },
    { name: 'midpoint 4400ms → 0.5 degraded', ms: 4400, score: 0.5, code: 'degraded' },
    { name: 'boundary 8000ms (ceiling) → 0.0 degraded, NO flag', ms: LATENCY_DEGRADED_CEILING_MS, score: 0, code: 'degraded' },
    { name: '8001ms → 0.0 over_ceiling', ms: 8001, score: 0, code: 'over_ceiling' },
    { name: 'null → unavailable', ms: null, score: null, code: null },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const e = scoreResponse(cleanSignals({ latencyMs: c.ms }));
      if (c.score === null) expect(e.latency.score).toBeNull();
      else expect(e.latency.score).toBeCloseTo(c.score, 10);
      expect(e.latency.code ?? null).toBe(c.code);
      expect(e.latency.raw ?? null).toBe(c.ms);
      expect(e.latency.source).toBe('gateway');
    });
  }
});

describe('scoreResponse — cost normalization (1.0 ≤budget, linear to 0 at ceiling)', () => {
  it('at/below budget → 1.0 within_budget', () => {
    const e = scoreResponse(cleanSignals({ costUsd: COST_PER_TURN_BUDGET_USD }));
    expect(e.cost.score).toBe(1);
    expect(e.cost.code).toBe('within_budget');
    expect(e.cost.raw).toBe(COST_PER_TURN_BUDGET_USD);
  });
  it('at ceiling → 0.0 elevated, NO flag (not strictly over)', () => {
    const e = scoreResponse(cleanSignals({ costUsd: COST_PER_TURN_CEILING_USD }));
    expect(e.cost.score).toBe(0);
    expect(e.cost.code).toBe('elevated');
    expect(e.flagReasons).not.toContain('cost_over_ceiling');
  });
  it('midpoint → 0.5 elevated', () => {
    const mid = (COST_PER_TURN_BUDGET_USD + COST_PER_TURN_CEILING_USD) / 2;
    const e = scoreResponse(cleanSignals({ costUsd: mid }));
    expect(e.cost.score).toBeCloseTo(0.5, 10);
    expect(e.cost.code).toBe('elevated');
  });
  it('above ceiling → 0.0 over_ceiling', () => {
    const e = scoreResponse(cleanSignals({ costUsd: 0.26 }));
    expect(e.cost.score).toBe(0);
    expect(e.cost.code).toBe('over_ceiling');
  });
  it('null → unavailable', () => {
    const e = scoreResponse(cleanSignals({ costUsd: null }));
    expect(e.cost.score).toBeNull();
    expect(e.cost.available).toBe(false);
  });
});

describe('scoreResponse — verdict: 6 flag conditions (observability only)', () => {
  it('a clean response → flagged:false, flagReasons:[]', () => {
    const e = scoreResponse(cleanSignals());
    expect(e.flagged).toBe(false);
    expect(e.flagReasons).toEqual([]);
  });

  it('toxicity_unsafe fires ONLY when toxicity score is 0', () => {
    const e = scoreResponse(cleanSignals({ screenCategories: ['blocklist'] }));
    expect(e.flagReasons).toContain('toxicity_unsafe');
    // clean toxicity does not fire it
    expect(scoreResponse(cleanSignals()).flagReasons).not.toContain('toxicity_unsafe');
  });

  it('age_inappropriate fires ONLY on age hard-fail (score 0)', () => {
    const e = scoreResponse(cleanSignals({ screenCategories: ['screen_error'] }));
    expect(e.flagReasons).toContain('age_inappropriate');
    // advisory (0.5) does NOT flag
    expect(scoreResponse(cleanSignals({ screenCategories: ['legacy_validator_flag'] })).flagReasons).not.toContain(
      'age_inappropriate',
    );
  });

  it('curriculum_out_of_scope fires ONLY when inScope is false', () => {
    const e = scoreResponse(cleanSignals({ curriculumInScope: false, curriculumReason: 'off_topic' }));
    expect(e.flagReasons).toContain('curriculum_out_of_scope');
    expect(scoreResponse(cleanSignals()).flagReasons).not.toContain('curriculum_out_of_scope');
  });

  it('hallucination_risk_high fires ONLY when confidence < floor AND not grounded', () => {
    // below floor + ungrounded → fires
    expect(
      scoreResponse(cleanSignals({ confidence: 0.74, groundedFromChunks: false })).flagReasons,
    ).toContain('hallucination_risk_high');
    // below floor but GROUNDED → does not fire
    expect(
      scoreResponse(cleanSignals({ confidence: 0.74, groundedFromChunks: true })).flagReasons,
    ).not.toContain('hallucination_risk_high');
    // boundary: confidence EXACTLY at floor (0.75) ungrounded → NOT < floor → does not fire
    expect(
      scoreResponse(cleanSignals({ confidence: HALLUCINATION_CONFIDENCE_FLOOR, groundedFromChunks: false }))
        .flagReasons,
    ).not.toContain('hallucination_risk_high');
  });

  it('latency_over_ceiling fires ONLY strictly above the ceiling', () => {
    expect(scoreResponse(cleanSignals({ latencyMs: 8001 })).flagReasons).toContain('latency_over_ceiling');
    // exactly at ceiling → no flag
    expect(
      scoreResponse(cleanSignals({ latencyMs: LATENCY_DEGRADED_CEILING_MS })).flagReasons,
    ).not.toContain('latency_over_ceiling');
  });

  it('cost_over_ceiling fires ONLY strictly above the ceiling', () => {
    expect(scoreResponse(cleanSignals({ costUsd: 0.26 })).flagReasons).toContain('cost_over_ceiling');
    expect(
      scoreResponse(cleanSignals({ costUsd: COST_PER_TURN_CEILING_USD })).flagReasons,
    ).not.toContain('cost_over_ceiling');
  });

  it('difficulty_fit NEVER flags — even at its poorest bands', () => {
    for (const mastery of [0.1, 0.99]) {
      const e = scoreResponse(cleanSignals({ masteryLevel: mastery }));
      expect(e.difficulty_fit.score).toBe(0.5);
      expect(e.flagged).toBe(false);
      expect(e.flagReasons).toEqual([]);
    }
  });

  it('deferred dims NEVER contribute a flag reason', () => {
    // Even when everything else is clean, the null accuracy/learning dims add nothing.
    const e = scoreResponse(cleanSignals());
    expect(e.flagReasons.some((r) => r.includes('accuracy') || r.includes('learning'))).toBe(false);
  });

  it('multiple simultaneous flags accumulate, sorted + deduped, no difficulty/deferred contribution', () => {
    const e = scoreResponse(
      cleanSignals({
        screenCategories: ['blocklist'], // toxicity_unsafe + age_inappropriate
        curriculumInScope: false,
        curriculumReason: 'off_topic', // curriculum_out_of_scope
        confidence: 0.5,
        groundedFromChunks: false, // hallucination_risk_high
        latencyMs: 9000, // latency_over_ceiling
        costUsd: 0.3, // cost_over_ceiling
        masteryLevel: 0.1, // difficulty poor but must NOT flag
      }),
    );
    expect(e.flagged).toBe(true);
    expect(e.flagReasons).toEqual([
      'age_inappropriate',
      'cost_over_ceiling',
      'curriculum_out_of_scope',
      'hallucination_risk_high',
      'latency_over_ceiling',
      'toxicity_unsafe',
    ]);
    // sorted
    expect([...e.flagReasons].sort()).toEqual(e.flagReasons);
    // deduped
    expect(new Set(e.flagReasons).size).toBe(e.flagReasons.length);
    // no difficulty flag leaked in
    expect(e.flagReasons.some((r) => r.includes('difficulty'))).toBe(false);
  });
});

describe('scoreResponse — correlation fields (P13-safe ids / scope enums)', () => {
  it('passes through UUIDs + grade + subject only when present', () => {
    const e = scoreResponse(cleanSignals());
    expect(e.traceId).toBe('11111111-1111-4111-8111-111111111111');
    expect(e.sessionId).toBe('22222222-2222-4222-8222-222222222222');
    expect(e.messageId).toBe('33333333-3333-4333-8333-333333333333');
    expect(e.grade).toBe('8'); // P5 string
    expect(e.subject).toBe('science');
  });
});
