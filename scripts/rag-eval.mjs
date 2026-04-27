#!/usr/bin/env node
/**
 * scripts/rag-eval.mjs — RAG evaluation CLI entry point.
 *
 * Loads gold-query fixtures from eval/rag/fixtures/, invokes the deployed
 * grounded-answer Edge Function for each query, scores the responses, and
 * writes a JSON report to eval/rag/reports/<ISO-timestamp>.json.
 *
 * Usage:
 *   node scripts/rag-eval.mjs                  # default threshold 0.80
 *   RAG_EVAL_THRESHOLD=0.95 node scripts/rag-eval.mjs   # tighten gate
 *
 * Required env (read from process.env; .env.local auto-loaded if dotenv is present):
 *   SUPABASE_URL                      # e.g. https://abc.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY         # service-role JWT (eval intentionally bypasses RLS)
 *
 * Exit codes:
 *   0 — pass-rate >= threshold
 *   1 — pass-rate <  threshold (regression detected)
 *   2 — configuration error (env vars missing, fixtures unreadable)
 *
 * Notes:
 *   - This is a JS entry that uses tsx/esbuild via dynamic import of the
 *     TypeScript modules. We avoid that hassle by *also* compiling the TS
 *     to JS at build time would be too much; instead we use Node 22's
 *     experimental TypeScript support (--experimental-strip-types) when
 *     available, and fall back to a clear error message if not. CI runs
 *     Node 20 by default — see .github/workflows/rag-eval.yml for the
 *     wrapper that uses tsx.
 *
 *   - The runner file (eval/rag/runner.ts) is plain TS with no Next.js or
 *     Deno imports, so any TS runtime works.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env.local if dotenv is installed. Best-effort — not a hard requirement.
try {
  await import('dotenv/config');
} catch {
  // dotenv not installed; rely on process.env / shell exports.
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const FIXTURES_DIR = join(REPO_ROOT, 'eval', 'rag', 'fixtures');
const REPORTS_DIR = join(REPO_ROOT, 'eval', 'rag', 'reports');

const threshold = Number.parseFloat(process.env.RAG_EVAL_THRESHOLD ?? '0.80');
if (Number.isNaN(threshold) || threshold < 0 || threshold > 1) {
  console.error(`Invalid RAG_EVAL_THRESHOLD: ${process.env.RAG_EVAL_THRESHOLD}. Must be between 0 and 1.`);
  process.exit(2);
}

// Dynamic import of the TS modules. Node 22.6+ supports
// --experimental-strip-types natively. For older Node we hint to use tsx.
let runner;
let scoring;
try {
  runner = await import('../eval/rag/runner.ts');
  scoring = await import('../eval/rag/scoring.ts');
} catch (err) {
  console.error('Failed to load eval modules. If on Node < 22.6, run via tsx:');
  console.error('  npx tsx scripts/rag-eval.mjs');
  console.error('Underlying error:', err instanceof Error ? err.message : String(err));
  process.exit(2);
}

let config;
try {
  config = runner.loadRunnerConfig(FIXTURES_DIR);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
}

const startedAt = new Date().toISOString();
console.log(`[rag-eval] starting run at ${startedAt}`);
console.log(`[rag-eval] threshold = ${threshold}`);
console.log(`[rag-eval] fixtures  = ${FIXTURES_DIR}`);
console.log(`[rag-eval] target    = ${config.supabaseUrl}/functions/v1/grounded-answer`);

const queries = await runner.loadGoldQueries(FIXTURES_DIR);
console.log(`[rag-eval] loaded ${queries.length} gold queries`);

const queryById = new Map(queries.map((q) => [q.id, q]));

const results = await runner.runEval(config, queries);
const finishedAt = new Date().toISOString();

const scored = results.map((r) => {
  const q = queryById.get(r.query_id);
  if (!q) {
    // Should never happen — runner emits a Result for every input query.
    return {
      query_id: r.query_id,
      scope_correct: false,
      citation_correct: null,
      citation_count: 0,
      forbidden_phrase_present: false,
      abstain_phrase_present: false,
      overall_pass: false,
      fail_reason: 'unknown_query_id',
    };
  }
  return scoring.scoreResult(q, r);
});

const report = scoring.aggregateReport(scored, results, startedAt, finishedAt);

// ─── Persist report ─────────────────────────────────────────────────────
await mkdir(REPORTS_DIR, { recursive: true });
const safeStamp = startedAt.replace(/:/g, '-');
const reportPath = join(REPORTS_DIR, `${safeStamp}.json`);
await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');
console.log(`[rag-eval] report written: ${reportPath}`);

// ─── Summary table ──────────────────────────────────────────────────────
console.log('');
console.log('─── RAG eval summary ───');
console.log(`Total queries  : ${report.total}`);
console.log(`Passed         : ${report.passed}`);
console.log(`Failed         : ${report.failed}`);
console.log(`Pass rate      : ${(report.pass_rate * 100).toFixed(1)}%`);
console.log(`In-scope       : ${report.in_scope.passed}/${report.in_scope.total} (${(report.in_scope.pass_rate * 100).toFixed(1)}%)`);
console.log(`Out-of-scope   : ${report.out_of_scope.passed}/${report.out_of_scope.total} (${(report.out_of_scope.pass_rate * 100).toFixed(1)}%)`);
console.log(`Mean latency   : ${report.mean_latency_ms} ms`);
console.log(`P95 latency    : ${report.p95_latency_ms} ms`);

const failures = scored.filter((s) => !s.overall_pass);
if (failures.length > 0) {
  console.log('');
  console.log('─── Failures ───');
  for (const f of failures) {
    console.log(`- ${f.query_id}: ${f.fail_reason ?? 'unknown'}`);
  }
}

if (report.pass_rate >= threshold) {
  console.log('');
  console.log(`[rag-eval] PASS — pass_rate ${(report.pass_rate * 100).toFixed(1)}% >= threshold ${(threshold * 100).toFixed(1)}%`);
  process.exit(0);
} else {
  console.log('');
  console.log(`[rag-eval] FAIL — pass_rate ${(report.pass_rate * 100).toFixed(1)}% < threshold ${(threshold * 100).toFixed(1)}%`);
  process.exit(1);
}
