/**
 * Outcome Prediction Agent — PURE composer conformance (GenAI arch Phase 5a).
 *
 * `composeOutcomePrediction` COMPOSES the platform's EXISTING predictors into one
 * unified `OutcomePrediction`. It invents NO new prediction math, NO new
 * thresholds, and NO new pass-mark constant. This suite pins:
 *
 *   1. The 4-tier data-source ladder is selected correctly by which inputs are
 *      present, and each tier's numbers are read from / delegated to the right
 *      existing source (board row verbatim; `predictExamScore`; `cme` verbatim;
 *      else `insufficient_data`).
 *   2. `passLikelihood` moves monotonically around the D→C1 boundary and that
 *      boundary is DERIVED from `calculateBoardExamScore` (never a hardcoded 50).
 *   3. `weakConcepts` / `interventionRecommendations` / `rationale` are populated
 *      deterministically (no LLM), and `atRiskSignals` reflects `PULSE_THRESHOLDS`.
 *   4. Purity: identical inputs → deeply-equal output; never throws on partial
 *      or malformed inputs.
 *
 * The composer is exercised REAL (no mocks) alongside the REAL cognitive-engine /
 * pulse-signals modules it delegates to, so a drift in either surfaces here.
 */
import { describe, it, expect } from 'vitest';
import {
  composeOutcomePrediction,
  type OutcomePredictionInputs,
} from '@alfanumrik/lib/predict/outcome-prediction';
import {
  predictExamScore,
  calculateBoardExamScore,
  type ExamChapter,
} from '@alfanumrik/lib/cognitive-engine';
import { PULSE_THRESHOLDS, type PulseSignals } from '@alfanumrik/lib/pulse/signals';

// ── Shared derived facts (computed from the oracle, NOT hardcoded) ────────────
const DEFAULT_TOTAL_MARKS = calculateBoardExamScore(0, 1).totalMarks; // 80, from the oracle

/** The smallest whole-% the CBSE bands classify as NOT 'D' — derived, not literal. */
function derivedPassBoundary(totalMarks: number): number {
  for (let p = 0; p <= 100; p++) {
    if (calculateBoardExamScore(p, 100, totalMarks).grade !== 'D') return p;
  }
  return 100;
}

/** Minimal well-formed PulseSignals with everything "quiet" (no at-risk). */
function quietSignals(): PulseSignals {
  return {
    inactivity: { verdict: 'ok', daysSinceActive: 0 },
    masteryCliff: {
      verdict: 'none',
      largestDrop: null,
      declineStreak: 0,
      worstSubject: null,
      worstChapter: null,
    },
    atRiskConcentration: { bySubject: [], worstBand: 'none', totalAtRiskChapters: 0 },
  };
}

/** A "loud" signal set that trips every intervention branch. */
function loudSignals(): PulseSignals {
  return {
    inactivity: { verdict: 'broken', daysSinceActive: 4 },
    masteryCliff: {
      verdict: 'flagged',
      largestDrop: 0.3,
      declineStreak: 3,
      worstSubject: 'science',
      worstChapter: 7,
    },
    atRiskConcentration: {
      bySubject: [{ subject: 'science', atRiskChapterCount: 4, band: 'medium' }],
      worstBand: 'medium',
      totalAtRiskChapters: 4,
    },
  };
}

function baseInputs(over: Partial<OutcomePredictionInputs> = {}): OutcomePredictionInputs {
  return { subject: 'math', grade: '10', ...over };
}

// ════════════════════════════════════════════════════════════════════════════
// 1. THE 4-TIER DATA-SOURCE LADDER
// ════════════════════════════════════════════════════════════════════════════

describe('composeOutcomePrediction — data-source ladder (tier selection)', () => {
  it('Tier 1: a board_score_predictions row → range/band/confidence read verbatim from it', () => {
    const out = composeOutcomePrediction(
      baseInputs({
        boardScorePrediction: {
          predictedPct: 75,
          confidenceBandLow: 65,
          confidenceBandHigh: 85,
          coveragePct: 90,
        },
      }),
    );
    expect(out.source).toBe('board_score_predictions');
    expect(out.sufficientData).toBe(true);
    expect(out.boardScoreRange).not.toBeNull();
    // Endpoints are the board row's own percentages (marks round-trip to the same %).
    expect(out.boardScoreRange!.low).toBe(65);
    expect(out.boardScoreRange!.mid).toBe(75);
    expect(out.boardScoreRange!.high).toBe(85);
    expect(out.boardScoreRange!.confidenceBand).toEqual([65, 85]);
    // grade at mid comes straight from the oracle (75% → B1).
    expect(out.boardScoreRange!.grade).toBe(calculateBoardExamScore(75, 100, DEFAULT_TOTAL_MARKS).grade);
    // confidence = coverage passthrough (90/100), NOT a synthesized formula.
    expect(out.confidence.overall).toBe(0.9);
    expect(out.confidence.perPrediction.boardScore).toBe(0.9);
  });

  it('Tier 2: memory-derived chapters (no board row) → delegates to predictExamScore', () => {
    const chapters: ExamChapter[] = [
      { chapterNumber: 1, chapterTitle: 'C1', marksWeightage: 40, difficultyWeight: 1, studentMastery: 0.8, isCovered: true },
      { chapterNumber: 2, chapterTitle: 'C2', marksWeightage: 40, difficultyWeight: 1, studentMastery: 0.8, isCovered: true },
    ];
    const expected = predictExamScore(chapters, DEFAULT_TOTAL_MARKS);

    const out = composeOutcomePrediction(baseInputs({ chapters }));
    expect(out.source).toBe('pure_predict_exam_score');
    // The mid marks + confidence are exactly what predictExamScore returned —
    // proving the composer delegated rather than re-implemented the math.
    expect(out.boardScoreRange!.midMarks).toBe(expected.predicted);
    expect(out.confidence.overall).toBe(expected.confidence);
  });

  it("Tier 2': only cme_exam_readiness → predicted_marks mid, confidence = overall/100", () => {
    const out = composeOutcomePrediction(
      baseInputs({ cmeExamReadiness: { overallScore: 70, predictedMarks: 56 } }),
    );
    expect(out.source).toBe('cme_exam_readiness');
    expect(out.boardScoreRange!.midMarks).toBe(56); // predicted_marks read verbatim
    expect(out.boardScoreRange!.mid).toBe(70); // 56/80 → 70%
    expect(out.confidence.overall).toBe(0.7); // overall_score/100
  });

  it('Tier 3: no usable source → insufficient_data, null range, confidence 0', () => {
    const out = composeOutcomePrediction(baseInputs());
    expect(out.source).toBe('insufficient_data');
    expect(out.sufficientData).toBe(false);
    expect(out.boardScoreRange).toBeNull();
    expect(out.confidence.overall).toBe(0);
    expect(out.passLikelihood.band).toBe('unknown');
    expect(out.passLikelihood.likelihood).toBeNull();
  });

  it('ladder precedence: board > chapters > cme (all present → board wins)', () => {
    const chapters: ExamChapter[] = [
      { chapterNumber: 1, chapterTitle: 'C1', marksWeightage: 80, difficultyWeight: 1, studentMastery: 0.5, isCovered: true },
    ];
    const withBoard = composeOutcomePrediction(
      baseInputs({
        boardScorePrediction: { predictedPct: 60, confidenceBandLow: 50, confidenceBandHigh: 70, coveragePct: 80 },
        chapters,
        cmeExamReadiness: { overallScore: 40, predictedMarks: 32 },
      }),
    );
    expect(withBoard.source).toBe('board_score_predictions');

    // Remove only the board row → chapters win over cme.
    const withoutBoard = composeOutcomePrediction(
      baseInputs({ chapters, cmeExamReadiness: { overallScore: 40, predictedMarks: 32 } }),
    );
    expect(withoutBoard.source).toBe('pure_predict_exam_score');
  });

  it('a malformed board row (non-finite predictedPct) is skipped, falling to the next tier', () => {
    const out = composeOutcomePrediction(
      baseInputs({
        boardScorePrediction: { predictedPct: Number.NaN, confidenceBandLow: 0, confidenceBandHigh: 0, coveragePct: 0 },
        cmeExamReadiness: { overallScore: 55, predictedMarks: 44 },
      }),
    );
    expect(out.source).toBe('cme_exam_readiness');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. PASS LIKELIHOOD — derived boundary, monotone bands
// ════════════════════════════════════════════════════════════════════════════

describe('composeOutcomePrediction — passLikelihood around the derived D→C1 boundary', () => {
  it('basis names the boundary DERIVED from calculateBoardExamScore (no hardcoded pass-mark)', () => {
    const boundary = derivedPassBoundary(DEFAULT_TOTAL_MARKS); // 50, computed from the oracle
    const out = composeOutcomePrediction(
      baseInputs({
        boardScorePrediction: { predictedPct: 75, confidenceBandLow: 65, confidenceBandHigh: 85, coveragePct: 90 },
      }),
    );
    // The basis string reports the SAME boundary the grade oracle yields — if the
    // module hardcoded a different pass mark this would diverge.
    expect(out.passLikelihood.basis).toContain(`${boundary}%`);
    // And the boundary really is the D→C1 seam per the oracle.
    expect(calculateBoardExamScore(boundary, 100, DEFAULT_TOTAL_MARKS).grade).not.toBe('D');
    expect(calculateBoardExamScore(boundary - 1, 100, DEFAULT_TOTAL_MARKS).grade).toBe('D');
  });

  it('well above the boundary → likely (likelihood 1)', () => {
    const out = composeOutcomePrediction(
      baseInputs({
        boardScorePrediction: { predictedPct: 75, confidenceBandLow: 65, confidenceBandHigh: 85, coveragePct: 90 },
      }),
    );
    expect(out.passLikelihood.band).toBe('likely');
    expect(out.passLikelihood.likelihood).toBe(1);
  });

  it('interval straddling the boundary → borderline (0 < likelihood < 1)', () => {
    const out = composeOutcomePrediction(
      baseInputs({
        boardScorePrediction: { predictedPct: 52, confidenceBandLow: 42, confidenceBandHigh: 62, coveragePct: 50 },
      }),
    );
    expect(out.passLikelihood.band).toBe('borderline');
    expect(out.passLikelihood.likelihood).toBeGreaterThan(0);
    expect(out.passLikelihood.likelihood).toBeLessThan(1);
  });

  it('entire interval below the boundary → at_risk (likelihood 0)', () => {
    const out = composeOutcomePrediction(
      baseInputs({
        boardScorePrediction: { predictedPct: 30, confidenceBandLow: 20, confidenceBandHigh: 45, coveragePct: 40 },
      }),
    );
    expect(out.passLikelihood.band).toBe('at_risk');
    expect(out.passLikelihood.likelihood).toBe(0);
  });

  it('band ordering is monotone across the three positions (at_risk < borderline < likely)', () => {
    const mk = (pct: number, lo: number, hi: number) =>
      composeOutcomePrediction(
        baseInputs({ boardScorePrediction: { predictedPct: pct, confidenceBandLow: lo, confidenceBandHigh: hi, coveragePct: 60 } }),
      ).passLikelihood;
    const low = mk(30, 20, 45);
    const mid = mk(52, 42, 62);
    const high = mk(75, 65, 85);
    const rank = { at_risk: 0, borderline: 1, likely: 2, unknown: -1 } as const;
    expect(rank[low.band]).toBeLessThan(rank[mid.band]);
    expect(rank[mid.band]).toBeLessThan(rank[high.band]);
    expect(low.likelihood!).toBeLessThanOrEqual(mid.likelihood!);
    expect(mid.likelihood!).toBeLessThanOrEqual(high.likelihood!);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. WEAK CONCEPTS / INTERVENTIONS / RATIONALE / AT-RISK SIGNALS
// ════════════════════════════════════════════════════════════════════════════

describe('composeOutcomePrediction — weakConcepts reflect PULSE_THRESHOLDS.at_risk_mastery', () => {
  it('includes weak topics strictly BELOW the at-risk line and excludes those AT/above it', () => {
    const line = PULSE_THRESHOLDS.at_risk_mastery; // 0.4, reused verbatim
    const out = composeOutcomePrediction(
      baseInputs({
        memory: {
          weakTopics: [
            { title: 'BelowLine', mastery: line - 0.01 },
            { title: 'OnLine', mastery: line }, // exactly 0.4 → NOT at risk (strict <)
            { title: 'AboveLine', mastery: line + 0.2 },
          ],
        },
      }),
    );
    const weakTopicLabels = out.weakConcepts.filter((c) => c.kind === 'weak_topic').map((c) => c.label);
    expect(weakTopicLabels).toContain('BelowLine');
    expect(weakTopicLabels).not.toContain('OnLine');
    expect(weakTopicLabels).not.toContain('AboveLine');
  });

  it('collects knowledge gaps + weak topics + cme/board weak chapters and sorts weakest-first', () => {
    const out = composeOutcomePrediction(
      baseInputs({
        memory: {
          knowledgeGaps: [{ target: 'Quadratics', prerequisite: 'LinearEq', gapType: 'prerequisite' }],
          weakTopics: [{ title: 'Fractions', mastery: 0.1 }],
        },
        cmeExamReadiness: {
          overallScore: 60,
          predictedMarks: 48,
          weakestChapters: [{ chapter: 3, mastery: 0.25, title: 'Chapter 3' }],
        },
      }),
    );
    const kinds = out.weakConcepts.map((c) => c.kind);
    expect(kinds).toContain('knowledge_gap');
    expect(kinds).toContain('weak_topic');
    expect(kinds).toContain('weak_chapter');
    // Weakest-first: known masteries ascending, unknown-mastery (gap) entries last.
    const knownMasteries = out.weakConcepts.map((c) => c.mastery).filter((m): m is number => m != null);
    const sorted = [...knownMasteries].sort((a, b) => a - b);
    expect(knownMasteries).toEqual(sorted);
    expect(out.weakConcepts[out.weakConcepts.length - 1].mastery).toBeNull(); // gap sinks last
  });
});

describe('composeOutcomePrediction — deterministic interventions + rationale (no LLM)', () => {
  it('emits one recommendation per triggered branch, in stable priority order', () => {
    const out = composeOutcomePrediction(
      baseInputs({
        memory: { knowledgeGaps: [{ target: 'Quadratics', prerequisite: 'LinearEq', gapType: 'prerequisite' }] },
        cmeExamReadiness: {
          overallScore: 50,
          predictedMarks: 40,
          weakestChapters: [{ chapter: 5, mastery: 0.2, title: 'Chapter 5' }],
        },
        pulseSignals: loudSignals(),
      }),
    );
    const kinds = out.interventionRecommendations.map((r) => r.kind);
    expect(kinds).toContain('remediate_prerequisite'); // from knowledge gap
    expect(kinds).toContain('review_regression'); // from flagged mastery cliff
    expect(kinds).toContain('revise_chapter'); // from weak chapter
    expect(kinds).toContain('concentrate_subject'); // from at-risk concentration
    expect(kinds).toContain('resume_practice'); // from broken inactivity
    // Priority is a stable ascending ordinal (ordering only, not a threshold).
    const priorities = out.interventionRecommendations.map((r) => r.priority);
    expect(priorities).toEqual([...priorities].sort((a, b) => a - b));
    // Root-cause remediation ranks ahead of resume-practice.
    const remediate = out.interventionRecommendations.find((r) => r.kind === 'remediate_prerequisite')!;
    const resume = out.interventionRecommendations.find((r) => r.kind === 'resume_practice')!;
    expect(remediate.priority).toBeLessThan(resume.priority);
  });

  it('rationale is an array of structured {code, detail} string drivers (never free-form LLM text)', () => {
    const out = composeOutcomePrediction(
      baseInputs({
        boardScorePrediction: { predictedPct: 60, confidenceBandLow: 50, confidenceBandHigh: 70, coveragePct: 80 },
        memory: { knowledgeGaps: [{ target: 'Quadratics', prerequisite: 'LinearEq', gapType: 'prerequisite' }] },
        learningVelocity: 1.2,
      }),
    );
    expect(Array.isArray(out.rationale)).toBe(true);
    for (const d of out.rationale) {
      expect(typeof d.code).toBe('string');
      expect(d.code.length).toBeGreaterThan(0);
      expect(typeof d.detail).toBe('string');
      expect(d.detail.length).toBeGreaterThan(0);
    }
    const codes = out.rationale.map((d) => d.code);
    expect(codes).toContain('source'); // always present
    expect(codes).toContain('weak_prerequisites'); // gaps present
    expect(codes).toContain('board_coverage'); // board row present
    expect(codes).toContain('learning_velocity'); // velocity present
  });

  it('atRiskSignals.anyAtRisk mirrors the pulse verdicts (loud → true, quiet → false)', () => {
    const loud = composeOutcomePrediction(baseInputs({ pulseSignals: loudSignals() }));
    expect(loud.atRiskSignals.anyAtRisk).toBe(true);
    expect(loud.atRiskSignals.signals).not.toBeNull();

    const quiet = composeOutcomePrediction(baseInputs({ pulseSignals: quietSignals() }));
    expect(quiet.atRiskSignals.anyAtRisk).toBe(false);

    const none = composeOutcomePrediction(baseInputs());
    expect(none.atRiskSignals.anyAtRisk).toBe(false);
    expect(none.atRiskSignals.signals).toBeNull();
  });

  it('passes P5 grade string + subject + learningVelocity through verbatim', () => {
    const out = composeOutcomePrediction(baseInputs({ grade: '7', subject: 'science', learningVelocity: -0.5 }));
    expect(out.grade).toBe('7');
    expect(typeof out.grade).toBe('string');
    expect(out.subject).toBe('science');
    expect(out.learningVelocity).toBe(-0.5);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. PURITY — deterministic + never throws
// ════════════════════════════════════════════════════════════════════════════

describe('composeOutcomePrediction — purity', () => {
  it('identical inputs → deeply-equal output (deterministic, no clock/RNG)', () => {
    const inputs = baseInputs({
      boardScorePrediction: { predictedPct: 66, confidenceBandLow: 56, confidenceBandHigh: 76, coveragePct: 70 },
      memory: { knowledgeGaps: [{ target: 'A', prerequisite: 'B', gapType: 'x' }], weakTopics: [{ title: 'T', mastery: 0.2 }] },
      pulseSignals: loudSignals(),
    });
    expect(composeOutcomePrediction(inputs)).toEqual(composeOutcomePrediction(inputs));
  });

  it('never throws on minimal, empty, or malformed inputs', () => {
    expect(() => composeOutcomePrediction(baseInputs())).not.toThrow();
    expect(() =>
      composeOutcomePrediction(
        baseInputs({
          totalBoardMarks: 0, // falls back to the oracle default
          boardScorePrediction: { predictedPct: Number.POSITIVE_INFINITY, confidenceBandLow: -5, confidenceBandHigh: 999, coveragePct: -1 },
          chapters: [],
          cmeExamReadiness: { overallScore: Number.NaN, predictedMarks: Number.NaN },
          memory: { weakTopics: [{ title: 'x', mastery: Number.NaN }] },
          pulseSignals: null,
          learningVelocity: Number.NaN,
        }),
      ),
    ).not.toThrow();
  });

  it('confidence and likelihood always stay within their [0,1] domains', () => {
    const out = composeOutcomePrediction(
      baseInputs({ cmeExamReadiness: { overallScore: 250, predictedMarks: 500 } }),
    );
    expect(out.confidence.overall).toBeGreaterThanOrEqual(0);
    expect(out.confidence.overall).toBeLessThanOrEqual(1);
    if (out.passLikelihood.likelihood != null) {
      expect(out.passLikelihood.likelihood).toBeGreaterThanOrEqual(0);
      expect(out.passLikelihood.likelihood).toBeLessThanOrEqual(1);
    }
  });
});
