/**
 * Content Generation Agent — PURE diagram-core types (GenAI Phase 5c).
 *
 * Spec: docs/superpowers/specs/2026-07-24-content-generation-agent-design.md
 *
 * This file declares the type surface for the student-facing GENERATIVE diagram
 * agent's pure planning core. It contains NO LLM call, NO I/O, NO route — only
 * the request/plan/output shapes the grounded-generation orchestrator (built by
 * ai-engineer on top of this) consumes. Mirrors the Phase-5b lesson pattern
 * (`packages/lib/src/lesson/types.ts`).
 *
 * Design stance (mirrors the spec §0):
 *  - HOW, never WHAT. The caller supplies `subject` + `chapter`; the planner
 *    decides only HOW to VISUALIZE it (diagram type / node structure /
 *    complexity). It writes NOTHING.
 *  - Grades are STRING "6".."12" (P5), never int.
 *  - Bilingual (P7): every human-readable field carries EN + Hindi.
 *  - No PII in any code/enum output.
 *  - `Citation` / `SuggestedAlternative` / `AbstainReason` are REUSED verbatim
 *    from the sanctioned grounded pipeline (imported, never redefined).
 *  - Diagram kinds are constrained to the v1 set (`flowchart | mindmap |
 *    timeline`) even though `validateMermaidCode` allows more Mermaid headers
 *    (spec §2.1 / §7 — the wider set is DEFERRED).
 */
import type {
  Citation,
  SuggestedAlternative,
  AbstainReason,
} from '../ai/grounded-client';

// ─── Enums / literals ────────────────────────────────────────────────────────

/** Only artifact in this increment (§7 defers SVG / raster / multi-diagram). */
export type DiagramArtifactType = 'diagram';

/**
 * The v1 diagram-kind set (spec §2.1). Deliberately narrower than
 * `MERMAID_ALLOWED_HEADERS` (sequenceDiagram / classDiagram / … are DEFERRED)
 * so the pedagogy of "when to use which visual" stays reviewable.
 */
export type DiagramKind = 'flowchart' | 'mindmap' | 'timeline';

/** Primary rendered node-label language (both title/caption pairs always set — P7). */
export type DiagramLanguage = 'en' | 'hi';

/** Reused verbatim — the platform's `CognitiveContext.masteryLevel` band. */
export type MasteryBand = 'low' | 'medium' | 'high';

/**
 * Presentation density band (band-derived, NOT a mastery gate). Analogous to the
 * lesson agent's `ScaffoldingLevel` — it changes how much secondary detail the
 * diagram carries, never what the student is judged to know.
 */
export type DiagramDetailLevel = 'core' | 'standard' | 'rich';

/** Which path picked `diagramKind` — observability only (spec §2.1). */
export type DiagramKindSource = 'caller_override' | 'content_heuristic';

// ─── Input — DiagramRequest (spec §1) ────────────────────────────────────────

/** The WHAT — supplied by the caller (adaptive engine / rhythm / navigation). */
export interface DiagramChapterRef {
  chapterNumber: number;
  chapterTitle: string;
}

export interface DiagramRequest {
  /** students.id — authorization is UPSTREAM (the agent does not re-authorize). */
  studentId: string;
  /** CBSE subject CODE, must be in the valid set for the grade (§6). */
  subject: string;
  /** P5: STRING "6".."12", never int. */
  grade: string;
  chapter: DiagramChapterRef;
  /** LITERAL — the only value in this increment. */
  artifactType: DiagramArtifactType;
  /**
   * Optional caller HOW hint. When provided AND in the v1 set it is HONORED;
   * when omitted the planner selects from chapter content (spec §2.1).
   */
  diagramType?: DiagramKind;
  /** Drives the in-diagram node-label language (title/caption always both set — P7). */
  language: DiagramLanguage;
}

// ─── Output — DiagramSpec (spec §2) ──────────────────────────────────────────

/** Whole-diagram abstain envelope (reuses the grounded abstain shape — spec §3.3). */
export interface DiagramAbstain {
  reason: AbstainReason;
  suggestedAlternatives: SuggestedAlternative[];
  messageEn: string;
  messageHi: string;
}

/** Observability meta from the grounded response (P13-safe — codes/enums only). */
export interface DiagramMeta {
  traceId?: string;
  model?: string;
  tokens?: number;
  latency?: number;
  confidence?: number;
}

/**
 * A single validated Mermaid diagram spec — the agent's output (spec §2).
 * Single diagram only; multi-diagram is a later increment (§7).
 */
export interface DiagramSpec {
  /**
   * true when grounding could not support the diagram OR either safety gate
   * failed (§3). When true, `mermaidCode` is empty/absent and `abstain` is set.
   */
  abstained: boolean;
  abstain?: DiagramAbstain;
  /**
   * The validated Mermaid source. Leads with an allowlisted v1 header, passes
   * `validateMermaidCode`, ≤ FOXY_MAX_MERMAID_CODE_LEN. Empty/absent iff abstained.
   */
  mermaidCode: string;
  /** The kind actually emitted (the Mermaid header token), constrained to the v1 set. */
  diagramKind: DiagramKind;
  /** Bilingual diagram title (P7). Passes `screenStudentFacingText`. */
  titleEn: string;
  titleHi: string;
  /** Bilingual one-line caption / what the diagram shows (P7). */
  captionEn: string;
  captionHi: string;
  /** De-duped NCERT provenance for the depicted nodes; ≥ 1 when not abstained. */
  citations: Citation[];
  meta: DiagramMeta;
}

// ─── Pre-generation plan — DiagramPlan ───────────────────────────────────────

/**
 * The pure, pre-generation plan the grounded LLM prompt is built from. Produced
 * by `planDiagram`; consumed by ai-engineer's `diagram_spec_v1` template. Maps to
 * the grounded `template_variables` (spec §3.1): `diagram_kind` ← `diagramKind`,
 * `max_nodes` ← `maxNodes`. `maxBranchDepth` / `detailLevel` / `richLabels` shape
 * the label/complexity instructions in the prompt body.
 */
export interface DiagramPlan {
  /** The chosen v1 kind (caller override honored, else content heuristic). */
  diagramKind: DiagramKind;
  /** Which path chose `diagramKind` — observability only. */
  diagramKindSource: DiagramKindSource;
  /**
   * Presentation node budget (a MAX-node hint for the prompt), analogous to the
   * lesson agent's `max_tokens`-by-`depth`. NOT a mastery threshold (spec §2.2).
   */
  maxNodes: number;
  /** How many levels of branching the diagram may fan out (band-derived). */
  maxBranchDepth: number;
  /** Presentation density band (band-derived; NOT a mastery gate). */
  detailLevel: DiagramDetailLevel;
  /** true when the student's learning style is visual → richer/longer node labels. */
  richLabels: boolean;
}

// ─── Narrow planner input — DiagramMemoryInput ───────────────────────────────

/**
 * The NARROW subset of the app-layer unified `StudentMemory` the planner reads.
 *
 * Deliberately a structural type declared HERE (packages/lib) rather than an
 * import of the app-layer `StudentMemory` — that would create an app→lib
 * dependency. The route/orchestrator adapts `StudentMemory` → `DiagramMemoryInput`:
 *   - `masteryLevel`  ← memory.cognitive.masteryLevel   (consumed VERBATIM)
 *   - `preferences`   ← memory.preferences
 *
 * Field shapes mirror `CognitiveContext` / `StudentPreferences` exactly so the
 * adaptation is a pass-through projection (no re-derivation of mastery — the
 * band was already derived upstream from the 0.4/0.7 anchors in cognitive-engine).
 */
export interface DiagramMemoryInput {
  masteryLevel: MasteryBand;
  preferences: {
    learningStyle: string | null;
  };
}

// ─── Re-exports of the reused primitives (imported, never redefined) ─────────
export type {
  Citation,
  SuggestedAlternative,
  AbstainReason,
} from '../ai/grounded-client';
