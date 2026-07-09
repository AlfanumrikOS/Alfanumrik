/**
 * Phase 2b tests for /api/learner/review/grade.
 *
 *   - Pure SM-2 step: parity with the legacy client implementation that
 *     used to live in src/app/review/page.tsx:163-185.
 *   - parseChapterNumber: extracts a positive int from a chapter_title.
 *   - coerceSource: maps DB source strings to the event's closed enum.
 *   - Event-shape contract: a synthetic event matching what the route
 *     publishes parses against the registry's schema.
 *
 * The route itself involves auth + DB + Supabase admin client which we
 * do NOT integration-test here (heavy mocking; Phase 4 will cover with
 * a staging smoke test). The pure pieces are the load-bearing logic.
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  applySm2,
  coerceSource,
  parseChapterNumber,
} from '../../../app/api/learner/review/grade/helpers';
import {
  DomainEventSchema,
  LearnerReviewGradedSchema,
} from '../../../lib/state/events/registry';

// ─── applySm2 — parity with legacy client SM-2 ───────────────────────

describe('applySm2', () => {
  it('quality 0 (forgot) — resets interval to 1, streak to 0', () => {
    const out = applySm2({ easeFactor: 2.5, intervalDays: 30, streak: 5, quality: 0 });
    expect(out.intervalDays).toBe(1);
    expect(out.streak).toBe(0);
  });

  it('quality 3 from streak 0 — interval 1, streak 1', () => {
    const out = applySm2({ easeFactor: 2.5, intervalDays: 1, streak: 0, quality: 3 });
    expect(out.intervalDays).toBe(1);
    expect(out.streak).toBe(1);
  });

  it('quality 4 from streak 1 — interval jumps to 6, streak 2', () => {
    const out = applySm2({ easeFactor: 2.5, intervalDays: 1, streak: 1, quality: 4 });
    expect(out.intervalDays).toBe(6);
    expect(out.streak).toBe(2);
  });

  it('quality 5 from streak 2 — interval = round(prev * newEase)', () => {
    const out = applySm2({ easeFactor: 2.5, intervalDays: 6, streak: 2, quality: 5 });
    // newEase for q=5 from 2.5: 2.5 + (0.1 - 0) = 2.6 → round(6 * 2.6) = 16
    expect(out.easeFactor).toBeCloseTo(2.6);
    expect(out.intervalDays).toBe(16);
    expect(out.streak).toBe(3);
  });

  it('ease floor is 1.3', () => {
    // After many forgots from low ease — should clamp at 1.3.
    const out = applySm2({ easeFactor: 1.3, intervalDays: 1, streak: 0, quality: 0 });
    // newEase = 1.3 + (0.1 - 5*(0.08 + 5*0.02)) = 1.3 + (0.1 - 5*0.18)
    //        = 1.3 + 0.1 - 0.9 = 0.5 → clamp to 1.3
    expect(out.easeFactor).toBe(1.3);
  });

  it('ease ceiling is 3.0', () => {
    // Quality 5 + already-high ease should clamp at 3.0.
    const out = applySm2({ easeFactor: 3.0, intervalDays: 100, streak: 50, quality: 5 });
    // newEase = 3.0 + 0.1 = 3.1 → clamp to 3.0
    expect(out.easeFactor).toBe(3.0);
  });

  it('interval cap is 365 days', () => {
    const out = applySm2({ easeFactor: 3.0, intervalDays: 200, streak: 10, quality: 5 });
    // round(200 * newEase) would be 620+ → clamp to 365
    expect(out.intervalDays).toBe(365);
  });

  it('streak cap is 100', () => {
    const out = applySm2({ easeFactor: 2.5, intervalDays: 30, streak: 100, quality: 4 });
    expect(out.streak).toBe(100);
  });

  it('quality 4 does NOT change interval back to 1 when streak > 1', () => {
    // Regression guard: the legacy code only special-cased streak 0 and 1.
    const out = applySm2({ easeFactor: 2.5, intervalDays: 30, streak: 3, quality: 4 });
    expect(out.intervalDays).not.toBe(1);
    expect(out.intervalDays).toBe(Math.round(30 * out.easeFactor));
  });
});

// ─── coerceSource — DB string → event enum ───────────────────────────

describe('coerceSource', () => {
  it('passes the three known values through unchanged', () => {
    expect(coerceSource('quiz_wrong_answer')).toBe('quiz_wrong_answer');
    expect(coerceSource('foxy_chat')).toBe('foxy_chat');
    expect(coerceSource('study_plan')).toBe('study_plan');
  });

  it('null falls back to study_plan', () => {
    expect(coerceSource(null)).toBe('study_plan');
  });

  it('unknown values fall back to study_plan', () => {
    expect(coerceSource('made_up')).toBe('study_plan');
    expect(coerceSource('')).toBe('study_plan');
  });
});

// ─── parseChapterNumber — chapter title → number or null ─────────────

describe('parseChapterNumber', () => {
  it('extracts a leading digit from a chapter-prefixed title', () => {
    expect(parseChapterNumber('Chapter 5: Light')).toBe(5);
    expect(parseChapterNumber('chapter 12 - Motion')).toBe(12);
  });

  it('extracts a digit from "N. Title" form', () => {
    expect(parseChapterNumber('5. Light')).toBe(5);
  });

  it('extracts a bare leading number', () => {
    expect(parseChapterNumber('7')).toBe(7);
  });

  it('returns null when no number is present', () => {
    expect(parseChapterNumber('Light and Sound')).toBeNull();
    expect(parseChapterNumber('')).toBeNull();
    expect(parseChapterNumber(null)).toBeNull();
  });

  it('rejects zero and negative', () => {
    expect(parseChapterNumber('Chapter 0')).toBeNull();
  });

  it('caps at 3 digits — anything past 999 is data corruption', () => {
    expect(parseChapterNumber('Chapter 9999: Foo')).toBe(999);
  });
});

// ─── Event shape contract — what the route publishes ─────────────────

describe('learner.review_graded — event shape published by /api/learner/review/grade', () => {
  function buildEvent(opts: {
    cardId: string;
    authUserId: string;
    schoolId: string | null;
    subjectCode: string;
    chapterNumber: number;
    quality: 0 | 3 | 4 | 5;
    source: 'quiz_wrong_answer' | 'foxy_chat' | 'study_plan';
    previousIntervalDays: number;
    totalReviewsAfterGrade: number;
  }) {
    return {
      kind: 'learner.review_graded' as const,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorAuthUserId: opts.authUserId,
      tenantId: opts.schoolId,
      idempotencyKey: `review_graded:${opts.cardId}:${opts.totalReviewsAfterGrade}`,
      payload: {
        cardId: opts.cardId,
        subjectCode: opts.subjectCode,
        chapterNumber: opts.chapterNumber,
        quality: opts.quality,
        source: opts.source,
        previousIntervalDays: opts.previousIntervalDays,
      },
    };
  }

  it('parses against the DomainEventSchema discriminated union', () => {
    const event = buildEvent({
      cardId: '11111111-1111-1111-1111-111111111111',
      authUserId: '22222222-2222-2222-2222-222222222222',
      schoolId: '33333333-3333-3333-3333-333333333333',
      subjectCode: 'science',
      chapterNumber: 7,
      quality: 4,
      source: 'quiz_wrong_answer',
      previousIntervalDays: 6,
      totalReviewsAfterGrade: 3,
    });
    expect(() => DomainEventSchema.parse(event)).not.toThrow();
  });

  it('parses against the specific LearnerReviewGradedSchema', () => {
    const event = buildEvent({
      cardId: '11111111-1111-1111-1111-111111111111',
      authUserId: '22222222-2222-2222-2222-222222222222',
      schoolId: null,
      subjectCode: 'math',
      chapterNumber: 1,
      quality: 5,
      source: 'study_plan',
      previousIntervalDays: 1,
      totalReviewsAfterGrade: 1,
    });
    expect(() => LearnerReviewGradedSchema.parse(event)).not.toThrow();
  });

  it('idempotencyKey is per-card per-attempt — grading the same card twice produces two events', () => {
    const first = buildEvent({
      cardId: '11111111-1111-1111-1111-111111111111',
      authUserId: '22222222-2222-2222-2222-222222222222',
      schoolId: null,
      subjectCode: 'math',
      chapterNumber: 1,
      quality: 4,
      source: 'study_plan',
      previousIntervalDays: 1,
      totalReviewsAfterGrade: 1,
    });
    const second = buildEvent({
      cardId: '11111111-1111-1111-1111-111111111111', // same card
      authUserId: '22222222-2222-2222-2222-222222222222',
      schoolId: null,
      subjectCode: 'math',
      chapterNumber: 1,
      quality: 4,
      source: 'study_plan',
      previousIntervalDays: 6,
      totalReviewsAfterGrade: 2, // second attempt
    });
    // Different total_reviews count → different key → both publish (correct;
    // SRS grades a card many times over its lifetime). Intra-attempt
    // double-fires are blocked by the route's reviewedCardIds set + the
    // server's idempotency_key UNIQUE (when total_reviews matches exactly).
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
  });
});
