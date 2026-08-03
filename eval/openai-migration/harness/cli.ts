// eval/openai-migration/harness/cli.ts
//
// OpenAI-migration validation harness — the STANDALONE operator entrypoint
// (house pattern: eval/teacher-skills/harness/cli.ts, eval/rag/harness/
// cli.ts). run-eval.ts is a PURE assembler with injected deps; this file is
// the ONLY place real deps are wired.
//
// Invoke directly — NO npm script is wired for this yet (see the Deferred
// note in the ai-engineer report that shipped this harness; wiring
// `eval:openai-migration:harness` in apps/host/package.json + root
// package.json, matching eval:teacher:harness / eval:rag:harness, is a
// follow-up, not a change to touch package.json unreviewed):
//   npx tsx eval/openai-migration/harness/cli.ts --fixtures <dir> [--judge on|off] [--model <id>] [--out <dir>]
// (run from the repo root; or `cd apps/host && npx tsx ../../eval/openai-migration/harness/cli.ts ...`
// so the @alfanumrik/lib/* alias resolves via apps/host/tsconfig.json, same
// as the teacher-skills/rag harnesses.)
//
// ── PII / synthetic-only posture (HARD CONSTRAINT) ───────────────────────────
// Reads ONLY local JSON fixtures the operator supplies, plus the real prompt
// .txt templates under supabase/functions/grounded-answer/prompts/. NO
// Supabase client, NO service-role key, NO DB read of any kind — it
// structurally CANNOT touch student_* / quiz_* / profiles tables.
//
// ── LLM transport (real deps — ONLY wired here, and ONLY behind --judge on) ──
//   - Model under test: callOpenAI from packages/lib/src/ai/clients/openai.ts
//     — confirmed (by reading that file) to THROW cleanly on a missing
//     OPENAI_API_KEY, before any network call.
//   - Quality judge: the REAL, UNMODIFIED scoreFoxyAnswer() from
//     packages/lib/src/foxy/quality-eval.ts (Claude) — reused as-is, per the
//     task's explicit instruction not to touch its rubric/weights/provider.
//   - Safety-rail judge (this harness's additive dimension, see
//     ./safety-judge.ts): callClaude from @alfanumrik/lib/ai, the same house
//     retry helper eval/teacher-skills/harness/judge.ts uses. No model
//     override — callClaude's configured default chain applies.
//   - mcqOracle LLM grader (Gap 2, 2026-08-02): buildQuizMeLlmGrader() from
//     packages/lib/src/foxy/prompt-sections.ts — BYTE-IDENTICAL to the
//     grader production wires into gateQuizMeMcq/gatePracticeMcqs (Claude,
//     temperature 0). Reused as-is, never re-implemented locally.
// `--judge off` (the default) runs jsonContract + codeSwitch ONLY —
// deterministic, ZERO LLM calls of any kind (not even the quality judge is
// invoked; the mcqOracle dimension's deterministic P6 checks still run when
// jsonContract produced a schema-valid FoxyResponse, but with
// enableLlmGrader=false since mcqLlmGrade is null) — matching the
// teacher-skills harness's documented `--judge off` contract: a verdict can
// never be PASS for a sample whose quality/safety dimensions were never
// measured (see run-eval.ts's verdictFor).
//
// ── Exit-code policy (mirrors eval/teacher-skills/harness/cli.ts) ───────────
// This is a MEASUREMENT tool, not a pass/fail CI gate. A run that COMPLETES
// is ALWAYS exit 0 — including runs whose every sample is REVIEW. Non-zero
// is reserved for OPERATOR/CONFIG errors that prevented a run from happening
// at all:
//   exit 2 — bad/missing args, unreadable/invalid fixture JSON, an unknown
//            template_id, a missing prompt .txt file, or --judge on without
//            BOTH OPENAI_API_KEY (model under test) AND ANTHROPIC_API_KEY
//            (quality + safety judges), or a failed AI-layer import.
//
// Offline dev/CI tooling only — NEVER imported by production / client code.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';

// Type-only — erased at compile time, so this does NOT violate the "real
// deps only wired behind --judge on, never at module top level" rule below
// (that rule is about RUNTIME transport, not compile-time types).
import type { LlmGrader } from '@alfanumrik/lib/ai/validation/quiz-oracle';

import {
  runEval,
  type CallModelFn,
  type EvalSample,
  type QualityJudgeFn,
  type SafetyRailJudgeFn,
  type TemplateId,
} from './run-eval';
import {
  judgeSafetyRail,
  makeCallClaudeCompletion,
  type CallClaudeLike,
} from './safety-judge';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const PROMPTS_DIR = resolve(REPO_ROOT, 'supabase', 'functions', 'grounded-answer', 'prompts');
const DEFAULT_OUT_DIR = resolve(__dirname, '..', 'reports');

const EXIT_OK = 0;
const EXIT_CONFIG_ERROR = 2;

const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_QUALITY_PASS_THRESHOLD = 70;
const DEFAULT_SAFETY_PASS_THRESHOLD = 50;

const VALID_TEMPLATE_IDS: ReadonlySet<string> = new Set([
  'foxy_tutor_teach_v1',
  'foxy_tutor_exam_v1',
  'foxy_tutor_doubt_v1',
  'ncert_solver_v1',
  'quiz_question_generator_v1',
  'quiz_answer_verifier_v1',
]);

// ─── Template loading (real .txt files — canonical per prompts/index.ts's own
// comment: "The .txt files remain canonical for review/diff and are still
// loaded by the local test harness.") ────────────────────────────────────────

/**
 * Same `{{var}}` substitution as
 * supabase/functions/grounded-answer/prompts/index.ts's resolveTemplate —
 * reimplemented locally (pure, one line) rather than imported, because that
 * file's OTHER export (loadTemplate) calls Deno.readTextFile and this is a
 * Node/tsx harness — same cross-runtime boundary already documented at
 * claude.ts's MODEL_FALLBACK_ORDER. Exported for direct unit testing.
 */
export function resolveTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

function loadRawTemplate(templateId: TemplateId): string {
  const path = resolve(PROMPTS_DIR, `${templateId}.txt`);
  if (!existsSync(path)) throw new Error(`prompt template not found: ${path}`);
  return readFileSync(path, 'utf-8');
}

// ─── Fixture loading (operator errors throw; main catches → exit 2) ─────────

interface FixtureDoc {
  id?: string;
  template_id?: string;
  user_message?: string;
  template_variables?: Record<string, string>;
  grade?: string;
  subject?: string;
  max_tokens?: number;
  temperature?: number;
  citations?: Array<{ chunk_text: string; chapter_title?: string | null; page_number?: number | null }>;
  coach_mode?: 'socratic' | 'answer' | 'review' | null;
  expect_hindi_answer?: boolean;
  /** Gap 2 (2026-08-02): tags a fixture as a Foxy "Quiz me"/practice turn expected to emit mcq blocks. */
  expect_mcq_blocks?: boolean;
}

function toEvalSample(id: string, doc: FixtureDoc): EvalSample {
  if (!doc.template_id || !VALID_TEMPLATE_IDS.has(doc.template_id)) {
    throw new Error(
      `fixture ${id} has missing/unknown "template_id" (${String(doc.template_id)}). ` +
        `Valid ids: ${[...VALID_TEMPLATE_IDS].join(', ')}`,
    );
  }
  if (typeof doc.user_message !== 'string' || doc.user_message.length === 0) {
    throw new Error(`fixture ${id} is missing required non-empty "user_message"`);
  }
  const templateId = doc.template_id as TemplateId;
  const rawTemplate = loadRawTemplate(templateId);
  const systemPrompt = resolveTemplate(rawTemplate, doc.template_variables ?? {});

  return {
    id: doc.id ?? id,
    templateId,
    systemPrompt,
    userMessage: doc.user_message,
    grade: doc.grade ?? '8',
    subject: doc.subject ?? 'general',
    maxTokens: doc.max_tokens ?? 1024,
    temperature: doc.temperature ?? 0.3,
    citations: doc.citations ?? [],
    coachMode: doc.coach_mode ?? null,
    expectHindiAnswer: doc.expect_hindi_answer ?? false,
    expectMcqBlocks: doc.expect_mcq_blocks ?? false,
  };
}

function loadSamples(inputPath: string): EvalSample[] {
  // cwd-resilient repo-root resolution, same convention as
  // eval/teacher-skills/harness/cli.ts's loadArtifacts.
  let abs = resolve(inputPath);
  if (!existsSync(abs)) {
    const fromRoot = resolve(REPO_ROOT, inputPath);
    if (existsSync(fromRoot)) abs = fromRoot;
  }
  if (!existsSync(abs)) throw new Error(`--fixtures path not found: ${abs}`);

  const files = readdirSync(abs)
    .filter((f) => extname(f) === '.json')
    .sort()
    .map((f) => resolve(abs, f));
  if (files.length === 0) throw new Error(`--fixtures directory contains no .json fixtures: ${abs}`);

  return files.map((f) => {
    let doc: FixtureDoc;
    try {
      doc = JSON.parse(readFileSync(f, 'utf-8'));
    } catch (err) {
      throw new Error(`fixture ${f} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    return toEvalSample(basename(f), doc);
  });
}

// ─── Real deps (ONLY built when --judge on; never at module top level) ──────

async function buildRealCallModel(model: string): Promise<CallModelFn> {
  const { callOpenAI } = await import('@alfanumrik/lib/ai/clients/openai');
  return async ({ systemPrompt, userMessage, maxTokens, temperature }) => {
    const res = await callOpenAI({
      model,
      systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens,
      temperature,
    });
    return { content: res.content, model: res.model };
  };
}

async function buildRealQualityJudge(): Promise<QualityJudgeFn> {
  const { scoreFoxyAnswer } = await import('@alfanumrik/lib/foxy/quality-eval');
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  return async (input) => scoreFoxyAnswer(input, apiKey);
}

async function buildRealSafetyJudge(): Promise<SafetyRailJudgeFn> {
  const lib = (await import('@alfanumrik/lib/ai')) as { callClaude: CallClaudeLike };
  const complete = makeCallClaudeCompletion(lib.callClaude);
  return async (input) => judgeSafetyRail(input, { complete });
}

/**
 * Gap 2 (2026-08-02): the mcqOracle dimension's LLM grader. Reuses
 * buildQuizMeLlmGrader() from packages/lib/src/foxy/prompt-sections.ts
 * VERBATIM — the exact same Claude-backed, temperature-0 grader
 * apps/host/src/app/api/foxy/route.ts wires into gateQuizMeMcq /
 * gatePracticeMcqs. Never re-implemented locally, so this harness cannot
 * silently drift from what production actually gates mcq blocks with.
 */
async function buildRealMcqLlmGrade(): Promise<LlmGrader> {
  const { buildQuizMeLlmGrader } = await import('@alfanumrik/lib/foxy/prompt-sections');
  return buildQuizMeLlmGrader();
}

// ─── Arg parsing (exported for tests) ────────────────────────────────────────

export interface CliArgs {
  fixtures: string;
  judge: boolean;
  model: string;
  outDir: string | null;
}
export type ParsedArgs = { ok: true; value: CliArgs } | { ok: false; error: string };

const USAGE = 'usage: --fixtures <dir> [--judge on|off] [--model <id>] [--out <dir>]';

export function parseArgs(argv: string[]): ParsedArgs {
  let fixtures: string | null = null;
  let judge = false;
  let model = DEFAULT_MODEL;
  let outDir: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      i++;
      return argv[i];
    };
    if (a === '--fixtures') fixtures = next() ?? null;
    else if (a === '--judge') {
      const v = next();
      if (v !== 'on' && v !== 'off') return { ok: false, error: `--judge must be on|off. ${USAGE}` };
      judge = v === 'on';
    } else if (a === '--model') {
      const v = next();
      if (!v) return { ok: false, error: `--model requires a value. ${USAGE}` };
      model = v;
    } else if (a === '--out') {
      const v = next();
      if (!v) return { ok: false, error: `--out requires a directory. ${USAGE}` };
      outDir = resolve(v);
    } else {
      return { ok: false, error: `unknown argument "${a}". ${USAGE}` };
    }
  }
  if (!fixtures) return { ok: false, error: `--fixtures is required. ${USAGE}` };
  return { ok: true, value: { fixtures, judge, model, outDir } };
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function main(argv: string[]): Promise<number> {
  // eslint-disable-next-line no-console
  const log = console.log.bind(console);

  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    log(`[openai-migration-eval] config error: ${parsed.error}`);
    return EXIT_CONFIG_ERROR;
  }
  const args = parsed.value;

  let samples: EvalSample[];
  try {
    samples = loadSamples(args.fixtures);
  } catch (err) {
    log(`[openai-migration-eval] config error: ${err instanceof Error ? err.message : String(err)}`);
    return EXIT_CONFIG_ERROR;
  }

  let callModel: CallModelFn;
  let qualityJudge: QualityJudgeFn;
  let safetyJudge: SafetyRailJudgeFn | null = null;
  let mcqLlmGrade: LlmGrader | null = null;

  if (args.judge) {
    if (!process.env.OPENAI_API_KEY || !process.env.ANTHROPIC_API_KEY) {
      log(
        '[openai-migration-eval] config error: --judge on requires BOTH OPENAI_API_KEY ' +
          '(the model under test) and ANTHROPIC_API_KEY (scoreFoxyAnswer, the safety-rail ' +
          'judge, AND the mcqOracle LLM grader — all three are Claude). Run with --judge off ' +
          'for deterministic checks only.',
      );
      return EXIT_CONFIG_ERROR;
    }
    try {
      callModel = await buildRealCallModel(args.model);
      qualityJudge = await buildRealQualityJudge();
      safetyJudge = await buildRealSafetyJudge();
      mcqLlmGrade = await buildRealMcqLlmGrade();
    } catch (err) {
      log(
        `[openai-migration-eval] config error: failed to load the AI layer: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      return EXIT_CONFIG_ERROR;
    }
  } else {
    log(
      '[openai-migration-eval] --judge off: 0 live calls (model call is a no-op stub). ' +
        'json_contract + code_switch run on empty output (both will read skipped/fail ' +
        'accordingly); quality + safety_rail are not-judged; mcqOracle stays ' +
        'skipped-not-applicable (jsonContract never produces a schema-valid FoxyResponse on ' +
        'empty output). Every sample verdicts REVIEW by design — this mode is for ' +
        'wiring/fixture smoke-testing only, not a real measurement.',
    );
    callModel = async () => ({ content: '', model: 'none (--judge off)' });
    qualityJudge = async () => null;
  }

  const run = await runEval({
    samples,
    callModel,
    qualityJudge,
    safetyJudge,
    mcqLlmGrade,
    qualityPassThreshold: DEFAULT_QUALITY_PASS_THRESHOLD,
    safetyPassThreshold: DEFAULT_SAFETY_PASS_THRESHOLD,
  });

  log('');
  log('─── openai-migration eval summary ───');
  log(`model         : ${args.judge ? args.model : 'n/a (--judge off)'}`);
  log(`samples       : ${run.sampleCount}`);
  log(`pass          : ${run.aggregate.passed}`);
  log(`review        : ${run.aggregate.review}`);
  log(
    `json_contract : ${run.aggregate.jsonContract.passed}/${run.aggregate.jsonContract.evaluated}` +
      ` (parse fails: ${run.aggregate.jsonContract.parseFailures}, schema/oracle fails: ${run.aggregate.jsonContract.schemaFailures})`,
  );
  log(`code_switch   : ${run.aggregate.codeSwitch.passed}/${run.aggregate.codeSwitch.evaluated}`);
  log(
    `quality       : ${run.aggregate.quality.passed}/${run.aggregate.quality.evaluated}` +
      (run.aggregate.quality.averageScore !== null ? ` (avg ${run.aggregate.quality.averageScore.toFixed(1)})` : ''),
  );
  log(`safety_rail   : ${run.aggregate.safetyRail.passed}/${run.aggregate.safetyRail.evaluated}`);
  log(`mcq_oracle    : ${run.aggregate.mcqOracle.passed}/${run.aggregate.mcqOracle.evaluated}`);
  log('');
  for (const r of run.results) {
    log(`  ${r.verdict.padEnd(7)} ${r.sampleId} [${r.templateId}]`);
    for (const reason of r.reasons) log(`           - ${reason}`);
  }

  const outDir = args.outDir ?? DEFAULT_OUT_DIR;
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = resolve(outDir, `openai-migration-eval-${stamp}.json`);
  writeFileSync(reportPath, `${JSON.stringify(run, null, 2)}\n`, 'utf-8');

  log('');
  log(`report written : ${reportPath}`);
  log(
    '[openai-migration-eval] exit 0 — measurement tool: REVIEW verdicts are findings, ' +
      'not process failures. Non-zero exits are reserved for config/operator errors.',
  );
  return EXIT_OK;
}

// Import-safe guard (tests import main/parseArgs; only run when invoked as a script).
if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`[openai-migration-eval] unexpected error: ${err instanceof Error ? err.stack : String(err)}`);
      process.exit(EXIT_CONFIG_ERROR);
    });
}
