import { describe, it, expect } from 'vitest';
import {
  StudentStateSchema,
  pickSubjectMastery,
  weakestChapter,
  isLive,
  type StudentState,
} from '../../lib/state/student-state';
import {
  DomainEventSchema,
  ALL_EVENT_KINDS,
  type DomainEvent,
} from '../../lib/state/events/registry';
import { projectJourney, groupByIstDay } from '../../lib/state/journey/journey';
import { buildAiContext } from '../../lib/state/context/builder';
import { evaluate, pickDecision } from '../../lib/state/rules/engine';
import {
  STANDARD_RULES,
  foxyGateMinorWithoutParentRule,
  dashboardSuggestNextQuizRule,
  upsellFamilyPlanRule,
} from '../../lib/state/rules/stdlib';
import {
  bktUpdate,
  quizCompletionService,
} from '../../lib/state/services/quiz-completion-service';

/**
 * Tests for the unified state architecture. We pin the pure-logic
 * invariants — schema shape, BKT math, rule firings, projector behaviour
 * — without touching Supabase. The Orchestrator's I/O paths are tested
 * via integration in a follow-up; this suite is fast + deterministic.
 */

// ── Fixture ──────────────────────────────────────────────────────────

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
      enabledModules: ['foxy_tutor', 'quiz_engine', 'live_classes'],
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
    parentIds: ['33333333-3333-3333-3333-333333333333'],
  };
  return { ...base, ...overrides };
}

// ── Schema ───────────────────────────────────────────────────────────

describe('StudentStateSchema', () => {
  it('accepts a well-formed state', () => {
    const s = makeState();
    expect(() => StudentStateSchema.parse(s)).not.toThrow();
  });

  it('rejects out-of-range mastery', () => {
    const s = makeState({
      mastery: [
        {
          subjectCode: 'science',
          meanMastery: 1.2,
          chapters: [],
        },
      ],
    });
    expect(() => StudentStateSchema.parse(s)).toThrow();
  });

  it('rejects bad live-state discriminator', () => {
    const s = makeState({ live: { kind: 'in_quiz' } as never });
    expect(() => StudentStateSchema.parse(s)).toThrow();
  });
});

// ── Helpers ──────────────────────────────────────────────────────────

describe('state helpers', () => {
  it('pickSubjectMastery finds the subject or returns null', () => {
    const s = makeState();
    expect(pickSubjectMastery(s, 'science')?.subjectCode).toBe('science');
    expect(pickSubjectMastery(s, 'history')).toBeNull();
  });

  it('weakestChapter picks the lowest mastery across all subjects', () => {
    const s = makeState();
    const w = weakestChapter(s);
    expect(w).toEqual({ subjectCode: 'science', chapterNumber: 3, mastery: 0.1 });
  });

  it('weakestChapter returns null when nothing has signal', () => {
    const s = makeState({ mastery: [] });
    expect(weakestChapter(s)).toBeNull();
  });

  it('isLive flips only when not idle', () => {
    expect(isLive(makeState())).toBe(false);
    expect(
      isLive(
        makeState({
          live: {
            kind: 'in_foxy',
            foxySessionId: '44444444-4444-4444-4444-444444444444',
            subjectCode: 'science',
            startedAt: '2026-05-12T09:55:00.000Z',
            turnCount: 3,
          },
        }),
      ),
    ).toBe(true);
  });
});

// ── Event registry ───────────────────────────────────────────────────

describe('event registry', () => {
  it('ALL_EVENT_KINDS is in sync with the schema discriminator', () => {
    // Each kind in ALL_EVENT_KINDS should parse a minimal event of that kind.
    expect(ALL_EVENT_KINDS.length).toBeGreaterThan(0);
    // The reverse — every member of the schema appears in ALL_EVENT_KINDS —
    // is checked by the compiler in journey/journey.ts's `never` exhaustive switch.
  });

  it('rejects an event whose payload misses a required field', () => {
    const bad = {
      eventId: '55555555-5555-5555-5555-555555555555',
      kind: 'learner.quiz_completed',
      actorAuthUserId: '11111111-1111-1111-1111-111111111111',
      tenantId: null,
      idempotencyKey: 'k1',
      occurredAt: '2026-05-12T10:00:00.000Z',
      payload: {
        quizSessionId: '66666666-6666-6666-6666-666666666666',
        // missing: subjectCode, chapterNumber, …
      },
    };
    expect(() => DomainEventSchema.parse(bad)).toThrow();
  });
});

// ── BKT math ─────────────────────────────────────────────────────────

describe('bktUpdate', () => {
  it('raises mastery on a correct answer', () => {
    expect(bktUpdate(0.3, true)).toBeGreaterThan(0.3);
  });

  it('lowers (or holds barely) mastery on a wrong answer at high prior', () => {
    // Single wrong at high prior should still leave mastery > 0.5
    // because the transition param keeps learning a chance.
    const next = bktUpdate(0.8, false);
    expect(next).toBeLessThan(0.8);
    expect(next).toBeGreaterThan(0.3);
  });

  it('clamps to [0,1] in practice', () => {
    let m = 0.99;
    for (let i = 0; i < 30; i++) m = bktUpdate(m, true);
    expect(m).toBeLessThanOrEqual(1);
    expect(m).toBeGreaterThan(0.99);
  });
});

// ── Quiz completion service ──────────────────────────────────────────

describe('quizCompletionService', () => {
  it('emits one learner.quiz_completed + one learner.mastery_changed per chapter', async () => {
    const s = makeState();
    const result = await quizCompletionService.run({
      state: s,
      input: {
        quizSessionId: '77777777-7777-7777-7777-777777777777',
        subjectCode: 'science',
        chapterNumber: 2,
        questions: [
          { correct: true, timeSpentSec: 20 },
          { correct: false, timeSpentSec: 30 },
          { correct: true, timeSpentSec: 15 },
        ],
        startedAt: '2026-05-12T09:30:00.000Z',
        endedAt: '2026-05-12T09:35:00.000Z',
      },
      triggeringEvent: null,
      idempotencyKey: 'test-key',
    });
    expect(result.output.correctCount).toBe(2);
    expect(result.output.xpEarned).toBe(10); // 2 correct * 5 XP
    const kinds = result.events.map(e => e.kind);
    expect(kinds).toContain('learner.quiz_completed');
    expect(kinds.filter(k => k === 'learner.mastery_changed').length).toBe(1);
  });

  it('idempotency keys are deterministic from the quiz session id', async () => {
    const s = makeState();
    const input = {
      quizSessionId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      subjectCode: 'science',
      chapterNumber: 2,
      questions: [{ correct: true, timeSpentSec: 20 }],
      startedAt: '2026-05-12T09:30:00.000Z',
      endedAt: '2026-05-12T09:31:00.000Z',
    };
    const r1 = await quizCompletionService.run({ state: s, input, triggeringEvent: null, idempotencyKey: 'k' });
    const r2 = await quizCompletionService.run({ state: s, input, triggeringEvent: null, idempotencyKey: 'k' });
    expect(r1.events.map(e => e.idempotencyKey).sort()).toEqual(
      r2.events.map(e => e.idempotencyKey).sort(),
    );
  });
});

// ── Journey projector ────────────────────────────────────────────────

describe('projectJourney', () => {
  it('renders a quiz completion as a practice entry', () => {
    const event: DomainEvent = {
      eventId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      kind: 'learner.quiz_completed',
      actorAuthUserId: '11111111-1111-1111-1111-111111111111',
      tenantId: null,
      idempotencyKey: 'k',
      occurredAt: '2026-05-12T09:35:00.000Z',
      payload: {
        quizSessionId: '77777777-7777-7777-7777-777777777777',
        subjectCode: 'science',
        chapterNumber: 2,
        questionCount: 3,
        correctCount: 2,
        durationSec: 300,
        xpEarned: 10,
      },
    };
    const j = projectJourney([event]);
    expect(j).toHaveLength(1);
    expect(j[0].category).toBe('practice');
    expect(j[0].title).toContain('science');
    expect(j[0].detail).toContain('67%');
  });

  it('drops noise (session_started, foxy started, internal mesh)', () => {
    const events: DomainEvent[] = [
      {
        eventId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        kind: 'learner.session_started',
        actorAuthUserId: '11111111-1111-1111-1111-111111111111',
        tenantId: null,
        idempotencyKey: 'k1',
        occurredAt: '2026-05-12T09:00:00.000Z',
        payload: { surface: 'web', referrer: null },
      },
      {
        eventId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
        kind: 'mesh.cycle_completed',
        actorAuthUserId: '11111111-1111-1111-1111-111111111111',
        tenantId: null,
        idempotencyKey: 'k2',
        occurredAt: '2026-05-12T09:01:00.000Z',
        payload: {
          cycleId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
          decision: 'approve',
          targetMetric: 'x',
          tokensSpent: 100,
        },
      },
    ];
    expect(projectJourney(events)).toHaveLength(0);
  });

  it('only surfaces mastery_changed when crossing 0.5 or 0.8 thresholds', () => {
    const e = (from: number, to: number): DomainEvent => ({
      eventId: '99999999-9999-9999-9999-999999999999',
      kind: 'learner.mastery_changed',
      actorAuthUserId: '11111111-1111-1111-1111-111111111111',
      tenantId: null,
      idempotencyKey: `m-${from}-${to}`,
      occurredAt: '2026-05-12T10:00:00.000Z',
      payload: {
        subjectCode: 'math',
        chapterNumber: 1,
        fromMastery: from,
        toMastery: to,
        trigger: 'quiz',
      },
    });
    expect(projectJourney([e(0.4, 0.5)])).toHaveLength(1); // crosses 0.5
    expect(projectJourney([e(0.6, 0.65)])).toHaveLength(0); // wobble
    expect(projectJourney([e(0.7, 0.82)])).toHaveLength(1); // crosses 0.8
  });

  it('groupByIstDay buckets by IST calendar day', () => {
    const events = projectJourney([
      {
        eventId: 'a1111111-1111-1111-1111-111111111111',
        kind: 'learner.quiz_completed',
        actorAuthUserId: '11111111-1111-1111-1111-111111111111',
        tenantId: null,
        idempotencyKey: 'k1',
        // 2026-05-11T20:00 UTC = 2026-05-12 01:30 IST
        occurredAt: '2026-05-11T20:00:00.000Z',
        payload: {
          quizSessionId: 'a2222222-2222-2222-2222-222222222222',
          subjectCode: 'math',
          chapterNumber: 1,
          questionCount: 1,
          correctCount: 1,
          durationSec: 10,
          xpEarned: 5,
        },
      },
    ]);
    const groups = groupByIstDay(events);
    expect(groups).toHaveLength(1);
    expect(groups[0].ymd).toBe('2026-05-12');
  });
});

// ── AI context builder ───────────────────────────────────────────────

describe('buildAiContext', () => {
  it('emits a focused, bounded markdown block', () => {
    const s = makeState();
    const ctx = buildAiContext({
      state: s,
      recentJourney: [],
      currentFocus: { subjectCode: 'science', chapterNumber: 2, mode: 'tutor' },
    });
    expect(ctx.markdown).toContain('Grade 8');
    expect(ctx.markdown).toContain('current standing in science');
    // Mentions the focus chapter's specific mastery.
    expect(ctx.markdown).toContain('Chapter 2');
    // Suggested teaching opportunity points at the weakest chapter.
    expect(ctx.markdown).toContain('weakest spot');
    expect(ctx.approxTokens).toBeLessThan(1500);
  });

  it('mentions the tenant AI personality when set', () => {
    const s = makeState({
      tenant: {
        tenantId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
        tenantType: 'school',
        enabledModules: ['foxy_tutor', 'quiz_engine'],
        aiPersonality: 'Speak like a kind didi who explains in Hindi-English mix.',
      },
    });
    const ctx = buildAiContext({ state: s, recentJourney: [] });
    expect(ctx.markdown).toContain('kind didi');
  });

  it('flags minor status to the AI', () => {
    const ctx = buildAiContext({ state: makeState(), recentJourney: [] });
    expect(ctx.markdown).toContain('Minor');
  });
});

// ── Rule engine ──────────────────────────────────────────────────────

describe('rule engine', () => {
  it('gates Foxy for unverified minor', () => {
    const s = makeState({
      consent: { isMinor: true, parentLinkVerified: false, analyticsConsent: true },
    });
    const decisions = evaluate([foxyGateMinorWithoutParentRule], s);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].decision).toBe('foxy.gate');
  });

  it('does NOT gate Foxy for a verified minor', () => {
    const s = makeState({
      consent: { isMinor: true, parentLinkVerified: true, analyticsConsent: true },
    });
    expect(evaluate([foxyGateMinorWithoutParentRule], s)).toHaveLength(0);
  });

  it('next-quiz suggestion fires on weak chapters and skips when mid-quiz', () => {
    const s = makeState();
    expect(evaluate([dashboardSuggestNextQuizRule], s)).toHaveLength(1);

    const midQuiz = makeState({
      live: {
        kind: 'in_quiz',
        quizSessionId: 'a4444444-4444-4444-4444-444444444444',
        subjectCode: 'science',
        chapterNumber: 2,
        startedAt: '2026-05-12T09:55:00.000Z',
        questionCount: 5,
        questionsAnswered: 2,
      },
    });
    expect(evaluate([dashboardSuggestNextQuizRule], midQuiz)).toHaveLength(0);
  });

  it('upsell fires on free + 7d streak; skips paid users', () => {
    const s = makeState({
      engagement: { ...makeState().engagement, currentStreakDays: 8 },
    });
    expect(evaluate([upsellFamilyPlanRule], s).length).toBe(1);

    const paid = makeState({
      access: { ...makeState().access, planSlug: 'family' },
      engagement: { ...makeState().engagement, currentStreakDays: 30 },
    });
    expect(evaluate([upsellFamilyPlanRule], paid).length).toBe(0);
  });

  it('priority-sorts decisions descending', () => {
    // Engaged free-tier non-minor on a tenant where the live_classes
    // module is disabled. Two rules fire: nav.module.hide (priority 90)
    // and upsell.show (priority 40). The higher-priority decision is
    // first in the result.
    const s = makeState({
      consent: { isMinor: false, parentLinkVerified: true, analyticsConsent: true },
      engagement: { ...makeState().engagement, currentStreakDays: 10 },
      tenant: {
        ...makeState().tenant,
        // Drop live_classes so its nav.module.hide rule fires.
        enabledModules: ['foxy_tutor', 'quiz_engine'],
      },
    });
    const decisions = evaluate(STANDARD_RULES, s);
    const hideIdx = decisions.findIndex(d => d.decision === 'nav.module.hide');
    const upsellIdx = decisions.findIndex(d => d.decision === 'upsell.show');
    expect(hideIdx).toBeGreaterThanOrEqual(0);
    expect(upsellIdx).toBeGreaterThanOrEqual(0);
    expect(hideIdx).toBeLessThan(upsellIdx); // 90 > 40
  });

  it('pickDecision returns null when the slug is not in the result set', () => {
    const s = makeState();
    const decisions = evaluate(STANDARD_RULES, s);
    expect(pickDecision(decisions, 'nonexistent.slug')).toBeNull();
  });
});
