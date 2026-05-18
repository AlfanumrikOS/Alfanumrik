// supabase/functions/_shared/mol/grader.ts
//
// C4.2b-i (2026-05-19): Anthropic Sonnet shadow-pair grader.
// C4.2b-i review fixes (2026-05-19): rubric v2 — dimension names harmonized
// with src/lib/foxy/quality-eval.ts (accuracy / scaffold_fidelity /
// cbse_scope / age_appropriateness), scaffolding added as a first-class
// dimension, citation_accuracy made optional with renormalization, weight
// order adjusted to put accuracy ahead of cbse_scope, anti-bias clauses
// added to the system prompt, tie threshold tightened from ±0.05 → ±0.03,
// and the user message now includes grade + coach_mode so the judge can
// evaluate age-appropriateness and scaffolding coherently.
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
//     but the grader runs on a stratified sample (see GRADER_SAMPLING_RATES),
//     not on every row. Daily grading spend is capped at ₹5,000
//     (GRADER_DAILY_CAP_INR) and the upstream shadow spend is capped at
//     ₹10,000 (GRADER_DAILY_COST_CAP_INR) by the cron's kill-switch path.
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
 * Tie threshold (overall-score delta). C4.2b-i review (2026-05-19) tightened
 * this from ±0.05 → ±0.03 because the post-A8 rubric blends six dimensions
 * (vs five in v1) so individual-dimension noise translates into smaller
 * overall-score swings — a wider band absorbed real wins as ties.
 */
const TIE_THRESHOLD = 0.03 as const;

/**
 * Per-dimension rubric weights. The six dimensions are aligned with
 * src/lib/foxy/quality-eval.ts so the same vocabulary applies to MOL
 * cross-provider grading and to single-provider Foxy quality scoring.
 *
 *   - accuracy            : factual claims are true (was 'factual_correctness' in v1).
 *   - cbse_scope          : answer stays inside CBSE curriculum for grade × subject
 *                            (was 'ncert_alignment' in v1; broader than NCERT-literal).
 *   - age_appropriateness : language and depth fit the stated grade.
 *   - scaffold_fidelity   : answer builds understanding step-by-step (new in v2;
 *                            critical for doubt_solving where pedagogy IS the contract).
 *   - helpfulness         : actually addresses the asked question (kept as MOL-specific).
 *   - citation_accuracy   : when citations appear, they match content (kept; now optional —
 *                            see A3 below).
 *
 * Weights sum to 1.0; the grader computes `overall = Σ score_i × weight_i`.
 * When citation_accuracy is null (no citations expected — abstain turn or
 * simple recall question), the grader renormalizes the remaining weights to
 * sum to 1.0 by dividing each by (1 - weights.citation_accuracy).
 */
export interface GraderRubric {
  accuracy: number;
  cbse_scope: number;
  age_appropriateness: number;
  scaffold_fidelity: number;
  helpfulness: number;
  citation_accuracy: number;
}

export const DEFAULT_RUBRIC: GraderRubric = {
  accuracy: 0.30,
  cbse_scope: 0.25,
  age_appropriateness: 0.20,
  scaffold_fidelity: 0.10,
  helpfulness: 0.05,
  citation_accuracy: 0.10,
};

/**
 * Per-candidate score breakdown. Each dimension is in [0, 1]; overall is
 * the weighted sum (also clamped to [0, 1]).
 *
 * `citation_accuracy` is nullable: when no citations are expected (abstain
 * turn, recall question with no reference needed) the grader returns null
 * for that dimension and the overall is computed against the renormalized
 * remaining weights.
 */
export interface CandidateScores {
  accuracy: number;
  cbse_scope: number;
  age_appropriateness: number;
  scaffold_fidelity: number;
  helpfulness: number;
  citation_accuracy: number | null;
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

/**
 * Stable rubric version string written into shadow_grader_payload.rubric_version.
 * Bumped from `mol-grader-v1` → `mol-grader-v2` on 2026-05-19 because the
 * review-fix PR landed:
 *   - renamed dimensions (factual_correctness → accuracy, ncert_alignment → cbse_scope)
 *   - added scaffold_fidelity as a first-class dimension
 *   - made citation_accuracy optional with weight renormalization
 *   - reweighted (accuracy 0.30, cbse_scope 0.25 — accuracy now beats scope)
 *   - tightened tie threshold from ±0.05 → ±0.03
 *   - added anti-bias clauses + grade + coach_mode to the system prompt
 *
 * Analysts can filter shadow_grader_payload.rubric_version='mol-grader-v1' to
 * see pre-fix rows; v2 starts on the first nightly grader run after this PR.
 */
export const RUBRIC_VERSION = 'mol-grader-v2' as const;

/**
 * Input to gradeShadowPair. Includes the student's grade and the coach
 * mode the answer was supposed to follow — without these, age-appropriateness
 * and scaffold_fidelity cannot be scored coherently (A1 review fix).
 *
 * `grade` is a string per P5 ('6'..'12'). `coach_mode` is null when the
 * shadow pipeline did not record it (mol_request_logs does not have a
 * coach_mode column yet — TODO(C4.2b-iii: add coach_mode column or plumb
 * via mol_shadow_pairs_v1)).
 */
export interface GraderInput {
  question: string;
  baseline_text: string;
  shadow_text: string;
  /** Student's CBSE grade. String per P5: '6' .. '12'. Unknown rows pass ''. */
  grade: string;
  /** Coach mode the answer was supposed to follow. Null if not recorded. */
  coach_mode: 'socratic' | 'answer' | 'review' | null;
  rubric?: GraderRubric;
  /** Test seam: callers (the cron-step unit test) inject a fetch stub here. */
  fetchImpl?: typeof fetch;
  /** Test seam: override Anthropic API key for unit tests. Defaults to Deno env. */
  apiKey?: string;
}

/**
 * Compose the grader system prompt. Locked across versions — changing
 * the prompt requires bumping RUBRIC_VERSION so analysts can filter
 * before/after rows in mol_request_logs.shadow_grader_payload.
 *
 * Note (A2 review fix): anti-bias instructions are mandatory at the
 * SYSTEM level so they bind every grading call. Without them Sonnet
 * tends to over-reward verbosity and reward stylistic preambles like
 * "Great question!" that are model tells, not pedagogy signals.
 */
function buildGraderSystemPrompt(rubric: GraderRubric): string {
  return `You are an impartial educational-content evaluator for a CBSE (Indian school board) tutoring platform serving grades 6-12. You will be shown a student question, the student's grade, an optional coach mode directive, and two candidate answers (A = baseline, B = shadow). Score each candidate on the following SIX dimensions in the range 0.0 to 1.0:

1. accuracy (weight ${rubric.accuracy.toFixed(2)}): Are the underlying claims true? 1.0 = all factually correct, 0.0 = contains substantive factual errors. This is the most heavily weighted dimension.

2. cbse_scope (weight ${rubric.cbse_scope.toFixed(2)}): Does the answer stay inside the CBSE curriculum boundary for the stated grade and (where inferable) subject? 1.0 = on-syllabus and aligned with NCERT / CBSE expectations, 0.0 = off-syllabus tangent or out-of-grade content. Broader than literal NCERT-quotation alignment — concepts that match the CBSE curriculum but are explained in plain language still score 1.0.

3. age_appropriateness (weight ${rubric.age_appropriateness.toFixed(2)}): Is the language, vocabulary, and depth appropriate for a CBSE student in the stated grade? 1.0 = perfectly pitched, 0.0 = too advanced (uses jargon a grade-N student would not understand) or too simplistic (talks down to the audience).

4. scaffold_fidelity (weight ${rubric.scaffold_fidelity.toFixed(2)}): Does the response build understanding step-by-step, or just deliver the answer? For doubt_solving tasks scaffolding IS the pedagogical contract — guide the student through reasoning rather than dropping the answer. If a coach mode is specified:
   - "socratic": 1.0 = asks 2-3 guided sub-questions and does NOT deliver the full answer up front. 0.0 = ignores Socratic frame and dumps the answer.
   - "answer": 1.0 = concise 3-5 sentence answer plus ONE stretch question one Bloom level higher. 0.0 = no scaffolding follow-up.
   - "review": 1.0 = invites the student to state the key idea first, then confirms. 0.0 = lecture mode.
   If coach mode is null, score on whether ANY recognisable scaffolding pattern is used (worked example, partial reveal, follow-up nudge).

5. helpfulness (weight ${rubric.helpfulness.toFixed(2)}): Does the answer actually address the question the student asked? 1.0 = directly relevant and useful, 0.0 = off-topic or evasive.

6. citation_accuracy (weight ${rubric.citation_accuracy.toFixed(2)}, OPTIONAL): When citations or chapter references appear, do they correctly match the cited content? 1.0 = all citations accurate, 0.0 = fabricated or wrong citations. If the candidate does NOT cite anything and the question did NOT require a citation (e.g. an abstain turn, a simple recall question with no NCERT reference expected), set this dimension to null. When null, the overall is computed against the remaining five weights renormalized to sum to 1.0.

ANTI-BIAS INSTRUCTIONS (binding for every grade):
- Do NOT penalize a response purely for being shorter or longer than the other. Length is not quality.
- Ignore stylistic preambles like "As an AI assistant", "Great question!", or "Let me help you". These are model-specific tells, not pedagogy signals.
- Score on substance: factual correctness, CBSE / NCERT alignment, age-appropriate language, scaffolding for the student's question, helpfulness, and citation accuracy where citations are expected.
- Do NOT favour one candidate because it sounds more confident or uses formal academic prose. Quality is measured against the rubric only.

Compute overall = Σ score_i × weight_i for each candidate, treating null citation_accuracy as "drop the dimension and renormalize the remaining weights to 1.0". Pick a winner: "baseline" if A.overall > B.overall + ${TIE_THRESHOLD.toFixed(2)}, "shadow" if B.overall > A.overall + ${TIE_THRESHOLD.toFixed(2)}, otherwise "tie". Provide a 1-2 sentence note explaining the comparative judgment. Output STRICT JSON only — no markdown fences, no commentary outside the JSON object.

Output shape (citation_accuracy may be the literal JSON value null):
{
  "baseline": { "accuracy": number, "cbse_scope": number, "age_appropriateness": number, "scaffold_fidelity": number, "helpfulness": number, "citation_accuracy": number | null, "overall": number },
  "shadow":   { "accuracy": number, "cbse_scope": number, "age_appropriateness": number, "scaffold_fidelity": number, "helpfulness": number, "citation_accuracy": number | null, "overall": number },
  "agreement": number,
  "winner": "baseline" | "shadow" | "tie",
  "notes": string
}`;
}

/**
 * Compose the grader user message. The question is the actual student
 * question (so the grader knows what was asked); the candidates are the
 * baseline + shadow response texts. Grade and coach_mode are included so
 * age-appropriateness and scaffold_fidelity can be scored coherently (A1
 * review fix).
 */
function buildGraderUserMessage(args: {
  question: string;
  baseline_text: string;
  shadow_text: string;
  grade: string;
  coach_mode: 'socratic' | 'answer' | 'review' | null;
}): string {
  const gradeLine = args.grade && args.grade.length > 0
    ? `Grade: ${args.grade}`
    : 'Grade: (not recorded — score age_appropriateness against the 6-12 default band)';
  const coachLine = args.coach_mode
    ? `Coach mode: ${args.coach_mode}`
    : 'Coach mode: (not recorded — score scaffold_fidelity against any recognisable scaffolding pattern)';
  return `${gradeLine}
${coachLine}

Student question:
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
  rubric: GraderRubric,
): GraderResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const baseline = validateCandidate(obj.baseline, rubric);
  const shadow = validateCandidate(obj.shadow, rubric);
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

/**
 * Validate one candidate's per-dimension scores. citation_accuracy is the
 * only dimension that may be null (A3 review fix). All other dimensions
 * must be finite numbers in [0,1] — we clamp aggressively.
 *
 * `overall` is recomputed from the dimensions + rubric using
 * computeOverall(), so a candidate whose grader-provided `overall` drifts
 * from the weighted sum (Sonnet rounding) is corrected to the canonical
 * value. This keeps shadow_grader_score (which the cron writes from
 * candidate.overall) self-consistent with the payload's per-dimension
 * breakdown.
 */
function validateCandidate(raw: unknown, rubric: GraderRubric): CandidateScores | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const requiredFields = [
    'accuracy',
    'cbse_scope',
    'age_appropriateness',
    'scaffold_fidelity',
    'helpfulness',
  ] as const;
  const out: Record<string, number> = {};
  for (const f of requiredFields) {
    const v = obj[f];
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    out[f] = Math.max(0, Math.min(1, v));
  }
  // citation_accuracy may be null (A3) or a number.
  const rawCitation = obj.citation_accuracy;
  let citation: number | null;
  if (rawCitation === null || rawCitation === undefined) {
    citation = null;
  } else if (typeof rawCitation === 'number' && Number.isFinite(rawCitation)) {
    citation = Math.max(0, Math.min(1, rawCitation));
  } else {
    return null;
  }
  const partial: Omit<CandidateScores, 'overall'> = {
    accuracy: out.accuracy,
    cbse_scope: out.cbse_scope,
    age_appropriateness: out.age_appropriateness,
    scaffold_fidelity: out.scaffold_fidelity,
    helpfulness: out.helpfulness,
    citation_accuracy: citation,
  };
  const overall = computeOverall(partial, rubric);
  return { ...partial, overall };
}

function pickWinner(baselineOverall: number, shadowOverall: number): GraderResult['winner'] {
  const delta = shadowOverall - baselineOverall;
  if (delta > TIE_THRESHOLD) return 'shadow';
  if (delta < -TIE_THRESHOLD) return 'baseline';
  return 'tie';
}

/**
 * Compute the weighted overall score from a per-dimension breakdown.
 * Exported for the cron driver and tests; the grader prompt also asks
 * Sonnet to emit `overall` directly, but we recompute defensively in case
 * the model rounds inconsistently.
 *
 * A3 review fix: when citation_accuracy is null, the citation weight is
 * dropped from the sum AND the remaining weights are renormalized so they
 * still sum to 1.0. Without renormalization a candidate that legitimately
 * abstains from citing (e.g. recall question with no NCERT chapter to
 * reference) would be penalised by ~0.10 just for the missing dimension.
 */
export function computeOverall(
  scores: Omit<CandidateScores, 'overall'>,
  rubric: GraderRubric = DEFAULT_RUBRIC,
): number {
  if (scores.citation_accuracy === null) {
    // Drop citation weight, renormalize the remaining five against
    // (1 - rubric.citation_accuracy). This preserves the relative ranking
    // of the other dimensions while removing the inapplicable one.
    const remainder = 1 - rubric.citation_accuracy;
    if (remainder <= 0) return 0;
    const raw =
      scores.accuracy * rubric.accuracy +
      scores.cbse_scope * rubric.cbse_scope +
      scores.age_appropriateness * rubric.age_appropriateness +
      scores.scaffold_fidelity * rubric.scaffold_fidelity +
      scores.helpfulness * rubric.helpfulness;
    return Math.max(0, Math.min(1, raw / remainder));
  }
  const raw =
    scores.accuracy * rubric.accuracy +
    scores.cbse_scope * rubric.cbse_scope +
    scores.age_appropriateness * rubric.age_appropriateness +
    scores.scaffold_fidelity * rubric.scaffold_fidelity +
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
export async function gradeShadowPair(args: GraderInput): Promise<GraderResult | null> {
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
        messages: [{
          role: 'user',
          content: buildGraderUserMessage({
            question: args.question,
            baseline_text: args.baseline_text,
            shadow_text: args.shadow_text,
            grade: args.grade,
            coach_mode: args.coach_mode,
          }),
        }],
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
      rubric,
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
 * Rationale (A7 review fix, 2026-05-19):
 *   * 15% for `doubt_solving` — Foxy core; highest student-experience impact;
 *     scaffolding fidelity matters most here.
 *   * 15% for `step_by_step` — ncert-solver textbook answers; board-exam
 *     stakes; factual accuracy errors here are most damaging.
 *   * 8% for `concept_explanation` — high volume; the grader signal stays
 *     informative at lower rates.
 *   *  5% for `explanation` — high volume; lowest unit pedagogical risk.
 *   *  0% for everything else (grounding_check, quiz_generation,
 *     evaluation, reasoning, ocr_extraction) — these are outside the C4
 *     shadow allow-list, so no shadow rows exist to grade.
 *
 * The previous v1 rates were 10/10/5/5 which over-sampled high-volume
 * surfaces and under-sampled the high-stakes pedagogy surfaces. The new
 * weighting shifts budget toward the pairs where grading signal matters
 * most for the C4 → C5 decision.
 */
export const GRADER_SAMPLING_RATES: Record<string, number> = {
  doubt_solving: 15,
  step_by_step: 15,
  concept_explanation: 8,
  explanation: 5,
};

/**
 * The hard daily INR cost cap for the SHADOW spend (mol_request_logs rows
 * with shadow_role='shadow'). When today's
 * `sum(inr_cost) WHERE shadow_role='shadow'` exceeds this value the cron
 * flips the shadow flag's kill_switch to true and exits without doing
 * further work. The value mirrors the C4.2b-i runbook's cost-guardrail
 * constant.
 *
 * Distinct from GRADER_DAILY_CAP_INR below: the SHADOW cap kills the
 * shadow itself (real product signal — we're spending more than budgeted
 * on parallel OpenAI calls). The GRADER cap (B6) is operational overhead
 * for Sonnet grading and does NOT flip the kill switch.
 */
export const GRADER_DAILY_COST_CAP_INR = 10_000 as const;

/**
 * Daily INR cap on GRADER (Sonnet) spend, distinct from the shadow cap
 * above. Sonnet grading is operational overhead — not a signal that the
 * shadow itself is bad — so exceeding this cap aborts the rest of the
 * grading batch WITHOUT flipping kill_switch.
 *
 * Set at half the shadow cap. Sonnet costs ~3x Haiku per million output
 * tokens but the cron runs on a sampled fraction, not every row, so
 * ₹5,000/day comfortably covers the steady-state sampling load. If we
 * routinely trip this, the right answer is to lower the sampling rates
 * in GRADER_SAMPLING_RATES, not to raise the cap.
 */
export const GRADER_DAILY_CAP_INR = 5_000 as const;
