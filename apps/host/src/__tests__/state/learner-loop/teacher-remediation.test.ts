/**
 * Phase 3A Wave A / A3 — tests for the teacher-remediation branch + the
 * status-flip helpers.
 *
 * Pins (assessment-signed learner-state rules):
 *   (1) a pending teacher assignment (assigned|in_progress) surfaces as the
 *       HIGHEST-priority Today item, ahead of routine SRS/ZPD/reflection,
 *       tagged source:'teacher' + carrying the assignmentId;
 *   (2) it REUSES the existing quiz route; chapter-anchored when the assignment
 *       resolved a (subject, chapter), else falls back to the WEAKEST chapter
 *       (general remediation, chapter_id null);
 *   (1') no pending assignment → the queue is UNCHANGED (regression parity);
 *   (4) the status-flip helpers: surfacing → in_progress, completion → resolved
 *       (idempotent; never touch scoring/XP — they only move the lifecycle).
 *
 * NO scoring / XP / anti-cheat assertions here — those formulas are untouched.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  resolveNextLearnerAction,
  resolveTodayQueue,
  markTeacherRemediationInProgress,
  resolveTeacherRemediation,
  type LoopAugmentation,
  type PendingTeacherRemediation,
} from '../../../lib/state/learner-loop/resolve-next-action';
import type { StudentState, LiveSessionState } from '../../../lib/state/student-state';

// ── Fixtures (mirror today-queue.test.ts) ────────────────────────────

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
    pendingTeacherRemediation: null,
  };
}

const WEEKDAY_NOON_IST = new Date('2026-05-13T06:30:00.000Z'); // Wed 12:00 IST

const ASSIGN_ID = '99999999-9999-9999-9999-999999999999';
const CHAPTER_ID = '88888888-8888-8888-8888-888888888888';

// ── (1) highest-priority branch ──────────────────────────────────────

describe('teacher_remediation — highest-priority branch', () => {
  it('chapter-anchored assignment → top item, source:teacher, assignmentId, reused quiz route', () => {
    const pending: PendingTeacherRemediation = {
      assignmentId: ASSIGN_ID,
      chapterId: CHAPTER_ID,
      status: 'assigned',
      subjectCode: 'science',
      chapterNumber: 2,
    };
    const aug: LoopAugmentation = { ...emptyAugmentation(), pendingTeacherRemediation: pending };

    const raw = resolveNextLearnerAction(makeState(), aug, { now: WEEKDAY_NOON_IST });
    expect(raw.kind).toBe('teacher_remediation');

    const q = resolveTodayQueue(makeState(), aug, { now: WEEKDAY_NOON_IST });
    expect(q.primary.kind).toBe('teacher_remediation');
    expect(q.queue[0].kind).toBe('teacher_remediation');
    expect(q.branch).toBe('teacher_remediation');

    const top = q.queue[0];
    if (top.kind === 'teacher_remediation') {
      expect(top.source).toBe('teacher');
      expect(top.assignmentId).toBe(ASSIGN_ID);
      expect(top.chapterId).toBe(CHAPTER_ID);
      expect(top.reason).toBe('teacher_assigned');
      // Reuses the EXISTING quiz route — no new quiz type.
      expect(top.url.startsWith('/quiz?')).toBe(true);
      expect(top.url).toContain('subject=science');
      expect(top.url).toContain('chapter=2');
      expect(top.url).toContain(`remediationId=${ASSIGN_ID}`);
      expect(top.url).toContain('from=teacher');
    }
  });

  it('beats stacking SRS, ZPD, and even cold-start (a brand-new learner)', () => {
    // Cold-start learner (empty mastery) WITH stacking reviews on a fresh
    // account — teacher remediation still wins the CTA.
    const pending: PendingTeacherRemediation = {
      assignmentId: ASSIGN_ID,
      chapterId: CHAPTER_ID,
      status: 'assigned',
      subjectCode: 'math',
      chapterNumber: 5,
    };
    const aug: LoopAugmentation = {
      dueReviewCount: 30,
      attemptedQuizToday: false,
      inProgressLessons: [],
      pendingTeacherRemediation: pending,
    };
    const state = makeState({ mastery: [] }); // cold start

    const q = resolveTodayQueue(state, aug, { now: WEEKDAY_NOON_IST });
    expect(q.primary.kind).toBe('teacher_remediation');
    expect(q.queue[0].kind).toBe('teacher_remediation');
    // Cold-start may still follow as a secondary item, but it never leads.
    expect(q.queue[0].kind).not.toBe('cold_start_diagnostic');
  });

  it('general remediation (chapter_id null) falls back to the WEAKEST chapter', () => {
    const pending: PendingTeacherRemediation = {
      assignmentId: ASSIGN_ID,
      chapterId: null,
      status: 'assigned',
      // no subjectCode / chapterNumber → general remediation
    };
    const aug: LoopAugmentation = { ...emptyAugmentation(), pendingTeacherRemediation: pending };

    const q = resolveTodayQueue(makeState(), aug, { now: WEEKDAY_NOON_IST });
    const top = q.queue[0];
    expect(top.kind).toBe('teacher_remediation');
    if (top.kind === 'teacher_remediation') {
      expect(top.chapterId).toBeNull();
      // Weakest chapter in the fixture is science/3 (mastery 0.1).
      expect(top.subjectCode).toBe('science');
      expect(top.chapterNumber).toBe(3);
      expect(top.url).toContain('subject=science');
      expect(top.url).toContain('chapter=3');
      expect(top.assignmentId).toBe(ASSIGN_ID);
    }
  });

  it('still wins the queue CTA even when a live session is active (but live leads as resume)', () => {
    // Live session prepends resume as the CTA per the existing exception; the
    // teacher item must still appear as the top NON-resume branch.
    const live: LiveSessionState = {
      kind: 'in_quiz',
      quizSessionId: '55555555-5555-5555-5555-555555555555',
      subjectCode: 'science',
      chapterNumber: 1,
      startedAt: '2026-05-13T06:00:00.000Z',
      questionCount: 10,
      questionsAnswered: 2,
    };
    const pending: PendingTeacherRemediation = {
      assignmentId: ASSIGN_ID,
      chapterId: CHAPTER_ID,
      status: 'in_progress',
      subjectCode: 'science',
      chapterNumber: 2,
    };
    const aug: LoopAugmentation = { ...emptyAugmentation(), pendingTeacherRemediation: pending };
    const q = resolveTodayQueue(makeState({ live }), aug, { now: WEEKDAY_NOON_IST });
    expect(q.queue[0].kind).toBe('resume_in_progress');
    expect(q.queue[1].kind).toBe('teacher_remediation');
    // branch reports the raw resolver pick (teacher remediation).
    expect(q.branch).toBe('teacher_remediation');
  });
});

// ── (1') no assignment → queue unchanged (regression parity) ─────────

describe('teacher_remediation — absent ⇒ queue unchanged', () => {
  it('no pending assignment → primary/queue match the no-teacher resolver', () => {
    const augNone = emptyAugmentation();
    const augUndefined: LoopAugmentation = {
      dueReviewCount: 0,
      attemptedQuizToday: false,
      inProgressLessons: [],
      // pendingTeacherRemediation omitted entirely
    };

    for (const aug of [augNone, augUndefined]) {
      const raw = resolveNextLearnerAction(makeState(), aug, { now: WEEKDAY_NOON_IST });
      const q = resolveTodayQueue(makeState(), aug, { now: WEEKDAY_NOON_IST });
      // No teacher item anywhere.
      expect(q.queue.some(a => a.kind === 'teacher_remediation')).toBe(false);
      expect(raw.kind).not.toBe('teacher_remediation');
      // Primary equals the raw first-match (the pre-existing contract).
      expect(q.primary).toEqual(raw);
    }
  });
});

// ── (4) status-flip helpers ──────────────────────────────────────────

describe('markTeacherRemediationInProgress — assigned → in_progress', () => {
  it('updates the row guarded by status=assigned (idempotent for non-assigned)', async () => {
    const eqCalls: Array<[string, string]> = [];
    const update = vi.fn(() => {
      const chain = {
        eq: vi.fn((col: string, val: string) => {
          eqCalls.push([col, val]);
          // second .eq returns the resolved promise.
          if (eqCalls.length >= 2) return Promise.resolve({ error: null });
          return chain;
        }),
      };
      return chain;
    });
    const admin = { from: vi.fn(() => ({ update })) } as never;

    const ok = await markTeacherRemediationInProgress(admin, ASSIGN_ID);
    expect(ok).toBe(true);
    expect(update).toHaveBeenCalledWith({ status: 'in_progress' });
    expect(eqCalls).toContainEqual(['id', ASSIGN_ID]);
    expect(eqCalls).toContainEqual(['status', 'assigned']);
  });

  it('returns false (never throws) on a DB error', async () => {
    const chain = {
      eq: vi.fn(() => chain),
      then: undefined,
    } as never as Record<string, unknown>;
    // Build a chain whose terminal .eq resolves to an error.
    const errChain = {
      eq: vi.fn(function (this: unknown) {
        return { eq: vi.fn(() => Promise.resolve({ error: { message: 'boom' } })) };
      }),
    };
    void chain;
    const admin = { from: vi.fn(() => ({ update: vi.fn(() => errChain) })) } as never;
    const ok = await markTeacherRemediationInProgress(admin, ASSIGN_ID);
    expect(ok).toBe(false);
  });
});

describe('resolveTeacherRemediation — completion → resolved', () => {
  const STUDENT_ID = '22222222-2222-2222-2222-222222222222';

  function makeAdmin(opts: {
    existing: { id: string; status: string } | null;
    readErr?: { message: string } | null;
    updErr?: { message: string } | null;
    onUpdate?: (patch: Record<string, unknown>) => void;
  }) {
    const updateChain = {
      eq: vi.fn(function (this: unknown) {
        return {
          eq: vi.fn(() => ({
            in: vi.fn(() => Promise.resolve({ error: opts.updErr ?? null })),
          })),
        };
      }),
    };
    const selectChain = {
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() =>
            Promise.resolve({ data: opts.existing, error: opts.readErr ?? null }),
          ),
        })),
      })),
    };
    return {
      from: vi.fn(() => ({
        select: vi.fn(() => selectChain),
        update: vi.fn((patch: Record<string, unknown>) => {
          opts.onUpdate?.(patch);
          return updateChain;
        }),
      })),
    } as never;
  }

  it('flips an in_progress row to resolved (+ resolved_at)', async () => {
    let patch: Record<string, unknown> | null = null;
    const admin = makeAdmin({
      existing: { id: ASSIGN_ID, status: 'in_progress' },
      onUpdate: (p) => { patch = p; },
    });
    const res = await resolveTeacherRemediation(admin, ASSIGN_ID, STUDENT_ID);
    expect(res).toEqual({ ok: true, alreadyResolved: false });
    expect(patch).not.toBeNull();
    expect((patch as unknown as Record<string, unknown>).status).toBe('resolved');
    expect(typeof (patch as unknown as Record<string, unknown>).resolved_at).toBe('string');
  });

  it('flips an assigned row to resolved (completion before surfacing flip landed)', async () => {
    const admin = makeAdmin({ existing: { id: ASSIGN_ID, status: 'assigned' } });
    const res = await resolveTeacherRemediation(admin, ASSIGN_ID, STUDENT_ID);
    expect(res.ok).toBe(true);
    expect(res.alreadyResolved).toBe(false);
  });

  it('already-resolved → idempotent success (no second write)', async () => {
    let updateCalled = false;
    const admin = makeAdmin({
      existing: { id: ASSIGN_ID, status: 'resolved' },
      onUpdate: () => { updateCalled = true; },
    });
    const res = await resolveTeacherRemediation(admin, ASSIGN_ID, STUDENT_ID);
    expect(res).toEqual({ ok: true, alreadyResolved: true });
    expect(updateCalled).toBe(false);
  });

  it('unknown id for this student → notFound', async () => {
    const admin = makeAdmin({ existing: null });
    const res = await resolveTeacherRemediation(admin, ASSIGN_ID, STUDENT_ID);
    expect(res).toEqual({ ok: false, notFound: true });
  });

  it('read error → ok:false (never throws)', async () => {
    const admin = makeAdmin({ existing: null, readErr: { message: 'db down' } });
    const res = await resolveTeacherRemediation(admin, ASSIGN_ID, STUDENT_ID);
    expect(res).toEqual({ ok: false });
  });
});
