/**
 * Unit tests for scripts/check-content-gaps.ts.
 *
 * These tests run in the standard Vitest unit suite (no Supabase required).
 * They assert (a) the query shape contract the script depends on, (b) the
 * gap-detection logic on synthetic input, and (c) that the paged read cannot
 * silently truncate. Live-DB exercise of the script is left to the nightly
 * content-quality workflow.
 *
 * WHY THE COLUMN ASSERTIONS ARE STRICT (2026-08-11)
 * -------------------------------------------------
 * The detector must count what the LIVE retrieval path can actually see.
 * `match_rag_chunks_ncert` — used by /api/foxy, grounded-answer and
 * quiz-generator — filters `subject_code` + `grade_short`. Reading the legacy
 * `subject`/`grade` display-name columns instead would count chunks that no
 * student query can reach, i.e. lie optimistically. These tests pin that
 * choice so it cannot be reverted by accident.
 */
import { describe, it, expect } from 'vitest';
import {
  buildGapReport,
  fetchAllRows,
  QUERY_SHAPES,
  TARGET_SUBJECTS,
  PAGE_SIZE,
  type RagChunkRow,
  type QuestionRow,
} from '../../scripts/check-content-gaps';

describe('check-content-gaps — query shape', () => {
  it('reads the CANONICAL rag columns the live retriever filters on', () => {
    expect(QUERY_SHAPES.rag_content_chunks.table).toBe('rag_content_chunks');
    // subject_code + grade_short — NOT the legacy subject/grade display names.
    expect(QUERY_SHAPES.rag_content_chunks.select).toBe('subject_code, grade_short');
    expect(QUERY_SHAPES.rag_content_chunks.filter).toEqual({ is_active: true });
  });

  it('does not read the legacy display-name columns from rag_content_chunks', () => {
    const select = QUERY_SHAPES.rag_content_chunks.select as string;
    const fields = select.split(',').map((s) => s.trim());
    expect(fields).not.toContain('subject');
    expect(fields).not.toContain('grade');
  });

  it('selects exactly subject + grade from question_bank (P13: no PII)', () => {
    expect(QUERY_SHAPES.question_bank.table).toBe('question_bank');
    expect(QUERY_SHAPES.question_bank.select).toBe('subject, grade');
    expect(QUERY_SHAPES.question_bank.filter).toEqual({ is_active: true });
  });

  it('selects no PII-bearing column from either table (P13)', () => {
    const PII = /student|email|phone|name|user|text|content|answer/i;
    for (const shape of Object.values(QUERY_SHAPES)) {
      for (const field of (shape.select as string).split(',')) {
        expect(field.trim()).not.toMatch(PII);
      }
    }
  });

  it('every TARGET_SUBJECTS grade is a string (P5)', () => {
    for (const t of TARGET_SUBJECTS) {
      for (const g of t.grades) {
        expect(typeof g).toBe('string');
        expect(g).toMatch(/^(6|7|8|9|10|11|12)$/);
      }
    }
  });
});

describe('check-content-gaps — buildGapReport bucketing', () => {
  it('returns one row per (subject, grade) pair in TARGET_SUBJECTS', () => {
    const report = buildGapReport([], []);
    const expectedPairs = TARGET_SUBJECTS.reduce((n, t) => n + t.grades.length, 0);
    expect(report.rows.length).toBe(expectedPairs);
  });

  it('buckets rag chunks on snake_case subject_code + BARE grade_short', () => {
    // Production shape per rag_chunks_valid_grade CHECK: grade_short is '10',
    // never 'Grade 10'.
    const ragRows: RagChunkRow[] = Array.from({ length: 100 }, () => ({
      subject_code: 'math',
      grade_short: '10',
    }));
    const report = buildGapReport(ragRows, []);
    const row = report.rows.find((r) => r.subject === 'math' && r.grade === '10')!;
    expect(row.ragCount).toBe(100);
    expect(row.ragOk).toBe(true);
    expect(report.ragAttributed).toBe(100);
    expect(report.ragUnattributed).toBe(0);
  });

  it('buckets question_bank on a BARE P5 grade string, not "Grade N"', () => {
    // REGRESSION: the previous implementation keyed question_bank as
    // `${subject}|Grade ${g}` while chk_question_bank_grade_p5 constrains
    // question_bank.grade to '6'..'12'. That key matched zero rows in
    // production — a second, independent all-zeros defect.
    const questionRows: QuestionRow[] = Array.from({ length: 100 }, () => ({
      subject: 'math',
      grade: '10',
    }));
    const report = buildGapReport([], questionRows);
    const row = report.rows.find((r) => r.subject === 'math' && r.grade === '10')!;
    expect(row.questionCount).toBe(100);
    expect(row.questionOk).toBe(true);
  });

  it('marks pair as OK when both floors are met', () => {
    // math grade 10 needs minChunks=100, minQuestions=100.
    const ragRows: RagChunkRow[] = Array.from({ length: 100 }, () => ({
      subject_code: 'math',
      grade_short: '10',
    }));
    const questionRows: QuestionRow[] = Array.from({ length: 100 }, () => ({
      subject: 'math',
      grade: '10',
    }));
    const report = buildGapReport(ragRows, questionRows);
    const row = report.rows.find((r) => r.subject === 'math' && r.grade === '10')!;
    expect(row.ragOk).toBe(true);
    expect(row.questionOk).toBe(true);
    expect(row.catastrophic).toBe(false);
  });

  it('flags catastrophic gap when chunks AND questions are zero', () => {
    const report = buildGapReport([], []);
    expect(report.catastrophicGaps).toBe(report.rows.length);
    expect(report.rows.every((r) => r.catastrophic)).toBe(true);
  });

  it('does NOT flag catastrophic when only chunks are zero', () => {
    const questionRows: QuestionRow[] = Array.from({ length: 5 }, () => ({
      subject: 'math',
      grade: '10',
    }));
    const report = buildGapReport([], questionRows);
    const row = report.rows.find((r) => r.subject === 'math' && r.grade === '10')!;
    expect(row.questionCount).toBe(5);
    expect(row.catastrophic).toBe(false);
    expect(row.questionOk).toBe(false); // still below the P3 floor
  });

  it('normalises case and separator drift on both sides', () => {
    const report = buildGapReport(
      [{ subject_code: 'Social-Studies', grade_short: 'Grade 8' }],
      [{ subject: 'SOCIAL STUDIES', grade: '8' }],
    );
    const row = report.rows.find((r) => r.subject === 'social_studies' && r.grade === '8')!;
    expect(row.ragCount).toBe(1);
    expect(row.questionCount).toBe(1);
  });
});

describe('check-content-gaps — NULL attribution is its own signal', () => {
  it('excludes rows with a NULL canonical column from every bucket', () => {
    // These rows exist and are is_active, but match_rag_chunks_ncert filters
    // on subject_code/grade_short, so they are invisible to retrieval.
    // Counting them as coverage would make the detector lie optimistically.
    const ragRows: RagChunkRow[] = [
      { subject_code: 'math', grade_short: '10' },
      { subject_code: null, grade_short: '10' },
      { subject_code: 'math', grade_short: null },
      { subject_code: null, grade_short: null },
    ];
    const report = buildGapReport(ragRows, []);
    const row = report.rows.find((r) => r.subject === 'math' && r.grade === '10')!;
    expect(row.ragCount).toBe(1); // only the fully-attributed row counts
    expect(report.totalRagChunks).toBe(4); // rows READ
    expect(report.ragAttributed).toBe(1);
    expect(report.ragUnattributed).toBe(3);
  });

  it('reports attributed + unattributed == rows read, on both tables', () => {
    const report = buildGapReport(
      [{ subject_code: 'math', grade_short: '10' }, { subject_code: null, grade_short: null }],
      [{ subject: 'math', grade: '10' }, { subject: null, grade: null }, { subject: 'x', grade: '' }],
    );
    expect(report.ragAttributed + report.ragUnattributed).toBe(report.totalRagChunks);
    expect(report.questionAttributed + report.questionUnattributed).toBe(report.totalQuestions);
    expect(report.ragUnattributed).toBe(1);
    expect(report.questionUnattributed).toBe(2);
  });

  it('a fully-unattributed corpus reports zero coverage, not full coverage', () => {
    const ragRows: RagChunkRow[] = Array.from({ length: 500 }, () => ({
      subject_code: null,
      grade_short: null,
    }));
    const report = buildGapReport(ragRows, []);
    expect(report.totalRagChunks).toBe(500);
    expect(report.ragAttributed).toBe(0);
    expect(report.rows.every((r) => r.ragCount === 0)).toBe(true);
  });
});

describe('check-content-gaps — pagination', () => {
  /**
   * Stub PostgREST builder. Emulates a server that caps every response at
   * `maxRows` regardless of the requested range — the exact `db-max-rows`
   * behaviour that silently truncated the old bare `.select()`.
   */
  function stubClient(total: number, maxRows: number) {
    let pages = 0;
    const filters: Array<Array<[string, unknown]>> = [];
    const client = {
      from() {
        const applied: Array<[string, unknown]> = [];
        filters.push(applied);
        const b: any = {
          _head: false,
          select(_sel: string, opts?: { count?: string; head?: boolean }) {
            b._head = Boolean(opts?.head);
            return b;
          },
          eq(col: string, val: unknown) {
            applied.push([col, val]);
            return b._head ? Promise.resolve({ count: total, error: null }) : b;
          },
          order() {
            return b;
          },
          range(from: number, to: number) {
            pages++;
            const end = Math.min(to + 1, from + maxRows, total);
            const data = Array.from({ length: Math.max(0, end - from) }, (_, i) => ({
              subject_code: 'math',
              grade_short: '10',
              _i: from + i,
            }));
            return Promise.resolve({ data, error: null });
          },
        };
        return b;
      },
      get pages() {
        return pages;
      },
      /** Filters applied per `.from()` — index 0 is the count query. */
      get filters() {
        return filters;
      },
    };
    return client;
  }

  it('applies the SAME is_active filter to the count AND to every page', async () => {
    // REGRESSION: an unfiltered page query paired with a filtered exact count
    // reads inactive rows into the buckets and terminates on the wrong total,
    // INFLATING coverage — the one direction that hurts. Caught in review
    // 2026-08-11 before it shipped.
    const client = stubClient(2500, PAGE_SIZE);
    await fetchAllRows<RagChunkRow>(client as any, 'rag_content_chunks', 'x');
    expect(client.filters.length).toBeGreaterThan(1); // 1 count + N pages
    for (const applied of client.filters) {
      expect(applied).toContainEqual(['is_active', true]);
    }
  });

  it('reads every row when the corpus far exceeds one page', async () => {
    const client = stubClient(16006, PAGE_SIZE);
    const res = await fetchAllRows<RagChunkRow>(client as any, 'rag_content_chunks', 'x');
    expect(res.expected).toBe(16006);
    expect(res.rows.length).toBe(16006);
    expect(res.complete).toBe(true);
    expect(client.pages).toBeGreaterThan(1);
  });

  it('does NOT stop early when db-max-rows is smaller than PAGE_SIZE', async () => {
    // REGRESSION: a naive "short page means end of table" loop would stop
    // after the first 500-row page and confidently report a complete read.
    const client = stubClient(4321, 500);
    const res = await fetchAllRows<RagChunkRow>(client as any, 'rag_content_chunks', 'x');
    expect(res.rows.length).toBe(4321);
    expect(res.complete).toBe(true);
  });

  it('reports complete=false rather than silently under-counting', async () => {
    // Server claims 5000 rows but serves none — must not look complete.
    const client = stubClient(5000, 0);
    const res = await fetchAllRows<RagChunkRow>(client as any, 'rag_content_chunks', 'x');
    expect(res.rows.length).toBe(0);
    expect(res.expected).toBe(5000);
    expect(res.complete).toBe(false);
  });

  it('handles an empty table without looping', async () => {
    const client = stubClient(0, PAGE_SIZE);
    const res = await fetchAllRows<RagChunkRow>(client as any, 'question_bank', 'x');
    expect(res.rows.length).toBe(0);
    expect(res.complete).toBe(true);
    expect(client.pages).toBe(0);
  });

  it('threads paginationComplete into the report', () => {
    expect(buildGapReport([], [], { paginationComplete: false }).paginationComplete).toBe(false);
    expect(buildGapReport([], [], { paginationComplete: true }).paginationComplete).toBe(true);
    // Absent when not supplied, so pre-pagination reports stay distinguishable.
    expect('paginationComplete' in buildGapReport([], [])).toBe(false);
  });
});
