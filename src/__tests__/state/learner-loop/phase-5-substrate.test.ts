/**
 * Phase 5 tests:
 *   - weakTopicsForStudent() — pure weak-topic filter + sort.
 *   - buildFlashcardPayload() — pure scan → spaced_repetition_cards
 *     row mapping.
 *
 * Both are exported pure functions; testing them lets us pin Compete's
 * personalisation logic AND the scan-to-queue card shape without
 * standing up the routes.
 */

import { describe, it, expect } from 'vitest';
import {
  weakTopicsForStudent,
  type WeakTopic,
} from '../../../lib/state/learner-loop/weak-topics';
import { buildFlashcardPayload } from '../../../app/api/learner/queue-from-scan/route';
import type { StudentState } from '../../../lib/state/student-state';

// ─── Fixture ─────────────────────────────────────────────────────────

function makeState(overrides: Partial<StudentState> = {}): StudentState {
  const base: StudentState = {
    schemaVersion: 1,
    builtAt: '2026-05-12T10:00:00.000Z',
    authUserId: '11111111-1111-1111-1111-111111111111',
    studentId: '22222222-2222-2222-2222-222222222222',
    displayName: 'Test',
    grade: '8',
    board: 'CBSE',
    language: 'en',
    tenant: { tenantId: null, tenantType: 'b2c', enabledModules: [], aiPersonality: null },
    access: {
      planSlug: 'free', isTrialing: false, trialEndsAt: null,
      usageThisMonth: { foxyMinutes: 0, quizSessions: 0 },
    },
    consent: { isMinor: true, parentLinkVerified: true, analyticsConsent: true },
    mastery: [],
    engagement: {
      currentStreakDays: 0, longestStreakDays: 0, lastActiveAt: null,
      totalTimeOnTaskSec: 0, xpBalance: 0,
    },
    live: { kind: 'idle' },
    classroomId: null,
    parentIds: [],
  };
  return { ...base, ...overrides };
}

// ─── weakTopicsForStudent ────────────────────────────────────────────

describe('weakTopicsForStudent', () => {
  it('returns empty when no mastery signals exist', () => {
    expect(weakTopicsForStudent(makeState())).toEqual([]);
  });

  it('skips unexplored topics (mastery === null)', () => {
    const state = makeState({
      mastery: [
        {
          subjectCode: 'math',
          meanMastery: null,
          chapters: [
            { chapterNumber: 1, mastery: null, lastUpdatedAt: null, attempts: 0 },
          ],
        },
      ],
    });
    expect(weakTopicsForStudent(state)).toEqual([]);
  });

  it('skips topics with mastery >= weakBelow threshold (default 0.6)', () => {
    const state = makeState({
      mastery: [
        {
          subjectCode: 'math',
          meanMastery: 0.7,
          chapters: [
            { chapterNumber: 1, mastery: 0.7, lastUpdatedAt: '2026-05-10T00:00:00.000Z', attempts: 5 },
            { chapterNumber: 2, mastery: 0.6, lastUpdatedAt: '2026-05-10T00:00:00.000Z', attempts: 5 }, // boundary
          ],
        },
      ],
    });
    expect(weakTopicsForStudent(state)).toEqual([]);
  });

  it('skips topics with attempts < minAttempts (default 1)', () => {
    const state = makeState({
      mastery: [
        {
          subjectCode: 'math',
          meanMastery: 0.3,
          chapters: [
            { chapterNumber: 1, mastery: 0.3, lastUpdatedAt: '2026-05-10T00:00:00.000Z', attempts: 0 },
          ],
        },
      ],
    });
    expect(weakTopicsForStudent(state)).toEqual([]);
  });

  it('returns sorted by mastery ASC, then attempts DESC for ties', () => {
    const state = makeState({
      mastery: [
        {
          subjectCode: 'math',
          meanMastery: 0.3,
          chapters: [
            { chapterNumber: 1, mastery: 0.3, lastUpdatedAt: '2026-05-10T00:00:00.000Z', attempts: 5 },
            { chapterNumber: 2, mastery: 0.1, lastUpdatedAt: '2026-05-10T00:00:00.000Z', attempts: 10 },
            { chapterNumber: 3, mastery: 0.3, lastUpdatedAt: '2026-05-10T00:00:00.000Z', attempts: 20 },
          ],
        },
      ],
    });
    const out = weakTopicsForStudent(state);
    expect(out.map(t => t.chapterNumber)).toEqual([2, 3, 1]);
    // ch 2 (mastery 0.1) first
    // tie at 0.3: ch 3 (attempts 20) ahead of ch 1 (attempts 5)
  });

  it('crosses subjects in a single sorted list', () => {
    const state = makeState({
      mastery: [
        {
          subjectCode: 'math',
          meanMastery: 0.5,
          chapters: [
            { chapterNumber: 1, mastery: 0.5, lastUpdatedAt: '2026-05-10T00:00:00.000Z', attempts: 5 },
          ],
        },
        {
          subjectCode: 'science',
          meanMastery: 0.2,
          chapters: [
            { chapterNumber: 7, mastery: 0.2, lastUpdatedAt: '2026-05-10T00:00:00.000Z', attempts: 5 },
          ],
        },
      ],
    });
    const out = weakTopicsForStudent(state);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ subjectCode: 'science', chapterNumber: 7 });
    expect(out[1]).toMatchObject({ subjectCode: 'math', chapterNumber: 1 });
  });

  it('respects limit option', () => {
    const chapters = Array.from({ length: 20 }, (_, i) => ({
      chapterNumber: i + 1,
      mastery: 0.1 + i * 0.02, // 0.10, 0.12, 0.14, ... — all weak
      lastUpdatedAt: '2026-05-10T00:00:00.000Z',
      attempts: 5,
    }));
    const state = makeState({
      mastery: [{ subjectCode: 'math', meanMastery: 0.3, chapters }],
    });
    expect(weakTopicsForStudent(state, { limit: 5 })).toHaveLength(5);
    expect(weakTopicsForStudent(state, { limit: 100 })).toHaveLength(20);
  });

  it('respects weakBelow override', () => {
    const state = makeState({
      mastery: [
        {
          subjectCode: 'math',
          meanMastery: 0.7,
          chapters: [
            { chapterNumber: 1, mastery: 0.7, lastUpdatedAt: '2026-05-10T00:00:00.000Z', attempts: 5 },
          ],
        },
      ],
    });
    expect(weakTopicsForStudent(state, { weakBelow: 0.8 })).toHaveLength(1);
  });

  it('respects minAttempts override', () => {
    const state = makeState({
      mastery: [
        {
          subjectCode: 'math',
          meanMastery: 0.3,
          chapters: [
            { chapterNumber: 1, mastery: 0.3, lastUpdatedAt: '2026-05-10T00:00:00.000Z', attempts: 1 },
            { chapterNumber: 2, mastery: 0.3, lastUpdatedAt: '2026-05-10T00:00:00.000Z', attempts: 5 },
          ],
        },
      ],
    });
    expect(weakTopicsForStudent(state, { minAttempts: 3 })).toHaveLength(1);
    expect(weakTopicsForStudent(state, { minAttempts: 3 })[0].chapterNumber).toBe(2);
  });
});

// ─── buildFlashcardPayload ───────────────────────────────────────────

describe('buildFlashcardPayload', () => {
  const SCAN_ID = '11111111-1111-1111-1111-111111111111';
  const STUDENT_ID = '22222222-2222-2222-2222-222222222222';

  it('builds a complete row from a happy-path scan', () => {
    const payload = buildFlashcardPayload({
      scanId: SCAN_ID,
      studentId: STUDENT_ID,
      extractedText: 'What is the derivative of x^2?',
      subject: 'Math',
      grade: '11',
    });
    expect(payload.student_id).toBe(STUDENT_ID);
    expect(payload.card_type).toBe('scan_question');
    expect(payload.subject).toBe('math'); // lowercased
    expect(payload.grade).toBe('11');
    expect(payload.front_text).toBe('What is the derivative of x^2?');
    expect(payload.back_text).toBe('(Solve to reveal the answer)');
    expect(payload.source).toBe('scan');
    expect(payload.source_id).toBe(SCAN_ID);
  });

  it('trims extracted_text', () => {
    const payload = buildFlashcardPayload({
      scanId: SCAN_ID,
      studentId: STUDENT_ID,
      extractedText: '   What is the derivative of x^2?   \n',
      subject: 'math',
      grade: '11',
    });
    expect(payload.front_text).toBe('What is the derivative of x^2?');
  });

  it('caps front_text at 1000 chars (defensive against OCR run-on)', () => {
    const longText = 'A'.repeat(2500);
    const payload = buildFlashcardPayload({
      scanId: SCAN_ID,
      studentId: STUDENT_ID,
      extractedText: longText,
      subject: 'math',
      grade: '11',
    });
    expect(payload.front_text.length).toBe(1000);
  });

  it("defaults subject to 'general' when student has no preferred_subject", () => {
    const payload = buildFlashcardPayload({
      scanId: SCAN_ID,
      studentId: STUDENT_ID,
      extractedText: 'Q',
      subject: null,
      grade: '11',
    });
    expect(payload.subject).toBe('general');
  });

  it("defaults grade to '0' when student has no grade (B2C path)", () => {
    const payload = buildFlashcardPayload({
      scanId: SCAN_ID,
      studentId: STUDENT_ID,
      extractedText: 'Q',
      subject: 'math',
      grade: null,
    });
    expect(payload.grade).toBe('0');
  });

  it('lowercases subject (consistent with the rest of the Loop)', () => {
    const payload = buildFlashcardPayload({
      scanId: SCAN_ID,
      studentId: STUDENT_ID,
      extractedText: 'Q',
      subject: 'PHYSICS',
      grade: '11',
    });
    expect(payload.subject).toBe('physics');
  });
});

// ─── WeakTopic shape pin ─────────────────────────────────────────────

describe('WeakTopic shape contract', () => {
  it('every returned row carries the documented fields', () => {
    const state = makeState({
      mastery: [
        {
          subjectCode: 'math',
          meanMastery: 0.3,
          chapters: [
            { chapterNumber: 1, mastery: 0.3, lastUpdatedAt: '2026-05-10T00:00:00.000Z', attempts: 5 },
          ],
        },
      ],
    });
    const out: WeakTopic[] = weakTopicsForStudent(state);
    expect(out[0]).toEqual({
      subjectCode: 'math',
      chapterNumber: 1,
      mastery: 0.3,
      attempts: 5,
      lastUpdatedAt: '2026-05-10T00:00:00.000Z',
    });
  });

  it('lastUpdatedAt can be null without breaking sort', () => {
    const state = makeState({
      mastery: [
        {
          subjectCode: 'math',
          meanMastery: 0.3,
          chapters: [
            { chapterNumber: 1, mastery: 0.3, lastUpdatedAt: null, attempts: 5 },
          ],
        },
      ],
    });
    const out = weakTopicsForStudent(state);
    expect(out).toHaveLength(1);
    expect(out[0].lastUpdatedAt).toBeNull();
  });
});
