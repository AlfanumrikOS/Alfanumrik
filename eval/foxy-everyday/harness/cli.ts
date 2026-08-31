// eval/foxy-everyday/harness/cli.ts
//
// Everyday-example rubric — the STANDALONE operator entrypoint.
// House pattern: eval/rag/harness/cli.ts + eval/teacher-skills/harness/cli.ts.
//
//   parse args (dry-run DEFAULT ON)
//     → load + validate the case set
//     → load + validate the treatment capture (flag ON) and, if given, the
//       control capture (flag OFF)
//     → load the baseline
//     → --dry-run: print the plan + the exact judge-call count and STOP.
//                  Costs nothing. Verdict is INCONCLUSIVE, always.
//     → --execute: wire the judge transport (callClaude from @alfanumrik/lib/ai,
//                  pinned to the already-registered Sonnet id) and run
//     → writeReport() → print verdict + per-arm summary
//
// ── SPEND GUARDS (mirroring .github/workflows/rag-cosine-replay.yml) ─────────
//   1. DRY RUN IS THE DEFAULT. `--execute` is required to spend a single token,
//      and the flag is spelled out, not a bare boolean.
//   2. `--limit` is bounded (1..MAX_CASES_PER_ARM = 54) with no unlimited value.
//      Spend is bounded by case count before any API call is made.
//   3. Missing ANTHROPIC_API_KEY under `--execute` FAILS LOUDLY (exit 2) before
//      anything runs. A judge run that quietly does nothing is the vacuously-
//      green failure mode this guards against.
//   4. The judge is invoked only for responses that already contain an example
//      block, so the printed dry-run number is the exact upper bound on spend.
//   5. No corpus write, no re-embedding, no Voyage call, no vision model, no new
//      service, no deploy. This process reads local JSON and writes one report.
//
// ── EXIT-CODE POLICY (documented choice, same as the B1 CLI) ─────────────────
// A MEASUREMENT tool, not a CI gate. A run that COMPLETES exits 0 for every
// verdict — PASS, REGRESS and INCONCLUSIVE alike. A reader consumes the VERDICT
// field of the written report artifact, not this process's exit status. Non-zero
// is reserved for an OPERATOR ERROR that prevented a run from happening:
//   exit 2 — bad args, missing/invalid fixture, missing capture, --execute
//            without ANTHROPIC_API_KEY, or a failed AI-layer import.
//
// Offline tooling only — NEVER imported by production / client code.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadDotenv } from '../../../agents/runtime/env';
import { validateCaseSet, type EverydayCaseSet } from './case-schema';
import { validateCapture, type EverydayCapture } from './capture-schema';
import { JUDGE_MODEL, type JudgeCompletionFn } from './judge';
import { MEASURED_FLAG, RUBRIC_VERSION } from './rubric';
import {
  MAX_CASES_PER_ARM,
  planJudgeCalls,
  runEverydayEval,
  writeReport,
  type EverydayReport,
} from './run-eval';
import type { BaselineConfig } from './verdict';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const DEFAULT_CASES = resolve(REPO_ROOT, 'eval', 'foxy-everyday', 'cases', 'everyday-cases-v1.json');
const DEFAULT_BASELINE = resolve(
  REPO_ROOT,
  'eval',
  'foxy-everyday',
  'baseline',
  'everyday-baseline-v1.json',
);

const EXIT_OK = 0;
const EXIT_CONFIG_ERROR = 2;

// ─── Args ────────────────────────────────────────────────────────────────────

export interface CliArgs {
  onPath: string | null;
  offPath: string | null;
  casesPath: string;
  baselinePath: string;
  limit: number;
  /** TRUE unless --execute was passed. The default costs nothing. */
  dryRun: boolean;
  outDir: string | null;
}

export type ArgParse = { ok: true; value: CliArgs } | { ok: false; error: string };

/** Parse argv. PURE (no env, no fs). Exported for tests. */
export function parseArgs(argv: readonly string[]): ArgParse {
  const args: CliArgs = {
    onPath: null,
    offPath: null,
    casesPath: DEFAULT_CASES,
    baselinePath: DEFAULT_BASELINE,
    limit: MAX_CASES_PER_ARM,
    dryRun: true, // ← the default. --execute is the only way to spend.
    outDir: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = (): string | null => (i + 1 < argv.length ? argv[(i += 1)] : null);
    switch (a) {
      case '--on': {
        const v = next();
        if (!v) return { ok: false, error: '--on requires a path' };
        args.onPath = v;
        break;
      }
      case '--off': {
        const v = next();
        if (!v) return { ok: false, error: '--off requires a path' };
        args.offPath = v;
        break;
      }
      case '--cases': {
        const v = next();
        if (!v) return { ok: false, error: '--cases requires a path' };
        args.casesPath = v;
        break;
      }
      case '--baseline': {
        const v = next();
        if (!v) return { ok: false, error: '--baseline requires a path' };
        args.baselinePath = v;
        break;
      }
      case '--limit': {
        const v = next();
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > MAX_CASES_PER_ARM) {
          return {
            ok: false,
            error: `--limit must be an integer in 1..${MAX_CASES_PER_ARM} (there is no unlimited value)`,
          };
        }
        args.limit = n;
        break;
      }
      case '--out': {
        const v = next();
        if (!v) return { ok: false, error: '--out requires a path' };
        args.outDir = v;
        break;
      }
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--execute':
        args.dryRun = false;
        break;
      default:
        return { ok: false, error: `unknown argument: ${a}` };
    }
  }

  return { ok: true, value: args };
}

// ─── Loaders ─────────────────────────────────────────────────────────────────

function loadCaseSet(path: string): EverydayCaseSet {
  if (!existsSync(path)) throw new Error(`case set not found at ${path}`);
  const doc = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
  const v = validateCaseSet(doc);
  if (!v.ok) throw new Error(`case set failed validation:\n${v.errors.join('\n')}`);
  return v.value;
}

function loadCaptureFile(path: string, label: string): EverydayCapture {
  if (!existsSync(path)) throw new Error(`${label} capture not found at ${path}`);
  const doc = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
  const v = validateCapture(doc);
  if (!v.ok) throw new Error(`${label} capture failed validation:\n${v.errors.join('\n')}`);
  return v.value;
}

/**
 * Load the committed control-arm baseline. A missing `pass_rate` (or an explicit
 * `placeholder: true`) is the CARRY-FORWARD condition: with no live control arm
 * the verdict is forced INCONCLUSIVE.
 */
export function loadBaseline(path: string): BaselineConfig {
  if (!existsSync(path)) throw new Error(`baseline not found at ${path}`);
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  const metrics = (raw.metrics ?? {}) as Record<string, unknown>;
  const passRate = typeof metrics.pass_rate === 'number' ? metrics.pass_rate : null;
  const harmCount = typeof metrics.harm_count === 'number' ? metrics.harm_count : null;
  return {
    passRate,
    harmCount,
    placeholder: raw.metrics_placeholder === true || passRate === null,
    rubricVersion: typeof raw.rubric_version === 'string' ? raw.rubric_version : '(missing)',
  };
}

// ─── Judge transport ─────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
async function loadCallClaude(): Promise<any> {
  // House transport: the retry/backoff/circuit-breaker helper in the shared AI
  // layer. This CLI never imports an AI SDK and never names an api.*.com URL.
  return import('@alfanumrik/lib/ai');
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Adapt `callClaude` into the judge's completion seam, PINNING the judge model.
 *
 * Pinning is deliberate and is NOT a model change: `claude-sonnet-4-5-20250929` is
 * already in packages/lib/src/ai/gateway/registry.ts (ANTHROPIC_SONNET_ID) and
 * is the same id eval/rag/harness/relevance-judge.ts uses. It is pinned because
 * the committed baseline is only comparable to a run judged by the SAME judge —
 * letting the default fallback chain silently answer with a different model
 * would make the margin meaningless without anyone noticing.
 */
export function makeJudgeCompletion(
  callClaudeFn: (options: {
    systemPrompt: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    model?: string;
    maxTokens?: number;
    temperature?: number;
  }) => Promise<{ content: string }>,
): JudgeCompletionFn {
  return async ({ system, user, temperature, maxTokens, model }) => {
    const res = await callClaudeFn({
      systemPrompt: system,
      messages: [{ role: 'user', content: user }],
      model,
      temperature,
      maxTokens,
    });
    return res.content;
  };
}

// ─── Output ──────────────────────────────────────────────────────────────────

function fmt(v: number | null): string {
  return v === null ? 'n/a' : v.toFixed(4);
}

function printSummary(report: EverydayReport, log: (s: string) => void): void {
  log('');
  log('─── Foxy everyday-example rubric summary ───');
  log(`rubric_version : ${report.run.rubric_version}`);
  log(`case_set       : ${report.run.case_set_version}`);
  log(`flag measured  : ${report.run.measured_flag}`);
  log(`judge          : ${report.run.judge_model} @ temp ${report.run.judge_temperature}`);
  log(`dry_run        : ${report.run.dry_run}`);
  log(`truncated      : ${report.run.truncated}   coverage_complete: ${report.run.coverage_complete}`);
  log('');
  log(`VERDICT        : ${report.verdict.verdict}`);
  log('');
  for (const arm of report.arms) {
    const r = arm.result;
    log(
      `arm=${arm.arm.padEnd(3)} flag_verified=${String(arm.flag_state_verified).padEnd(5)} ` +
        `pass=${r.passCount}/${r.scoredCount} rate=${fmt(r.passRate)} ` +
        `unseen=${r.unseen.length} unjudged=${r.unjudged.length} ` +
        `factually_safe=0 -> ${r.factualSafetyZeroCases.length} judge_calls=${arm.judge_calls}`,
    );
    const dead = r.cells.filter((c) => !c.cellPassed);
    if (dead.length > 0) {
      log(`      cells below bar: ${dead.map((c) => `${c.cell}(${c.passed}/${c.total})`).join(', ')}`);
    }
  }
  log('');
  log(`control rate   : ${fmt(report.verdict.controlPassRate)}`);
  log(`margin         : ${fmt(report.verdict.margin)} (required >= ${report.run.bars.required_margin_over_control})`);
  if (report.verdict.reasons.length > 0) {
    log('');
    log('Reasons:');
    for (const r of report.verdict.reasons) log(`  - ${r}`);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function main(argv: string[]): Promise<number> {
  // eslint-disable-next-line no-console
  const log = console.log.bind(console);

  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    log(`[everyday-eval] config error: ${parsed.error}`);
    log(
      'usage: npx tsx eval/foxy-everyday/harness/cli.ts --on <capture.json> ' +
        '[--off <capture.json>] [--cases <path>] [--baseline <path>] ' +
        `[--limit 1..${MAX_CASES_PER_ARM}] [--out <dir>] [--execute]`,
    );
    log('       (dry-run is the DEFAULT and costs nothing; --execute spends judge tokens)');
    return EXIT_CONFIG_ERROR;
  }
  const args = parsed.value;

  let caseSet: EverydayCaseSet;
  try {
    caseSet = loadCaseSet(args.casesPath);
  } catch (err) {
    log(`[everyday-eval] config error: ${err instanceof Error ? err.message : String(err)}`);
    return EXIT_CONFIG_ERROR;
  }

  if (!args.onPath) {
    log('[everyday-eval] config error: --on <treatment-capture.json> is required.');
    log(
      '  A capture file holds the raw Foxy responses for the case set plus the OBSERVED state of ' +
        `${MEASURED_FLAG}. See eval/foxy-everyday/README.md §"Capturing responses".`,
    );
    return EXIT_CONFIG_ERROR;
  }

  let onCapture: EverydayCapture;
  let offCapture: EverydayCapture | null = null;
  let baseline: BaselineConfig;
  try {
    onCapture = loadCaptureFile(args.onPath, 'treatment (flag ON)');
    if (args.offPath) offCapture = loadCaptureFile(args.offPath, 'control (flag OFF)');
    baseline = loadBaseline(args.baselinePath);
  } catch (err) {
    log(`[everyday-eval] config error: ${err instanceof Error ? err.message : String(err)}`);
    return EXIT_CONFIG_ERROR;
  }

  // ── DRY RUN (the default): print the plan, spend nothing, stop. ────────────
  if (args.dryRun) {
    const captures = offCapture ? [onCapture, offCapture] : [onCapture];
    const planned = planJudgeCalls(caseSet, captures, args.limit);
    log('[everyday-eval] DRY RUN — no judge call was made and nothing was spent.');
    log('');
    log(`  rubric_version   : ${RUBRIC_VERSION}`);
    log(`  case set         : ${caseSet.version} (${caseSet.cases.length} cases, limit ${args.limit})`);
    log(`  arms             : on${offCapture ? ' + off' : ' (control from baseline)'}`);
    log(`  judge model      : ${JUDGE_MODEL} @ temp 0`);
    log(`  PLANNED JUDGE CALLS: ${planned}   (upper bound: ${args.limit * captures.length})`);
    log(
      `  baseline         : ${baseline.placeholder ? 'PLACEHOLDER — a real run against it is INCONCLUSIVE' : `pass_rate ${fmt(baseline.passRate)}`}`,
    );
    log('');
    log('  VERDICT: INCONCLUSIVE (a dry run measures nothing and can never be read as PASS).');
    log('  Re-run with --execute to spend the judge tokens shown above.');
    return EXIT_OK;
  }

  // ── REAL RUN: fail loudly on a missing secret BEFORE anything runs. ────────
  // Ambient-first ordering (the teacher-skills lesson): an explicitly-set empty
  // ANTHROPIC_API_KEY means "no key" and must stay a config error; only an
  // ABSENT one may be filled from .env.local.
  const ambientKey = process.env.ANTHROPIC_API_KEY;
  loadDotenv(REPO_ROOT);
  const effectiveKey = ambientKey === undefined ? process.env.ANTHROPIC_API_KEY : ambientKey;
  if (!effectiveKey) {
    log(
      '[everyday-eval] config error: --execute requires ANTHROPIC_API_KEY (the judge transport). ' +
        'Nothing was run and nothing was spent. Drop --execute for a free dry run.',
    );
    return EXIT_CONFIG_ERROR;
  }

  let complete: JudgeCompletionFn;
  try {
    const mod = await loadCallClaude();
    if (typeof mod.callClaude !== 'function') {
      throw new Error('@alfanumrik/lib/ai does not export callClaude');
    }
    complete = makeJudgeCompletion(mod.callClaude);
  } catch (err) {
    log(
      `[everyday-eval] config error: failed to load the judge transport (@alfanumrik/lib/ai): ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    return EXIT_CONFIG_ERROR;
  }

  let report: EverydayReport;
  try {
    report = await runEverydayEval({
      caseSet,
      onCapture,
      offCapture,
      baseline,
      complete,
      dryRun: false,
      maxCases: args.limit,
    });
  } catch (err) {
    log(`[everyday-eval] config error: ${err instanceof Error ? err.message : String(err)}`);
    return EXIT_CONFIG_ERROR;
  }

  const reportPath = writeReport(report, args.outDir ?? undefined);
  printSummary(report, log);
  log('');
  log(`report written : ${reportPath}`);
  log(
    '[everyday-eval] exit 0 — measurement tool. Read the VERDICT field of the report artifact, ' +
      'NOT this exit code (REGRESS/INCONCLUSIVE are not process failures).',
  );
  return EXIT_OK;
}

// Import-safe: only runs when invoked as a script.
if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(
        `[everyday-eval] unexpected error: ${err instanceof Error ? err.stack : String(err)}`,
      );
      process.exit(EXIT_CONFIG_ERROR);
    });
}
