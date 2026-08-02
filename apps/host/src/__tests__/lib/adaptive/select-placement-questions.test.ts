import { describe, it, expect } from 'vitest';
import {
  selectPlacementQuestions,
  type PlacementClient,
  type PlacementQueryBuilder,
} from '@alfanumrik/lib/adaptive/select-placement-questions';

/**
 * selectPlacementQuestions() — cold-start placement-probe selector
 * (packages/lib/src/adaptive/select-placement-questions.ts).
 *
 * Pins:
 *  1. P6 shape guard: rejects malformed question_bank rows (wrong option
 *     count, missing/empty text, out-of-range or non-numeric
 *     correct_answer_index, non-mcq question_type) rather than serving them.
 *  2. P5: grade is passed through to the query verbatim as a string, never
 *     coerced/parsed as a number.
 *  3. One-per-chapter coverage: at most one usable question per
 *     chapter_number, in chapter order.
 *  4. Thin-bank top-up: when fewer than `count` distinct chapters have a
 *     usable question, tops up with additional usable rows (ignoring the
 *     one-per-chapter rule) rather than returning fewer than requested.
 *  5. Never throws: a query error or a thrown exception both resolve to [].
 *  6. topic_id is selected and passed through as `topicId` (parity fix vs.
 *     the reviewed handoff draft, which never selected the column).
 */

// ── Mock PlacementClient ─────────────────────────────────────────────────────

interface QueryLog {
  table: string | null;
  selectCols: string | null;
  eqCalls: Array<[string, unknown]>;
  inCalls: Array<[string, unknown[]]>;
  orderCalls: Array<[string, { ascending: boolean }]>;
  limitArg: number | null;
}

function makeClient(
  rows: unknown[] | null,
  opts: { error?: { message: string } | null; throwOnFrom?: boolean } = {},
): { client: PlacementClient; log: QueryLog } {
  const log: QueryLog = {
    table: null,
    selectCols: null,
    eqCalls: [],
    inCalls: [],
    orderCalls: [],
    limitArg: null,
  };

  const builder: PlacementQueryBuilder = {
    select(cols: string) {
      log.selectCols = cols;
      return builder;
    },
    eq(col: string, val: unknown) {
      log.eqCalls.push([col, val]);
      return builder;
    },
    in(col: string, vals: unknown[]) {
      log.inCalls.push([col, vals]);
      return builder;
    },
    order(col: string, o: { ascending: boolean }) {
      log.orderCalls.push([col, o]);
      return builder;
    },
    limit(n: number) {
      log.limitArg = n;
      if (opts.throwOnFrom) throw new Error('should not reach limit() when from() throws');
      return Promise.resolve({ data: opts.error ? null : rows, error: opts.error ?? null });
    },
  };

  const client: PlacementClient = {
    from(table: string) {
      log.table = table;
      if (opts.throwOnFrom) throw new Error('simulated connection failure');
      return builder;
    },
  };

  return { client, log };
}

/** A minimally-valid, usable question_bank row. */
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'q-1',
    question_text: 'What is 2 + 2?',
    question_hi: '2 + 2 क्या है?',
    question_type: 'mcq',
    options: ['2', '3', '4', '5'],
    correct_answer_index: 2,
    bloom_level: 'remember',
    chapter_number: 1,
    concept_tag: 'addition',
    subject: 'math',
    grade: '6',
    is_active: true,
    topic_id: 'topic-1',
    ...overrides,
  };
}

describe('selectPlacementQuestions — query construction', () => {
  it('queries question_bank with subject/grade/is_active/bloom_level filters', async () => {
    const { client, log } = makeClient([row()]);
    await selectPlacementQuestions(client, { subject: 'math', grade: '9' });

    expect(log.table).toBe('question_bank');
    expect(log.selectCols).toContain('topic_id');
    expect(log.eqCalls).toContainEqual(['subject', 'math']);
    expect(log.eqCalls).toContainEqual(['grade', '9']);
    expect(log.eqCalls).toContainEqual(['is_active', true]);
    expect(log.inCalls).toContainEqual(['bloom_level', ['remember', 'understand', 'apply']]);
    expect(log.orderCalls).toContainEqual(['chapter_number', { ascending: true }]);
  });

  it('P5: passes grade through verbatim as a string, never coerced', async () => {
    const { client, log } = makeClient([row({ grade: '11' })]);
    await selectPlacementQuestions(client, { subject: 'science', grade: '11' });
    const gradeCall = log.eqCalls.find(([col]) => col === 'grade');
    expect(gradeCall?.[1]).toBe('11');
    expect(typeof gradeCall?.[1]).toBe('string');
  });

  it('defaults count to 6 and requests count*12 rows when count is omitted', async () => {
    const { client, log } = makeClient([row()]);
    await selectPlacementQuestions(client, { subject: 'math', grade: '9' });
    expect(log.limitArg).toBe(6 * 12);
  });

  it('requests the caller-specified count*12', async () => {
    const { client, log } = makeClient([row()]);
    await selectPlacementQuestions(client, { subject: 'math', grade: '9', count: 3 });
    expect(log.limitArg).toBe(3 * 12);
  });

  it('returns [] immediately without querying when count <= 0', async () => {
    const { client, log } = makeClient([row()]);
    const result = await selectPlacementQuestions(client, { subject: 'math', grade: '9', count: 0 });
    expect(result).toEqual([]);
    expect(log.table).toBeNull();
  });
});

describe('selectPlacementQuestions — P6 shape guard', () => {
  it('rejects a row with fewer than 4 options', async () => {
    const { client } = makeClient([row({ id: 'bad', options: ['1', '2', '3'] })]);
    const result = await selectPlacementQuestions(client, { subject: 'math', grade: '9' });
    expect(result).toEqual([]);
  });

  it('rejects a row with more than 4 options', async () => {
    const { client } = makeClient([row({ id: 'bad', options: ['1', '2', '3', '4', '5'] })]);
    const result = await selectPlacementQuestions(client, { subject: 'math', grade: '9' });
    expect(result).toEqual([]);
  });

  it('rejects a row with empty question_text', async () => {
    const { client } = makeClient([row({ id: 'bad', question_text: '' })]);
    const result = await selectPlacementQuestions(client, { subject: 'math', grade: '9' });
    expect(result).toEqual([]);
  });

  it('rejects a row with non-string question_text', async () => {
    const { client } = makeClient([row({ id: 'bad', question_text: null })]);
    const result = await selectPlacementQuestions(client, { subject: 'math', grade: '9' });
    expect(result).toEqual([]);
  });

  it('rejects a row whose question_type is not mcq', async () => {
    const { client } = makeClient([row({ id: 'bad', question_type: 'fill_blank' })]);
    const result = await selectPlacementQuestions(client, { subject: 'math', grade: '9' });
    expect(result).toEqual([]);
  });

  it('treats a missing question_type as mcq (defaults, does not reject)', async () => {
    const { client } = makeClient([row({ id: 'ok', question_type: undefined })]);
    const result = await selectPlacementQuestions(client, { subject: 'math', grade: '9' });
    expect(result).toHaveLength(1);
  });

  it.each([-1, 4, 5, -100])(
    'rejects a row with out-of-range correct_answer_index (%i)',
    async (badIndex) => {
      const { client } = makeClient([row({ id: 'bad', correct_answer_index: badIndex })]);
      const result = await selectPlacementQuestions(client, { subject: 'math', grade: '9' });
      expect(result).toEqual([]);
    },
  );

  it.each([0, 1, 2, 3])('accepts a row with in-range correct_answer_index (%i)', async (goodIndex) => {
    const { client } = makeClient([row({ id: 'ok', correct_answer_index: goodIndex })]);
    const result = await selectPlacementQuestions(client, { subject: 'math', grade: '9' });
    expect(result).toHaveLength(1);
  });

  it('rejects a row with a non-numeric correct_answer_index', async () => {
    const { client } = makeClient([row({ id: 'bad', correct_answer_index: '2' })]);
    const result = await selectPlacementQuestions(client, { subject: 'math', grade: '9' });
    expect(result).toEqual([]);
  });

  it('rejects a row with a non-string id', async () => {
    const { client } = makeClient([row({ id: 42 })]);
    const result = await selectPlacementQuestions(client, { subject: 'math', grade: '9' });
    expect(result).toEqual([]);
  });

  // BUG FOUND THIS SESSION (testing, 2026-08-02) — currently FAILING.
  // select-placement-questions.ts's own JSDoc promises "Never throws: on any
  // data-layer failure it returns an empty array", and isUsable()'s first
  // line (`if (!q || typeof q.id !== 'string') return false;`) shows the
  // author explicitly intended to guard against a falsy row. That guard DOES
  // work on the primary one-per-chapter pass (isUsable(q) is checked before
  // any property access). But the thin-bank top-up pass checks
  // `chosen.has(q.id) || !isUsable(q)` — `q.id` is dereferenced by the LEFT
  // operand of `||` BEFORE isUsable(q) gets a chance to null-check it, so a
  // null/undefined row reaching the top-up pass throws
  // "TypeError: Cannot read properties of null (reading 'id')" instead of
  // being filtered out. The route (GET /api/v2/placement) catches this at the
  // top-level try/catch and turns it into a 500, so it is not a crash-the-
  // server bug, but it DOES break the function's own stated "never throws /
  // degrades to []" contract and turns "skip placement gracefully" into
  // "500 error" for the student. Not expected from a real Supabase SELECT
  // (row entries are never literally null), but isUsable()'s own guard shows
  // the author considered it a real case to defend against.
  // Fix (for whichever agent owns packages/lib/src/adaptive/select-placement-questions.ts):
  // swap the top-up condition to `!isUsable(q) || chosen.has(q.id)` (or
  // null-check q before touching q.id), matching the primary pass's order.
  // Left FAILING (not .skip'd) so Gate 3 blocks commit until fixed — see the
  // testing agent's report for the flag to assessment/backend.
  it('BUG: thin-bank top-up pass crashes (not returns []) on a null/undefined row — evaluation-order bug', async () => {
    const rows = [row({ id: 'ok', chapter_number: 2 }), null, undefined];
    const { client } = makeClient(rows);
    // Force the top-up pass to run: request more probes than the single
    // usable row can satisfy via the one-per-chapter pass alone.
    const result = await selectPlacementQuestions(client, { subject: 'math', grade: '9', count: 3 });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ok');
  });
});

describe('selectPlacementQuestions — topic_id passthrough', () => {
  it('resolves topicId from the row topic_id column', async () => {
    const { client } = makeClient([row({ id: 'q1', topic_id: 'topic-xyz' })]);
    const result = await selectPlacementQuestions(client, { subject: 'math', grade: '9' });
    expect(result[0].topicId).toBe('topic-xyz');
  });

  it('resolves topicId to null when topic_id is absent — never defaults to the question id', async () => {
    const { client } = makeClient([row({ id: 'q1', topic_id: undefined })]);
    const result = await selectPlacementQuestions(client, { subject: 'math', grade: '9' });
    expect(result[0].topicId).toBeNull();
    expect(result[0].topicId).not.toBe('q1');
  });

  it('resolves topicId to null when topic_id is not a string', async () => {
    const { client } = makeClient([row({ id: 'q1', topic_id: 12345 })]);
    const result = await selectPlacementQuestions(client, { subject: 'math', grade: '9' });
    expect(result[0].topicId).toBeNull();
  });
});

describe('selectPlacementQuestions — one-per-chapter coverage', () => {
  it('picks at most one usable question per chapter_number, in chapter order', async () => {
    const rows = [
      row({ id: 'c1-a', chapter_number: 1 }),
      row({ id: 'c1-b', chapter_number: 1 }),
      row({ id: 'c2-a', chapter_number: 2 }),
      row({ id: 'c3-a', chapter_number: 3 }),
    ];
    const { client } = makeClient(rows);
    // count:3 exactly matches the number of distinct usable chapters, so the
    // primary one-per-chapter pass alone satisfies the request and the
    // thin-bank top-up pass never fires (that pass is covered on its own
    // below). This isolates the one-per-chapter behaviour from top-up.
    const result = await selectPlacementQuestions(client, { subject: 'math', grade: '9', count: 3 });
    const ids = result.map((q) => q.id);
    expect(ids).toEqual(['c1-a', 'c2-a', 'c3-a']);
  });

  it('caps at `count` even when more distinct chapters are usable', async () => {
    const rows = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => row({ id: `c${n}`, chapter_number: n }));
    const { client } = makeClient(rows);
    const result = await selectPlacementQuestions(client, { subject: 'math', grade: '9', count: 6 });
    expect(result).toHaveLength(6);
  });

  it('treats a null chapter_number as its own bucket (-1), distinct from a real chapter', async () => {
    const rows = [
      row({ id: 'no-chapter-1', chapter_number: null }),
      row({ id: 'ch-1', chapter_number: 1 }),
    ];
    const { client } = makeClient(rows);
    const result = await selectPlacementQuestions(client, { subject: 'math', grade: '9', count: 6 });
    // Both are usable and land in DIFFERENT chapter buckets (-1 vs 1), so both
    // survive the one-per-chapter de-dupe.
    expect(result.map((q) => q.id).sort()).toEqual(['ch-1', 'no-chapter-1']);
  });

  it('de-dupes two rows that BOTH have a null chapter_number on the primary pass, then thin-bank top-up recovers the second', async () => {
    const rows = [
      row({ id: 'no-chapter-1', chapter_number: null }),
      row({ id: 'no-chapter-2', chapter_number: null }),
    ];
    const { client } = makeClient(rows);
    const result = await selectPlacementQuestions(client, { subject: 'math', grade: '9', count: 6 });
    // Primary (one-per-chapter) pass: both map to the SAME (-1) bucket, so
    // only 'no-chapter-1' survives that pass. Since picked.length (1) is
    // still below count (6), the thin-bank top-up pass runs and adds
    // 'no-chapter-2' (a distinct, still-usable, not-yet-chosen id). Net
    // result: both ids present, each exactly once.
    expect(result.map((q) => q.id).sort()).toEqual(['no-chapter-1', 'no-chapter-2']);
  });
});

describe('selectPlacementQuestions — thin-bank top-up', () => {
  it('tops up past the one-per-chapter rule when fewer than `count` chapters are usable', async () => {
    // Only 2 distinct chapters have usable rows, but chapter 1 has 3 usable
    // rows total — thin-bank top-up should pull the extras to reach count=4.
    const rows = [
      row({ id: 'c1-a', chapter_number: 1 }),
      row({ id: 'c1-b', chapter_number: 1 }),
      row({ id: 'c1-c', chapter_number: 1 }),
      row({ id: 'c2-a', chapter_number: 2 }),
    ];
    const { client } = makeClient(rows);
    const result = await selectPlacementQuestions(client, { subject: 'math', grade: '9', count: 4 });
    expect(result).toHaveLength(4);
    const ids = result.map((q) => q.id);
    expect(new Set(ids).size).toBe(4); // no duplicate ids even under top-up
  });

  it('never returns duplicate ids during top-up', async () => {
    const rows = [
      row({ id: 'only-one', chapter_number: 1 }),
    ];
    const { client } = makeClient(rows);
    const result = await selectPlacementQuestions(client, { subject: 'math', grade: '9', count: 6 });
    // Thin bank: only one usable row exists at all, so the result is 1, not 6
    // padded with repeats of the same id.
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('only-one');
  });

  it('top-up still respects the P6 usability guard (never serves an unusable row to pad)', async () => {
    const rows = [
      row({ id: 'ok', chapter_number: 1 }),
      row({ id: 'bad', chapter_number: 1, options: ['only-one'] }),
    ];
    const { client } = makeClient(rows);
    const result = await selectPlacementQuestions(client, { subject: 'math', grade: '9', count: 6 });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ok');
  });
});

describe('selectPlacementQuestions — Hindi/English stem selection', () => {
  it('uses question_text when isHi is false, even if question_hi exists', async () => {
    const { client } = makeClient([row({ question_text: 'English stem', question_hi: 'हिंदी स्टेम' })]);
    const result = await selectPlacementQuestions(client, { subject: 'math', grade: '9' }, false);
    expect(result[0].stem).toBe('English stem');
  });

  it('uses question_hi when isHi is true and question_hi is non-empty', async () => {
    const { client } = makeClient([row({ question_text: 'English stem', question_hi: 'हिंदी स्टेम' })]);
    const result = await selectPlacementQuestions(client, { subject: 'math', grade: '9' }, true);
    expect(result[0].stem).toBe('हिंदी स्टेम');
  });

  it('falls back to question_text when isHi is true but question_hi is empty/absent', async () => {
    const { client } = makeClient([row({ question_text: 'English stem', question_hi: '' })]);
    const result = await selectPlacementQuestions(client, { subject: 'math', grade: '9' }, true);
    expect(result[0].stem).toBe('English stem');
  });
});

describe('selectPlacementQuestions — options parsing', () => {
  it('parses a JSON-string-encoded options array', async () => {
    const { client } = makeClient([row({ options: JSON.stringify(['1', '2', '3', '4']) })]);
    const result = await selectPlacementQuestions(client, { subject: 'math', grade: '9' });
    expect(result).toHaveLength(1);
    expect(result[0].options).toHaveLength(4);
  });

  it('rejects malformed JSON-string options (parses to [], fails the length-4 check)', async () => {
    const { client } = makeClient([row({ options: '{not valid json' })]);
    const result = await selectPlacementQuestions(client, { subject: 'math', grade: '9' });
    expect(result).toEqual([]);
  });

  it('maps string options to {id, label} with 0-based string ids', async () => {
    const { client } = makeClient([row({ options: ['a', 'b', 'c', 'd'] })]);
    const result = await selectPlacementQuestions(client, { subject: 'math', grade: '9' });
    expect(result[0].options).toEqual([
      { id: '0', label: 'a' },
      { id: '1', label: 'b' },
      { id: '2', label: 'c' },
      { id: '3', label: 'd' },
    ]);
  });

  it('maps object options carrying a .text field', async () => {
    const { client } = makeClient([
      row({ options: [{ text: 'w' }, { text: 'x' }, { text: 'y' }, { text: 'z' }] }),
    ]);
    const result = await selectPlacementQuestions(client, { subject: 'math', grade: '9' });
    expect(result[0].options.map((o) => o.label)).toEqual(['w', 'x', 'y', 'z']);
  });
});

describe('selectPlacementQuestions — failure modes never throw', () => {
  it('returns [] when the query resolves an error', async () => {
    const { client } = makeClient(null, { error: { message: 'permission denied' } });
    const result = await selectPlacementQuestions(client, { subject: 'math', grade: '9' });
    expect(result).toEqual([]);
  });

  it('returns [] when data is not an array', async () => {
    const rows = 'not-an-array' as unknown as unknown[];
    const { client } = makeClient(rows);
    const result = await selectPlacementQuestions(client, { subject: 'math', grade: '9' });
    expect(result).toEqual([]);
  });

  it('returns [] (never throws) when the client itself throws', async () => {
    const { client } = makeClient([row()], { throwOnFrom: true });
    await expect(selectPlacementQuestions(client, { subject: 'math', grade: '9' })).resolves.toEqual([]);
  });

  it('returns [] (never throws) when a query method rejects', async () => {
    const client: PlacementClient = {
      from: () => {
        const builder: PlacementQueryBuilder = {
          select: () => builder,
          eq: () => builder,
          in: () => builder,
          order: () => builder,
          limit: () => Promise.reject(new Error('network down')),
        };
        return builder;
      },
    };
    await expect(selectPlacementQuestions(client, { subject: 'math', grade: '9' })).resolves.toEqual([]);
  });
});
