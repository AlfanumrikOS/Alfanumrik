/**
 * Adaptive-pipeline DIFFERENTIAL regression tests (2026-07-02 repair wave).
 *
 * THE CENTERPIECE INVARIANT: two learners with different knowledge states must
 * get measurably DIFFERENT experiences. Before this repair wave the adaptive
 * pipeline was silently inert in four independent places, so a struggling
 * learner and a thriving learner received byte-identical treatment:
 *
 *   1. quiz-generator (Deno): a CALIBRATED theta set `difficulty`, and the
 *      `difficulty == null` guard then DISABLED review-fill + adaptive
 *      selection — the personalization inversion (students WITH signal lost
 *      the adaptive path). Also read `mastery_level` (now a TEXT band label)
 *      as if numeric.
 *   2. Foxy cognitive-context: `nextAction` came from a cme-engine network
 *      call that 401'd on EVERY request (service-role key vs user-JWT check),
 *      so nextAction was always null; the overdue-review query read the ghost
 *      `next_review_date` DATE column (CURRENT_DATE + 1 default, no writer).
 *   3. learner-loop buildLoopAugmentation: due count read the NONEXISTENT
 *      `review_cards` table → always errored → 0 → the review_due_cards
 *      branch could never fire.
 *   4. SRS chain: QuizResults card inserts silently failed (grade NOT NULL
 *      omitted) and wrote session_id into source_id, so due cards could never
 *      resurface their question.
 *
 * Sections 1-3 prove divergence at the PURE-FUNCTION level (no live DB) for
 * two synthetic learners:
 *   WEAK   — low mastery_probability rows, overdue reviews, repeated
 *            conceptual errors, low theta.
 *   STRONG — high mastery (>= 0.85), nothing due, no errors, high theta.
 *
 * Sections 4-5 are SOURCE-SHAPE PINS (same style as
 * adaptive-layer-health.test.ts Section 3): the quiz-generator is a Deno file
 * that cannot be imported into Vitest, and several client fixes are effect
 * wiring inside page/component files. These pins assert the fixed source
 * shapes and the absence of the broken ones. They are explicitly INTERIM
 * pins pending Deno-level tests for the Edge Function.
 *
 * Regression catalog: REG-231 (umbrella differential-experience invariant),
 * REG-232 (theta/difficulty inversion), REG-233 (ghost-column repoint),
 * REG-234 (SRS chain repair). Owning agent: testing. Expected behavior
 * defined by assessment (deriveNextAction ladder mirrors the documented
 * cme-engine 5-priority order; thresholds 0.6 / 0.85 / >=3 conceptual).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import {
  deriveNextAction,
  type NextActionInputs,
} from '@/app/api/foxy/_lib/cognitive-context';
import {
  resolveNextLearnerAction,
  type LoopAugmentation,
} from '@/lib/state/learner-loop/resolve-next-action';
import { LEARNER_LOOP_CONFIG } from '@/lib/state/learner-loop/types';
import type { StudentState } from '@/lib/state/student-state';
import {
  selectAdaptiveQuestions,
  type AdaptiveClient,
  type AdaptiveQueryBuilder,
} from '@/lib/adaptive/select-adaptive-questions';
import {
  FLAG_DEFAULTS,
  ADAPTIVE_LIVE_SELECTION_FLAGS,
} from '@/lib/feature-flags';

// ─── Source-pin helpers ──────────────────────────────────────────────────────

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(relativePath), 'utf-8');
}

/**
 * Strip block + line comments from TS source so NEGATIVE assertions
 * (`.not.toMatch`) never trip on RCA prose that legitimately names the OLD
 * broken identifiers (mastery_level, next_review_date, review_cards,
 * results.session_id) inside documentation comments. Positive assertions use
 * the full source. Line-comment stripping is anchored to `//` NOT preceded by
 * `:` so `https://…` string literals survive.
 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1 '); // line comments (not https://)
}

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 1 — deriveNextAction: WEAK vs STRONG learners diverge (pure)
// ═════════════════════════════════════════════════════════════════════════════

/** WEAK learner: prerequisite gap, overdue reviews, repeated conceptual
 *  errors, low mastery everywhere. Every ladder rung has a reason to fire. */
function weakLearnerInputs(): NextActionInputs {
  return {
    knowledgeGaps: [
      { target: 'Linear Equations', prerequisite: 'Integers', gapType: 'weak_prerequisite' },
    ],
    revisionDue: [
      { title: 'Fractions', lastReviewed: '2026-06-20T00:00:00.000Z', mastery: 35 },
      { title: 'Decimals', lastReviewed: '2026-06-25T00:00:00.000Z', mastery: 55 },
    ],
    recentErrors: [
      { errorType: 'conceptual', count: 4 },
      { errorType: 'careless', count: 1 },
    ],
    masteryTopics: [
      { title: 'Fractions', masteryProbability: 0.2 },
      { title: 'Decimals', masteryProbability: 0.45 },
    ],
  };
}

/** STRONG learner: no gaps, nothing due, no errors, everything mastered. */
function strongLearnerInputs(): NextActionInputs {
  return {
    knowledgeGaps: [],
    revisionDue: [],
    recentErrors: [],
    masteryTopics: [
      { title: 'Fractions', masteryProbability: 0.92 },
      { title: 'Decimals', masteryProbability: 0.88 },
      { title: 'Linear Equations', masteryProbability: 0.85 }, // exactly at mastered threshold
    ],
  };
}

describe('Section 1 — deriveNextAction differential (weak vs strong learner)', () => {
  it('WEAK learner gets an actionable intervention; STRONG learner gets none — they DIFFER', () => {
    const weak = deriveNextAction(weakLearnerInputs());
    const strong = deriveNextAction(strongLearnerInputs());

    // Weak learner: some remedial action, from the assessment-approved set.
    expect(weak).not.toBeNull();
    expect(['remediate', 'revise', 're_teach', 'practice']).toContain(weak!.actionType);
    expect(weak!.conceptName.length).toBeGreaterThan(0);

    // Strong learner with everything >= 0.85, nothing due, no gaps/errors:
    // no actionable signal → null (exam-prep / consolidation rails apply).
    expect(strong).toBeNull();

    // The differential itself: the two learners' recommendations differ.
    expect(weak).not.toEqual(strong);
  });

  it('a STRONG-but-short-of-mastery learner (0.6 <= m < 0.85) is challenged, not remediated', () => {
    const almostMastered = deriveNextAction({
      knowledgeGaps: [],
      revisionDue: [],
      recentErrors: [],
      masteryTopics: [{ title: 'Fractions', masteryProbability: 0.7 }],
    });
    expect(almostMastered).not.toBeNull();
    expect(almostMastered!.actionType).toBe('challenge');
    expect(almostMastered!.conceptName).toBe('Fractions');

    // …and it still differs from the WEAK learner's recommendation.
    const weak = deriveNextAction(weakLearnerInputs());
    expect(almostMastered!.actionType).not.toBe(weak!.actionType);
  });

  describe('ladder ordering — gap > overdue > conceptual errors > unmastered', () => {
    it('(1) knowledge gap beats everything: full weak inputs → remediate the PREREQUISITE', () => {
      const action = deriveNextAction(weakLearnerInputs());
      expect(action!.actionType).toBe('remediate');
      // prerequisite preferred over the gap's target concept.
      expect(action!.conceptName).toBe('Integers');
    });

    it('(1b) gap with blank prerequisite remediates the target concept instead', () => {
      const inputs = weakLearnerInputs();
      inputs.knowledgeGaps = [
        { target: 'Linear Equations', prerequisite: '', gapType: 'weak_prerequisite' },
      ];
      const action = deriveNextAction(inputs);
      expect(action!.actionType).toBe('remediate');
      expect(action!.conceptName).toBe('Linear Equations');
    });

    it('(2) overdue review beats errors + unmastered: no gap → revise, weakest-mastery due first', () => {
      const inputs = weakLearnerInputs();
      inputs.knowledgeGaps = [];
      const action = deriveNextAction(inputs);
      expect(action!.actionType).toBe('revise');
      // Fractions (mastery 35) is weaker than Decimals (55) → revised first.
      expect(action!.conceptName).toBe('Fractions');
    });

    it('(2b) overdue tie on mastery breaks toward the OLDEST next_review_at', () => {
      const action = deriveNextAction({
        knowledgeGaps: [],
        revisionDue: [
          { title: 'Newer', lastReviewed: '2026-06-25T00:00:00.000Z', mastery: 40 },
          { title: 'Older', lastReviewed: '2026-06-01T00:00:00.000Z', mastery: 40 },
        ],
        recentErrors: [],
        masteryTopics: [],
      });
      expect(action!.actionType).toBe('revise');
      expect(action!.conceptName).toBe('Older');
    });

    it('(3) >=3 conceptual errors beat plain unmastered: no gap/overdue → re_teach the weakest concept', () => {
      const inputs = weakLearnerInputs();
      inputs.knowledgeGaps = [];
      inputs.revisionDue = [];
      const action = deriveNextAction(inputs);
      expect(action!.actionType).toBe('re_teach');
      // weakest unmastered topic (Fractions at 0.2) is re-taught.
      expect(action!.conceptName).toBe('Fractions');
    });

    it('(4) with no gap/overdue/errors, the weakest unmastered concept is practiced', () => {
      const inputs = weakLearnerInputs();
      inputs.knowledgeGaps = [];
      inputs.revisionDue = [];
      inputs.recentErrors = [];
      const action = deriveNextAction(inputs);
      expect(action!.actionType).toBe('practice'); // 0.2 < 0.6
      expect(action!.conceptName).toBe('Fractions');
    });
  });

  describe('threshold boundaries (assessment-pinned: 0.6, 0.85, >=3 conceptual)', () => {
    function masteryOnly(m: number) {
      return deriveNextAction({
        knowledgeGaps: [],
        revisionDue: [],
        recentErrors: [],
        masteryTopics: [{ title: 'Topic', masteryProbability: m }],
      });
    }

    it('mastery 0.59 → practice (below the 0.6 practice threshold)', () => {
      expect(masteryOnly(0.59)!.actionType).toBe('practice');
    });

    it('mastery exactly 0.6 → challenge (0.6 is NOT < 0.6)', () => {
      expect(masteryOnly(0.6)!.actionType).toBe('challenge');
    });

    it('mastery 0.84 → challenge (still short of mastery)', () => {
      expect(masteryOnly(0.84)!.actionType).toBe('challenge');
    });

    it('mastery exactly 0.85 → null (mastered; 0.85 is NOT < 0.85)', () => {
      expect(masteryOnly(0.85)).toBeNull();
    });

    it('exactly 3 conceptual errors trigger re_teach; 2 do not', () => {
      const base: NextActionInputs = {
        knowledgeGaps: [],
        revisionDue: [],
        recentErrors: [],
        masteryTopics: [{ title: 'Topic', masteryProbability: 0.5 }],
      };
      const three = deriveNextAction({
        ...base,
        recentErrors: [{ errorType: 'conceptual', count: 3 }],
      });
      expect(three!.actionType).toBe('re_teach');

      const two = deriveNextAction({
        ...base,
        recentErrors: [{ errorType: 'conceptual', count: 2 }],
      });
      expect(two!.actionType).toBe('practice'); // falls through the re-teach rung
    });

    it('conceptual errors alone (no unmastered concept) do NOT force a re_teach', () => {
      const action = deriveNextAction({
        knowledgeGaps: [],
        revisionDue: [],
        recentErrors: [{ errorType: 'conceptual', count: 5 }],
        masteryTopics: [{ title: 'Topic', masteryProbability: 0.9 }], // mastered
      });
      expect(action).toBeNull();
    });

    it('non-conceptual error types never trigger re_teach', () => {
      const action = deriveNextAction({
        knowledgeGaps: [],
        revisionDue: [],
        recentErrors: [{ errorType: 'careless', count: 10 }],
        masteryTopics: [{ title: 'Topic', masteryProbability: 0.5 }],
      });
      expect(action!.actionType).toBe('practice');
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 2 — learner-loop resolver: three learners, three different actions
// ═════════════════════════════════════════════════════════════════════════════

// A weekday (Wednesday) that is NOT month-end, so the Sunday / month-end
// default branches can't fire (same anchor date as resolve-next-action.test.ts).
const WEEKDAY_NOON_IST = new Date('2026-05-13T06:30:00.000Z');

function makeRichState(overrides: Partial<StudentState> = {}): StudentState {
  const base: StudentState = {
    schemaVersion: 1,
    builtAt: '2026-05-12T10:00:00.000Z',
    authUserId: '11111111-1111-1111-1111-111111111111',
    studentId: '22222222-2222-2222-2222-222222222222',
    displayName: 'Aanya Sharma',
    grade: '8',
    board: 'CBSE',
    language: 'en',
    tenant: {
      tenantId: null,
      tenantType: 'b2c',
      enabledModules: ['foxy_tutor', 'quiz_engine'],
      aiPersonality: null,
    },
    access: {
      planSlug: 'free',
      isTrialing: false,
      trialEndsAt: null,
      usageThisMonth: { foxyMinutes: 0, quizSessions: 0 },
    },
    consent: { isMinor: true, parentLinkVerified: true, analyticsConsent: true },
    // Recently-touched chapters (no decay at WEEKDAY_NOON_IST) with a clear
    // weakest chapter: science/3 at mastery 0.1.
    mastery: [
      {
        subjectCode: 'science',
        meanMastery: 0.45,
        chapters: [
          { chapterNumber: 1, mastery: 0.85, lastUpdatedAt: '2026-05-10T08:00:00.000Z', attempts: 30 },
          { chapterNumber: 2, mastery: 0.4, lastUpdatedAt: '2026-05-11T09:00:00.000Z', attempts: 18 },
          { chapterNumber: 3, mastery: 0.1, lastUpdatedAt: '2026-05-11T09:30:00.000Z', attempts: 6 },
        ],
      },
      {
        subjectCode: 'math',
        meanMastery: 0.6,
        chapters: [
          { chapterNumber: 1, mastery: 0.6, lastUpdatedAt: '2026-05-11T07:00:00.000Z', attempts: 22 },
        ],
      },
    ],
    engagement: {
      currentStreakDays: 5,
      longestStreakDays: 12,
      lastActiveAt: '2026-05-12T09:30:00.000Z',
      totalTimeOnTaskSec: 3600,
      xpBalance: 240,
    },
    live: { kind: 'idle' },
    classroomId: null,
    parentIds: [],
  };
  return { ...base, ...overrides };
}

function emptyAugmentation(): LoopAugmentation {
  return {
    dueReviewCount: 0,
    attemptedQuizToday: false,
    inProgressLessons: [],
  };
}

describe('Section 2 — learner-loop divergence: three learners, three next actions', () => {
  it('cold-start / review-laden / rich-mastery learners resolve to THREE DIFFERENT actions', () => {
    // Learner A — brand new, zero mastery signal.
    const coldAction = resolveNextLearnerAction(
      makeRichState({ mastery: [] }),
      emptyAugmentation(),
      { now: WEEKDAY_NOON_IST },
    );
    expect(coldAction.kind).toBe('cold_start_diagnostic');
    expect(coldAction.url).toBe('/diagnostic');

    // Learner B — rich mastery AND a stacking review queue. The due count
    // now comes from the LIVE spaced_repetition_cards table (the historical
    // `review_cards` read always errored → 0 → this branch was dead).
    const reviewAction = resolveNextLearnerAction(
      makeRichState(),
      {
        ...emptyAugmentation(),
        dueReviewCount: LEARNER_LOOP_CONFIG.REVIEW_STACKING_THRESHOLD,
      },
      { now: WEEKDAY_NOON_IST },
    );
    expect(reviewAction.kind).toBe('review_due_cards');
    if (reviewAction.kind === 'review_due_cards') {
      expect(reviewAction.dueCount).toBe(LEARNER_LOOP_CONFIG.REVIEW_STACKING_THRESHOLD);
      expect(reviewAction.url).toBe('/review');
    }

    // Learner C — rich mastery, nothing due → today's ZPD quiz on the
    // WEAKEST chapter (science/3 at mastery 0.1).
    const quizAction = resolveNextLearnerAction(
      makeRichState(),
      emptyAugmentation(),
      { now: WEEKDAY_NOON_IST },
    );
    expect(quizAction.kind).toBe('start_quiz');
    if (quizAction.kind === 'start_quiz') {
      expect(quizAction.subjectCode).toBe('science');
      expect(quizAction.chapterNumber).toBe(3);
      expect(quizAction.reason).toBe('todays_zpd');
    }

    // The differential: three learners, three DISTINCT action kinds.
    const kinds = new Set([coldAction.kind, reviewAction.kind, quizAction.kind]);
    expect(kinds.size).toBe(3);
  });

  it('the review branch fires exactly at REVIEW_STACKING_THRESHOLD, not below', () => {
    const below = resolveNextLearnerAction(
      makeRichState(),
      {
        ...emptyAugmentation(),
        dueReviewCount: LEARNER_LOOP_CONFIG.REVIEW_STACKING_THRESHOLD - 1,
      },
      { now: WEEKDAY_NOON_IST },
    );
    expect(below.kind).not.toBe('review_due_cards');
  });

  it('two rich learners with DIFFERENT weakest chapters get DIFFERENT quiz targets', () => {
    const learnerA = resolveNextLearnerAction(makeRichState(), emptyAugmentation(), {
      now: WEEKDAY_NOON_IST,
    });

    // Learner B is weakest on math/4 instead of science/3.
    const learnerB = resolveNextLearnerAction(
      makeRichState({
        mastery: [
          {
            subjectCode: 'science',
            meanMastery: 0.8,
            chapters: [
              { chapterNumber: 1, mastery: 0.8, lastUpdatedAt: '2026-05-11T08:00:00.000Z', attempts: 30 },
            ],
          },
          {
            subjectCode: 'math',
            meanMastery: 0.3,
            chapters: [
              { chapterNumber: 4, mastery: 0.15, lastUpdatedAt: '2026-05-11T09:00:00.000Z', attempts: 12 },
            ],
          },
        ],
      }),
      emptyAugmentation(),
      { now: WEEKDAY_NOON_IST },
    );

    expect(learnerA.kind).toBe('start_quiz');
    expect(learnerB.kind).toBe('start_quiz');
    if (learnerA.kind === 'start_quiz' && learnerB.kind === 'start_quiz') {
      expect(learnerA.url).not.toBe(learnerB.url); // different chapters targeted
      expect(learnerB.subjectCode).toBe('math');
      expect(learnerB.chapterNumber).toBe(4);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 3 — selectAdaptiveQuestions: different mastery profiles → different
// candidate sets (flag now ON: FLAG_DEFAULTS + enable migration)
// ═════════════════════════════════════════════════════════════════════════════
//
// The exhaustive selector contract (Bloom ceiling zero-violation, weak-topic
// over-representation vs control, IRT-proxy ranking, P5/P6 integrity, fail-safe)
// lives in src/__tests__/lib/adaptive/select-adaptive-questions.test.ts.
// This section ADDS the two-learner differential on top — it does not
// duplicate the per-assertion coverage there.

const BLOOM_ORDER = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];

let _qid = 0;
function makeQuestion(overrides: Partial<Record<string, unknown>> = {}): any {
  _qid += 1;
  return {
    id: `q-${_qid}`,
    question_text: `Differential probe question number ${_qid}?`,
    question_hi: null,
    question_type: 'mcq',
    options: ['Option A', 'Option B', 'Option C', 'Option D'],
    correct_answer_index: 1,
    explanation: 'A sufficiently long explanation to pass the downstream P6 gate.',
    explanation_hi: null,
    hint: null,
    difficulty: 2,
    bloom_level: 'understand',
    chapter_number: 5,
    concept_tag: 'fractions',
    subject: 'math',
    grade: '7',
    irt_a: null,
    irt_b: null,
    irt_calibration_n: 0,
    irt_difficulty: 0.0,
    ...overrides,
  };
}

interface QueryLog {
  table: string;
  filters: Record<string, unknown>;
  inFilter?: { col: string; vals: unknown[] };
}

/** Minimal structural fake mirroring the AdaptiveClient surface. The
 *  question_bank resolver faithfully emulates the DB honouring the
 *  `.in('bloom_level', …)` and `.eq('chapter_number', …)` filters. */
function makeFakeClient(masteryRows: unknown[]): { client: AdaptiveClient; log: QueryLog[] } {
  const log: QueryLog[] = [];
  const client: AdaptiveClient = {
    from(table: string): AdaptiveQueryBuilder {
      const entry: QueryLog = { table, filters: {} };
      log.push(entry);
      const builder: AdaptiveQueryBuilder = {
        select() {
          return builder;
        },
        eq(col: string, val: unknown) {
          entry.filters[col] = val;
          return builder;
        },
        lt(col: string, val: unknown) {
          entry.filters[`${col}__lt`] = val;
          return builder;
        },
        in(col: string, vals: unknown[]) {
          entry.inFilter = { col, vals };
          return builder;
        },
        not(col: string, op: string, val: unknown) {
          entry.filters[`${col}__not_${op}`] = val;
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          if (table === 'concept_mastery') {
            return Promise.resolve({ data: masteryRows, error: null });
          }
          if (table === 'question_bank') {
            const allowed = new Set(
              (entry.inFilter?.vals as string[] | undefined) ?? BLOOM_ORDER,
            );
            const chapter = (entry.filters.chapter_number as number) ?? 5;
            const data = BLOOM_ORDER.filter((b) => allowed.has(b)).map((b) =>
              makeQuestion({
                bloom_level: b,
                chapter_number: chapter,
                concept_tag: chapter === 5 ? 'fractions' : 'algebra',
              }),
            );
            return Promise.resolve({ data, error: null });
          }
          return Promise.resolve({ data: [], error: null });
        },
        maybeSingle() {
          if (table === 'subjects') {
            return Promise.resolve({ data: { id: 'subj-uuid-1' }, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
      return builder;
    },
  };
  return { client, log };
}

function masteryRow(mastery: number, chapter: number, conceptTag: string): any {
  return {
    topic_id: `topic-${chapter}-${conceptTag}`,
    mastery_probability: mastery, // canonical numeric posterior (0-1)
    next_review_at: null,
    curriculum_topics: {
      subject_id: 'subj-uuid-1',
      chapter_number: chapter,
      concept_tag: conceptTag,
    },
  };
}

const SELECT_PARAMS = {
  studentId: 'student-1',
  subject: 'math',
  grade: '7',
  count: 8,
} as const;

describe('Section 3 — selectAdaptiveQuestions differential (weak vs strong mastery profile)', () => {
  it('the live-selection flag is now ON by default (enable migration 20260702210000)', () => {
    expect(FLAG_DEFAULTS[ADAPTIVE_LIVE_SELECTION_FLAGS.V1]).toBe(true);
  });

  it('WEAK profile (0.2 on ch5) and STRONGER profile (0.8 on ch9) get DIFFERENT candidate sets', async () => {
    // Weak learner: mastery 0.2 on chapter 5 → Bloom ceiling 'understand'.
    const { client: weakClient } = makeFakeClient([masteryRow(0.2, 5, 'fractions')]);
    const weak = await selectAdaptiveQuestions(weakClient, SELECT_PARAMS);

    // Stronger learner: mastery 0.8 on chapter 9 → Bloom ceiling 'evaluate'.
    const { client: strongClient } = makeFakeClient([masteryRow(0.8, 9, 'algebra')]);
    const strong = await selectAdaptiveQuestions(strongClient, SELECT_PARAMS);

    expect(weak.questions.length).toBeGreaterThan(0);
    expect(strong.questions.length).toBeGreaterThan(0);

    // Different chapters targeted — the candidate sets are disjoint.
    expect(weak.questions.every((q: any) => q.chapter_number === 5)).toBe(true);
    expect(strong.questions.every((q: any) => q.chapter_number === 9)).toBe(true);

    // Different Bloom composition: the weak learner is capped at
    // 'understand'; the stronger learner reaches above it.
    const weakBlooms = new Set(weak.questions.map((q: any) => q.bloom_level));
    const strongBlooms = new Set(strong.questions.map((q: any) => q.bloom_level));
    for (const b of weakBlooms) {
      expect(['remember', 'understand']).toContain(b);
    }
    const aboveUnderstand = ['apply', 'analyze', 'evaluate'];
    expect([...strongBlooms].some((b) => aboveUnderstand.includes(b as string))).toBe(true);

    // And the raw candidate id sets differ.
    const weakIds = new Set(weak.questions.map((q: any) => q.id));
    const strongIds = strong.questions.map((q: any) => q.id);
    expect(strongIds.some((id: string) => weakIds.has(id))).toBe(false);
  });

  it('a FULLY-MASTERED learner gets NO adaptive candidates (differs from the weak learner)', async () => {
    // The selector filters `.lt('mastery_probability', 0.95)` at the data
    // layer, so a fully-mastered student's query returns zero rows — modelled
    // here as an empty concept_mastery fixture.
    const { client: masteredClient, log } = makeFakeClient([]);
    const mastered = await selectAdaptiveQuestions(masteredClient, SELECT_PARAMS);
    expect(mastered.questions).toEqual([]);
    expect(mastered.weakTopicsTargeted).toBe(0);

    // Pin the canonical-column read: the mastery query filters on
    // mastery_probability (numeric posterior), never mastery_level (TEXT band).
    const masteryQuery = log.find((l) => l.table === 'concept_mastery');
    expect(masteryQuery).toBeDefined();
    expect(masteryQuery!.filters['mastery_probability__lt']).toBe(0.95);
    expect(masteryQuery!.filters['mastery_level__lt']).toBeUndefined();

    const { client: weakClient } = makeFakeClient([masteryRow(0.2, 5, 'fractions')]);
    const weak = await selectAdaptiveQuestions(weakClient, SELECT_PARAMS);
    expect(weak.questions.length).toBeGreaterThan(mastered.questions.length);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 4 — quiz-generator (Deno) source-shape pins
// ═════════════════════════════════════════════════════════════════════════════
//
// The quiz-generator Edge Function runs on Deno and cannot be imported into
// Vitest. These are SOURCE PINS in the established style (see
// adaptive-layer-health.test.ts Section 3): they assert the fixed source
// shapes and the absence of the broken ones. INTERIM coverage pending
// Deno-level tests for the Edge Function.

describe('Section 4 — quiz-generator source pins (personalization inversion + canonical mastery column)', () => {
  const QUIZ_GEN = 'supabase/functions/quiz-generator/index.ts';
  let src: string;
  let code: string;

  it('reads the source', () => {
    src = readSource(QUIZ_GEN);
    code = codeOnly(src);
    expect(src.length).toBeGreaterThan(0);
  });

  it('captures difficultyExplicitlyRequested BEFORE theta-banding (caller intent, not theta, disables adaptivity)', () => {
    // The boolean must be assigned from the pre-banding difficulty value…
    expect(code).toMatch(/const difficultyExplicitlyRequested = difficulty != null/);
    // …and the theta→difficulty banding must be gated on IT, not on
    // `difficulty == null` (the inversion: a calibrated theta used to set
    // difficulty and thereby disable review-fill + adaptive selection).
    expect(code).toMatch(/!difficultyExplicitlyRequested && abilityEstimate != null/);
  });

  it('review-fill (step 1) and adaptive selection (step 2) are guarded by !difficultyExplicitlyRequested', () => {
    // Both pipeline steps must run unless the CALLER explicitly forced a
    // difficulty. Two independent guards + the theta-banding gate = >= 3 uses.
    const guardUses = code.match(/!difficultyExplicitlyRequested/g) ?? [];
    expect(guardUses.length).toBeGreaterThanOrEqual(3);
    expect(code).toMatch(/if \(!difficultyExplicitlyRequested\) \{/); // review-fill
    expect(code).toMatch(/if \(!difficultyExplicitlyRequested && adaptiveSlots > 0\)/); // adaptive
  });

  it('the personalization-inversion guard shape `if (difficulty == null)` is gone from executable code', () => {
    expect(code).not.toMatch(/difficulty == null\)/);
  });

  it('selectAdaptiveQuestions reads mastery_probability (numeric canonical), never mastery_level (TEXT band)', () => {
    expect(code).toMatch(/\.lt\('mastery_probability', 0\.95\)/);
    expect(code).toMatch(/\.order\('mastery_probability'/);
    // The TEXT band column must not appear anywhere in executable code —
    // neither as a query column nor as a property read (a.mastery_level etc.).
    expect(code).not.toMatch(/mastery_level/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 5 — client-fix + ghost-column + SRS-chain source pins
// ═════════════════════════════════════════════════════════════════════════════

describe('Section 5a — getQuizQuestionsV2 theta read is subject-scoped (src/lib/supabase.ts)', () => {
  it('the irt_theta read filters student_learning_profiles by (student_id, subject)', () => {
    // Without the subject filter, a student with profiles in 2+ subjects makes
    // maybeSingle() error → theta silently null → adaptivity lost.
    const src = readSource('src/lib/supabase.ts');
    expect(src).toMatch(
      /from\('student_learning_profiles'\)\s*\.select\('irt_theta'\)\s*\.eq\('student_id', studentId\)\s*\.eq\('subject', subject\)\s*\.maybeSingle\(\)/,
    );
  });
});

describe('Section 5b — QuizResults SRS card writes (source_id = question id, grade present)', () => {
  const QR = 'src/components/quiz/QuizResults.tsx';
  let src: string;
  let code: string;

  it('reads the source', () => {
    src = readSource(QR);
    code = codeOnly(src);
    expect(src.length).toBeGreaterThan(0);
  });

  it('writes the QUESTION id into source_id (so due cards can resurface their question)', () => {
    expect(code).toMatch(/source_id: q\.id \|\| undefined/);
    // The broken shape (session id in source_id — unresolvable as a
    // question_bank id) must not reappear in executable code.
    expect(code).not.toMatch(/source_id: results\.session_id/);
  });

  it('writes grade (NOT NULL column — omitting it silently failed every insert; P5 string)', () => {
    expect(code).toMatch(/grade: student\.grade/);
  });

  it('dedupes by question text AND by question-bank source_id', () => {
    expect(code).toMatch(/existingSourceSet/);
    expect(code).toMatch(/\.in\('source_id', questionIds\)/);
  });

  it('retries row-by-row when the batch insert hits the partial-unique-index conflict', () => {
    expect(code).toMatch(/for \(const card of cardsToInsert\)/);
  });
});

describe('Section 5c — quiz page adaptive deep links (?qid= / ?mode=srs): fire-once + fail-soft', () => {
  const QP = 'src/app/quiz/page.tsx';
  let src: string;
  let code: string;

  it('reads the source', () => {
    src = readSource(QP);
    code = codeOnly(src);
    expect(src.length).toBeGreaterThan(0);
  });

  it('parses ?qid= behind a strict UUID guard and ?mode=srs', () => {
    expect(code).toMatch(/params\.get\('qid'\)/);
    expect(code).toMatch(/QID_UUID_RE/);
    expect(code).toMatch(/mode === 'srs'/);
  });

  it('fires exactly once via a ref guard', () => {
    expect(code).toMatch(/deepLinkFiredRef\.current = true/);
    expect(code).toMatch(/deepLinkFiredRef\.current\) return/);
  });

  it('every deep-link failure falls back to the normal setup screen (fail-soft catch)', () => {
    // The consumer's catch clears the spinner and stays on setup — it never
    // surfaces an error screen for a bad deep link.
    expect(code).toMatch(/catch \{\s*[\s\S]{0,200}?setLoading\(false\);/);
  });

  it('pins pinned-question plumbing (pinnedQuestions lead; pinnedOnly = SRS review quiz)', () => {
    expect(code).toMatch(/pinnedQuestions/);
    expect(code).toMatch(/pinnedOnly/);
    // SRS branch reads DUE cards from the live SM-2 table with the
    // quiz_wrong_answer source and a resolvable source_id.
    expect(code).toMatch(/\.eq\('source', 'quiz_wrong_answer'\)/);
    expect(code).toMatch(/\.not\('source_id', 'is', null\)/);
  });
});

describe('Section 5d — ghost-column repoint: concept_mastery due reads use next_review_at', () => {
  // concept_mastery.next_review_date is a deprecated ghost DATE column
  // (CURRENT_DATE + 1 default, no writer) — every reader must use the real
  // SM-2 column next_review_at. NOTE: spaced_repetition_cards.next_review_date
  // is a REAL column on a different table; these pins are scoped to the
  // concept_mastery readers only.
  const CONCEPT_MASTERY_READERS = [
    'src/app/api/foxy/_lib/cognitive-context.ts',
    'src/app/api/dashboard/reviews-due/route.ts',
    'src/app/api/revision/overview/route.ts',
  ];

  for (const file of CONCEPT_MASTERY_READERS) {
    it(`${file} queries next_review_at and never the ghost next_review_date`, () => {
      const code = codeOnly(readSource(file));
      expect(code).toMatch(/next_review_at/);
      // No query-builder or select-column reference to the ghost column in
      // executable code (comments documenting the ghost are stripped).
      expect(code).not.toMatch(/['"][^'"]*next_review_date/);
    });
  }

  it('cognitive-context exports the pure deriveNextAction ladder (no cme-engine network call)', () => {
    const code = codeOnly(readSource('src/app/api/foxy/_lib/cognitive-context.ts'));
    expect(code).toMatch(/export function deriveNextAction/);
    // The retired 401-dead network call must not come back.
    expect(code).not.toMatch(/get_next_action/);
    expect(code).not.toMatch(/functions\/v1\/cme-engine/);
  });

  it('migration 20260702200000 repoints get_adaptive_questions due predicate onto next_review_at <= now()', () => {
    const sql = readSource(
      'supabase/migrations/20260702200000_fix_get_adaptive_questions_srs_due_predicate.sql',
    );
    expect(sql).toMatch(/next_review_at <= now\(\)/);
  });
});

describe('Section 5e — learner-loop due count reads the LIVE spaced_repetition_cards table', () => {
  it('buildLoopAugmentation counts spaced_repetition_cards (is_active), never the nonexistent review_cards', () => {
    const code = codeOnly(readSource('src/lib/state/learner-loop/resolve-next-action.ts'));
    expect(code).toMatch(/\.from\('spaced_repetition_cards'\)/);
    expect(code).toMatch(/\.eq\('is_active', true\)/);
    // The ghost table (never existed — its read always errored → dueCount 0 →
    // the review branch was permanently dead) must not come back.
    expect(code).not.toMatch(/from\('review_cards'\)/);
  });
});
