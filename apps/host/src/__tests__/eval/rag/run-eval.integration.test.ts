// src/__tests__/eval/rag/run-eval.integration.test.ts
//
// B1 retrieval-quality eval harness — Task 5: the LIVE-DB harness entry
// (INTEGRATION lane). Runs the (small) golden set through the REAL retrieve()
// (+ match_rag_chunks_ncert RRF RPC) over a populated live DB, scores it,
// compares to the committed baseline, and writes B1's OWN report artifact.
//
// ── LANE / NAMING (critical) ─────────────────────────────────────────────────
// The `.integration.test.ts` suffix is deliberate: Task 8 adds a NARROW
// integration-lane glob that matches ONLY `src/__tests__/eval/**/*.integration.test.ts`,
// so the PURE tests (`*.test.ts`, e.g. run-eval.test.ts) STAY in the normal
// `npm test` lane and this file rides the `RUN_INTEGRATION_TESTS=1` live-DB lane.
//
// ── SKIP-GUARD (B4 — reuse, do NOT reinvent) ─────────────────────────────────
// Gated by the EXISTING `hasSupabaseIntegrationEnv()` so the describe block
// evaluates to `describe.skip` cleanly when no live-DB creds / placeholder env
// are present. It WILL skip locally + on a no-secret PR — that is EXPECTED and
// keeps PR CI green. The client is the EXISTING `makeServiceSupabase()`.
//
// ── B6 (architect, SHOULD) — admin-scoped client option ──────────────────────
// We default to the EXISTING `makeServiceSupabase()` (service-role) for PARITY
// with every other live-DB integration test in this repo. NOTE (least-privilege
// follow-up): RLS already permits these reads to an authenticated/admin client —
// `rag_content_chunks` is the NCERT corpus (not student data) and
// `match_rag_chunks_ncert` is `GRANT EXECUTE ... TO authenticated`. A future
// least-privilege pass could swap the corpus read to an anon/authenticated
// client and reserve service-role only for the (student-adjacent) trace-table
// rollups; the service-role posture here is the documented offline-batch-script
// use case (read-only, zero writes).
//
// ── DEGRADED → INCONCLUSIVE ──────────────────────────────────────────────────
// When VOYAGE_API_KEY is absent the real retrieve() degrades to FTS-only; the
// runner sets degraded=true → the verdict is INCONCLUSIVE (never PASS/REGRESS).

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

import { hasSupabaseIntegrationEnv } from '../../helpers/integration';
import { makeServiceSupabase } from '../../migrations/_helpers/supabase-runtime';
import {
  runEval,
  writeReport,
  type InjectedRetrieve,
  type InjectedGroundingCheck,
  type RunEvalDeps,
} from '../../../../eval/rag/harness/run-eval';
import {
  loadBaselineConfig,
  loadBaselineFile,
  type LoadedBaseline,
} from '../../../../eval/rag/harness/baseline';
import {
  validateGoldenSet,
  type GoldenSet,
} from '../../../../eval/rag/harness/golden-schema';
import type { Verdict } from '../../../../eval/rag/harness/verdict';

/** The three machine-verdict values (spec §B1.5). */
const VERDICT_VALUES: readonly Verdict[] = ['PASS', 'REGRESS', 'INCONCLUSIVE'];

// The real Edge Function modules are excluded from the project tsconfig and
// import `.ts`-extension Deno paths; type the dynamic imports as `any` so tsc
// does not trace into them (the same convention as rag-retrieve.test.ts). The
// contract is exercised at runtime.
/* eslint-disable @typescript-eslint/no-explicit-any */
async function loadRealRetrieve(): Promise<any> {
  return await import('../../../../supabase/functions/_shared/rag/retrieve');
}
async function loadRealGroundingCheck(): Promise<any> {
  return await import('../../../../supabase/functions/grounded-answer/grounding-check');
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const ROOT = resolve(__dirname, '..', '..', '..', '..');
const GOLDEN_PATH = resolve(ROOT, 'eval', 'rag', 'golden', 'ncert-golden-v1.json');
const BASELINE_PATH = resolve(ROOT, 'eval', 'rag', 'baseline', 'ncert-baseline-v1.json');

/**
 * Derive the CONNECTED Supabase project ref from the SAME env var the
 * integration client (`makeServiceSupabase()`) reads — `NEXT_PUBLIC_SUPABASE_URL`
 * (falling back to `SUPABASE_URL`, mirroring the helper's own `?? ` fallback in
 * `src/__tests__/migrations/_helpers/supabase-runtime.ts`). Parses the
 * `<ref>.supabase.co` host. Returns `null` when no host-shaped URL is present
 * (e.g. a self-hosted / non-standard URL) — the caller then preserves the old
 * resolve behavior rather than skipping on an undeterminable ref.
 *
 * PURE (no I/O, no client) so the run-vs-skip decision is unit-assertable.
 */
function connectedProjectRef(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
  const m = url.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i);
  return m ? m[1] : null;
}

/**
 * Decide whether the corpus-parity resolve assertion should RUN against the
 * connected DB, or SKIP because the golden set is bound to a DIFFERENT, DECLARED
 * project than CI connected to. Pure + total so the skip path is deterministically
 * testable without a live DB.
 *
 * Rules (Option-1 prod binding):
 *   - boundRef present AND connectedRef present AND they DIFFER  → skip ('corpus-mismatch')
 *   - otherwise (match, OR no boundRef, OR undeterminable connectedRef) → run
 *     (preserves the old fail-loud-on-unresolved behavior for same-corpus sets).
 */
export function corpusParityDecision(
  boundRef: string | null | undefined,
  connectedRef: string | null,
): { action: 'run' | 'skip'; reason: 'same-corpus' | 'no-bound-ref' | 'undeterminable-connected' | 'corpus-mismatch' } {
  if (!boundRef) return { action: 'run', reason: 'no-bound-ref' };
  if (!connectedRef) return { action: 'run', reason: 'undeterminable-connected' };
  if (boundRef === connectedRef) return { action: 'run', reason: 'same-corpus' };
  return { action: 'skip', reason: 'corpus-mismatch' };
}

/**
 * Load the committed golden set if it has been seeded (Task 9). Until then,
 * fall back to a minimal 1-item inline golden set so the live-DB wiring is
 * exercisable. The runner re-validates either way; the corpus-parity check below
 * is meaningful only against the seeded set (the inline chunk-id will NOT
 * resolve, so we skip the resolve assertion when the seeded file is absent).
 */
function loadGolden(): { golden: GoldenSet; seeded: boolean } {
  if (existsSync(GOLDEN_PATH)) {
    const doc = JSON.parse(readFileSync(GOLDEN_PATH, 'utf-8')) as unknown;
    const v = validateGoldenSet(doc);
    if (!v.ok) throw new Error(`seeded golden set is invalid:\n${v.errors.join('\n')}`);
    return { golden: v.value, seeded: true };
  }
  // Minimal placeholder golden set (pre-Task-9). chunk_id is a valid-shaped UUID
  // that will NOT resolve against the live corpus — fine for the wiring smoke
  // test; the corpus-parity resolve assertion is gated on `seeded`.
  const golden: GoldenSet = {
    version: 'pre-seed-smoke',
    created_at: '2026-06-13',
    corpus_ref: { source: 'ncert_2025', snapshot_note: 'pre-seed smoke (Task 9 not yet seeded)' },
    judge: { model: 'claude-sonnet-4-20250514', rubric_version: 'rag-relevance-v1', temperature: 0 },
    items: [
      {
        id: 'smoke-g8-sci-001',
        tier: 'seed',
        query: 'What is photosynthesis?',
        query_type: 'definition',
        grade: '8',
        subject: 'science',
        chapter_number: null,
        relevant_chunks: [
          {
            chunk_id: '00000000-0000-4000-8000-000000000001',
            relevance: 2,
            off_grade_scope: false,
            label_source: 'assessment',
          },
        ],
        provenance: null,
      },
    ],
  };
  return { golden, seeded: false };
}

function loadBaseline(): LoadedBaseline {
  if (existsSync(BASELINE_PATH)) return loadBaselineFile(BASELINE_PATH);
  // Fallback (should always exist — Task 7 shipped it): a placeholder baseline.
  return loadBaselineConfig({ version: 'fallback', metrics: {}, bands: {}, metrics_placeholder: true });
}

const describeIntegration = hasSupabaseIntegrationEnv() ? describe : describe.skip;

describeIntegration('run-eval LIVE-DB harness (Task 5, integration lane)', () => {
  // Build the injected deps from the REAL retrieve() + runGroundingCheck against
  // the live service-role client. Constructed lazily inside the tests so the
  // skip path never touches the client.
  async function buildDeps(): Promise<{ deps: RunEvalDeps; seeded: boolean }> {
    const supabase = makeServiceSupabase();
    const { retrieve: realRetrieve } = await loadRealRetrieve();
    const { runGroundingCheck } = await loadRealGroundingCheck();

    const voyageKey = process.env.VOYAGE_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY ?? '';
    const voyageKeyPresent = typeof voyageKey === 'string' && voyageKey.length > 0;

    // Adapt the REAL retrieve() (RetrieveOptions / RetrievalResult) to the
    // runner's injected shape. The real module reads VOYAGE_API_KEY off Deno.env
    // / process.env; we pass the injected client and let it degrade to FTS-only
    // when the key is absent.
    const retrieve: InjectedRetrieve = async (opts) => {
      const result = await realRetrieve({
        query: opts.query,
        grade: opts.grade,
        subject: opts.subject,
        chapterNumber: opts.chapterNumber,
        limit: opts.limit,
        candidateCount: opts.candidateCount,
        rerank: opts.rerank,
        caller: opts.caller,
        supabase,
        voyageApiKey: voyageKey,
      });
      // NOTE (S5.1): the real RetrievalResult does NOT expose the pre-cap
      // candidate-pool size, so we intentionally leave `candidateCount` unset.
      // The runner then uses its conservative proxy (`chunks.length >= limit`) to
      // decide whether rerank was expected; when rerank genuinely ran the
      // `reranked === true` flag short-circuits the silent-degradation check, so
      // there is no false trigger on a real full-path run.
      return {
        chunks: (result.chunks ?? []).map((c: { chunk_id: string; content?: string; excerpt?: string; similarity?: number }) => ({
          chunk_id: c.chunk_id,
          content: c.content ?? c.excerpt ?? '',
          similarity: c.similarity,
        })),
        reranked: result.reranked === true,
        error: result.error ?? null,
      };
    };

    // Adapt the REAL runGroundingCheck to the runner's injected shape. We
    // generate a trivial candidate answer from the served chunks (the metric is
    // "do the retrieved chunks support a grounded answer"). Conservative-fail
    // when no Anthropic key (runGroundingCheck returns verdict='fail').
    const groundingCheck: InjectedGroundingCheck = async ({ query, chunks }) => {
      const candidateAnswer = chunks.length > 0 ? chunks[0].content.slice(0, 400) : '{{INSUFFICIENT_CONTEXT}}';
      const g = await runGroundingCheck(
        candidateAnswer,
        query,
        chunks.map((c) => ({ id: c.chunk_id, content: c.content })),
        anthropicKey,
      );
      return { verdict: g.verdict };
    };

    const { golden, seeded } = loadGolden();
    const baseline = loadBaseline();

    return {
      deps: {
        golden,
        baseline,
        retrieve,
        groundingCheck,
        voyageKeyPresent,
        // Groundedness requires an Anthropic key; skip it when absent so the run
        // still completes (groundedness-rate → null → INCONCLUSIVE via verdict).
        runGroundedness: anthropicKey.length > 0,
      },
      seeded,
    };
  }

  it('emits a verdict that is one of the three machine values', async () => {
    const { deps } = await buildDeps();
    const report = await runEval(deps);
    expect(VERDICT_VALUES).toContain(report.verdict.verdict);
  });

  it('a degraded run (no VOYAGE_API_KEY) yields INCONCLUSIVE — never PASS/REGRESS', async () => {
    const { deps } = await buildDeps();
    if (deps.voyageKeyPresent) {
      // Full-path environment — assert the inverse can hold: force a degraded
      // run by flipping the flag, and prove the gate.
      const degradedReport = await runEval({ ...deps, voyageKeyPresent: false });
      expect(degradedReport.degraded).toBe(true);
      expect(degradedReport.verdict.verdict).toBe('INCONCLUSIVE');
    } else {
      const report = await runEval(deps);
      expect(report.degraded).toBe(true);
      expect(report.verdict.verdict).toBe('INCONCLUSIVE');
    }
  });

  it('writes the report artifact with the A4 per-cell breakdown', async () => {
    const { deps } = await buildDeps();
    const report = await runEval(deps);
    const path = writeReport(report);
    expect(existsSync(path)).toBe(true);
    // A4 cells present for every primary band metric (may be empty for
    // groundedness — that one is reported as an overall rate only).
    expect(report.metrics.cells['recall@10']).toBeDefined();
    expect(report.metrics.cells['nDCG@10']).toBeDefined();
    expect(Array.isArray(report.metrics.cells['recall@10'])).toBe(true);
  });

  it('corpus-parity: every seeded relevant_chunk_id resolves to an active rag_content_chunks.id', async () => {
    const { deps, seeded } = await buildDeps();
    if (!seeded) {
      // Pre-Task-9: the seeded golden file is not yet committed. The resolve
      // check is meaningless against the inline smoke fixture. Skip loudly so
      // the gap is visible (this becomes a hard check once Task 9 seeds).
      // eslint-disable-next-line no-console
      console.warn(
        'corpus-parity: ncert-golden-v1.json not yet seeded (Task 9) — skipping the chunk-id resolve check.',
      );
      return;
    }

    // ── CORPUS-AWARENESS (Option-1 prod binding) ────────────────────────────
    // The golden set is bound to PROD chunk UUIDs (corpus_ref.project_ref =
    // shktyoxqhundlvkiwguu). CI's live-DB lane connects to STAGING — prod UUIDs
    // do NOT resolve there. That is NOT a regression: parity is a property of
    // the golden set vs the BOUND corpus, not vs whatever corpus CI happens to
    // read. So we fail LOUDLY only when the connected DB IS the bound corpus,
    // and SKIP LOUDLY when CI reads a DIFFERENT, DECLARED corpus. Parity is then
    // enforced wherever the harness runs against the bound corpus — locally with
    // prod creds, or the operator / scheduled prod-targeted run. (A golden set
    // with no project_ref keeps the old same-corpus fail-loud behavior.)
    const boundRef = deps.golden.corpus_ref.project_ref;
    const connectedRef = connectedProjectRef();
    const decision = corpusParityDecision(boundRef, connectedRef);
    if (decision.action === 'skip') {
      // eslint-disable-next-line no-console
      console.warn(
        `corpus-parity: golden set bound to project ${boundRef}; CI connected to ${connectedRef}; ` +
          'skipping chunk-id resolve — run against the bound corpus to validate.',
      );
      return;
    }

    const supabase = makeServiceSupabase();
    const ids = new Set<string>();
    for (const item of deps.golden.items) {
      for (const c of item.relevant_chunks) ids.add(c.chunk_id);
    }
    const idList = [...ids];

    const { data, error } = await supabase
      .from('rag_content_chunks')
      .select('id')
      .in('id', idList)
      .eq('is_active', true)
      .eq('source', 'ncert_2025');

    expect(error).toBeNull();
    const resolved = new Set((data ?? []).map((r: { id: string }) => r.id));
    const unresolved = idList.filter((id) => !resolved.has(id));
    // Fail LOUDLY (Q1 corpus-parity) on any unresolved chunk-id — a mismatch
    // means the golden set was authored against a different corpus than CI reads.
    expect(unresolved).toEqual([]);
  });
});
