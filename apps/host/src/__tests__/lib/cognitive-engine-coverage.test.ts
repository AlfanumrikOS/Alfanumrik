import { describe, it, expect } from 'vitest';
import {
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
  type BloomMastery,
  type ExamChapter,
  type TopicWeight,
  type CognitiveLoadState,
} from '@alfanumrik/lib/cognitive-engine';

/**
 * Cognitive Engine — Coverage Closure Tests
 *
 * Closes production-readiness Gap 3b (P22 defense floor): raises
 * src/lib/cognitive-engine.ts coverage from 65 → 80 across all 4 metrics.
 *
 * Targets the branches identified in vitest.config.ts TODO at line 83:
 *   - Error classification (slip vs guess) threshold edges
 *   - Quiz generator board/practice mode paths
 *
 * 2026-08-05 (tracker E1): the SM-2 / IRT 3PL / BKT describe blocks were
 * deleted along with their cognitive-engine exports (sm2Update,
 * responseToQuality, estimateTheta, irtProbCorrect, bktUpdate). The live
 * algorithms are the update_learner_state_post_quiz SQL RPC (BKT + SM-2,
 * mirrored by @alfanumrik/lib/learner-model) and
 * packages/lib/src/irt/fisher-info.ts (IRT). The per-file coverage floor in
 * vitest.config.ts was re-pinned against the post-deletion file.
 *   - Exam study plan + score prediction (1057-1265)
 *   - Image OCR classification heuristics (1294-1326)
 *   - Monthly report aggregator (1364-1397)
 *
 * Strengthens IP-filing claims in docs/architecture/cognitive-model.md
 * about IRT 3PL convergence, SM-2 decay, and error-classification.
 */

// ─── IRT 3PL Newton-Raphson MLE ─────────────────────────────────

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

/* CONTRACT UPDATE (Phase 6 / Risk R4, assessment-owned): these assertions were
 * rewritten when `computeMonthlyReportMetrics` stopped returning a number for
 * evidence it does not have. Changes pinned below:
 *   • `masteries[].topic` → `masteries[].label` (the caller passes SUBJECTS;
 *     the old key claimed they were topics).
 *   • `weakChapters`/`strongChapters` → `weakAreas`/`strongAreas`.
 *   • `retentionScore` → `recentQuizAveragePct` + `recentQuizCount` (it was
 *     always avg-of-last-5-quiz-scores, never a retention measurement).
 *   • empty input now yields `null`, not `0` — "we don't know" vs "you scored
 *     zero".
 *   • `chapters`/`totalMarks` are OPTIONAL; without them `predictedScore` and
 *     `syllabusCompletionPct` are null instead of being invented.
 *   • `improvementAreas`/`achievements` (English prose) → `improvements`/
 *     `achievements` as bilingual-renderable codes (P7).
 *   • syllabus completion now counts `isCovered`, matching the SQL definition
 *     in `generate_monthly_report()` (`COUNT(*) FILTER (WHERE ec.is_covered)`),
 *     instead of the looser `studentMastery > 0`.
 * Deeper contract tests live in packages/lib/src/__tests__/monthly-report-honesty.test.ts.
 */
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
        { mastery: 0.8, label: 'A' },
        { mastery: 0.6, label: 'B' },
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
        { mastery: 0.2, label: 'Weak1' },
        { mastery: 0.3, label: 'Weak2' },
        { mastery: 0.9, label: 'Strong1' },
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
    expect(result.weakAreas).toContain('Weak1');
    expect(result.weakAreas).toContain('Weak2');
    expect(result.strongAreas).toContain('Strong1');
  });

  it('emits improvement areas for low consistency / efficiency', () => {
    const result = computeMonthlyReportMetrics({
      masteries: [{ mastery: 0.4, label: 'X' }],
      quizScores: [50],
      weeklyAccuracies: [0.5],
      totalMinutes: 100,
      totalQuestions: 10, // 0.1 q/min → low efficiency
      daysActive: 5, // low consistency
      daysInMonth: 30,
      chapters,
      totalMarks: 100,
    });
    expect(result.improvements.length).toBeGreaterThan(0);
  });

  it('emits achievements for high mastery + consistency', () => {
    const result = computeMonthlyReportMetrics({
      masteries: [
        { mastery: 0.85, label: 'A' },
        { mastery: 0.85, label: 'B' },
        { mastery: 0.85, label: 'C' },
        { mastery: 0.85, label: 'D' },
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
    // Codes, not prose — the words are chosen by the UI in the reader's
    // language (P7). See the contract note above this describe block.
    expect(result.achievements.map((a) => a.code)).toContain('high_overall_mastery');
  });

  it('reports absence as null, not zero, when there is nothing to aggregate', () => {
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
    // "We have no evidence" must not be rendered to a student as "you scored
    // zero" — that is the whole point of the R4 honesty pass.
    expect(result.conceptMasteryPct).toBeNull();
    expect(result.recentQuizAveragePct).toBeNull();
    expect(result.recentQuizCount).toBe(0);
    expect(result.timeEfficiency).toBeNull();
    // An EMPTY chapter list is not a blueprint either.
    expect(result.predictedScore).toBeNull();
    expect(result.syllabusCompletionPct).toBeNull();
    expect(result.weakAreas).toEqual([]);
    expect(result.strongAreas).toEqual([]);
  });

  it('computes time efficiency as questions per minute', () => {
    const result = computeMonthlyReportMetrics({
      masteries: [{ mastery: 0.5, label: 'A' }],
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
    // `isCovered` is the field that means "covered" — this now matches the SQL
    // definition in generate_monthly_report()
    // (COUNT(*) FILTER (WHERE ec.is_covered = true)). The previous
    // implementation counted `studentMastery > 0`, which answers a different
    // question ("has the student touched it") and made the /reports caller's
    // fabricated blueprint read ~100% by construction.
    const partialChapters: ExamChapter[] = [
      { ...chapters[0], studentMastery: 0.5, isCovered: true },
      { ...chapters[1], studentMastery: 0, isCovered: false },
    ];
    const result = computeMonthlyReportMetrics({
      masteries: [{ mastery: 0.5, label: 'A' }],
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
