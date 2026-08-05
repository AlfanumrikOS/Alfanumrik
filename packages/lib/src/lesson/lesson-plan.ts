/**
 * Lesson Generation Agent — PURE lesson planner (GenAI Phase 5b).
 *
 * Spec: docs/superpowers/specs/2026-07-24-lesson-generation-agent-design.md §2.2
 *
 * `planLesson(request, memory)` maps unified-memory adaptation signals onto a
 * `LessonPlan` (the pre-generation blueprint the grounded LLM prompt is built
 * from). PURE: deterministic, no clock / IO / randomness, never throws on
 * well-formed input. Decides only HOW to present (structure / depth / tone /
 * which misconceptions to call out) — never WHAT concept; writes NOTHING.
 *
 * ── NO NEW MASTERY MATH, NO THRESHOLD LITERALS ───────────────────────────────
 * The mastery decision is `memory.masteryLevel` VERBATIM — the platform's
 * `CognitiveContext.masteryLevel` enum, already derived by the memory layer from
 * the `MASTERY_BUILDING_MAX` (0.4) / `MASTERY_SECURE_MIN` (0.7) anchors in
 * cognitive-engine. This planner re-derives NO mastery and contains NO numeric
 * threshold literal. Bloom ordering / capping reuses `BLOOM_ORDER`; section
 * sequencing reuses `LESSON_STEPS`. Both are imported, not re-invented.
 */
import { BLOOM_ORDER, LESSON_STEPS, type BloomLevel, type LessonStep } from '../cognitive-engine';
import type {
  LessonRequest,
  LessonPlan,
  LessonMemoryInput,
  LessonSectionKind,
  LessonDepth,
  MasteryBand,
  ScaffoldingLevel,
  PersonaTone,
} from './types';

// ─── Band → plan anchors (reused enums only; the 0.4/0.7 anchors live upstream) ─

/**
 * Highest Bloom each mastery band may reach (spec §2.2):
 *  - low    → held at remember/understand (scaffold, don't stretch)
 *  - medium → up to apply (the ZPD sweet spot)
 *  - high   → up to evaluate (challenge / enrichment)
 */
const BAND_BLOOM_CEILING: Record<MasteryBand, BloomLevel> = {
  low: 'understand',
  medium: 'apply',
  high: 'evaluate',
};

/** Scaffolding leans heavier the lower the band. */
const BAND_SCAFFOLDING: Record<MasteryBand, ScaffoldingLevel> = {
  low: 'heavy',
  medium: 'moderate',
  high: 'light',
};

// ─── Section base Bloom + LESSON_STEPS anchor (for deterministic ordering) ─────

/**
 * The base Bloom each section kind teaches at. Values are non-decreasing along
 * the canonical section order, so capping every value by a single ceiling
 * (min with a constant) preserves the non-decreasing property.
 */
const SECTION_BASE_BLOOM: Record<LessonSectionKind, BloomLevel> = {
  hook: 'remember',
  core_concepts: 'understand',
  misconception_callouts: 'understand',
  active_recall: 'apply',
  application: 'analyze',
  revision_summary: 'analyze',
};

/**
 * Each section kind's anchor within the existing `LESSON_STEPS` flow — used as
 * the stable secondary sort key so the section sequence is fully deterministic
 * and genuinely tied to the sanctioned lesson-flow ordering (spec §2 / §2.1).
 * (core_concepts merges visualization+guided_examples; misconception_callouts is
 * inserted Eedi-style with the examples; revision_summary = spaced_revision.)
 */
const SECTION_LESSON_STEP: Record<LessonSectionKind, LessonStep> = {
  hook: 'hook',
  core_concepts: 'visualization',
  misconception_callouts: 'guided_examples',
  active_recall: 'active_recall',
  application: 'application',
  revision_summary: 'spaced_revision',
};

// ─── Preference → depth / persona maps (advisory; unknown → safe default) ──────

const DEPTH_FROM_PREFERENCE: Record<string, LessonDepth> = {
  short: 'brief',
  brief: 'brief',
  concise: 'brief',
  // 'quick' is a preference token some writers emit for the low-depth bucket;
  // assessment-mandated (Phase 2 review, 2026-08-05): map it alongside
  // 'short'/'concise' to 'brief'.
  quick: 'brief',
  medium: 'standard',
  standard: 'standard',
  balanced: 'standard',
  deep: 'deep',
  detailed: 'deep',
  long: 'deep',
};

// Includes every value of the D9 learning_style contract enum
// ('visual' | 'verbal' | 'example-first' | 'balanced' — the PATCH
// /api/learner/preferences enum written by the implicit preference
// aggregator, packages/lib/src/learner-model/preference-aggregation.ts),
// so no D9-written style ever silently falls to the 'balanced' default.
const STYLE_TO_TONE: Record<string, PersonaTone> = {
  visual: 'visual',
  balanced: 'balanced',
  verbal: 'narrative',
  reading: 'narrative',
  auditory: 'narrative',
  kinesthetic: 'concrete',
  concrete: 'concrete',
  // D9 'example-first' → 'concrete': worked-example-led presentation is the
  // closest existing tone; assessment-specified (Phase 2 review, 2026-08-05).
  'example-first': 'concrete',
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/** The lower (less advanced) of two Bloom levels, by the shared BLOOM_ORDER. */
function lowerBloom(a: BloomLevel, b: BloomLevel): BloomLevel {
  return BLOOM_ORDER[a] <= BLOOM_ORDER[b] ? a : b;
}

/**
 * Order the selected section kinds so their Bloom is non-decreasing.
 * Primary key: the section's base Bloom (via BLOOM_ORDER).
 * Secondary key: its LESSON_STEPS position (stable, deterministic tie-break).
 */
function orderSectionsByBloom(kinds: LessonSectionKind[]): LessonSectionKind[] {
  return [...kinds].sort((a, b) => {
    const bloomDelta = BLOOM_ORDER[SECTION_BASE_BLOOM[a]] - BLOOM_ORDER[SECTION_BASE_BLOOM[b]];
    if (bloomDelta !== 0) return bloomDelta;
    return LESSON_STEPS.indexOf(SECTION_LESSON_STEP[a]) - LESSON_STEPS.indexOf(SECTION_LESSON_STEP[b]);
  });
}

/**
 * Bias `core_concepts` emphasis toward the student's weak/prerequisite topics
 * WITHIN the requested chapter (re-orders emphasis; does NOT change the WHAT).
 * De-duped, order-stable: weak topics first, then knowledge-gap prerequisites.
 * Topic titles are curriculum labels (PII-free, same class the memory renderer
 * already surfaces to prompts).
 */
function buildEmphasisTopics(memory: LessonMemoryInput): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | null | undefined): void => {
    const v = (raw ?? '').trim();
    if (v.length === 0 || seen.has(v)) return;
    seen.add(v);
    out.push(v);
  };
  for (const w of memory.weakTopics) push(w.title);
  for (const g of memory.knowledgeGaps) push(g.prerequisite);
  return out;
}

/** Resolve the effective depth: explicit request wins → preference → 'standard'. */
function resolveDepth(request: LessonRequest, memory: LessonMemoryInput): LessonDepth {
  if (request.depth) return request.depth;
  const pref = memory.preferences.preferredExplanationDepth;
  if (pref) return DEPTH_FROM_PREFERENCE[pref.trim().toLowerCase()] ?? 'standard';
  return 'standard';
}

/** Resolve the advisory persona tone from learning style; unknown → 'balanced'. */
function resolvePersonaTone(memory: LessonMemoryInput): PersonaTone {
  const style = memory.preferences.learningStyle;
  if (style) return STYLE_TO_TONE[style.trim().toLowerCase()] ?? 'balanced';
  return 'balanced';
}

// ─── Planner ──────────────────────────────────────────────────────────────────

/**
 * Map unified-memory adaptation signals → a `LessonPlan`. PURE / deterministic.
 *
 * @param request The WHAT + presentation hints (grade STRING, P5).
 * @param memory  The narrow adaptation input (adapted upstream from StudentMemory).
 */
export function planLesson(request: LessonRequest, memory: LessonMemoryInput): LessonPlan {
  const band = memory.masteryLevel;

  // Bloom ceiling: the band's safe anchor, further CAPPED by an explicit
  // `targetBloom` when supplied (never push a student above their band ceiling).
  const bandCeiling = BAND_BLOOM_CEILING[band];
  const bloomCeiling = request.targetBloom ? lowerBloom(bandCeiling, request.targetBloom) : bandCeiling;

  const scaffoldingLevel = BAND_SCAFFOLDING[band];
  const depth = resolveDepth(request, memory);
  const personaTone = resolvePersonaTone(memory);

  // Misconception callouts: only when the student has recent misconceptions.
  // Codes are already the curated top-N from the memory layer (PII-free).
  const misconceptionCodes = memory.recentMisconceptions
    .map((m) => m.code)
    .filter((c) => c.length > 0);
  const hasMisconceptions = misconceptionCodes.length > 0;

  // Section selection (band-driven HOW):
  //  - hook / core_concepts / active_recall / revision_summary  → always
  //  - misconception_callouts → only if the student has recent misconceptions
  //  - application → medium/high only; omitted (optional) for low to reduce load
  const selected: LessonSectionKind[] = ['hook', 'core_concepts'];
  if (hasMisconceptions) selected.push('misconception_callouts');
  selected.push('active_recall');
  if (band !== 'low') selected.push('application');
  selected.push('revision_summary');

  const sectionKinds = orderSectionsByBloom(selected);
  const emphasisTopics = buildEmphasisTopics(memory);

  return {
    sectionKinds,
    bloomCeiling,
    depth,
    scaffoldingLevel,
    misconceptionCodes,
    emphasisTopics,
    personaTone,
  };
}

/**
 * Render a stable, PII-free set of codes describing WHAT adaptation was applied
 * — the value for `LessonNotes.adaptationApplied` (codes/enums only, P13).
 * Deterministic ordering; never emits topic titles or misconception labels
 * (only misconception CODES, which are curated non-PII identifiers).
 */
export function renderAdaptationCodes(plan: LessonPlan): string[] {
  const codes: string[] = [
    `scaffolding:${plan.scaffoldingLevel}`,
    `bloom_ceiling:${plan.bloomCeiling}`,
    `depth:${plan.depth}`,
    `persona:${plan.personaTone}`,
    `sections:${plan.sectionKinds.length}`,
    `emphasis_count:${plan.emphasisTopics.length}`,
  ];
  if (plan.sectionKinds.includes('misconception_callouts')) codes.push('misconception_callouts:on');
  if (plan.sectionKinds.includes('application')) codes.push('application:on');
  for (const code of plan.misconceptionCodes) {
    codes.push(`misconception:${code}`);
  }
  return codes;
}
