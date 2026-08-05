/**
 * src/lib/state/services/quiz-completion-service.ts — the template
 * Service implementation.
 *
 * Demonstrates the pattern every feature follows. When a learner
 * finishes a quiz, instead of:
 *
 *   - direct INSERT into mastery_state
 *   - direct enqueue of parent notification
 *   - direct increment of xp_ledger
 *   - direct write to PostHog
 *   - direct mark of the quiz_session row as completed
 *   - direct update of streak counter
 *
 * …which is what the legacy code does in scattered places, the quiz
 * route now just calls this service. It:
 *
 *   1. Reads current StudentState
 *   2. Computes the BKT mastery delta
 *   3. Computes XP earned
 *   4. Returns a typed Output + a list of DomainEvents
 *
 * The Orchestrator then:
 *   - publishes `learner.quiz_completed`
 *   - publishes `learner.mastery_changed` (one per chapter that moved)
 *   - the bus's subscribers do the rest (mastery_state writer, parent
 *     notifier, XP ledger, PostHog, teacher dashboard refresh)
 *
 * The legacy code paths can be retired one-by-one as their subscribers
 * are wired up.
 *
 * Tests in src/__tests__/state/services/quiz-completion-service.test.ts
 * pin the BKT math + the event shapes.
 */

import { randomUUID } from 'node:crypto';
import { bktPosterior, BKT_PARAMS } from '../../learner-model/bkt-mirror';
import type { DomainEvent } from '../events/registry';
import type { StudentState } from '../student-state';
import { pickSubjectMastery } from '../student-state';
import type { Service, ServiceArgs, ServiceResult } from './service';

export interface QuizCompletionInput {
  quizSessionId: string;
  subjectCode: string;
  chapterNumber: number;
  // Per-question outcome — the only fact the service needs as input.
  // (Question texts, options, RAG references all live in the quiz
  // engine; the state-side service only cares about the right/wrong
  // signal per question and per chapter.)
  questions: Array<{
    correct: boolean;
    timeSpentSec: number;
    /** If this question hit a chapter different from the quiz's primary
     *  chapter (cross-chapter probe), we still update that chapter's
     *  mastery. Optional — defaults to the quiz's chapter. */
    chapterNumberOverride?: number;
  }>;
  startedAt: string; // ISO
  endedAt: string;   // ISO
}

export interface QuizCompletionOutput {
  questionCount: number;
  correctCount: number;
  accuracy: number;       // [0,1]
  durationSec: number;
  xpEarned: number;
  /** Per-chapter mastery deltas this completion triggered. */
  masteryDeltas: Array<{
    chapterNumber: number;
    fromMastery: number | null;
    toMastery: number;
  }>;
}

// ── BKT parameters (Foxy North-Star Phase 2 wave 2b, tracker E1/E3) ─
//
// CONSOLIDATED: this service previously carried its own divergent BKT
// (prior 0.3, transition 0.1). It now uses the canonical learner-model
// facade — `bktPosterior` + `BKT_PARAMS` (`@alfanumrik/lib/learner-model`),
// the exact TS mirror of the `update_learner_state_post_quiz` SQL RPC
// (pLearn 0.2, pSlip 0.1, pGuess 0.25, priorInit 0.1).
// Behavior-neutral in prod: this service only runs behind ff_event_bus_v1
// (OFF → zero rows); its param-pinning tests were updated in the same PR.

// XP formula. Designed to be predictable and copy-paste-replicable in
// the parent-facing report. 5 XP per correct, capped at 60 per session.
function computeXp(correctCount: number): number {
  return Math.min(correctCount * 5, 60);
}

// ── The service ──────────────────────────────────────────────────────

export const quizCompletionService: Service<QuizCompletionInput, QuizCompletionOutput> = {
  name: 'quiz-completion',
  subscribesTo: [], // command-shaped — invoked by the quiz route, not by an event

  async run(
    args: ServiceArgs<QuizCompletionInput>,
  ): Promise<ServiceResult<QuizCompletionOutput>> {
    const { state, input, idempotencyKey } = args;
    const startMs = Date.parse(input.startedAt);
    const endMs = Date.parse(input.endedAt);
    const durationSec = Math.max(0, Math.round((endMs - startMs) / 1000));
    const correctCount = input.questions.filter(q => q.correct).length;
    const accuracy = input.questions.length === 0 ? 0 : correctCount / input.questions.length;
    const xpEarned = computeXp(correctCount);

    // Group questions by the chapter they probed.
    const byChapter = new Map<number, boolean[]>();
    for (const q of input.questions) {
      const ch = q.chapterNumberOverride ?? input.chapterNumber;
      if (!byChapter.has(ch)) byChapter.set(ch, []);
      byChapter.get(ch)!.push(q.correct);
    }

    // Build mastery deltas one chapter at a time, threading the BKT
    // prior through each question's outcome in order.
    const masteryDeltas: QuizCompletionOutput['masteryDeltas'] = [];
    const subject = pickSubjectMastery(state, input.subjectCode);
    for (const [chapterNumber, outcomes] of byChapter) {
      const priorChapter = subject?.chapters.find(c => c.chapterNumber === chapterNumber);
      const fromMastery = priorChapter?.mastery ?? null;
      let m = fromMastery ?? BKT_PARAMS.priorInit;
      for (const ok of outcomes) {
        m = bktPosterior(m, ok);
      }
      // Clamp to [0,1] in case of float drift.
      const toMastery = Math.max(0, Math.min(1, m));
      masteryDeltas.push({ chapterNumber, fromMastery, toMastery });
    }

    // Compose the events. The Orchestrator publishes them; this service
    // never calls publishEvent directly.
    const baseEnvelope = {
      occurredAt: input.endedAt,
      actorAuthUserId: state.authUserId,
      tenantId: state.tenant.tenantId,
    };

    const quizCompletedEvent: DomainEvent = {
      ...baseEnvelope,
      eventId: randomUUID(),
      kind: 'learner.quiz_completed',
      idempotencyKey: `quiz-completed:${input.quizSessionId}`,
      payload: {
        quizSessionId: input.quizSessionId,
        subjectCode: input.subjectCode,
        chapterNumber: input.chapterNumber,
        questionCount: input.questions.length,
        correctCount,
        durationSec,
        xpEarned,
      },
    };

    const masteryEvents: DomainEvent[] = masteryDeltas.map(d => ({
      ...baseEnvelope,
      eventId: randomUUID(),
      kind: 'learner.mastery_changed' as const,
      // One mastery event per chapter, deterministically keyed off the
      // quiz session so re-running this service for the same session
      // produces the same idempotency keys.
      idempotencyKey: `mastery-changed:${input.quizSessionId}:${d.chapterNumber}`,
      payload: {
        subjectCode: input.subjectCode,
        chapterNumber: d.chapterNumber,
        fromMastery: d.fromMastery,
        toMastery: d.toMastery,
        trigger: 'quiz' as const,
      },
    }));

    void idempotencyKey;

    return {
      output: {
        questionCount: input.questions.length,
        correctCount,
        accuracy,
        durationSec,
        xpEarned,
        masteryDeltas,
      },
      events: [quizCompletedEvent, ...masteryEvents],
      notes:
        `quiz-completion: ${correctCount}/${input.questions.length} correct, ` +
        `${xpEarned} XP, ${masteryDeltas.length} chapter(s) updated`,
    };
  },
};
