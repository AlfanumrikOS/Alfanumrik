/**
 * Tests for pickActionForToday — the pure precedence logic backing
 * useLearnerActionForToday. The fetcher itself does I/O but the
 * branching decision is pure: scheduled wins when it has slots, else
 * fall through to /api/learner/next, else null.
 */

import { describe, it, expect } from 'vitest';
import {
  pickActionForToday,
  type LearnerNextResponse,
} from '../../../lib/swr';

const SAMPLE_ACTION: LearnerNextResponse['action'] = {
  kind: 'review_due_cards',
  url: '/review',
  reason: 'reviews_stacking',
  dueCount: 6,
};

const SAMPLE_ACTION_2: LearnerNextResponse['action'] = {
  kind: 'continue_lesson',
  url: '/learn/science/4',
  reason: 'in_progress_lesson',
  subjectCode: 'science',
  chapterNumber: 4,
  progressPct: 0.62,
};

function mkScheduled(slots: Array<{ action: LearnerNextResponse['action'] }>) {
  return {
    schemaVersion: 1 as const,
    horizon: 'daily' as const,
    dayBucket: '2026-05-12',
    slots: slots.map((s, i) => ({
      rank: i,
      actionKind: s.action.kind,
      action: s.action,
      source: 'scheduler' as const,
      generatedAt: '2026-05-12T00:00:00.000Z',
      expiresAt: '2026-05-13T00:00:00.000Z',
      completedAt: null,
    })),
  };
}

function mkNext(action: LearnerNextResponse['action']): LearnerNextResponse {
  return {
    schemaVersion: 1,
    resolvedAt: '2026-05-12T12:00:00.000Z',
    action,
    meta: { branch: action.kind, cached: false },
  };
}

describe('pickActionForToday', () => {
  it('scheduled wins when it has a slot — source=scheduled', () => {
    const sched = mkScheduled([{ action: SAMPLE_ACTION }]);
    const next = mkNext(SAMPLE_ACTION_2); // different action
    const picked = pickActionForToday(sched, next);
    expect(picked).not.toBeNull();
    expect(picked!.action.kind).toBe('review_due_cards');
    expect(picked!.source).toBe('scheduled');
  });

  it('falls back to /next when scheduled is null (404/error)', () => {
    const picked = pickActionForToday(null, mkNext(SAMPLE_ACTION_2));
    expect(picked).not.toBeNull();
    expect(picked!.action.kind).toBe('continue_lesson');
    expect(picked!.source).toBe('next');
  });

  it('falls back to /next when scheduled has empty slots', () => {
    const sched = mkScheduled([]);
    const picked = pickActionForToday(sched, mkNext(SAMPLE_ACTION_2));
    expect(picked).not.toBeNull();
    expect(picked!.source).toBe('next');
  });

  it('returns null when BOTH endpoints return nothing (flags off path)', () => {
    expect(pickActionForToday(null, null)).toBeNull();
  });

  it('returns null when scheduled empty AND next missing', () => {
    expect(pickActionForToday(mkScheduled([]), null)).toBeNull();
  });

  it('uses slot rank=0 when scheduled has multiple slots', () => {
    const sched = mkScheduled([
      { action: SAMPLE_ACTION },     // rank 0
      { action: SAMPLE_ACTION_2 },   // rank 1
    ]);
    const picked = pickActionForToday(sched, null);
    expect(picked!.action.kind).toBe('review_due_cards'); // rank 0 wins
  });

  it('returns the action verbatim from scheduled (no transformation)', () => {
    const sched = mkScheduled([{ action: SAMPLE_ACTION }]);
    const picked = pickActionForToday(sched, null);
    expect(picked!.action).toEqual(SAMPLE_ACTION);
  });

  it('passes through next.action verbatim when scheduled empty', () => {
    const picked = pickActionForToday(mkScheduled([]), mkNext(SAMPLE_ACTION_2));
    expect(picked!.action).toEqual(SAMPLE_ACTION_2);
  });

  it('scheduled with malformed shape (no slots array) → fall back', () => {
    // Defensive: a server response missing `slots` shouldn't throw.
    const malformed = {
      schemaVersion: 1 as const,
      horizon: 'daily' as const,
      dayBucket: '2026-05-12',
      slots: undefined as unknown as never[],
    };
    const picked = pickActionForToday(
      malformed as unknown as ReturnType<typeof mkScheduled>,
      mkNext(SAMPLE_ACTION_2),
    );
    expect(picked!.source).toBe('next');
  });
});
