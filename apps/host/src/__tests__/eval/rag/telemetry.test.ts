// src/__tests__/eval/rag/telemetry.test.ts
//
// RED-first unit tests for the B1 retrieval-quality production-telemetry rollup
// (Task 6). This is the read-only, real-world baseline that rides ALONGSIDE the
// offline golden-set metrics (spec §B1.6).
//
// This test runs in the NORMAL `npm test` lane (the DB is MOCKED — a hand-rolled
// fake Supabase client with canned `retrieval_traces` / `grounded_ai_traces`
// rows). The real read is service-role server-only / offline (P8/B6); nothing
// here opens a connection.
//
// It pins, top to bottom:
//
//   A1 — column-allowlist projection (P13 GATE):
//     - the exported per-table projection constant lists ONLY non-PII columns;
//     - it is a SUBSET of the documented spec §B1.3/A1 allowlist;
//     - it contains NONE of the forbidden identifier columns
//       (`grounded_ai_traces.student_id`, `retrieval_traces.user_id`,
//        `retrieval_traces.session_id`);
//     - the actual `.select(...)` string the rollup sends to Supabase carries
//       NONE of the forbidden columns (an identifier never enters the query,
//       and the rollup output is metadata-only — no raw query text, no id).
//
//   Rollup math (spec §B1.6):
//     - hit-rate proxy = fraction of traces with a non-empty retrieval;
//     - top-similarity p10/p50/p90 percentiles;
//     - rerank rate, grounded rate + confidence percentiles;
//     - per-(grade × subject_code) slices so weak cells surface for B2.
//
//   RRF-scale labeling (MUST):
//     - any similarity / fused-score distribution in the output is EXPLICITLY
//       labeled RRF-scale `[0, ~0.033]` — never presented as a cosine.
//
//   Empty-result handling:
//     - an empty trace table yields a well-formed zero-state rollup (no NaN, no
//       throw, sample_size 0), not a crash.
//
// Relative import (the `@/*` alias does not reach the eval harness, which lives
// outside src/).

import { describe, it, expect } from 'vitest';

import {
  TELEMETRY_GROUNDED_PROJECTION,
  TELEMETRY_RETRIEVAL_PROJECTION,
  TELEMETRY_FORBIDDEN_COLUMNS,
  GROUNDED_AI_TRACES_ALLOWLIST,
  RETRIEVAL_TRACES_ALLOWLIST,
  buildTelemetrySelect,
  percentiles,
  rollupTelemetry,
  SIMILARITY_SCALE_LABEL,
  SIMILARITY_SCALE_RANGE,
  CONFIDENCE_SCALE_LABEL,
  CONFIDENCE_SCALE_RANGE,
  type TelemetryRollup,
} from '../../../../eval/rag/harness/telemetry-baseline';

// ─── Fake Supabase client ────────────────────────────────────────────────────
//
// Records the exact column string passed to `.select(...)` and the table name,
// and returns canned rows. The minimal surface the rollup uses is:
//   supabase.from(table).select(cols).limit(n)  →  Promise<{ data, error }>
// The chain is await-able (thenable) at the `.limit()` step (mirrors the
// trace-mining fake so both tools share one client contract).

interface SelectCapture {
  table: string;
  columns: string;
}

function makeFakeSupabase(
  rowsByTable: Record<string, Record<string, unknown>[]>,
  captures: SelectCapture[],
) {
  return {
    from(table: string) {
      return {
        select(columns: string) {
          captures.push({ table, columns });
          const result = { data: rowsByTable[table] ?? [], error: null };
          const builder = {
            limit(_n: number) {
              return Promise.resolve(result);
            },
            order() {
              return builder;
            },
            not() {
              return builder;
            },
            then(
              onFulfilled: (v: typeof result) => unknown,
              onRejected?: (e: unknown) => unknown,
            ) {
              return Promise.resolve(result).then(onFulfilled, onRejected);
            },
          };
          return builder;
        },
      };
    },
  };
}

// A grounded_ai_traces row that DELIBERATELY carries a forbidden identifier. The
// rollup must (a) never SELECT student_id, and (b) never surface it anywhere.
function groundedRow(over: Record<string, unknown>): Record<string, unknown> {
  return {
    caller: 'foxy',
    grade: '8',
    subject_code: 'science',
    chapter_number: 10,
    top_similarity: 0.02,
    chunk_count: 5,
    grounded: true,
    confidence: 0.8,
    created_at: '2026-06-10T00:00:00.000Z',
    // Forbidden — present in the canned row but must NEVER be SELECTed / surfaced:
    student_id: '99999999-9999-4999-8999-999999999999',
    ...over,
  };
}

function retrievalRow(over: Record<string, unknown>): Record<string, unknown> {
  return {
    caller: 'foxy',
    grade: '10',
    subject: 'math',
    chapter_number: 4,
    reranked: true,
    match_count: 5,
    chunk_ids: ['22222222-2222-4222-8222-222222222222'],
    created_at: '2026-06-11T00:00:00.000Z',
    // Forbidden — present in the canned row but must NEVER be SELECTed / surfaced:
    user_id: '88888888-8888-4888-8888-888888888888',
    session_id: '77777777-7777-4777-8777-777777777777',
    ...over,
  };
}

// ─── A1 — column-allowlist projection (P13) ──────────────────────────────────

describe('telemetry — A1 column-allowlist projection (P13)', () => {
  const FORBIDDEN = ['student_id', 'user_id', 'session_id'];

  it('exports a forbidden-column denylist covering the three identifier columns', () => {
    for (const col of FORBIDDEN) {
      expect(TELEMETRY_FORBIDDEN_COLUMNS).toContain(col);
    }
  });

  it('grounded_ai_traces telemetry projection lists ONLY allowlisted, non-PII columns', () => {
    for (const col of TELEMETRY_GROUNDED_PROJECTION) {
      expect(GROUNDED_AI_TRACES_ALLOWLIST).toContain(col);
      expect(TELEMETRY_FORBIDDEN_COLUMNS).not.toContain(col);
    }
    expect(TELEMETRY_GROUNDED_PROJECTION).not.toContain('student_id');
    expect(TELEMETRY_GROUNDED_PROJECTION).not.toContain('user_id');
    expect(TELEMETRY_GROUNDED_PROJECTION).not.toContain('session_id');
  });

  it('retrieval_traces telemetry projection lists ONLY allowlisted, non-PII columns', () => {
    for (const col of TELEMETRY_RETRIEVAL_PROJECTION) {
      expect(RETRIEVAL_TRACES_ALLOWLIST).toContain(col);
      expect(TELEMETRY_FORBIDDEN_COLUMNS).not.toContain(col);
    }
    expect(TELEMETRY_RETRIEVAL_PROJECTION).not.toContain('user_id');
    expect(TELEMETRY_RETRIEVAL_PROJECTION).not.toContain('session_id');
    expect(TELEMETRY_RETRIEVAL_PROJECTION).not.toContain('student_id');
  });

  it('buildTelemetrySelect produces a comma-joined string with no forbidden column, never SELECT *', () => {
    const grounded = buildTelemetrySelect('grounded_ai_traces');
    const retrieval = buildTelemetrySelect('retrieval_traces');
    for (const col of FORBIDDEN) {
      expect(grounded).not.toContain(col);
      expect(retrieval).not.toContain(col);
    }
    expect(grounded).not.toBe('*');
    expect(retrieval).not.toBe('*');
  });

  it('the actual .select() string sent to Supabase carries NONE of the forbidden columns', async () => {
    const captures: SelectCapture[] = [];
    const fake = makeFakeSupabase(
      {
        grounded_ai_traces: [groundedRow({})],
        retrieval_traces: [retrievalRow({})],
      },
      captures,
    );

    await rollupTelemetry(fake as never);

    expect(captures.length).toBeGreaterThan(0);
    for (const cap of captures) {
      for (const col of FORBIDDEN) {
        expect(cap.columns).not.toContain(col);
      }
      expect(cap.columns).not.toBe('*');
    }
  });

  it('NO forbidden identifier appears anywhere in the serialized rollup output', async () => {
    const captures: SelectCapture[] = [];
    const fake = makeFakeSupabase(
      {
        grounded_ai_traces: [groundedRow({})],
        retrieval_traces: [retrievalRow({})],
      },
      captures,
    );

    const rollup = await rollupTelemetry(fake as never);
    const serialized = JSON.stringify(rollup);
    expect(serialized).not.toContain('99999999-9999-4999-8999-999999999999');
    expect(serialized).not.toContain('88888888-8888-4888-8888-888888888888');
    expect(serialized).not.toContain('77777777-7777-4777-8777-777777777777');
    expect(serialized).not.toMatch(/student_id|user_id|session_id/);
  });
});

// ─── percentiles — pure rollup math ──────────────────────────────────────────

describe('telemetry — percentiles (pure math)', () => {
  it('computes p10/p50/p90 by linear interpolation on a sorted sample', () => {
    // 0.000 .. 0.100 in 0.010 steps → 11 values, indices 0..10.
    const xs = Array.from({ length: 11 }, (_, i) => i * 0.01);
    const p = percentiles(xs, [10, 50, 90]);
    // rank = q/100 * (n-1) = q/100 * 10 → exact integer indices here.
    expect(p[10]).toBeCloseTo(0.01, 10);
    expect(p[50]).toBeCloseTo(0.05, 10);
    expect(p[90]).toBeCloseTo(0.09, 10);
  });

  it('interpolates between samples when the rank is fractional', () => {
    // n=2 → rank for p50 = 0.5 * 1 = 0.5 → midpoint of [0.01, 0.03] = 0.02.
    const p = percentiles([0.03, 0.01], [50]);
    expect(p[50]).toBeCloseTo(0.02, 10);
  });

  it('a single-element sample returns that element for every percentile', () => {
    const p = percentiles([0.017], [10, 50, 90]);
    expect(p[10]).toBeCloseTo(0.017, 10);
    expect(p[50]).toBeCloseTo(0.017, 10);
    expect(p[90]).toBeCloseTo(0.017, 10);
  });

  it('an empty sample returns null for every requested percentile (no NaN)', () => {
    const p = percentiles([], [10, 50, 90]);
    expect(p[10]).toBeNull();
    expect(p[50]).toBeNull();
    expect(p[90]).toBeNull();
  });

  it('ignores non-finite / null inputs rather than poisoning the result', () => {
    const xs = [0.01, Number.NaN, null as unknown as number, 0.03, undefined as unknown as number];
    const p = percentiles(xs, [50]);
    expect(p[50]).toBeCloseTo(0.02, 10); // midpoint of the two finite values
  });
});

// ─── rollupTelemetry — aggregate correctness ─────────────────────────────────

describe('telemetry — rollup aggregates (spec §B1.6)', () => {
  it('hit-rate proxy = fraction of traces with a non-empty retrieval', async () => {
    const captures: SelectCapture[] = [];
    const fake = makeFakeSupabase(
      {
        // grounded: 3 rows, 2 with chunk_count > 0.
        grounded_ai_traces: [
          groundedRow({ chunk_count: 5 }),
          groundedRow({ chunk_count: 0 }),
          groundedRow({ chunk_count: 2 }),
        ],
        // retrieval: 2 rows, 1 with a non-empty chunk_ids[].
        retrieval_traces: [
          retrievalRow({ chunk_ids: ['22222222-2222-4222-8222-222222222222'] }),
          retrievalRow({ chunk_ids: [] }),
        ],
      },
      captures,
    );

    const rollup: TelemetryRollup = await rollupTelemetry(fake as never);

    // grounded hit-rate proxy = 2/3.
    expect(rollup.grounded.sample_size).toBe(3);
    expect(rollup.grounded.hit_rate_proxy).toBeCloseTo(2 / 3, 10);
    // retrieval hit-rate proxy = 1/2.
    expect(rollup.retrieval.sample_size).toBe(2);
    expect(rollup.retrieval.hit_rate_proxy).toBeCloseTo(0.5, 10);
  });

  it('rerank rate = fraction of retrieval_traces with reranked=true', async () => {
    const captures: SelectCapture[] = [];
    const fake = makeFakeSupabase(
      {
        grounded_ai_traces: [],
        retrieval_traces: [
          retrievalRow({ reranked: true }),
          retrievalRow({ reranked: true }),
          retrievalRow({ reranked: false }),
          retrievalRow({ reranked: false }),
        ],
      },
      captures,
    );

    const rollup = await rollupTelemetry(fake as never);
    expect(rollup.retrieval.rerank_rate).toBeCloseTo(0.5, 10);
  });

  it('grounded rate = fraction of grounded_ai_traces with grounded=true', async () => {
    const captures: SelectCapture[] = [];
    const fake = makeFakeSupabase(
      {
        grounded_ai_traces: [
          groundedRow({ grounded: true }),
          groundedRow({ grounded: true }),
          groundedRow({ grounded: true }),
          groundedRow({ grounded: false }),
        ],
        retrieval_traces: [],
      },
      captures,
    );

    const rollup = await rollupTelemetry(fake as never);
    expect(rollup.grounded.grounded_rate).toBeCloseTo(0.75, 10);
  });

  it('top-similarity percentiles are computed AND carry an explicit RRF-scale label', async () => {
    const captures: SelectCapture[] = [];
    const sims = [0.0, 0.005, 0.01, 0.015, 0.02, 0.025, 0.03, 0.033];
    const fake = makeFakeSupabase(
      {
        grounded_ai_traces: sims.map((s) => groundedRow({ top_similarity: s })),
        retrieval_traces: [],
      },
      captures,
    );

    const rollup = await rollupTelemetry(fake as never);
    const dist = rollup.grounded.top_similarity;

    // The distribution is present with the three percentiles.
    expect(dist.p10).not.toBeNull();
    expect(dist.p50).not.toBeNull();
    expect(dist.p90).not.toBeNull();

    // RRF-SCALE LABELING (MUST): the score distribution is explicitly labeled as
    // RRF-scale, NOT cosine — and the documented range is [0, ~0.033].
    expect(dist.scale).toBe('rrf');
    expect(dist.scale_label).toBe(SIMILARITY_SCALE_LABEL);
    expect(dist.scale_label.toLowerCase()).toContain('rrf');
    expect(dist.scale_label.toLowerCase()).not.toContain('cosine');
    expect(dist.scale_range).toEqual(SIMILARITY_SCALE_RANGE);
    expect(SIMILARITY_SCALE_RANGE[0]).toBe(0);
    expect(SIMILARITY_SCALE_RANGE[1]).toBeCloseTo(0.033, 6);
  });

  it('confidence distribution is summarized as percentiles', async () => {
    const captures: SelectCapture[] = [];
    const confs = [0.5, 0.6, 0.7, 0.8, 0.9];
    const fake = makeFakeSupabase(
      {
        grounded_ai_traces: confs.map((c) => groundedRow({ confidence: c })),
        retrieval_traces: [],
      },
      captures,
    );

    const rollup = await rollupTelemetry(fake as never);
    expect(rollup.grounded.confidence.p50).toBeCloseTo(0.7, 10);
  });

  it('confidence distribution is labeled NORMALIZED, NOT rrf (S6.1)', async () => {
    // `grounded_ai_traces.confidence` is a normalized [0, 1] score (post
    // RRF_THEORETICAL_MAX normalization), NOT a raw RRF fused score. It must NOT
    // be mislabeled `scale: 'rrf'` (that misread caused the 2026-05-10 audit bug
    // on top_similarity); it carries its OWN distinct scale tag + [0, 1] range.
    const captures: SelectCapture[] = [];
    const confs = [0.5, 0.6, 0.7, 0.8, 0.9];
    const fake = makeFakeSupabase(
      {
        grounded_ai_traces: confs.map((c) => groundedRow({ confidence: c })),
        retrieval_traces: [],
      },
      captures,
    );

    const rollup = await rollupTelemetry(fake as never);
    const conf = rollup.grounded.confidence;

    // The confidence scale TAG is distinct from the RRF top_similarity scale.
    // (The human label deliberately references RRF to clarify what confidence is
    // NOT — "not a raw RRF fused score" — so the substring check is on the TAG,
    // never the prose.)
    expect(conf.scale).not.toBe('rrf');
    expect(conf.scale).toBe('normalized');
    expect(conf.scale_label).toBe(CONFIDENCE_SCALE_LABEL);
    expect(conf.scale_label).not.toBe(SIMILARITY_SCALE_LABEL);
    expect(conf.scale_label.toLowerCase()).toContain('normalized');
    expect(conf.scale_label.toLowerCase()).not.toContain('cosine');
    expect(conf.scale_range).toEqual(CONFIDENCE_SCALE_RANGE);
    expect(CONFIDENCE_SCALE_RANGE).toEqual([0, 1]);

    // The top_similarity distribution stays RRF-scale (unchanged by S6.1).
    expect(rollup.grounded.top_similarity.scale).toBe('rrf');
  });
});

// ─── Per-(grade × subject) slicing ───────────────────────────────────────────

describe('telemetry — per-(grade × subject_code) slices (spec §B1.6)', () => {
  it('produces one cell per distinct (grade, subject) with per-cell stats', async () => {
    const captures: SelectCapture[] = [];
    const fake = makeFakeSupabase(
      {
        grounded_ai_traces: [
          groundedRow({ grade: '8', subject_code: 'science', chunk_count: 5 }),
          groundedRow({ grade: '8', subject_code: 'science', chunk_count: 0 }),
          groundedRow({ grade: '10', subject_code: 'math', chunk_count: 3 }),
        ],
        retrieval_traces: [],
      },
      captures,
    );

    const rollup = await rollupTelemetry(fake as never);
    const cells = rollup.grounded.by_cell;

    // Two cells: (8, science) and (10, math).
    expect(cells.length).toBe(2);

    const science8 = cells.find((c) => c.grade === '8' && c.subject === 'science');
    const math10 = cells.find((c) => c.grade === '10' && c.subject === 'math');

    expect(science8?.sample_size).toBe(2);
    expect(science8?.hit_rate_proxy).toBeCloseTo(0.5, 10); // 1 of 2 non-empty
    expect(math10?.sample_size).toBe(1);
    expect(math10?.hit_rate_proxy).toBeCloseTo(1, 10);
  });

  it('every per-cell similarity distribution also carries the RRF-scale label', async () => {
    const captures: SelectCapture[] = [];
    const fake = makeFakeSupabase(
      {
        grounded_ai_traces: [
          groundedRow({ grade: '8', subject_code: 'science', top_similarity: 0.02 }),
          groundedRow({ grade: '8', subject_code: 'science', top_similarity: 0.03 }),
        ],
        retrieval_traces: [],
      },
      captures,
    );

    const rollup = await rollupTelemetry(fake as never);
    for (const cell of rollup.grounded.by_cell) {
      expect(cell.top_similarity.scale).toBe('rrf');
      expect(cell.top_similarity.scale_label).toBe(SIMILARITY_SCALE_LABEL);
      // S6.1 — the per-cell confidence distribution is normalized, not rrf.
      expect(cell.confidence.scale).toBe('normalized');
      expect(cell.confidence.scale_label).toBe(CONFIDENCE_SCALE_LABEL);
    }
  });
});

// ─── Empty-result handling ───────────────────────────────────────────────────

describe('telemetry — empty result set', () => {
  it('an empty trace set yields a well-formed zero-state rollup (no NaN, no throw)', async () => {
    const captures: SelectCapture[] = [];
    const fake = makeFakeSupabase(
      { grounded_ai_traces: [], retrieval_traces: [] },
      captures,
    );

    const rollup = await rollupTelemetry(fake as never);

    expect(rollup.grounded.sample_size).toBe(0);
    expect(rollup.grounded.hit_rate_proxy).toBeNull();
    expect(rollup.grounded.grounded_rate).toBeNull();
    expect(rollup.grounded.top_similarity.p50).toBeNull();
    expect(rollup.grounded.confidence.p50).toBeNull();
    expect(rollup.grounded.by_cell).toEqual([]);

    expect(rollup.retrieval.sample_size).toBe(0);
    expect(rollup.retrieval.hit_rate_proxy).toBeNull();
    expect(rollup.retrieval.rerank_rate).toBeNull();
    expect(rollup.retrieval.by_cell).toEqual([]);

    // Even with zero rows, the similarity distribution is still labeled RRF-scale
    // (so a downstream reader never mistakes a null distribution for a cosine one).
    expect(rollup.grounded.top_similarity.scale).toBe('rrf');
    expect(rollup.grounded.top_similarity.scale_label).toBe(SIMILARITY_SCALE_LABEL);

    // The serialized output is JSON-clean (no NaN tokens, which JSON.stringify
    // would emit as `null` but which signal a math bug upstream).
    expect(JSON.stringify(rollup)).not.toContain('NaN');
  });

  it('a query error on one table degrades that table to a zero-state, not a throw', async () => {
    const captures: SelectCapture[] = [];
    // Hand-build a client whose grounded read errors but retrieval read succeeds.
    const fake = {
      from(table: string) {
        return {
          select(columns: string) {
            captures.push({ table, columns });
            const erroring = table === 'grounded_ai_traces';
            const result = erroring
              ? { data: null, error: { message: 'boom' } }
              : { data: [retrievalRow({ chunk_ids: ['22222222-2222-4222-8222-222222222222'] })], error: null };
            const builder = {
              limit() {
                return Promise.resolve(result);
              },
              then(onFulfilled: (v: typeof result) => unknown) {
                return Promise.resolve(result).then(onFulfilled);
              },
            };
            return builder;
          },
        };
      },
    };

    const rollup = await rollupTelemetry(fake as never);
    expect(rollup.grounded.sample_size).toBe(0);
    expect(rollup.retrieval.sample_size).toBe(1);
    expect(rollup.retrieval.hit_rate_proxy).toBeCloseTo(1, 10);
  });
});
