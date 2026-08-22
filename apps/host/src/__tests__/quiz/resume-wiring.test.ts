/**
 * Quiz RESUME — end-to-end wiring pins.
 *
 * These are the seams that make "refresh and interruption preserve
 * recoverable session progress" true rather than merely implemented:
 *
 *   1. The Today CTA emits a RESUMABLE deep link (`/quiz?session=<id>`), not
 *      a bare `/quiz` that lands on the setup screen and starts over. The
 *      session id also survives `mapActionToTodayItem`'s URL → DTO parse.
 *   2. `/quiz` HONOURS that link — and honours `?mode=practice`, which had no
 *      branch at all and silently fell through to `cognitive`, making Screen
 *      07 Practice unreachable from every deep link that emits it.
 *   3. NO DOUBLE SUBMISSION / NO DOUBLE XP: `submitQuizResults` passes the
 *      server session id as `p_idempotency_key`, so `quiz_sessions`' partial
 *      unique index on (student_id, idempotency_key) makes one graded
 *      submission per session an invariant the SERVER enforces — not the
 *      in-memory `_quizDedup` Set, which a refresh (the exact event resume
 *      exists to survive) wipes.
 *   4. Every confirmed answer is persisted immediately on EVERY mode, with no
 *      feature flag in the way — the `check_quiz_answer()` writer is gated
 *      behind `ff_quiz_v2` + `mode === 'practice'` and therefore dark.
 *
 * (2) and (4) are asserted against page source. The quiz page is a 2.6k-line
 * client component whose full render needs the entire auth/SWR/Supabase
 * stack; a source-level pin is the honest way to keep these one-line seams
 * from silently regressing, and it is the same technique
 * `auth-flows.test.ts` already uses for redirect targets.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  resolveNextLearnerAction,
  resolveTodayQueue,
  type LoopAugmentation,
} from '@alfanumrik/lib/state/learner-loop/resolve-next-action';
import { mapActionToTodayItem } from '@alfanumrik/lib/today/map-action';
import type { StudentState, LiveSessionState } from '@alfanumrik/lib/state/student-state';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const QUIZ_PAGE = join(
  REPO_ROOT,
  'apps',
  'host',
  'src',
  'app',
  '(student)',
  'quiz',
  'page.tsx',
);
const SUPABASE_LIB = join(REPO_ROOT, 'packages', 'lib', 'src', 'supabase.ts');

const SESSION_ID = '55555555-5555-4555-a555-555555555555';

function makeState(live: LiveSessionState): StudentState {
  return {
    schemaVersion: 1,
    builtAt: '2026-08-11T10:00:00.000Z',
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
          { chapterNumber: 3, mastery: 0.4, lastUpdatedAt: '2026-08-10T09:00:00.000Z', attempts: 12 },
        ],
      },
    ],
    engagement: {
      currentStreakDays: 3,
      longestStreakDays: 9,
      lastActiveAt: '2026-08-11T09:30:00.000Z',
      totalTimeOnTaskSec: 1800,
      xpBalance: 120,
    },
    live,
    classroomId: null,
    parentIds: [],
  };
}

const AUG: LoopAugmentation = {
  dueReviewCount: 0,
  attemptedQuizToday: false,
  inProgressLessons: [],
};

const NOW = new Date('2026-08-12T06:30:00.000Z');

const IN_QUIZ: LiveSessionState = {
  kind: 'in_quiz',
  quizSessionId: SESSION_ID,
  subjectCode: 'science',
  chapterNumber: 3,
  startedAt: '2026-08-11T10:00:00.000Z',
  questionCount: 10,
  questionsAnswered: 4,
};

// ── 1. The resume CTA is a resumable link ─────────────────────────────────

describe('resolve-next-action: the in_quiz resume deep link', () => {
  it('carries the session id so /quiz can rebuild the session, instead of a bare /quiz', () => {
    const q = resolveTodayQueue(makeState(IN_QUIZ), AUG, { now: NOW });
    expect(q.primary.kind).toBe('resume_in_progress');
    expect(q.primary.url).toBe(`/quiz?session=${SESSION_ID}`);
    // The old behaviour — a bare /quiz — landed on the SETUP screen, so the
    // CTA that said "resume" actually started a brand-new quiz.
    expect(q.primary.url).not.toBe('/quiz');
  });

  it('the session id survives the URL → TodayQueueItem DTO projection', () => {
    const q = resolveTodayQueue(makeState(IN_QUIZ), AUG, { now: NOW });
    const item = mapActionToTodayItem(q.primary, 1);
    expect(item.deepLink.route).toBe('/quiz');
    expect(item.deepLink.params).toMatchObject({ session: SESSION_ID });
  });

  it('an idle learner gets no resume action at all', () => {
    const q = resolveTodayQueue(makeState({ kind: 'idle' }), AUG, { now: NOW });
    expect(q.queue.some(a => a.kind === 'resume_in_progress')).toBe(false);
  });

  it('the raw resolver is untouched — only the Today queue prepends the resume', () => {
    const raw = resolveNextLearnerAction(makeState(IN_QUIZ), AUG, { now: NOW });
    expect(raw.kind).not.toBe('resume_in_progress');
  });
});

// ── 2. /quiz honours the resume link and ?mode=practice ───────────────────

describe('/quiz URL contract', () => {
  const src = readFileSync(QUIZ_PAGE, 'utf8');

  it('reads the ?session= parameter (and the sessionId alias)', () => {
    expect(src).toMatch(/params\.get\('session'\)/);
    expect(src).toMatch(/params\.get\('sessionId'\)/);
  });

  it('has a mode=practice branch — it had none, so every ?mode=practice link fell through to cognitive', () => {
    expect(src).toMatch(/mode === 'practice'.*setQuizMode\('practice'\)/s);
    expect(src).toContain("setInitialMode('practice')");
    // The three sibling branches still exist, unchanged.
    expect(src).toContain("if (mode === 'cognitive')");
    expect(src).toContain("if (mode === 'exam')");
  });

  it('the two live surfaces that emit ?mode=practice now reach Practice mode', () => {
    const assignments = readFileSync(
      join(REPO_ROOT, 'apps', 'host', 'src', 'app', '(student)', 'assignments', 'page.tsx'),
      'utf8',
    );
    expect(assignments).toContain("params.set('mode', 'practice')");
    // PracticeRunner's gate is quizMode === 'practice'; with the branch in
    // place the link can now actually select it.
    expect(src).toContain("quizMode === 'practice'");
  });

  it('rebuilds a resumed session WITHOUT starting a second server session', () => {
    // The resume effect must never call startQuizSession — doing so would
    // mint a second session id, a second shuffle snapshot, and break the
    // one-session-one-submission idempotency the resume design rests on.
    const resumeEffect = src.slice(
      src.indexOf('Phase 4: session RESUME consumer'),
      src.indexOf('parseOptions is imported'),
    );
    expect(resumeEffect.length).toBeGreaterThan(500);
    expect(resumeEffect).toContain('fetchQuizResume');
    expect(resumeEffect).not.toContain('startQuizSession(');
    expect(resumeEffect).not.toContain('assembleQuiz(');
    // The client is never handed a correct index on the resume path either.
    expect(resumeEffect).toContain('correct_answer_index: -1');
  });

  it('seeds the total-time counter from persisted on-task time (P3 across a resume)', () => {
    const resumeEffect = src.slice(
      src.indexOf('Phase 4: session RESUME consumer'),
      src.indexOf('parseOptions is imported'),
    );
    expect(resumeEffect).toContain('setTimer(result.elapsed_seconds)');
    // Never wall clock — no Date.now()/started_at arithmetic in this effect.
    expect(resumeEffect).not.toMatch(/Date\.now\(\)\s*-/);
  });
});

// ── 3. No double submission / no double XP ────────────────────────────────

describe('submitQuizResults: one graded submission per server session', () => {
  it('passes the server session id as p_idempotency_key', () => {
    const src = readFileSync(SUPABASE_LIB, 'utf8');
    const fn = src.slice(
      src.indexOf('export async function submitQuizResults'),
      src.indexOf('processAdaptiveLearning() was DELETED'),
    );
    expect(fn).toContain('p_idempotency_key: sessionId ?? null');
    // And the session id is still routed to the v2 RPC as before.
    expect(fn).toContain('p_session_id: sessionId');
  });
});

describe('submitQuizResults: the RPC contract in practice', () => {
  const rpcSpy = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    rpcSpy.mockReset();
    vi.doMock('@alfanumrik/lib/supabase-client', () => ({
      supabase: { rpc: (...a: unknown[]) => rpcSpy(...a) },
    }));
  });

  it('a resumed session submitting twice replays instead of awarding XP twice', async () => {
    // First submit grades; a SECOND call with the same session id hits the
    // RPC's idempotency short-circuit, which returns the cached result with
    // idempotent_replay: true and awards nothing further. The client-side
    // dedup Set cannot provide this: a page refresh clears it.
    rpcSpy
      .mockResolvedValueOnce({
        data: { total: 10, correct: 7, score_percent: 70, xp_earned: 90, idempotent_replay: false },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { total: 10, correct: 7, score_percent: 70, xp_earned: 90, idempotent_replay: true },
        error: null,
      });

    const { submitQuizResults } = await import('@alfanumrik/lib/supabase');

    const responses = [
      { question_id: 'aaaaaaaa-1111-4111-a111-111111111111', selected_option: 1, is_correct: false, time_spent: 20 },
    ];

    const first = await submitQuizResults(
      'student-1', 'science', '8', 'Science', 3,
      responses as never, 200, SESSION_ID,
    );
    // Distinct dedup key (different response count) so the in-memory guard
    // does not mask the RPC call we are asserting on.
    const second = await submitQuizResults(
      'student-1', 'science', '8', 'Science', 3,
      responses as never, 201, SESSION_ID,
    );

    expect(rpcSpy).toHaveBeenCalledTimes(2);
    for (const call of rpcSpy.mock.calls) {
      expect(call[0]).toBe('submit_quiz_results_v2');
      expect(call[1].p_idempotency_key).toBe(SESSION_ID);
    }
    expect((first as { idempotent_replay: boolean }).idempotent_replay).toBe(false);
    expect((second as { idempotent_replay: boolean }).idempotent_replay).toBe(true);
    // Same XP figure reported both times — the replay awards nothing new.
    expect((second as { xp_earned: number }).xp_earned).toBe(90);
  });

  it('passes a null idempotency key when there is no server session (legacy path unchanged)', async () => {
    rpcSpy.mockResolvedValue({ data: { total: 1, correct: 1 }, error: null });
    const { submitQuizResults } = await import('@alfanumrik/lib/supabase');
    await submitQuizResults(
      'student-2', 'math', '7', 'Math', 1,
      [{ question_id: 'bbbbbbbb-2222-4222-a222-222222222222', selected_option: 0, is_correct: true, time_spent: 30 }] as never,
      30, null,
    );
    expect(rpcSpy.mock.calls[0][1].p_idempotency_key).toBeNull();
  });
});

// ── 4. Persistence is always on, with no flag in the way ──────────────────

describe('answer durability is not gated behind ff_quiz_v2', () => {
  const src = readFileSync(QUIZ_PAGE, 'utf8');

  it('confirmAnswer persists every confirmed answer, on every mode', () => {
    const confirmFn = src.slice(
      src.indexOf('const confirmAnswer = () => {'),
      src.indexOf('D6: student tapped a confidence level'),
    );
    expect(confirmFn).toContain('saveQuizAnswerProgress(');
    // The persist call is guarded ONLY by "there is a server session", "this
    // is an MCQ", and "the practice-v2 writer isn't already owning it" —
    // never by a feature flag on its own.
    expect(confirmFn).toContain('if (serverSessionId && !practiceV2OwnsPersist');
    expect(confirmFn).not.toMatch(/if \(practiceV2On\)\s*\{[^}]*saveQuizAnswerProgress/);
  });

  it('documents WHY check_quiz_answer could not be used as the writer (its flag is off)', () => {
    expect(src).toContain('practiceV2OwnsPersist');
    const confirmFn = src.slice(
      src.indexOf('const confirmAnswer = () => {'),
      src.indexOf('D6: student tapped a confidence level'),
    );
    expect(confirmFn).toMatch(/check_quiz_answer/);
  });
});
