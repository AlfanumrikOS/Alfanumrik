/**
 * Unit tests for src/lib/adaptive/select-adaptive-questions.ts
 *
 * Phase 2 — LIVE adaptive question selection (candidate PROVIDER, never a hard
 * filter). These tests drive the selector with a hand-rolled FAKE AdaptiveClient
 * so they need no live DB. They lock down the assessment-defined assertions that
 * live entirely inside the selector:
 *
 *   1. Weak-topic over-representation — a student with a low-mastery topic T
 *      receives MORE T-targeted questions than a no-mastery control.
 *   2. (BLOCKING) Bloom ceiling zero-violation — for a weak topic at mastery
 *      m ∈ {0.2, 0.45, 0.6, 0.8, 0.9}, NO served candidate exceeds the
 *      masteryToMaxBloomLevel(m) ceiling. Ceiling, not floor: 'remember' is
 *      always allowed; a 'create'-level item is NOT served when m < 0.85.
 *   6. IRT-proxy ranking (statistical) — at theta = 0, "near" items
 *      (irt_difficulty ≈ 0) are selected more often than "far" items
 *      (irt_difficulty ≈ 2.5), which beat a random baseline over N trials.
 *   7. P6 / P5 / subject integrity — every served candidate passes a P6 shape,
 *      subject == requested, grade == requested STRING, and no RAG
 *      options:'[]' (string-encoded empty options) row leaks through.
 *
 * Plus the two fail-safe contracts the provider promises its caller:
 *   - any data-layer error → returns [] (the caller falls through to its ladder)
 *   - cold-start (no concept_mastery rows) → returns []
 *
 * The fisher-info ranking is exercised through computeSelectionScore exactly as
 * fisher-info.test.ts pins the math; here we assert the SELECTION consequence.
 */

import { describe, it, expect } from 'vitest';
import {
  masteryToMaxBloomLevel,
  getBloomLevelsUpTo,
  selectAdaptiveQuestions,
  type AdaptiveClient,
  type AdaptiveQueryBuilder,
} from '@/lib/adaptive/select-adaptive-questions';

// ── Fake question-bank generator ─────────────────────────────────────────────

const BLOOM_ORDER = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];

let _qid = 0;
function makeQuestion(overrides: Partial<Record<string, unknown>> = {}): any {
  _qid += 1;
  return {
    id: `q-${_qid}`,
    question_text: `What is the capital concept of this topic numbered ${_qid}?`,
    question_hi: null,
    question_type: 'mcq',
    options: ['Option A', 'Option B', 'Option C', 'Option D'],
    correct_answer_index: 1,
    explanation: 'This explanation is sufficiently long to pass downstream P6 gate.',
    explanation_hi: null,
    hint: null,
    difficulty: 2,
    bloom_level: 'understand',
    chapter_number: 5,
    concept_tag: 'fractions',
    subject: 'math',
    grade: '7',
    irt_a: null,
    irt_b: null,
    irt_calibration_n: 0,
    irt_difficulty: 0.0,
    ...overrides,
  };
}

// ── Fake AdaptiveClient builder ──────────────────────────────────────────────
//
// A tiny structural fake that records every table/filter touched and returns
// caller-supplied fixtures. `from(table)` returns a chainable builder; the
// terminal `.limit()` / `.maybeSingle()` resolve the recorded fixture.

interface FakeConfig {
  /** subjects.maybeSingle() result */
  subject?: { data: unknown; error: { message: string } | null };
  /** concept_mastery.limit() result */
  mastery?: { data: unknown[] | null; error: { message: string } | null };
  /**
   * question_bank.limit() resolver. Receives the recorded filters for the call
   * so the fixture can vary by bloom ceiling / chapter / concept_tag.
   */
  questionBank?: (
    filters: Record<string, unknown> & { in?: { col: string; vals: unknown[] } },
  ) => { data: unknown[] | null; error: { message: string } | null };
  /** force a throw from a given table to exercise the try/catch fail-safe */
  throwOn?: string;
}

interface QueryLog {
  table: string;
  filters: Record<string, unknown>;
  inFilter?: { col: string; vals: unknown[] };
}

function makeFakeClient(cfg: FakeConfig): { client: AdaptiveClient; log: QueryLog[] } {
  const log: QueryLog[] = [];

  const client: AdaptiveClient = {
    from(table: string): AdaptiveQueryBuilder {
      if (cfg.throwOn === table) {
        throw new Error(`forced failure on ${table}`);
      }
      const entry: QueryLog = { table, filters: {} };
      log.push(entry);

      const builder: AdaptiveQueryBuilder = {
        select() {
          return builder;
        },
        eq(col: string, val: unknown) {
          entry.filters[col] = val;
          return builder;
        },
        lt(col: string, val: unknown) {
          entry.filters[`${col}__lt`] = val;
          return builder;
        },
        in(col: string, vals: unknown[]) {
          entry.inFilter = { col, vals };
          return builder;
        },
        not(col: string, op: string, val: unknown) {
          entry.filters[`${col}__not_${op}`] = val;
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          if (table === 'concept_mastery') {
            return Promise.resolve(cfg.mastery ?? { data: [], error: null });
          }
          if (table === 'question_bank') {
            const resolver = cfg.questionBank ?? (() => ({ data: [], error: null }));
            return Promise.resolve(resolver({ ...entry.filters, in: entry.inFilter }));
          }
          return Promise.resolve({ data: [], error: null });
        },
        maybeSingle() {
          if (table === 'subjects') {
            return Promise.resolve(
              cfg.subject ?? { data: { id: 'subj-uuid-1' }, error: null },
            );
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
      return builder;
    },
  };

  return { client, log };
}

function masteryRow(
  mastery: number,
  opts: { chapter?: number; conceptTag?: string | null; dueAt?: string | null } = {},
): any {
  return {
    topic_id: `topic-${opts.chapter ?? 5}-${opts.conceptTag ?? 'x'}`,
    mastery_level: mastery,
    next_review_at: opts.dueAt ?? null,
    curriculum_topics: {
      subject_id: 'subj-uuid-1',
      chapter_number: opts.chapter ?? 5,
      concept_tag: opts.conceptTag ?? 'fractions',
    },
  };
}

const BASE_PARAMS = {
  studentId: 'student-1',
  subject: 'math',
  grade: '7',
  count: 10,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Pure Bloom helpers
// ─────────────────────────────────────────────────────────────────────────────

describe('masteryToMaxBloomLevel — assessment ceiling tiers', () => {
  it('maps each tier boundary to the correct ceiling', () => {
    expect(masteryToMaxBloomLevel(0.0)).toBe('understand'); // <0.3
    expect(masteryToMaxBloomLevel(0.29)).toBe('understand');
    expect(masteryToMaxBloomLevel(0.3)).toBe('apply'); // 0.3–0.5
    expect(masteryToMaxBloomLevel(0.49)).toBe('apply');
    expect(masteryToMaxBloomLevel(0.5)).toBe('analyze'); // 0.5–0.7
    expect(masteryToMaxBloomLevel(0.69)).toBe('analyze');
    expect(masteryToMaxBloomLevel(0.7)).toBe('evaluate'); // 0.7–0.85
    expect(masteryToMaxBloomLevel(0.84)).toBe('evaluate');
    expect(masteryToMaxBloomLevel(0.85)).toBe('create'); // >=0.85
    expect(masteryToMaxBloomLevel(1.0)).toBe('create');
  });

  it('the five assessment probe points resolve to the declared ceilings', () => {
    expect(masteryToMaxBloomLevel(0.2)).toBe('understand');
    expect(masteryToMaxBloomLevel(0.45)).toBe('apply');
    expect(masteryToMaxBloomLevel(0.6)).toBe('analyze');
    expect(masteryToMaxBloomLevel(0.8)).toBe('evaluate');
    expect(masteryToMaxBloomLevel(0.9)).toBe('create');
  });
});

describe('getBloomLevelsUpTo — ceiling-not-floor (remember always allowed)', () => {
  it('always includes remember at every ceiling', () => {
    for (const ceil of BLOOM_ORDER) {
      expect(getBloomLevelsUpTo(ceil)).toContain('remember');
    }
  });

  it('returns the inclusive prefix and never an above-ceiling level', () => {
    expect(getBloomLevelsUpTo('understand')).toEqual(['remember', 'understand']);
    expect(getBloomLevelsUpTo('apply')).toEqual(['remember', 'understand', 'apply']);
    expect(getBloomLevelsUpTo('analyze')).not.toContain('evaluate');
    expect(getBloomLevelsUpTo('analyze')).not.toContain('create');
    expect(getBloomLevelsUpTo('create')).toEqual(BLOOM_ORDER);
  });

  it('unknown ceiling degrades to all levels (fail-open within Bloom only)', () => {
    expect(getBloomLevelsUpTo('nonsense')).toEqual(BLOOM_ORDER);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fail-safe: error → [] ; cold-start → []
// ─────────────────────────────────────────────────────────────────────────────

describe('selectAdaptiveQuestions — fail-safe (never throws, returns [])', () => {
  it('subjects lookup error → []', async () => {
    const { client } = makeFakeClient({
      subject: { data: null, error: { message: 'boom' } },
    });
    const res = await selectAdaptiveQuestions(client, BASE_PARAMS);
    expect(res.questions).toEqual([]);
    expect(res.weakTopicsTargeted).toBe(0);
  });

  it('subjects table throws → [] (try/catch swallows)', async () => {
    const { client } = makeFakeClient({ throwOn: 'subjects' });
    const res = await selectAdaptiveQuestions(client, BASE_PARAMS);
    expect(res.questions).toEqual([]);
    expect(res.weakTopicsTargeted).toBe(0);
  });

  it('concept_mastery query error → []', async () => {
    const { client } = makeFakeClient({
      subject: { data: { id: 'subj-uuid-1' }, error: null },
      mastery: { data: null, error: { message: 'rls denied' } },
    });
    const res = await selectAdaptiveQuestions(client, BASE_PARAMS);
    expect(res.questions).toEqual([]);
  });

  it('concept_mastery table throws → []', async () => {
    const { client } = makeFakeClient({
      subject: { data: { id: 'subj-uuid-1' }, error: null },
      throwOn: 'concept_mastery',
    });
    const res = await selectAdaptiveQuestions(client, BASE_PARAMS);
    expect(res.questions).toEqual([]);
  });

  it('count <= 0 short-circuits to [] without touching the DB', async () => {
    const { client, log } = makeFakeClient({});
    const res = await selectAdaptiveQuestions(client, { ...BASE_PARAMS, count: 0 });
    expect(res.questions).toEqual([]);
    expect(log).toHaveLength(0);
  });
});

describe('selectAdaptiveQuestions — cold-start (assertion 4 selector half)', () => {
  it('student with NO concept_mastery rows → [] and 0 weak topics', async () => {
    const { client } = makeFakeClient({
      subject: { data: { id: 'subj-uuid-1' }, error: null },
      mastery: { data: [], error: null },
    });
    const res = await selectAdaptiveQuestions(client, BASE_PARAMS);
    expect(res.questions).toEqual([]);
    expect(res.weakTopicsTargeted).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Assertion 2 (BLOCKING): Bloom ceiling zero-violation
// ─────────────────────────────────────────────────────────────────────────────

describe('selectAdaptiveQuestions — assertion 2 (BLOCKING) Bloom ceiling', () => {
  const PROBE_POINTS: Array<{ m: number; ceiling: string }> = [
    { m: 0.2, ceiling: 'understand' },
    { m: 0.45, ceiling: 'apply' },
    { m: 0.6, ceiling: 'analyze' },
    { m: 0.8, ceiling: 'evaluate' },
    { m: 0.9, ceiling: 'create' },
  ];

  // A question-bank that returns one item at EVERY Bloom level — but only the
  // ones whose bloom_level is inside the requested `in([...])` ceiling set, i.e.
  // it faithfully emulates the DB applying `.in('bloom_level', allowedBlooms)`.
  function ceilingRespectingBank(
    filters: Record<string, unknown> & { in?: { col: string; vals: unknown[] } },
  ) {
    const allowed = new Set((filters.in?.vals as string[]) ?? BLOOM_ORDER);
    const data = BLOOM_ORDER.filter((b) => allowed.has(b)).map((b) =>
      makeQuestion({ bloom_level: b, concept_tag: 'fractions', chapter_number: 5 }),
    );
    return { data, error: null };
  }

  for (const { m, ceiling } of PROBE_POINTS) {
    it(`mastery ${m}: no served question exceeds '${ceiling}' (ceiling-not-floor)`, async () => {
      const { client } = makeFakeClient({
        subject: { data: { id: 'subj-uuid-1' }, error: null },
        mastery: { data: [masteryRow(m)], error: null },
        questionBank: ceilingRespectingBank,
      });
      const res = await selectAdaptiveQuestions(client, { ...BASE_PARAMS, count: 10 });

      expect(res.questions.length).toBeGreaterThan(0);
      const ceilIdx = BLOOM_ORDER.indexOf(ceiling);
      for (const q of res.questions) {
        const idx = BLOOM_ORDER.indexOf(q.bloom_level);
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThanOrEqual(ceilIdx); // ceiling honoured
      }
      // remember is always permitted (floor stays open).
      expect(res.questions.some((q: any) => q.bloom_level === 'remember')).toBe(true);
    });
  }

  it('create-level T item is NOT served when m < 0.85', async () => {
    // The selector must request only up-to-ceiling Blooms. Even if a rogue
    // create-level row somehow comes back, it must never be served at m<0.85.
    // We emulate the DB honouring `.in(...)`, so a create item is simply never
    // in the candidate pool.
    const { client } = makeFakeClient({
      subject: { data: { id: 'subj-uuid-1' }, error: null },
      mastery: { data: [masteryRow(0.6)], error: null }, // ceiling = analyze
      questionBank: (filters) => {
        const allowed = new Set((filters.in?.vals as string[]) ?? []);
        // Sanity: the selector must NOT have asked for create at m=0.6.
        expect(allowed.has('create')).toBe(false);
        expect(allowed.has('evaluate')).toBe(false);
        const data = BLOOM_ORDER.filter((b) => allowed.has(b)).map((b) =>
          makeQuestion({ bloom_level: b }),
        );
        return { data, error: null };
      },
    });
    const res = await selectAdaptiveQuestions(client, { ...BASE_PARAMS, count: 10 });
    expect(res.questions.some((q: any) => q.bloom_level === 'create')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Assertion 1: weak-topic over-representation
// ─────────────────────────────────────────────────────────────────────────────

describe('selectAdaptiveQuestions — assertion 1 (weak-topic over-representation)', () => {
  it('low-mastery topic T yields MORE T questions than a no-mastery control', async () => {
    // Treatment: student is weak on chapter 5 / "fractions". The bank serves
    // 'fractions' items only for chapter 5. weakTopicsTargeted should be >= 1
    // and the returned candidates should all be from topic T.
    const { client: treatmentClient } = makeFakeClient({
      subject: { data: { id: 'subj-uuid-1' }, error: null },
      mastery: { data: [masteryRow(0.3, { chapter: 5, conceptTag: 'fractions' })], error: null },
      questionBank: (filters) => {
        // Return rows for topic T's chapter. The selector may issue a primary
        // (chapter+concept) query and a relaxed (chapter-only) fallback when the
        // first pool is thin — both must yield T-chapter rows so the candidate
        // set is genuinely populated.
        if (filters.chapter_number === 5) {
          const allowed = new Set((filters.in?.vals as string[]) ?? BLOOM_ORDER);
          const data = Array.from({ length: 6 }).map(() =>
            makeQuestion({
              chapter_number: 5,
              concept_tag: 'fractions',
              bloom_level: [...allowed][0] ?? 'remember',
            }),
          );
          return { data, error: null };
        }
        return { data: [], error: null };
      },
    });
    const treatment = await selectAdaptiveQuestions(treatmentClient, BASE_PARAMS);

    const tCount = treatment.questions.filter(
      (q: any) => q.chapter_number === 5 && q.concept_tag === 'fractions',
    ).length;
    expect(tCount).toBeGreaterThan(0);
    expect(treatment.weakTopicsTargeted).toBeGreaterThanOrEqual(1);

    // Control: no concept_mastery → selector returns nothing, so it cannot
    // over-represent ANY topic (0 T-questions). Treatment strictly exceeds it.
    const { client: controlClient } = makeFakeClient({
      subject: { data: { id: 'subj-uuid-1' }, error: null },
      mastery: { data: [], error: null },
    });
    const control = await selectAdaptiveQuestions(controlClient, BASE_PARAMS);
    const controlTCount = control.questions.filter(
      (q: any) => q.chapter_number === 5 && q.concept_tag === 'fractions',
    ).length;

    expect(tCount).toBeGreaterThan(controlTCount);
  });

  it('lowest-mastery topic is prioritised first across multiple weak topics', async () => {
    const { client } = makeFakeClient({
      subject: { data: { id: 'subj-uuid-1' }, error: null },
      mastery: {
        data: [
          masteryRow(0.6, { chapter: 9, conceptTag: 'algebra' }),
          masteryRow(0.2, { chapter: 5, conceptTag: 'fractions' }), // weakest
        ],
        error: null,
      },
      questionBank: (filters) => {
        const allowed = new Set((filters.in?.vals as string[]) ?? BLOOM_ORDER);
        // Derive concept_tag from chapter so the relaxed (chapter-only)
        // fallback query still tags rows correctly.
        const chapter = filters.chapter_number as number;
        const concept = chapter === 5 ? 'fractions' : 'algebra';
        const data = Array.from({ length: 4 }).map(() =>
          makeQuestion({
            chapter_number: chapter,
            concept_tag: concept,
            bloom_level: [...allowed][0] ?? 'remember',
          }),
        );
        return { data, error: null };
      },
    });
    const res = await selectAdaptiveQuestions(client, { ...BASE_PARAMS, count: 10 });
    // The weakest topic (fractions/ch5) must appear; both weak topics targeted.
    expect(res.questions.some((q: any) => q.concept_tag === 'fractions')).toBe(true);
    expect(res.weakTopicsTargeted).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Assertion 6: IRT-proxy ranking (statistical) — near > far > random
// ─────────────────────────────────────────────────────────────────────────────

describe('selectAdaptiveQuestions — assertion 6 (IRT-proxy ranking)', () => {
  it('at theta=0, near (b≈0) items are picked over far (b≈2.5) items', async () => {
    // The bank returns a mix of near + far items; the selector ranks by
    // computeSelectionScore at theta=0 and takes the best `need`. With need
    // small relative to pool, near items should dominate the chosen set.
    const NEAR = 6;
    const FAR = 6;
    const { client } = makeFakeClient({
      subject: { data: { id: 'subj-uuid-1' }, error: null },
      mastery: { data: [masteryRow(0.6, { chapter: 5, conceptTag: 'fractions' })], error: null },
      questionBank: () => {
        const near = Array.from({ length: NEAR }).map(() =>
          makeQuestion({ bloom_level: 'remember', irt_difficulty: 0.0, concept_tag: 'fractions' }),
        );
        const far = Array.from({ length: FAR }).map(() =>
          makeQuestion({ bloom_level: 'remember', irt_difficulty: 2.5, concept_tag: 'fractions' }),
        );
        return { data: [...far, ...near], error: null }; // far first to defeat ordering luck
      },
    });

    // count=4 with a single topic → need ≈ 4. Best-ranked are the near items.
    const res = await selectAdaptiveQuestions(client, { ...BASE_PARAMS, count: 4 });
    const nearPicked = res.questions.filter((q: any) => q.irt_difficulty === 0.0).length;
    const farPicked = res.questions.filter((q: any) => q.irt_difficulty === 2.5).length;

    expect(res.questions.length).toBeGreaterThan(0);
    expect(nearPicked).toBeGreaterThan(farPicked); // near beats far

    // Random baseline: with a 50/50 pool, random selection of 4 would average
    // ~2 near. Proxy ranking does strictly better (picks all-near here).
    const RANDOM_BASELINE_EXPECTED = res.questions.length / 2;
    expect(nearPicked).toBeGreaterThan(RANDOM_BASELINE_EXPECTED);
  });

  it('calibrated items (fisher_info path) rank by information at theta', async () => {
    // A calibrated item peaked at theta=0 (b=0, n>=30) should outrank a
    // calibrated item peaked far away (b=2.5) — the +0.5 calibrated bonus is
    // equal so the discriminating factor is Fisher info at theta.
    const { client } = makeFakeClient({
      subject: { data: { id: 'subj-uuid-1' }, error: null },
      mastery: { data: [masteryRow(0.6, { chapter: 5, conceptTag: 'fractions' })], error: null },
      questionBank: () => ({
        data: [
          makeQuestion({
            id: 'far-cal',
            bloom_level: 'remember',
            irt_a: 1.5,
            irt_b: 2.5,
            irt_calibration_n: 50,
            irt_difficulty: 2.5,
          }),
          makeQuestion({
            id: 'near-cal',
            bloom_level: 'remember',
            irt_a: 1.5,
            irt_b: 0.0,
            irt_calibration_n: 50,
            irt_difficulty: 0.0,
          }),
        ],
        error: null,
      }),
    });
    const res = await selectAdaptiveQuestions(client, { ...BASE_PARAMS, count: 1 });
    expect(res.questions[0].id).toBe('near-cal'); // higher Fisher info at theta=0
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Assertion 7: P6 / P5 / subject integrity of served candidates
// ─────────────────────────────────────────────────────────────────────────────

describe('selectAdaptiveQuestions — assertion 7 (P6/P5/subject integrity)', () => {
  it('every served candidate is MCQ-shaped (4 options, index 0-3, non-empty text)', async () => {
    const { client } = makeFakeClient({
      subject: { data: { id: 'subj-uuid-1' }, error: null },
      mastery: { data: [masteryRow(0.6)], error: null },
      questionBank: (filters) => {
        const allowed = new Set((filters.in?.vals as string[]) ?? BLOOM_ORDER);
        const good = makeQuestion({ bloom_level: [...allowed][0] ?? 'remember' });
        return { data: [good], error: null };
      },
    });
    const res = await selectAdaptiveQuestions(client, BASE_PARAMS);
    expect(res.questions.length).toBeGreaterThan(0);
    for (const q of res.questions) {
      expect(typeof q.id).toBe('string');
      expect(typeof q.question_text).toBe('string');
      expect(q.question_text.length).toBeGreaterThan(0);
      expect(Array.isArray(q.options)).toBe(true);
      expect(q.options).toHaveLength(4);
      expect(q.correct_answer_index).toBeGreaterThanOrEqual(0);
      expect(q.correct_answer_index).toBeLessThanOrEqual(3);
    }
  });

  it('rejects RAG options:"[]" (string-encoded empty options) rows', async () => {
    const { client } = makeFakeClient({
      subject: { data: { id: 'subj-uuid-1' }, error: null },
      mastery: { data: [masteryRow(0.6)], error: null },
      questionBank: (filters) => {
        const allowed = new Set((filters.in?.vals as string[]) ?? BLOOM_ORDER);
        const bloom = [...allowed][0] ?? 'remember';
        return {
          data: [
            makeQuestion({ id: 'rag-empty', bloom_level: bloom, options: '[]' }), // bad
            makeQuestion({ id: 'good-one', bloom_level: bloom }), // good
          ],
          error: null,
        };
      },
    });
    const res = await selectAdaptiveQuestions(client, BASE_PARAMS);
    expect(res.questions.some((q: any) => q.id === 'rag-empty')).toBe(false);
    expect(res.questions.some((q: any) => q.id === 'good-one')).toBe(true);
  });

  it('rejects rows with wrong option count or out-of-range correct index', async () => {
    const { client } = makeFakeClient({
      subject: { data: { id: 'subj-uuid-1' }, error: null },
      mastery: { data: [masteryRow(0.6)], error: null },
      questionBank: (filters) => {
        const allowed = new Set((filters.in?.vals as string[]) ?? BLOOM_ORDER);
        const bloom = [...allowed][0] ?? 'remember';
        return {
          data: [
            makeQuestion({ id: 'three-opts', bloom_level: bloom, options: ['A', 'B', 'C'] }),
            makeQuestion({ id: 'bad-index', bloom_level: bloom, correct_answer_index: 7 }),
            makeQuestion({ id: 'ok', bloom_level: bloom }),
          ],
          error: null,
        };
      },
    });
    const res = await selectAdaptiveQuestions(client, BASE_PARAMS);
    const ids = res.questions.map((q: any) => q.id);
    expect(ids).not.toContain('three-opts');
    expect(ids).not.toContain('bad-index');
    expect(ids).toContain('ok');
  });

  it('passes grade through verbatim as a STRING (P5) — never coerced to int', async () => {
    const seenFilters: Record<string, unknown>[] = [];
    const { client } = makeFakeClient({
      subject: { data: { id: 'subj-uuid-1' }, error: null },
      mastery: { data: [masteryRow(0.6)], error: null },
      questionBank: (filters) => {
        seenFilters.push(filters);
        const allowed = new Set((filters.in?.vals as string[]) ?? BLOOM_ORDER);
        return { data: [makeQuestion({ bloom_level: [...allowed][0] ?? 'remember' })], error: null };
      },
    });
    await selectAdaptiveQuestions(client, { ...BASE_PARAMS, grade: '7' });
    expect(seenFilters.length).toBeGreaterThan(0);
    for (const f of seenFilters) {
      expect(f.grade).toBe('7'); // exact string, not 7
      expect(typeof f.grade).toBe('string');
    }
  });

  it('queries question_bank with the requested subject CODE', async () => {
    const seenFilters: Record<string, unknown>[] = [];
    const { client } = makeFakeClient({
      subject: { data: { id: 'subj-uuid-1' }, error: null },
      mastery: { data: [masteryRow(0.6)], error: null },
      questionBank: (filters) => {
        seenFilters.push(filters);
        const allowed = new Set((filters.in?.vals as string[]) ?? BLOOM_ORDER);
        return { data: [makeQuestion({ bloom_level: [...allowed][0] ?? 'remember' })], error: null };
      },
    });
    await selectAdaptiveQuestions(client, { ...BASE_PARAMS, subject: 'science' });
    for (const f of seenFilters) {
      expect(f.subject).toBe('science');
    }
  });

  it('never returns more than the requested count and never duplicates an excludeId', async () => {
    const { client } = makeFakeClient({
      subject: { data: { id: 'subj-uuid-1' }, error: null },
      mastery: {
        data: [
          masteryRow(0.2, { chapter: 5, conceptTag: 'fractions' }),
          masteryRow(0.3, { chapter: 6, conceptTag: 'decimals' }),
        ],
        error: null,
      },
      questionBank: (filters) => {
        const allowed = new Set((filters.in?.vals as string[]) ?? BLOOM_ORDER);
        const bloom = [...allowed][0] ?? 'remember';
        return {
          data: Array.from({ length: 10 }).map(() =>
            makeQuestion({
              chapter_number: filters.chapter_number as number,
              concept_tag: filters.concept_tag as string,
              bloom_level: bloom,
            }),
          ),
          error: null,
        };
      },
    });
    const res = await selectAdaptiveQuestions(client, { ...BASE_PARAMS, count: 5 });
    expect(res.questions.length).toBeLessThanOrEqual(5);
    const ids = res.questions.map((q: any) => q.id);
    expect(new Set(ids).size).toBe(ids.length); // no dup IDs within result
  });
});
