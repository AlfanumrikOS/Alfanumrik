/**
 * B'-1 Phase 1: LLM-as-judge scoring for Foxy assistant turns.
 *
 * Pure library — server-side only. Pairs with migration
 * 20260508240000_foxy_quality_scores.sql. A future nightly cron (Phase 2)
 * will sample N assistant messages/day, call `scoreFoxyAnswer()` for each,
 * and INSERT the result into `foxy_quality_scores`.
 *
 * The scoring rubric is 4 dimensions × 0..100:
 *   - accuracy:           does the answer agree with the cited NCERT chunks?
 *   - scaffoldFidelity:   did the model follow the coach-mode directive?
 *                         (rubric v2: ALSO scores math-format house style —
 *                         multi-term math in display/math blocks not prose,
 *                         inline math properly \( ... \)-delimited, worked
 *                         examples as numbered short steps. These checks only
 *                         apply when the answer contains mathematics.)
 *   - ageAppropriateness: suitable for grades 6-12?
 *   - cbseScope:          stays inside the CBSE curriculum boundary?
 *
 * Composite (default weights):
 *   0.40 * accuracy + 0.30 * scaffoldFidelity + 0.20 * ageAppropriateness
 *   + 0.10 * cbseScope
 *
 * The judge model is Sonnet (NOT Haiku) — Haiku is used in production for
 * student-facing turns (latency-optimised); Sonnet has higher rubric
 * fidelity and we run the judge nightly so latency doesn't matter.
 *
 * Pure & deterministic relative to inputs (modulo the model's stochasticity
 * which we cap with temperature=0). Caller is responsible for fan-out,
 * rate-limiting, and persistence — this file just produces the score for a
 * single (question, answer, citations) tuple.
 */

// Calls the Anthropic API directly via fetch — same pattern the production
// Edge Function uses (supabase/functions/grounded-answer/claude.ts). No new
// SDK dependency, predictable behaviour, and the response shape is small
// enough to type inline.

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

interface AnthropicMessageResponse {
  content: Array<{ type: string; text?: string }>;
  // Other fields (id, model, usage, ...) ignored — we only read the text block.
}

// ─── Public types ───────────────────────────────────────────────────────────

export interface QualityScoreInput {
  /** The student's question / prompt to Foxy. */
  question: string;
  /** Foxy's full answer text (denormalized from FoxyResponse if structured). */
  answer: string;
  /**
   * Citations Foxy was supposed to ground on. Score the answer's *agreement*
   * with these chunks (not the chunks themselves) — that's accuracy. Pass
   * an empty array when the turn was an abstain, in which case accuracy is
   * scored on whether the abstain message was honest about the uncertainty.
   */
  citations: Array<{
    chunk_text: string;
    chapter_title?: string | null;
    page_number?: number | null;
  }>;
  /**
   * The student's grade ('6'..'12') and subject — used so the judge can
   * apply grade-appropriate language and CBSE-scope thresholds. P5: grade
   * is a string, never a number.
   */
  grade: string;
  subject: string;
  /**
   * Coach mode the answer was supposed to follow ('socratic' | 'answer' |
   * 'review'). Used by the scaffold-fidelity dimension. NULL on legacy
   * messages where coach_mode_used wasn't recorded — the dimension then
   * falls back to a "did the answer use *any* recognisable scaffolding
   * shape" check.
   */
  coachMode: 'socratic' | 'answer' | 'review' | null;
}

export interface QualityScoreOutput {
  accuracyScore: number;            // 0..100
  scaffoldFidelityScore: number;    // 0..100
  ageAppropriatenessScore: number;  // 0..100
  cbseScopeScore: number;           // 0..100
  overallScore: number;             // 0..100, weighted blend
  judgeModel: string;
  rubricVersion: string;
  rawJudgeResponse: unknown;        // for spot-check via super-admin
  notes: string | null;             // judge's free-text on the lowest dimension
}

// ─── Constants ──────────────────────────────────────────────────────────────

// v1 → v2 (2026-07-16, Foxy math-format Wave B): scaffold_fidelity now also
// scores the math-format house style (see buildJudgeSystemPrompt). The 4-key
// JSON contract, composite weights, and DB columns are UNCHANGED — only the
// judge prompt criteria changed, so the version bump keeps historical v1
// scores filterable and re-opens recent messages for v2 scoring (the cron's
// anti-join is per rubric_version; UNIQUE(message_id, rubric_version) keeps
// runs idempotent).
export const RUBRIC_VERSION = 'v2';

// Sonnet for the judge. Latency doesn't matter (nightly cron); rubric
// fidelity does. Pinned to the same model id used elsewhere in the codebase
// (supabase/functions/grounded-answer/claude.ts:21) so behaviour stays
// consistent. Bump alongside that file when migrating.
export const JUDGE_MODEL = 'claude-sonnet-4-20250514';

const COMPOSITE_WEIGHTS = {
  accuracy: 0.40,
  scaffoldFidelity: 0.30,
  ageAppropriateness: 0.20,
  cbseScope: 0.10,
} as const;

// Hard token cap on the judge response — the rubric is small, so a tight
// cap saves cost without truncating real output.
const MAX_TOKENS = 800;

// ─── Public entry point ─────────────────────────────────────────────────────

/**
 * Score a single Foxy assistant turn. Calls the Claude API. Never throws on
 * judge failure — returns null so the caller can decide whether to retry,
 * skip, or persist a "couldn't score" sentinel. Throws only on programmer
 * error (missing API key) so misconfiguration is loud.
 */
export async function scoreFoxyAnswer(
  input: QualityScoreInput,
  apiKey: string,
): Promise<QualityScoreOutput | null> {
  if (!apiKey) {
    throw new Error(
      'scoreFoxyAnswer: ANTHROPIC_API_KEY is required. Pass via opts; do not let undefined keys reach the SDK.',
    );
  }

  const systemPrompt = buildJudgeSystemPrompt();
  const userMessage = buildJudgeUserMessage(input);

  let body: AnthropicMessageResponse | null = null;
  try {
    const res = await fetch(ANTHROPIC_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: JUDGE_MODEL,
        max_tokens: MAX_TOKENS,
        temperature: 0,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });
    if (!res.ok) return null;
    body = (await res.json()) as AnthropicMessageResponse;
  } catch {
    return null;
  }

  const textBlock = body?.content?.find((b) => b.type === 'text' && typeof b.text === 'string');
  if (!textBlock?.text) return null;

  const parsed = parseJudgeJson(textBlock.text);
  if (!parsed) return null;

  const overallScore = computeOverallScore(parsed);

  return {
    accuracyScore: parsed.accuracy,
    scaffoldFidelityScore: parsed.scaffold_fidelity,
    ageAppropriatenessScore: parsed.age_appropriateness,
    cbseScopeScore: parsed.cbse_scope,
    overallScore,
    judgeModel: JUDGE_MODEL,
    rubricVersion: RUBRIC_VERSION,
    rawJudgeResponse: parsed,
    notes: parsed.notes ?? null,
  };
}

// ─── Pure helpers (exported for tests) ──────────────────────────────────────

export function computeOverallScore(scores: {
  accuracy: number;
  scaffold_fidelity: number;
  age_appropriateness: number;
  cbse_scope: number;
}): number {
  const blended =
    COMPOSITE_WEIGHTS.accuracy * scores.accuracy +
    COMPOSITE_WEIGHTS.scaffoldFidelity * scores.scaffold_fidelity +
    COMPOSITE_WEIGHTS.ageAppropriateness * scores.age_appropriateness +
    COMPOSITE_WEIGHTS.cbseScope * scores.cbse_scope;
  return Math.max(0, Math.min(100, Math.round(blended)));
}

interface JudgeRubric {
  accuracy: number;
  scaffold_fidelity: number;
  age_appropriateness: number;
  cbse_scope: number;
  notes?: string;
}

/**
 * Parse + validate the judge's response. The judge is instructed to emit a
 * pure JSON object; we tolerate fenced (`\`\`\`json … \`\`\``) wrapping the
 * same way we do for FoxyResponse (recover-from-text.ts) since Sonnet
 * occasionally fences despite being told not to.
 *
 * Returns null on any parse / validation failure. The caller treats null
 * as "couldn't score" rather than substituting fake values.
 */
export function parseJudgeJson(raw: string): JudgeRubric | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;

  const stripped = stripFences(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const r = parsed as Record<string, unknown>;

  const accuracy = clampScore(r.accuracy);
  const scaffoldFidelity = clampScore(r.scaffold_fidelity);
  const ageAppropriateness = clampScore(r.age_appropriateness);
  const cbseScope = clampScore(r.cbse_scope);

  if (
    accuracy === null ||
    scaffoldFidelity === null ||
    ageAppropriateness === null ||
    cbseScope === null
  ) {
    return null;
  }

  const notes = typeof r.notes === 'string' && r.notes.length > 0
    ? r.notes.slice(0, 1000)
    : undefined;

  return {
    accuracy,
    scaffold_fidelity: scaffoldFidelity,
    age_appropriateness: ageAppropriateness,
    cbse_scope: cbseScope,
    notes,
  };
}

function clampScore(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.max(0, Math.min(100, Math.round(v)));
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

// ─── Prompt builders (exported for parity tests) ────────────────────────────

export function buildJudgeSystemPrompt(): string {
  return [
    'You are a strict quality judge for an AI tutor (Foxy) used by Indian',
    'CBSE students in grades 6-12.',
    '',
    'You will be given a (student question, Foxy answer, optional cited',
    'NCERT chunks, grade, subject, expected coach mode) tuple. Score the',
    'answer on FOUR dimensions, each 0..100:',
    '',
    '  1. accuracy — Does the answer agree with the cited chunks? Penalise',
    '     hallucinations that contradict the chunks. If no citations were',
    '     provided (abstain turn), score on whether the abstain was honest',
    '     about uncertainty (high) vs hallucinated content (low).',
    '',
    '  2. scaffold_fidelity — Did the answer follow the expected coach',
    '     mode?',
    '       socratic: should ask 2-3 guided sub-questions, not deliver the',
    '         full answer up front.',
    '       answer:   should be concise (3-5 sentences) + ONE stretch',
    '         question one Bloom level higher.',
    '       review:   should ask the student to state the key idea first;',
    '         only confirm after.',
    '     If coach mode is null, score on whether ANY recognisable',
    '     scaffolding pattern was used.',
    '     ALSO score math formatting under this dimension (skip these',
    '     checks entirely when the answer contains no mathematics):',
    '       (a) multi-term math (2 or more operators, or more than one',
    '           fraction/term) appears as standalone display equations',
    '           (dedicated math blocks / their own line), NOT woven into',
    '           prose sentences.',
    '       (b) inline math is properly delimited with \\( ... \\). Bare',
    '           undelimited LaTeX in prose (e.g. "\\frac{1}{2}" outside',
    '           delimiters) or plain parentheses used as pseudo-delimiters',
    '           (e.g. "( x = 2 )") penalise.',
    '       (c) worked examples / derivations proceed as numbered short',
    '           steps — one transformation per step, each step one short',
    '           action line with its resulting expression on its own line —',
    '           never a dense inline chain of transformations in one',
    '           paragraph.',
    '',
    '  3. age_appropriateness — Language, examples, and references suit',
    '     the stated grade. No adult topics; no jargon a grade-N student',
    '     would not understand.',
    '',
    '  4. cbse_scope — Answer stays inside the CBSE curriculum boundary',
    '     for the stated subject. Off-syllabus tangents penalise.',
    '',
    'Output ONLY a JSON object with exactly this shape:',
    '',
    '  {',
    '    "accuracy": <int 0-100>,',
    '    "scaffold_fidelity": <int 0-100>,',
    '    "age_appropriateness": <int 0-100>,',
    '    "cbse_scope": <int 0-100>,',
    '    "notes": "<one-sentence reason for the LOWEST-scoring dimension>"',
    '  }',
    '',
    'No prose, no markdown fences, no commentary. Just the JSON object.',
  ].join('\n');
}

export function buildJudgeUserMessage(input: QualityScoreInput): string {
  const citationLines = input.citations.length === 0
    ? '(none — abstain turn or unsupported question)'
    : input.citations
        .slice(0, 5)
        .map((c, i) => {
          const loc = [c.chapter_title, c.page_number ? `p.${c.page_number}` : null]
            .filter(Boolean)
            .join(', ');
          const locLabel = loc ? ` [${loc}]` : '';
          // Cap each chunk at 800 chars so we don't blow the judge's
          // context budget on long chunks. Keep first part since that's
          // usually the on-topic content.
          const snippet = c.chunk_text.slice(0, 800);
          return `[${i + 1}]${locLabel} ${snippet}`;
        })
        .join('\n\n');

  return [
    `Grade: ${input.grade}`,
    `Subject: ${input.subject}`,
    `Expected coach mode: ${input.coachMode ?? '(not recorded; score on any recognisable scaffolding)'}`,
    '',
    '=== STUDENT QUESTION ===',
    input.question,
    '',
    '=== FOXY ANSWER ===',
    input.answer,
    '',
    '=== CITED NCERT CHUNKS ===',
    citationLines,
  ].join('\n');
}
