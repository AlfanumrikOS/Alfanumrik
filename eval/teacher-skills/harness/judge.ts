// eval/teacher-skills/harness/judge.ts
//
// Teacher-skills eval harness — the LLM-as-judge for rubric criteria that are
// NOT mechanically checkable (those are decided by deterministic-checks.ts,
// which runs FIRST — REG-54 oracle pattern; a criterion never reaches this
// module if it has a deterministic check).
//
// ── System prompt provenance ─────────────────────────────────────────────────
// `buildJudgeSystemPrompt()` is ADAPTED from the LLM-as-judge prompt published
// in evals/README.md (lines 46-66) of the Apache-2.0 "Agent Skills for K-12
// Teachers" repo (https://github.com/anthropics/k12-teacher-skills, commit
// 7c03c83 — Copyright 2026 Anthropic, PBC; Copyright 2026 Learning Commons;
// see ../vendor/LICENSE + ../vendor/NOTICE). Adaptations: Alfanumrik/CBSE
// grades 6-12 context, artifact-as-JSON instead of attached files, and an
// explicit synthetic-fixture note. The judge prompt is a P12 artifact — any
// wording change requires assessment review.
//
// ── Transport: callClaude ONLY, via an injected seam ─────────────────────────
// This module embeds NO AI transport. `judgeArtifact(input, { complete })`
// takes a REQUIRED injectable completion fn (the same seam design as
// eval/rag/harness/relevance-judge.ts) so every unit test injects a FAKE and
// no API traffic ever leaves the test process. The ONLY real transport is
// `makeCallClaudeCompletion(callClaude)` — an adapter over the house retry
// helper `callClaude` from `@alfanumrik/lib/ai`
// (packages/lib/src/ai/clients/claude.ts: model fallback chain, bounded
// exponential backoff, circuit breaker). The CLI dynamic-imports callClaude
// and wires it here; NOTHING in this harness ever calls the Anthropic SDK or
// api.anthropic.com directly. NO `model` is ever passed — the judge uses
// whatever default chain callClaude is configured with (model changes need
// user approval and are out of this harness's hands).
//
// ── Output contract ──────────────────────────────────────────────────────────
// Strict JSON array, per upstream: [{"id": "...", "pass": true|false,
// "explanation": "one sentence"}, ...]. Parsing is conservative-fail: fenced-
// code recovery, then strict validation; ANY malformed output → `null` from
// the parser → the caller marks the affected criteria `judge-error` and the
// artifact verdict becomes REVIEW. Never a crash, never a fabricated pass.
//
// Offline dev/CI tooling only — NEVER imported by production / client code.

import type { RubricCriterion } from './rubric-schema';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Deterministic judging — temp 0 (well under the 0.7 factual ceiling, P12). */
export const JUDGE_TEMPERATURE = 0;

/** Versioned judge-prompt tag stamped into every report. */
export const JUDGE_RUBRIC_VERSION = 'teacher-skills-judge-v1';

/**
 * Response cap: one JSON object (~40 output tokens) per criterion, plus array
 * overhead. The largest rubric (ncert-lesson-planning) has ~35 criteria.
 */
export const JUDGE_MAX_TOKENS = 4000;

/** Bound the artifact JSON fed to the judge so a huge fixture can't blow context. */
export const MAX_ARTIFACT_CHARS = 40_000;

/** Bound the optional chat-response text. */
export const MAX_CHAT_RESPONSE_CHARS = 8_000;

// ─── Types ───────────────────────────────────────────────────────────────────

/** The subset of a rubric criterion the judge needs. */
export type JudgeCriterion = Pick<RubricCriterion, 'id' | 'bucket' | 'criterion' | 'passRequires'>;

export interface JudgeInput {
  /** The artifact under evaluation, already serialized to JSON. */
  artifactJson: string;
  /** The model's final chat response, when the fixture carries one (M bucket). */
  chatResponse: string | null;
  /** The criteria to judge (deterministically-decided ones are NOT included). */
  criteria: JudgeCriterion[];
  /** Context line, e.g. `rubric "quiz-generation"`. */
  rubricName: string;
}

/** One per-criterion judgement, exactly the upstream element shape. */
export interface CriterionJudgement {
  id: string;
  pass: boolean;
  explanation: string;
}

export type JudgeOutcome =
  | { ok: true; judgements: CriterionJudgement[] }
  | { ok: false; error: string };

/** The arguments handed to the injected completion fn. NO model field — the
 *  real transport (callClaude) applies its own configured default chain. */
export interface JudgeCompletionArgs {
  system: string;
  user: string;
  temperature: number;
  maxTokens: number;
}

/** The injectable LLM seam. Returns the model's raw text. */
export type JudgeCompletionFn = (args: JudgeCompletionArgs) => Promise<string>;

export interface JudgeOptions {
  /** REQUIRED transport. CLI wires makeCallClaudeCompletion(callClaude); tests inject fakes. */
  complete: JudgeCompletionFn;
}

// ─── callClaude adapter ──────────────────────────────────────────────────────

/**
 * The minimal structural surface of `callClaude` from `@alfanumrik/lib/ai`
 * this adapter needs (kept structural so tests can pass a fake without
 * importing the lib, and so this module never statically imports it).
 */
export type CallClaudeLike = (options: {
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  maxTokens?: number;
  temperature?: number;
}) => Promise<{ content: string }>;

/**
 * Adapt the house `callClaude` retry helper into the judge's completion seam.
 * Deliberately passes NO `model` — callClaude's configured default chain
 * (primary → fallback, with retry/backoff + circuit breaker) applies.
 */
export function makeCallClaudeCompletion(callClaudeFn: CallClaudeLike): JudgeCompletionFn {
  return async ({ system, user, temperature, maxTokens }) => {
    const res = await callClaudeFn({
      systemPrompt: system,
      messages: [{ role: 'user', content: user }],
      temperature,
      maxTokens,
    });
    return res.content;
  };
}

// ─── Prompt builders ─────────────────────────────────────────────────────────

/**
 * Judge SYSTEM prompt — adapted from the upstream evals/README.md judge prompt
 * (see header). P12 artifact: assessment reviews any wording change.
 */
export function buildJudgeSystemPrompt(): string {
  return [
    'You are a rigorous educational content evaluator for Alfanumrik, an Indian',
    'CBSE (grades 6-12) learning platform grounded in NCERT content. Your job is',
    'to assess whether AI-generated educational artifacts meet specific rubric',
    'criteria.',
    '',
    'You will receive:',
    '  1. The artifact under evaluation, as a JSON document.',
    "  2. Optionally, the model's final chat response (the text it sent back to",
    '     the user).',
    '  3. A rubric with criteria to judge against.',
    '',
    'The artifact is a SYNTHETIC evaluation fixture: it contains no real student',
    'data, and any names in it (e.g. "Student A") are placeholders.',
    '',
    'Grading rules:',
    '  - Judge criteria in the `M` (Model Scaffolding) bucket against the chat',
    '    response. Judge all other criteria against the artifact JSON — the',
    '    content must actually be present in the artifact, not merely claimed in',
    '    the chat response.',
    '  - Pass means the criterion is clearly and fully met. Fail means it is',
    '    absent, incomplete, or only partially met.',
    '  - Judge strictly within the CBSE grade/subject scope the artifact states.',
    '',
    'Respond ONLY with a valid JSON array — no preamble, no markdown fences, no',
    'trailing text. Each element: {"id": "...", "pass": true|false,',
    '"explanation": "one sentence"}. Include exactly one element per criterion',
    'given, using its exact id.',
  ].join('\n');
}

/** Judge USER message: rubric criteria + the (length-capped) artifact JSON. */
export function buildJudgeUserMessage(input: JudgeInput): string {
  const artifact = input.artifactJson.slice(0, MAX_ARTIFACT_CHARS);
  const criteriaLines = input.criteria.map(
    (c) => `- id: ${c.id} | bucket: ${c.bucket} | ${c.criterion}\n  Pass requires: ${c.passRequires}`,
  );
  const parts = [
    `Rubric: ${input.rubricName}`,
    '',
    '=== CRITERIA ===',
    ...criteriaLines,
    '',
    '=== ARTIFACT (JSON) ===',
    artifact,
  ];
  if (input.chatResponse !== null && input.chatResponse.length > 0) {
    parts.push('', '=== FINAL CHAT RESPONSE ===', input.chatResponse.slice(0, MAX_CHAT_RESPONSE_CHARS));
  }
  return parts.join('\n');
}

// ─── Response parsing (conservative-fail) ────────────────────────────────────

/** Strip a leading/trailing markdown code fence (same recovery as the house parsers). */
function stripFences(s: string): string {
  let out = s.trim();
  if (out.startsWith('```')) {
    out = out.replace(/^```(?:json|javascript|js)?\s*/i, '');
    out = out.replace(/```\s*$/i, '');
    out = out.trim();
  }
  return out;
}

/**
 * Parse the judge's raw response into typed judgements. Returns `null` on ANY
 * malformed output (non-JSON, non-array, element without a string id or
 * boolean pass, or an id not in `expectedIds`) — the caller maps `null` to
 * per-criterion `judge-error` → artifact verdict REVIEW. Never throws, never
 * fabricates a pass. Elements for expected ids are collected; a duplicate id
 * keeps the FIRST occurrence; missing ids are simply absent from the result
 * (the caller marks them judge-error individually).
 */
export function parseJudgeArray(
  raw: string,
  expectedIds: readonly string[],
): CriterionJudgement[] | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const expected = new Set(expectedIds);
  const seen = new Set<string>();
  const judgements: CriterionJudgement[] = [];

  for (const el of parsed) {
    if (typeof el !== 'object' || el === null || Array.isArray(el)) return null;
    const rec = el as Record<string, unknown>;
    if (typeof rec.id !== 'string' || typeof rec.pass !== 'boolean') return null;
    if (!expected.has(rec.id)) return null; // hallucinated id → distrust the whole output
    if (seen.has(rec.id)) continue; // duplicate → keep first
    seen.add(rec.id);
    judgements.push({
      id: rec.id,
      pass: rec.pass,
      explanation:
        typeof rec.explanation === 'string' ? rec.explanation.slice(0, 1000) : '',
    });
  }
  return judgements;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

/**
 * Judge one artifact against the given (non-deterministic) criteria in a
 * single completion call. NEVER throws — transport errors and malformed model
 * output become `{ ok: false, error }` (→ REVIEW downstream, not a crash).
 */
export async function judgeArtifact(
  input: JudgeInput,
  opts: JudgeOptions,
): Promise<JudgeOutcome> {
  if (input.criteria.length === 0) return { ok: true, judgements: [] };

  const system = buildJudgeSystemPrompt();
  const user = buildJudgeUserMessage(input);

  let raw: string;
  try {
    raw = await opts.complete({
      system,
      user,
      temperature: JUDGE_TEMPERATURE,
      maxTokens: JUDGE_MAX_TOKENS,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `judge completion failed: ${message}` };
  }

  const judgements = parseJudgeArray(raw, input.criteria.map((c) => c.id));
  if (judgements === null) {
    return {
      ok: false,
      error: 'judge output was not a valid per-criterion JSON array (malformed / hallucinated ids)',
    };
  }
  return { ok: true, judgements };
}
