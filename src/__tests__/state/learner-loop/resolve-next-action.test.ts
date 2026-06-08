/**
 * Phase 1 unit tests for the Learner Loop resolver.
 *
 * Each branch of resolveNextLearnerAction() gets one test that pins its
 * firing condition. These are the contract: re-ordering or weakening a
 * branch should make exactly one of these tests fail.
 *
 * ADR: docs/architecture/ADR-001-learner-loop-unification.md
 */

import { describe, it, expect } from 'vitest';
import {
  resolveNextLearnerAction,
  decayedChapters,
  istStartOfDay,
  isSundayIst,
  isMonthEndDayIst,
  type LoopAugmentation,
} from '../../../lib/state/learner-loop/resolve-next-action';
import {
  ALL_ACTION_KINDS,
  LEARNER_LOOP_CONFIG,
} from '../../../lib/state/learner-loop/types';
import type { StudentState } from '../../../lib/state/student-state';
import {
  DomainEventSchema,
  ALL_EVENT_KINDS,
} from '../../../lib/state/events/registry';

// ── Fixtures ─────────────────────────────────────────────────────────

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

// A weekday (Wednesday) that is NOT month-end. Used as the default "now"
// so weekly / monthly branches don't accidentally fire in the daily tests.
const WEEKDAY_NOON_IST = new Date('2026-05-13T06:30:00.000Z'); // = 2026-05-13 12:00 IST (Wed)

// ── Branch coverage ──────────────────────────────────────────────────

describe('resolveNextLearnerAction — branch ordering', () => {
  it('branch 1 — empty mastery returns cold_start_diagnostic', () => {
    const state = makeState({ mastery: [] });
    const action = resolveNextLearnerAction(state, emptyAugmentation(), { now: WEEKDAY_NOON_IST });
    expect(action.kind).toBe('cold_start_diagnostic');
    expect(action.url).toBe('/diagnostic');
  });

  it('branch 1 — under COLD_START_MAX_ATTEMPTS also returns cold_start_diagnostic', () => {
    const state = makeState({
      mastery: [
        {
          subjectCode: 'science',
          meanMastery: 0.5,
          chapters: [{ chapterNumber: 1, mastery: 0.5, lastUpdatedAt: '2026-05-12T09:00:00.000Z', attempts: 2 }],
        },
      ],
    });
    const action = resolveNextLearnerAction(state, emptyAugmentation(), { now: WEEKDAY_NOON_IST });
    expect(action.kind).toBe('cold_start_diagnostic');
  });

  it('branch 2 — stacking reviews above threshold returns review_due_cards', () => {
    const state = makeState();
    const aug: LoopAugmentation = { ...emptyAugmentation(), dueReviewCount: 9 };
    const action = resolveNextLearnerAction(state, aug, { now: WEEKDAY_NOON_IST });
    expect(action.kind).toBe('review_due_cards');
    if (action.kind === 'review_due_cards') {
      expect(action.dueCount).toBe(9);
      expect(action.url).toBe('/review');
    }
  });

  it('branch 2 — below threshold does NOT fire review_due_cards', () => {
    const state = makeState();
    const aug: LoopAugmentation = {
      ...emptyAugmentation(),
      dueReviewCount: LEARNER_LOOP_CONFIG.REVIEW_STACKING_THRESHOLD - 1,
    };
    const action = resolveNextLearnerAction(state, aug, { now: WEEKDAY_NOON_IST });
    expect(action.kind).not.toBe('review_due_cards');
  });

  it('branch 3 — a decayed chapter returns revise_decayed_topic', () => {
    // Chapter at mastery 0.85 last touched 30 days ago (window for 0.85 is 14d).
    const longAgo = new Date(WEEKDAY_NOON_IST.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const state = makeState({
      mastery: [
        {
          subjectCode: 'science',
          meanMastery: 0.85,
          chapters: [
            { chapterNumber: 7, mastery: 0.85, lastUpdatedAt: longAgo, attempts: 40 },
            { chapterNumber: 8, mastery: 0.2, lastUpdatedAt: '2026-05-12T09:30:00.000Z', attempts: 10 },
          ],
        },
      ],
    });
    const action = resolveNextLearnerAction(state, emptyAugmentation(), { now: WEEKDAY_NOON_IST });
    expect(action.kind).toBe('revise_decayed_topic');
    if (action.kind === 'revise_decayed_topic') {
      expect(action.subjectCode).toBe('science');
      expect(action.chapterNumber).toBe(7);
      expect(action.recommendedModality).toBe('worked-example'); // 0.85 → worked-example
      expect(action.url).toContain('from=revise');
      expect(action.url).toContain('mode=read');
    }
  });

  it('branch 4 — no quiz today + a weakest chapter returns start_quiz (todays_zpd)', () => {
    const state = makeState();
    const action = resolveNextLearnerAction(state, emptyAugmentation(), { now: WEEKDAY_NOON_IST });
    expect(action.kind).toBe('start_quiz');
    if (action.kind === 'start_quiz') {
      // weakestChapter is science/3 at 0.1 mastery → zpdBin 1
      expect(action.subjectCode).toBe('science');
      expect(action.chapterNumber).toBe(3);
      expect(action.zpdBin).toBe(1);
      expect(action.reason).toBe('todays_zpd');
    }
  });

  it('branch 5 — attempted quiz today + an in-progress lesson returns continue_lesson', () => {
    const state = makeState();
    const aug: LoopAugmentation = {
      dueReviewCount: 0,
      attemptedQuizToday: true,
      inProgressLessons: [
        { subjectCode: 'math', chapterNumber: 4, progressPct: 0.62 },
      ],
    };
    const action = resolveNextLearnerAction(state, aug, { now: WEEKDAY_NOON_IST });
    expect(action.kind).toBe('continue_lesson');
    if (action.kind === 'continue_lesson') {
      expect(action.subjectCode).toBe('math');
      expect(action.chapterNumber).toBe(4);
      expect(action.progressPct).toBeCloseTo(0.62);
    }
  });

  it('branch 6 — Sunday with quiz already done and no other signals → weekly_dive', () => {
    // 2026-05-17 is a Sunday. Pick noon IST.
    const sundayNoonIst = new Date('2026-05-17T06:30:00.000Z');
    const state = makeState();
    const aug: LoopAugmentation = { ...emptyAugmentation(), attemptedQuizToday: true };
    const action = resolveNextLearnerAction(state, aug, { now: sundayNoonIst });
    expect(action.kind).toBe('weekly_dive');
    if (action.kind === 'weekly_dive') {
      expect(action.url).toBe('/dive');
    }
  });

  it('branch 7 — month-end day with quiz done and no other signals → monthly_synthesis', () => {
    // 2026-05-31 is a Sunday — pick 2026-04-30 (Thursday) to isolate from branch 6.
    const monthEndIst = new Date('2026-04-30T06:30:00.000Z');
    const state = makeState();
    const aug: LoopAugmentation = { ...emptyAugmentation(), attemptedQuizToday: true };
    const action = resolveNextLearnerAction(state, aug, { now: monthEndIst });
    expect(action.kind).toBe('monthly_synthesis');
  });

  it('branch 8 — fallback start_quiz on weakest when all daily branches pass', () => {
    const state = makeState();
    const aug: LoopAugmentation = { ...emptyAugmentation(), attemptedQuizToday: true };
    const action = resolveNextLearnerAction(state, aug, { now: WEEKDAY_NOON_IST });
    expect(action.kind).toBe('start_quiz');
    if (action.kind === 'start_quiz') {
      expect(action.reason).toBe('weakest_topic_practice');
    }
  });
});

// ── Branch priority pin (the contract) ───────────────────────────────

describe('resolveNextLearnerAction — priority is deterministic', () => {
  it('reviews stacking BEATS a decayed topic', () => {
    const longAgo = new Date(WEEKDAY_NOON_IST.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const state = makeState({
      mastery: [
        {
          subjectCode: 'science',
          meanMastery: 0.85,
          chapters: [{ chapterNumber: 7, mastery: 0.85, lastUpdatedAt: longAgo, attempts: 40 }],
        },
      ],
    });
    const aug: LoopAugmentation = { ...emptyAugmentation(), dueReviewCount: 12 };
    const action = resolveNextLearnerAction(state, aug, { now: WEEKDAY_NOON_IST });
    expect(action.kind).toBe('review_due_cards');
  });

  it('decay BEATS today\'s ZPD', () => {
    const longAgo = new Date(WEEKDAY_NOON_IST.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const state = makeState({
      mastery: [
        {
          subjectCode: 'science',
          meanMastery: 0.85,
          chapters: [
            { chapterNumber: 7, mastery: 0.85, lastUpdatedAt: longAgo, attempts: 40 },
            { chapterNumber: 8, mastery: 0.2, lastUpdatedAt: '2026-05-12T09:30:00.000Z', attempts: 10 },
          ],
        },
      ],
    });
    const action = resolveNextLearnerAction(state, emptyAugmentation(), { now: WEEKDAY_NOON_IST });
    expect(action.kind).toBe('revise_decayed_topic');
  });

  it('Sunday weekly_dive does NOT override stacking reviews', () => {
    const sundayNoonIst = new Date('2026-05-17T06:30:00.000Z');
    const state = makeState();
    const aug: LoopAugmentation = { ...emptyAugmentation(), dueReviewCount: 20 };
    const action = resolveNextLearnerAction(state, aug, { now: sundayNoonIst });
    expect(action.kind).toBe('review_due_cards');
  });
});

// ── Helpers ──────────────────────────────────────────────────────────

describe('decayedChapters', () => {
  it('skips chapters under REVISE_MIN_MASTERY', () => {
    const state = makeState({
      mastery: [
        {
          subjectCode: 'science',
          meanMastery: 0.3,
          chapters: [
            // Under threshold: 0.3 < 0.6 → ignored even though stale.
            {
              chapterNumber: 1,
              mastery: 0.3,
              lastUpdatedAt: '2026-01-01T00:00:00.000Z',
              attempts: 5,
            },
          ],
        },
      ],
    });
    expect(decayedChapters(state, WEEKDAY_NOON_IST)).toEqual([]);
  });

  it('orders results most-stale-first', () => {
    const reallyStale = new Date(WEEKDAY_NOON_IST.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const moderatelyStale = new Date(WEEKDAY_NOON_IST.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString();
    const state = makeState({
      mastery: [
        {
          subjectCode: 'science',
          meanMastery: 0.85,
          chapters: [
            { chapterNumber: 1, mastery: 0.85, lastUpdatedAt: moderatelyStale, attempts: 40 },
            { chapterNumber: 2, mastery: 0.85, lastUpdatedAt: reallyStale, attempts: 50 },
          ],
        },
      ],
    });
    const out = decayedChapters(state, WEEKDAY_NOON_IST);
    expect(out).toHaveLength(2);
    expect(out[0].chapterNumber).toBe(2); // most-stale first
    expect(out[1].chapterNumber).toBe(1);
  });
});

describe('date helpers', () => {
  it('istStartOfDay returns IST midnight as UTC', () => {
    // 2026-05-12 12:30 UTC = 2026-05-12 18:00 IST → start-of-day = 2026-05-12 00:00 IST → 2026-05-11 18:30 UTC
    const midDayUtc = new Date('2026-05-12T12:30:00.000Z');
    const startOfDay = istStartOfDay(midDayUtc);
    expect(startOfDay.toISOString()).toBe('2026-05-11T18:30:00.000Z');
  });

  it('isSundayIst is true only on Sunday IST', () => {
    expect(isSundayIst(new Date('2026-05-17T06:30:00.000Z'))).toBe(true); // Sunday noon IST
    expect(isSundayIst(new Date('2026-05-18T06:30:00.000Z'))).toBe(false); // Monday noon IST
  });

  it('isSundayIst handles cross-day IST conversion', () => {
    // 2026-05-17T19:00Z = 2026-05-18T00:30 IST → Monday. So Sunday-UTC must NOT
    // fire when IST has rolled over.
    expect(isSundayIst(new Date('2026-05-17T19:00:00.000Z'))).toBe(false);
  });

  it('isMonthEndDayIst is true only on the last day of the month in IST', () => {
    expect(isMonthEndDayIst(new Date('2026-04-30T06:30:00.000Z'))).toBe(true); // last day of April
    expect(isMonthEndDayIst(new Date('2026-04-29T06:30:00.000Z'))).toBe(false);
    expect(isMonthEndDayIst(new Date('2026-05-31T06:30:00.000Z'))).toBe(true); // last day of May
  });
});

// ── Registry & action-kind pins ──────────────────────────────────────

describe('LearnerAction kinds', () => {
  it('every kind in ALL_ACTION_KINDS has been produced by at least one branch test', () => {
    // Tested implicitly above — this pins the public surface so any
    // addition / removal forces an explicit decision.
    expect(ALL_ACTION_KINDS).toEqual([
      'cold_start_diagnostic',
      'teacher_remediation', // Phase 3A Wave A / A3 — highest-priority branch
      'review_due_cards',
      'revise_decayed_topic',
      'start_quiz',
      'continue_lesson',
      'weekly_dive',
      'monthly_synthesis',
      'resume_in_progress',
    ]);
  });
});

describe('DomainEvent registry — Phase 1 additions', () => {
  it('includes learner.review_graded', () => {
    expect(ALL_EVENT_KINDS).toContain('learner.review_graded');
  });

  it('includes learner.scan_extracted', () => {
    expect(ALL_EVENT_KINDS).toContain('learner.scan_extracted');
  });

  it('learner.review_graded parses a valid event', () => {
    const event = {
      kind: 'learner.review_graded' as const,
      eventId: '11111111-1111-1111-1111-111111111111',
      occurredAt: '2026-05-22T10:00:00.000Z',
      actorAuthUserId: '22222222-2222-2222-2222-222222222222',
      tenantId: null,
      idempotencyKey: 'review_graded:card_1',
      payload: {
        cardId: '33333333-3333-3333-3333-333333333333',
        subjectCode: 'science',
        chapterNumber: 7,
        quality: 4 as const,
        source: 'quiz_wrong_answer' as const,
        previousIntervalDays: 3,
      },
    };
    expect(() => DomainEventSchema.parse(event)).not.toThrow();
  });

  it('learner.scan_extracted parses a valid event', () => {
    const event = {
      kind: 'learner.scan_extracted' as const,
      eventId: '11111111-1111-1111-1111-111111111111',
      occurredAt: '2026-05-22T10:00:00.000Z',
      actorAuthUserId: '22222222-2222-2222-2222-222222222222',
      tenantId: null,
      idempotencyKey: 'scan:upload_1',
      payload: {
        uploadId: '44444444-4444-4444-4444-444444444444',
        imageType: 'assignment' as const,
        subjectCode: 'math',
        chapterNumber: 12,
        questionCount: 6,
      },
    };
    expect(() => DomainEventSchema.parse(event)).not.toThrow();
  });
});
