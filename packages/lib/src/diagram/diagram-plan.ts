/**
 * Content Generation Agent — PURE diagram planner (GenAI Phase 5c).
 *
 * Spec: docs/superpowers/specs/2026-07-24-content-generation-agent-design.md §2.1/§2.2
 *
 * `planDiagram(request, memory)` maps unified-memory adaptation signals + the
 * chapter content onto a `DiagramPlan` (the pre-generation blueprint the grounded
 * LLM prompt is built from). PURE: deterministic, no clock / IO / randomness,
 * never throws on well-formed input. Decides only HOW to VISUALIZE (diagram type,
 * node budget, complexity) — never WHICH chapter/concept; writes NOTHING.
 *
 * ── NO NEW MASTERY MATH, NO THRESHOLD LITERALS ───────────────────────────────
 * The mastery decision is `memory.masteryLevel` VERBATIM — the platform's
 * `CognitiveContext.masteryLevel` enum, already derived by the memory layer from
 * the `MASTERY_BUILDING_MAX` (0.4) / `MASTERY_SECURE_MIN` (0.7) anchors in
 * cognitive-engine. This planner re-derives NO mastery and contains NO numeric
 * MASTERY threshold literal. The node-budget numbers below are PRESENTATION
 * parameters (a max-node hint passed to the prompt, like the lesson agent's
 * `max_tokens`-by-`depth`); none acts as a mastery gate.
 */
import type {
  DiagramRequest,
  DiagramPlan,
  DiagramMemoryInput,
  DiagramKind,
  DiagramKindSource,
  DiagramDetailLevel,
  MasteryBand,
} from './types';

// ─── Band → presentation anchors (reused band only; the 0.4/0.7 anchors live upstream) ─

/**
 * Base node budget per mastery band (spec §2.2). A PRESENTATION cap, not a
 * mastery gate:
 *  - low    → fewer nodes, the core spine only
 *  - medium → richer, secondary detail
 *  - high   → richest, enrichment branches
 */
const BAND_BASE_NODE_BUDGET: Record<MasteryBand, number> = {
  low: 6,
  medium: 9,
  high: 12,
};

/** Branch fan-out per band: low stays one level deep; medium/high may fan wider. */
const BAND_BRANCH_DEPTH: Record<MasteryBand, number> = {
  low: 1,
  medium: 2,
  high: 2,
};

/** Presentation density per band (band-derived; NOT a mastery gate). */
const BAND_DETAIL_LEVEL: Record<MasteryBand, DiagramDetailLevel> = {
  low: 'core',
  medium: 'standard',
  high: 'rich',
};

/**
 * Extra node budget when the student's learning style is visual (spec §2.2 —
 * "lean richer, since the diagram is this student's preferred channel"). A
 * PRESENTATION bonus, additive on top of the band base.
 */
const VISUAL_NODE_BONUS = 3;

/**
 * Hard ceiling on the node budget regardless of band + bonus — keeps a single
 * diagram legible and comfortably inside FOXY_MAX_MERMAID_CODE_LEN (2000 chars).
 * Not a mastery boundary; a rendering-legibility cap.
 */
const MAX_NODE_BUDGET = 15;

// ─── Content heuristic — diagram-type selection (HOW-only, spec §2.1) ─────────

/**
 * Keyword signals per v1 kind, matched (case-insensitive, whole-word-ish) against
 * the chapter title when the caller gives no `diagramType`. Priority order is
 * TIMELINE → FLOWCHART → MINDMAP (first hit wins) — the more specific
 * chronological/process signals are checked before the general concept-map
 * fallback. This is a PRESENTATION lens on content the caller already fixed; it
 * never substitutes a different chapter.
 */
const CONTENT_KEYWORDS: Record<DiagramKind, readonly string[]> = {
  timeline: [
    'revolution',
    'freedom',
    'struggle',
    'independence',
    'movement',
    'war',
    'dynasty',
    'reign',
    'empire',
    'period',
    'era',
    'century',
    'chronology',
    'timeline',
    'evolution',
    'civilization',
    'civilisation',
  ],
  flowchart: [
    'cycle',
    'process',
    'reaction',
    'mechanism',
    'digestion',
    'respiration',
    'photosynthesis',
    'circulation',
    'reflex',
    'algorithm',
    'flow',
    'how ',
    'making of',
    'formation',
    'transport',
  ],
  mindmap: [
    'types',
    'kinds',
    'classification',
    'classify',
    'parts',
    'branches',
    'structure',
    'overview',
    'components',
    'properties',
    'features',
    'categories',
  ],
} as const;

/** Kinds whose keyword lists are scanned, in priority order. */
const KIND_PRIORITY: readonly DiagramKind[] = ['timeline', 'flowchart', 'mindmap'] as const;

/**
 * Subjects whose content is chronological by default — used only as the fallback
 * when the caller gave no override and no keyword matched. History (senior) is
 * event-dated by nature; `social_studies` is NOT included (it mixes geography /
 * civics, which are not reliably chronological).
 */
const CHRONOLOGICAL_SUBJECTS: ReadonlySet<string> = new Set(['history_sr']);

/** The safe general-purpose default when nothing else matches: a concept map. */
const DEFAULT_KIND: DiagramKind = 'mindmap';

const V1_KINDS: ReadonlySet<DiagramKind> = new Set<DiagramKind>(['flowchart', 'mindmap', 'timeline']);

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/** true when a raw learning-style string denotes the visual channel. */
function isVisualStyle(style: string | null | undefined): boolean {
  return (style ?? '').trim().toLowerCase() === 'visual';
}

/**
 * Select the diagram kind (HOW-only). Caller override wins when it is a valid v1
 * kind; otherwise a deterministic content heuristic over the chapter title, then
 * a subject fallback, then the safe default. Returns the kind AND which path
 * chose it (observability).
 */
function selectDiagramKind(request: DiagramRequest): {
  kind: DiagramKind;
  source: DiagramKindSource;
} {
  // (a) Honor a valid caller override — it is a HOW hint, not a WHAT change.
  if (request.diagramType && V1_KINDS.has(request.diagramType)) {
    return { kind: request.diagramType, source: 'caller_override' };
  }

  // (b) Content heuristic over the chapter title, priority order.
  const title = request.chapter.chapterTitle.toLowerCase();
  for (const kind of KIND_PRIORITY) {
    if (CONTENT_KEYWORDS[kind].some((kw) => title.includes(kw))) {
      return { kind, source: 'content_heuristic' };
    }
  }

  // (c) Subject fallback: chronological subjects → timeline; else the default.
  if (CHRONOLOGICAL_SUBJECTS.has(request.subject.trim().toLowerCase())) {
    return { kind: 'timeline', source: 'content_heuristic' };
  }
  return { kind: DEFAULT_KIND, source: 'content_heuristic' };
}

// ─── Planner ──────────────────────────────────────────────────────────────────

/**
 * Map the chapter content + unified-memory adaptation signals → a `DiagramPlan`.
 * PURE / deterministic: same request + memory ⇒ same plan.
 *
 * @param request The WHAT + presentation hints (grade STRING, P5).
 * @param memory  The narrow adaptation input (adapted upstream from StudentMemory).
 */
export function planDiagram(request: DiagramRequest, memory: DiagramMemoryInput): DiagramPlan {
  const band = memory.masteryLevel;

  // Diagram type (HOW): caller override honored, else content heuristic.
  const { kind: diagramKind, source: diagramKindSource } = selectDiagramKind(request);

  // Presentation complexity (all band-derived; VERBATIM band, no re-derivation).
  const maxBranchDepth = BAND_BRANCH_DEPTH[band];
  const detailLevel = BAND_DETAIL_LEVEL[band];

  // Node budget: band base, +visual bonus for visual learners, capped for legibility.
  const richLabels = isVisualStyle(memory.preferences.learningStyle);
  const budget = BAND_BASE_NODE_BUDGET[band] + (richLabels ? VISUAL_NODE_BONUS : 0);
  const maxNodes = Math.min(budget, MAX_NODE_BUDGET);

  return {
    diagramKind,
    diagramKindSource,
    maxNodes,
    maxBranchDepth,
    detailLevel,
    richLabels,
  };
}
