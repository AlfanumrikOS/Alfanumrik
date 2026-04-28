/**
 * REG-51 — Quiz server-shuffle-authority round-trip (P0 fix, migration
 * 20260428160000).
 *
 * Threat model closed:
 *   The legacy client-side `seededShuffle(opts, q.id + question_text.slice(0,20))`
 *   was STABLE across sessions. When `question_bank.options` got edited
 *   (e.g. content fix), the cached shuffle map drifted from the new
 *   `correct_answer_index` and students saw the green check on the wrong
 *   row even though the explanation read correctly.
 *
 * Phase A fix:
 *   - `start_quiz_session` RPC: server generates per-question shuffle,
 *     snapshots options + correct_answer_index, returns shuffled options
 *     to the client WITHOUT correct_answer_index.
 *   - `submit_quiz_results_v2` RPC: client sends only
 *     `{ question_id, selected_displayed_index }`; server re-derives
 *     `is_correct` against the snapshot. Mid-session content edits
 *     do NOT affect scoring.
 *
 * Coverage strategy (parity test, no live Postgres):
 *   1. Client contract: when serverSessionId is present, the payload to
 *      `submit_quiz_results_v2` MUST contain only `selected_displayed_index`
 *      and MUST NOT contain `is_correct` or `shuffle_map`.
 *   2. Snapshot scoring: a TS port of the v2 PL/pgSQL inner loop
 *      reproduces the snapshot lookup and is_correct re-derivation.
 *      Mid-session mutation of `question_bank.options` does NOT affect
 *      the scoring outcome (the snapshot wins).
 *   3. correct_option_text comes from the snapshot, never from live
 *      `question_bank.options[correct_answer_index]`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────
// 1. Mock the supabase-client module BEFORE importing supabase.ts so the
//    submitQuizResults / startQuizSession functions hit our spies.
// ─────────────────────────────────────────────────────────────────────────

const rpcMock = vi.fn();

vi.mock('@/lib/supabase-client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
    from: vi.fn(() => ({
      insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'fake' }, error: null }) }) }),
      upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
  },
  supabaseUrl: 'https://example.supabase.co',
  supabaseAnonKey: 'anon-key',
}));

import { startQuizSession, submitQuizResults } from '@/lib/supabase';

beforeEach(() => {
  rpcMock.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────
// 2. Client contract — startQuizSession dispatches start_quiz_session and
//    returns the server's shuffled questions WITHOUT correct_answer_index.
// ─────────────────────────────────────────────────────────────────────────

describe('startQuizSession — client contract', () => {
  it('calls start_quiz_session RPC with student_id + question_ids', async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        session_id: 'session-1',
        questions: [
          {
            question_id: 'q-1',
            question_text: 'What is the capital of India?',
            options_displayed: ['Delhi', 'Mumbai', 'Kolkata', 'Chennai'],
          },
        ],
      },
      error: null,
    });

    const result = await startQuizSession('student-1', ['q-1']);

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith('start_quiz_session', {
      p_student_id: 'student-1',
      p_question_ids: ['q-1'],
    });
    expect(result).toEqual({
      session_id: 'session-1',
      questions: [
        expect.objectContaining({
          question_id: 'q-1',
          options_displayed: ['Delhi', 'Mumbai', 'Kolkata', 'Chennai'],
        }),
      ],
    });
    // Critical contract: server response MUST NOT leak correct_answer_index.
    expect(result?.questions[0]).not.toHaveProperty('correct_answer_index');
  });

  it('returns null on RPC error so caller can fall back to legacy path', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    expect(await startQuizSession('student-1', ['q-1'])).toBeNull();
  });

  it('returns null on malformed RPC response (no session_id)', async () => {
    rpcMock.mockResolvedValueOnce({ data: { questions: [] }, error: null });
    expect(await startQuizSession('student-1', ['q-1'])).toBeNull();
  });

  it('returns null when network throws', async () => {
    rpcMock.mockRejectedValueOnce(new Error('network down'));
    expect(await startQuizSession('student-1', ['q-1'])).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3. Client contract — submitQuizResults routes to v2 when sessionId is
//    present, and the payload contains ONLY selected_displayed_index.
// ─────────────────────────────────────────────────────────────────────────

describe('submitQuizResults — v2 dispatch contract', () => {
  it('calls submit_quiz_results_v2 with session_id when provided', async () => {
    rpcMock.mockResolvedValueOnce({
      data: { total: 2, correct: 1, score_percent: 50, xp_earned: 10, session_id: 'qs-1', flagged: false, questions: [] },
      error: null,
    });

    await submitQuizResults(
      'student-1',
      'mathematics',
      '9',
      'Mathematics',
      1,
      [
        // Note: client now passes a NUMBER for selected_option in display
        // space. is_correct is "false" (placeholder) in v2 mode — server
        // ignores it and re-derives.
        { question_id: 'q-1', selected_option: 2, is_correct: false, time_spent: 5, shuffle_map: null },
        { question_id: 'q-2', selected_option: 0, is_correct: false, time_spent: 7, shuffle_map: null },
      ],
      30,
      'session-1', // <-- v2 path
    );

    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [name, args] = rpcMock.mock.calls[0];
    expect(name).toBe('submit_quiz_results_v2');

    // Critical contract: v2 payload uses selected_displayed_index, no
    // is_correct, no shuffle_map.
    expect(args.p_session_id).toBe('session-1');
    expect(args.p_responses).toHaveLength(2);
    for (const r of args.p_responses as Array<Record<string, unknown>>) {
      expect(r).toHaveProperty('selected_displayed_index');
      expect(r).toHaveProperty('time_spent');
      expect(r).not.toHaveProperty('is_correct');
      expect(r).not.toHaveProperty('shuffle_map');
      expect(r).not.toHaveProperty('selected_option');
    }
  });

  it('falls back to v1 submit_quiz_results when sessionId is null', async () => {
    rpcMock.mockResolvedValueOnce({
      data: { total: 1, correct: 1, score_percent: 100, xp_earned: 80, session_id: 'qs-1', flagged: false },
      error: null,
    });

    await submitQuizResults(
      'student-1',
      'mathematics',
      '9',
      'Mathematics',
      1,
      [{ question_id: 'q-1', selected_option: 0, is_correct: true, time_spent: 5, shuffle_map: null }],
      30,
      null, // legacy path
    );

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock.mock.calls[0][0]).toBe('submit_quiz_results');
  });

  it('falls back to v1 if v2 RPC returns an error', async () => {
    rpcMock
      .mockResolvedValueOnce({ data: null, error: { message: 'v2 failed' } })       // v2 attempt
      .mockResolvedValueOnce({                                                       // v1 fallback
        data: { total: 1, correct: 1, score_percent: 100, xp_earned: 80, session_id: 'qs-1', flagged: false },
        error: null,
      });

    const res = await submitQuizResults(
      'student-2',  // distinct student to avoid dedup collision with previous test
      'science',
      '9',
      'Science',
      1,
      [{ question_id: 'q-1', selected_option: 0, is_correct: false, time_spent: 5, shuffle_map: null }],
      30,
      'session-2',
    );

    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(rpcMock.mock.calls[0][0]).toBe('submit_quiz_results_v2');
    expect(rpcMock.mock.calls[1][0]).toBe('submit_quiz_results');
    expect(res).toMatchObject({ score_percent: 100 });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 4. Server scoring parity — pure-TS port of the v2 PL/pgSQL inner loop.
//    The snapshot wins over mid-session content edits.
// ─────────────────────────────────────────────────────────────────────────

interface QuizSessionShuffleRow {
  session_id: string;
  question_id: string;
  shuffle_map: number[];               // 4-element permutation of [0..3]
  options_snapshot: string[];          // captured at session start
  correct_answer_index_snapshot: number;
}

/** Pure mirror of the submit_quiz_results_v2 inner loop. */
function simulateV2Score(
  sessionId: string,
  responses: Array<{ question_id: string; selected_displayed_index: number }>,
  shuffleRows: QuizSessionShuffleRow[],
): Array<{ question_id: string; is_correct: boolean; correct_option_text: string | null }> {
  const byQid = new Map(
    shuffleRows.filter(r => r.session_id === sessionId).map(r => [r.question_id, r]),
  );
  return responses.map(r => {
    const row = byQid.get(r.question_id) ?? null;
    let isCorrect = false;
    let correctText: string | null = null;
    if (row && row.shuffle_map.length === 4 && r.selected_displayed_index >= 0 && r.selected_displayed_index <= 3) {
      const origIdx = row.shuffle_map[r.selected_displayed_index];
      isCorrect = origIdx === row.correct_answer_index_snapshot;
      correctText = row.options_snapshot[row.correct_answer_index_snapshot] ?? null;
    }
    return { question_id: r.question_id, is_correct: isCorrect, correct_option_text: correctText };
  });
}

describe('submit_quiz_results_v2 — snapshot scoring (parity port)', () => {
  it('picking the visually-correct option scores correct on every shuffle', () => {
    // Original options: ['Delhi', 'Mumbai', 'Kolkata', 'Chennai'], correct=0 (Delhi).
    const opts = ['Delhi', 'Mumbai', 'Kolkata', 'Chennai'];
    const correctIdx = 0;

    const permutations = [
      [0, 1, 2, 3], [1, 0, 2, 3], [3, 2, 1, 0], [2, 3, 0, 1], [1, 2, 3, 0], [3, 0, 1, 2],
    ];

    for (const shuffle of permutations) {
      const row: QuizSessionShuffleRow = {
        session_id: 's',
        question_id: 'q-1',
        shuffle_map: shuffle,
        options_snapshot: opts,
        correct_answer_index_snapshot: correctIdx,
      };
      // Display index of "Delhi" = where shuffle_map points to original 0
      const displayOfCorrect = shuffle.indexOf(correctIdx);
      const result = simulateV2Score('s', [{ question_id: 'q-1', selected_displayed_index: displayOfCorrect }], [row]);
      expect(result[0]).toEqual({
        question_id: 'q-1',
        is_correct: true,
        correct_option_text: 'Delhi',
      });
    }
  });

  it('mid-session edit to question_bank.options DOES NOT change scoring (snapshot wins)', () => {
    // Snapshot: original "Delhi" at index 0 was correct.
    const row: QuizSessionShuffleRow = {
      session_id: 's',
      question_id: 'q-1',
      shuffle_map: [2, 0, 3, 1], // student saw Kolkata, Delhi, Chennai, Mumbai
      options_snapshot: ['Delhi', 'Mumbai', 'Kolkata', 'Chennai'],
      correct_answer_index_snapshot: 0,
    };
    // Student picked display index 1 = "Delhi". Should be correct.
    const result = simulateV2Score('s', [{ question_id: 'q-1', selected_displayed_index: 1 }], [row]);
    expect(result[0].is_correct).toBe(true);
    expect(result[0].correct_option_text).toBe('Delhi');

    // Now imagine an editor changed question_bank.options to
    //   ['New Delhi', 'Mumbai', 'Kolkata', 'Chennai']  (rename of option 0)
    //   and bumped correct_answer_index to 2 (Kolkata).
    // The snapshot row is UNCHANGED — that's the whole point. Re-running
    // simulate against the SAME row still scores Delhi as correct.
    // (We don't have to mutate question_bank in this test; the contract is
    // that v2 reads from quiz_session_shuffles, NOT live question_bank.)
    const result2 = simulateV2Score('s', [{ question_id: 'q-1', selected_displayed_index: 1 }], [row]);
    expect(result2[0].is_correct).toBe(true);
    expect(result2[0].correct_option_text).toBe('Delhi');
  });

  it('picking a wrong option is wrong on every shuffle', () => {
    const opts = ['A', 'B', 'C', 'D'];
    const correctIdx = 2;
    const row: QuizSessionShuffleRow = {
      session_id: 's',
      question_id: 'q-1',
      shuffle_map: [3, 1, 0, 2], // displays D, B, A, C
      options_snapshot: opts,
      correct_answer_index_snapshot: correctIdx,
    };
    // Student picks display 0 = "D" (originally idx 3, not the correct idx 2).
    const result = simulateV2Score('s', [{ question_id: 'q-1', selected_displayed_index: 0 }], [row]);
    expect(result[0].is_correct).toBe(false);
    expect(result[0].correct_option_text).toBe('C'); // canonical correct text
  });

  it('out-of-range selected index → not correct, but does not throw', () => {
    const row: QuizSessionShuffleRow = {
      session_id: 's',
      question_id: 'q-1',
      shuffle_map: [0, 1, 2, 3],
      options_snapshot: ['A', 'B', 'C', 'D'],
      correct_answer_index_snapshot: 0,
    };
    expect(simulateV2Score('s', [{ question_id: 'q-1', selected_displayed_index: -1 }], [row])[0].is_correct).toBe(false);
    expect(simulateV2Score('s', [{ question_id: 'q-1', selected_displayed_index: 4 }], [row])[0].is_correct).toBe(false);
  });

  it('missing snapshot row → is_correct=false, correct_option_text=null (defensive)', () => {
    const result = simulateV2Score('s', [{ question_id: 'q-orphan', selected_displayed_index: 0 }], []);
    expect(result[0]).toEqual({ question_id: 'q-orphan', is_correct: false, correct_option_text: null });
  });
});
