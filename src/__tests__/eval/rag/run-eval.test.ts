// src/__tests__/eval/rag/run-eval.test.ts
//
// RED-first PURE unit tests for the B1 retrieval-quality RUNNER (Task 5) —
// the assembly/orchestration layer that wires the real `retrieve()` output
// through the (already-done) Task 2 metrics + Task 7 verdict into a report
// artifact. EVERYTHING here is INJECTED — there is NO real DB, NO real Voyage,
// NO real LLM. This proves the ASSEMBLY logic in isolation:
//   ranked → per-item metrics → aggregate (A4 per-cell) → verdict wiring;
//   the metrics_placeholder → INCONCLUSIVE carry-forward gate;
//   the degraded → INCONCLUSIVE gate;
//   the report-artifact shape (per-cell A4 present, excluded items flagged).
//
// The live-DB entry (real retrieve()) is `run-eval.integration.test.ts`
// (integration lane). This file stays in the NORMAL `npm test` lane.
//
// Pure/offline lane: no DB, no LLM, no network. Relative import (the `@/*`
// Vitest alias does not reach the eval harness, which lives outside src/) —
// matches the convention in metrics.test.ts / verdict.test.ts.

import { describe, it, expect } from 'vitest';

import {
  runEval,
  type RunEvalDeps,
  type InjectedRetrieve,
  type InjectedGroundingCheck,
  type EvalReport,
} from '../../../../eval/rag/harness/run-eval';
import {
  loadBaselineConfig,
  type LoadedBaseline,
} from '../../../../eval/rag/harness/baseline';
import type { GoldenSet } from '../../../../eval/rag/harness/golden-schema';
import type { BaselineConfig } from '../../../../eval/rag/harness/verdict';

// ─── UUID fixtures (valid v4-shaped so they pass the schema validator) ────────

const U = (n: number): string => {
  const h = n.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${h}`;
};

const CHUNK_A = U(1);
const CHUNK_B = U(2);
const CHUNK_C = U(3);
const CHUNK_D = U(4);
const CHUNK_E = U(5);

// ─── A tiny, schema-valid in-memory golden set ────────────────────────────────
// Two grade-bands × two subjects so the A4 per-cell breakdown has >1 cell:
//   - g8 science (band 6-8)   factual    → primary CHUNK_A
//   - g8 science (band 6-8)   multi_hop  → primaries CHUNK_B + CHUNK_C
//   - g10 math   (band 9-10)  conceptual → primary CHUNK_D

function makeGoldenSet(): GoldenSet {
  return {
    version: 'test-v1',
    created_at: '2026-06-13',
    corpus_ref: { source: 'ncert_2025', snapshot_note: 'in-memory test fixture' },
    judge: { model: 'claude-sonnet-4-20250514', rubric_version: 'rag-relevance-v1', temperature: 0 },
    items: [
      {
        id: 'g8-sci-factual-001',
        tier: 'seed',
        query: 'What is the SI unit of force?',
        query_type: 'factual',
        grade: '8',
        subject: 'science',
        chapter_number: 9,
        relevant_chunks: [
          { chunk_id: CHUNK_A, relevance: 2, off_grade_scope: false, label_source: 'assessment' },
        ],
        provenance: null,
      },
      {
        id: 'g8-sci-multihop-001',
        tier: 'seed',
        query: 'Compare the structure of arteries and veins.',
        query_type: 'multi_hop',
        grade: '8',
        subject: 'science',
        chapter_number: 10,
        relevant_chunks: [
          { chunk_id: CHUNK_B, relevance: 2, off_grade_scope: false, label_source: 'assessment' },
          { chunk_id: CHUNK_C, relevance: 2, off_grade_scope: false, label_source: 'assessment' },
        ],
        provenance: null,
      },
      {
        id: 'g10-math-conceptual-001',
        tier: 'seed',
        query: 'Why is the discriminant useful?',
        query_type: 'conceptual',
        grade: '10',
        subject: 'math',
        chapter_number: 4,
        relevant_chunks: [
          { chunk_id: CHUNK_D, relevance: 2, off_grade_scope: false, label_source: 'assessment' },
        ],
        provenance: null,
      },
    ],
  };
}

// ─── A fake retrieve() that returns a scripted ranked chunk list per query ─────
// Maps each golden item's query → the ranked chunk_id list the "system" returns.
// We make every item a PERFECT retrieval (primary chunk at rank 1) so metrics
// are clean 1.0 — the point of THIS test is the WIRING, not the metric math
// (that is metrics.test.ts).

function makePerfectRetrieve(): InjectedRetrieve {
  const byQuery: Record<string, string[]> = {
    'What is the SI unit of force?': [CHUNK_A, CHUNK_E],
    'Compare the structure of arteries and veins.': [CHUNK_B, CHUNK_C, CHUNK_E],
    'Why is the discriminant useful?': [CHUNK_D, CHUNK_E],
  };
  return async (opts) => {
    const ranked = byQuery[opts.query] ?? [];
    return {
      chunks: ranked.map((id) => ({ chunk_id: id, similarity: 0.03, content: `text for ${id}` })),
      reranked: true,
      error: null,
    };
  };
}

// A grounding check that always passes (so groundedness-rate = 1.0).
function makeGroundingPass(): InjectedGroundingCheck {
  return async () => ({ verdict: 'pass' });
}

// A REAL baseline config (non-placeholder) with non-zero metrics so a perfect
// run lands a PASS (no metric regresses against a populated baseline).
function makeRealBaseline(): LoadedBaseline {
  const config: BaselineConfig = {
    metrics: {
      'nDCG@10': 0.9,
      'recall@10': 0.9,
      MRR: 0.9,
      'hit-rate@10': 0.9,
      'groundedness-rate': 0.9,
    },
    bands: {
      'nDCG@10': { band: 0.02, type: 'relative' },
      'recall@10': { band: 0.02, type: 'relative' },
      MRR: { band: 0.03, type: 'relative' },
      'hit-rate@10': { band: 0.02, type: 'absolute' },
      'groundedness-rate': { band: 0.03, type: 'absolute' },
    },
  };
  return { config, metricsPlaceholder: false, raw: { version: 'v1' } };
}

function baseDeps(overrides: Partial<RunEvalDeps> = {}): RunEvalDeps {
  return {
    golden: makeGoldenSet(),
    baseline: makeRealBaseline(),
    retrieve: makePerfectRetrieve(),
    groundingCheck: makeGroundingPass(),
    voyageKeyPresent: true,
    runGroundedness: true,
    ...overrides,
  };
}

describe('run-eval runner (Task 5) — assembly wiring', () => {
  it('wires ranked → metrics → aggregate → verdict and emits a PASS on a clean full-path run', async () => {
    const report = await runEval(baseDeps());

    // Verdict assembled from the (done) verdict module against a real baseline.
    expect(report.verdict.verdict).toBe('PASS');

    // Per-metric primary aggregates are present and perfect for this fixture.
    expect(report.metrics.primary['nDCG@10']).toBeCloseTo(1.0, 10);
    expect(report.metrics.primary['recall@10']).toBeCloseTo(1.0, 10);
    expect(report.metrics.primary['MRR']).toBeCloseTo(1.0, 10);
    expect(report.metrics.primary['hit-rate@10']).toBeCloseTo(1.0, 10);
    expect(report.metrics.primary['groundedness-rate']).toBeCloseTo(1.0, 10);

    // The run was full-path, not degraded.
    expect(report.degraded).toBe(false);
    expect(report.run.full_path).toBe(true);
  });

  it('produces the A4 per-(grade-band × subject) breakdown with item counts', async () => {
    const report = await runEval(baseDeps());

    // recall@10 cells: band 6-8/science (2 items) and band 9-10/math (1 item).
    const recallCells = report.metrics.cells['recall@10'];
    expect(Array.isArray(recallCells)).toBe(true);

    const sci = recallCells.find((c) => c.band === '6-8' && c.subject === 'science');
    const math = recallCells.find((c) => c.band === '9-10' && c.subject === 'math');
    expect(sci).toBeDefined();
    expect(math).toBeDefined();
    expect(sci?.count).toBe(2);
    expect(math?.count).toBe(1);
    expect(sci?.mean).toBeCloseTo(1.0, 10);
  });

  it('reports multi_hop full-coverage@10 (A5) over only the multi_hop items', async () => {
    const report = await runEval(baseDeps());
    // One multi_hop item, both primaries retrieved → coverage 1.0.
    expect(report.metrics.multiHopCoverageAt10).toBeCloseTo(1.0, 10);
  });

  it('FORCES INCONCLUSIVE when the baseline is a placeholder (carry-forward gate), even on a clean full-path run', async () => {
    const placeholderBaseline: LoadedBaseline = {
      ...makeRealBaseline(),
      metricsPlaceholder: true,
    };
    const report = await runEval(baseDeps({ baseline: placeholderBaseline }));

    expect(report.verdict.verdict).toBe('INCONCLUSIVE');
    // The reason must name the placeholder so a reader knows WHY it is inconclusive.
    expect(report.verdict.reasons.some((r) => /placeholder/i.test(r))).toBe(true);
    // The run itself was NOT degraded — the INCONCLUSIVE is purely the placeholder gate.
    expect(report.degraded).toBe(false);
  });

  it('FORCES INCONCLUSIVE when VOYAGE_API_KEY is absent (degraded → FTS-only)', async () => {
    const report = await runEval(baseDeps({ voyageKeyPresent: false }));
    expect(report.degraded).toBe(true);
    expect(report.run.full_path).toBe(false);
    expect(report.verdict.verdict).toBe('INCONCLUSIVE');
    expect(report.verdict.reasons.some((r) => /degraded/i.test(r))).toBe(true);
  });

  it('FORCES INCONCLUSIVE when retrieve() reports a degraded/error result for ANY item', async () => {
    // Voyage key present, but retrieve() surfaces an error (e.g. rerank stage
    // failed → FTS-only fall-through). The runner must mark the run degraded.
    const erroringRetrieve: InjectedRetrieve = async (opts) => {
      if (opts.query === 'Why is the discriminant useful?') {
        return {
          chunks: [{ chunk_id: CHUNK_D, similarity: 0.03, content: 't' }],
          reranked: false,
          error: { phase: 'rerank', message: 'voyage rerank timeout' },
        };
      }
      return makePerfectRetrieve()(opts);
    };
    const report = await runEval(baseDeps({ retrieve: erroringRetrieve }));
    expect(report.degraded).toBe(true);
    expect(report.verdict.verdict).toBe('INCONCLUSIVE');
  });

  it('S5.1 — FORCES INCONCLUSIVE on SILENT rerank-degradation (VOYAGE present, error:null, but a rerank-EXPECTED item came back reranked:false)', async () => {
    // The trap this guards: VOYAGE_API_KEY is present, the Voyage embedding/rerank
    // call FAILS at runtime, FTS still returns chunks → the real retrieve() yields
    // `error: null, reranked: false`. Without this gate the runner would mark the
    // run full-path and gate a tuning decision on a measurement where rerank never
    // actually executed. The signal is scoped to rerank-EXPECTED items
    // (candidateCount > limit), so it can NOT over-trigger on a legitimately
    // un-reranked small candidate pool.
    const silentlyDegradedRetrieve: InjectedRetrieve = async (opts) => {
      if (opts.query === 'Why is the discriminant useful?') {
        return {
          chunks: [{ chunk_id: CHUNK_D, similarity: 0.03, content: 't' }],
          reranked: false, // rerank did NOT run …
          error: null, // … yet there is NO surfaced error (the silent case).
          candidateCount: 40, // > limit (20) → rerank WAS expected here.
        };
      }
      return makePerfectRetrieve()(opts);
    };
    const report = await runEval(baseDeps({ retrieve: silentlyDegradedRetrieve }));
    expect(report.degraded).toBe(true);
    expect(report.run.full_path).toBe(false);
    expect(report.verdict.verdict).toBe('INCONCLUSIVE');
  });

  it('S5.1 — does NOT over-trigger: a rerank-NOT-expected item (candidateCount <= limit) coming back reranked:false stays full-path', async () => {
    // A small candidate pool (<= limit) legitimately skips rerank in the real
    // retrieve() (callVoyageRerank's `documents.length <= topK` short-circuit), so
    // reranked:false there is NOT degradation. The run must remain full-path/PASS.
    const smallPoolRetrieve: InjectedRetrieve = async (opts) => {
      if (opts.query === 'Why is the discriminant useful?') {
        return {
          chunks: [{ chunk_id: CHUNK_D, similarity: 0.03, content: 't' }],
          reranked: false, // not reranked …
          error: null,
          candidateCount: 1, // … but only 1 candidate (<= limit) → rerank not expected.
        };
      }
      return makePerfectRetrieve()(opts);
    };
    const report = await runEval(baseDeps({ retrieve: smallPoolRetrieve }));
    expect(report.degraded).toBe(false);
    expect(report.run.full_path).toBe(true);
    expect(report.verdict.verdict).toBe('PASS');
  });

  it('flags excluded items in the report (|G|=0 / empty-P → excluded, never silently 0/1)', async () => {
    // Add a mis-authored multi_hop item with NO rel==2 chunk: its coverage is
    // excluded; its recall is still measurable (it has a rel-1 chunk). And add
    // an item whose every label is rel 0 → |G|=0 → recall excluded.
    const golden = makeGoldenSet();
    golden.items.push({
      id: 'g8-sci-misauthored-multihop',
      tier: 'seed',
      query: 'mis-authored multi_hop',
      query_type: 'multi_hop',
      grade: '8',
      subject: 'science',
      chapter_number: 11,
      relevant_chunks: [
        { chunk_id: CHUNK_E, relevance: 1, off_grade_scope: false, label_source: 'assessment' },
      ],
      provenance: null,
    });

    const retrieve: InjectedRetrieve = async (opts) => {
      if (opts.query === 'mis-authored multi_hop') {
        return { chunks: [{ chunk_id: CHUNK_E, similarity: 0.03, content: 't' }], reranked: true, error: null };
      }
      return makePerfectRetrieve()(opts);
    };

    const report = await runEval(baseDeps({ golden, retrieve }));

    // The mis-authored multi_hop item is EXCLUDED from coverage (empty P) and FLAGGED.
    expect(report.metrics.excluded.multiHopCoverageAt10).toContain('g8-sci-misauthored-multihop');
  });

  it('S5.2 — EXCLUDES + FLAGS a query-less item (UNMEASURABLE), never scores it as a 0 miss, and does not depress the aggregate', async () => {
    // A B3 trace-mined item can carry only provenance.query_sha256 (no `query`
    // string). The runner cannot retrieve against it, so it must be UNMEASURABLE
    // (excluded + flagged), NOT a genuine 0 miss against its non-empty |G|.
    const golden = makeGoldenSet();
    golden.items.push({
      id: 'g8-sci-traceMined-noQuery',
      tier: 'trace_mined',
      // NO `query` field — sha256-only trace-mined default.
      query_type: 'factual',
      grade: '8',
      subject: 'science',
      chapter_number: 12,
      relevant_chunks: [
        // A real, non-empty relevant set — so if it WERE scored, it would score 0
        // (nothing retrieved) and depress recall@10 for the 6-8/science cell.
        { chunk_id: CHUNK_E, relevance: 2, off_grade_scope: false, label_source: 'assessment' },
      ],
      provenance: {
        trace_table: 'grounded_ai_traces',
        query_sha256: 'a'.repeat(64),
        mined_at: '2026-06-13T00:00:00.000Z',
      },
    });

    // A retrieve() that THROWS if it is ever called for the query-less item (it
    // must never be called) — proving the runner skips the live call entirely.
    const guardedRetrieve: InjectedRetrieve = async (opts) => {
      if (typeof opts.query !== 'string' || opts.query.length === 0) {
        throw new Error('retrieve() must NEVER be called for a query-less item');
      }
      return makePerfectRetrieve()(opts);
    };

    const report = await runEval(baseDeps({ golden, retrieve: guardedRetrieve }));

    // (1) The query-less item is FLAGGED as unmeasurable.
    expect(report.metrics.unmeasurable).toContain('g8-sci-traceMined-noQuery');

    // (2) It is NOT scored: it never appears in items[] and never appears in any
    //     metric's excluded-miss list (it was never pushed into `scored`).
    expect(report.items.some((i) => i.id === 'g8-sci-traceMined-noQuery')).toBe(false);
    expect(report.metrics.excluded['recall@10']).not.toContain('g8-sci-traceMined-noQuery');

    // (3) It does NOT depress the aggregate: recall@10 is still a clean 1.0 (the
    //     three real items all retrieve perfectly), and the 6-8/science cell still
    //     counts only the TWO measurable items, not three.
    expect(report.metrics.primary['recall@10']).toBeCloseTo(1.0, 10);
    const sci = report.metrics.cells['recall@10'].find(
      (c) => c.band === '6-8' && c.subject === 'science',
    );
    expect(sci?.count).toBe(2);
    expect(sci?.mean).toBeCloseTo(1.0, 10);

    // The run is still a clean full-path PASS — the unmeasurable skip is not a
    // degradation (degradation is about the retrieval PATH, not item coverage).
    expect(report.degraded).toBe(false);
    expect(report.verdict.verdict).toBe('PASS');
  });

  it('passes caller="rag-eval-harness", limit=20, candidateCount=40, rerank=true to retrieve()', async () => {
    const seen: Array<{ caller: string; limit?: number; candidateCount?: number; rerank?: boolean }> = [];
    const spyRetrieve: InjectedRetrieve = async (opts) => {
      seen.push({
        caller: opts.caller,
        limit: opts.limit,
        candidateCount: opts.candidateCount,
        rerank: opts.rerank,
      });
      return makePerfectRetrieve()(opts);
    };
    await runEval(baseDeps({ retrieve: spyRetrieve }));
    expect(seen.length).toBe(3);
    for (const call of seen) {
      expect(call.caller).toBe('rag-eval-harness');
      expect(call.limit).toBe(20);
      expect(call.candidateCount).toBe(40);
      expect(call.rerank).toBe(true);
    }
  });

  it('records each item result (id, ranked chunk_ids, query_type) in the report for forensics', async () => {
    const report = await runEval(baseDeps());
    expect(report.items.length).toBe(3);
    const factual = report.items.find((i) => i.id === 'g8-sci-factual-001');
    expect(factual).toBeDefined();
    expect(factual?.ranked).toEqual([CHUNK_A, CHUNK_E]);
    expect(factual?.query_type).toBe('factual');
  });

  it('emits a report whose shape carries verdict + per-metric + per-cell + run metadata', async () => {
    const report: EvalReport = await runEval(baseDeps());
    // Run metadata for B5 (independent of any umbrella CI exit code).
    expect(report.run.golden_version).toBe('test-v1');
    expect(report.run.corpus_source).toBe('ncert_2025');
    expect(typeof report.run.generated_at).toBe('string');
    expect(report.run.k_values).toEqual([5, 10, 20]);
    // Verdict + metrics + cells all present.
    expect(report.verdict).toBeDefined();
    expect(report.metrics.primary).toBeDefined();
    expect(report.metrics.cells['nDCG@10']).toBeDefined();
  });

  it('records groundedness-rate=null when runGroundedness=false, yielding INCONCLUSIVE via the unmeasurable-metric rule (never a silent PASS)', async () => {
    // groundedness-rate becomes unmeasurable → INCONCLUSIVE by the verdict's own
    // unmeasurable-metric rule. This proves the runner honors the toggle AND
    // surfaces it through the verdict module (it does NOT silently PASS).
    const report = await runEval(baseDeps({ runGroundedness: false }));
    expect(report.metrics.primary['groundedness-rate']).toBeNull();
    expect(report.verdict.verdict).toBe('INCONCLUSIVE');
  });
});

describe('loadBaselineConfig (Task 5 baseline loader)', () => {
  it('parses a populated baseline JSON into { config, metricsPlaceholder:false }', () => {
    const doc = {
      version: 'v1',
      metrics: {
        'nDCG@10': 0.8,
        'recall@10': 0.8,
        MRR: 0.8,
        'hit-rate@10': 0.8,
        'groundedness-rate': 0.8,
      },
      bands: {
        'nDCG@10': { band: 0.02, type: 'relative' },
        'recall@10': { band: 0.02, type: 'relative' },
        MRR: { band: 0.03, type: 'relative' },
        'hit-rate@10': { band: 0.02, type: 'absolute' },
        'groundedness-rate': { band: 0.03, type: 'absolute' },
      },
      metrics_placeholder: false,
    };
    const loaded = loadBaselineConfig(doc);
    expect(loaded.metricsPlaceholder).toBe(false);
    expect(loaded.config.metrics['nDCG@10']).toBe(0.8);
    expect(loaded.config.bands['MRR']).toEqual({ band: 0.03, type: 'relative' });
  });

  it('surfaces metrics_placeholder:true so the runner can force INCONCLUSIVE', () => {
    const doc = {
      version: 'v1',
      metrics: { 'nDCG@10': 0.0 },
      bands: { 'nDCG@10': { band: 0.02, type: 'relative' } },
      metrics_placeholder: true,
    };
    const loaded = loadBaselineConfig(doc);
    expect(loaded.metricsPlaceholder).toBe(true);
  });

  it('treats a MISSING metrics_placeholder field as NOT a placeholder', () => {
    const doc = {
      version: 'v1',
      metrics: { 'nDCG@10': 0.8 },
      bands: { 'nDCG@10': { band: 0.02, type: 'relative' } },
    };
    const loaded = loadBaselineConfig(doc);
    expect(loaded.metricsPlaceholder).toBe(false);
  });
});
