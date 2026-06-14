// eval/rag/harness/b2-sweep.ts
//
// Sub-project B2 — RAG retrieval TUNING sweep harness (MEASUREMENT-ONLY).
//
// ── What this is ─────────────────────────────────────────────────────────────
// A measurement driver that runs the B1 golden set through retrieval at a set of
// configurations and scores each config with the B1 metric + verdict modules
// (metrics.ts / verdict.ts) against the COMMITTED baseline. It exists to find a
// retrieval-setting change that beats the baseline WITHOUT regressing any cell.
//
// It is NOT a production edit. It NEVER writes the DB. It NEVER mutates
// retrieve.ts or the RPC. The two "REPLICA" configs below reproduce the live
// pipeline's hardcoded RRF-k / MMR-λ in TypeScript so those (otherwise
// un-parameterizable) knobs can be measured — they are CLEARLY LABELLED as a
// measurement replica of the live path, validated against the real retrieve()
// at default params (see `validate-replica` mode) before any swept value is read.
//
// ── Two retrieval lanes ──────────────────────────────────────────────────────
//   LANE A ("live"): drives the REAL retrieve() from
//     supabase/functions/_shared/rag/retrieve.ts. Exposes cleanly: minSimilarity
//     (the p_min_quality floor), candidateCount (fetch-N), limit, rerank. RRF-k
//     and MMR-λ are HARDCODED inside retrieve()/the RPC, so this lane CANNOT vary
//     them — it varies floor + fetch-N only.
//   LANE B ("replica"): reproduces the live pipeline in TS — vec arm + fts arm
//     candidate fetch (mirrors the RPC's two CTEs) → RRF fusion (parameterized k)
//     → Voyage rerank-2 (real call) → MMR (parameterized λ via the real
//     applyMMR). At k=60, λ=0.7, fetchPerArm=4×candidateCount this MUST match the
//     live lane (validated). Used ONLY to vary RRF-k and MMR-λ.
//
// ── Groundedness ─────────────────────────────────────────────────────────────
// Ranking-only changes barely move groundedness (it is a top-chunk-supported
// proxy — S5.3), and it costs one Anthropic call per item. To keep the verdict
// MEASURABLE (a null groundedness forces INCONCLUSIVE), each config reuses the
// REAL runGroundingCheck over its OWN served context — so the verdict is a real
// full-path PASS/REGRESS, not INCONCLUSIVE.
//
// Run:  npx tsx eval/rag/harness/b2-sweep.ts [mode]
//   mode = validate-replica | floor | fetchn | mmr | rrfk | all   (default: all)
//
// Offline tooling. Reads .env.local. Writes ONLY to eval/rag/reports/b2/.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadDotenv } from '../../../agents/runtime/env';
import {
  validateGoldenSet,
  type GoldenItem,
  type GoldenSet,
} from './golden-schema';
import {
  aggregate,
  hitRateAtK,
  mrr,
  ndcgAtK,
  recallAtK,
  type AggregateResult,
  type ItemMetric,
  type ScoredItem,
} from './metrics';
import { loadBaselineFile, type LoadedBaseline } from './baseline';
import {
  evaluateVerdict,
  PRIMARY_METRICS,
  type CurrentMetrics,
  type PrimaryMetric,
  type VerdictResult,
} from './verdict';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
loadDotenv(REPO_ROOT);

const GOLDEN_PATH = resolve(REPO_ROOT, 'eval', 'rag', 'golden', 'ncert-golden-v1.json');
const BASELINE_PATH = resolve(REPO_ROOT, 'eval', 'rag', 'baseline', 'ncert-baseline-v1.json');
const OUT_DIR = resolve(REPO_ROOT, 'eval', 'rag', 'reports', 'b2');

const PRIMARY_K = 10;
const RETRIEVE_LIMIT = 20;
const HARNESS_CALLER = 'rag-b2-sweep';

const VOYAGE_EMBED_ENDPOINT = 'https://api.voyageai.com/v1/embeddings';
const VOYAGE_RERANK_ENDPOINT = 'https://api.voyageai.com/v1/rerank';
const VOYAGE_EMBED_MODEL = 'voyage-3';
const VOYAGE_RERANK_MODEL = 'rerank-2';
const EMBEDDING_DIMENSIONS = 1024;

// ── Live-path defaults (must mirror retrieve.ts) ─────────────────────────────
const LIVE_DEFAULT_FLOOR = 0.5; // DEFAULT_MIN_SIMILARITY in retrieve.ts
const LIVE_DEFAULT_FETCHN = 40; // candidateCount (RERANK_DEFAULT_FETCH)
const LIVE_DEFAULT_RRF_K = 60; // v_k CONSTANT in the RPC
const LIVE_DEFAULT_MMR_LAMBDA = 0.7; // applyMMR(chunks, 0.7) in retrieve.ts

/* eslint-disable @typescript-eslint/no-explicit-any */
async function loadRealRetrieve(): Promise<any> {
  return import('../../../supabase/functions/_shared/rag/retrieve');
}
async function loadRealGroundingCheck(): Promise<any> {
  return import('../../../supabase/functions/grounded-answer/grounding-check');
}
async function loadRealMMR(): Promise<any> {
  return import('../../../supabase/functions/_shared/rag/mmr');
}
/* eslint-enable @typescript-eslint/no-explicit-any */

interface Creds { url: string; serviceKey: string; voyageKey: string; anthropicKey: string; }

function readCreds(): Creds | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const voyageKey = process.env.VOYAGE_API_KEY ?? '';
  const anthropicKey = process.env.ANTHROPIC_API_KEY ?? '';
  if (!url || !serviceKey) return null;
  if (/placeholder/i.test(url) || /placeholder/i.test(serviceKey)) return null;
  if (!voyageKey) return null; // full path requires Voyage; degraded runs are useless here
  return { url, serviceKey, voyageKey, anthropicKey };
}

function loadGolden(): GoldenSet {
  const doc = JSON.parse(readFileSync(GOLDEN_PATH, 'utf-8')) as unknown;
  const v = validateGoldenSet(doc);
  if (!v.ok) throw new Error(`golden invalid:\n${v.errors.join('\n')}`);
  return v.value;
}
function loadBaseline(): LoadedBaseline { return loadBaselineFile(BASELINE_PATH); }

// ─── Voyage helpers (mirror retrieve.ts contract) ────────────────────────────

async function voyageEmbed(text: string, apiKey: string): Promise<number[] | null> {
  try {
    const res = await fetch(VOYAGE_EMBED_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: VOYAGE_EMBED_MODEL, input: [text], output_dimension: EMBEDDING_DIMENSIONS }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
    const emb = body?.data?.[0]?.embedding;
    return Array.isArray(emb) && emb.length === EMBEDDING_DIMENSIONS ? emb : null;
  } catch { return null; }
}

async function voyageRerank(query: string, docs: string[], topK: number, apiKey: string): Promise<{ rankedIndices: number[]; reranked: boolean }> {
  if (docs.length === 0 || docs.length <= topK) return { rankedIndices: docs.map((_, i) => i), reranked: false };
  try {
    const res = await fetch(VOYAGE_RERANK_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: VOYAGE_RERANK_MODEL, query, documents: docs, top_k: topK }),
    });
    if (!res.ok) return { rankedIndices: docs.map((_, i) => i).slice(0, topK), reranked: false };
    const body = (await res.json()) as { data?: Array<{ index: number }> };
    const ranked = body?.data;
    if (!Array.isArray(ranked) || ranked.length === 0) return { rankedIndices: docs.map((_, i) => i).slice(0, topK), reranked: false };
    return { rankedIndices: ranked.slice(0, topK).map((r) => r.index).filter((i) => Number.isInteger(i)), reranked: true };
  } catch { return { rankedIndices: docs.map((_, i) => i).slice(0, topK), reranked: false }; }
}

// ─── LANE B: FAITHFUL MMR-λ replica of the live pipeline ──────────────────────
//
// The live pipeline is: RPC (RRF k=60 over vec+fts arms, fused BEFORE the cut)
//   → cut to candidateCount → Voyage rerank-2 → applyMMR(0.7). Only the LAST step
// (MMR λ) is what we vary here.
//
// FAITHFUL POOL: we get the RRF-fused candidate pool DIRECTLY from the real RPC
// via retrieve(rerank:false, limit=fetchN). With rerank off and a large limit,
// retrieve() returns the RPC's RRF-ordered rows (k=60, the real in-RPC fusion)
// with NO rerank and NO MMR applied — exactly the pool the live rerank step sees.
// We then apply the REAL Voyage rerank-2 + the REAL applyMMR at the swept λ. This
// is byte-faithful to the live path at λ=0.7 (validated by validate-replica:
// replica@λ0.7 vs live ≈ 1.0 top-10 Jaccard).
//
// RRF-k is NOT measured this way: it lives inside the SQL RPC (v_k CONSTANT := 60)
// and the RPC fuses the two arms internally BEFORE the cut. Reproducing that
// faithfully needs the raw per-arm vector ranking (ORDER BY embedding <=> q),
// which supabase-js cannot express and no parameterized measurement RPC exists.
// An earlier two-RPC approximation scored only 0.505 top-10 Jaccard vs live, so
// it is NOT trustworthy — RRF-k is reported as un-measurable-without-DDL, not
// guessed. See the findings doc.

// Each candidate carries its ORIGINAL RRF similarity from the RPC. The live
// retrieve() preserves this `similarity` through the rerank-index remap and
// feeds it (NOT the Voyage rerank score) to applyMMR as the relevance term —
// so the replica MUST do the same or the MMR ordering diverges (it did: passing
// a constant similarity made MMR's diversity term dominate, collapsing parity).
interface CandRow { id: string; content: string; similarity: number; }

/** Faithful RRF-fused candidate pool from the real RPC (rerank off, MMR off). */
async function fetchRrfPool(realRetrieve: any, sb: any, creds: Creds, item: GoldenItem, fetchN: number, floor: number): Promise<{ pool: CandRow[]; error: boolean }> {
  const res = await realRetrieve({
    query: item.query, grade: item.grade, subject: item.subject,
    chapterNumber: item.chapter_number ?? null, limit: fetchN, candidateCount: fetchN,
    rerank: false, caller: HARNESS_CALLER, minSimilarity: floor, supabase: sb, voyageApiKey: creds.voyageKey,
  });
  const pool = (res.chunks ?? []).map((c: any) => ({ id: String(c.chunk_id), content: String(c.content ?? c.excerpt ?? ''), similarity: typeof c.similarity === 'number' ? c.similarity : 0 }));
  return { pool, error: res.error != null };
}

// ─── Metric aggregation + verdict for one config ─────────────────────────────

const mrrItemMetric: ItemMetric = (ranked, relevant, k) => mrr(ranked, relevant, k);

interface CellSummary { cell: string; ndcg: number | null; recall: number | null; mrr: number | null; hit: number | null; count: number; }

interface ConfigResult {
  config: string;
  lane: 'live' | 'replica';
  params: Record<string, number | string>;
  overall: Record<PrimaryMetric, number | null>;
  juniorMath: CellSummary | null;
  cells: CellSummary[];
  verdict: VerdictResult;
  degraded: boolean;
  rerankedAll: boolean;
}

function cellSummariesFrom(scored: ScoredItem[]): CellSummary[] {
  const ndcg = aggregate(scored, PRIMARY_K, ndcgAtK);
  const recall = aggregate(scored, PRIMARY_K, recallAtK);
  const mrrA = aggregate(scored, RETRIEVE_LIMIT, mrrItemMetric);
  const hit = aggregate(scored, PRIMARY_K, hitRateAtK);
  const byCell = new Map<string, CellSummary>();
  const merge = (agg: AggregateResult, field: 'ndcg' | 'recall' | 'mrr' | 'hit') => {
    for (const c of agg.cells) {
      const key = `${c.band}/${c.subject}`;
      const cur = byCell.get(key) ?? { cell: key, ndcg: null, recall: null, mrr: null, hit: null, count: c.count };
      (cur as any)[field] = c.mean; cur.count = Math.max(cur.count, c.count);
      byCell.set(key, cur);
    }
  };
  merge(ndcg, 'ndcg'); merge(recall, 'recall'); merge(mrrA, 'mrr'); merge(hit, 'hit');
  return [...byCell.values()].sort((a, b) => a.cell.localeCompare(b.cell));
}

function buildConfigResult(
  config: string, lane: 'live' | 'replica', params: Record<string, number | string>,
  scored: ScoredItem[], groundednessRate: number | null, degraded: boolean, rerankedAll: boolean,
  baseline: LoadedBaseline,
): ConfigResult {
  const ndcg = aggregate(scored, PRIMARY_K, ndcgAtK).overall.mean;
  const recall = aggregate(scored, PRIMARY_K, recallAtK).overall.mean;
  const mrrV = aggregate(scored, RETRIEVE_LIMIT, mrrItemMetric).overall.mean;
  const hit = aggregate(scored, PRIMARY_K, hitRateAtK).overall.mean;
  const overall: Record<PrimaryMetric, number | null> = {
    'nDCG@10': ndcg, 'recall@10': recall, MRR: mrrV, 'hit-rate@10': hit,
    'groundedness-rate': groundednessRate,
  };
  const current: CurrentMetrics = { degraded, metrics: overall };
  const verdict = evaluateVerdict(current, baseline.config);
  const cells = cellSummariesFrom(scored);
  const juniorMath = cells.find((c) => c.cell === '6-8/math') ?? null;
  return { config, lane, params, overall, juniorMath, cells, verdict, degraded, rerankedAll };
}

// ─── Run one config ──────────────────────────────────────────────────────────

async function runLiveConfig(
  realRetrieve: any, runGroundingCheck: any, sb: any, creds: Creds,
  golden: GoldenSet, baseline: LoadedBaseline,
  config: string, floor: number, fetchN: number,
): Promise<ConfigResult> {
  const scored: ScoredItem[] = [];
  let anyError = false; let rerankedAll = true;
  let gMeasured = 0; let gPass = 0;
  for (const item of golden.items) {
    if (!item.query) continue;
    const result = await realRetrieve({
      query: item.query, grade: item.grade, subject: item.subject,
      chapterNumber: item.chapter_number ?? null, limit: RETRIEVE_LIMIT,
      candidateCount: fetchN, rerank: true, caller: HARNESS_CALLER,
      minSimilarity: floor, supabase: sb, voyageApiKey: creds.voyageKey,
    });
    if (result.error) anyError = true;
    if (result.chunks.length >= RETRIEVE_LIMIT && !result.reranked) rerankedAll = false;
    const ranked = result.chunks.map((c: any) => c.chunk_id);
    scored.push({ item: item as GoldenItem, ranked });
    if (creds.anthropicKey) {
      const cand = result.chunks.length > 0 ? String(result.chunks[0].content ?? result.chunks[0].excerpt ?? '').slice(0, 400) : '{{INSUFFICIENT_CONTEXT}}';
      const g = await runGroundingCheck(cand, item.query, result.chunks.map((c: any) => ({ id: c.chunk_id, content: c.content ?? c.excerpt ?? '' })), creds.anthropicKey, 30_000);
      gMeasured++; if (g.verdict === 'pass') gPass++;
    }
  }
  const groundednessRate = gMeasured === 0 ? null : gPass / gMeasured;
  return buildConfigResult(config, 'live', { floor, fetchN, rrf_k: LIVE_DEFAULT_RRF_K, mmr_lambda: LIVE_DEFAULT_MMR_LAMBDA }, scored, groundednessRate, !creds.voyageKey || anyError, rerankedAll, baseline);
}

async function runMmrConfig(
  realRetrieve: any, applyMMR: any, runGroundingCheck: any, sb: any, creds: Creds,
  golden: GoldenSet, baseline: LoadedBaseline,
  config: string, mmrLambda: number, fetchN: number, floor: number,
): Promise<ConfigResult> {
  const scored: ScoredItem[] = [];
  let anyError = false; let rerankedAll = true;
  let gMeasured = 0; let gPass = 0;
  for (const item of golden.items) {
    if (!item.query) continue;
    const { pool, error } = await fetchRrfPool(realRetrieve, sb, creds, item as GoldenItem, fetchN, floor);
    if (error) anyError = true;
    // rerank top fetchN → limit (REAL Voyage rerank-2 — same as live). The
    // reranked chunks KEEP their original RRF similarity (mirrors retrieve.ts).
    const rr = await voyageRerank(item.query, pool.map((c) => c.content), RETRIEVE_LIMIT, creds.voyageKey);
    let ranked: CandRow[];
    if (rr.reranked) ranked = rr.rankedIndices.map((i) => pool[i]).filter(Boolean);
    else { ranked = pool.slice(0, RETRIEVE_LIMIT); if (pool.length >= RETRIEVE_LIMIT) rerankedAll = false; }
    // applyMMR(λ) — REAL module, mirrors retrieve.ts line 602 (only when reranked & >1).
    // Pass the ORIGINAL RRF similarity (not the rerank score), exactly as live does.
    if (rr.reranked && ranked.length > 1) {
      ranked = applyMMR(ranked, mmrLambda);
    }
    const rankedIds = ranked.map((c) => c.id);
    scored.push({ item: item as GoldenItem, ranked: rankedIds });
    if (creds.anthropicKey) {
      const cand = ranked.length > 0 ? ranked[0].content.slice(0, 400) : '{{INSUFFICIENT_CONTEXT}}';
      const g = await runGroundingCheck(cand, item.query, ranked.map((c) => ({ id: c.id, content: c.content })), creds.anthropicKey, 30_000);
      gMeasured++; if (g.verdict === 'pass') gPass++;
    }
  }
  const groundednessRate = gMeasured === 0 ? null : gPass / gMeasured;
  return buildConfigResult(config, 'replica', { rrf_k: LIVE_DEFAULT_RRF_K, mmr_lambda: mmrLambda, fetchN, floor }, scored, groundednessRate, !creds.voyageKey || anyError, rerankedAll, baseline);
}

// ─── Replica-vs-live validation (Jaccard of top-10 ranked id sets) ───────────

function topKJaccard(a: string[], b: string[], k: number): number {
  const sa = new Set(a.slice(0, k)); const sb = new Set(b.slice(0, k));
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0; for (const x of sa) if (sb.has(x)) inter++;
  return inter / (sa.size + sb.size - inter);
}

async function validateReplica(
  realRetrieve: any, applyMMR: any, sb: any, creds: Creds, golden: GoldenSet,
): Promise<void> {
  console.log('\n=== validate-replica: MMR replica @λ0.7 vs live @λ0.7 (top-10 ranked id Jaccard) ===');
  console.log('    (replica pool = real RPC RRF k=60 via retrieve(rerank:false); rerank+MMR applied locally)');
  let sum = 0; let n = 0; let perfect = 0;
  for (const item of golden.items) {
    if (!item.query) continue;
    const live = await realRetrieve({
      query: item.query, grade: item.grade, subject: item.subject,
      chapterNumber: item.chapter_number ?? null, limit: RETRIEVE_LIMIT,
      candidateCount: LIVE_DEFAULT_FETCHN, rerank: true, caller: HARNESS_CALLER,
      minSimilarity: LIVE_DEFAULT_FLOOR, supabase: sb, voyageApiKey: creds.voyageKey,
    });
    const liveIds = live.chunks.map((c: any) => c.chunk_id);
    // replica @ default λ=0.7 using the FAITHFUL RPC pool
    const { pool } = await fetchRrfPool(realRetrieve, sb, creds, item as GoldenItem, LIVE_DEFAULT_FETCHN, LIVE_DEFAULT_FLOOR);
    const rr = await voyageRerank(item.query, pool.map((c) => c.content), RETRIEVE_LIMIT, creds.voyageKey);
    let ranked = rr.reranked ? rr.rankedIndices.map((i) => pool[i]).filter(Boolean) : pool.slice(0, RETRIEVE_LIMIT);
    if (rr.reranked && ranked.length > 1) ranked = applyMMR(ranked, LIVE_DEFAULT_MMR_LAMBDA);
    const j = topKJaccard(liveIds, ranked.map((c) => c.id), 10);
    sum += j; n++; if (j >= 0.999) perfect++;
    console.log(`  ${item.id.padEnd(48)} top10 Jaccard=${j.toFixed(3)}`);
  }
  console.log(`  MEAN top-10 Jaccard (MMR replica vs live) = ${(sum / n).toFixed(3)} | perfect (=1.0): ${perfect}/${n}`);
  console.log('  Parity >= ~0.95 means the MMR-λ replica faithfully reproduces the live path; below that, treat MMR-λ deltas as directional only.');
}

// ─── Report ──────────────────────────────────────────────────────────────────

function printConfig(r: ConfigResult): void {
  const o = r.overall;
  const f = (v: number | null) => (v === null ? 'n/a' : v.toFixed(4));
  const jm = r.juniorMath;
  console.log(`\n[${r.lane}] ${r.config}  ${JSON.stringify(r.params)}`);
  console.log(`  overall: nDCG@10=${f(o['nDCG@10'])} recall@10=${f(o['recall@10'])} MRR=${f(o.MRR)} hit@10=${f(o['hit-rate@10'])} grounded=${f(o['groundedness-rate'])}`);
  if (jm) console.log(`  6-8/math: nDCG=${f(jm.ndcg)} recall=${f(jm.recall)} MRR=${f(jm.mrr)} hit=${f(jm.hit)} (n=${jm.count})`);
  console.log(`  VERDICT: ${r.verdict.verdict}${r.degraded ? ' [DEGRADED]' : ''}`);
}

async function main(): Promise<number> {
  const mode = (process.argv[2] ?? 'all').toLowerCase();
  const creds = readCreds();
  if (!creds) { console.log('[b2-sweep] no creds (need Supabase + VOYAGE_API_KEY). exit 2.'); return 2; }
  if (!creds.anthropicKey) console.log('[b2-sweep] NOTE: no ANTHROPIC_API_KEY — groundedness null → verdict INCONCLUSIVE for every config.');

  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(creds.url, creds.serviceKey, { auth: { persistSession: false } });
  const { retrieve: realRetrieve } = await loadRealRetrieve();
  const { runGroundingCheck } = await loadRealGroundingCheck();
  const { applyMMR } = await loadRealMMR();
  const golden = loadGolden();
  const baseline = loadBaseline();

  mkdirSync(OUT_DIR, { recursive: true });
  const results: ConfigResult[] = [];

  if (mode === 'validate-replica' || mode === 'all') {
    await validateReplica(realRetrieve, applyMMR, sb, creds, golden);
  }

  if (mode === 'floor' || mode === 'all') {
    console.log('\n##### FLOOR SWEEP (live lane; expect identical — quality_score is constant 0.7) #####');
    for (const floor of [0.3, 0.4, 0.5]) {
      const r = await runLiveConfig(realRetrieve, runGroundingCheck, sb, creds, golden, baseline, `floor=${floor}`, floor, LIVE_DEFAULT_FETCHN);
      results.push(r); printConfig(r);
    }
  }
  if (mode === 'fetchn' || mode === 'all') {
    console.log('\n##### FETCH-N SWEEP (live lane; candidateCount = 30 / 40 / 60) #####');
    for (const fetchN of [30, 40, 60]) {
      const r = await runLiveConfig(realRetrieve, runGroundingCheck, sb, creds, golden, baseline, `fetchN=${fetchN}`, LIVE_DEFAULT_FLOOR, fetchN);
      results.push(r); printConfig(r);
    }
  }
  if (mode === 'mmr' || mode === 'all') {
    console.log('\n##### MMR-λ SWEEP (faithful replica lane; λ = 0.5 / 0.7 / 0.85; pool = real RPC RRF k=60) #####');
    for (const lam of [0.5, 0.7, 0.85]) {
      const r = await runMmrConfig(realRetrieve, applyMMR, runGroundingCheck, sb, creds, golden, baseline, `mmr_lambda=${lam}`, lam, LIVE_DEFAULT_FETCHN, LIVE_DEFAULT_FLOOR);
      results.push(r); printConfig(r);
    }
  }
  if (mode === 'rrfk' || mode === 'all') {
    console.log('\n##### RRF-k SWEEP: NOT MEASURED #####');
    console.log('  RRF k=60 is a SQL CONSTANT (v_k) inside match_rag_chunks_ncert and the RPC fuses the two');
    console.log('  arms BEFORE the match_count cut. No parameterized measurement RPC exists and supabase-js');
    console.log('  cannot express ORDER BY embedding <=> q to re-derive the raw vector arm, so a faithful');
    console.log('  RRF-k replica is not possible read-only. A two-RPC approximation scored only 0.505 top-10');
    console.log('  Jaccard vs live and was rejected as untrustworthy. To tune RRF-k rigorously, add a');
    console.log('  parameterized measurement RPC (match_rag_chunks_ncert_param with p_rrf_k) — DDL, gated.');
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = resolve(OUT_DIR, `b2-sweep-${mode}-${stamp}.json`);
  writeFileSync(outPath, JSON.stringify({ mode, generated_at: new Date().toISOString(), baseline: baseline.config.metrics, results }, null, 2) + '\n', 'utf-8');
  console.log(`\n[b2-sweep] wrote ${outPath}`);
  return 0;
}

if (require.main === module) {
  main().then((c) => process.exit(c)).catch((e) => { console.error('[b2-sweep] error:', e instanceof Error ? e.stack : String(e)); process.exit(2); });
}

export { main };
