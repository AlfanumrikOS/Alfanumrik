/**
 * assembleQuiz — PYQ year-tagged preferred fetch (RUNG 0P).
 *
 * WHY THIS RUNG EXISTS
 * --------------------
 * `/pyq` used to be a second quiz runtime that ran this selector itself, in the
 * browser, alongside its own grading against a `correct_answer_index` it had
 * fetched — and persisted nothing. The runtime was deleted (Phase 5 track A).
 * The SELECTOR was worth keeping, so it moved here, where the questions it
 * chooses flow through the server shuffle snapshot, anti-cheat and the atomic
 * submit like any other quiz.
 *
 * WHAT IS PINNED
 * --------------
 *   - a year prefers `question_bank.tags`-matched rows, scoped to subject +
 *     grade + is_active (the retired page did NOT filter is_active);
 *   - a THIN year still yields a full quiz via the normal ladder — that is the
 *     old page's "fall back to generic rows" behaviour, preserved;
 *   - the shortfall is now MEASURED (`stats.pyqYearMatched`) instead of being
 *     relabelled as that year's paper behind a small badge;
 *   - no year → byte-identical behaviour to before (the rung does not run);
 *   - a failing PYQ query degrades to a normal quiz, never to an error.
 *
 * P1/P2/P3/P4 are untouched by anything here: this rung only decides WHICH
 * questions are served, never how they are scored.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const getQuizQuestionsV2 = vi.fn();
const fromSpy = vi.fn();

vi.mock('@alfanumrik/lib/supabase', () => ({
  getQuizQuestionsV2: (...args: unknown[]) => getQuizQuestionsV2(...args),
  supabase: { from: (...args: unknown[]) => fromSpy(...args) },
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { assembleQuiz } from '../quiz-assembler';

/** A P6-valid `question_bank` row. */
function q(id: string, tags: string[] | null = null) {
  return {
    id,
    question_text: `Which of these is the correct value for the expression in item ${id}?`,
    question_hi: null,
    question_type: 'mcq',
    options: [`Alpha ${id}`, `Beta ${id}`, `Gamma ${id}`, `Delta ${id}`],
    correct_answer_index: 1,
    explanation: `Beta is correct because the expression evaluates to that value under the stated rule for ${id}.`,
    explanation_hi: null,
    hint: null,
    difficulty: 2,
    bloom_level: 'understand',
    chapter_number: 3,
    tags,
  };
}

/**
 * Thenable query builder: every PostgREST method returns `this`, and awaiting
 * it resolves to the configured result. Mirrors how the real builder is used —
 * chained, conditionally extended, then awaited once.
 */
function queryBuilder(result: { data: unknown[] | null; error: unknown }) {
  const calls: Array<[string, unknown[]]> = [];
  const builder: Record<string, unknown> = {
    __calls: calls,
    then: (res: (v: unknown) => unknown) => Promise.resolve(result).then(res),
  };
  for (const m of ['select', 'eq', 'contains', 'limit', 'in', 'order', 'not']) {
    builder[m] = (...args: unknown[]) => {
      calls.push([m, args]);
      return builder;
    };
  }
  return builder;
}

const BASE = {
  subject: 'math',
  grade: '10' as const, // P5: grade is a STRING
  requestedCount: 5,
  difficulty: 'mixed',
  chapter: null,
  questionTypes: ['mcq'],
  mode: 'practice',
};

beforeEach(() => {
  getQuizQuestionsV2.mockReset();
  fromSpy.mockReset();
});

describe('no pyqYear — the rung does not run', () => {
  it('never touches question_bank directly and behaves as before', async () => {
    getQuizQuestionsV2.mockResolvedValue([q('a'), q('b'), q('c'), q('d'), q('e')]);

    const result = await assembleQuiz({ ...BASE });

    expect(fromSpy).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.returnedCount).toBe(5);
    expect(result.stats.pyqYearMatched).toBe(0);
  });
});

describe('pyqYear set — year-tagged rows lead the quiz', () => {
  it('queries question_bank scoped to subject + grade + is_active + the year tag', async () => {
    const builder = queryBuilder({ data: [q('y1', ['2019']), q('y2', ['2019'])], error: null });
    fromSpy.mockReturnValue(builder);
    getQuizQuestionsV2.mockResolvedValue([q('p1'), q('p2'), q('p3')]);

    await assembleQuiz({ ...BASE, pyqYear: 2019 });

    expect(fromSpy).toHaveBeenCalledWith('question_bank');
    const calls = (builder as unknown as { __calls: Array<[string, unknown[]]> }).__calls;
    expect(calls).toContainEqual(['eq', ['subject', 'math']]);
    expect(calls).toContainEqual(['eq', ['grade', '10']]);
    expect(calls).toContainEqual(['eq', ['is_active', true]]);
    // The tag is the STRING form of the year — that is how PYQ rows are tagged.
    expect(calls).toContainEqual(['contains', ['tags', ['2019']]]);
  });

  it('serves the tagged rows FIRST and reports how many really carry the tag', async () => {
    fromSpy.mockReturnValue(
      queryBuilder({ data: [q('y1', ['2019']), q('y2', ['2019', 'board'])], error: null }),
    );
    getQuizQuestionsV2.mockResolvedValue([q('p1'), q('p2'), q('p3'), q('p4')]);

    const result = await assembleQuiz({ ...BASE, pyqYear: 2019 });

    expect(result.success).toBe(true);
    expect(result.questions.slice(0, 2).map((x: { id: string }) => x.id)).toEqual(['y1', 'y2']);
    // 2 of the 5 served questions are genuinely the 2019 paper.
    expect(result.stats.pyqYearMatched).toBe(2);
  });

  it('honours a chapter scope when one is requested', async () => {
    const builder = queryBuilder({ data: [q('y1', ['2019'])], error: null });
    fromSpy.mockReturnValue(builder);
    getQuizQuestionsV2.mockResolvedValue([q('p1'), q('p2'), q('p3'), q('p4')]);

    await assembleQuiz({ ...BASE, chapter: 3, pyqYear: 2019 });

    const calls = (builder as unknown as { __calls: Array<[string, unknown[]]> }).__calls;
    expect(calls).toContainEqual(['eq', ['chapter_number', 3]]);
  });
});

describe('a thin or missing year degrades to a full quiz, never to an error', () => {
  it('fills entirely from the normal ladder when the year has no tagged rows', async () => {
    fromSpy.mockReturnValue(queryBuilder({ data: [], error: null }));
    getQuizQuestionsV2.mockResolvedValue([q('p1'), q('p2'), q('p3'), q('p4'), q('p5')]);

    const result = await assembleQuiz({ ...BASE, pyqYear: 2011 });

    // This is the retired page's fallback, preserved — but now the fact that
    // ZERO questions are from 2011 is a recorded number, not a small badge.
    expect(result.success).toBe(true);
    expect(result.returnedCount).toBe(5);
    expect(result.stats.pyqYearMatched).toBe(0);
  });

  it('survives a failing PYQ query', async () => {
    fromSpy.mockReturnValue(queryBuilder({ data: null, error: new Error('permission denied') }));
    getQuizQuestionsV2.mockResolvedValue([q('p1'), q('p2'), q('p3'), q('p4'), q('p5')]);

    const result = await assembleQuiz({ ...BASE, pyqYear: 2019 });

    expect(result.success).toBe(true);
    expect(result.returnedCount).toBe(5);
  });

  it('survives the PYQ query throwing outright', async () => {
    fromSpy.mockImplementation(() => { throw new Error('network down'); });
    getQuizQuestionsV2.mockResolvedValue([q('p1'), q('p2'), q('p3'), q('p4'), q('p5')]);

    const result = await assembleQuiz({ ...BASE, pyqYear: 2019 });

    expect(result.success).toBe(true);
    expect(result.returnedCount).toBe(5);
  });
});

describe('year-tagged rows are NOT exempt from the P6 quality gate', () => {
  it('drops a malformed PYQ row rather than serving it because it has the right tag', async () => {
    const broken = { ...q('bad', ['2019']), options: ['Only', 'Three', 'Options'] };
    fromSpy.mockReturnValue(queryBuilder({ data: [broken, q('y1', ['2019'])], error: null }));
    getQuizQuestionsV2.mockResolvedValue([q('p1'), q('p2'), q('p3'), q('p4')]);

    const result = await assembleQuiz({ ...BASE, pyqYear: 2019 });

    expect(result.questions.map((x: { id: string }) => x.id)).not.toContain('bad');
    expect(result.returnedCount).toBe(5);
  });
});
