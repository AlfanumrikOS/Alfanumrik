// eval/foxy-everyday/harness/judge.ts
//
// Everyday-example rubric — the OFFLINE quality judge (D1..D5).
//
// Structurally a sibling of eval/rag/harness/relevance-judge.ts: same model id,
// temperature 0, versioned rubric id, strict-JSON output, fenced-code recovery,
// clamping, conservative-fail (never throws — returns a typed outcome), and the
// SAME injectable `complete` seam so this module embeds no AI transport at all.
// The RUBRIC is different (pedagogical style, not retrieval relevance); the
// machinery is deliberately identical so the two judges stay recognisably one
// pattern.
//
// ── Model ────────────────────────────────────────────────────────────────────
// `claude-sonnet-4-5-20250929` — ALREADY REGISTERED
// (packages/lib/src/ai/gateway/registry.ts `ANTHROPIC_SONNET_ID`), already
// priced, and already the model eval/rag/harness/relevance-judge.ts uses. No new
// model, no new provider, so this does NOT trip the CEO model-approval gate. Do
// not swap it for anything else without that approval.
//
// ── Cost discipline ──────────────────────────────────────────────────────────
// The judge is called ONLY for responses that already cleared D0 (detect.ts).
// A response with no example block scores 0 by construction and costs nothing.
// The runner additionally bounds the case count and defaults to --dry-run.
//
// ── P12 / P13 ────────────────────────────────────────────────────────────────
// P12: the judge prompt is a P12 artifact — it encodes CBSE scope, age-
// appropriateness, and the "never fabricate or attribute a curriculum fact"
// rule. Any wording change is an assessment review.
// P13: the judge sees ONLY the case's grade/subject/topic, the (PII-free) prompt
// text, the example text, and a bounded projection of the answer. No identifier
// of any kind is a field on the input, and the case set + capture files are both
// validated against the recursive PII-key ban before they reach here.

import {
  ANCHORS,
  DIMENSIONS,
  RUBRIC_VERSION,
  type Dimension,
  type DimensionScore,
  type DimensionScores,
} from './rubric';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Already-registered Sonnet. See the header — not a new model/provider. */
export const JUDGE_MODEL = 'claude-sonnet-4-5-20250929';

/** Deterministic scores. Same as the B1 relevance judge. */
export const JUDGE_TEMPERATURE = 0;

/** Stamped on every per-case record + the aggregate. Mirrors RUBRIC_VERSION. */
export const JUDGE_RUBRIC_VERSION = RUBRIC_VERSION;

/** Five small integers plus five short reasons — a tight cap is enough. */
const MAX_TOKENS = 700;

/** Context caps (defense-in-depth; the runner already bounds these). */
const MAX_PROMPT_CHARS = 600;
const MAX_EXAMPLE_CHARS = 1500;
const MAX_ANSWER_CHARS = 3000;

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Judge input. Everything the anchors need to be applied and nothing else.
 * There is deliberately no identifier field of any kind (P13).
 */
export interface EverydayJudgeInput {
  /** P5 grade string, e.g. "8". */
  grade: string;
  /** Canonical subject code, e.g. "science". */
  subject: string;
  /** Curriculum topic, for scope checking. */
  topic: string;
  /** learn | explain | doubt. */
  turnType: string;
  /** The student's turn (already PII-free by fixture validation). */
  prompt: string;
  /** The `example` block text(s) D0 found. Joined for the judge. */
  exampleTexts: string[];
  /** Bounded projection of the rest of the answer (detect.extractAnswerContext). */
  answerContext: string;
}

/** The parsed, clamped judgement. */
export interface EverydayJudgeResult {
  scores: DimensionScores;
  /** One short sentence per dimension. Empty string when the model omitted it. */
  reasons: Record<Dimension, string>;
}

/** Never-throws outcome. A failed judgement is a typed failure, not a fake score. */
export type EverydayJudgeOutcome =
  | { ok: true; value: EverydayJudgeResult }
  | { ok: false; error: string };

/** Args handed to the injected completion function. */
export interface JudgeCompletionArgs {
  model: string;
  system: string;
  user: string;
  temperature: number;
  maxTokens: number;
}

/**
 * The injectable LLM seam — REQUIRED, exactly as in relevance-judge.ts. This
 * module holds no HTTP client, no endpoint URL and no SDK import, so it is clean
 * against the repo's AI-boundary rules and every unit test can drive it with a
 * fake that makes no network call.
 */
export type JudgeCompletionFn = (args: JudgeCompletionArgs) => Promise<string>;

export interface JudgeOptions {
  complete: JudgeCompletionFn;
  /**
   * Retry a transport/parse failure once. Justification: at temperature 0 the
   * judgement is deterministic, so a retry can only recover a TRANSPORT or
   * truncation blip — it can never "roll again for a better score". One retry,
   * not three: a case that fails twice is a real failure and must surface as
   * INCONCLUSIVE rather than be ground down by repetition.
   */
  retryOnce?: boolean;
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

/** Clamp a model-emitted score into {0,1,2}; null for non-numeric input. */
export function clampScore(v: unknown): DimensionScore | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const clamped = Math.max(0, Math.min(2, Math.round(v)));
  return clamped as DimensionScore;
}

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
 * Parse + validate the judge's raw response. Conservative-fail: returns null
 * (never throws) when the payload is not JSON or when ANY of the five dimensions
 * is missing or non-numeric. A partially-scored judgement is rejected outright
 * rather than defaulted — defaulting a missing dimension to 0 would invent a
 * failure, and defaulting it to 2 would invent a pass.
 */
export function parseJudgeJson(raw: string): EverydayJudgeResult | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const r = parsed as Record<string, unknown>;

  const rawScores = (r.scores ?? r) as Record<string, unknown>;
  const rawReasons = (r.reasons ?? {}) as Record<string, unknown>;

  const scores = {} as DimensionScores;
  const reasons = {} as Record<Dimension, string>;

  for (const d of DIMENSIONS) {
    const s = clampScore(rawScores[d]);
    if (s === null) return null; // every dimension is REQUIRED
    scores[d] = s;
    const reason = rawReasons[d];
    reasons[d] = typeof reason === 'string' ? reason.slice(0, 400) : '';
  }

  return { scores, reasons };
}

/**
 * Build the judge SYSTEM prompt. The anchor text is injected VERBATIM from
 * rubric.ts's ANCHORS, so the documented rubric and the judged rubric are the
 * same bytes and cannot drift. P12 artifact — assessment reviews any change.
 */
export function buildJudgeSystemPrompt(): string {
  const anchorLines: string[] = [];
  for (const d of DIMENSIONS) {
    const a = ANCHORS[d];
    anchorLines.push(`## ${d} — ${a.label}`);
    anchorLines.push(`  2 = ${a.a2}`);
    anchorLines.push(`  1 = ${a.a1}`);
    anchorLines.push(`  0 = ${a.a0}`);
    anchorLines.push('');
  }

  return [
    'You are an assessment judge for an Indian CBSE (Classes 6-12) AI tutor.',
    '',
    'The tutor has been instructed to include at least one "example" block in',
    'explanation-style answers, and that the example must be CONCRETE and grounded',
    'in EVERYDAY INDIAN LIFE (home and school routines, cooking, local shops,',
    'buses/trains/autos, festivals, cricket, the monsoon), pitched at the student\'s',
    'class, and ILLUSTRATIVE ONLY — every factual claim must still come from the',
    'NCERT reference material, and the example must never be attributed to NCERT.',
    '',
    'You will be given the student\'s question, the class and subject, the EXAMPLE',
    'text the tutor produced, and the rest of the tutor\'s answer for context.',
    'Score the EXAMPLE on five dimensions. Each is 0, 1 or 2. Use these anchors',
    'exactly — do not invent intermediate values, and do not let a strong score on',
    'one dimension pull another one up:',
    '',
    ...anchorLines,
    'Rules:',
    '- Judge the EXAMPLE, not the whole answer. The answer is context only —',
    '  except for `factually_safe` and `relevant`, where you must check the example',
    '  against what the answer actually says.',
    '- If several example blocks are present, judge the BEST one.',
    '- Judge strictly within the CBSE curriculum scope for the stated class and',
    '  subject. Do not reward an example that is impressive but out of scope.',
    '- Do not reward length. A two-sentence example that is specific and Indian',
    '  scores 2 on the first two dimensions; a long vague paragraph does not.',
    '- Be willing to give 0. A rubric where nothing scores 0 measures nothing.',
    '',
    'Output ONLY a JSON object with exactly this shape — no prose, no markdown',
    'fences, no commentary:',
    '',
    '  {',
    '    "scores": {',
    ...DIMENSIONS.map((d, i) => `      "${d}": 0 | 1 | 2${i === DIMENSIONS.length - 1 ? '' : ','}`),
    '    },',
    '    "reasons": {',
    ...DIMENSIONS.map((d, i) => `      "${d}": "<one short sentence>"${i === DIMENSIONS.length - 1 ? '' : ','}`),
    '    }',
    '  }',
  ].join('\n');
}

/** Build the judge USER message. Every field is length-capped. */
export function buildJudgeUserMessage(input: EverydayJudgeInput): string {
  const example = input.exampleTexts.join('\n---\n').slice(0, MAX_EXAMPLE_CHARS);
  return [
    `Class: ${input.grade}`,
    `Subject: ${input.subject}`,
    `Topic: ${input.topic}`,
    `Turn type: ${input.turnType}`,
    '',
    '=== STUDENT_QUESTION ===',
    (input.prompt ?? '').slice(0, MAX_PROMPT_CHARS),
    '',
    '=== EXAMPLE_BLOCK(S) TO JUDGE ===',
    example,
    '',
    '=== REST OF THE ANSWER (context for factually_safe + relevant) ===',
    (input.answerContext ?? '').slice(0, MAX_ANSWER_CHARS),
  ].join('\n');
}

// ─── Public entry point ──────────────────────────────────────────────────────

/**
 * Judge one example. NEVER throws: transport errors and malformed model output
 * both return `{ ok: false, error }`, which the runner turns into an UNJUDGED
 * case — and an unjudged case makes the run INCONCLUSIVE. It never becomes a
 * silent zero.
 */
export async function judgeEverydayExample(
  input: EverydayJudgeInput,
  opts: JudgeOptions,
): Promise<EverydayJudgeOutcome> {
  const { complete, retryOnce = true } = opts;
  const system = buildJudgeSystemPrompt();
  const user = buildJudgeUserMessage(input);

  const attempt = async (): Promise<EverydayJudgeOutcome> => {
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
      return {
        ok: false,
        error: `everyday-judge completion failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    const parsed = parseJudgeJson(raw);
    if (!parsed) {
      return {
        ok: false,
        error: 'everyday-judge: could not parse a complete five-dimension score from the response',
      };
    }
    return { ok: true, value: parsed };
  };

  const first = await attempt();
  if (first.ok || !retryOnce) return first;
  return attempt();
}
