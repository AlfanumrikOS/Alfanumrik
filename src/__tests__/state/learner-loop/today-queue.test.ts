/**
 * Wave A — tests for resolveTodayQueue (the ordered "Today queue").
 *
 * The contract this file pins:
 *   (a) resolveNextLearnerAction is UNCHANGED — `primary`/`queue[0]` matches
 *       the raw first-match for every non-live state (regression parity).
 *   (b) resolveTodayQueue returns correct ORDERED queues for the contract's
 *       three example states.
 *   (c) MAX_TODAY_QUEUE_ITEMS truncation.
 *   (d) cold-start short-circuit.
 *   (e) live-resume exception + lesson de-dup.
 *
 * No formula / threshold is asserted here beyond reusing LEARNER_LOOP_CONFIG —
 * the queue is a pure re-projection of the SAME branch predicates.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveNextLearnerAction,
  resolveTodayQueue,
  type LoopAugmentation,
} from '../../../lib/state/learner-loop/resolve-next-action';
import {
  LEARNER_LOOP_CONFIG,
  MAX_TODAY_QUEUE_ITEMS,
} from '../../../lib/state/learner-loop/types';
import type {
  StudentState,
  LiveSessionState,
} from '../../../lib/state/student-state';

// ── Fixtures (mirror resolve-next-action.test.ts) ────────────────────

function makeState(overrides: Partial<StudentState> = {}): StudentState {
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

// Weekday noon IST that is neither Sunday nor month-end.
const WEEKDAY_NOON_IST = new Date('2026-05-13T06:30:00.000Z'); // Wed 12:00 IST
const SUNDAY_NOON_IST = new Date('2026-05-17T06:30:00.000Z'); // Sun 12:00 IST

// ── (a) regression parity: primary === raw first-match for non-live ──

describe('resolveTodayQueue — primary mirrors resolveNextLearnerAction (non-live)', () => {
  const cases: Array<{ name: string; state: StudentState; aug: LoopAugmentation; now: Date }> = [
    { name: 'cold start (empty mastery)', state: makeState({ mastery: [] }), aug: emptyAugmentation(), now: WEEKDAY_NOON_IST },
    { name: 'stacking reviews', state: makeState(), aug: { ...emptyAugmentation(), dueReviewCount: 9 }, now: WEEKDAY_NOON_IST },
    { name: "today's ZPD", state: makeState(), aug: emptyAugmentation(), now: WEEKDAY_NOON_IST },
    { name: 'continue lesson', state: makeState(), aug: { dueReviewCount: 0, attemptedQuizToday: true, inProgressLessons: [{ subjectCode: 'math', chapterNumber: 4, progressPct: 0.62 }] }, now: WEEKDAY_NOON_IST },
    { name: 'weekly dive (Sunday)', state: makeState(), aug: { ...emptyAugmentation(), attemptedQuizToday: true }, now: SUNDAY_NOON_IST },
    { name: 'weakest fallback', state: makeState(), aug: { ...emptyAugmentation(), attemptedQuizToday: true }, now: WEEKDAY_NOON_IST },
  ];

  it.each(cases)('$name → primary deep-equals resolveNextLearnerAction', ({ state, aug, now }) => {
    const raw = resolveNextLearnerAction(state, aug, { now });
    const q = resolveTodayQueue(state, aug, { now });
    expect(q.primary).toEqual(raw);
    expect(q.queue[0]).toEqual(raw);
    expect(q.branch).toBe(raw.kind);
  });
});

// ── (b) contract example states ──────────────────────────────────────

describe('resolveTodayQueue — contract example states', () => {
  it('new student → queue is ONLY [cold_start_diagnostic]', () => {
    const state = makeState({ mastery: [] });
    const q = resolveTodayQueue(state, emptyAugmentation(), { now: WEEKDAY_NOON_IST });
    expect(q.queue.map(a => a.kind)).toEqual(['cold_start_diagnostic']);
    expect(q.primary.kind).toBe('cold_start_diagnostic');
    expect(q.branch).toBe('cold_start_diagnostic');
  });

  it('mid-stream: in-progress lesson + stacking SRS + weak topic → ordered queue', () => {
    // Live lesson on math/4 → resume wins CTA. SRS stacking (>= threshold).
    // attemptedQuizToday=false → branch-4 ZPD fires. continue_lesson on a
    // DIFFERENT chapter (science/7) so no de-dup with the resumed math/4.
    const live: LiveSessionState = {
      kind: 'in_lesson',
      lessonId: '33333333-3333-3333-3333-333333333333',
      subjectCode: 'math',
      chapterNumber: 4,
      startedAt: '2026-05-13T06:00:00.000Z',
    };
    const state = makeState({ live });
    const aug: LoopAugmentation = {
      dueReviewCount: LEARNER_LOOP_CONFIG.REVIEW_STACKING_THRESHOLD + 2, // 7 → hard branch 2
      attemptedQuizToday: false,
      inProgressLessons: [{ subjectCode: 'science', chapterNumber: 7, progressPct: 0.6 }],
    };
    const q = resolveTodayQueue(state, aug, { now: WEEKDAY_NOON_IST });

    // Resume first (live wins CTA), then branch order: reviews (rank 2),
    // ZPD quiz (rank 4), continue lesson on science/7 (rank 5), and the
    // weakest-topic quiz catch-all (rank 8) also fires.
    expect(q.primary.kind).toBe('resume_in_progress');
    expect(q.queue[0].kind).toBe('resume_in_progress');
    expect(q.queue.map(a => a.kind)).toEqual([
      'resume_in_progress',
      'review_due_cards',
      'start_quiz',      // rank 4 — todays_zpd
      'continue_lesson', // rank 5 — science/7 (different chapter, not deduped)
      'start_quiz',      // rank 8 — weakest_topic_practice catch-all
    ]);
    // The two start_quiz items carry distinct reasons (ZPD vs catch-all).
    const quizReasons = q.queue
      .filter(a => a.kind === 'start_quiz')
      .map(a => (a.kind === 'start_quiz' ? a.reason : ''));
    expect(quizReasons).toEqual(['todays_zpd', 'weakest_topic_practice']);
    // branch reports what the raw resolver would have chosen (reviews stacking).
    expect(q.branch).toBe('review_due_cards');
    // The hard SRS variant, not the soft one.
    const review = q.queue.find(a => a.kind === 'review_due_cards');
    expect(review && review.kind === 'review_due_cards' && review.reason).toBe('reviews_stacking');
  });

  it('Sunday, dive due, quiz done, no other signals → [weekly_dive]', () => {
    const state = makeState();
    const aug: LoopAugmentation = { ...emptyAugmentation(), attemptedQuizToday: true };
    const q = resolveTodayQueue(state, aug, { now: SUNDAY_NOON_IST });
    expect(q.queue.map(a => a.kind)).toEqual(['weekly_dive', 'start_quiz']);
    // weekly_dive is rank 6; branch-8 weakest fallback also fires (rank 8).
    expect(q.primary.kind).toBe('weekly_dive');
    expect(q.branch).toBe('weekly_dive');
  });
});

// ── SRS soft variant ─────────────────────────────────────────────────

describe('resolveTodayQueue — SRS soft variant', () => {
  it('1 <= dueReviewCount < threshold emits a soft reviews_due_today item', () => {
    const state = makeState();
    const aug: LoopAugmentation = {
      ...emptyAugmentation(),
      dueReviewCount: LEARNER_LOOP_CONFIG.REVIEW_STACKING_THRESHOLD - 1, // 4 → below hard
      attemptedQuizToday: false,
    };
    const q = resolveTodayQueue(state, aug, { now: WEEKDAY_NOON_IST });
    const review = q.queue.find(a => a.kind === 'review_due_cards');
    expect(review).toBeDefined();
    if (review && review.kind === 'review_due_cards') {
      expect(review.reason).toBe('reviews_due_today'); // soft, not 'reviews_stacking'
      expect(review.dueCount).toBe(LEARNER_LOOP_CONFIG.REVIEW_STACKING_THRESHOLD - 1);
    }
    // The soft review never displaces the primary CTA: the raw first-match
    // here is the ZPD quiz (branch 2 hard fails), so the queue is led by
    // start_quiz and the soft review slots in immediately AFTER it.
    expect(q.primary.kind).toBe('start_quiz');
    expect(q.queue[0].kind).toBe('start_quiz');
    expect(q.queue[1].kind).toBe('review_due_cards');
    expect(q.branch).toBe('start_quiz');
    // queue[0] === primary invariant holds even with the soft variant present.
    expect(q.queue[0]).toEqual(q.primary);
  });

  it('dueReviewCount === 0 emits NO review item', () => {
    const state = makeState();
    const q = resolveTodayQueue(state, emptyAugmentation(), { now: WEEKDAY_NOON_IST });
    expect(q.queue.some(a => a.kind === 'review_due_cards')).toBe(false);
  });
});

// ── (c) max-6 truncation ─────────────────────────────────────────────

describe('resolveTodayQueue — truncation', () => {
  it('never returns more than MAX_TODAY_QUEUE_ITEMS', () => {
    // Construct a state where many branches fire at once on a month-end
    // Sunday with a live foxy session, decayed topic, stacking reviews, etc.
    const monthEndSunday = new Date('2026-05-31T06:30:00.000Z'); // Sun + last day of May IST
    const longAgo = new Date(monthEndSunday.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const live: LiveSessionState = {
      kind: 'in_foxy',
      foxySessionId: '44444444-4444-4444-4444-444444444444',
      subjectCode: 'science',
      startedAt: '2026-05-31T06:00:00.000Z',
      turnCount: 3,
    };
    const state = makeState({
      live,
      mastery: [
        {
          subjectCode: 'science',
          meanMastery: 0.7,
          chapters: [
            { chapterNumber: 1, mastery: 0.85, lastUpdatedAt: longAgo, attempts: 40 }, // decayed
            { chapterNumber: 2, mastery: 0.2, lastUpdatedAt: '2026-05-30T09:00:00.000Z', attempts: 12 }, // weak
          ],
        },
      ],
    });
    const aug: LoopAugmentation = {
      dueReviewCount: 20, // hard branch 2
      attemptedQuizToday: false, // branch 4 ZPD fires
      inProgressLessons: [{ subjectCode: 'math', chapterNumber: 9, progressPct: 0.7 }], // branch 5
    };
    const q = resolveTodayQueue(state, aug, { now: monthEndSunday });
    expect(q.queue.length).toBeLessThanOrEqual(MAX_TODAY_QUEUE_ITEMS);
    // Live foxy resume always leads.
    expect(q.queue[0].kind).toBe('resume_in_progress');
  });
});

// ── (d) cold-start short-circuit ─────────────────────────────────────

describe('resolveTodayQueue — cold-start short-circuit', () => {
  it('cold-start suppresses ranks 2-8 even when they would fire', () => {
    // Under COLD_START_MAX_ATTEMPTS attempts, but with stacking reviews and
    // a Sunday — none of those may appear; only cold_start_diagnostic.
    const state = makeState({
      mastery: [
        {
          subjectCode: 'science',
          meanMastery: 0.5,
          chapters: [{ chapterNumber: 1, mastery: 0.5, lastUpdatedAt: '2026-05-12T09:00:00.000Z', attempts: 2 }],
        },
      ],
    });
    const aug: LoopAugmentation = {
      dueReviewCount: 30,
      attemptedQuizToday: false,
      inProgressLessons: [{ subjectCode: 'math', chapterNumber: 4, progressPct: 0.7 }],
    };
    const q = resolveTodayQueue(state, aug, { now: SUNDAY_NOON_IST });
    expect(q.queue.map(a => a.kind)).toEqual(['cold_start_diagnostic']);
    expect(q.primary.kind).toBe('cold_start_diagnostic');
  });

  it('cold-start + live session → [resume_in_progress, cold_start_diagnostic] only', () => {
    const live: LiveSessionState = {
      kind: 'in_quiz',
      quizSessionId: '55555555-5555-5555-5555-555555555555',
      subjectCode: 'science',
      chapterNumber: 1,
      startedAt: '2026-05-13T06:00:00.000Z',
      questionCount: 10,
      questionsAnswered: 3,
    };
    const state = makeState({
      live,
      mastery: [
        {
          subjectCode: 'science',
          meanMastery: 0.5,
          chapters: [{ chapterNumber: 1, mastery: 0.5, lastUpdatedAt: '2026-05-12T09:00:00.000Z', attempts: 2 }],
        },
      ],
    });
    const aug: LoopAugmentation = { ...emptyAugmentation(), dueReviewCount: 30 };
    const q = resolveTodayQueue(state, aug, { now: SUNDAY_NOON_IST });
    expect(q.queue.map(a => a.kind)).toEqual(['resume_in_progress', 'cold_start_diagnostic']);
    expect(q.primary.kind).toBe('resume_in_progress');
    // branch still reports the raw resolver's pick (cold start).
    expect(q.branch).toBe('cold_start_diagnostic');
  });
});

// ── (e) live-resume exception + de-dup ───────────────────────────────

describe('resolveTodayQueue — live-resume exception', () => {
  it('in_quiz live → resume url is /quiz and primary differs from raw first-match', () => {
    const live: LiveSessionState = {
      kind: 'in_quiz',
      quizSessionId: '55555555-5555-5555-5555-555555555555',
      subjectCode: 'science',
      chapterNumber: 3,
      startedAt: '2026-05-13T06:00:00.000Z',
      questionCount: 10,
      questionsAnswered: 2,
    };
    const state = makeState({ live });
    const aug = emptyAugmentation();
    const raw = resolveNextLearnerAction(state, aug, { now: WEEKDAY_NOON_IST });
    const q = resolveTodayQueue(state, aug, { now: WEEKDAY_NOON_IST });

    expect(q.primary.kind).toBe('resume_in_progress');
    expect(q.primary.url).toBe('/quiz');
    // primary differs from raw first-match (the only case this is allowed).
    expect(q.primary).not.toEqual(raw);
    // branch still reflects the raw resolver pick.
    expect(q.branch).toBe(raw.kind);
    // raw action still appears later in the queue.
    expect(q.queue.some(a => a.kind === raw.kind)).toBe(true);
  });

  it('in_foxy live → resume url is /foxy', () => {
    const live: LiveSessionState = {
      kind: 'in_foxy',
      foxySessionId: '44444444-4444-4444-4444-444444444444',
      subjectCode: 'math',
      startedAt: '2026-05-13T06:00:00.000Z',
      turnCount: 1,
    };
    const state = makeState({ live });
    const q = resolveTodayQueue(state, emptyAugmentation(), { now: WEEKDAY_NOON_IST });
    expect(q.primary.kind).toBe('resume_in_progress');
    expect(q.primary.url).toBe('/foxy');
  });

  it('in_lesson live → resume url reuses /learn/{subject}/{chapter} shape', () => {
    const live: LiveSessionState = {
      kind: 'in_lesson',
      lessonId: '33333333-3333-3333-3333-333333333333',
      subjectCode: 'science',
      chapterNumber: 9,
      startedAt: '2026-05-13T06:00:00.000Z',
    };
    const state = makeState({ live });
    const q = resolveTodayQueue(state, emptyAugmentation(), { now: WEEKDAY_NOON_IST });
    expect(q.primary.kind).toBe('resume_in_progress');
    expect(q.primary.url).toBe('/learn/science/9');
  });

  it('de-dup: in_lesson resume suppresses continue_lesson for the SAME chapter', () => {
    const live: LiveSessionState = {
      kind: 'in_lesson',
      lessonId: '33333333-3333-3333-3333-333333333333',
      subjectCode: 'math',
      chapterNumber: 4,
      startedAt: '2026-05-13T06:00:00.000Z',
    };
    const state = makeState({ live });
    const aug: LoopAugmentation = {
      dueReviewCount: 0,
      attemptedQuizToday: true, // so branch 4 ZPD passes, branch 5 continue fires
      inProgressLessons: [{ subjectCode: 'math', chapterNumber: 4, progressPct: 0.62 }], // SAME chapter
    };
    const q = resolveTodayQueue(state, aug, { now: WEEKDAY_NOON_IST });
    // resume present, continue_lesson for math/4 suppressed.
    expect(q.queue[0].kind).toBe('resume_in_progress');
    const continueForSame = q.queue.find(
      a => a.kind === 'continue_lesson' && a.subjectCode === 'math' && a.chapterNumber === 4,
    );
    expect(continueForSame).toBeUndefined();
  });

  it('de-dup does NOT suppress continue_lesson for a DIFFERENT chapter', () => {
    const live: LiveSessionState = {
      kind: 'in_lesson',
      lessonId: '33333333-3333-3333-3333-333333333333',
      subjectCode: 'math',
      chapterNumber: 4,
      startedAt: '2026-05-13T06:00:00.000Z',
    };
    const state = makeState({ live });
    const aug: LoopAugmentation = {
      dueReviewCount: 0,
      attemptedQuizToday: true,
      inProgressLessons: [{ subjectCode: 'science', chapterNumber: 7, progressPct: 0.7 }], // DIFFERENT
    };
    const q = resolveTodayQueue(state, aug, { now: WEEKDAY_NOON_IST });
    const continueForOther = q.queue.find(
      a => a.kind === 'continue_lesson' && a.subjectCode === 'science' && a.chapterNumber === 7,
    );
    expect(continueForOther).toBeDefined();
  });
});

// ── Invariant: queue[0] always equals primary ────────────────────────

describe('resolveTodayQueue — queue[0] === primary invariant', () => {
  it.each<[string, Partial<StudentState>, LoopAugmentation, Date]>([
    ['idle weekday', {}, emptyAugmentation(), WEEKDAY_NOON_IST],
    ['idle sunday', {}, { ...emptyAugmentation(), attemptedQuizToday: true }, SUNDAY_NOON_IST],
    ['cold start', { mastery: [] }, emptyAugmentation(), WEEKDAY_NOON_IST],
  ])('%s', (_name, overrides, aug, now) => {
    const q = resolveTodayQueue(makeState(overrides), aug, { now });
    expect(q.queue[0]).toEqual(q.primary);
  });
});
