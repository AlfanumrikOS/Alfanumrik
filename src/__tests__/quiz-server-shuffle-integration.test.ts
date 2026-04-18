/**
 * Server-side P1 scoring fix — algorithm-parity regression tests.
 *
 * The `submit_quiz_results` RPC (migration 20260418110000) translates the
 * client's `selected_option` (shuffled display index) back to the original
 * pre-shuffle index via the payload's `shuffle_map` before comparing against
 * `question_bank.correct_answer_index`. The algorithm mirrors
 * `resolveOriginalIndex` in src/lib/quiz-scoring.ts — we test the helper
 * exhaustively here. Because Vitest can't run PL/pgSQL directly, the
 * migration comment documents the parity requirement and CI catches drift
 * on code review.
 *
 * Canary path: when the client-asserted `is_correct` in the payload
 * disagrees with the server-recomputed value, the RPC inserts an
 * `ops_events` row (category='grounding.scoring', severity='warning'). We
 * simulate that branch here by composing a small `simulateSubmitQuizRow`
 * mirror of the RPC's inner-loop logic and verifying the events-sink
 * receives the call.
 *
 * Related: src/__tests__/quiz-shuffle-scoring-fix.test.ts covers the
 * client-side 384-permutation contract.
 */

import { describe, it, expect, vi } from 'vitest';
import { resolveOriginalIndex, scoreAnswer } from '@/lib/quiz-scoring';

// ─────────────────────────────────────────────────────────────────────────
// 1. Pure helper: every coordinate-space translation the RPC performs.
// ─────────────────────────────────────────────────────────────────────────

describe('resolveOriginalIndex — mirrors submit_quiz_results PL/pgSQL', () => {
  it('shuffle_map [1,2,3,0] + selected=3 → original=0 (the regression case)', () => {
    expect(resolveOriginalIndex(3, [1, 2, 3, 0])).toBe(0);
  });

  it('shuffle_map [1,2,3,0] + selected=0 → original=1', () => {
    expect(resolveOriginalIndex(0, [1, 2, 3, 0])).toBe(1);
  });

  it('identity shuffle [0,1,2,3] leaves index unchanged', () => {
    for (let i = 0; i < 4; i++) expect(resolveOriginalIndex(i, [0, 1, 2, 3])).toBe(i);
  });

  it('shuffle_map null → selected returned as-is (non-shuffled surfaces)', () => {
    expect(resolveOriginalIndex(2, null)).toBe(2);
    expect(resolveOriginalIndex(0, null)).toBe(0);
    expect(resolveOriginalIndex(-1, null)).toBe(-1); // written-answer sentinel
  });

  it('shuffle_map undefined → selected returned as-is', () => {
    expect(resolveOriginalIndex(2, undefined)).toBe(2);
  });

  it('malformed shuffle_map (wrong length) falls back to selected as-is', () => {
    expect(resolveOriginalIndex(2, [0, 1, 2])).toBe(2); // len 3
    expect(resolveOriginalIndex(2, [0, 1, 2, 3, 4])).toBe(2); // len 5
    expect(resolveOriginalIndex(2, [])).toBe(2); // empty
  });

  it('malformed shuffle_map (non-number entries) falls back to selected as-is', () => {
    // TypeScript would catch these, but the payload is a runtime JSONB array —
    // adversarial or buggy clients can send strings/nulls.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(resolveOriginalIndex(2, ['0', '1', '2', '3'] as any)).toBe(2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(resolveOriginalIndex(2, [null, 1, 2, 3] as any)).toBe(2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(resolveOriginalIndex(2, [0, 1, 2, 4] as any)).toBe(2); // out-of-range entry
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(resolveOriginalIndex(2, [1.5, 2.5, 0.1, 3] as any)).toBe(2); // non-integer
  });

  it('out-of-range selected returns as-is (equality then fails downstream)', () => {
    expect(resolveOriginalIndex(-1, [1, 2, 3, 0])).toBe(-1);
    expect(resolveOriginalIndex(4, [1, 2, 3, 0])).toBe(4);
    expect(resolveOriginalIndex(99, [1, 2, 3, 0])).toBe(99);
  });

  it('never throws on any input permutation', () => {
    const badInputs: Array<[number, unknown]> = [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [0, 'abc' as any],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [0, { not: 'array' } as any],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [0, NaN as any],
    ];
    for (const [sel, map] of badInputs) {
      expect(() => resolveOriginalIndex(sel, map as number[] | null)).not.toThrow();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. Exhaustive parity: the RPC must agree with the client helper on every
//    shuffle permutation the server can ever see (384 = 24 * 4 * 4 cases).
// ─────────────────────────────────────────────────────────────────────────

describe('scoreAnswer parity across all 24 shuffle permutations', () => {
  const permutations: number[][] = [
    [0, 1, 2, 3], [0, 1, 3, 2], [0, 2, 1, 3], [0, 2, 3, 1], [0, 3, 1, 2], [0, 3, 2, 1],
    [1, 0, 2, 3], [1, 0, 3, 2], [1, 2, 0, 3], [1, 2, 3, 0], [1, 3, 0, 2], [1, 3, 2, 0],
    [2, 0, 1, 3], [2, 0, 3, 1], [2, 1, 0, 3], [2, 1, 3, 0], [2, 3, 0, 1], [2, 3, 1, 0],
    [3, 0, 1, 2], [3, 0, 2, 1], [3, 1, 0, 2], [3, 1, 2, 0], [3, 2, 0, 1], [3, 2, 1, 0],
  ];

  it('picking the visually-correct option always scores correct (all permutations × all originals)', () => {
    for (const shuffle of permutations) {
      for (let origCorrect = 0; origCorrect < 4; origCorrect++) {
        const displayOfCorrect = shuffle.indexOf(origCorrect);
        expect(
          scoreAnswer(displayOfCorrect, shuffle, origCorrect),
          `shuffle=${JSON.stringify(shuffle)} orig=${origCorrect} display=${displayOfCorrect}`,
        ).toBe(true);

        for (let pick = 0; pick < 4; pick++) {
          if (pick === displayOfCorrect) continue;
          expect(
            scoreAnswer(pick, shuffle, origCorrect),
            `shuffle=${JSON.stringify(shuffle)} orig=${origCorrect} wrong=${pick}`,
          ).toBe(false);
        }
      }
    }
  });

  it('null shuffle_map: selected is already in original space (mobile / diagnostic)', () => {
    for (let orig = 0; orig < 4; orig++) {
      expect(scoreAnswer(orig, null, orig)).toBe(true);
      for (let wrong = 0; wrong < 4; wrong++) {
        if (wrong === orig) continue;
        expect(scoreAnswer(wrong, null, orig)).toBe(false);
      }
    }
  });

  it('malformed shuffle_map: falls back to treating selected as original-space (no throw)', () => {
    // This is the behaviour an adversarial / buggy payload gets: the RPC does
    // not reward the mismatch; it simply uses the un-translated index so the
    // usual correctness equality applies.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => scoreAnswer(2, [0, 1] as any, 2)).not.toThrow();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(scoreAnswer(2, [0, 1] as any, 2)).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(scoreAnswer(2, [0, 1] as any, 0)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3. Canary path: mirror of the RPC's client/server disagreement detector.
//    When client's is_correct != server's recomputed is_correct, the RPC
//    writes to ops_events. We simulate the detector logic here and verify
//    the event-sink is invoked.
// ─────────────────────────────────────────────────────────────────────────

interface OpsEventSink {
  insert: (row: {
    category: string;
    source: string;
    severity: string;
    message: string;
    context: Record<string, unknown>;
  }) => void;
}

/**
 * Pure mirror of the RPC's per-row processing used for the canary check.
 * Must stay aligned with the PL/pgSQL in migration 20260418110000 — keep
 * the two implementations in sync.
 */
function simulateSubmitQuizRow(
  payload: {
    question_id: string;
    selected_option: number;
    is_correct?: boolean;
    shuffle_map?: number[] | null;
  },
  questionBankCorrectIdx: number,
  opsSink: OpsEventSink,
  studentId = 'student-1',
  sessionId = 'session-1',
): { server_is_correct: boolean; canary_fired: boolean } {
  const serverIsCorrect = scoreAnswer(
    payload.selected_option,
    payload.shuffle_map,
    questionBankCorrectIdx,
  );

  let canaryFired = false;
  if (typeof payload.is_correct === 'boolean' && payload.is_correct !== serverIsCorrect) {
    opsSink.insert({
      category: 'grounding.scoring',
      source: 'submit_quiz_results',
      severity: 'warning',
      message: 'Client/server is_correct disagreement on quiz_response',
      context: {
        student_id: studentId,
        session_id: sessionId,
        question_id: payload.question_id,
        client_flag: payload.is_correct,
        server_flag: serverIsCorrect,
        selected_option: payload.selected_option,
        shuffle_map: payload.shuffle_map ?? null,
      },
    });
    canaryFired = true;
  }

  return { server_is_correct: serverIsCorrect, canary_fired: canaryFired };
}

describe('canary: client/server is_correct disagreement → ops_events row', () => {
  it('no canary when client and server agree (post-fix happy path)', () => {
    const sink: OpsEventSink = { insert: vi.fn() };
    const res = simulateSubmitQuizRow(
      { question_id: 'q-1', selected_option: 3, is_correct: true, shuffle_map: [1, 2, 3, 0] },
      0, // original correct
      sink,
    );
    expect(res.server_is_correct).toBe(true);
    expect(res.canary_fired).toBe(false);
    expect(sink.insert).not.toHaveBeenCalled();
  });

  it('canary fires when client says wrong but server computes right (the pre-fix contradiction)', () => {
    const sink: OpsEventSink = { insert: vi.fn() };
    const res = simulateSubmitQuizRow(
      { question_id: 'q-2', selected_option: 3, is_correct: false, shuffle_map: [1, 2, 3, 0] },
      0,
      sink,
    );
    expect(res.server_is_correct).toBe(true);
    expect(res.canary_fired).toBe(true);
    expect(sink.insert).toHaveBeenCalledTimes(1);
    expect(sink.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'grounding.scoring',
        source: 'submit_quiz_results',
        severity: 'warning',
        message: 'Client/server is_correct disagreement on quiz_response',
        context: expect.objectContaining({
          question_id: 'q-2',
          client_flag: false,
          server_flag: true,
          selected_option: 3,
          shuffle_map: [1, 2, 3, 0],
        }),
      }),
    );
  });

  it('canary fires when client says right but server computes wrong (inverse)', () => {
    const sink: OpsEventSink = { insert: vi.fn() };
    const res = simulateSubmitQuizRow(
      { question_id: 'q-3', selected_option: 2, is_correct: true, shuffle_map: [1, 2, 3, 0] },
      0, // display 3 is correct, student picked display 2 → wrong
      sink,
    );
    expect(res.server_is_correct).toBe(false);
    expect(res.canary_fired).toBe(true);
    expect(sink.insert).toHaveBeenCalledTimes(1);
  });

  it('no canary when client omits is_correct entirely (mobile, legacy payloads)', () => {
    const sink: OpsEventSink = { insert: vi.fn() };
    const res = simulateSubmitQuizRow(
      { question_id: 'q-4', selected_option: 3, shuffle_map: [1, 2, 3, 0] },
      0,
      sink,
    );
    expect(res.server_is_correct).toBe(true);
    expect(res.canary_fired).toBe(false);
    expect(sink.insert).not.toHaveBeenCalled();
  });

  it('no canary in the null-shuffle happy path (mobile sends shuffle_map: null, is_correct matches)', () => {
    const sink: OpsEventSink = { insert: vi.fn() };
    const res = simulateSubmitQuizRow(
      { question_id: 'q-5', selected_option: 2, is_correct: true, shuffle_map: null },
      2,
      sink,
    );
    expect(res.server_is_correct).toBe(true);
    expect(res.canary_fired).toBe(false);
    expect(sink.insert).not.toHaveBeenCalled();
  });

  it('malformed shuffle_map + mismatched client flag still fires canary (never throws)', () => {
    const sink: OpsEventSink = { insert: vi.fn() };
    expect(() =>
      simulateSubmitQuizRow(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { question_id: 'q-6', selected_option: 3, is_correct: true, shuffle_map: [9, 9, 9, 9] as any },
        0,
        sink,
      ),
    ).not.toThrow();
    // Falls back to selected=3 vs orig=0 → server says false. Client said true → canary fires.
    expect(sink.insert).toHaveBeenCalledTimes(1);
  });
});
