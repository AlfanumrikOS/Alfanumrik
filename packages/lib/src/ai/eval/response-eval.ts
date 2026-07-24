// packages/lib/src/ai/eval/response-eval.ts
//
// Runtime `ResponseEval` — 9-dimension response-evaluation sensor (Phase 4).
//
// This module is the PURE COMPOSER for the runtime evaluation sensor described
// in docs/superpowers/specs/2026-07-24-runtime-response-eval-design.md. It scores
// an AI (Foxy) response across 9 named dimensions using signals ALREADY COMPUTED
// for that turn, and derives an observability-only verdict (`flagged` +
// `flagReasons`).
//
// HARD SCOPE GUARD (binding, assessment-issued — see spec §1):
//   * OBSERVABILITY ONLY. `scoreResponse` NEVER blocks, delays, refunds, retries,
//     or alters a response. Flagging is a dashboard signal, not an enforcement
//     action (enforcement is the pre-existing live screenStudentFacingText path).
//   * It writes NO mastery / p_know / ZPD / progression / XP / score.
//   * It makes NO LLM call and does NO I/O. `scoreResponse` is a PURE function —
//     no Date.now, no network, no DB, no throw on well-formed input.
//   * Two dimensions that need a judge (`accuracy`, `learning_effectiveness`)
//     are represented as DEFERRED (available:false, score:null) and are populated
//     offline by the nightly Sonnet judge — never synchronously here.
//
// P13: this module produces CODES / IDS / ENUMS / NUMBERS only. It never receives
// or emits response text, prompt/student-message content, or PII. Grades stay
// strings (P5).
//
// Owner: ai-engineer. Reviewers: assessment (dimension semantics / bands / flag
//   conditions — spec §8), testing, ops (observability sink).

import {
  MASTERY_BUILDING_MAX,
  MASTERY_SECURE_MIN,
  MASTERY_ZPD_CEILING,
} from '@alfanumrik/lib/cognitive-engine';
import {
  STRICT_CONFIDENCE_ABSTAIN_THRESHOLD,
  SOFT_CONFIDENCE_BANNER_THRESHOLD,
} from '@alfanumrik/lib/grounding-config';
import {
  getModel,
  estimateCostUsd,
  ANTHROPIC_HAIKU_ID,
} from '@alfanumrik/lib/ai/gateway/registry';

// ─── Named constants (single source of truth — no inline magic numbers) ──────
//
// Reused (bound to existing constants — the sensor can never disagree with the
// live pipeline about "what counts as low confidence"):
//   HALLUCINATION_CONFIDENCE_FLOOR ← STRICT_CONFIDENCE_ABSTAIN_THRESHOLD (0.75)
//   UNGROUNDED_CONFIDENCE_CAP      ← SOFT_CONFIDENCE_BANNER_THRESHOLD    (0.6)
//   mastery bands 0.4 / 0.7 / 0.85 ← cognitive-engine.ts (imported above)
//   LATENCY_HEALTHY_MS             ← HAIKU.p50LatencyMs (800) from the gateway registry
//   COST_PER_TURN_BUDGET_USD       ← derived from the registry's Haiku pricing

/** Grounded-turn confidence at/below which an UNGROUNDED answer is flagged
 *  (§4). Bound to the live grounded-answer strict-abstain threshold so the
 *  sensor and the pipeline agree on "low confidence". */
export const HALLUCINATION_CONFIDENCE_FLOOR = STRICT_CONFIDENCE_ABSTAIN_THRESHOLD;

/** Health ceiling for an UNGROUNDED (non-abstain) answer — an ungrounded answer
 *  cannot be credited full health even if the model self-reports high
 *  confidence. Bound to the live soft-confidence banner threshold. */
export const UNGROUNDED_CONFIDENCE_CAP = SOFT_CONFIDENCE_BANNER_THRESHOLD;

// The Haiku descriptor is the routing default for student-facing turns; it is
// always present in the catalog, so `getModel` cannot miss here at module load.
const HAIKU_DESCRIPTOR = getModel(ANTHROPIC_HAIKU_ID);

/** Latency at/below which a turn is fully healthy. Reused from the gateway
 *  registry's Haiku p50 (800 ms). */
export const LATENCY_HEALTHY_MS = HAIKU_DESCRIPTOR?.p50LatencyMs ?? 800;

/**
 * NEW named constant. SLA ceiling (ms) for a grounded RAG turn: at/above this
 * the latency dimension is 0 health and flags. Value: 8000 ms.
 *
 * Rationale: the grounded path is retrieval + rerank + generation, materially
 * slower than a bare model p50 (800 ms). 8 s is ~10x the bare p50 yet
 * comfortably below the *free*-plan hard request timeout (PER_PLAN_TIMEOUT_MS.free
 * = 20 s in grounding-config), so a turn crossing this ceiling is genuinely
 * degraded, not merely a slow-but-normal grounded turn. Seeded conservatively;
 * retune post-launch from the observed grounded-turn p95.
 */
export const LATENCY_DEGRADED_CEILING_MS = 8_000;

/**
 * Per-turn cost budget (USD) at/below which the cost dimension is fully healthy.
 * DERIVED from the registry's published Haiku pricing (no new magic number):
 * the cost of a turn whose input AND output each fill Haiku's single-response
 * max-output budget (maxOutput = 8192 tokens). At/below this a turn is "within
 * budget". ≈ $0.049 at $1/1M in + $5/1M out.
 */
export const COST_PER_TURN_BUDGET_USD = HAIKU_DESCRIPTOR
  ? estimateCostUsd(HAIKU_DESCRIPTOR, HAIKU_DESCRIPTOR.maxOutput, HAIKU_DESCRIPTOR.maxOutput)
  : // Fallback mirrors estimateCostUsd(HAIKU, 8192, 8192) = 8192/1e6*(1+5).
    (8192 / 1_000_000) * (1.0 + 5.0);

/**
 * NEW named constant. Per-turn cost ceiling (USD): at/above this the cost
 * dimension is 0 health and flags. Value: 0.25 USD.
 *
 * Rationale: ≈ the cost of a full 200k-context-window Haiku turn
 * (estimateCostUsd(HAIKU, 200000, 8192) ≈ $0.241 at $1/1M in + $5/1M out). A
 * turn costing this much means retrieval dumped ~the entire context window — a
 * pathological turn worth surfacing. Seeded above the derived budget; retune
 * post-launch from the observed per-turn p95.
 */
export const COST_PER_TURN_CEILING_USD = 0.25;

// ─── Types ───────────────────────────────────────────────────────────────────

export type EvalSource =
  | 'deterministic' // output-screen (toxicity / age)
  | 'gateway' // model gateway registry (latency / cost)
  | 'grounding' // grounded.confidence / groundedFromChunks / citations
  | 'curriculum' // preGateConfirmedInScope / validateCurriculumScope
  | 'mastery' // cognitiveCtx.masteryLevel + topicProgress (ZPD)
  | 'deferred_llm_judge'; // sourced offline from foxy_quality_scores (null at runtime)

export interface ResponseEvalDimension {
  /** [0,1] health (higher = better); null iff `available === false`. */
  score: number | null;
  /** Raw magnitude when meaningful (ms, usd, confidence); else null/omitted. */
  raw?: number | null;
  source: EvalSource;
  /** false ⇒ deferred (score/raw null at runtime). */
  available: boolean;
  /** Stable classifier code for this dimension (e.g. 'in_scope', 'blocklist'). */
  code?: string;
}

/** The 9 dimension names, in a stable order. */
export type ResponseEvalDimensionName =
  | 'accuracy'
  | 'curriculum_alignment'
  | 'hallucination_risk'
  | 'age_appropriateness'
  | 'difficulty_fit'
  | 'learning_effectiveness'
  | 'toxicity'
  | 'latency'
  | 'cost';

/** Stable flag codes (observability only — never an enforcement action). */
export type ResponseEvalFlagReason =
  | 'toxicity_unsafe'
  | 'age_inappropriate'
  | 'curriculum_out_of_scope'
  | 'hallucination_risk_high'
  | 'latency_over_ceiling'
  | 'cost_over_ceiling';

export interface ResponseEval {
  // ── 9 dimensions ──
  accuracy: ResponseEvalDimension; // deferred
  curriculum_alignment: ResponseEvalDimension;
  hallucination_risk: ResponseEvalDimension;
  age_appropriateness: ResponseEvalDimension;
  difficulty_fit: ResponseEvalDimension; // advisory — never flags
  learning_effectiveness: ResponseEvalDimension; // deferred
  toxicity: ResponseEvalDimension;
  latency: ResponseEvalDimension;
  cost: ResponseEvalDimension;

  // ── verdict (observability only) ──
  flagged: boolean;
  flagReasons: string[]; // sorted, deduped stable codes

  // ── correlation (P13-safe UUIDs / scope enums only) ──
  traceId?: string;
  sessionId?: string;
  messageId?: string;
  grade?: string; // P5 string "6".."12" — a scope enum, not PII
  subject?: string; // subject code — not PII
}

/**
 * Pre-extracted, PII-free signals for one turn. Every field is a number /
 * boolean / stable code that the Foxy route already holds at its grounded
 * terminal — this composer performs NO I/O to obtain any of them.
 */
export interface ResponseEvalSignals {
  // curriculum
  /** True when the turn is confirmed in CBSE scope. A turn that reaches the
   *  grounded terminal is in-scope by construction (out-of-scope returns
   *  earlier); the route passes `true`. */
  curriculumInScope: boolean;
  /** Scope `reason` enum when out of scope (used as `code`). */
  curriculumReason?: string | null;

  // grounding
  /** grounded.confidence ∈ [0,1]; higher = more grounded = lower hallucination risk. */
  confidence: number | null;
  groundedFromChunks: boolean;
  citationsCount: number;

  // output-screen (deterministic) — union of the denormalized + raw screens
  /** Stable category tags from screenStudentFacingText: may include
   *  'blocklist', 'screen_error', 'legacy_validator_flag'. NEVER text. */
  screenCategories: string[];
  /** Optional grade-range heuristic soft-fail (advisory, age dimension only). */
  gradeRangeSoftFail?: boolean;

  // mastery
  /** cognitiveCtx.masteryLevel ∈ [0,1], or null when unknown. */
  masteryLevel: number | null;

  // gateway
  /** Wall-clock latency for the turn, ms. */
  latencyMs: number | null;
  /** Estimated turn cost in USD (from estimateCostUsd at the route). */
  costUsd: number | null;

  // correlation (P13-safe)
  traceId?: string;
  sessionId?: string;
  messageId?: string;
  grade?: string;
  subject?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function finiteOrNull(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Clamp to [0,1]. */
function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/**
 * Shared "healthy → 0 at ceiling" linear mapping used by latency + cost.
 * `raw <= healthy` → 1.0; `raw > ceiling` → 0.0; linear decay in between.
 */
function linearHealth(raw: number, healthy: number, ceiling: number): number {
  if (raw <= healthy) return 1;
  if (raw > ceiling) return 0;
  if (ceiling <= healthy) return raw <= healthy ? 1 : 0; // degenerate guard
  return clamp01(1 - (raw - healthy) / (ceiling - healthy));
}

const DEFERRED: ResponseEvalDimension = {
  score: null,
  raw: null,
  source: 'deferred_llm_judge',
  available: false,
};

// ─── Composer ────────────────────────────────────────────────────────────────

/**
 * Score one AI response across the 9 dimensions and derive the observability
 * verdict. PURE: no I/O, no clock, no throw on well-formed input.
 */
export function scoreResponse(signals: ResponseEvalSignals): ResponseEval {
  const flagReasons = new Set<string>();

  // 1 — accuracy (deferred). Offline authority: foxy_quality_scores.accuracy.
  const accuracy: ResponseEvalDimension = { ...DEFERRED };

  // 6 — learning_effectiveness (deferred). Offline: scaffoldFidelity.
  const learning_effectiveness: ResponseEvalDimension = { ...DEFERRED };

  // 2 — curriculum_alignment. inScope ? 1 : 0. code = reason | 'in_scope'.
  const inScope = signals.curriculumInScope === true;
  const curriculum_alignment: ResponseEvalDimension = {
    score: inScope ? 1 : 0,
    raw: null,
    source: 'curriculum',
    available: true,
    code: inScope ? 'in_scope' : signals.curriculumReason ?? 'out_of_scope',
  };
  if (curriculum_alignment.score === 0) flagReasons.add('curriculum_out_of_scope');

  // 3 — hallucination_risk (grounding). raw = confidence; health capped when
  // ungrounded or no citations.
  const conf = finiteOrNull(signals.confidence);
  const grounded = signals.groundedFromChunks === true;
  const hasCitations = Number.isFinite(signals.citationsCount) && signals.citationsCount > 0;
  let hallCode: string;
  if (!grounded) hallCode = 'ungrounded';
  else if (!hasCitations) hallCode = 'no_citations';
  else hallCode = 'grounded';
  let hallScore: number | null;
  if (conf === null) {
    hallScore = null;
  } else if (grounded && hasCitations) {
    hallScore = clamp01(conf);
  } else {
    hallScore = clamp01(Math.min(conf, UNGROUNDED_CONFIDENCE_CAP));
  }
  const hallucination_risk: ResponseEvalDimension = {
    score: hallScore,
    raw: conf,
    source: 'grounding',
    available: true,
    code: hallCode,
  };
  // Flag: confidence below floor AND not grounded-from-chunks (§4).
  if (conf !== null && conf < HALLUCINATION_CONFIDENCE_FLOOR && !grounded) {
    flagReasons.add('hallucination_risk_high');
  }

  // 4 — age_appropriateness (deterministic). 1.0 clean / 0.5 advisory / 0.0 hard-fail.
  const cats = new Set(Array.isArray(signals.screenCategories) ? signals.screenCategories : []);
  const hardFail = cats.has('blocklist') || cats.has('screen_error');
  const advisory = cats.has('legacy_validator_flag') || signals.gradeRangeSoftFail === true;
  let ageScore: number;
  let ageCode: string;
  if (hardFail) {
    ageScore = 0;
    ageCode = cats.has('blocklist') ? 'blocklist' : 'screen_error';
  } else if (advisory) {
    ageScore = 0.5;
    ageCode = cats.has('legacy_validator_flag') ? 'legacy_validator_flag' : 'grade_range_soft';
  } else {
    ageScore = 1;
    ageCode = 'clean';
  }
  const age_appropriateness: ResponseEvalDimension = {
    score: ageScore,
    raw: null,
    source: 'deterministic',
    available: true,
    code: ageCode,
  };
  if (age_appropriateness.score === 0) flagReasons.add('age_inappropriate');

  // 7 — toxicity (deterministic). blocklist/screen_error → 0, else 1.
  const toxScore = cats.has('blocklist') || cats.has('screen_error') ? 0 : 1;
  const toxCode = cats.has('blocklist') ? 'blocklist' : cats.has('screen_error') ? 'screen_error' : 'clean';
  const toxicity: ResponseEvalDimension = {
    score: toxScore,
    raw: null,
    source: 'deterministic',
    available: true,
    code: toxCode,
  };
  if (toxicity.score === 0) flagReasons.add('toxicity_unsafe');

  // 5 — difficulty_fit (mastery, advisory — NEVER flags). Bands 0.4/0.7/0.85.
  const mastery = finiteOrNull(signals.masteryLevel);
  let difficulty_fit: ResponseEvalDimension;
  if (mastery === null) {
    difficulty_fit = { score: null, raw: null, source: 'mastery', available: false };
  } else {
    let diffScore: number;
    let diffCode: string;
    if (mastery < MASTERY_BUILDING_MAX) {
      diffScore = 0.5; // content likely too hard — scaffold down
      diffCode = 'building';
    } else if (mastery >= MASTERY_ZPD_CEILING) {
      diffScore = 0.5; // over-mastered — stretch up
      diffCode = 'over_mastered';
    } else {
      diffScore = 1; // in ZPD sweet spot
      diffCode = mastery < MASTERY_SECURE_MIN ? 'developing' : 'secure';
    }
    difficulty_fit = {
      score: diffScore,
      raw: mastery,
      source: 'mastery',
      available: true,
      code: diffCode,
    };
  }
  // difficulty_fit deliberately contributes NO flag reason (advisory proxy).

  // 8 — latency (gateway). raw ms; 1.0 ≤ healthy, linear to 0 at ceiling.
  const latMs = finiteOrNull(signals.latencyMs);
  let latency: ResponseEvalDimension;
  if (latMs === null) {
    latency = { score: null, raw: null, source: 'gateway', available: false };
  } else {
    const latScore = linearHealth(latMs, LATENCY_HEALTHY_MS, LATENCY_DEGRADED_CEILING_MS);
    const latCode =
      latMs <= LATENCY_HEALTHY_MS ? 'healthy' : latMs > LATENCY_DEGRADED_CEILING_MS ? 'over_ceiling' : 'degraded';
    latency = { score: latScore, raw: latMs, source: 'gateway', available: true, code: latCode };
    if (latMs > LATENCY_DEGRADED_CEILING_MS) flagReasons.add('latency_over_ceiling');
  }

  // 9 — cost (gateway). raw USD; 1.0 ≤ budget, linear to 0 at ceiling.
  const costUsd = finiteOrNull(signals.costUsd);
  let cost: ResponseEvalDimension;
  if (costUsd === null) {
    cost = { score: null, raw: null, source: 'gateway', available: false };
  } else {
    const costScore = linearHealth(costUsd, COST_PER_TURN_BUDGET_USD, COST_PER_TURN_CEILING_USD);
    const costCode =
      costUsd <= COST_PER_TURN_BUDGET_USD
        ? 'within_budget'
        : costUsd > COST_PER_TURN_CEILING_USD
          ? 'over_ceiling'
          : 'elevated';
    cost = { score: costScore, raw: costUsd, source: 'gateway', available: true, code: costCode };
    if (costUsd > COST_PER_TURN_CEILING_USD) flagReasons.add('cost_over_ceiling');
  }

  const sortedReasons = [...flagReasons].sort();

  return {
    accuracy,
    curriculum_alignment,
    hallucination_risk,
    age_appropriateness,
    difficulty_fit,
    learning_effectiveness,
    toxicity,
    latency,
    cost,
    flagged: sortedReasons.length > 0,
    flagReasons: sortedReasons,
    ...(signals.traceId ? { traceId: signals.traceId } : {}),
    ...(signals.sessionId ? { sessionId: signals.sessionId } : {}),
    ...(signals.messageId ? { messageId: signals.messageId } : {}),
    ...(signals.grade ? { grade: signals.grade } : {}),
    ...(signals.subject ? { subject: signals.subject } : {}),
  };
}
