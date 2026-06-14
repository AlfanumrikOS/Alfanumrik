// eval/rag/harness/run-eval.ts
//
// B1 retrieval-quality eval harness — Task 5: the RUNNER / ORCHESTRATOR.
//
// ── Single responsibility ────────────────────────────────────────────────────
// Assemble a scored REPORT + a three-state VERDICT from the REAL retrieval path,
// then write that report to B1's OWN artifact under eval/rag/reports/ (B5 —
// independent of any umbrella CI job's exit code, so B2's tuning gate can read
// the verdict directly).
//
//   load + validate golden set (Task 1 validator)
//     → for each item: call retrieve() → ranked chunk_id[] (INJECTED here; the
//       integration test wires the REAL retrieve() + match_rag_chunks_ncert)
//     → per-item metrics (Task 2) → aggregate() into overall + A4 per-cell
//     → multi_hop full-coverage@10 (A5)
//     → groundedness via runGroundingCheck over the served context (Task 3 reuse)
//     → assemble CurrentMetrics → evaluateVerdict(current, baseline) (Task 7)
//     → EvalReport (verdict + per-metric + per-cell + excluded/flagged items)
//
// ── Two GATES that force INCONCLUSIVE (assessment MUST) ──────────────────────
//   1. CARRY-FORWARD: if the loaded baseline has metrics_placeholder === true,
//      force INCONCLUSIVE — never PASS/REGRESS against a placeholder baseline.
//   2. DEGRADED: if VOYAGE_API_KEY is absent (retrieval degrades to FTS-only),
//      OR retrieve() reports degraded/error for ANY item, OR a rerank-EXPECTED
//      item silently came back un-reranked while Voyage was present (S5.1 — the
//      embedding/rerank stage did not actually execute even though FTS still
//      returned chunks), mark degraded=true so the verdict module returns
//      INCONCLUSIVE. You cannot gate a tuning decision on a degraded measurement.
//
// ── Query-less items are UNMEASURABLE, not a miss (S5.2) ─────────────────────
// A B3 trace-mined item may carry only `provenance.query_sha256` (no `query`
// string). The runner CANNOT retrieve against it, so it is EXCLUDED from the
// live call and from `scored` (it never depresses an aggregate), and flagged in
// `metrics.unmeasurable`. An item the runner cannot retrieve against is
// unmeasurable, not a score-0 miss.
//
// ── Dependency injection (the design that keeps the runner pure + lint-clean) ─
// The runner NEVER imports `retrieve.ts` (a `.ts`-extension Deno module) or
// `grounding-check.ts` directly. It takes them as INJECTED functions
// (`InjectedRetrieve` / `InjectedGroundingCheck`). This:
//   - lets the NORMAL-lane unit test (run-eval.test.ts) prove the assembly with
//     fakes, no DB / no LLM;
//   - keeps the runner free of the AI-boundary lint surface (no direct RAG-RPC
//     call, no Anthropic/Voyage SDK import, no api.*.com URL — those all live
//     behind the injected fns, wired ONLY by the live-DB integration test where
//     the real modules are dynamically imported);
//   - the integration test (`run-eval.integration.test.ts`) dynamically imports
//     the REAL retrieve() (`supabase/functions/_shared/rag/retrieve.ts`) and the
//     REAL runGroundingCheck (`supabase/functions/grounded-answer/
//     grounding-check.ts`) — both allowlisted by the ai-boundary rules — and
//     adapts them to these injected shapes.
//
// Offline tooling: NEVER imported by production / client code (enforced by the
// import-boundary test). Writes ONLY to eval/rag/reports/. Zero DB writes.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  validateGoldenSet,
  type Grade,
  type GoldenItem,
  type GoldenSet,
  type QueryType,
  type SubjectCode,
} from './golden-schema';
import {
  aggregate,
  hitRateAtK,
  mrr,
  multiHopCoverageAtK,
  ndcgAtK,
  recallAtK,
  type AggregateResult,
  type GradeBand,
  type ScoredItem,
} from './metrics';
import type { LoadedBaseline } from './baseline';
import {
  evaluateVerdict,
  PRIMARY_METRICS,
  type CurrentMetrics,
  type PrimaryMetric,
  type VerdictResult,
} from './verdict';

// ─── Injected dependency shapes ───────────────────────────────────────────────

/**
 * The subset of `RetrieveOptions` the runner drives. Mirrors the real
 * `retrieve.ts` contract (`query`, `grade`, `subject`, `chapterNumber`,
 * `limit`, `candidateCount`, `rerank`, `caller`) — INJECTED so the runner does
 * NOT import the `.ts`-extension Deno module nor trip the AI-boundary lint.
 */
export interface InjectedRetrieveOptions {
  query: string;
  grade: Grade;
  subject: string;
  chapterNumber: number | null;
  limit: number;
  candidateCount: number;
  rerank: boolean;
  caller: string;
}

/** A retrieved chunk as the runner needs it: id + content (for groundedness). */
export interface InjectedRetrievedChunk {
  chunk_id: string;
  content: string;
  similarity?: number;
}

/**
 * The subset of `RetrievalResult` the runner reads: the ranked chunk list, the
 * `reranked` flag, and the `error` field (a non-null error means retrieval
 * degraded — Path-2 FTS-only fall-through or a failed stage → INCONCLUSIVE).
 */
export interface InjectedRetrievalResult {
  chunks: InjectedRetrievedChunk[];
  reranked: boolean;
  error: { phase: string; message: string } | null;
  /**
   * The size of the candidate pool that was fed to the rerank stage, i.e. the
   * count BEFORE the `limit` cap (the real `retrieve.ts` only reranks when the
   * candidate pool exceeds `topK = limit` — see `callVoyageRerank`'s
   * `documents.length <= topK` short-circuit). The integration test wires this
   * from the real RPC match count; the unit tests set it explicitly.
   *
   * Used ONLY to scope the S5.1 "silent rerank-degradation" signal: when Voyage
   * is present but a rerank-EXPECTED item (`candidateCount > limit`) comes back
   * with `reranked === false`, the run is silently degraded. When this field is
   * absent (`undefined`), the runner falls back to a conservative proxy
   * (`chunks.length >= limit`) so an adapter that cannot supply the pool size is
   * not penalised, while a pool of fewer than `limit` candidates is never read
   * as "rerank should have run".
   */
  candidateCount?: number;
}

/** The injected retrieve() — the integration test adapts the REAL one to this. */
export type InjectedRetrieve = (
  opts: InjectedRetrieveOptions,
) => Promise<InjectedRetrievalResult>;

/**
 * The injected groundedness check — the integration test adapts the REAL
 * `runGroundingCheck` to this `{ verdict }` shape. Returns 'pass' when the
 * served context supports a grounded answer.
 */
export type InjectedGroundingCheck = (args: {
  query: string;
  chunks: InjectedRetrievedChunk[];
}) => Promise<{ verdict: 'pass' | 'fail' }>;

/** Everything the runner needs, all injected (no env auto-detect, no DB here). */
export interface RunEvalDeps {
  /** The golden set (already in-memory). The runner re-validates it (Task 1). */
  golden: GoldenSet;
  /** The loaded baseline (config + metrics_placeholder bit) — Task 5 loader. */
  baseline: LoadedBaseline;
  /** The injected retrieve() — REAL in the integration test, fake in unit. */
  retrieve: InjectedRetrieve;
  /** The injected groundedness check — REAL in integration, fake in unit. */
  groundingCheck: InjectedGroundingCheck;
  /**
   * Whether VOYAGE_API_KEY was present. When false the run is DEGRADED (FTS-only)
   * → INCONCLUSIVE. The integration test derives this from the live env.
   */
  voyageKeyPresent: boolean;
  /**
   * Run groundedness (one groundingCheck call per item). On by default for the
   * seed tier (spec §3.5 / Q4). When false, groundedness-rate is recorded null
   * (→ INCONCLUSIVE via the verdict's unmeasurable-metric rule).
   */
  runGroundedness: boolean;
}

// ─── Report shapes (B1's own artifact — B5) ───────────────────────────────────

/** The k window the primary band metrics are reported at (spec §B1.4/A7). */
export const PRIMARY_K = 10 as const;
/** retrieve() drives limit = max(k) = 20 and candidateCount = 40 (spec §B1.4). */
export const RETRIEVE_LIMIT = 20 as const;
export const RETRIEVE_CANDIDATE_COUNT = 40 as const;
/** The default k values reported (spec §B1.4). */
export const REPORT_K_VALUES = [5, 10, 20] as const;
/** The harness's self-identifying caller (spec §B1.1). */
export const HARNESS_CALLER = 'rag-eval-harness' as const;

/** One A4 cell as serialized into the report. */
export interface ReportCell {
  band: GradeBand;
  subject: SubjectCode;
  mean: number | null;
  count: number;
  excluded: number;
}

/** Per-item forensic record. */
export interface ReportItem {
  id: string;
  query_type: QueryType;
  grade: Grade;
  subject: SubjectCode;
  /** The system's ranked chunk_id output (deduped at metric time, raw here). */
  ranked: string[];
  /** retrieve() error, if any (a non-null error degrades the run). */
  retrieve_error: { phase: string; message: string } | null;
  /** Groundedness verdict for this item ('pass' | 'fail' | null when skipped). */
  groundedness: 'pass' | 'fail' | null;
}

/** The metrics block: primary aggregates + A4 cells + excluded-item flags. */
export interface ReportMetrics {
  /** Primary band-metric overall means (the verdict inputs). null = unmeasurable. */
  primary: Record<PrimaryMetric, number | null>;
  /** A4 per-(grade-band × subject) breakdown per primary metric. */
  cells: Record<PrimaryMetric, ReportCell[]>;
  /** A5 multi_hop full-coverage@10 overall (reported, NOT a primary gate metric). */
  multiHopCoverageAt10: number | null;
  /** Ids of items EXCLUDED from each metric (|G|=0 / empty-P) — never silent. */
  excluded: Record<PrimaryMetric | 'multiHopCoverageAt10', string[]>;
  /**
   * Ids of items the runner CANNOT retrieve against (no `query` string — a B3
   * sha256-only trace-mined item). These are UNMEASURABLE, not a miss: they are
   * never sent to retrieve(), never scored, and never depress an aggregate. They
   * are flagged here so a reader knows the run intentionally skipped them.
   */
  unmeasurable: string[];
}

/** Run metadata (B5 — read independently of any umbrella CI exit code). */
export interface ReportRunMeta {
  generated_at: string;
  golden_version: string;
  corpus_source: string;
  k_values: number[];
  /** True iff the run used the full embeddings+rerank path (VOYAGE_API_KEY present
   *  AND no per-item retrieve error). A degraded run is INCONCLUSIVE. */
  full_path: boolean;
  caller: string;
  retrieve_limit: number;
  retrieve_candidate_count: number;
  groundedness_run: boolean;
  baseline_placeholder: boolean;
}

/** B1's own report artifact (B5). */
export interface EvalReport {
  run: ReportRunMeta;
  /** True when the run was degraded (no Voyage OR any retrieve error). */
  degraded: boolean;
  verdict: VerdictResult;
  metrics: ReportMetrics;
  items: ReportItem[];
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Project an `AggregateResult`'s cells into the report's `ReportCell[]`. */
function toReportCells(agg: AggregateResult): ReportCell[] {
  return agg.cells.map((c) => ({
    band: c.band,
    subject: c.subject as SubjectCode,
    mean: c.mean,
    count: c.count,
    excluded: c.excluded,
  }));
}

/**
 * The MRR aggregator: `mrr` has the `(ranked, relevant, maxK?)` signature, so we
 * adapt it to the `ItemMetric` `(ranked, relevant, k)` shape `aggregate` expects
 * by treating `k` as the search-window bound `maxK`.
 */
function mrrItemMetric(
  ranked: readonly string[],
  relevant: Parameters<typeof mrr>[1],
  k: number,
): number | null {
  return mrr(ranked, relevant, k);
}

// ─── The orchestrator ─────────────────────────────────────────────────────────

/**
 * Assemble the scored report + verdict from injected deps. PURE w.r.t. I/O — it
 * performs NO file/DB writes (the caller persists via `writeReport`). Async only
 * because retrieve()/groundingCheck are async. Calls retrieve() once per golden
 * item with caller='rag-eval-harness', limit=20, candidateCount=40, rerank=true.
 *
 * The two INCONCLUSIVE gates:
 *   - degraded = !voyageKeyPresent OR any per-item retrieve error OR a silent
 *     rerank-degradation (S5.1 — Voyage present but a rerank-expected item came
 *     back un-reranked) → the CurrentMetrics.degraded flag → verdict
 *     INCONCLUSIVE (verdict.ts precedence).
 *   - baseline.metricsPlaceholder === true → we ALSO set degraded-equivalent by
 *     prepending a placeholder reason and forcing the verdict to INCONCLUSIVE in
 *     code (the verdict module knows nothing about placeholders — that gate lives
 *     HERE, the carry-forward condition).
 */
export async function runEval(deps: RunEvalDeps): Promise<EvalReport> {
  const { golden, baseline, retrieve, groundingCheck, voyageKeyPresent, runGroundedness } = deps;

  // Re-validate the golden set (Task 1). A bad fixture is an operator error.
  const validated = validateGoldenSet(golden);
  if (!validated.ok) {
    throw new Error(`golden set failed validation:\n${validated.errors.join('\n')}`);
  }
  const items = validated.value.items;

  // ── Drive retrieve() per item, collect ranked lists + degradation signal ────
  const scored: ScoredItem[] = [];
  const reportItems: ReportItem[] = [];
  const unmeasurable: string[] = [];
  let anyRetrieveError = false;
  let anySilentRerankDegradation = false;

  for (const item of items) {
    // A trace-mined item may carry only query_sha256 (B3 sha256-only default).
    // The runner can ONLY retrieve against an actual query string. An item with
    // no query is UNMEASURABLE — not a miss (S5.2): we do NOT call retrieve(), do
    // NOT push it into `scored` (so it cannot depress any aggregate against a
    // non-empty |G|), and flag its id so the skip is never silent.
    const hasQuery = typeof item.query === 'string' && item.query.length > 0;
    if (!hasQuery) {
      unmeasurable.push(item.id);
      continue;
    }

    const result: InjectedRetrievalResult = await retrieve({
      query: item.query as string,
      grade: item.grade,
      subject: item.subject,
      chapterNumber: item.chapter_number,
      limit: RETRIEVE_LIMIT,
      candidateCount: RETRIEVE_CANDIDATE_COUNT,
      rerank: true,
      caller: HARNESS_CALLER,
    });

    if (result.error !== null) anyRetrieveError = true;

    // ── S5.1 — silent rerank-degradation signal ──────────────────────────────
    // The runner ALWAYS requests rerank=true. But `reranked: false` is only a
    // DEGRADATION signal when rerank was actually EXPECTED to run: the real
    // `retrieve.ts` legitimately skips rerank (reranked=false, error=null) when
    // the candidate pool is `<= limit` (callVoyageRerank's `documents.length <=
    // topK` short-circuit). So we scope the signal to rerank-EXPECTED items:
    //   - candidateCount > limit (the pool exceeded the cap → rerank should run);
    //     when candidateCount is not supplied, fall back to the conservative
    //     proxy `chunks.length >= limit` (a full page returned implies the pool
    //     was at least as large as the cap).
    // Voyage present + a rerank-EXPECTED item that comes back reranked=false
    // means embeddings/rerank did not actually execute (e.g. the Voyage call
    // failed at runtime yet FTS still returned chunks) → silent degradation.
    if (voyageKeyPresent && !result.reranked) {
      const pool =
        typeof result.candidateCount === 'number'
          ? result.candidateCount
          : result.chunks.length;
      const rerankWasExpected =
        typeof result.candidateCount === 'number'
          ? pool > RETRIEVE_LIMIT
          : pool >= RETRIEVE_LIMIT;
      if (rerankWasExpected) anySilentRerankDegradation = true;
    }

    const ranked = result.chunks.map((c) => c.chunk_id);

    // ── Groundedness (spec §3.5): one groundingCheck over the served context ──
    let groundedness: 'pass' | 'fail' | null = null;
    if (runGroundedness) {
      const g = await groundingCheck({ query: item.query as string, chunks: result.chunks });
      groundedness = g.verdict;
    }

    scored.push({ item: item as GoldenItem, ranked });
    reportItems.push({
      id: item.id,
      query_type: item.query_type,
      grade: item.grade,
      subject: item.subject,
      ranked,
      retrieve_error: result.error,
      groundedness,
    });
  }

  // ── Degraded determination (the DEGRADED gate) ──────────────────────────────
  // Degraded when: VOYAGE_API_KEY absent (FTS-only) OR any per-item retrieve
  // error OR a SILENT rerank-degradation (S5.1 — Voyage present but a
  // rerank-expected item never actually reranked). A run where embeddings/rerank
  // did not actually execute is degraded → INCONCLUSIVE.
  const degraded = !voyageKeyPresent || anyRetrieveError || anySilentRerankDegradation;
  const fullPath = !degraded;

  // ── Aggregate the primary band metrics at k=10 (the A7 gate window) ─────────
  const recallAgg = aggregate(scored, PRIMARY_K, recallAtK);
  const ndcgAgg = aggregate(scored, PRIMARY_K, ndcgAtK);
  const mrrAgg = aggregate(scored, RETRIEVE_LIMIT, mrrItemMetric); // MRR window = max-k = 20
  const hitAgg = aggregate(scored, PRIMARY_K, hitRateAtK);
  const coverageAgg = aggregate(scored, PRIMARY_K, multiHopCoverageAtK);

  // groundedness-rate: fraction of items whose served context passed grounding.
  // Items where groundedness was skipped (null) are EXCLUDED + flagged so the
  // rate is honest (and unmeasurable → INCONCLUSIVE when groundedness is off).
  const groundednessExcluded: string[] = [];
  let groundedMeasured = 0;
  let groundedPass = 0;
  for (const ri of reportItems) {
    if (ri.groundedness === null) {
      groundednessExcluded.push(ri.id);
    } else {
      groundedMeasured += 1;
      if (ri.groundedness === 'pass') groundedPass += 1;
    }
  }
  const groundednessRate: number | null =
    groundedMeasured === 0 ? null : groundedPass / groundedMeasured;

  // ── Assemble CurrentMetrics for the verdict ─────────────────────────────────
  const primary: Record<PrimaryMetric, number | null> = {
    'nDCG@10': ndcgAgg.overall.mean,
    'recall@10': recallAgg.overall.mean,
    MRR: mrrAgg.overall.mean,
    'hit-rate@10': hitAgg.overall.mean,
    'groundedness-rate': groundednessRate,
  };

  const cells: Record<PrimaryMetric, ReportCell[]> = {
    'nDCG@10': toReportCells(ndcgAgg),
    'recall@10': toReportCells(recallAgg),
    MRR: toReportCells(mrrAgg),
    'hit-rate@10': toReportCells(hitAgg),
    // groundedness has no per-item ItemMetric path through aggregate(); it is
    // reported as an overall rate only (cells empty — honest, not faked).
    'groundedness-rate': [],
  };

  const excluded: Record<PrimaryMetric | 'multiHopCoverageAt10', string[]> = {
    'nDCG@10': ndcgAgg.overall.excludedIds,
    'recall@10': recallAgg.overall.excludedIds,
    MRR: mrrAgg.overall.excludedIds,
    'hit-rate@10': hitAgg.overall.excludedIds,
    'groundedness-rate': groundednessExcluded,
    multiHopCoverageAt10: coverageAgg.overall.excludedIds,
  };

  const current: CurrentMetrics = { degraded, metrics: primary };

  // ── Verdict, with the CARRY-FORWARD (placeholder) gate applied IN CODE ───────
  let verdict: VerdictResult = evaluateVerdict(current, baseline.config);
  if (baseline.metricsPlaceholder) {
    // CARRY-FORWARD CONDITION: a placeholder baseline can NEVER yield PASS/REGRESS.
    // Force INCONCLUSIVE and surface the reason. (The verdict module is unaware of
    // placeholders by design — this gate is the runner's responsibility.)
    verdict = {
      verdict: 'INCONCLUSIVE',
      perMetric: verdict.perMetric,
      reasons: [
        'INCONCLUSIVE: baseline is a PLACEHOLDER (metrics_placeholder=true) — its metric values are not a real full-path measurement; cannot declare PASS/REGRESS against it. Populate the baseline via a reviewed full-path run (Task 10).',
        ...verdict.reasons,
      ],
    };
  }

  const report: EvalReport = {
    run: {
      generated_at: new Date().toISOString(),
      golden_version: validated.value.version,
      corpus_source: validated.value.corpus_ref.source,
      k_values: [...REPORT_K_VALUES],
      full_path: fullPath,
      caller: HARNESS_CALLER,
      retrieve_limit: RETRIEVE_LIMIT,
      retrieve_candidate_count: RETRIEVE_CANDIDATE_COUNT,
      groundedness_run: runGroundedness,
      baseline_placeholder: baseline.metricsPlaceholder,
    },
    degraded,
    verdict,
    metrics: {
      primary,
      cells,
      multiHopCoverageAt10: coverageAgg.overall.mean,
      excluded,
      unmeasurable,
    },
    items: reportItems,
  };

  return report;
}

// ─── Report-artifact persistence (B5) ─────────────────────────────────────────

/** The directory B1 writes its own report artifacts to (B5). */
export const REPORTS_DIR = resolve(__dirname, '..', 'reports');

/**
 * Write the report to B1's OWN artifact under eval/rag/reports/ (B5 — read
 * independently of the umbrella integration-job exit code). Returns the path.
 * The filename is timestamped so concurrent/historical runs don't clobber.
 */
export function writeReport(report: EvalReport, dir: string = REPORTS_DIR): string {
  mkdirSync(dir, { recursive: true });
  const stamp = report.run.generated_at.replace(/[:.]/g, '-');
  const path = resolve(dir, `rag-eval-${stamp}.json`);
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  return path;
}
