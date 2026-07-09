/**
 * Phase 2c tests for /api/learner/lesson/progress.
 *
 *   - shouldPublishLessonCompleted: pure transition-detection logic. The
 *     event must fire exactly once per first completion — never on
 *     subsequent activity touches.
 *   - computeDurationSec: bounded duration computation from an optional
 *     client-supplied startedAt. Floors at 0, caps at 6h.
 *   - Event-shape contract: a synthetic learner.lesson_completed event
 *     matching what the route publishes parses against the registry.
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  shouldPublishLessonCompleted,
  computeDurationSec,
} from '../../../app/api/learner/lesson/progress/helpers';
import {
  DomainEventSchema,
  LearnerLessonCompletedSchema,
} from '../../../lib/state/events/registry';

// ─── shouldPublishLessonCompleted ────────────────────────────────────

describe('shouldPublishLessonCompleted', () => {
  const completed = { id: 'a', is_completed: true, completed_at: '2026-05-12T10:00:00.000Z' };
  const incomplete = { id: 'a', is_completed: false, completed_at: null };

  it('publishes on first-ever completion (before missing, after completed)', () => {
    expect(shouldPublishLessonCompleted(null, completed)).toBe(true);
  });

  it('publishes on transition (before incomplete, after completed)', () => {
    expect(shouldPublishLessonCompleted(incomplete, completed)).toBe(true);
  });

  it('does NOT publish on continued completion (before completed, after completed)', () => {
    expect(shouldPublishLessonCompleted(completed, completed)).toBe(false);
  });

  it('does NOT publish on partial activity (after still incomplete)', () => {
    expect(shouldPublishLessonCompleted(incomplete, incomplete)).toBe(false);
  });

  it('does NOT publish when after is missing (RPC returned without inserting — invalid chapter_number)', () => {
    expect(shouldPublishLessonCompleted(null, null)).toBe(false);
    expect(shouldPublishLessonCompleted(incomplete, null)).toBe(false);
  });

  it('does NOT publish when is_completed is null (defensive)', () => {
    const nullCompleted = { id: 'a', is_completed: null, completed_at: null };
    expect(shouldPublishLessonCompleted(null, nullCompleted)).toBe(false);
    expect(shouldPublishLessonCompleted(incomplete, nullCompleted)).toBe(false);
  });
});

// ─── computeDurationSec ──────────────────────────────────────────────

describe('computeDurationSec', () => {
  const now = new Date('2026-05-12T10:30:00.000Z');

  it('returns 0 when startedAt is undefined', () => {
    expect(computeDurationSec(undefined, now)).toBe(0);
  });

  it('returns 0 when startedAt is malformed', () => {
    expect(computeDurationSec('not-a-date', now)).toBe(0);
  });

  it('computes seconds between startedAt and now', () => {
    expect(computeDurationSec('2026-05-12T10:00:00.000Z', now)).toBe(1800);
  });

  it('floors at 0 when startedAt is in the future (clock skew defense)', () => {
    expect(computeDurationSec('2026-05-12T11:00:00.000Z', now)).toBe(0);
  });

  it('caps at 6 hours (paused-tab carryover defense)', () => {
    const veryEarly = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
    expect(computeDurationSec(veryEarly, now)).toBe(6 * 60 * 60);
  });

  it('handles fractional seconds by rounding', () => {
    // 30.4s → 30
    const startedAt = new Date(now.getTime() - 30_400).toISOString();
    expect(computeDurationSec(startedAt, now)).toBe(30);
  });
});

// ─── Event shape contract ────────────────────────────────────────────

describe('learner.lesson_completed — event shape published by /api/learner/lesson/progress', () => {
  function buildEvent(opts: {
    progressId: string;
    authUserId: string;
    schoolId: string | null;
    subjectCode: string;
    chapterNumber: number;
    durationSec: number;
  }) {
    return {
      kind: 'learner.lesson_completed' as const,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorAuthUserId: opts.authUserId,
      tenantId: opts.schoolId,
      idempotencyKey: `lesson_completed:${opts.progressId}`,
      payload: {
        lessonId: opts.progressId,
        subjectCode: opts.subjectCode,
        chapterNumber: opts.chapterNumber,
        durationSec: opts.durationSec,
      },
    };
  }

  it('parses against DomainEventSchema', () => {
    const event = buildEvent({
      progressId: '11111111-1111-1111-1111-111111111111',
      authUserId: '22222222-2222-2222-2222-222222222222',
      schoolId: '33333333-3333-3333-3333-333333333333',
      subjectCode: 'science',
      chapterNumber: 7,
      durationSec: 1200,
    });
    expect(() => DomainEventSchema.parse(event)).not.toThrow();
  });

  it('parses against the specific LearnerLessonCompletedSchema', () => {
    const event = buildEvent({
      progressId: '11111111-1111-1111-1111-111111111111',
      authUserId: '22222222-2222-2222-2222-222222222222',
      schoolId: null,
      subjectCode: 'math',
      chapterNumber: 1,
      durationSec: 0,
    });
    expect(() => LearnerLessonCompletedSchema.parse(event)).not.toThrow();
  });

  it('idempotencyKey is per-progress-row (stable across retries of the same completion)', () => {
    const a = buildEvent({
      progressId: '11111111-1111-1111-1111-111111111111',
      authUserId: '22222222-2222-2222-2222-222222222222',
      schoolId: null,
      subjectCode: 'math',
      chapterNumber: 1,
      durationSec: 0,
    });
    const b = buildEvent({
      progressId: '11111111-1111-1111-1111-111111111111', // same progress row
      authUserId: '99999999-9999-9999-9999-999999999999', // different fields
      schoolId: '44444444-4444-4444-4444-444444444444',
      subjectCode: 'science',
      chapterNumber: 2,
      durationSec: 9999,
    });
    expect(a.idempotencyKey).toBe(b.idempotencyKey);
    expect(a.idempotencyKey).toBe('lesson_completed:11111111-1111-1111-1111-111111111111');
  });

  it('rejects negative durationSec at the schema boundary', () => {
    const event = buildEvent({
      progressId: '11111111-1111-1111-1111-111111111111',
      authUserId: '22222222-2222-2222-2222-222222222222',
      schoolId: null,
      subjectCode: 'math',
      chapterNumber: 1,
      durationSec: -5,
    });
    expect(() => DomainEventSchema.parse(event)).toThrow();
  });

  it('rejects chapterNumber 0 at the schema boundary', () => {
    const event = buildEvent({
      progressId: '11111111-1111-1111-1111-111111111111',
      authUserId: '22222222-2222-2222-2222-222222222222',
      schoolId: null,
      subjectCode: 'math',
      chapterNumber: 0,
      durationSec: 60,
    });
    expect(() => DomainEventSchema.parse(event)).toThrow();
  });
});
