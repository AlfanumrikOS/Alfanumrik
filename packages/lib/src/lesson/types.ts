/**
 * Lesson Generation Agent — PURE pedagogy-core types (GenAI Phase 5b).
 *
 * Spec: docs/superpowers/specs/2026-07-24-lesson-generation-agent-design.md
 *
 * This file declares the type surface for the FIRST student-facing GENERATIVE
 * agent's pure planning core. It contains NO LLM call, NO I/O, NO route — only
 * the request/plan/output shapes the grounded-generation orchestrator (built by
 * ai-engineer on top of this) consumes.
 *
 * Design stance (mirrors the spec §0):
 *  - HOW, never WHAT. The caller supplies `subject` + `chapter`; the planner
 *    decides only HOW to present it (structure / depth / tone / which
 *    misconceptions to call out). It writes NOTHING.
 *  - Grades are STRING "6".."12" (P5), never int.
 *  - Bilingual (P7): every human-readable field carries EN + Hindi.
 *  - No PII in any code/enum output.
 *  - `Citation` / `SuggestedAlternative` / `AbstainReason` are REUSED verbatim
 *    from the sanctioned grounded pipeline (imported, never redefined).
 *  - `BloomLevel` is the fixed six-level ordered enum from cognitive-engine.
 */
import type {
  Citation,
  SuggestedAlternative,
  AbstainReason,
} from '../ai/grounded-client';
import type { BloomLevel } from '../cognitive-engine';

// ─── Enums / literals ────────────────────────────────────────────────────────

/** Only artifact in this increment (§7 defers comics / worksheets / mind-maps). */
export type LessonArtifactType = 'lesson_notes';

/** Length / scaffolding hint. */
export type LessonDepth = 'brief' | 'standard' | 'deep';

/** Primary rendered language (both language fields are always populated — P7). */
export type LessonLanguage = 'en' | 'hi';

/** Ordered section set for `lesson_notes` (spec §2.1). */
export type LessonSectionKind =
  | 'hook'
  | 'core_concepts'
  | 'misconception_callouts'
  | 'active_recall'
  | 'application'
  | 'revision_summary';

/** Reused verbatim — the platform's `CognitiveContext.masteryLevel` band. */
export type MasteryBand = 'low' | 'medium' | 'high';

/** How much guided-example scaffolding the lesson leans on (band-derived). */
export type ScaffoldingLevel = 'heavy' | 'moderate' | 'light';

/** Advisory presentation channel derived from `preferences.learningStyle`. */
export type PersonaTone = 'visual' | 'balanced' | 'narrative' | 'concrete';

// ─── Input — LessonRequest (spec §1) ─────────────────────────────────────────

/** The WHAT — supplied by the caller (adaptive engine / rhythm / navigation). */
export interface LessonChapterRef {
  chapterNumber: number;
  chapterTitle: string;
}

export interface LessonRequest {
  /** students.id — authorization is UPSTREAM (the agent does not re-authorize). */
  studentId: string;
  /** CBSE subject CODE, must be in the valid set for the grade (§6). */
  subject: string;
  /** P5: STRING "6".."12", never int. */
  grade: string;
  chapter: LessonChapterRef;
  /** LITERAL — the only value in this increment. */
  artifactType: LessonArtifactType;
  /** Optional anchor for challenge level; when omitted, derived from mastery band. */
  targetBloom?: BloomLevel;
  /** Optional length/scaffolding hint; when omitted, derived from preferences. */
  depth?: LessonDepth;
  /** Drives the primary rendered language (both are always populated — P7). */
  language: LessonLanguage;
}

// ─── Output — LessonNotes (spec §2) ──────────────────────────────────────────

/** One grounded, bilingual content section (spec §2.1). */
export interface LessonSection {
  kind: LessonSectionKind;
  headingEn: string;
  headingHi: string;
  bodyEn: string;
  bodyHi: string;
  /** Every content section carries >= 1 citation; ungroundable sections are dropped. */
  citations: Citation[];
  bloomLevel: BloomLevel;
}

/** Whole-lesson abstain envelope (reuses the grounded abstain shape — spec §3.3). */
export interface LessonAbstain {
  reason: AbstainReason;
  suggestedAlternatives: SuggestedAlternative[];
  messageEn: string;
  messageHi: string;
}

/** Observability meta from the grounded response (P13-safe). */
export interface LessonMeta {
  traceId?: string;
  model?: string;
  tokens?: number;
  latency?: number;
  confidence?: number;
}

export interface LessonNotes {
  /** true when grounding could not support the lesson; `sections` is then empty. */
  abstained: boolean;
  abstain?: LessonAbstain;
  /** Ordered, adapted set; empty iff `abstained`. */
  sections: LessonSection[];
  /** Observability record of the HOW decision — stable codes/enums only, NO PII. */
  adaptationApplied: string[];
  /** De-duped union of every section's citations. */
  citationsAll: Citation[];
  meta: LessonMeta;
}

// ─── Pre-generation plan — LessonPlan ────────────────────────────────────────

/**
 * The pure, pre-generation plan the LLM prompt is built from. Produced by
 * `planLesson`; consumed by ai-engineer's grounded-generation template.
 */
export interface LessonPlan {
  /** Ordered kinds; the sequence is non-decreasing in Bloom (spec §2.1). */
  sectionKinds: LessonSectionKind[];
  /** Highest Bloom the lesson may reach — band anchor capped by `targetBloom`. */
  bloomCeiling: BloomLevel;
  depth: LessonDepth;
  scaffoldingLevel: ScaffoldingLevel;
  /** Misconception CODES to call out (Eedi-style), PII-free. */
  misconceptionCodes: string[];
  /** Curriculum topic titles to bias `core_concepts` emphasis toward (still HOW). */
  emphasisTopics: string[];
  personaTone: PersonaTone;
}

// ─── Narrow planner input — LessonMemoryInput ────────────────────────────────

/**
 * The NARROW subset of the app-layer unified `StudentMemory` the planner reads.
 *
 * Deliberately a structural type declared HERE (packages/lib) rather than an
 * import of the app-layer `StudentMemory` — that would create an app→lib
 * dependency. The route/orchestrator adapts `StudentMemory` → `LessonMemoryInput`:
 *   - `masteryLevel`         ← memory.cognitive.masteryLevel
 *   - `recentMisconceptions` ← memory.cognitive.recentMisconceptions
 *   - `weakTopics`           ← memory.cognitive.weakTopics
 *   - `knowledgeGaps`        ← memory.cognitive.knowledgeGaps
 *   - `preferences`          ← memory.preferences
 *
 * Field shapes mirror `CognitiveContext` / `StudentPreferences` exactly so the
 * adaptation is a pass-through projection (no re-derivation of mastery).
 */
export interface LessonMemoryInput {
  masteryLevel: MasteryBand;
  recentMisconceptions: Array<{
    code: string;
    label: string;
    count: number;
    remediationText: string;
  }>;
  weakTopics: Array<{ title: string; mastery: number; attempts: number }>;
  knowledgeGaps: Array<{ target: string; prerequisite: string; gapType: string }>;
  preferences: {
    learningStyle: string | null;
    preferredExplanationDepth: string | null;
  };
}

// ─── Re-exports of the reused primitives (imported, never redefined) ─────────
export type {
  Citation,
  SuggestedAlternative,
  AbstainReason,
} from '../ai/grounded-client';
export type { BloomLevel } from '../cognitive-engine';
