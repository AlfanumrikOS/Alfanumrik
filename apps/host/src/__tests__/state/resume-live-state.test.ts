/**
 * student-state-builder — `live.kind === 'in_quiz'` derivation (Phase 4).
 *
 * WHY THIS EXISTS. The `resume_in_progress` Today CTA keys off
 * `state.live.kind === 'in_quiz'`, and that state was derived from an open
 * `quiz_sessions` row (`is_completed = false`). But `start_quiz_session`
 * writes NO `quiz_sessions` row at all — the row is INSERTed for the first
 * time by `submit_quiz_results_v2`, already `is_completed = true`. So the
 * signal could never fire for a real in-flight quiz, and the resume CTA was
 * unreachable by construction, on top of its deep link being a bare `/quiz`.
 *
 * The builder now derives the signal from `quiz_session_shuffles`, which IS
 * written at session start and carries the durable per-question answer record.
 *
 * Pins:
 *   - a fresh session with ≥1 confirmed answer → in_quiz, carrying the
 *     session id the resume deep link needs;
 *   - a session with no confirmed answer → idle (nothing to preserve);
 *   - an ALREADY-GRADED session → idle (never offer to resume a finished
 *     quiz; the graded row is found via its idempotency key);
 *   - a session older than the 24h window → idle;
 *   - the read is best-effort: a failure degrades to idle, never a throw.
 *
 * ── NEVER PROMISE WHAT YOU WILL REFUSE (added 2026-08-11) ────────────────
 *
 * Two gates were previously enforced ONLY on the resume ROUTE and not here,
 * where the card is PRODUCED. Because the client's resume consumer fails soft
 * with NO message, a student on the affected cohort tapped "Continue where you
 * stopped" and silently landed on the setup screen with their progress
 * apparently gone — exactly the defect Phase 4 existed to kill. Both now
 * suppress the card:
 *   - the `ff_quiz_v2` immediate-feedback interlock, read FAIL-CLOSED
 *     (undetermined → suppress);
 *   - the INSTRUMENT: an `exam` session is not resumable, and an unrecorded
 *     `session_mode` cannot be proven not to have been one.
 */

import { describe, it, expect } from 'vitest';
import { createStudentStateBuilder } from '@alfanumrik/lib/state/student-state-builder';

type Row = Record<string, unknown>;
type TableState = { rows: Row[]; error?: string };

const AUTH_USER_ID = '11111111-1111-1111-1111-111111111111';
const STUDENT_ID = '22222222-2222-2222-2222-222222222222';
const SESSION_ID = '55555555-5555-4555-a555-555555555555';
const Q1 = 'aaaaaaaa-1111-4111-a111-111111111111';
const Q2 = 'bbbbbbbb-2222-4222-a222-222222222222';

function studentRow(): Row {
  return {
    id: STUDENT_ID,
    auth_user_id: AUTH_USER_ID,
    name: 'Test Learner',
    grade: '8',
    board: 'CBSE',
    preferred_language: 'en',
    school_id: null,
    subscription_plan: 'free',
    xp_total: 120,
    streak_days: 3,
    last_active: '2026-08-11T08:00:00Z',
    date_of_birth: '2014-01-01',
    created_at: '2026-04-01T00:00:00Z',
  };
}

function applyFilters(rows: Row[], filters: Array<{ col: string; val: unknown }>): Row[] {
  return rows.filter(r => filters.every(f => r[f.col] === f.val));
}

function makeFakeSb(tables: Record<string, TableState>) {
  const sb = {
    from(table: string) {
      const state = tables[table] ?? { rows: [] };
      const filters: Array<{ col: string; val: unknown }> = [];
      let _limit = Infinity;
      let _orderCol: string | null = null;
      let _asc = true;
      const q: Record<string, unknown> = {
        select: () => q,
        eq(col: string, val: unknown) {
          filters.push({ col, val });
          return q;
        },
        order(col: string, opts: { ascending?: boolean } = {}) {
          _orderCol = col;
          _asc = opts.ascending ?? true;
          return q;
        },
        limit(n: number) {
          _limit = n;
          return q;
        },
        async maybeSingle() {
          if (state.error) return { data: null, error: { message: state.error } };
          return { data: applyFilters(state.rows, filters)[0] ?? null, error: null };
        },
        async then(resolve: (v: { data: Row[] | null; error: unknown }) => unknown) {
          if (state.error) return resolve({ data: null, error: { message: state.error } });
          let filtered = applyFilters(state.rows, filters);
          if (_orderCol) {
            const col = _orderCol;
            filtered = filtered
              .slice()
              .sort(
                (a, b) =>
                  String(a[col] ?? '').localeCompare(String(b[col] ?? '')) * (_asc ? 1 : -1),
              );
          }
          return resolve({ data: filtered.slice(0, _limit), error: null });
        },
      };
      return q;
    },
  };
  return sb as unknown as Parameters<typeof createStudentStateBuilder>[0]['sb'];
}

const NOW = new Date('2026-08-11T12:00:00.000Z');
const FRESH = '2026-08-11T11:00:00.000Z';
const STALE = '2026-08-09T11:00:00.000Z';

function shuffle(overrides: Row = {}): Row {
  return {
    session_id: SESSION_ID,
    question_id: Q1,
    student_id: STUDENT_ID,
    student_answered_at: null,
    created_at: FRESH,
    // Default fixture is an untimed session; the instrument gate has its own
    // cases below.
    session_mode: 'cognitive',
    ...overrides,
  };
}

function build(opts: {
  shuffles: Row[];
  graded?: Row[];
  questionBank?: Row[];
  shufflesError?: string;
  /**
   * The `ff_quiz_v2` interlock. Injected rather than left to the real reader so
   * these tests pin BOTH halves without a live flag service — and so the
   * default here (`false` = not blocked) is an explicit statement that every
   * other case in this file is testing the flag-OFF world.
   */
  resumeBlocked?: boolean;
}) {
  return createStudentStateBuilder({
    now: () => NOW,
    isResumeBlocked: async () => opts.resumeBlocked ?? false,
    sb: makeFakeSb({
      students: { rows: [studentRow()] },
      learner_mastery: { rows: [] },
      quiz_sessions: { rows: opts.graded ?? [] },
      foxy_sessions: { rows: [] },
      guardian_student_links: { rows: [] },
      quiz_session_shuffles: { rows: opts.shuffles, error: opts.shufflesError },
      question_bank: {
        rows: opts.questionBank ?? [{ id: Q1, subject: 'science', chapter_number: 4 }],
      },
    }),
  })(AUTH_USER_ID);
}

describe('student-state-builder: in-flight quiz → live.in_quiz', () => {
  it('surfaces a fresh session with at least one confirmed answer, carrying the session id', async () => {
    const state = await build({
      shuffles: [
        shuffle({ question_id: Q1, student_answered_at: '2026-08-11T11:05:00.000Z' }),
        shuffle({ question_id: Q2 }),
      ],
    });
    expect(state.live.kind).toBe('in_quiz');
    if (state.live.kind !== 'in_quiz') return;
    // This id is what makes the resume deep link resumable.
    expect(state.live.quizSessionId).toBe(SESSION_ID);
    expect(state.live.subjectCode).toBe('science');
    expect(state.live.chapterNumber).toBe(4);
    expect(state.live.questionCount).toBe(2);
    expect(state.live.questionsAnswered).toBe(1);
  });

  it('stays idle when the student never confirmed an answer — there is nothing to preserve', async () => {
    const state = await build({
      shuffles: [shuffle({ question_id: Q1 }), shuffle({ question_id: Q2 })],
    });
    expect(state.live.kind).toBe('idle');
  });

  it('stays idle for an ALREADY-GRADED session (found via its idempotency key)', async () => {
    const state = await build({
      shuffles: [shuffle({ question_id: Q1, student_answered_at: '2026-08-11T11:05:00.000Z' })],
      graded: [{ id: 'graded-row-1', student_id: STUDENT_ID, idempotency_key: SESSION_ID }],
    });
    // Offering to "continue" a quiz the student already finished would walk
    // them into a session the submit RPC can only ever replay.
    expect(state.live.kind).toBe('idle');
  });

  it('stays idle for a session older than the 24h resume window', async () => {
    const state = await build({
      shuffles: [
        shuffle({
          question_id: Q1,
          created_at: STALE,
          student_answered_at: '2026-08-09T11:05:00.000Z',
        }),
      ],
    });
    expect(state.live.kind).toBe('idle');
  });

  it('stays idle when the chapter number is missing (in_quiz requires a positive chapter)', async () => {
    const state = await build({
      shuffles: [shuffle({ question_id: Q1, student_answered_at: '2026-08-11T11:05:00.000Z' })],
      questionBank: [{ id: Q1, subject: 'science', chapter_number: null }],
    });
    expect(state.live.kind).toBe('idle');
  });

  it('degrades to idle (never throws) when the snapshot read fails', async () => {
    const state = await build({ shuffles: [], shufflesError: 'connection reset' });
    expect(state.live.kind).toBe('idle');
  });
});

describe('student-state-builder: the card is never offered when the route would refuse it', () => {
  const ANSWERED = { question_id: Q1, student_answered_at: '2026-08-11T11:05:00.000Z' };

  it('suppresses the card when the ff_quiz_v2 interlock blocks resume', async () => {
    // THE DEFECT: the interlock lived only on the resume route's GET. On the
    // ramp, /today rendered "Continue where you stopped" → tap →
    // /quiz?session=<id> → GET returned blocked_immediate_feedback → the
    // client's fail-soft path cleared the breadcrumb and showed NO message →
    // the student landed on the setup screen. Progress apparently gone, with
    // no explanation. The producer must consult the same gate as the consumer.
    const state = await build({ shuffles: [shuffle(ANSWERED)], resumeBlocked: true });
    expect(state.live.kind).toBe('idle');
  });

  it('offers the card when the interlock does NOT block (the flag-OFF world still works)', async () => {
    // Guards against over-correcting: the fix must suppress the promise, not
    // the feature.
    const state = await build({ shuffles: [shuffle(ANSWERED)], resumeBlocked: false });
    expect(state.live.kind).toBe('in_quiz');
  });

  it('suppresses the card for an EXAM session — a timed test is taken in one sitting', async () => {
    const state = await build({
      shuffles: [shuffle({ ...ANSWERED, session_mode: 'exam' })],
    });
    expect(state.live.kind).toBe('idle');
  });

  it('suppresses the card when the instrument was never recorded, rather than assuming untimed', async () => {
    const state = await build({
      shuffles: [shuffle({ ...ANSWERED, session_mode: null })],
    });
    expect(state.live.kind).toBe('idle');
  });

  it('suppresses the card for an unrecognised instrument', async () => {
    const state = await build({
      shuffles: [shuffle({ ...ANSWERED, session_mode: 'timed' })],
    });
    expect(state.live.kind).toBe('idle');
  });

  it('offers the card for a practice session (both non-exam instruments resume)', async () => {
    const state = await build({
      shuffles: [shuffle({ ...ANSWERED, session_mode: 'practice' })],
    });
    expect(state.live.kind).toBe('in_quiz');
  });
});
