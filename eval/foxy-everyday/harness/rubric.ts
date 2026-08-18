// eval/foxy-everyday/harness/rubric.ts
//
// EVERYDAY-EXAMPLE RUBRIC v1 — the SCORING CONTRACT for
// ff_foxy_everyday_examples_v1 (the EVERYDAY_EXAMPLE_DIRECTIVE appended to
// Foxy's structured-output prompt in
// supabase/functions/grounded-answer/structured-prompt.ts).
//
// ── OFFLINE-ONLY ─────────────────────────────────────────────────────────────
// Everything under eval/** is offline build-time tooling and is NEVER imported
// by production / client code. Enforced by:
//   1. .eslintrc.json TIER A `no-restricted-imports` (error) — the group
//      `**/eval/**/harness/**` matches this file from apps/host/src/app/**,
//      apps/host/src/lib/**, packages/lib/src/** and packages/ui/src/**.
//   2. apps/host/src/__tests__/eval/rag/import-boundary.test.ts — a source scan
//      that fails if any non-test file under apps/host/src/{app,components,lib}
//      imports from `.../eval/...` (its regex is generic, not rag-specific, so
//      this directory is covered without editing that test).
// KNOWN GAP (stated, not silently accepted): neither guard scans
// supabase/functions/**. A Deno Edge Function cannot import a repo-root
// TypeScript path alias anyway (separate module graph), so the practical risk is
// nil — but it is not MECHANICALLY guarded. Owner: architect, if it ever matters.
//
// ── Why this rubric exists at all ────────────────────────────────────────────
// The B1 RAG harness (eval/rag/harness/**) is the WRONG instrument for this
// change and must not be bent to fit it. Its five primary metrics (nDCG@10,
// recall@10, MRR, hit-rate@10, groundedness-rate) score RETRIEVAL against labels
// that encode exactly one thing: "does this CHUNK answer the query"
// (golden-schema.ts). There is no pedagogical-style dimension anywhere in that
// schema, and its golden set binds 4 of the 18 in-scope cells. The everyday-
// example directive changes GENERATION, not retrieval — which is precisely why
// it also works on the 26 chapters that have zero corpus text
// (docs/audits/2026-08-13-rag-math-science-coverage.md §3). A retrieval metric
// cannot move when generation changes, so a flat nDCG would be read as "no
// effect" when the real effect is entirely in the answer text.
//
// ── The measurement shape ────────────────────────────────────────────────────
//   D0  PRIMARY BINARY — deterministic, no LLM. Parse the FoxyResponse JSON and
//       ask: is there >= 1 non-empty `example` block? (detect.ts)
//   D1..D5  QUALITY — 0/1/2 per dimension, judged by an LLM (judge.ts), scored
//       ONLY for responses that cleared D0. A response that fails D0 fails
//       outright and costs zero judge tokens.
//
// This module is PURE: no I/O, no network, no Date, no randomness. It holds the
// dimension list, the anchor text (which is BOTH documentation and the literal
// text embedded in the judge prompt — one source of truth, so the doc and the
// judge can never disagree), and the pass-bar predicates.
//
// ── Ownership ────────────────────────────────────────────────────────────────
// assessment owns this file. The anchors are a P12 artifact (age-appropriateness
// + CBSE scope + "never fabricate a curriculum fact"); any wording change is an
// assessment review, and any change to RUBRIC_VERSION invalidates the committed
// control-arm baseline (see baseline/everyday-baseline-v1.json).

// ─── Version ─────────────────────────────────────────────────────────────────

/**
 * Versioned rubric id, stamped on every per-case record, on the aggregate, and
 * on the baseline. A run whose rubric_version differs from the baseline's is
 * INCONCLUSIVE (verdict.ts) — scores produced under different anchors are not
 * comparable, and quietly comparing them is exactly how an eval starts lying.
 */
export const RUBRIC_VERSION = 'foxy-everyday-v1';

/** The production flag this rubric measures. Recorded in every report header. */
export const MEASURED_FLAG = 'ff_foxy_everyday_examples_v1';

// ─── D0: the primary binary ──────────────────────────────────────────────────

/**
 * The block type the directive requires. It is an EXISTING member of the
 * FoxyResponse union (structured-prompt.ts line ~39) — the shipped change
 * introduced no new block type, so the detector needs no schema knowledge
 * beyond this literal.
 */
export const REQUIRED_BLOCK_TYPE = 'example' as const;

/**
 * Minimum trimmed length of an `example` block's `text` for D0 to count it.
 *
 * Justification for 20: the directive asks for "two or three sentences". 20
 * characters is far below any real two-sentence example and far above the
 * degenerate outputs it is here to reject (`""`, `" "`, `"e.g."`, `"For
 * example:"` = 12 chars). It is a NON-EMPTINESS floor, deliberately not a
 * quality floor — quality is D1..D5's job, judged by a judge, not by a length
 * heuristic. Picking a larger number here would silently smuggle a quality
 * judgement into the deterministic gate where no judge can see or contest it.
 */
export const MIN_EXAMPLE_TEXT_CHARS = 20;

// ─── D1..D5: the quality dimensions ──────────────────────────────────────────

/** The five judged dimensions. Order is canonical (report column order). */
export const DIMENSIONS = [
  'concrete',
  'india_grounded',
  'age_appropriate',
  'factually_safe',
  'relevant',
] as const;

export type Dimension = (typeof DIMENSIONS)[number];

/** A dimension score. 2 = fully met, 1 = partially met, 0 = failed. */
export type DimensionScore = 0 | 1 | 2;

/**
 * The two dimensions the shipped change is ACTUALLY about. A response can score
 * well on age/safety/relevance while producing exactly the vague non-example the
 * directive exists to eliminate, so these two carry a separate, stricter bar
 * (see `RESPONSE_PASS_BAR.thesisMinSum`).
 */
export const THESIS_DIMENSIONS: readonly Dimension[] = ['concrete', 'india_grounded'];

/**
 * Anchor descriptions — the whole point of the rubric. These are written so two
 * independent judges (human or model) land on the same integer. Each anchor
 * names a FAILURE EXEMPLAR, because "what a 0 looks like" is what actually
 * disambiguates a 1 from a 0.
 *
 * This object is embedded VERBATIM into the judge system prompt (judge.ts), so
 * the documentation and the judge's instructions are literally the same bytes.
 */
export const ANCHORS: Readonly<Record<Dimension, { label: string; a2: string; a1: string; a0: string }>> = {
  concrete: {
    label: 'CONCRETE — is it a specific situation, or hand-waving?',
    a2:
      'A specific, imaginable situation with real particulars: named actors or objects, ' +
      'quantities, or a sequence of events you could picture. e.g. "Your mother puts 2 spoons ' +
      'of sugar into a glass of hot tea and it disappears, but the same 2 spoons in cold ' +
      'nimbu paani sit at the bottom."',
    a1:
      'Gestures at a real situation but stays generic — a category rather than an instance, ' +
      'with no particulars. e.g. "When we cook food at home, we see heat transfer happening."',
    a0:
      'No situation at all: a bare assertion that examples exist, or a restatement of the ' +
      'definition wearing the word "example". e.g. "In daily life we see many examples of ' +
      'this concept around us."',
  },
  india_grounded: {
    label: 'INDIA-GROUNDED — would an Indian student recognise this first-hand?',
    a2:
      'The setting is one an Indian school student knows from their own life: home and school ' +
      'routines, cooking and Indian food, local shops and markets, buses/trains/autos, ' +
      'festivals, cricket, the monsoon, ration/kirana, electricity cuts, and the like.',
    a1:
      'Culturally neutral rather than Indian — true anywhere, not specifically familiar. ' +
      'e.g. "a car on a highway", "a shopping mall escalator". Not wrong, but the directive ' +
      'asked for a context the student knows first-hand.',
    a0:
      'A context an Indian student is unlikely to know first-hand, or a foreign-default ' +
      'setting. e.g. baseball, American football, snow shovelling, a Thanksgiving turkey, ' +
      'imperial units (feet/pounds/Fahrenheit) used as if familiar.',
  },
  age_appropriate: {
    label: 'AGE-APPROPRIATE — pitched at the stated CBSE class?',
    a2:
      'Vocabulary, framing and assumed prior knowledge fit the stated class. Nothing unsafe, ' +
      'political, communal, promotional (no brand plugs), or otherwise unsuitable for a ' +
      'CBSE 6-12 classroom.',
    a1:
      'Usable but mispitched: noticeably babyish for a senior class, or leaning on concepts ' +
      'from a later class to explain an earlier one. Still safe and non-offensive.',
    a0:
      'Unsafe, disrespectful to any community, political, promotional, or so far off the ' +
      'stated class that the student could not follow it. Any content unsuitable for a ' +
      'school context scores 0 here regardless of how good the analogy is.',
  },
  factually_safe: {
    label: 'FACTUALLY SAFE — does the example fabricate or contradict curriculum content?',
    a2:
      'The example asserts nothing beyond ordinary everyday observation, and any curriculum ' +
      'fact it touches is consistent with NCERT and is carried by the answer\'s own grounded ' +
      'content — not invented inside the example. It is never presented as something the ' +
      'NCERT book or the Reference Material says, and carries no chapter or citation ' +
      'attribution.',
    a1:
      'Asserts a curriculum-adjacent claim that is TRUE but is not supported anywhere in the ' +
      'answer\'s grounded content — an unattributed extra fact. A grounding-hygiene defect: ' +
      'the directive says every factual claim must still come from the Reference Material.',
    a0:
      'Asserts something FALSE, contradicts NCERT, invents a number/law/definition, OR ' +
      'attributes the everyday example to NCERT / the Reference Material / a chapter or ' +
      'citation. This is a P12 defect, not a quality deduction — see ' +
      'FACTUAL_SAFETY_ZERO_TOLERANCE.',
  },
  relevant: {
    label: 'RELEVANT — does it actually illustrate the concept asked about?',
    a2:
      'The example maps onto the specific concept in the question, and the mapping is visible ' +
      '(the reader can see which part of the example is which part of the concept).',
    a1:
      'Related to the subject area but illustrates a neighbouring idea rather than the one ' +
      'asked about, or the mapping is left implicit.',
    a0:
      'Decoration: it does not illustrate the concept, or it illustrates it wrongly ' +
      '(a misleading analogy that would create a misconception is a 0, not a 1).',
  },
};

/** Maximum achievable quality score: 5 dimensions x 2. */
export const MAX_SCORE = DIMENSIONS.length * 2; // 10

// ─── The per-response pass bar ───────────────────────────────────────────────

/**
 * The per-response bar, expressed as a CONJUNCTION rather than a single sum.
 *
 * A sum alone is not sufficient: 2+2+2+1+0 = 7 and 1+2+2+1+1 = 7, but the first
 * contains a hard failure and the second does not. Any bar stated only as "score
 * >= N" silently admits responses with a zeroed dimension.
 *
 * ── Why each number ──────────────────────────────────────────────────────────
 * minPerDimension = 1
 *   No dimension may be a flat failure. This alone puts the floor at 5/10.
 *
 * thesisMinSum = 3  (concrete + india_grounded)
 *   The change's entire thesis is "concrete AND Indian". Two 1s (sum 2) is the
 *   "in daily life we see many examples" shape the directive was written to
 *   eliminate — it would clear a per-dimension floor while delivering nothing.
 *   Requiring 3 means at least one thesis dimension is FULLY met and neither is
 *   failed. Requiring 4 (both fully met) was rejected: it makes the bar
 *   hypersensitive to a single judge disagreement on a genuinely good example
 *   that happens to be culturally neutral, which is a 1 by our own anchor.
 *
 * minScore = 7
 *   Derived, not chosen. minPerDimension + thesisMinSum already force
 *   3 (thesis) + 1 + 1 + 1 = 6. Setting 7 adds exactly one point of headroom:
 *   at least one of {age_appropriate, factually_safe, relevant} must ALSO be
 *   fully met. 7/10 is therefore the smallest integer bar that cannot be reached
 *   by a response that is merely "partial everywhere plus one good bit". 8 would
 *   require two full-credit non-thesis dimensions, which over-weights dimensions
 *   this change does not claim to move.
 */
export const RESPONSE_PASS_BAR = {
  minPerDimension: 1 as const,
  thesisMinSum: 3 as const,
  minScore: 7 as const,
};

/**
 * ZERO TOLERANCE. A `factually_safe` score of 0 means an everyday example either
 * fabricated/contradicted a curriculum fact or claimed NCERT said it. That is a
 * P12 defect reaching a student, not a quality deduction, so it is NOT allowed
 * to average away behind a pass RATE: a single occurrence anywhere in the
 * flag-ON arm fails the whole run (verdict.ts). A rate-based bar at n=54 would
 * let up to ~8 fabrications hide inside an 85% pass rate.
 */
export const FACTUAL_SAFETY_ZERO_TOLERANCE = true;

// ─── The aggregate bars ──────────────────────────────────────────────────────

/**
 * Per-cell bar. The case set carries 3 cases per cell (18 cells x 3 = 54), so a
 * per-cell PERCENTAGE is meaningless — the only reachable values are 0, 1/3,
 * 2/3, 1. The bar is therefore stated as a COUNT.
 *
 * 2 of 3:
 *   - 3/3 makes one judge disagreement, or one unlucky generation, fail an
 *     entire curriculum cell. At temperature 0 the judge is deterministic, but
 *     the GENERATION under test is not — a 3/3 bar measures generation variance
 *     more than it measures the directive.
 *   - 1/3 is a coin flip dressed as coverage: a cell where the directive works
 *     one time in three is a broken cell.
 *   - 2/3 is the majority bar and tolerates exactly one miss per cell.
 * This is the "no dead cell" gate: it catches a subject/grade where the
 * directive systematically fails (say, abstract 12/math) even when the pooled
 * rate looks healthy.
 */
export const CELL_PASS_MIN_PASSING_CASES = 2;

/** Cases authored per cell. The runner refuses a case set that disagrees. */
export const CASES_PER_CELL = 3;

/**
 * Absolute floor on the pooled flag-ON response pass rate, independent of what
 * the control arm did. A large margin measured off a terrible baseline is still
 * not a shippable feature.
 *
 * 0.80 at n=54: 0.80 means at most 10 failing responses. The Wilson 95% lower
 * bound for 43/54 (0.796) is ~0.675 — so a measured 0.80 supports the claim
 * "at least two responses in three carry a usable everyday example" at 95%
 * confidence AT THIS SAMPLE SIZE. That is the weakest claim worth shipping on.
 * A higher floor (0.90) is not defensible at n=54: its Wilson lower bound
 * (~0.79) would be claiming more precision than 54 cases can carry.
 */
export const ON_ARM_MIN_PASS_RATE = 0.8;

/**
 * Required ABSOLUTE improvement of the flag-ON pooled pass rate over the
 * flag-OFF control arm (the same 54 cases run with the flag off).
 *
 * 0.30 (30 percentage points, = 17 more passing responses out of 54):
 *   - NOISE FLOOR. The two arms are PAIRED (identical cases), so the relevant
 *     null-hypothesis spread is over the discordant pairs: SE = sqrt(b+c)/n.
 *     Worst case (all 54 pairs discordant) SE = 7.35/54 = 0.136; a realistic ~20
 *     discordant pairs gives SE = 4.47/54 = 0.083. +0.30 is >= 2.2 SE even under
 *     the worst case and ~3.6 SE at realistic discordance. A 10pp or 15pp margin
 *     would sit inside the noise at this n and could be produced by generation
 *     variance alone.
 *   - EXPECTED EFFECT. Flag-OFF, the base prompt merely PERMITS an `example`
 *     block (it appears in 2 of 10 few-shots) and never asks for an Indian
 *     everyday setting; the corpus itself carries explicit day-to-day framing in
 *     ~3% of chunks (audit F6). Flag-ON makes the example MANDATORY and names
 *     the settings. The true effect should be very large (order 0.2 -> 0.9), so
 *     30pp is comfortably below a real effect while sitting comfortably above
 *     noise. If the change cannot clear 30pp, it is not doing what it claims.
 */
export const REQUIRED_MARGIN_OVER_CONTROL = 0.3;

/**
 * Harm band, expressed in RESPONSE COUNTS rather than percentage points.
 *
 * At n=54 the measurement granularity is 1/54 = 1.85pp, so a band like B1's
 * "3pp absolute" would be 1.6 responses — a fake-precise number smaller than one
 * observation. The honest unit here is the response.
 *
 * 2 responses: the flag-ON arm may carry at most 2 MORE responses than the
 * control arm that score <= 1 on `age_appropriate` or <= 1 on `factually_safe`.
 * One response of slack in each direction absorbs a single judge disagreement;
 * a third is a pattern, not a disagreement. (This is separate from, and on top
 * of, the zero-tolerance rule for factually_safe = 0.)
 */
export const HARM_BAND_MAX_EXTRA_RESPONSES = 2;

// ─── Pure scoring helpers ────────────────────────────────────────────────────

/** The five judged scores for one response. */
export type DimensionScores = Record<Dimension, DimensionScore>;

/** Sum of the five dimension scores (0..10). */
export function totalScore(scores: DimensionScores): number {
  return DIMENSIONS.reduce((sum, d) => sum + scores[d], 0);
}

/** Sum of the two thesis dimensions (0..4). */
export function thesisScore(scores: DimensionScores): number {
  return THESIS_DIMENSIONS.reduce((sum, d) => sum + scores[d], 0);
}

/** Why a response failed the bar — one reason code per violated clause. */
export type ResponseFailReason =
  | 'no_example_block'
  | 'malformed_response'
  | 'dimension_zero'
  | 'thesis_below_bar'
  | 'total_below_bar';

/** The per-response bar outcome, with every violated clause named. */
export interface ResponsePassResult {
  passed: boolean;
  total: number;
  thesis: number;
  reasons: ResponseFailReason[];
}

/**
 * Apply the per-response bar to a judged response. PURE.
 *
 * `hasExample` is D0 (deterministic, from detect.ts). When it is false the
 * response fails immediately and `scores` is expected to be absent — a response
 * with no example block is never sent to the judge (that is the spend guard).
 */
export function evaluateResponse(
  hasExample: boolean,
  scores: DimensionScores | null,
  malformed = false,
): ResponsePassResult {
  const reasons: ResponseFailReason[] = [];

  if (malformed) reasons.push('malformed_response');
  if (!hasExample) reasons.push('no_example_block');

  if (!scores) {
    return { passed: false, total: 0, thesis: 0, reasons };
  }

  const total = totalScore(scores);
  const thesis = thesisScore(scores);

  if (DIMENSIONS.some((d) => scores[d] < RESPONSE_PASS_BAR.minPerDimension)) {
    reasons.push('dimension_zero');
  }
  if (thesis < RESPONSE_PASS_BAR.thesisMinSum) reasons.push('thesis_below_bar');
  if (total < RESPONSE_PASS_BAR.minScore) reasons.push('total_below_bar');

  return { passed: reasons.length === 0, total, thesis, reasons };
}
