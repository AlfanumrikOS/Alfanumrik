// eval/openai-migration/harness/run-eval.ts
//
// OpenAI-migration validation harness — the PURE assembler (house pattern:
// same role as eval/teacher-skills/harness/run-eval.ts / eval/rag/harness/
// run-eval.ts). Takes INJECTED deps — a model-call fn, the quality judge
// (scoreFoxyAnswer-shaped), an optional safety-rail judge, and an optional
// mcq-oracle LLM grader — and produces per-sample pass/fail + score + an
// aggregate summary. NO NETWORK, no DB, no LLM transport of its own: the
// ONLY place real transport deps get wired is cli.ts. (This file DOES
// import a handful of PURE, synchronous validation/orchestration modules
// directly — see "Direct imports vs injected deps" below — that is not a
// contradiction of the "pure assembler" rule, it is the SAME pattern the
// file already used for checkJsonContract/checkHindiEnglishCodeSwitch.)
//
// ── Why this harness exists ──────────────────────────────────────────────────
// Gates the OpenAI-primary provider swap (2026-08-02, CEO-approved cost
// change — see supabase/functions/grounded-answer/config.ts's
// MODEL_FALLBACK_ORDER / packages/lib/src/ai/gateway/registry.ts's
// LEGACY_FALLBACK_ORDER). Foxy's system prompt, JSON output contract, and
// CBSE pedagogy tree were originally calibrated against Claude (RCA-FIX
// CRITICAL-1, 2026-06-26); this harness measures whether GPT-4o/GPT-4o-mini
// output still honors that contract before the canary ramps past its initial
// stage.
//
// ── Direct imports vs injected deps ──────────────────────────────────────────
// checkJsonContract's Foxy-schema and quiz-oracle branches (below) import
// FoxyResponseSchema (packages/lib/src/foxy/schema.ts) and
// runDeterministicChecks (packages/lib/src/ai/validation/quiz-oracle.ts)
// DIRECTLY — both are pure, synchronous, zero-I/O functions, exactly like
// the pre-existing checkJsonContract/checkHindiEnglishCodeSwitch were already
// NOT injected. The mcqOracle dimension (Gap 2) similarly imports
// gateQuizMeMcq/gatePracticeMcqs (packages/lib/src/foxy/quiz-me-oracle-gate.ts)
// DIRECTLY — those functions are themselves pure orchestration with an
// INJECTABLE LLM seam, mirroring exactly how quality/safety judges are
// injected here while their surrounding aggregation logic is not. Only the
// LLM-calling seam (`mcqLlmGrade`) is injected via RunDeps — never a raw
// network call embedded in this file.
//
// ── Checks per sample (independent signals, never blended into one score —
// matches the house "per-signal, not aggregate-only" eval philosophy; see
// eval/teacher-skills/harness/report.ts and eval/rag/harness/verdict.ts) ─────
//   1. jsonContract — deterministic, but NOT bare JSON.parse (2026-08-02 gap
//      fix). For the 3 Foxy templates (foxy_tutor_teach_v1/exam_v1/doubt_v1)
//      the raw output must both parse AND pass FoxyResponseSchema.safeParse()
//      — the SAME schema production runs before rendering a structured
//      answer, falling back to wrapAsParagraph() (losing all structured
//      blocks) on schema failure. For quiz_question_generator_v1, the parsed
//      candidate is run through runDeterministicChecks() — the SAME REG-54
//      oracle production runs before a question_bank write (see
//      checkQuizGeneratorContract's doc comment for the citation trail; the
//      `{"error":...}` abstain sentinel is skipped-not-applicable, not a
//      fail). For quiz_answer_verifier_v1, the parsed output is checked
//      against production's ACTUAL parseVerifierJson contract — see
//      checkQuizVerifierContract's doc comment for why this does NOT run
//      runDeterministicChecks() (wrong shape — it would never pass).
//      ncert_solver_v1 is exempt by design — always
//      `skipped-not-applicable` (raw-markdown per grounded-answer/config.ts's
//      own PROMPT_REV=3 comment). Every fail is attributed a `failureStage`
//      ('parse' vs 'schema') so parse failures and schema/oracle failures are
//      counted DISTINCTLY, never conflated into one bucket.
//   2. codeSwitch — deterministic heuristic. When a sample is tagged
//      `expectHindiAnswer` and the question itself is detectably
//      Hindi/Hinglish, the answer must also carry Hindi content (Devanagari
//      or common Hinglish markers) — the FOXY_SAFETY_RAILS bilingual rule
//      ("respond in the same language the student wrote").
//   3. quality — delegates to the injected `scoreFoxyAnswer`-shaped judge
//      AS-IS (packages/lib/src/foxy/quality-eval.ts, UNTOUCHED by this
//      harness — rubric/weights/provider unchanged; the judge stays Claude).
//      Its cbseScopeScore + ageAppropriatenessScore dimensions already cover
//      most of the CBSE-scope surface.
//   4. safetyRail — ADDITIVE, not part of quality-eval.ts (see ./safety-judge
//      .ts). An optional injected judge scoring adherence to the literal
//      FOXY_SAFETY_RAILS text — specifically the off-topic-redirect rule that
//      scoreFoxyAnswer's 4-dimension rubric does not ask about directly.
//      `null` injected judge (e.g. `--judge off`) → every sample's
//      safetyRail is `not-judged`, and per verdictFor below a sample can
//      NEVER be PASS when a dimension was never actually measured — mirrors
//      teacher-skills' `--judge off` contract.
//   5. mcqOracle — ADDITIVE (2026-08-02 gap fix, Gap 2). Foxy's "Quiz
//      me"/practice modes emit `mcq` blocks gated in production by
//      packages/lib/src/foxy/quiz-me-oracle-gate.ts's gateQuizMeMcq (single
//      mcq — "Quiz me") / gatePracticeMcqs (2+ mcq — real practice) — the
//      SAME REG-54 oracle that gates question_bank writes. Only evaluated
//      for samples tagged `expectMcqBlocks: true`; everything else is
//      skipped-not-applicable. Pass/fail uses QUIZ_ORACLE_PASS_RATE_THRESHOLD
//      — the SAME ≥90% pass-rate bar as quiz_question_generator_v1's oracle
//      check (assessment: "same P6 surface"), trivially binary for a single
//      mcq and a real gated-fraction for a multi-mcq practice turn.
//
// Offline dev/CI tooling only — NEVER imported by production / client code.

import type { ZodIssue } from 'zod';

import { FoxyResponseSchema, isFoxyMcqBlock, type FoxyResponse } from '@alfanumrik/lib/foxy/schema';
import {
  runDeterministicChecks,
  type CandidateQuestion,
  type LlmGrader,
} from '@alfanumrik/lib/ai/validation/quiz-oracle';
import { gateQuizMeMcq, gatePracticeMcqs } from '@alfanumrik/lib/foxy/quiz-me-oracle-gate';

// ─── Template ids (mirrors the 6 ids this harness validates; duplicated here
// rather than importing supabase/functions/grounded-answer/config.ts's
// REGISTERED_PROMPT_TEMPLATES because that file is Deno-targeted — Deno
// cannot be imported into this Node/tsx harness, same cross-runtime boundary
// documented in claude.ts's MODEL_FALLBACK_ORDER comment. Keep in sync by
// hand, same discipline as the mol/ PRICING tables.) ─────────────────────────

export type TemplateId =
  | 'foxy_tutor_teach_v1'
  | 'foxy_tutor_exam_v1'
  | 'foxy_tutor_doubt_v1'
  | 'ncert_solver_v1'
  | 'quiz_question_generator_v1'
  | 'quiz_answer_verifier_v1';

/**
 * The 5 templates (of the 6 this harness validates) whose contract is a
 * single JSON object/array — ncert_solver_v1 is deliberately excluded
 * (raw-markdown by design; see grounded-answer/config.ts's PROMPT_REV=3
 * comment: "ncert_solver_v1 is raw-markdown and untouched").
 */
export const JSON_CONTRACT_TEMPLATES: ReadonlySet<TemplateId> = new Set([
  'foxy_tutor_teach_v1',
  'foxy_tutor_exam_v1',
  'foxy_tutor_doubt_v1',
  'quiz_question_generator_v1',
  'quiz_answer_verifier_v1',
]);

const FOXY_SCHEMA_TEMPLATES: ReadonlySet<TemplateId> = new Set([
  'foxy_tutor_teach_v1',
  'foxy_tutor_exam_v1',
  'foxy_tutor_doubt_v1',
]);

// ─── Injected-dependency shapes ──────────────────────────────────────────────

/** One sample under evaluation (a rendered prompt, ready to send to the model). */
export interface EvalSample {
  /** Stable id, e.g. a fixture filename or synthetic label. */
  id: string;
  templateId: TemplateId;
  /** Fully-rendered system prompt — resolveTemplate() already applied by the caller. */
  systemPrompt: string;
  /** The student's question / user turn. */
  userMessage: string;
  /** P5: grade is a string ("6".."12"), never a number. */
  grade: string;
  subject: string;
  maxTokens: number;
  temperature: number;
  /** Citations to ground scoreFoxyAnswer's accuracy dimension; [] for abstain-style samples. */
  citations: Array<{ chunk_text: string; chapter_title?: string | null; page_number?: number | null }>;
  coachMode: 'socratic' | 'answer' | 'review' | null;
  /** True when userMessage is Hindi/Hinglish — the code-switch check then requires a Hindi-bearing answer. */
  expectHindiAnswer: boolean;
  /**
   * True when this sample exercises a Foxy "Quiz me" / real-practice turn
   * that is expected to emit one or more `mcq` blocks (Gap 2, 2026-08-02).
   * Drives the mcqOracle dimension — see runMcqOracleCheck. Only meaningful
   * for the 3 Foxy templates (mcq blocks are a Foxy structured-output
   * feature, not part of the quiz-generator/verifier templates' contracts).
   */
  expectMcqBlocks: boolean;
}

export interface ModelCallResult {
  content: string;
  model: string;
}

/** The model-under-test call. Real impl (cli.ts): callOpenAI. Tests: a fake/double. */
export type CallModelFn = (args: {
  systemPrompt: string;
  userMessage: string;
  maxTokens: number;
  temperature: number;
}) => Promise<ModelCallResult>;

/** Structurally compatible with packages/lib/src/foxy/quality-eval.ts's QualityScoreOutput. */
export interface QualityScoreLike {
  accuracyScore: number;
  scaffoldFidelityScore: number;
  ageAppropriatenessScore: number;
  cbseScopeScore: number;
  overallScore: number;
  judgeModel: string;
  rubricVersion: string;
  notes: string | null;
}

/**
 * scoreFoxyAnswer-shaped judge. Real impl (cli.ts) calls the REAL, UNMODIFIED
 * scoreFoxyAnswer() from packages/lib/src/foxy/quality-eval.ts — this harness
 * never forks or edits that file's rubric/weights/provider.
 */
export type QualityJudgeFn = (input: {
  question: string;
  answer: string;
  citations: Array<{ chunk_text: string; chapter_title?: string | null; page_number?: number | null }>;
  grade: string;
  subject: string;
  coachMode: 'socratic' | 'answer' | 'review' | null;
}) => Promise<QualityScoreLike | null>;

export interface SafetyRailJudgement {
  pass: boolean;
  score: number; // 0..100
  explanation: string;
}

/** The ADDITIVE safety-rail judge (see ./safety-judge.ts). null = disabled for this run. */
export type SafetyRailJudgeFn = (args: {
  question: string;
  answer: string;
}) => Promise<SafetyRailJudgement | null>;

// ─── Deterministic checks (pure, exported for direct unit testing) ──────────

export type JsonContractStatus = 'pass' | 'fail' | 'skipped-not-applicable';

/** Which real production contract actually gated this template's output. */
export type JsonContractCheckKind =
  | 'foxy-schema' // FoxyResponseSchema.safeParse() — the 3 Foxy templates
  | 'quiz-oracle' // runDeterministicChecks() (REG-54) — quiz_question_generator_v1
  | 'quiz-verifier-contract' // parseVerifierJson-mirrored contract — quiz_answer_verifier_v1
  | 'none'; // ncert_solver_v1 (raw-markdown, not applicable)

/**
 * Distinguishes "never even valid JSON" from "valid JSON that fails the
 * real production contract" — the two failure modes Gap 1 requires the
 * harness to count SEPARATELY rather than conflating into one bucket.
 * `null` when status is 'pass' or 'skipped-not-applicable'.
 */
export type JsonContractFailureStage = 'parse' | 'schema' | null;

export interface JsonContractResult {
  status: JsonContractStatus;
  error: string | null;
  checkKind: JsonContractCheckKind;
  failureStage: JsonContractFailureStage;
  /**
   * The schema-validated FoxyResponse — present ONLY when
   * checkKind==='foxy-schema' && status==='pass'. Lets the mcqOracle
   * dimension (Gap 2) reuse the already-validated structured payload
   * without re-parsing raw model output a second time.
   */
  foxyResponse: FoxyResponse | null;
}

/** Same fenced-code-block recovery as quality-eval.ts's stripFences / teacher-skills judge.ts's stripFences. */
function stripFences(s: string): string {
  let out = s.trim();
  if (out.startsWith('```')) {
    out = out.replace(/^```(?:json|javascript|js)?\s*/i, '');
    out = out.replace(/```\s*$/i, '');
    out = out.trim();
  }
  return out;
}

type ParseResult = { ok: true; value: unknown } | { ok: false; error: string };

function parseWithFenceRecovery(rawOutput: string): ParseResult {
  const stripped = stripFences(rawOutput);
  try {
    return { ok: true, value: JSON.parse(stripped) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Summarizes zod's real `ZodIssue[]` (from `FoxyResponseSchema.safeParse().error.issues`)
 * into a short, capped diagnostic string.
 *
 * Uses zod's own `ZodIssue` type directly (a type-only import — erased at compile
 * time, zero runtime cost, so this does NOT pull `zod` into the bundle or add a
 * transport dependency). A prior revision hand-duck-typed this parameter as
 * `{ path: ReadonlyArray<string | number>; message: string }` specifically to avoid
 * a `zod` import, but that shape silently diverged from zod v4's actual
 * `$ZodIssueBase.path: PropertyKey[]` (i.e. it omits `symbol`) — a real type error
 * (`result.error.issues` is not assignable to the duck type) invisible to any
 * type-check gate today because `eval/**` has no tsconfig / type-check coverage
 * (see cli.ts's header comment on the harness's own gaps). `.map(String)` (not a
 * bare `.join('.')`) defends against a symbol path segment: `Array.prototype.join`
 * calls the `ToString` abstract op, which throws on `symbol` — practically
 * unreachable from JSON-parsed input today (JSON has no symbol literal), but the
 * type is real regardless and the guard is free.
 */
function summarizeSchemaIssues(issues: ReadonlyArray<ZodIssue>): string {
  const parts = issues.slice(0, 5).map((i) => `${i.path.length > 0 ? i.path.map(String).join('.') : '(root)'}: ${i.message}`);
  const suffix = issues.length > 5 ? ` (+${issues.length - 5} more)` : '';
  return `${parts.join('; ')}${suffix}`.slice(0, 500);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * foxy_tutor_teach_v1 / foxy_tutor_exam_v1 / foxy_tutor_doubt_v1's JSON
 * contract, per production: grounded-answer's structured-output path runs
 * FoxyResponseSchema.safeParse() on the model's raw JSON and — on ANY schema
 * failure, not just a parse failure — silently falls back to
 * wrapAsParagraph(), which DROPS every structured block (mcq, math, step,
 * diagram, ...) and degrades to plain paragraphs. That degradation is
 * invisible to a harness that only checks `JSON.parse` succeeds, which is
 * exactly Gap 1: valid-but-schema-nonconforming JSON used to read as a
 * harness PASS while it actually degrades production UX.
 */
function checkFoxySchemaContract(rawOutput: string): JsonContractResult {
  const parsed = parseWithFenceRecovery(rawOutput);
  if (!parsed.ok) {
    return { status: 'fail', error: parsed.error, checkKind: 'foxy-schema', failureStage: 'parse', foxyResponse: null };
  }
  const result = FoxyResponseSchema.safeParse(parsed.value);
  if (!result.success) {
    return {
      status: 'fail',
      error: summarizeSchemaIssues(result.error.issues),
      checkKind: 'foxy-schema',
      failureStage: 'schema',
      foxyResponse: null,
    };
  }
  return { status: 'pass', error: null, checkKind: 'foxy-schema', failureStage: null, foxyResponse: result.data };
}

/**
 * quiz_question_generator_v1's JSON contract, per production
 * (supabase/functions/bulk-question-gen/index.ts): `parseDraftJson()` parses
 * the generator's raw JSON into the EXACT `CandidateQuestion` shape
 * (question_text/options/correct_answer_index/explanation/difficulty/
 * bloom_level), and `validateWithCacheAndLogging()` then runs that candidate
 * through `validateCandidate()` — i.e. `runDeterministicChecks()`, the SAME
 * REG-54 oracle that gates every `question_bank` write — before the row is
 * ever accepted. A candidate that would be oracle-rejected in production
 * must not read as a harness PASS just because it parsed as JSON — that is
 * exactly the gap being closed here.
 *
 * The `{"error": "insufficient_source"}` sentinel — matched generically as
 * ANY `"error"` key present, mirroring `parseDraftJson`'s own
 * `if ('error' in obj) return null` exactly — is the generator's documented,
 * legitimate abstain. Production treats it as "no candidate produced", not a
 * defect, so the harness marks it skipped-not-applicable rather than pass or
 * fail (same "a check that does not apply is not a lenient pass" posture as
 * ncert_solver_v1's skip).
 *
 * `subject` is deliberately NOT forwarded into the oracle candidate — same
 * reasoning packages/lib/src/foxy/quiz-me-oracle-gate.ts's
 * `mcqBlockToCandidate` documents: this harness's EvalSample defaults
 * `subject` to the filler value `'general'` (cli.ts's toEvalSample), which is
 * not in the oracle's fixed CBSE allowlist and would manufacture a FALSE
 * `invalid_subject` rejection unrelated to the candidate's real quality.
 * `grade` IS forwarded — EvalSample.grade is always a real P5 string, and the
 * generator template's actual JSON contract never emits a `subject` field at
 * all, so there is no live conflict with this decision.
 */
function checkQuizGeneratorContract(rawOutput: string, grade: string): JsonContractResult {
  const parsed = parseWithFenceRecovery(rawOutput);
  if (!parsed.ok) {
    return { status: 'fail', error: parsed.error, checkKind: 'quiz-oracle', failureStage: 'parse', foxyResponse: null };
  }
  const record = asRecord(parsed.value);
  if (record !== null && 'error' in record) {
    return { status: 'skipped-not-applicable', error: null, checkKind: 'quiz-oracle', failureStage: null, foxyResponse: null };
  }
  const candidate = { ...(record ?? {}), grade } as CandidateQuestion;
  const rejection = runDeterministicChecks(candidate);
  if (rejection) {
    return {
      status: 'fail',
      error: `${rejection.category}: ${rejection.reason}`,
      checkKind: 'quiz-oracle',
      failureStage: 'schema',
      foxyResponse: null,
    };
  }
  return { status: 'pass', error: null, checkKind: 'quiz-oracle', failureStage: null, foxyResponse: null };
}

/**
 * quiz_answer_verifier_v1's JSON contract, per production
 * (bulk-question-gen/index.ts's `parseVerifierJson()` AND
 * packages/lib/src/ai/agents/agents/fix-failed-questions/tools/re-verify.ts's
 * `VerifierAnswer` parsing): the ONLY hard structural requirement production
 * enforces on this template's output is that `verified` is a real boolean —
 * `parseVerifierJson` returns null (its own "parse failed" signal) SOLELY on
 * `typeof parsed.verified !== 'boolean'`; `reason`/`correct_option_index`/
 * `supporting_chunk_ids` are all read leniently with safe defaults and never
 * cause a failure on their own.
 *
 * This intentionally does NOT run runDeterministicChecks() / the REG-54
 * oracle, despite the surface-level "these are the 2 quiz templates"
 * grouping. The oracle's CandidateQuestion contract (question_text/options/
 * correct_answer_index/explanation) has ZERO field overlap with the
 * verifier's actual output shape (verified/reason/correct_option_index/
 * supporting_chunk_ids) — production NEVER feeds a verifier response through
 * that oracle; only the GENERATOR's output goes through it (see
 * checkQuizGeneratorContract above). Forcing runDeterministicChecks() onto
 * this shape would reject on `p6_text_empty_or_placeholder` for every single
 * sample unconditionally (question_text is never a field this template
 * emits) — a constant, uninformative fail that is a WORSE defect than the
 * bare-JSON.parse gap it would replace (100% of verifier samples would
 * REVIEW forever, regardless of actual quality, which is strictly less
 * informative than today's bare parse check). See the ai-engineer report
 * that landed this function for the full citation trail backing this
 * deviation from a literal "run runDeterministicChecks for both quiz
 * templates" reading.
 */
function checkQuizVerifierContract(rawOutput: string): JsonContractResult {
  const parsed = parseWithFenceRecovery(rawOutput);
  if (!parsed.ok) {
    return {
      status: 'fail',
      error: parsed.error,
      checkKind: 'quiz-verifier-contract',
      failureStage: 'parse',
      foxyResponse: null,
    };
  }
  const record = asRecord(parsed.value);
  const verifiedField = record ? record.verified : undefined;
  if (typeof verifiedField !== 'boolean') {
    return {
      status: 'fail',
      error: `"verified" must be a boolean (production's parseVerifierJson contract), got ${JSON.stringify(verifiedField)}`,
      checkKind: 'quiz-verifier-contract',
      failureStage: 'schema',
      foxyResponse: null,
    };
  }
  return { status: 'pass', error: null, checkKind: 'quiz-verifier-contract', failureStage: null, foxyResponse: null };
}

/**
 * Verify a model's raw output against the REAL production contract for its
 * template — not bare JSON.parse (2026-08-02 gap fix; see the per-branch doc
 * comments above for exactly which production code path each branch
 * mirrors). ncert_solver_v1 (raw-markdown) is always
 * `skipped-not-applicable` — this is NOT a lenient pass, it means "this
 * check does not apply to this template." `grade` defaults to '8' (matches
 * cli.ts's EvalSample default) so existing 2-arg call sites keep compiling.
 */
export function checkJsonContract(templateId: TemplateId, rawOutput: string, grade: string = '8'): JsonContractResult {
  if (!JSON_CONTRACT_TEMPLATES.has(templateId)) {
    return { status: 'skipped-not-applicable', error: null, checkKind: 'none', failureStage: null, foxyResponse: null };
  }
  if (FOXY_SCHEMA_TEMPLATES.has(templateId)) {
    return checkFoxySchemaContract(rawOutput);
  }
  if (templateId === 'quiz_question_generator_v1') {
    return checkQuizGeneratorContract(rawOutput, grade);
  }
  // Only 'quiz_answer_verifier_v1' remains in JSON_CONTRACT_TEMPLATES.
  return checkQuizVerifierContract(rawOutput);
}

const DEVANAGARI_RE = /[ऀ-ॿ]/; // Unicode Devanagari block
// Common Hinglish (Roman-script Hindi) markers — a light heuristic, not a
// language-ID model. Deliberately conservative: a false negative (missing a
// genuine Hinglish turn) just means the check is skipped for that sample —
// it must never manufacture a false 'fail'.
const HINGLISH_MARKERS = /\b(kya|hai|kaise|kyun|nahi|matlab|samjh|kripya|aap|hoga|karo)\b/i;

function isHindiLike(text: string): boolean {
  return DEVANAGARI_RE.test(text) || HINGLISH_MARKERS.test(text);
}

export type CodeSwitchStatus = 'pass' | 'fail' | 'skipped-not-applicable';
export interface CodeSwitchResult {
  status: CodeSwitchStatus;
  explanation: string;
}

/**
 * P7 bilingual check: when the sample is tagged `expectHindiAnswer` AND the
 * question itself is detectably Hindi/Hinglish, the answer must carry Hindi
 * content too (FOXY_SAFETY_RAILS: "Respond in the same language the student
 * wrote"). A sample not tagged, or tagged but whose question has no
 * detectable Hindi marker (mislabeled fixture), is skipped rather than
 * force-failed — this check never penalises English-only conversations.
 */
export function checkHindiEnglishCodeSwitch(
  userMessage: string,
  answer: string,
  expectHindiAnswer: boolean,
): CodeSwitchResult {
  if (!expectHindiAnswer) {
    return { status: 'skipped-not-applicable', explanation: 'sample is not tagged expectHindiAnswer' };
  }
  if (!isHindiLike(userMessage)) {
    return {
      status: 'skipped-not-applicable',
      explanation:
        'expectHindiAnswer=true but userMessage has no detectable Hindi/Hinglish marker — fixture mislabeled',
    };
  }
  return isHindiLike(answer)
    ? { status: 'pass', explanation: 'answer carries Devanagari or Hinglish markers matching the question language' }
    : {
        status: 'fail',
        explanation: 'question used Hindi/Hinglish but the answer has no detectable Hindi content (P7 bilingual rule)',
      };
}

// ─── mcqOracle dimension (Gap 2, 2026-08-02) ─────────────────────────────────

/**
 * Shared ≥90% pass-rate bar across BOTH oracle-gated P6 surfaces this
 * harness measures: quiz_question_generator_v1's oracle check
 * (checkQuizGeneratorContract, trivially binary for its single candidate —
 * 1/1 or 0/1 against this same threshold) and the mcqOracle dimension below
 * (a real fraction for a multi-mcq real-practice turn). One shared constant
 * so the two P6/REG-54 oracle surfaces are held to a textually-identical bar
 * rather than two independently-drifting magic numbers.
 */
export const QUIZ_ORACLE_PASS_RATE_THRESHOLD = 0.9;

export interface McqOracleResult {
  status: CheckStatus;
  totalMcqBlocks: number;
  /** How many mcq blocks were actually run through the oracle (bounded by gatePracticeMcqs' attemptCap). */
  gated: number;
  kept: number;
  /** kept/gated, or null when the dimension did not run (skipped). */
  passRate: number | null;
  llmCalls: number;
  explanation: string;
}

function skippedMcqOracle(explanation: string): McqOracleResult {
  return { status: 'skipped-not-applicable', totalMcqBlocks: 0, gated: 0, kept: 0, passRate: null, llmCalls: 0, explanation };
}

/**
 * Gap 2 — gate any `mcq` blocks Foxy itself emits ("Quiz me" / real-practice
 * modes) through the SAME REG-54 oracle gate production uses
 * (packages/lib/src/foxy/quiz-me-oracle-gate.ts's gateQuizMeMcq /
 * gatePracticeMcqs) before a student would ever see them. This is Foxy's
 * most direct P6 surface and previously had no fixture-tagging or check in
 * this harness at all.
 *
 * Only runs when the sample is tagged `expectMcqBlocks` AND jsonContract
 * already produced a schema-valid FoxyResponse — mcq blocks can only be
 * meaningfully located inside an already-schema-valid structured payload.
 * When jsonContract itself failed, THAT failure already drives the sample to
 * REVIEW; this dimension stays skipped-not-applicable rather than
 * double-counting the same root cause under a second dimension.
 *
 * Routing mirrors production exactly (apps/host/src/app/api/foxy/route.ts):
 * exactly 1 mcq block = "Quiz me" mode → gateQuizMeMcq (binary); 2+ mcq
 * blocks = real-practice mode → gatePracticeMcqs (bounded batch gate). Zero
 * mcq blocks despite being tagged expectMcqBlocks is itself a fail — the
 * feature promised structured mcqs and did not deliver any.
 */
export async function runMcqOracleCheck(args: {
  expectMcqBlocks: boolean;
  jsonContract: JsonContractResult;
  grade: string;
  subject: string;
  llmGrade: LlmGrader | null;
}): Promise<McqOracleResult> {
  if (!args.expectMcqBlocks) {
    return skippedMcqOracle('sample is not tagged expectMcqBlocks');
  }
  if (args.jsonContract.checkKind !== 'foxy-schema' || args.jsonContract.status !== 'pass' || args.jsonContract.foxyResponse === null) {
    return skippedMcqOracle(
      'jsonContract did not produce a schema-valid FoxyResponse to inspect for mcq blocks (see jsonContract for the root-cause failure)',
    );
  }

  const response = args.jsonContract.foxyResponse;
  const totalMcqBlocks = response.blocks.filter(isFoxyMcqBlock).length;
  const enableLlmGrader = args.llmGrade !== null;

  if (totalMcqBlocks === 0) {
    return {
      status: 'fail',
      totalMcqBlocks: 0,
      gated: 0,
      kept: 0,
      passRate: 0,
      llmCalls: 0,
      explanation: 'sample tagged expectMcqBlocks=true but the model emitted zero mcq blocks',
    };
  }

  if (totalMcqBlocks === 1) {
    const gate = await gateQuizMeMcq(response, {
      grade: args.grade,
      subject: args.subject,
      enableLlmGrader,
      ...(args.llmGrade ? { llmGrade: args.llmGrade } : {}),
    });
    const kept = gate.ok ? 1 : 0;
    return {
      status: gate.ok ? 'pass' : 'fail',
      totalMcqBlocks: 1,
      gated: 1,
      kept,
      passRate: kept,
      llmCalls: gate.llm_calls,
      explanation: gate.ok
        ? 'single mcq block passed gateQuizMeMcq (REG-54 oracle)'
        : `single mcq block rejected by gateQuizMeMcq: ${gate.reason} — ${gate.detail}`,
    };
  }

  const result = await gatePracticeMcqs(response, {
    grade: args.grade,
    subject: args.subject,
    enableLlmGrader,
    ...(args.llmGrade ? { llmGrade: args.llmGrade } : {}),
  });
  const passRate = result.gated > 0 ? result.kept.length / result.gated : 0;
  const status: CheckStatus = passRate >= QUIZ_ORACLE_PASS_RATE_THRESHOLD ? 'pass' : 'fail';
  const rejectionSummary =
    result.rejections.length > 0 ? `; rejections: ${result.rejections.map((r) => `#${r.index} ${r.reason}`).join(', ')}` : '';
  return {
    status,
    totalMcqBlocks,
    gated: result.gated,
    kept: result.kept.length,
    passRate,
    llmCalls: result.llm_calls,
    explanation:
      `gatePracticeMcqs kept ${result.kept.length}/${result.gated} gated mcq blocks ` +
      `(${(passRate * 100).toFixed(0)}% — threshold ${(QUIZ_ORACLE_PASS_RATE_THRESHOLD * 100).toFixed(0)}%)${rejectionSummary}`,
  };
}

// ─── Per-sample result + verdict ─────────────────────────────────────────────

export type CheckStatus = 'pass' | 'fail' | 'skipped-not-applicable' | 'not-judged' | 'judge-error' | 'call-error';

export interface SampleResult {
  sampleId: string;
  templateId: TemplateId;
  modelUsed: string | null;
  callError: string | null;
  jsonContract: JsonContractResult;
  codeSwitch: CodeSwitchResult;
  quality: { status: CheckStatus; score: QualityScoreLike | null };
  safetyRail: { status: CheckStatus; judgement: SafetyRailJudgement | null };
  mcqOracle: McqOracleResult;
  verdict: 'PASS' | 'REVIEW';
  reasons: string[];
}

const OK_STATUSES: ReadonlySet<CheckStatus> = new Set(['pass', 'skipped-not-applicable']);

/**
 * PASS requires EVERY dimension to be `pass` or legitimately
 * `skipped-not-applicable`. Anything else — fail, not-judged, judge-error,
 * call-error — is REVIEW. Same philosophy as
 * eval/teacher-skills/harness/run-eval.ts's verdictFor / eval/rag's
 * INCONCLUSIVE: a measurement that was never completed is never silently
 * counted as a pass.
 */
export function verdictFor(
  jsonContract: CheckStatus,
  codeSwitch: CheckStatus,
  quality: CheckStatus,
  safetyRail: CheckStatus,
  mcqOracle: CheckStatus,
): 'PASS' | 'REVIEW' {
  return [jsonContract, codeSwitch, quality, safetyRail, mcqOracle].every((s) => OK_STATUSES.has(s)) ? 'PASS' : 'REVIEW';
}

// ─── Aggregate summary (pure) ────────────────────────────────────────────────

export interface AggregateSummary {
  total: number;
  passed: number;
  review: number;
  jsonContract: { evaluated: number; passed: number; parseFailures: number; schemaFailures: number };
  codeSwitch: { evaluated: number; passed: number };
  quality: { evaluated: number; passed: number; averageScore: number | null };
  safetyRail: { evaluated: number; passed: number };
  mcqOracle: { evaluated: number; passed: number };
}

export function aggregateResults(results: SampleResult[]): AggregateSummary {
  const total = results.length;
  const passed = results.filter((r) => r.verdict === 'PASS').length;

  const jsonEvaluated = results.filter((r) => r.jsonContract.status === 'pass' || r.jsonContract.status === 'fail');
  const codeSwitchEvaluated = results.filter((r) => r.codeSwitch.status === 'pass' || r.codeSwitch.status === 'fail');
  const qualityEvaluated = results.filter((r) => r.quality.score !== null);
  const safetyEvaluated = results.filter((r) => r.safetyRail.judgement !== null);
  const mcqOracleEvaluated = results.filter((r) => r.mcqOracle.status === 'pass' || r.mcqOracle.status === 'fail');

  const qualityScores = qualityEvaluated.map((r) => r.quality.score!.overallScore);
  const averageScore =
    qualityScores.length > 0 ? qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length : null;

  return {
    total,
    passed,
    review: total - passed,
    jsonContract: {
      evaluated: jsonEvaluated.length,
      passed: jsonEvaluated.filter((r) => r.jsonContract.status === 'pass').length,
      parseFailures: results.filter((r) => r.jsonContract.failureStage === 'parse').length,
      schemaFailures: results.filter((r) => r.jsonContract.failureStage === 'schema').length,
    },
    codeSwitch: {
      evaluated: codeSwitchEvaluated.length,
      passed: codeSwitchEvaluated.filter((r) => r.codeSwitch.status === 'pass').length,
    },
    quality: {
      evaluated: qualityEvaluated.length,
      passed: results.filter((r) => r.quality.status === 'pass').length,
      averageScore,
    },
    safetyRail: {
      evaluated: safetyEvaluated.length,
      passed: results.filter((r) => r.safetyRail.status === 'pass').length,
    },
    mcqOracle: {
      evaluated: mcqOracleEvaluated.length,
      passed: mcqOracleEvaluated.filter((r) => r.mcqOracle.status === 'pass').length,
    },
  };
}

// ─── Runner ──────────────────────────────────────────────────────────────────

export interface RunDeps {
  samples: EvalSample[];
  callModel: CallModelFn;
  qualityJudge: QualityJudgeFn;
  /** null disables safety-rail judging for this run (e.g. `--judge off`). */
  safetyJudge: SafetyRailJudgeFn | null;
  /**
   * The mcqOracle dimension's LLM-grader seam (Gap 2) — real impl (cli.ts,
   * `--judge on`) is buildQuizMeLlmGrader() from
   * packages/lib/src/foxy/prompt-sections.ts, BYTE-IDENTICAL to what
   * production wires into gateQuizMeMcq/gatePracticeMcqs. `null` (e.g.
   * `--judge off`) runs the oracle's deterministic P6 checks only — zero LLM
   * calls, matching this harness's documented `--judge off` contract.
   */
  mcqLlmGrade: LlmGrader | null;
  /** Minimum scoreFoxyAnswer.overallScore to count the quality dimension as `pass`. */
  qualityPassThreshold: number;
  /** Minimum safety-rail judge score to count the safetyRail dimension as `pass`. */
  safetyPassThreshold: number;
}

export interface EvalRun {
  sampleCount: number;
  results: SampleResult[];
  aggregate: AggregateSummary;
}

/**
 * Evaluate every sample. Pure assembly over injected deps — no file/DB
 * writes (cli.ts persists via its own report writer). A model-call failure
 * short-circuits the remaining checks for that sample (there is no output to
 * check) and is recorded as REVIEW with the call error, never a crash.
 */
export async function runEval(deps: RunDeps): Promise<EvalRun> {
  const results: SampleResult[] = [];

  for (const sample of deps.samples) {
    let modelUsed: string | null = null;
    let callError: string | null = null;
    let rawOutput = '';
    try {
      const res = await deps.callModel({
        systemPrompt: sample.systemPrompt,
        userMessage: sample.userMessage,
        maxTokens: sample.maxTokens,
        temperature: sample.temperature,
      });
      rawOutput = res.content;
      modelUsed = res.model;
    } catch (err) {
      callError = err instanceof Error ? err.message : String(err);
    }

    if (callError !== null) {
      results.push({
        sampleId: sample.id,
        templateId: sample.templateId,
        modelUsed: null,
        callError,
        jsonContract: { status: 'skipped-not-applicable', error: null, checkKind: 'none', failureStage: null, foxyResponse: null },
        codeSwitch: { status: 'skipped-not-applicable', explanation: 'model call failed — not evaluated' },
        quality: { status: 'call-error', score: null },
        safetyRail: { status: 'call-error', judgement: null },
        mcqOracle: skippedMcqOracle('model call failed — not evaluated'),
        verdict: 'REVIEW',
        reasons: [`model call failed: ${callError}`],
      });
      continue;
    }

    const reasons: string[] = [];

    const jsonContract = checkJsonContract(sample.templateId, rawOutput, sample.grade);
    if (jsonContract.status === 'fail') {
      reasons.push(`json_contract[${jsonContract.checkKind}/${jsonContract.failureStage}]: ${jsonContract.error}`);
    }

    const codeSwitch = checkHindiEnglishCodeSwitch(sample.userMessage, rawOutput, sample.expectHindiAnswer);
    if (codeSwitch.status === 'fail') reasons.push(`code_switch: ${codeSwitch.explanation}`);

    let qualityScore: QualityScoreLike | null = null;
    let qualityStatus: CheckStatus;
    try {
      qualityScore = await deps.qualityJudge({
        question: sample.userMessage,
        answer: rawOutput,
        citations: sample.citations,
        grade: sample.grade,
        subject: sample.subject,
        coachMode: sample.coachMode,
      });
      if (qualityScore === null) {
        qualityStatus = 'judge-error';
        reasons.push('quality: judge returned null (couldn\'t score)');
      } else {
        qualityStatus = qualityScore.overallScore >= deps.qualityPassThreshold ? 'pass' : 'fail';
        if (qualityStatus === 'fail') {
          reasons.push(`quality: overallScore ${qualityScore.overallScore} < threshold ${deps.qualityPassThreshold}`);
        }
      }
    } catch (err) {
      qualityStatus = 'judge-error';
      reasons.push(`quality: judge threw — ${err instanceof Error ? err.message : String(err)}`);
    }

    let safetyJudgement: SafetyRailJudgement | null = null;
    let safetyStatus: CheckStatus;
    if (deps.safetyJudge === null) {
      safetyStatus = 'not-judged';
    } else {
      try {
        safetyJudgement = await deps.safetyJudge({ question: sample.userMessage, answer: rawOutput });
        if (safetyJudgement === null) {
          safetyStatus = 'judge-error';
          reasons.push('safety_rail: judge returned null (malformed output)');
        } else {
          safetyStatus =
            safetyJudgement.pass && safetyJudgement.score >= deps.safetyPassThreshold ? 'pass' : 'fail';
          if (safetyStatus === 'fail') reasons.push(`safety_rail: ${safetyJudgement.explanation}`);
        }
      } catch (err) {
        safetyStatus = 'judge-error';
        reasons.push(`safety_rail: judge threw — ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const mcqOracle = await runMcqOracleCheck({
      expectMcqBlocks: sample.expectMcqBlocks,
      jsonContract,
      grade: sample.grade,
      subject: sample.subject,
      llmGrade: deps.mcqLlmGrade,
    });
    if (mcqOracle.status === 'fail') reasons.push(`mcq_oracle: ${mcqOracle.explanation}`);

    results.push({
      sampleId: sample.id,
      templateId: sample.templateId,
      modelUsed,
      callError: null,
      jsonContract,
      codeSwitch,
      quality: { status: qualityStatus, score: qualityScore },
      safetyRail: { status: safetyStatus, judgement: safetyJudgement },
      mcqOracle,
      verdict: verdictFor(jsonContract.status, codeSwitch.status, qualityStatus, safetyStatus, mcqOracle.status),
      reasons,
    });
  }

  return { sampleCount: deps.samples.length, results, aggregate: aggregateResults(results) };
}
