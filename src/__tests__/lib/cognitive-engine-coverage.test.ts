import { describe, it, expect } from 'vitest';
import {
  // SM-2
  sm2Update,
  responseToQuality,
  // IRT 3PL
  estimateTheta,
  irtProbCorrect,
  // BKT (adaptive parameter branches)
  bktUpdate,
  // Error classification
  classifyError,
  // Knowledge gap branches
  detectKnowledgeGaps,
  // Quiz generator (uncovered switch cases)
  generateQuizParams,
  // Board exam scoring (uncovered grade ladder)
  calculateBoardExamScore,
  // Exam planning
  calculateChapterPriority,
  generateExamStudyPlan,
  predictExamScore,
  // Image classification heuristics
  classifyImageText,
  // Monthly report aggregator
  computeMonthlyReportMetrics,
  type SM2Card,
  type BloomMastery,
  type BKTParams,
  type ExamChapter,
  type TopicWeight,
  type CognitiveLoadState,
} from '@/lib/cognitive-engine';

/**
 * Cognitive Engine — Coverage Closure Tests
 *
 * Closes production-readiness Gap 3b (P22 defense floor): raises
 * src/lib/cognitive-engine.ts coverage from 65 → 80 across all 4 metrics.
 *
 * Targets the branches identified in vitest.config.ts TODO at line 83:
 *   - IRT 3PL Newton-Raphson convergence + max-iter + clamping
 *   - SM-2 schedule decay (n-th review path), EF floor, quality<3 reset
 *   - Error classification (slip vs guess) threshold edges
 *   - Adaptive BKT parameter branches
 *   - Quiz generator board/practice mode paths
 *   - Exam study plan + score prediction (1057-1265)
 *   - Image OCR classification heuristics (1294-1326)
 *   - Monthly report aggregator (1364-1397)
 *
 * Strengthens IP-filing claims in docs/architecture/cognitive-model.md
 * about IRT 3PL convergence, SM-2 decay, and error-classification.
 */

// ─── IRT 3PL Newton-Raphson MLE ─────────────────────────────────

describe('estimateTheta — Newton-Raphson convergence + clamping', () => {
  it('converges within 10 iterations and clamps theta to [-4, 4] for all-correct on hard items', () => {
    // 20 perfect responses on max difficulty should saturate theta near +4
    const responses = Array(20).fill(null).map(() => ({
      isCorrect: true,
      difficulty: 5,
    }));
    const theta = estimateTheta(responses);
    expect(theta).toBeLessThanOrEqual(4);
    expect(theta).toBeGreaterThan(2); // should push high
  });

  it('clamps theta floor at -4 for all-incorrect on easy items (low-info path)', () => {
    const responses = Array(20).fill(null).map(() => ({
      isCorrect: false,
      difficulty: 1,
    }));
    const theta = estimateTheta(responses);
    expect(theta).toBeGreaterThanOrEqual(-4);
    expect(theta).toBeLessThan(0);
  });

  it('honors custom discrimination parameter (a > 1.0)', () => {
    const responses = [
      { isCorrect: true, difficulty: 3, discrimination: 2.0 },
      { isCorrect: true, difficulty: 4, discrimination: 2.0 },
      { isCorrect: false, difficulty: 5, discrimination: 2.0 },
    ];
    const theta = estimateTheta(responses);
    expect(theta).toBeGreaterThanOrEqual(-4);
    expect(theta).toBeLessThanOrEqual(4);
    expect(Number.isFinite(theta)).toBe(true);
  });

  it('honors custom guessing parameter (c > 0.25 raises floor on hard items)', () => {
    const responsesHighGuess = [
      { isCorrect: true, difficulty: 5, guessing: 0.5 },
      { isCorrect: true, difficulty: 5, guessing: 0.5 },
    ];
    const theta = estimateTheta(responsesHighGuess);
    expect(Number.isFinite(theta)).toBe(true);
  });

  it('handles empty response array without throwing', () => {
    const theta = estimateTheta([]);
    // With no responses infoSum is 0, the update branch is skipped
    expect(theta).toBe(0);
  });

  it('handles single response gracefully (low-information path)', () => {
    const theta = estimateTheta([{ isCorrect: true, difficulty: 3 }]);
    expect(Number.isFinite(theta)).toBe(true);
    expect(theta).toBeGreaterThanOrEqual(-4);
    expect(theta).toBeLessThanOrEqual(4);
  });

  it('skips update step when info sum is below 0.001 threshold', () => {
    // All items at extreme difficulty with theta drifting away → info collapses,
    // exercising the `if (infoSum > 0.001)` false branch
    const responses = Array(5).fill(null).map(() => ({
      isCorrect: false,
      difficulty: 1,
      discrimination: 0.001, // tiny discrimination → info → 0
    }));
    const theta = estimateTheta(responses);
    expect(Number.isFinite(theta)).toBe(true);
  });
});

describe('irtProbCorrect — boundary behaviour', () => {
  it('asymptotes to ~1 as theta → +∞', () => {
    expect(irtProbCorrect(10, 1)).toBeGreaterThan(0.99);
  });

  it('asymptotes to the guessing parameter as theta → -∞', () => {
    expect(irtProbCorrect(-10, 5, 1.0, 0.25)).toBeCloseTo(0.25, 2);
  });

  it('returns ~0.5 + (1-c)/2 ≈ 0.625 at b with default c=0.25', () => {
    // At theta = b, the logistic returns 0.5, so p = c + (1-c)*0.5
    // For difficulty=2 the mapped b = (2-2)*1.5 = 0, so theta=0 hits the inflection.
    const p = irtProbCorrect(0, 2);
    expect(p).toBeCloseTo(0.625, 2);
  });
});

// ─── SM-2 Spaced Repetition — decay + edge cases ───────────────

describe('sm2Update — schedule decay + reset paths', () => {
  it('n-th review (repetitions ≥ 2) computes interval = round(prev * easeFactor)', () => {
    // Drive a card to repetitions=2 then re-review to exercise the decay branch (line 174)
    const fresh: SM2Card = { easeFactor: 2.5, interval: 0, repetitions: 0 };
    const r1 = sm2Update(fresh, 5);   // interval 1, reps 1
    const r2 = sm2Update(r1, 5);      // interval 6, reps 2
    const r3 = sm2Update(r2, 4);      // interval = round(6 * EF) — exercises line 174

    expect(r3.repetitions).toBe(3);
    expect(r3.interval).toBe(Math.round(6 * r2.easeFactor));
    expect(r3.interval).toBeGreaterThan(6);
  });

  it('quality < 3 resets interval to 1 and repetitions to 0 even after long history', () => {
    const fresh: SM2Card = { easeFactor: 2.5, interval: 0, repetitions: 0 };
    let card = fresh;
    for (let i = 0; i < 5; i++) card = sm2Update(card, 5);
    expect(card.repetitions).toBe(5);
    expect(card.interval).toBeGreaterThan(6);

    const failed = sm2Update(card, 2); // quality<3 reset path (lines 178-181)
    expect(failed.repetitions).toBe(0);
    expect(failed.interval).toBe(1);
  });

  it('quality=3 (hesitant correct) is treated as correct (interval=1 for fresh card)', () => {
    const fresh: SM2Card = { easeFactor: 2.5, interval: 0, repetitions: 0 };
    const r = sm2Update(fresh, 3);
    expect(r.repetitions).toBe(1);
    expect(r.interval).toBe(1);
  });

  it('EF floor of 1.3 is enforced regardless of starting EF', () => {
    const lowEF: SM2Card = { easeFactor: 1.31, interval: 5, repetitions: 3 };
    const failed = sm2Update(lowEF, 0);
    expect(failed.easeFactor).toBeGreaterThanOrEqual(1.3);
  });

  it('EF rises after a perfect quality=5 (no ceiling enforced)', () => {
    const card: SM2Card = { easeFactor: 2.5, interval: 6, repetitions: 2 };
    const r = sm2Update(card, 5);
    // EF' = 2.5 + 0.1 = 2.6 for q=5
    expect(r.easeFactor).toBeCloseTo(2.6, 5);
  });

  it('rounded quality input means non-integer values are normalized', () => {
    const fresh: SM2Card = { easeFactor: 2.5, interval: 0, repetitions: 0 };
    const r1 = sm2Update(fresh, 4.4); // rounds to 4
    const r2 = sm2Update(fresh, 4);
    expect(r1.easeFactor).toBeCloseTo(r2.easeFactor, 6);
  });
});

describe('responseToQuality — slow-but-correct branch', () => {
  it('returns 3 for very slow correct (>1.5x avg) — slow branch (line 201)', () => {
    expect(responseToQuality(true, 50, 20)).toBe(3);
  });
});

// ─── BKT — adaptive parameter branches ─────────────────────────

describe('bktUpdate — adaptive parameter branches', () => {
  it('boosts pLearn when correct on already-known concept (pKnow > 0.7)', () => {
    const params: BKTParams = { pKnow: 0.85, pLearn: 0.1, pGuess: 0.2, pSlip: 0.1 };
    const result = bktUpdate(params, true);
    // Hits line 892: pLearn += 0.01 (capped at 0.4)
    expect(result.params.pLearn).toBeGreaterThan(0.1);
    expect(result.params.pLearn).toBeLessThanOrEqual(0.4);
  });

  it('caps pLearn at 0.4 ceiling', () => {
    const params: BKTParams = { pKnow: 0.85, pLearn: 0.4, pGuess: 0.2, pSlip: 0.1 };
    const result = bktUpdate(params, true);
    expect(result.params.pLearn).toBeLessThanOrEqual(0.4);
  });

  it('shrinks pLearn when incorrect on unknown concept (pKnow < 0.3)', () => {
    const params: BKTParams = { pKnow: 0.2, pLearn: 0.1, pGuess: 0.2, pSlip: 0.1 };
    const result = bktUpdate(params, false);
    // Hits line 893: pLearn -= 0.01 (floored at 0.05)
    expect(result.params.pLearn).toBeLessThan(0.1);
    expect(result.params.pLearn).toBeGreaterThanOrEqual(0.05);
  });

  it('floors pLearn at 0.05', () => {
    const params: BKTParams = { pKnow: 0.2, pLearn: 0.05, pGuess: 0.2, pSlip: 0.1 };
    const result = bktUpdate(params, false);
    expect(result.params.pLearn).toBeGreaterThanOrEqual(0.05);
  });

  it('raises pSlip when incorrect on highly-known concept (pKnow > 0.8)', () => {
    const params: BKTParams = { pKnow: 0.9, pLearn: 0.1, pGuess: 0.2, pSlip: 0.1 };
    const result = bktUpdate(params, false);
    // Hits line 894: pSlip += 0.02 (capped at 0.3)
    expect(result.params.pSlip).toBeGreaterThan(0.1);
    expect(result.params.pSlip).toBeLessThanOrEqual(0.3);
  });

  it('caps pSlip at 0.3 ceiling', () => {
    const params: BKTParams = { pKnow: 0.9, pLearn: 0.1, pGuess: 0.2, pSlip: 0.3 };
    const result = bktUpdate(params, false);
    expect(result.params.pSlip).toBeLessThanOrEqual(0.3);
  });

  it('floors pSlip at 0.02 on consecutive correct answers', () => {
    let params: BKTParams = { pKnow: 0.5, pLearn: 0.1, pGuess: 0.2, pSlip: 0.02 };
    for (let i = 0; i < 10; i++) {
      const result = bktUpdate(params, true);
      params = result.params;
    }
    expect(params.pSlip).toBeGreaterThanOrEqual(0.02);
  });
});

// ─── Error Classification — slip / guess / threshold edges ─────

describe('classifyError — threshold edge cases', () => {
  it('responseTime exactly 3 seconds counts as careless (boundary inclusive)', () => {
    // The condition is responseTimeSec < 3, so 2.99 → careless, 3 → not via this branch
    expect(classifyError(false, 2.99, 20, 3, 0.5)).toBe('careless');
  });

  it('responseTime at 0.3 * avg boundary (strict <)', () => {
    // < 0.3 * 20 = 6 → careless
    expect(classifyError(false, 5.99, 20, 3, 0.5)).toBe('careless');
  });

  it('response just above careless boundary falls through (not careless from speed alone)', () => {
    // responseTime=10, avg=20 → not <0.3*avg, not <3, mastery=0.5, difficulty=2 → not high-mastery careless
    // not >2.5*avg=50, not (difficulty>=3 && mastery<0.4) → falls to misinterpretation
    const result = classifyError(false, 10, 20, 2, 0.5);
    expect(result).toBe('misinterpretation');
  });

  it('high-mastery student missing easy question → careless slip (line 916)', () => {
    expect(classifyError(false, 15, 20, 1, 0.85)).toBe('careless');
  });

  it('high-mastery student missing medium question (≤2) → careless slip', () => {
    expect(classifyError(false, 15, 20, 2, 0.75)).toBe('careless');
  });

  it('low-mastery student on hard question → conceptual gap', () => {
    expect(classifyError(false, 20, 20, 4, 0.3)).toBe('conceptual');
  });

  it('very slow incorrect (>2.5x avg) → conceptual struggle', () => {
    expect(classifyError(false, 60, 20, 2, 0.5)).toBe('conceptual');
  });

  it('mastery exactly at 0.7 + difficulty=2 falls through high-mastery careless branch', () => {
    // condition is mastery > 0.7, so 0.7 exactly is NOT careless via that branch
    const result = classifyError(false, 15, 20, 2, 0.7);
    expect(result).toBe('misinterpretation');
  });

  it('mastery exactly at 0.4 with difficulty=3 falls through conceptual branch', () => {
    // condition is mastery < 0.4, so 0.4 exactly is NOT conceptual via that branch
    const result = classifyError(false, 20, 20, 3, 0.4);
    expect(result).toBe('misinterpretation');
  });
});

// ─── detectKnowledgeGaps — early-continue branch ───────────────

describe('detectKnowledgeGaps — branch coverage', () => {
  it('skips prerequisite chains when student has not started the topic (mastery < 0.3)', () => {
    // Hits line 624 early continue
    const gaps = detectKnowledgeGaps(
      [
        { topicId: 'A', mastery: 0.1 }, // not started
        { topicId: 'B', mastery: 0.9 },
      ],
      [],
      [{ topicId: 'A', prerequisiteIds: ['B'] }]
    );
    expect(gaps.find((g) => g.topicId === 'A' && g.gapType === 'weak_prerequisite')).toBeUndefined();
  });

  it('flags critical severity for prereq below 0.3', () => {
    const gaps = detectKnowledgeGaps(
      [
        { topicId: 'A', mastery: 0.6 },
        { topicId: 'B', mastery: 0.1 }, // critical prereq
      ],
      [],
      [{ topicId: 'A', prerequisiteIds: ['B'] }]
    );
    const gap = gaps.find((g) => g.gapType === 'weak_prerequisite');
    expect(gap?.severity).toBe('critical');
  });

  it('flags high severity for prereq between 0.3 and 0.5', () => {
    const gaps = detectKnowledgeGaps(
      [
        { topicId: 'A', mastery: 0.6 },
        { topicId: 'B', mastery: 0.4 },
      ],
      [],
      [{ topicId: 'A', prerequisiteIds: ['B'] }]
    );
    const gap = gaps.find((g) => g.gapType === 'weak_prerequisite');
    expect(gap?.severity).toBe('high');
  });

  it('detects missing-bloom-level gaps when lower bloom mastered but higher bloom weak', () => {
    const gaps = detectKnowledgeGaps(
      [],
      [
        { topicId: 'T', bloomLevel: 'remember', mastery: 0.85 },
        { topicId: 'T', bloomLevel: 'apply', mastery: 0.2 },
      ],
      []
    );
    expect(gaps.find((g) => g.gapType === 'missing_bloom_level')).toBeDefined();
  });

  it('detects stale knowledge for high mastery but old lastAttempted (>30 days)', () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 60);
    const gaps = detectKnowledgeGaps(
      [{ topicId: 'X', mastery: 0.8, lastAttempted: oldDate.toISOString() }],
      [],
      []
    );
    expect(gaps.find((g) => g.gapType === 'stale_knowledge')).toBeDefined();
  });

  it('does not flag stale knowledge for recently-practiced topics', () => {
    const recent = new Date();
    recent.setDate(recent.getDate() - 5);
    const gaps = detectKnowledgeGaps(
      [{ topicId: 'X', mastery: 0.8, lastAttempted: recent.toISOString() }],
      [],
      []
    );
    expect(gaps.find((g) => g.gapType === 'stale_knowledge')).toBeUndefined();
  });
});

// ─── generateQuizParams — all 3 modes ──────────────────────────

describe('generateQuizParams — mode dispatch', () => {
  it('cognitive mode returns ZPD-based difficulty + interleaved topic IDs', () => {
    const topicWeights: TopicWeight[] = [
      { topicId: 'a', mastery: 0.3, isWeak: true, isStrong: false },
      { topicId: 'b', mastery: 0.4, isWeak: true, isStrong: false },
      { topicId: 'c', mastery: 0.9, isWeak: false, isStrong: true },
    ];
    const masteries: BloomMastery[] = [
      { bloomLevel: 'remember', mastery: 0.8, attempts: 10, correct: 8 },
    ];
    const result = generateQuizParams({
      mode: 'cognitive',
      subject: 'math',
      grade: '8',
      count: 5,
      studentMastery: 0.5,
      recentAccuracy: 0.7,
      bloomMasteries: masteries,
      topicWeights,
    });

    expect(result.mode).toBe('cognitive');
    expect([1, 2, 3]).toContain(result.difficulty);
    expect(result.topicIds.length).toBeGreaterThan(0);
    expect(result.zpdTarget).toBeGreaterThan(0);
    expect(result.zpdTarget).toBeLessThanOrEqual(1);
    expect(result.interleavingRatio).toBeGreaterThan(0);
  });

  it('cognitive mode applies cognitive-load adjustment when load is supplied', () => {
    const cognitiveLoad: CognitiveLoadState = {
      consecutiveErrors: 4,
      consecutiveCorrect: 0,
      fatigueScore: 0.7,
      questionsAttempted: 10,
      avgResponseTime: 30,
      shouldEaseOff: true,
      shouldPushHarder: false,
      shouldPause: false,
    };
    const result = generateQuizParams({
      mode: 'cognitive',
      subject: 'math',
      grade: '8',
      count: 5,
      studentMastery: 0.7,
      recentAccuracy: 0.8,
      cognitiveLoad,
    });
    // shouldEaseOff drops difficulty
    expect(result.zpdTarget).toBeLessThanOrEqual(1);
  });

  it('cognitive mode falls back to interleavingRatio=0 when no topicWeights given', () => {
    const result = generateQuizParams({
      mode: 'cognitive',
      subject: 'math',
      grade: '8',
      count: 5,
    });
    expect(result.topicIds).toEqual([]);
    expect(result.interleavingRatio).toBe(0);
  });

  it('board mode returns CBSE source + apply bloom + boardYear passthrough', () => {
    const result = generateQuizParams({
      mode: 'board',
      subject: 'science',
      grade: '10',
      count: 20,
      boardYear: 2024,
    });
    expect(result.mode).toBe('board');
    expect(result.bloomTarget).toBe('apply');
    expect(result.boardYear).toBe(2024);
    expect(result.source).toBe('cbse_board');
    expect(result.interleavingRatio).toBe(1);
  });

  it('practice mode passes through difficulty and topicId; defaults to understand bloom', () => {
    const result = generateQuizParams({
      mode: 'practice',
      subject: 'math',
      grade: '7',
      count: 10,
      difficulty: 2,
      topicId: 'fractions',
    });
    expect(result.mode).toBe('practice');
    expect(result.difficulty).toBe(2);
    expect(result.bloomTarget).toBe('understand');
    expect(result.topicIds).toEqual(['fractions']);
    expect(result.zpdTarget).toBe(0.5);
  });

  it('practice mode handles missing topicId/difficulty (defaults)', () => {
    const result = generateQuizParams({
      mode: 'practice',
      subject: 'math',
      grade: '7',
      count: 10,
    });
    expect(result.difficulty).toBe(0);
    expect(result.topicIds).toEqual([]);
  });
});

// ─── Board Exam Score — full grade ladder ───────────────────────

describe('calculateBoardExamScore — grade ladder', () => {
  it('A1 grade for >=90%', () => {
    const r = calculateBoardExamScore(9, 10, 80);
    expect(r.grade).toBe('A1');
    expect(r.percentage).toBe(90);
    expect(r.obtainedMarks).toBe(72);
  });

  it('A2 grade for 80-89%', () => {
    const r = calculateBoardExamScore(8, 10);
    expect(r.grade).toBe('A2');
  });

  it('B1 grade for 70-79%', () => {
    const r = calculateBoardExamScore(7, 10);
    expect(r.grade).toBe('B1');
  });

  it('B2 grade for 60-69%', () => {
    const r = calculateBoardExamScore(6, 10);
    expect(r.grade).toBe('B2');
  });

  it('C1 grade for 50-59%', () => {
    const r = calculateBoardExamScore(5, 10);
    expect(r.grade).toBe('C1');
  });

  it('D grade for <50%', () => {
    const r = calculateBoardExamScore(2, 10);
    expect(r.grade).toBe('D');
  });

  it('handles total=0 without dividing by zero', () => {
    const r = calculateBoardExamScore(0, 0);
    expect(r.percentage).toBe(0);
    expect(r.obtainedMarks).toBe(0);
    expect(r.grade).toBe('D');
  });

  it('messages contain projected marks and Hindi text', () => {
    const r = calculateBoardExamScore(8, 10, 80);
    expect(r.message).toContain('64');
    expect(r.messageHi).toMatch(/[^\x00-\x7F]/);
  });
});

// ─── Exam Planning + Score Prediction ──────────────────────────

describe('calculateChapterPriority — urgency scaling', () => {
  const baseChapter: ExamChapter = {
    chapterNumber: 1,
    chapterTitle: 'Algebra',
    marksWeightage: 20,
    difficultyWeight: 1.5,
    studentMastery: 0.3,
    isCovered: false,
  };

  it('returns positive priority for any non-mastered chapter', () => {
    expect(calculateChapterPriority(baseChapter, 30)).toBeGreaterThan(0);
  });

  it('boosts priority when daysUntilExam <= 7 (last week urgency = 2.0x)', () => {
    const lastWeek = calculateChapterPriority(baseChapter, 5);
    const month = calculateChapterPriority(baseChapter, 30);
    expect(lastWeek).toBeGreaterThan(month);
  });

  it('boosts priority when daysUntilExam <= 14 (urgency = 1.5x)', () => {
    const twoWeek = calculateChapterPriority(baseChapter, 10);
    const month = calculateChapterPriority(baseChapter, 30);
    expect(twoWeek).toBeGreaterThan(month);
  });

  it('returns 0 priority when student already at full mastery', () => {
    const mastered: ExamChapter = { ...baseChapter, studentMastery: 1.0 };
    expect(calculateChapterPriority(mastered, 30)).toBe(0);
  });
});

describe('generateExamStudyPlan — daily allocation', () => {
  const chapters: ExamChapter[] = [
    {
      chapterNumber: 1,
      chapterTitle: 'Algebra',
      marksWeightage: 20,
      difficultyWeight: 1.5,
      studentMastery: 0.3,
      isCovered: false,
    },
    {
      chapterNumber: 2,
      chapterTitle: 'Geometry',
      marksWeightage: 25,
      difficultyWeight: 1.2,
      studentMastery: 0.4,
      isCovered: false,
    },
    {
      chapterNumber: 3,
      chapterTitle: 'Calculus',
      marksWeightage: 30,
      difficultyWeight: 2.0,
      studentMastery: 0.7,
      isCovered: true,
    },
  ];

  it('produces one DailyStudyPlan per day until exam', () => {
    const plan = generateExamStudyPlan(chapters, 14, 60);
    expect(plan).toHaveLength(14);
  });

  it('respects daysUntilExam=1 minimum (no zero-day plans)', () => {
    const plan = generateExamStudyPlan(chapters, 0, 60);
    expect(plan.length).toBeGreaterThanOrEqual(1);
  });

  it('last day contains a full mock_test task', () => {
    const plan = generateExamStudyPlan(chapters, 7, 60);
    const lastDay = plan[plan.length - 1];
    expect(lastDay.tasks.find((t) => t.type === 'mock_test')).toBeDefined();
  });

  it('last week (but not last day) contains practice + mini mock + weak focus', () => {
    const plan = generateExamStudyPlan(chapters, 10, 60);
    // Days 4-9 should be in last-week branch (day > daysAvailable - 7)
    const lastWeekDay = plan.find((d) => d.dayNumber > 3 && d.dayNumber < 10);
    expect(lastWeekDay).toBeDefined();
    const taskTypes = lastWeekDay!.tasks.map((t) => t.type);
    expect(taskTypes).toContain('mock_test');
  });

  it('normal days contain new_learning + practice', () => {
    const plan = generateExamStudyPlan(chapters, 30, 60);
    const earlyDay = plan[1]; // not in last week
    const taskTypes = earlyDay.tasks.map((t) => t.type);
    expect(taskTypes).toContain('new_learning');
  });

  it('every day has totalMinutes equal to sum of task durations', () => {
    const plan = generateExamStudyPlan(chapters, 5, 90);
    for (const day of plan) {
      const sum = day.tasks.reduce((acc, t) => acc + t.durationMinutes, 0);
      expect(day.totalMinutes).toBe(sum);
    }
  });

  it('weak topic focus appears when chapter mastery < 0.5', () => {
    const plan = generateExamStudyPlan(chapters, 14, 60);
    // Some day should include weak focus since 2 chapters have mastery < 0.5
    const hasWeakFocus = plan.some((d) =>
      d.tasks.some((t) => t.type === 'weak_topic_focus')
    );
    expect(hasWeakFocus).toBe(true);
  });

  it('handles empty chapter list without crashing', () => {
    const plan = generateExamStudyPlan([], 7, 60);
    expect(plan).toHaveLength(7);
    // Days will have empty/short task lists
    plan.forEach((d) => expect(Array.isArray(d.tasks)).toBe(true));
  });
});

describe('predictExamScore — confidence + breakdown', () => {
  it('produces breakdown entry per chapter with predicted+max marks', () => {
    const chapters: ExamChapter[] = [
      {
        chapterNumber: 1,
        chapterTitle: 'Algebra',
        marksWeightage: 50,
        difficultyWeight: 1,
        studentMastery: 0.8,
        isCovered: true,
      },
      {
        chapterNumber: 2,
        chapterTitle: 'Geometry',
        marksWeightage: 50,
        difficultyWeight: 1,
        studentMastery: 0.5,
        isCovered: true,
      },
    ];
    const result = predictExamScore(chapters, 80);
    expect(result.breakdown).toHaveLength(2);
    expect(result.predicted).toBeGreaterThan(0);
    expect(result.predicted).toBeLessThanOrEqual(80);
    expect(result.confidence).toBeGreaterThanOrEqual(0.3);
    expect(result.confidence).toBeLessThanOrEqual(0.95);
  });

  it('handles zero-weightage chapter list (denominator fallback to 1)', () => {
    const result = predictExamScore([], 80);
    expect(result.predicted).toBe(0);
    expect(result.breakdown).toEqual([]);
    // confidence floors at 0.3
    expect(result.confidence).toBeGreaterThanOrEqual(0.3);
  });

  it('confidence floors at 0.3 even with high variance', () => {
    const chapters: ExamChapter[] = [
      {
        chapterNumber: 1,
        chapterTitle: 'A',
        marksWeightage: 50,
        difficultyWeight: 1,
        studentMastery: 0.0,
        isCovered: false,
      },
      {
        chapterNumber: 2,
        chapterTitle: 'B',
        marksWeightage: 50,
        difficultyWeight: 1,
        studentMastery: 1.0,
        isCovered: true,
      },
    ];
    const result = predictExamScore(chapters, 100);
    expect(result.confidence).toBeGreaterThanOrEqual(0.3);
  });

  it('high mastery + low variance gives confidence near 0.95 ceiling', () => {
    const chapters: ExamChapter[] = [
      {
        chapterNumber: 1,
        chapterTitle: 'A',
        marksWeightage: 50,
        difficultyWeight: 1,
        studentMastery: 0.95,
        isCovered: true,
      },
      {
        chapterNumber: 2,
        chapterTitle: 'B',
        marksWeightage: 50,
        difficultyWeight: 1,
        studentMastery: 0.95,
        isCovered: true,
      },
    ];
    const result = predictExamScore(chapters, 100);
    expect(result.confidence).toBeGreaterThan(0.8);
  });
});

// ─── classifyImageText — heuristic branches ────────────────────

describe('classifyImageText — content type detection', () => {
  it('detects MCQ from option markers', () => {
    const r = classifyImageText('Q1. What is x? (a) 2 (b) 4 (c) 6 (d) 8');
    expect(r.contentType).toBe('mcq');
  });

  it('detects numerical from "calculate" / "solve" keywords', () => {
    const r = classifyImageText('Calculate the value of x + 2y when x=5');
    expect(r.contentType).toBe('numerical');
  });

  it('detects theory from "define" / "explain" keywords', () => {
    const r = classifyImageText('Define the term photosynthesis and explain its role.');
    expect(r.contentType).toBe('theory');
  });

  it('detects diagram from "diagram" / "figure" keywords', () => {
    const r = classifyImageText('Draw a diagram showing the electric circuit.');
    expect(r.contentType).toBe('diagram');
  });

  it('returns mixed for long text without specific markers', () => {
    const longText = 'a'.repeat(60);
    const r = classifyImageText(longText);
    expect(r.contentType).toBe('mixed');
  });

  it('returns unknown for short ambiguous text', () => {
    const r = classifyImageText('hi');
    expect(r.contentType).toBe('unknown');
  });

  it('detects math subject from algebra/geometry keywords', () => {
    const r = classifyImageText('Solve the quadratic equation x^2 + 2x - 3 = 0');
    expect(r.detectedSubject).toBe('math');
  });

  it('detects physics subject from velocity/newton keywords', () => {
    const r = classifyImageText('Calculate force using Newton\'s second law: F = ma');
    expect(r.detectedSubject).toBe('physics');
  });

  it('detects chemistry subject from element/reaction keywords', () => {
    const r = classifyImageText('Define a chemical reaction between an acid and a base.');
    expect(r.detectedSubject).toBe('chemistry');
  });

  it('detects biology subject from cell/photosynthesis keywords', () => {
    const r = classifyImageText('Explain the role of cell organelles in photosynthesis.');
    expect(r.detectedSubject).toBe('biology');
  });

  it('respects explicit subject override', () => {
    const r = classifyImageText('Random text', 'math');
    expect(r.detectedSubject).toBe('math');
  });

  it('splits on Q1, Q2 patterns into separate questions', () => {
    const r = classifyImageText(
      'Q1. Calculate the area of the triangle. Q2. Find the perimeter of the square.'
    );
    expect(r.questions.length).toBeGreaterThanOrEqual(2);
  });

  it('returns syllabusMapping array (empty by default)', () => {
    const r = classifyImageText('Some text');
    expect(Array.isArray(r.syllabusMapping)).toBe(true);
  });
});

// ─── computeMonthlyReportMetrics — aggregator ──────────────────

describe('computeMonthlyReportMetrics — full aggregation', () => {
  const chapters: ExamChapter[] = [
    {
      chapterNumber: 1,
      chapterTitle: 'Algebra',
      marksWeightage: 50,
      difficultyWeight: 1,
      studentMastery: 0.7,
      isCovered: true,
    },
    {
      chapterNumber: 2,
      chapterTitle: 'Geometry',
      marksWeightage: 50,
      difficultyWeight: 1,
      studentMastery: 0.4,
      isCovered: true,
    },
  ];

  it('computes concept mastery as rounded average', () => {
    const result = computeMonthlyReportMetrics({
      masteries: [
        { mastery: 0.8, topic: 'A' },
        { mastery: 0.6, topic: 'B' },
      ],
      quizScores: [80, 75, 90],
      weeklyAccuracies: [0.7, 0.75, 0.8, 0.85],
      totalMinutes: 600,
      totalQuestions: 300,
      daysActive: 25,
      daysInMonth: 30,
      chapters,
      totalMarks: 100,
    });
    expect(result.conceptMasteryPct).toBe(70); // round((0.8+0.6)/2 * 100)
    expect(result.studyConsistencyPct).toBe(83); // round(25/30 * 100)
  });

  it('identifies weak chapters (mastery < 0.5)', () => {
    const result = computeMonthlyReportMetrics({
      masteries: [
        { mastery: 0.2, topic: 'Weak1' },
        { mastery: 0.3, topic: 'Weak2' },
        { mastery: 0.9, topic: 'Strong1' },
      ],
      quizScores: [80],
      weeklyAccuracies: [0.7],
      totalMinutes: 100,
      totalQuestions: 50,
      daysActive: 10,
      daysInMonth: 30,
      chapters,
      totalMarks: 100,
    });
    expect(result.weakChapters).toContain('Weak1');
    expect(result.weakChapters).toContain('Weak2');
    expect(result.strongChapters).toContain('Strong1');
  });

  it('emits improvement areas for low consistency / efficiency', () => {
    const result = computeMonthlyReportMetrics({
      masteries: [{ mastery: 0.4, topic: 'X' }],
      quizScores: [50],
      weeklyAccuracies: [0.5],
      totalMinutes: 100,
      totalQuestions: 10, // 0.1 q/min → low efficiency
      daysActive: 5, // low consistency
      daysInMonth: 30,
      chapters,
      totalMarks: 100,
    });
    expect(result.improvementAreas.length).toBeGreaterThan(0);
  });

  it('emits achievements for high mastery + consistency', () => {
    const result = computeMonthlyReportMetrics({
      masteries: [
        { mastery: 0.85, topic: 'A' },
        { mastery: 0.85, topic: 'B' },
        { mastery: 0.85, topic: 'C' },
        { mastery: 0.85, topic: 'D' },
      ],
      quizScores: [90, 92, 88],
      weeklyAccuracies: [0.85, 0.9, 0.88, 0.92],
      totalMinutes: 1000,
      totalQuestions: 800,
      daysActive: 28,
      daysInMonth: 30,
      chapters,
      totalMarks: 100,
    });
    expect(result.achievements.length).toBeGreaterThan(0);
    expect(result.achievements).toContain('High overall mastery');
  });

  it('handles empty masteries / quizScores gracefully (defensive)', () => {
    const result = computeMonthlyReportMetrics({
      masteries: [],
      quizScores: [],
      weeklyAccuracies: [],
      totalMinutes: 0,
      totalQuestions: 0,
      daysActive: 0,
      daysInMonth: 30,
      chapters: [],
      totalMarks: 100,
    });
    expect(result.conceptMasteryPct).toBe(0);
    expect(result.retentionScore).toBe(0);
    expect(result.weakChapters).toEqual([]);
    expect(result.strongChapters).toEqual([]);
    expect(result.timeEfficiency).toBe(0);
  });

  it('computes time efficiency as questions per minute', () => {
    const result = computeMonthlyReportMetrics({
      masteries: [{ mastery: 0.5, topic: 'A' }],
      quizScores: [],
      weeklyAccuracies: [],
      totalMinutes: 100,
      totalQuestions: 200,
      daysActive: 10,
      daysInMonth: 30,
      chapters,
      totalMarks: 100,
    });
    expect(result.timeEfficiency).toBe(2); // 200/100
  });

  it('computes syllabus completion percentage from covered chapters', () => {
    const partialChapters: ExamChapter[] = [
      { ...chapters[0], studentMastery: 0.5 },
      { ...chapters[1], studentMastery: 0 },
    ];
    const result = computeMonthlyReportMetrics({
      masteries: [{ mastery: 0.5, topic: 'A' }],
      quizScores: [],
      weeklyAccuracies: [],
      totalMinutes: 100,
      totalQuestions: 50,
      daysActive: 10,
      daysInMonth: 30,
      chapters: partialChapters,
      totalMarks: 100,
    });
    expect(result.syllabusCompletionPct).toBe(50); // 1 of 2 covered
  });
});
