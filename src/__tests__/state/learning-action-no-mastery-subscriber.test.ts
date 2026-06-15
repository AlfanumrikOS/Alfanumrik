import { describe, it, expect, vi } from 'vitest';

/**
 * GUARD #3 — NO MASTERY SUBSCRIBER for learner.learning_action.
 *
 * The binding assessment contract: a self-report (Got it / Explain simpler /
 * Show example / Quiz me / Save) MUST NOT move mastery. The event bus is the
 * one place a stray subscriber could quietly do that. This suite pins:
 *
 *   1. The production dispatcher has ZERO subscribers registered for
 *      learner.learning_action.
 *   2. Dispatching a real learner.learning_action event is `skipped`
 *      (`_none_`), so no projector ever runs — and therefore no mastery
 *      table is written.
 *   3. The concept-mastery-projector (the one subscriber that DOES write
 *      concept_mastery) is bound to learner.concept_check_answered ONLY and
 *      would never accept a learning_action event.
 *   4. GUARD #3b (continuity): journey.projectOne returns null for
 *      learner.learning_action — the projector never derives a mastery-moving
 *      milestone from a self-report.
 */

import {
  standardDispatcher,
  STANDARD_SUBSCRIBERS,
} from '@/lib/state/subscribers/dispatcher';
import { conceptMasteryProjector } from '@/lib/state/subscribers/concept-mastery-projector';
import { projectJourney } from '@/lib/state/journey/journey';
import type { DomainEvent } from '@/lib/state/events/registry';

const BASE = {
  eventId: '00000000-0000-0000-0000-000000000001',
  occurredAt: '2026-06-14T12:00:00.000Z',
  actorAuthUserId: '00000000-0000-0000-0000-000000000002',
  tenantId: null,
  idempotencyKey: 'learning_action:msg:save',
};

const learningActionEvent: DomainEvent = {
  ...BASE,
  kind: 'learner.learning_action',
  payload: {
    messageId: '00000000-0000-0000-0000-000000000003',
    sessionId: '00000000-0000-0000-0000-000000000004',
    conceptId: '00000000-0000-0000-0000-000000000005',
    actionType: 'save',
    subjectCode: 'science',
    chapterNumber: 4,
  },
} as DomainEvent;

describe('GUARD #3 — no mastery subscriber for learner.learning_action', () => {
  it('the production dispatcher registers ZERO subscribers for learner.learning_action', () => {
    const subs = standardDispatcher.subscribersFor('learner.learning_action');
    expect(subs).toHaveLength(0);
  });

  it('no STANDARD_SUBSCRIBER listens to learner.learning_action', () => {
    const listeners = STANDARD_SUBSCRIBERS.filter((s) => s.kind === 'learner.learning_action');
    expect(listeners).toEqual([]);
  });

  it('dispatching a learner.learning_action event is skipped (_none_) — no subscriber runs, no write possible', async () => {
    // A Supabase client that THROWS on any .from(...) — proves nothing tries to
    // touch the DB when a learning_action is dispatched.
    const explodingSb = {
      from: () => {
        throw new Error('no subscriber should ever touch the DB for learner.learning_action');
      },
      rpc: () => {
        throw new Error('no subscriber should ever RPC for learner.learning_action');
      },
    };
    const outcomes = await standardDispatcher.handleEvent(learningActionEvent, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sb: explodingSb as any,
      dryRun: false,
      now: () => new Date('2026-06-14T12:00:00.000Z'),
      log: vi.fn(),
    });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe('skipped');
    expect(outcomes[0].subscriber).toBe('_none_');
  });

  it('the concept-mastery-projector (writer of concept_mastery) is bound to concept_check_answered ONLY', () => {
    expect(conceptMasteryProjector.kind).toBe('learner.concept_check_answered');
    // It is NOT a learning_action subscriber, so the dispatcher can never route a
    // learning_action event to it.
    expect(conceptMasteryProjector.kind).not.toBe('learner.learning_action');
  });
});

describe('GUARD #3b — journey projector returns null for learner.learning_action (no milestone)', () => {
  it('projectJourney drops learner.learning_action (never a mastery-moving milestone)', () => {
    const out = projectJourney([learningActionEvent]);
    expect(out).toEqual([]);
  });

  it('a learning_action mixed with a real quiz event leaves only the quiz card', () => {
    const quizEvent: DomainEvent = {
      ...BASE,
      eventId: '00000000-0000-0000-0000-0000000000aa',
      idempotencyKey: 'quiz:1',
      kind: 'learner.quiz_completed',
      payload: {
        quizSessionId: '00000000-0000-0000-0000-0000000000bb',
        subjectCode: 'math',
        chapterNumber: 1,
        questionCount: 10,
        correctCount: 7,
        durationSec: 300,
        xpEarned: 70,
      },
    } as DomainEvent;
    const out = projectJourney([learningActionEvent, quizEvent]);
    expect(out).toHaveLength(1);
    expect(out[0].sourceKind).toBe('learner.quiz_completed');
  });
});
