// eval/teacher-skills/harness/cli.ts
//
// Teacher-skills eval harness — the STANDALONE operator entrypoint (house
// pattern: eval/rag/harness/cli.ts). The runner (run-eval.ts) is a PURE
// assembler with injected deps; this file is the ONLY place real deps are
// wired. Run via `npm run eval:teacher:harness -- --rubric <name> --input
// <fixture-or-dir> [--judge on|off] [--out <dir>]`.
//
// ── PII / synthetic-only posture (HARD CONSTRAINT) ───────────────────────────
// This is a dev/CI measurement tool. It reads ONLY local JSON fixtures
// (eval/teacher-skills/fixtures/ or a path the operator supplies) and rubric
// CSVs. It has NO Supabase client, NO service-role key usage, and NO DB read
// of any kind — it structurally CANNOT touch student_* / quiz_* / profiles
// tables. Every artifact additionally passes the recursive P13 PII-shaped-key
// gate (run-eval.ts) before evaluation; a gated artifact is never serialized
// into a judge prompt.
//
// ── LLM transport ────────────────────────────────────────────────────────────
// `--judge on` dynamic-imports the house retry helper `callClaude` from
// `@alfanumrik/lib/ai` (packages/lib/src/ai/clients/claude.ts — bounded
// backoff, model fallback chain, circuit breaker) and adapts it via
// makeCallClaudeCompletion. NEVER a direct Anthropic SDK call, NEVER a model
// override (callClaude's configured default chain applies; model changes need
// user approval). `--judge off` (the default) performs deterministic checks
// only and never loads the AI layer at all.
//
// ── Exit-code policy (mirrors eval/rag/harness/cli.ts) ───────────────────────
// This is a MEASUREMENT tool, not a pass/fail CI gate. A run that COMPLETES
// is ALWAYS exit 0 — including runs whose every artifact is REVIEW. Non-zero
// is reserved for OPERATOR/CONFIG errors that prevented a run from happening
// at all:
//   exit 2 — bad/missing args, unknown rubric, unreadable/invalid rubric CSV,
//            missing/empty input, unparseable fixture JSON, --judge on
//            without ANTHROPIC_API_KEY, or a failed AI-layer import.
//
// Offline dev/CI tooling only — NEVER imported by production / client code.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';

import { loadDotenv } from '../../../agents/runtime/env';
import { parseRubricCsv, type Rubric } from './rubric-schema';
import { DETERMINISTIC_REGISTRY } from './deterministic-checks';
import {
  judgeArtifact,
  makeCallClaudeCompletion,
  type CallClaudeLike,
  type JudgeCompletionFn,
} from './judge';
import { runEval, type EvalArtifact, type InjectedJudge } from './run-eval';
import { buildReport, formatSummary, writeReport, REPORTS_DIR } from './report';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const RUBRICS_DIR = resolve(REPO_ROOT, 'eval', 'teacher-skills', 'rubrics');

const EXIT_OK = 0;
const EXIT_CONFIG_ERROR = 2;

// ─── Arg parsing (exported for tests) ────────────────────────────────────────

export interface CliArgs {
  rubric: string;
  input: string;
  judge: boolean;
  outDir: string;
}

export type ParsedArgs = { ok: true; value: CliArgs } | { ok: false; error: string };

const USAGE =
  'usage: --rubric <name> --input <fixture.json | dir> [--judge on|off] [--out <dir>]';

export function parseArgs(argv: string[]): ParsedArgs {
  let rubric: string | null = null;
  let input: string | null = null;
  let judge = false;
  let outDir = REPORTS_DIR;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      i++;
      return argv[i];
    };
    if (a === '--rubric') rubric = next() ?? null;
    else if (a === '--input') input = next() ?? null;
    else if (a === '--judge') {
      const v = next();
      if (v !== 'on' && v !== 'off') return { ok: false, error: `--judge must be on|off. ${USAGE}` };
      judge = v === 'on';
    } else if (a === '--out') {
      const v = next();
      if (!v) return { ok: false, error: `--out requires a directory. ${USAGE}` };
      outDir = resolve(v);
    } else {
      return { ok: false, error: `unknown argument "${a}". ${USAGE}` };
    }
  }
  if (!rubric) return { ok: false, error: `--rubric is required. ${USAGE}` };
  if (!/^[a-z0-9-]+$/.test(rubric)) {
    return { ok: false, error: `--rubric must match [a-z0-9-]+ (a rubrics/*.csv basename)` };
  }
  if (!input) return { ok: false, error: `--input is required. ${USAGE}` };
  return { ok: true, value: { rubric, input, judge, outDir } };
}

// ─── Loading (operator errors throw; main catches → exit 2) ──────────────────

function loadRubric(name: string): Rubric {
  const path = resolve(RUBRICS_DIR, `${name}.csv`);
  if (!existsSync(path)) {
    const available = readdirSync(RUBRICS_DIR)
      .filter((f) => f.endsWith('.csv'))
      .map((f) => basename(f, '.csv'))
      .join(', ');
    throw new Error(`rubric "${name}" not found at ${path}. Available: ${available}`);
  }
  const parsed = parseRubricCsv(name, readFileSync(path, 'utf-8'));
  if (!parsed.ok) {
    throw new Error(`rubric "${name}" failed validation:\n${parsed.errors.join('\n')}`);
  }
  return parsed.value;
}

/**
 * Fixture file convention: either a bare artifact, or a wrapper
 * `{ artifact, chat_response?, conditions? }` (meta keys ignored).
 */
function toEvalArtifact(id: string, doc: unknown): EvalArtifact {
  if (
    typeof doc === 'object' &&
    doc !== null &&
    !Array.isArray(doc) &&
    'artifact' in (doc as Record<string, unknown>)
  ) {
    const w = doc as Record<string, unknown>;
    return {
      id,
      artifact: w.artifact,
      chatResponse: typeof w.chat_response === 'string' ? w.chat_response : null,
      conditions: Array.isArray(w.conditions)
        ? w.conditions.filter((c): c is string => typeof c === 'string')
        : [],
    };
  }
  return { id, artifact: doc, chatResponse: null, conditions: [] };
}

function loadArtifacts(inputPath: string): EvalArtifact[] {
  // Resolve cwd-relative first; fall back to repo-root-relative so operators
  // can pass `eval/teacher-skills/fixtures/...` regardless of which workspace
  // directory npm ran the script from (root delegates to apps/host).
  let abs = resolve(inputPath);
  if (!existsSync(abs)) {
    const fromRoot = resolve(REPO_ROOT, inputPath);
    if (existsSync(fromRoot)) abs = fromRoot;
  }
  if (!existsSync(abs)) throw new Error(`--input path not found: ${abs}`);
  const st = statSync(abs);
  const files = st.isDirectory()
    ? readdirSync(abs)
        .filter((f) => extname(f) === '.json')
        .sort()
        .map((f) => resolve(abs, f))
    : [abs];
  if (files.length === 0) throw new Error(`--input directory contains no .json fixtures: ${abs}`);

  return files.map((f) => {
    let doc: unknown;
    try {
      doc = JSON.parse(readFileSync(f, 'utf-8'));
    } catch (err) {
      throw new Error(`fixture ${f} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    return toEvalArtifact(basename(f), doc);
  });
}

// ─── Judge wiring (--judge on ONLY) ──────────────────────────────────────────

/**
 * Dynamic-import the AI layer and build the injected judge. The ONLY LLM
 * transport in this harness: callClaude from @alfanumrik/lib/ai (house retry
 * helper). No model override — the configured default chain applies.
 */
async function buildRealJudge(rubricName: string): Promise<InjectedJudge> {
  const lib = (await import('@alfanumrik/lib/ai')) as { callClaude: CallClaudeLike };
  const complete: JudgeCompletionFn = makeCallClaudeCompletion(lib.callClaude);
  return async (criteria, artifactJson, chatResponse) => {
    const outcome = await judgeArtifact(
      { artifactJson, chatResponse, criteria, rubricName },
      { complete },
    );
    if (!outcome.ok) {
      // Malformed output / transport failure → null → per-criterion judge-error
      // → REVIEW (never a crash, never a fabricated pass).
      console.warn(`[teacher-eval] judge degraded: ${outcome.error}`);
      return null;
    }
    return outcome.judgements;
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function main(argv: string[]): Promise<number> {
  // eslint-disable-next-line no-console
  const log = console.log.bind(console);

  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    log(`[teacher-eval] config error: ${parsed.error}`);
    return EXIT_CONFIG_ERROR;
  }
  const args = parsed.value;

  let rubric: Rubric;
  let artifacts: EvalArtifact[];
  try {
    rubric = loadRubric(args.rubric);
    artifacts = loadArtifacts(args.input);
  } catch (err) {
    log(`[teacher-eval] config error: ${err instanceof Error ? err.message : String(err)}`);
    return EXIT_CONFIG_ERROR;
  }

  let judge: InjectedJudge | null = null;
  if (args.judge) {
    // Self-load .env.local (ambient env wins — loadDotenv never overwrites).
    loadDotenv(REPO_ROOT);
    if (!process.env.ANTHROPIC_API_KEY) {
      log(
        '[teacher-eval] config error: --judge on requires ANTHROPIC_API_KEY ' +
          '(callClaude transport). Run with --judge off for deterministic checks only.',
      );
      return EXIT_CONFIG_ERROR;
    }
    try {
      judge = await buildRealJudge(rubric.name);
    } catch (err) {
      log(
        `[teacher-eval] config error: failed to load @alfanumrik/lib/ai (callClaude): ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      return EXIT_CONFIG_ERROR;
    }
  }

  const run = await runEval({
    rubric,
    artifacts,
    deterministicChecks: DETERMINISTIC_REGISTRY[rubric.name] ?? {},
    judge,
  });

  const report = buildReport(run);
  const reportPath = writeReport(report, args.outDir);

  log('');
  log(formatSummary(report));
  log('');
  log(`report written : ${reportPath}`);
  log(
    '[teacher-eval] exit 0 — measurement tool: REVIEW verdicts are findings, ' +
      'not process failures. Non-zero exits are reserved for config/operator errors.',
  );
  return EXIT_OK;
}

// Import-safe guard (tests import main; only run when invoked as a script).
if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(
        `[teacher-eval] unexpected error: ${err instanceof Error ? err.stack : String(err)}`,
      );
      process.exit(EXIT_CONFIG_ERROR);
    });
}
