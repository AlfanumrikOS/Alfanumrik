// eval/rag/harness/cli.ts
//
// B1 retrieval-quality eval harness — Task 10: the STANDALONE CLI entrypoint.
//
// ── Single responsibility ────────────────────────────────────────────────────
// The runner (`run-eval.ts`) is a PURE assembler that takes INJECTED deps
// (`retrieve`, `groundingCheck`, `golden`, `baseline`, `voyageKeyPresent`). It
// has NO standalone way to be invoked with REAL deps — the only place the real
// modules get wired is the live-DB integration test. This file is the operator
// entrypoint that constructs the SAME real deps the integration test wires, runs
// the harness once, writes the report artifact (B5), prints the verdict + a
// per-metric summary, and ALWAYS exits 0.
//
//   build service-role client (makeServiceSupabase) — read creds from env
//     → dynamic-import the REAL retrieve()    (supabase/functions/_shared/rag/retrieve.ts)
//     → dynamic-import the REAL runGroundingCheck (supabase/functions/grounded-answer/grounding-check.ts)
//     → load golden (resolved ncert-golden-v1.json if present, else error)
//     → load baseline (ncert-baseline-v1.json — placeholder until Task 10 populates)
//     → voyageKeyPresent ← process.env.VOYAGE_API_KEY
//     → runEval() → writeReport() → print verdict (PASS|REGRESS|INCONCLUSIVE)
//
// ── Exit-code policy (DOCUMENTED CHOICE) ─────────────────────────────────────
// This is a MEASUREMENT tool, not a pass/fail CI gate. It exits 0 on EVERY
// machine verdict — PASS, REGRESS, and INCONCLUSIVE alike — so a wrapping job's
// exit code is NOT the signal B2 reads. B2's tuning gate reads the VERDICT field
// of the written report artifact (B5), not this process's exit status. The CLI
// reserves a NON-zero exit ONLY for an OPERATOR ERROR that prevented a run from
// happening at all:
//   exit 2  — config/operator error: no creds, no golden set, malformed
//             baseline. (A run that COMPLETES is always exit 0, whatever the
//             verdict — including INCONCLUSIVE for a degraded/placeholder run.)
// Smoke-running WITHOUT creds is therefore a clean exit 2 with a clear message —
// it never crashes and never needs a live DB.
//
// ── AI-boundary lint ─────────────────────────────────────────────────────────
// Like the integration test, this CLI NEVER statically imports an AI SDK
// (@anthropic-ai / voyageai), never references an api.*.com URL, and never calls
// `.rpc('match_rag_chunks*')` directly. It DYNAMIC-imports the two allowlisted
// internal modules (retrieve.ts under _shared/**, grounding-check.ts under
// grounded-answer/**) and adapts them to the runner's injected shapes — so it is
// clean against all three AI-boundary rules.
//
// Offline tooling: NEVER imported by production / client code (enforced by the
// import-boundary test). Run via `npm run eval:rag:harness`.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadDotenv } from '../../../agents/runtime/env';
import {
  runEval,
  writeReport,
  type InjectedRetrieve,
  type InjectedGroundingCheck,
  type InjectedRetrievedChunk,
  type RunEvalDeps,
} from './run-eval';
import { loadBaselineFile, type LoadedBaseline } from './baseline';
import { validateGoldenSet, type GoldenSet } from './golden-schema';
import { PRIMARY_METRICS } from './verdict';

// Self-load .env.local so an operator who has run `vercel env pull .env.local`
// gets VOYAGE_API_KEY / SUPABASE_* without re-exporting them. Ambient env wins
// (loadDotenv does not overwrite already-set vars).
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
loadDotenv(REPO_ROOT);

const GOLDEN_PATH = resolve(REPO_ROOT, 'eval', 'rag', 'golden', 'ncert-golden-v1.json');
const BASELINE_PATH = resolve(REPO_ROOT, 'eval', 'rag', 'baseline', 'ncert-baseline-v1.json');

/** Operator-facing exit codes. A COMPLETED run is always 0 (see header). */
const EXIT_OK = 0;
const EXIT_CONFIG_ERROR = 2;

// The real Edge Function modules are excluded from the project tsconfig and
// import `.ts`-extension Deno paths; type the dynamic imports as `any` so tsc
// does not trace into them (the same convention as the integration test). The
// contract is exercised at runtime.
/* eslint-disable @typescript-eslint/no-explicit-any */
async function loadRealRetrieve(): Promise<any> {
  return import('../../../supabase/functions/_shared/rag/retrieve');
}
async function loadRealGroundingCheck(): Promise<any> {
  return import('../../../supabase/functions/grounded-answer/grounding-check');
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Read creds from env; return null (not throw) so the caller can exit 2 cleanly. */
function readCreds(): { url: string; serviceKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  // Reject the well-known CI placeholder strings — a placeholder URL would
  // ENOTFOUND at retrieve() time; better to fail fast as a config error.
  if (/placeholder/i.test(url) || /placeholder/i.test(serviceKey)) return null;
  return { url, serviceKey };
}

/** Load the resolved golden set; throws (operator error) if absent or invalid. */
function loadGolden(): GoldenSet {
  if (!existsSync(GOLDEN_PATH)) {
    throw new Error(
      `golden set not found at ${GOLDEN_PATH}. The resolved ncert-golden-v1.json ` +
        'is produced by the Task 10 binding procedure (resolve seed-queries.json ' +
        'against the live ncert_2025 corpus). See ' +
        'docs/runbooks/2026-06-14-rag-eval-harness-operation.md.',
    );
  }
  const doc = JSON.parse(readFileSync(GOLDEN_PATH, 'utf-8')) as unknown;
  const v = validateGoldenSet(doc);
  if (!v.ok) throw new Error(`golden set failed validation:\n${v.errors.join('\n')}`);
  return v.value;
}

function loadBaseline(): LoadedBaseline {
  if (!existsSync(BASELINE_PATH)) {
    throw new Error(
      `baseline not found at ${BASELINE_PATH}. The band STRUCTURE ships in Task 7; ` +
        'the metric VALUES are populated by a reviewed full-path run (Task 10).',
    );
  }
  return loadBaselineFile(BASELINE_PATH);
}

/** Format a 0..1 metric to 4 sig figs (spec §B1.7), or `n/a` when null. */
function fmt(v: number | null): string {
  return v === null ? 'n/a' : v.toFixed(4);
}

/**
 * Build the injected deps from the REAL retrieve() + runGroundingCheck against a
 * live service-role client — mirrors run-eval.integration.test.ts buildDeps().
 */
async function buildDeps(creds: { url: string; serviceKey: string }): Promise<RunEvalDeps> {
  // createClient lives in @supabase/supabase-js — a normal dep, NOT an AI SDK,
  // so a static-ish dynamic import here does not touch the AI-boundary surface.
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(creds.url, creds.serviceKey, {
    auth: { persistSession: false },
  });

  const { retrieve: realRetrieve } = await loadRealRetrieve();
  const { runGroundingCheck } = await loadRealGroundingCheck();

  const voyageKey = process.env.VOYAGE_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY ?? '';
  const voyageKeyPresent = typeof voyageKey === 'string' && voyageKey.length > 0;

  // Adapt the REAL retrieve() to the runner's injected shape. We intentionally
  // leave `candidateCount` unset on the result (the real RetrievalResult does
  // not expose the pre-cap pool size) so the runner uses its conservative proxy
  // for the S5.1 silent-rerank-degradation signal (see run-eval.ts).
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
    return {
      chunks: (result.chunks ?? []).map(
        (c: { chunk_id: string; content?: string; excerpt?: string; similarity?: number }) => ({
          chunk_id: c.chunk_id,
          content: c.content ?? c.excerpt ?? '',
          similarity: c.similarity,
        }),
      ),
      reranked: result.reranked === true,
      error: result.error ?? null,
    };
  };

  // Adapt the REAL runGroundingCheck. KNOWN LIMITATION (assessment S5.3): the
  // candidate answer is a thin proxy — the top chunk's text, NOT a real
  // generated answer. This skews groundedness HIGH and must not be over-read
  // until a real answer-grounding step lands. Conservative-fail when no
  // Anthropic key (runGroundingCheck returns verdict='fail').
  const groundingCheck: InjectedGroundingCheck = async ({ query, chunks }) => {
    const candidateAnswer =
      chunks.length > 0 ? chunks[0].content.slice(0, 400) : '{{INSUFFICIENT_CONTEXT}}';
    const g = await runGroundingCheck(
      candidateAnswer,
      query,
      chunks.map((c: InjectedRetrievedChunk) => ({ id: c.chunk_id, content: c.content })),
      anthropicKey,
    );
    return { verdict: g.verdict };
  };

  return {
    golden: loadGolden(),
    baseline: loadBaseline(),
    retrieve,
    groundingCheck,
    voyageKeyPresent,
    // Groundedness requires an Anthropic key; skip it when absent so the run
    // still completes (groundedness-rate → null → INCONCLUSIVE via the verdict).
    runGroundedness: anthropicKey.length > 0,
  };
}

async function main(): Promise<number> {
  // eslint-disable-next-line no-console
  const log = console.log.bind(console);

  const creds = readCreds();
  if (!creds) {
    log('[rag-eval:harness] INCONCLUSIVE (no run) — Supabase creds absent.');
    log(
      '  Set NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY ' +
        '(and VOYAGE_API_KEY for the full embeddings+rerank path; without it the run ' +
        'is FTS-only → INCONCLUSIVE by design).',
    );
    log('  This is the expected smoke-test message when run without creds — not a crash.');
    return EXIT_CONFIG_ERROR;
  }

  let deps: RunEvalDeps;
  try {
    deps = await buildDeps(creds);
  } catch (err) {
    log(`[rag-eval:harness] config error: ${err instanceof Error ? err.message : String(err)}`);
    return EXIT_CONFIG_ERROR;
  }

  if (!deps.voyageKeyPresent) {
    log(
      '[rag-eval:harness] NOTE: VOYAGE_API_KEY absent — retrieval degrades to FTS-only. ' +
        'The verdict will be INCONCLUSIVE (a degraded run cannot gate a tuning decision).',
    );
  }
  if (deps.baseline.metricsPlaceholder) {
    log(
      '[rag-eval:harness] NOTE: baseline is a PLACEHOLDER (metrics_placeholder=true) — the ' +
        'verdict is forced INCONCLUSIVE until a reviewed full-path baseline is populated.',
    );
  }

  const report = await runEval(deps);
  const reportPath = writeReport(report);

  // ── Verdict + per-metric summary ────────────────────────────────────────────
  log('');
  log('─── RAG eval-harness (B1) summary ───');
  log(`golden_version : ${report.run.golden_version}`);
  log(`corpus_source  : ${report.run.corpus_source}`);
  log(`full_path      : ${report.run.full_path} (degraded=${report.degraded})`);
  log(`groundedness   : ${report.run.groundedness_run ? 'run' : 'skipped (no ANTHROPIC_API_KEY)'}`);
  log(`baseline       : ${report.run.baseline_placeholder ? 'PLACEHOLDER' : 'populated'}`);
  log('');
  log(`VERDICT        : ${report.verdict.verdict}`);
  log('');
  log('Per-metric (current vs baseline):');
  for (const metric of PRIMARY_METRICS) {
    const pm = report.verdict.perMetric.find((p) => p.metric === metric);
    const current = report.metrics.primary[metric];
    const baseline = pm?.baseline ?? null;
    const flag = pm?.regressed ? ' REGRESS' : pm?.inconclusive ? ' (unmeasurable)' : '';
    log(`  ${metric.padEnd(18)} current=${fmt(current).padEnd(8)} baseline=${fmt(baseline).padEnd(8)}${flag}`);
  }
  if (report.metrics.multiHopCoverageAt10 !== null) {
    log(`  ${'multi_hop@10'.padEnd(18)} ${fmt(report.metrics.multiHopCoverageAt10)} (reported, not a gate metric)`);
  }
  if (report.metrics.unmeasurable.length > 0) {
    log(`  unmeasurable items (no query — never scored): ${report.metrics.unmeasurable.length}`);
  }
  if (report.verdict.reasons.length > 0) {
    log('');
    log('Reasons:');
    for (const r of report.verdict.reasons) log(`  - ${r}`);
  }
  log('');
  log(`report written : ${reportPath}`);
  log(
    '[rag-eval:harness] exit 0 — this is a measurement tool. B2 reads the VERDICT in the ' +
      'report artifact, NOT this exit code (REGRESS/INCONCLUSIVE are not process failures).',
  );

  return EXIT_OK;
}

// Guard so the module is import-safe (the import-boundary test imports it). Only
// run when invoked as a script (npm run eval:rag:harness → npx tsx cli.ts).
if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`[rag-eval:harness] unexpected error: ${err instanceof Error ? err.stack : String(err)}`);
      // An unexpected throw is an operator/config-class failure, not a verdict.
      process.exit(EXIT_CONFIG_ERROR);
    });
}

export { main };
