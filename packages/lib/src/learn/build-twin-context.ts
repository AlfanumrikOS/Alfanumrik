// src/lib/learn/build-twin-context.ts
//
// Digital Twin + Knowledge Graph (Slice 1) — PURE prompt-context builder.
//
// Converts a `learner_twin_snapshots` row (the per-student daily rollup) plus
// optional recent `learner_twin_memory` entries into a small, deterministic
// prompt-context object describing the student's LONGITUDINAL learning signals:
// weak topics, decayed (low-retention) topics, dominant error tendencies, the
// misconception-cluster count, the cohort percentile, and the "why they
// struggled" episodic highlights.
//
// ─── HARD INVARIANTS ─────────────────────────────────────────────────────────
//   • PURE + DETERMINISTIC: no I/O, no Date.now(), no randomness. Same inputs →
//     byte-identical output. Safe to unit-test and to call on the hot path.
//   • NO PII (P13): the inputs are IDs + numbers + enum-like codes only; this
//     module NEVER emits names / emails / phones / free text. The optional
//     memory `summary_code` is an enum-like tag by table contract.
//   • SINGLE SOURCE OF TRUTH for the weak/decay floors: the mastery + decay
//     thresholds come from BLOCKED_PREREQUISITE_RULES (assessment-owned), the
//     SAME numbers the SQL RPC detect_blocked_dependents is parameterized with.
//     No hardcoded floors here.
//
// The render helper (renderTwinPromptSection) turns the object into a compact
// prompt block. It intentionally surfaces COUNTS + CODES (not raw topic UUIDs,
// which are meaningless to the LLM and noisy) so the model gets actionable
// signal without leaking opaque identifiers into the prompt.

import { BLOCKED_PREREQUISITE_RULES } from './adaptive-loops-rules';

// ─── Inputs (shapes mirror the Wave 1 tables) ────────────────────────────────

/** A `learner_twin_snapshots` row (the fields this builder reads). */
export interface TwinSnapshotInput {
  snapshot_date?: string | null;
  /** jsonb map topic_id(uuid-as-text) -> mastery (0..1). */
  mastery_by_topic?: Record<string, unknown> | null;
  /** jsonb map topic_id(uuid-as-text) -> retention/decay score (0..1). */
  decay_state?: Record<string, unknown> | null;
  /** enum-like error codes (e.g. 'careless' | 'conceptual' | 'procedural'). */
  dominant_error_types?: unknown[] | null;
  /** catalog uuids of misconception clusters. */
  misconception_cluster_ids?: unknown[] | null;
  /** peer-relative percentile (0..100); null if not computed. */
  cohort_percentile?: number | null;
}

/** A recent `learner_twin_memory` row (the fields this builder reads). */
export interface TwinMemoryHighlightInput {
  /** enum-like tag, e.g. 'mastered_concept' | 'misconception_repeated'. */
  summary_code?: unknown;
  concept_topic_id?: string | null;
  misconception_id?: string | null;
}

// ─── Output object ───────────────────────────────────────────────────────────

export interface TwinWeakTopic {
  topicId: string;
  /** BKT mastery, 0..1, rounded to 2 dp. */
  mastery: number;
}

export interface TwinDecayedTopic {
  topicId: string;
  /** predicted retention, 0..1, rounded to 2 dp. */
  retention: number;
}

export interface TwinHighlight {
  summaryCode: string;
  /** the concept topic id this memory references, or null. */
  topicId: string | null;
}

export interface TwinContext {
  /** Topics below the mastery floor, ascending by mastery (most-weak first). */
  weakTopics: TwinWeakTopic[];
  /** Topics below the decay floor, ascending by retention (most-decayed first). */
  decayedTopics: TwinDecayedTopic[];
  /** De-duplicated dominant error-type codes. */
  dominantErrorTypes: string[];
  /** Count of misconception clusters the student is currently in. */
  misconceptionClusterCount: number;
  /** Peer-relative percentile (0..100), or null. */
  cohortPercentile: number | null;
  /** Recent episodic "why they struggled / what they mastered" highlights. */
  highlights: TwinHighlight[];
  /** True when there is no usable signal at all (render → ''). */
  isEmpty: boolean;
}

// ─── Caps (bound prompt size; deterministic) ─────────────────────────────────
const MAX_WEAK_TOPICS = 8;
const MAX_DECAYED_TOPICS = 8;
const MAX_ERROR_TYPES = 5;
const MAX_HIGHLIGHTS = 5;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Stable sort of a topic-id/value map into ascending-by-value entries below a
 * floor, with topic_id as the deterministic tie-break.
 */
function topicsBelowFloor(
  map: Record<string, unknown> | null | undefined,
  floor: number,
  cap: number,
): Array<{ topicId: string; value: number }> {
  if (!map || typeof map !== 'object') return [];
  const entries: Array<{ topicId: string; value: number }> = [];
  for (const [topicId, raw] of Object.entries(map)) {
    if (!nonEmptyString(topicId)) continue;
    if (!isFiniteNumber(raw)) continue;
    if (raw >= floor) continue;
    entries.push({ topicId, value: raw });
  }
  entries.sort((a, b) => (a.value - b.value) || (a.topicId < b.topicId ? -1 : a.topicId > b.topicId ? 1 : 0));
  return entries.slice(0, cap);
}

// ─── Builder ─────────────────────────────────────────────────────────────────

/**
 * Build the compact, PII-free TwinContext from a snapshot row (+ optional
 * recent memory highlights). Pure + deterministic. Floors come from
 * BLOCKED_PREREQUISITE_RULES (single source of truth).
 */
export function buildTwinContext(
  snapshot: TwinSnapshotInput | null | undefined,
  memoryHighlights: TwinMemoryHighlightInput[] = [],
): TwinContext {
  const empty: TwinContext = {
    weakTopics: [],
    decayedTopics: [],
    dominantErrorTypes: [],
    misconceptionClusterCount: 0,
    cohortPercentile: null,
    highlights: [],
    isEmpty: true,
  };

  if (!snapshot || typeof snapshot !== 'object') return empty;

  const { mastery_floor, decay_floor } = BLOCKED_PREREQUISITE_RULES;

  const weakTopics: TwinWeakTopic[] = topicsBelowFloor(
    snapshot.mastery_by_topic,
    mastery_floor,
    MAX_WEAK_TOPICS,
  ).map((e) => ({ topicId: e.topicId, mastery: round2(e.value) }));

  const decayedTopics: TwinDecayedTopic[] = topicsBelowFloor(
    snapshot.decay_state,
    decay_floor,
    MAX_DECAYED_TOPICS,
  ).map((e) => ({ topicId: e.topicId, retention: round2(e.value) }));

  // Dominant error-type codes — de-duplicated, order-preserving, capped.
  const dominantErrorTypes: string[] = [];
  const seenError = new Set<string>();
  for (const raw of snapshot.dominant_error_types ?? []) {
    if (!nonEmptyString(raw)) continue;
    const code = raw.trim();
    if (seenError.has(code)) continue;
    seenError.add(code);
    dominantErrorTypes.push(code);
    if (dominantErrorTypes.length >= MAX_ERROR_TYPES) break;
  }

  const misconceptionClusterCount = Array.isArray(snapshot.misconception_cluster_ids)
    ? snapshot.misconception_cluster_ids.filter((id) => nonEmptyString(id)).length
    : 0;

  const cohortPercentile = isFiniteNumber(snapshot.cohort_percentile)
    ? Math.max(0, Math.min(100, Math.round(snapshot.cohort_percentile)))
    : null;

  // Episodic highlights — summary code + (optional) concept topic id only.
  const highlights: TwinHighlight[] = [];
  for (const m of memoryHighlights ?? []) {
    if (!m || !nonEmptyString(m.summary_code)) continue;
    highlights.push({
      summaryCode: m.summary_code.trim(),
      topicId: nonEmptyString(m.concept_topic_id) ? m.concept_topic_id : null,
    });
    if (highlights.length >= MAX_HIGHLIGHTS) break;
  }

  const isEmpty =
    weakTopics.length === 0 &&
    decayedTopics.length === 0 &&
    dominantErrorTypes.length === 0 &&
    misconceptionClusterCount === 0 &&
    cohortPercentile === null &&
    highlights.length === 0;

  if (isEmpty) return empty;

  return {
    weakTopics,
    decayedTopics,
    dominantErrorTypes,
    misconceptionClusterCount,
    cohortPercentile,
    highlights,
    isEmpty: false,
  };
}

// ─── Renderer ────────────────────────────────────────────────────────────────

/**
 * Render the TwinContext into a compact prompt block. Returns '' when the
 * context is empty (so callers can append unconditionally and stay byte-
 * identical when there is no signal). Deterministic.
 *
 * Surfaces COUNTS + CODES, never raw topic UUIDs — those are opaque to the LLM.
 * Instructs Foxy to use the signals to shape HOW it teaches, and NEVER to read
 * the raw signals (especially the cohort percentile) aloud to the student.
 */
export function renderTwinPromptSection(twin: TwinContext): string {
  if (!twin || twin.isEmpty) return '';

  const lines: string[] = [];
  lines.push('=== LONGITUDINAL LEARNING SIGNALS (from the student\'s digital twin) ===');
  lines.push(
    'Use these to inform HOW you teach. Do NOT read these signals aloud to the student.',
  );

  if (twin.decayedTopics.length > 0) {
    lines.push(
      `- ${twin.decayedTopics.length} topic(s) show low retention (forgetting curve): briefly refresh the underlying fundamentals before advancing.`,
    );
  }

  if (twin.weakTopics.length > 0) {
    lines.push(
      `- ${twin.weakTopics.length} topic(s) remain weak (mastery below floor): scaffold carefully and do not assume prior fluency.`,
    );
  }

  if (twin.dominantErrorTypes.length > 0) {
    lines.push(
      `- Dominant error tendency: ${twin.dominantErrorTypes.join(', ')}. Watch for these and address the root cause, not just the symptom.`,
    );
  }

  if (twin.misconceptionClusterCount > 0) {
    lines.push(
      `- ${twin.misconceptionClusterCount} active misconception cluster(s): be alert to repair, contrast the wrong idea with the right one.`,
    );
  }

  if (twin.highlights.length > 0) {
    const codes = twin.highlights.map((h) => h.summaryCode).join(', ');
    lines.push(
      `- Recent learning patterns: ${codes}. Let these inform your pacing and encouragement.`,
    );
  }

  if (twin.cohortPercentile !== null) {
    lines.push(
      `- Cohort percentile: ${twin.cohortPercentile} (peer-relative; for your calibration only — NEVER disclose to the student).`,
    );
  }

  return lines.join('\n');
}
