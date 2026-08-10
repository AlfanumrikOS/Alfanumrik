/**
 * Quiz session RESUME — the pure payload contract
 * (packages/lib/src/quiz/resume.ts).
 *
 * Phase 4: "Refresh and interruption preserve recoverable session progress."
 *
 * Pins, in priority order:
 *   1. SECURITY (the hard constraint): the resume payload NEVER carries
 *      `correct_answer_index` / `correct_answer_index_snapshot` / any
 *      correctness signal, and the column whitelists the route selects with
 *      cannot name them. An answered question is byte-indistinguishable in
 *      the payload whether the student got it right or wrong.
 *   2. Prior answers are restored: the student's own selected DISPLAYED index
 *      and their real per-question time survive the interruption.
 *   3. ANTI-CHEAT ACROSS A RESUME (P3): `elapsed_seconds` is the sum of the
 *      persisted per-question times — on-task time only, never wall clock —
 *      so a resumed session can neither bank idle time to clear the
 *      3s/question floor nor be falsely flagged for restarting at zero.
 *   4. Option order is rebuilt from the server snapshot + shuffle map, so a
 *      resumed student sees the SAME options in the SAME positions.
 *   5. Every non-resumable reason is explicit and fail-soft.
 */

import { describe, it, expect } from 'vitest';
import {
  SHUFFLE_RESUME_COLUMNS,
  QUESTION_BANK_RESUME_COLUMNS,
  RESUME_MAX_AGE_MS,
  MAX_QUESTION_SECONDS,
  buildQuizResumePayload,
  deriveDisplayedOptions,
  orderResumeRows,
  isResumeExpired,
  isResumeSessionId,
  type QuestionBankResumeRow,
  type ShuffleResumeRow,
} from '@alfanumrik/lib/quiz/resume';

const SESSION = '11111111-1111-4111-a111-111111111111';
const Q1 = 'aaaaaaaa-1111-4111-a111-111111111111';
const Q2 = 'bbbbbbbb-2222-4222-a222-222222222222';
const Q3 = 'cccccccc-3333-4333-a333-333333333333';

const T0 = '2026-08-11T10:00:00.000Z';

function shuffleRow(overrides: Partial<ShuffleResumeRow> & { question_id: string }): ShuffleResumeRow {
  return {
    shuffle_map: [0, 1, 2, 3],
    options_snapshot: ['alpha', 'beta', 'gamma', 'delta'],
    student_selected_displayed_index: null,
    student_time_spent_seconds: null,
    student_answered_at: null,
    created_at: T0,
    ...overrides,
  };
}

function qbRow(id: string, overrides: Partial<QuestionBankResumeRow> = {}): QuestionBankResumeRow {
  return {
    id,
    subject: 'science',
    question_text: `Question ${id}`,
    question_hi: null,
    question_type: 'mcq',
    explanation: 'Because.',
    explanation_hi: null,
    hint: 'Think.',
    difficulty: 2,
    bloom_level: 'understand',
    chapter_number: 4,
    ...overrides,
  };
}

function qMap(rows: QuestionBankResumeRow[]): Map<string, QuestionBankResumeRow> {
  return new Map(rows.map(r => [r.id, r]));
}

// ── 1. SECURITY — the answer key must never reach the client ─────────────

describe('resume payload: correct_answer_index must not leak', () => {
  it('the shuffle column whitelist does not name the snapshot answer key', () => {
    expect(SHUFFLE_RESUME_COLUMNS).not.toContain('correct_answer_index_snapshot');
    expect(SHUFFLE_RESUME_COLUMNS).not.toMatch(/correct/i);
    // But it DOES carry what is needed to rebuild the displayed order.
    expect(SHUFFLE_RESUME_COLUMNS).toContain('shuffle_map');
    expect(SHUFFLE_RESUME_COLUMNS).toContain('options_snapshot');
  });

  it('the question_bank column whitelist does not name correct_answer_index', () => {
    expect(QUESTION_BANK_RESUME_COLUMNS).not.toContain('correct_answer_index');
    expect(QUESTION_BANK_RESUME_COLUMNS).not.toMatch(/correct/i);
  });

  it('a serialized payload contains no correctness key and no correctness value', () => {
    const rows = [
      shuffleRow({
        question_id: Q1,
        student_selected_displayed_index: 2,
        student_time_spent_seconds: 14,
        student_answered_at: '2026-08-11T10:01:00.000Z',
      }),
      shuffleRow({ question_id: Q2 }),
    ];
    const result = buildQuizResumePayload(SESSION, rows, qMap([qbRow(Q1), qbRow(Q2)]));
    expect(result.resumable).toBe(true);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/correct_answer_index/);
    expect(serialized).not.toMatch(/correct_answer_index_snapshot/);
    expect(serialized).not.toMatch(/is_correct/);
    expect(serialized).not.toMatch(/"correct/);
  });

  it('an answered-correct and an answered-wrong question are indistinguishable in the payload', () => {
    // Same inputs on the resume side; the ONLY thing that differs in reality
    // is the snapshot answer key — which this path never reads. If the two
    // payloads are identical, correctness is not inferable.
    const mk = (picked: number) =>
      buildQuizResumePayload(
        SESSION,
        [
          shuffleRow({
            question_id: Q1,
            student_selected_displayed_index: picked,
            student_time_spent_seconds: 9,
            student_answered_at: '2026-08-11T10:01:00.000Z',
          }),
        ],
        qMap([qbRow(Q1)]),
      );

    const a = mk(0);
    const b = mk(3);
    expect(a.resumable && b.resumable).toBe(true);
    if (!a.resumable || !b.resumable) return;

    // Structurally identical apart from the student's OWN pick.
    expect(Object.keys(a.questions[0]).sort()).toEqual(Object.keys(b.questions[0]).sort());
    expect(a.questions[0].selected_displayed_index).toBe(0);
    expect(b.questions[0].selected_displayed_index).toBe(3);
    expect({ ...a.questions[0], selected_displayed_index: null })
      .toEqual({ ...b.questions[0], selected_displayed_index: null });
  });

  it('the payload never grows a field the whitelist did not authorise', () => {
    // Guards against a future `select('*')` or an object spread: an extra
    // column on the input row must not appear on the output.
    const leaky = {
      ...shuffleRow({
        question_id: Q1,
        student_selected_displayed_index: 1,
        student_time_spent_seconds: 5,
        student_answered_at: '2026-08-11T10:01:00.000Z',
      }),
      correct_answer_index_snapshot: 3,
    } as unknown as ShuffleResumeRow;

    const leakyMeta = { ...qbRow(Q1), correct_answer_index: 3 } as unknown as QuestionBankResumeRow;

    const result = buildQuizResumePayload(SESSION, [leaky], qMap([leakyMeta]));
    expect(result.resumable).toBe(true);
    if (!result.resumable) return;

    expect(Object.keys(result.questions[0]).sort()).toEqual(
      [
        'answered',
        'bloom_level',
        'chapter_number',
        'difficulty',
        'explanation',
        'explanation_hi',
        'hint',
        'options_displayed',
        'question_hi',
        'question_id',
        'question_text',
        'question_type',
        'selected_displayed_index',
        'time_spent_seconds',
      ].sort(),
    );
    expect(JSON.stringify(result)).not.toContain('"3"');
    expect(JSON.stringify(result)).not.toMatch(/correct/);
  });
});

// ── 2. Prior answers are actually restored ────────────────────────────────

describe('resume payload: prior answers survive the interruption', () => {
  it('restores each answered question with the student’s own displayed index and time', () => {
    const rows = [
      shuffleRow({
        question_id: Q1,
        student_selected_displayed_index: 2,
        student_time_spent_seconds: 12,
        student_answered_at: '2026-08-11T10:01:00.000Z',
      }),
      shuffleRow({
        question_id: Q2,
        student_selected_displayed_index: 0,
        student_time_spent_seconds: 21,
        student_answered_at: '2026-08-11T10:02:00.000Z',
      }),
      shuffleRow({ question_id: Q3 }),
    ];
    const result = buildQuizResumePayload(SESSION, rows, qMap([qbRow(Q1), qbRow(Q2), qbRow(Q3)]));
    expect(result.resumable).toBe(true);
    if (!result.resumable) return;

    expect(result.total_questions).toBe(3);
    expect(result.answered_count).toBe(2);
    expect(result.questions[0]).toMatchObject({
      question_id: Q1,
      answered: true,
      selected_displayed_index: 2,
      time_spent_seconds: 12,
    });
    expect(result.questions[1]).toMatchObject({
      question_id: Q2,
      answered: true,
      selected_displayed_index: 0,
      time_spent_seconds: 21,
    });
    expect(result.questions[2]).toMatchObject({
      question_id: Q3,
      answered: false,
      selected_displayed_index: null,
      time_spent_seconds: null,
    });
  });

  it('orders answered questions first (oldest answer first), so the resume cursor is answered_count', () => {
    const rows = [
      shuffleRow({ question_id: Q3 }),
      shuffleRow({
        question_id: Q2,
        student_selected_displayed_index: 1,
        student_time_spent_seconds: 8,
        student_answered_at: '2026-08-11T10:05:00.000Z',
      }),
      shuffleRow({
        question_id: Q1,
        student_selected_displayed_index: 1,
        student_time_spent_seconds: 8,
        student_answered_at: '2026-08-11T10:01:00.000Z',
      }),
    ];
    const ordered = orderResumeRows(rows).map(r => r.question_id);
    expect(ordered).toEqual([Q1, Q2, Q3]);

    const result = buildQuizResumePayload(SESSION, rows, qMap([qbRow(Q1), qbRow(Q2), qbRow(Q3)]));
    expect(result.resumable).toBe(true);
    if (!result.resumable) return;
    // Answered questions form a prefix — the cursor is exactly answered_count.
    const firstUnanswered = result.questions.findIndex(q => !q.answered);
    expect(firstUnanswered).toBe(result.answered_count);
  });

  it('rebuilds the SAME displayed option order the student saw (snapshot + shuffle map)', () => {
    const options = ['alpha', 'beta', 'gamma', 'delta'];
    // shuffle_map[displayed] = original → displayed order is [delta, alpha, gamma, beta]
    expect(deriveDisplayedOptions(options, [3, 0, 2, 1])).toEqual([
      'delta',
      'alpha',
      'gamma',
      'beta',
    ]);

    const rows = [
      shuffleRow({
        question_id: Q1,
        shuffle_map: [3, 0, 2, 1],
        student_selected_displayed_index: 1,
        student_time_spent_seconds: 6,
        student_answered_at: '2026-08-11T10:01:00.000Z',
      }),
    ];
    const result = buildQuizResumePayload(SESSION, rows, qMap([qbRow(Q1)]));
    expect(result.resumable).toBe(true);
    if (!result.resumable) return;
    expect(result.questions[0].options_displayed).toEqual(['delta', 'alpha', 'gamma', 'beta']);
    // The restored pick is in DISPLAYED space, matching what the student
    // clicked — index 1 is still 'alpha'.
    expect(result.questions[0].options_displayed[1]).toBe('alpha');
  });

  it('a JSON-string options snapshot and a degenerate shuffle map both degrade safely', () => {
    expect(deriveDisplayedOptions('["a","b","c","d"]', null)).toEqual(['a', 'b', 'c', 'd']);
    expect(deriveDisplayedOptions(['a', 'b', 'c', 'd'], [0, 0, 0, 0])).toEqual(['a', 'b', 'c', 'd']);
    expect(deriveDisplayedOptions(['a', 'b'], [0, 1, 2, 3])).toBeNull();
    expect(deriveDisplayedOptions('not json', null)).toBeNull();
  });
});

// ── 3. ANTI-CHEAT ACROSS A RESUME (P3) ────────────────────────────────────

describe('resume payload: P3 timing survives the interruption in both directions', () => {
  it('elapsed_seconds is the SUM OF ON-TASK per-question times, never wall clock', () => {
    const rows = [
      shuffleRow({
        question_id: Q1,
        student_selected_displayed_index: 0,
        student_time_spent_seconds: 11,
        // Answered at 10:01…
        student_answered_at: '2026-08-11T10:01:00.000Z',
      }),
      shuffleRow({
        question_id: Q2,
        student_selected_displayed_index: 1,
        student_time_spent_seconds: 13,
        // …then the student vanished for six hours and came back.
        student_answered_at: '2026-08-11T16:02:00.000Z',
      }),
      shuffleRow({ question_id: Q3 }),
    ];
    const result = buildQuizResumePayload(SESSION, rows, qMap([qbRow(Q1), qbRow(Q2), qbRow(Q3)]));
    expect(result.resumable).toBe(true);
    if (!result.resumable) return;

    // 24 seconds of thinking, not 6 hours of wall clock. A student cannot
    // bank idle time to lift p_time / total over the 3s/question floor.
    expect(result.elapsed_seconds).toBe(24);
    expect(result.elapsed_seconds).toBeLessThan(6 * 3600);
  });

  it('restoring real per-question time keeps an HONEST resumer above the 3s/question floor', () => {
    // 9 questions answered thoughtfully (~20s each), interrupted before the
    // 10th. The server's check is p_time / total >= 3.
    const answered = Array.from({ length: 9 }, (_, i) =>
      shuffleRow({
        question_id: `dddddddd-0000-4000-a000-00000000000${i}`,
        student_selected_displayed_index: i % 4,
        student_time_spent_seconds: 20,
        student_answered_at: `2026-08-11T10:0${i}:00.000Z`,
      }),
    );
    const rows = [...answered, shuffleRow({ question_id: Q1 })];
    const metas = rows.map(r => qbRow(r.question_id));

    const result = buildQuizResumePayload(SESSION, rows, qMap(metas));
    expect(result.resumable).toBe(true);
    if (!result.resumable) return;

    // Resume seeds the counter with 180s. Even if the student spends only 5s
    // on the final question, avg = 185/10 = 18.5s — comfortably clear.
    const totalAtSubmit = result.elapsed_seconds + 5;
    expect(totalAtSubmit / result.total_questions).toBeGreaterThanOrEqual(3);

    // Whereas a counter that restarted at zero would flag this honest
    // student: 5/10 = 0.5s avg → flagged, XP zeroed. That is the false
    // positive this restoration exists to prevent.
    expect(5 / result.total_questions).toBeLessThan(3);
  });

  it('a per-question time is clamped, so it cannot be inflated without bound', () => {
    const rows = [
      shuffleRow({
        question_id: Q1,
        student_selected_displayed_index: 0,
        student_time_spent_seconds: 999_999,
        student_answered_at: '2026-08-11T10:01:00.000Z',
      }),
    ];
    const result = buildQuizResumePayload(SESSION, rows, qMap([qbRow(Q1)]));
    expect(result.resumable).toBe(true);
    if (!result.resumable) return;
    expect(result.questions[0].time_spent_seconds).toBe(MAX_QUESTION_SECONDS);
    expect(result.elapsed_seconds).toBe(MAX_QUESTION_SECONDS);
  });

  it('a negative or non-numeric persisted time contributes zero, never a negative offset', () => {
    const rows = [
      shuffleRow({
        question_id: Q1,
        student_selected_displayed_index: 0,
        student_time_spent_seconds: -500,
        student_answered_at: '2026-08-11T10:01:00.000Z',
      }),
    ];
    const result = buildQuizResumePayload(SESSION, rows, qMap([qbRow(Q1)]));
    expect(result.resumable).toBe(true);
    if (!result.resumable) return;
    expect(result.questions[0].time_spent_seconds).toBe(0);
    expect(result.elapsed_seconds).toBe(0);
  });
});

// ── 4. Non-resumable reasons are explicit and fail-soft ───────────────────

describe('resume payload: blocked reasons', () => {
  it('not_found when the session has no snapshot rows', () => {
    expect(buildQuizResumePayload(SESSION, [], new Map())).toEqual({
      resumable: false,
      reason: 'not_found',
    });
  });

  it('not_started when the student never confirmed an answer', () => {
    const rows = [shuffleRow({ question_id: Q1 }), shuffleRow({ question_id: Q2 })];
    expect(buildQuizResumePayload(SESSION, rows, qMap([qbRow(Q1), qbRow(Q2)]))).toEqual({
      resumable: false,
      reason: 'not_started',
    });
  });

  it('corrupt when a question’s metadata or option snapshot is unusable', () => {
    const answeredRow = shuffleRow({
      question_id: Q1,
      student_selected_displayed_index: 0,
      student_time_spent_seconds: 4,
      student_answered_at: '2026-08-11T10:01:00.000Z',
    });
    // Missing question_bank metadata.
    expect(buildQuizResumePayload(SESSION, [answeredRow], new Map())).toEqual({
      resumable: false,
      reason: 'corrupt',
    });
    // Unusable options snapshot.
    expect(
      buildQuizResumePayload(
        SESSION,
        [{ ...answeredRow, options_snapshot: ['only', 'two'] }],
        qMap([qbRow(Q1)]),
      ),
    ).toEqual({ resumable: false, reason: 'corrupt' });
  });

  it('isResumeExpired honours the 24h window', () => {
    const now = new Date('2026-08-12T10:00:00.000Z');
    expect(isResumeExpired('2026-08-12T09:00:00.000Z', now)).toBe(false);
    expect(isResumeExpired('2026-08-11T09:00:00.000Z', now)).toBe(true);
    expect(isResumeExpired(null, now)).toBe(false);
    expect(RESUME_MAX_AGE_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('isResumeSessionId rejects anything that is not a UUID', () => {
    expect(isResumeSessionId(SESSION)).toBe(true);
    expect(isResumeSessionId('../../etc/passwd')).toBe(false);
    expect(isResumeSessionId('')).toBe(false);
    expect(isResumeSessionId(null)).toBe(false);
    expect(isResumeSessionId(42)).toBe(false);
  });
});
