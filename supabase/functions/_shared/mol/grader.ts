// supabase/functions/_shared/mol/grader.ts
//
// C4.2b-i (2026-05-19): Anthropic Sonnet shadow-pair grader.
//
// Background:
//   C4.2a wired the shadow path that fires a parallel OpenAI call on every
//   in-allow-list grounded-answer LLM invocation. The shadow row is
//   discarded from the user-facing path but persisted in mol_request_logs
//   so an offline grader can compare quality side-by-side. THIS file is
//   that grader's prompt + dispatcher.
//
//   The grader is intentionally NOT student-facing — it's an analytical
//   tool that reads two response strings and outputs a 0.0-1.0 quality
//   score per rubric dimension. The cron driver (daily-cron's
//   gradeMolShadowPairs step) does the row selection, sampling, and
//   UPDATE. THIS module owns only the rubric + the model call.
//
// Why Sonnet and not Haiku:
//   * The grader compares two candidate answers and must distinguish
//     subtle quality differences (e.g. NCERT alignment vs hallucination).
//     Haiku-vs-Haiku is too narrow a comparator for this task — Sonnet's
//     stronger reasoning produces stabler, more discriminative scores.
//   * Cost: Sonnet is 3x more expensive than Haiku per 1M output tokens
//     but the grader runs on a stratified sample (10% / 10% / 5% / 5%
//     per task_type in the C4.2b-i runbook), not on every row. Daily
//     grading spend is capped at ₹10,000 by the cron's kill-switch path.
//   * Provider parity: using Anthropic for the grader avoids the obvious
//     bias of asking the same provider that wrote one of the candidates
//     to grade the comparison. Both candidates come from Haiku and OpenAI;
//     Sonnet is the third-party arbiter.
//
// What this file is NOT:
//   * NOT a student-facing call site. P12 (AI safety, age-appropriate)
//     does not apply — no student ever sees the grader's output.
//   * NOT in the request hot path. The grader runs nightly via daily-cron;
//     latency is irrelevant. We use a default 30s timeout, not the 20s
//     primary-call timeout.
//   * NOT a router. There is no provider fallback — grader uses Anthropic
//     Sonnet directly via fetch. If Sonnet is unavailable we abort the
//     batch and the cron retries the next night.

const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const GRADER_MODEL = 'claude-sonnet-4-6-20251022';
const GRADER_TIMEOUT_MS = 30_000;
const GRADER_MAX_TOKENS = 1024;

/**
 * Per-dimension rubric weights. The five dimensions are chosen to match
 * the assessment-agent review criteria for grounded-answer:
 *   - ncert_alignment      : answer cites only NCERT-grounded facts.
 *   - factual_correctness  : underlying claims are true.
 *   - age_appropriateness  : language fits the student's grade band.
 *   - helpfulness          : actually answers the asked question.
 *   - citation_accuracy    : chunk references match the cited content.
 *
 * Weights sum to 1.0; the grader computes `overall = Σ score_i × weight_i`.
 */
export interface GraderRubric {
  ncert_alignment: number;
  factual_correctness: number;
  age_appropriateness: number;
  helpfulness: number;
  citation_accuracy: number;
}

export const DEFAULT_RUBRIC: GraderRubric = {
  ncert_alignment: 0.30,
  factual_correctness: 0.25,
  age_appropriateness: 0.20,
  helpfulness: 0.15,
  citation_accuracy: 0.10,
};

/**
 * Per-candidate score breakdown. Each dimension is in [0, 1]; overall is
 * the weighted sum (also clamped to [0, 1]).
 */
export interface CandidateScores {
  ncert_alignment: number;
  factual_correctness: number;
  age_appropriateness: number;
  helpfulness: number;
  citation_accuracy: number;
  overall: number;
}

/**
 * Grader output for one (baseline, shadow) pair. The cron writes the
 * shadow leg's overall score into mol_request_logs.shadow_grader_score
 * and the full payload into mol_request_logs.shadow_grader_payload.
 *
 * `winner` is the comparative label the runbook consumes; `agreement` is
 * 1 - |baseline.overall - shadow.overall| so dashboards can spot pairs
 * where the two candidates disagree dramatically (potential outliers).
 */
export interface GraderResult {
  baseline: CandidateScores;
  shadow: CandidateScores;
  agreement: number;
  winner: 'baseline' | 'shadow' | 'tie';
  notes: string;
  rubric_version: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
}

/** Stable rubric version string written into shadow_grader_payload.rubric_version. */
export const RUBRIC_VERSION = 'mol-grader-v1' as const;

/**
 * Compose the grader system prompt. Locked across versions — changing
 * the prompt requires bumping RUBRIC_VERSION so analysts can filter
 * before/after rows in mol_request_logs.shadow_grader_payload.
 */
function buildGraderSystemPrompt(rubric: GraderRubric): string {
  return `You are an impartial educational-content evaluator for a CBSE (Indian school board) tutoring platform serving grades 6-12. You will be shown a student question and two candidate answers (A = baseline, B = shadow). Score each on five dimensions in the range 0.0 to 1.0:

1. ncert_alignment (weight ${rubric.ncert_alignment.toFixed(2)}): Does the answer use only facts that align with NCERT (Indian National Council of Educational Research and Training) curriculum content? 1.0 = perfectly aligned, 0.0 = hallucinated or off-curriculum.

2. factual_correctness (weight ${rubric.factual_correctness.toFixed(2)}): Are the underlying claims true? 1.0 = all correct, 0.0 = contains substantive errors.

3. age_appropriateness (weight ${rubric.age_appropriateness.toFixed(2)}): Is the language and depth appropriate for a CBSE student (grades 6-12)? 1.0 = perfectly pitched, 0.0 = too advanced or too simplistic for the audience.

4. helpfulness (weight ${rubric.helpfulness.toFixed(2)}): Does the answer actually address the question asked? 1.0 = directly answers and explains, 0.0 = off-topic or evasive.

5. citation_accuracy (weight ${rubric.citation_accuracy.toFixed(2)}): When citations or chapter references appear, do they correctly match the cited content? 1.0 = all citations accurate, 0.0 = fabricated or wrong citations. If no citations are present, score 0.5.

Compute overall = Σ score_i × weight_i for each candidate. Pick a winner: "baseline" if A.overall > B.overall + 0.05, "shadow" if B.overall > A.overall + 0.05, otherwise "tie". Provide a 1-2 sentence note explaining the comparative judgment. Output STRICT JSON only — no markdown fences, no commentary outside the JSON object.

Output shape:
{
  "baseline": { "ncert_alignment": number, "factual_correctness": number, "age_appropriateness": number, "helpfulness": number, "citation_accuracy": number, "overall": number },
  "shadow":   { "ncert_alignment": number, "factual_correctness": number, "age_appropriateness": number, "helpfulness": number, "citation_accuracy": number, "overall": number },
  "agreement": number,
  "winner": "baseline" | "shadow" | "tie",
  "notes": string
}`;
}

/**
 * Compose the grader user message. The question is the actual student
 * question (so the grader knows what was asked); the candidates are the
 * baseline + shadow response texts.
 */
function buildGraderUserMessage(args: {
  question: string;
  baseline_text: string;
  shadow_text: string;
}): string {
  return `Student question:
${args.question}

Candidate A (baseline):
${args.baseline_text}

Candidate B (shadow):
${args.shadow_text}

Evaluate both candidates per the rubric and return strict JSON.`;
}

/**
 * Validate the shape of the parsed grader response. Returns the typed
 * GraderResult on success, or null if the response is malformed. Never
 * throws — malformed grader output is an expected failure mode (Sonnet
 * may occasionally emit a markdown fence despite the prompt). The cron
 * driver retries the next batch.
 */
function validateGraderShape(
  raw: unknown,
  model: string,
  prompt_tokens: number,
  completion_tokens: number,
): GraderResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const baseline = validateCandidate(obj.baseline);
  const shadow = validateCandidate(obj.shadow);
  if (!baseline || !shadow) return null;

  const agreement = typeof obj.agreement === 'number' && Number.isFinite(obj.agreement)
    ? Math.max(0, Math.min(1, obj.agreement))
    // Recompute defensively if grader omitted it.
    : Math.max(0, 1 - Math.abs(baseline.overall - shadow.overall));

  const rawWinner = typeof obj.winner === 'string' ? obj.winner : '';
  const winner: GraderResult['winner'] =
    rawWinner === 'baseline' || rawWinner === 'shadow' || rawWinner === 'tie'
      ? rawWinner
      : pickWinner(baseline.overall, shadow.overall);

  const notes = typeof obj.notes === 'string' ? obj.notes.slice(0, 500) : '';

  return {
    baseline,
    shadow,
    agreement,
    winner,
    notes,
    rubric_version: RUBRIC_VERSION,
    model,
    prompt_tokens,
    completion_tokens,
  };
}

function validateCandidate(raw: unknown): CandidateScores | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const fields = [
    'ncert_alignment',
    'factual_correctness',
    'age_appropriateness',
    'helpfulness',
    'citation_accuracy',
    'overall',
  ] as const;
  const out: Partial<CandidateScores> = {};
  for (const f of fields) {
    const v = obj[f];
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    out[f] = Math.max(0, Math.min(1, v));
  }
  return out as CandidateScores;
}

function pickWinner(baselineOverall: number, shadowOverall: number): GraderResult['winner'] {
  const delta = shadowOverall - baselineOverall;
  if (delta > 0.05) return 'shadow';
  if (delta < -0.05) return 'baseline';
  return 'tie';
}

/**
 * Compute the weighted overall score from a per-dimension breakdown.
 * Exported for the cron driver and tests; the grader prompt also asks
 * Sonnet to emit `overall` directly, but we recompute defensively in case
 * the model rounds inconsistently.
 */
export function computeOverall(scores: Omit<CandidateScores, 'overall'>, rubric: GraderRubric = DEFAULT_RUBRIC): number {
  const raw =
    scores.ncert_alignment * rubric.ncert_alignment +
    scores.factual_correctness * rubric.factual_correctness +
    scores.age_appropriateness * rubric.age_appropriateness +
    scores.helpfulness * rubric.helpfulness +
    scores.citation_accuracy * rubric.citation_accuracy;
  return Math.max(0, Math.min(1, raw));
}

/**
 * The grader entry point. Calls Anthropic Sonnet directly via fetch with
 * the rubric prompt and parses the JSON response. Returns null on any
 * failure path (timeout, non-200, parse error, validation error). Callers
 * (the cron driver) treat null as "skip this pair, try again tomorrow".
 *
 * The grader is intentionally allowed to call Anthropic directly without
 * going through MOL's router: this is an OFFLINE quality-assurance tool,
 * not a student-facing call. Router fallback semantics would obscure the
 * grader signal (which model said what), and the grader has no SLA — if
 * Sonnet is down, the batch just retries tomorrow.
 *
 * The eslint-disable below documents that intent.
 */
// eslint-disable-next-line alfanumrik/no-direct-ai-calls -- offline grader; not a student-facing surface. See header comment.
export async function gradeShadowPair(args: {
  question: string;
  baseline_text: string;
  shadow_text: string;
  rubric?: GraderRubric;
  /** Test seam: callers (the cron-step unit test) inject a fetch stub here. */
  fetchImpl?: typeof fetch;
  /** Test seam: override Anthropic API key for unit tests. Defaults to Deno env. */
  apiKey?: string;
}): Promise<GraderResult | null> {
  const rubric = args.rubric ?? DEFAULT_RUBRIC;
  const fetchFn = args.fetchImpl ?? fetch;
  const apiKey = args.apiKey ?? (typeof Deno !== 'undefined' ? Deno.env.get('ANTHROPIC_API_KEY') ?? '' : '');

  if (!apiKey) {
    console.warn('[mol-grader] ANTHROPIC_API_KEY missing — cannot grade');
    return null;
  }

  // Defensive: empty inputs are not gradeable. Returning null surfaces
  // the skip in the cron's stats without exhausting Sonnet quota on
  // garbage.
  if (!args.baseline_text || !args.shadow_text || !args.question) {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GRADER_TIMEOUT_MS);

  try {
    const res = await fetchFn(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: GRADER_MODEL,
        max_tokens: GRADER_MAX_TOKENS,
        // Low temperature: we want stable, repeatable scores. Grader
        // determinism > grader creativity.
        temperature: 0.1,
        system: buildGraderSystemPrompt(rubric),
        messages: [{ role: 'user', content: buildGraderUserMessage(args) }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.warn(`[mol-grader] Anthropic ${res.status} — skipping pair`);
      return null;
    }

    const data = await res.json() as {
      content: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const text = data.content
      ?.filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text!)
      .join('\n')
      .trim() ?? '';

    if (!text) {
      console.warn('[mol-grader] empty Sonnet response — skipping pair');
      return null;
    }

    // Strip accidental markdown fences (Sonnet occasionally adds them
    // despite the strict-JSON instruction).
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[mol-grader] JSON parse failed: ${msg}`);
      return null;
    }

    return validateGraderShape(
      parsed,
      GRADER_MODEL,
      data.usage?.input_tokens ?? 0,
      data.usage?.output_tokens ?? 0,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[mol-grader] fetch failed: ${msg}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Deterministic 0-99 bucket from a hash of the request_id. Used by the
 * cron driver to decide which pairs to sample at each task-type's
 * sampling rate. Matches the same string-hash style used by
 * mol-shadow.ts:shadowBucket so the same request_id is graded or skipped
 * consistently across cron runs.
 */
export function graderSampleBucket(request_id: string): number {
  let h = 0;
  for (let i = 0; i < request_id.length; i++) {
    h = ((h << 5) - h + request_id.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 100;
}

/**
 * The per-task-type sampling rates the cron driver applies. Defined here
 * so the cron and its unit tests share a single source of truth. Rates
 * are percentages (0-100), NOT 0-1 fractions.
 *
 * Rationale (C4.2b-i task spec):
 *   * 10% for `explanation` + `concept_explanation` — highest volume
 *     surfaces; the grader signal is most informative here.
 *   * 5% for `doubt_solving` and `step_by_step` — lower volume; we want
 *     statistically meaningful coverage without ballooning Sonnet cost.
 *   * 0% for everything else (grounding_check, quiz_generation,
 *     evaluation, reasoning, ocr_extraction) — these are outside the
 *     C4 shadow allow-list, so no shadow rows exist to grade.
 */
export const GRADER_SAMPLING_RATES: Record<string, number> = {
  explanation: 10,
  concept_explanation: 10,
  doubt_solving: 5,
  step_by_step: 5,
};

/**
 * The hard daily INR cost cap for the grader cron. When today's
 * `sum(inr_cost) WHERE shadow_role='shadow'` exceeds this value the
 * cron flips the shadow flag's kill_switch to true and exits without
 * doing further work. The value mirrors the C4.2b-i runbook's
 * cost-guardrail constant.
 */
export const GRADER_DAILY_COST_CAP_INR = 10_000 as const;
