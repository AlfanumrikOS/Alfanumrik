// eval/rag/harness/relevance-judge.ts
//
// B1 retrieval-quality eval harness — Task 3: the OFFLINE retrieval-relevance
// judge. Given (query, grade, subject, a candidate NCERT chunk's text) it
// returns a graded relevance label `{ relevance: 0|1|2, off_grade_scope,
// reason }` (spec §B1.3, A2).
//
// ── OFFLINE-ONLY (spec Q5) ────────────────────────────────────────────────
// This judge runs ONLY at golden-set build / refresh time (Task 9). It is
// NEVER on the student-facing path and is NEVER imported by production /
// client code (`src/app/**`) — enforced by the Task 8 import-boundary test.
// Because it is offline build-time tooling, the Sonnet model choice is NOT a
// production model-provider change and does NOT trip the CEO model-approval
// gate (spec Q5). The judge *prompt* IS a P12 artifact — any change to the
// prompt wording requires assessment review (curriculum-scope + age-
// appropriateness + off_grade_scope semantics).
//
// ── Machinery patterned on `src/lib/foxy/quality-eval.ts` ─────────────────
// Sonnet (`claude-sonnet-4-20250514`), temperature 0, strict-JSON output,
// fenced-code recovery parse, clamp, conservative-fail (never throw raw —
// return a typed result). The RUBRIC is retrieval-specific (relevance 2/1/0 +
// off_grade_scope), NOT the answer-quality rubric — we reuse the pattern, not
// the rubric.
//
// ── LLM injection (testability + "no real call" guarantee) ────────────────
// `judgeRelevance(input, { complete })` takes a REQUIRED injectable `complete`
// function — the LLM transport seam. This offline tooling module deliberately
// does NOT embed a production Anthropic HTTP client: per the grounded-answer
// AI-boundary invariant (no-direct-ai-calls), the only code allowed to hit
// upstream AI providers is the grounded-answer service. The Task 9 golden-set
// seeding caller supplies the transport (an allowed Anthropic client) when it
// runs the judge at build time. Every unit test injects a FAKE `complete`, so
// no real API traffic ever leaves the test process — the seam IS the function
// argument; there is no global fetch stub and no embedded endpoint URL.
//
// ── Safety ────────────────────────────────────────────────────────────────
// P12: prompt is CBSE/NCERT-scoped, grade-G/subject-S-scoped, penalizes off-
//      syllabus chunks, age-appropriate by construction (it reads only NCERT
//      corpus text + a scrubbed query). P13: the judge receives ONLY the
//      (already-scrubbed) query text + the corpus chunk text — never a student
//      identifier. Callers (Task 4 trace-mining + Task 9 seeding) are
//      responsible for scrubbing the query BEFORE it reaches this module.

import type { Grade, Relevance, SubjectCode } from './golden-schema';

// ─── Constants ────────────────────────────────────────────────────────────

/**
 * Sonnet for the relevance judge. Latency does not matter (offline, golden-set
 * build time only — spec Q5); rubric fidelity does. Pinned to the same model
 * id `quality-eval.ts` uses so the two judges stay version-consistent.
 */
export const JUDGE_MODEL = 'claude-sonnet-4-20250514';

/** Deterministic relevance labels — temp 0 (machinery parity with quality-eval). */
export const JUDGE_TEMPERATURE = 0;

/** Versioned rubric tag stamped on the golden fixture's `judge.rubric_version`. */
export const JUDGE_RUBRIC_VERSION = 'rag-relevance-v1';

/**
 * Hard token cap on the judge response — the rubric output is a tiny JSON
 * object, so a tight cap saves cost without truncating real output.
 */
const MAX_TOKENS = 400;

/** Bound the chunk text fed to the judge so a long chunk cannot blow context. */
const MAX_CHUNK_CHARS = 2000;

/** Bound the query preview fed to the judge (defense-in-depth context cap). */
const MAX_QUERY_CHARS = 600;

// ─── Public types ─────────────────────────────────────────────────────────

/**
 * Judge input. `query` is the already-scrubbed query text; `chunkText` is the
 * candidate `rag_content_chunks.chunk_text`. NO student identifier is ever a
 * field here (P13) — the caller scrubs upstream.
 */
export interface RelevanceJudgeInput {
  query: string;
  grade: Grade;
  subject: SubjectCode;
  chunkText: string;
}

/**
 * The parsed, clamped relevance label. `relevance` consumes the §B1.3 scale;
 * `off_grade_scope` (A2) is recorded INDEPENDENTLY of relevance so "wrong grade
 * band" is not conflated with "topically irrelevant".
 */
export interface RelevanceJudgeResult {
  relevance: Relevance;
  off_grade_scope: boolean;
  reason: string;
}

/**
 * Discriminated result — `judgeRelevance` NEVER throws and NEVER returns fake
 * values. On any parse/transport failure it returns `{ ok: false, error }` so
 * the caller decides whether to retry, skip, or escalate to human labeling.
 */
export type RelevanceJudgeOutcome =
  | { ok: true; value: RelevanceJudgeResult; raw: unknown }
  | { ok: false; error: string };

/** The arguments the judge hands to the injected completion function. */
export interface JudgeCompletionArgs {
  model: string;
  system: string;
  user: string;
  temperature: number;
  maxTokens: number;
}

/**
 * The injectable LLM seam. Returns the model's raw text (the JSON the judge
 * then parses). The caller supplies the transport — at build time an allowed
 * Anthropic client (via the grounded-answer service); in tests a fake. This
 * module embeds NO production AI transport (AI-boundary invariant).
 */
export type JudgeCompletionFn = (args: JudgeCompletionArgs) => Promise<string>;

export interface JudgeRelevanceOptions {
  /**
   * REQUIRED LLM transport. Build-time seeding passes an allowed Anthropic
   * client; tests pass a fake. There is no default — this offline module never
   * holds a production AI HTTP client.
   */
  complete: JudgeCompletionFn;
}

// ─── Pure helpers (exported for unit tests) ─────────────────────────────────

/**
 * Clamp a model-emitted relevance into the {0,1,2} scale. Rounds a fractional
 * value first, then clamps. Returns `null` for non-numeric / non-finite input
 * so the parser can reject rather than fabricate a label.
 */
export function clampRelevance(v: unknown): Relevance | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const rounded = Math.round(v);
  const clamped = Math.max(0, Math.min(2, rounded));
  return clamped as Relevance;
}

/**
 * Strip a leading/trailing markdown code fence (```json … ``` or bare ```).
 * Sonnet occasionally fences despite being told not to — same recovery the
 * `quality-eval.ts` / FoxyResponse parsers use.
 */
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
 * Parse + validate the judge's raw response into a typed label. Conservative-
 * fail: returns `null` (NEVER throws) on any malformed / non-JSON / missing-
 * relevance output. `off_grade_scope` defaults to `false` when absent or non-
 * boolean (A2). `reason` defaults to '' when absent. `relevance` is clamped to
 * {0,1,2}; a non-numeric relevance is rejected (null).
 */
export function parseJudgeJson(raw: string): RelevanceJudgeResult | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;

  const stripped = stripFences(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const r = parsed as Record<string, unknown>;

  const relevance = clampRelevance(r.relevance);
  if (relevance === null) return null; // relevance is required + must be numeric

  // A2: off_grade_scope is INDEPENDENT of relevance; absent / non-boolean → false.
  const off_grade_scope = r.off_grade_scope === true;

  const reason =
    typeof r.reason === 'string' && r.reason.length > 0 ? r.reason.slice(0, 1000) : '';

  return { relevance, off_grade_scope, reason };
}

/**
 * Build the judge SYSTEM prompt. This is a P12 artifact — assessment reviews
 * its wording on any change (CBSE/NCERT curriculum scope, age-appropriateness,
 * off-syllabus penalization, off_grade_scope independence). Kept as a single
 * clearly-marked exported constant builder so the review surface is one place.
 */
export function buildJudgeSystemPrompt(): string {
  return [
    'You are a relevance judge for an Indian CBSE (grades 6-12) NCERT retrieval',
    'system. You will be given a STUDENT_QUERY (asked by a Class-G student in',
    'subject S) and a single CANDIDATE_CHUNK drawn from the NCERT corpus. Rate',
    'how relevant the chunk is for answering THAT query, on this scale:',
    '',
    '  2 = directly answers / is the primary source for the query',
    '  1 = partially relevant / useful context but not the primary source',
    '  0 = not relevant to the query',
    '',
    'Separately, set off_grade_scope = true if the chunk is topically about the',
    "query's subject but is OUT of scope for grade G (e.g. a Class-11",
    'derivation served to a Class-8 query), and false otherwise. off_grade_scope',
    'is INDEPENDENT of relevance: a chunk can be relevance=2 but',
    'off_grade_scope=true (right topic, wrong grade band) — flag it separately',
    'rather than silently scoring it 0. Penalize chunks that drift OUTSIDE the',
    'CBSE syllabus for the stated subject and grade; an off-syllabus tangent is',
    'not a relevant chunk.',
    '',
    'Judge relevance strictly within the CBSE grade-G subject-S curriculum',
    'scope. Keep your reasoning age-appropriate for a grade 6-12 student. You',
    'see ONLY the query text and the NCERT chunk text — judge those alone.',
    '',
    'Output ONLY a JSON object with exactly this shape — no prose, no markdown',
    'fences, no commentary:',
    '',
    '  {',
    '    "relevance": 0 | 1 | 2,',
    '    "off_grade_scope": true | false,',
    '    "reason": "<one short sentence>"',
    '  }',
  ].join('\n');
}

/**
 * Build the judge USER message. Carries the grade + subject (so the judge can
 * apply grade/subject scope) plus ONLY the scrubbed query text and the
 * candidate chunk text (P13 — no student identifier). Both texts are length-
 * capped to bound the judge context.
 */
export function buildJudgeUserMessage(input: RelevanceJudgeInput): string {
  const query = (input.query ?? '').slice(0, MAX_QUERY_CHARS);
  const chunk = (input.chunkText ?? '').slice(0, MAX_CHUNK_CHARS);
  return [
    `Grade: ${input.grade}`,
    `Subject: ${input.subject}`,
    '',
    '=== STUDENT_QUERY ===',
    query,
    '',
    '=== CANDIDATE_CHUNK (NCERT) ===',
    chunk,
  ].join('\n');
}

// ─── Public entry point ─────────────────────────────────────────────────────

/**
 * Judge a single (query, grade, subject, chunk) tuple. Calls the injected
 * completion fn, parses the strict-JSON response, clamps + defaults, and
 * returns a typed outcome. NEVER throws — transport errors and malformed model
 * output all become `{ ok: false, error }`.
 *
 * This offline module embeds NO production AI transport (AI-boundary
 * invariant `no-direct-ai-calls`): the caller MUST supply `complete`. At
 * golden-set build time the Task 9 seeding caller passes an allowed Anthropic
 * client (routed via the grounded-answer service); unit tests pass a fake.
 */
export async function judgeRelevance(
  input: RelevanceJudgeInput,
  opts: JudgeRelevanceOptions,
): Promise<RelevanceJudgeOutcome> {
  const { complete } = opts;

  const system = buildJudgeSystemPrompt();
  const user = buildJudgeUserMessage(input);

  let raw: string;
  try {
    raw = await complete({
      model: JUDGE_MODEL,
      system,
      user,
      temperature: JUDGE_TEMPERATURE,
      maxTokens: MAX_TOKENS,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `relevance-judge completion failed: ${message}` };
  }

  const parsed = parseJudgeJson(raw);
  if (!parsed) {
    return {
      ok: false,
      error: 'relevance-judge: could not parse a valid relevance label from the model response',
    };
  }

  return { ok: true, value: parsed, raw: parsed };
}
