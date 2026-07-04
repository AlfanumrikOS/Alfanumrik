/**
 * scripts/knowledge-audit/dimensions.ts
 *
 * The 31-dimension educational-completeness model — SINGLE SOURCE OF TRUTH for
 * the knowledge-audit engine. Mirrors (and must stay byte-identical to) the
 * `chapter_asset_inventory_dimension_check` CHECK constraint in
 * supabase/migrations/20260703000300_chapter_asset_inventory.sql.
 *
 * The 31 dimensions split into three measurement lanes:
 *   - CHUNK_PASS (20): counted by the Claude chunk pass over rag_content_chunks
 *     (audit_method='chunk_pass').
 *   - QUESTION_BANK_SCAN (5): counted from question_bank rows for the chapter
 *     (audit_method='question_bank_scan').
 *   - GENERATED_CONTENT_SCAN (6): counted deterministically from the platform's
 *     curated SSoT tables — chapter_concepts (revision_notes AND concepts),
 *     curriculum_topics (topics + the concept_graph_links projection),
 *     concept_edges, spaced_repetition_cards
 *     (audit_method='generated_content_scan').
 *
 * TAXONOMY ADJUDICATION (assessment, 2026-07-04): `topics` and `concepts` MOVED
 * off the noisy semantic LLM lane onto deterministic SSoT counts. The curated
 * curriculum_topics / chapter_concepts tables ARE the single source of truth for
 * how many topics/concepts a chapter has — re-enumerating them from OCR-flattened
 * chunk prose duplicated that data (and did it badly). Counting the SSoT rows
 * directly honors "never duplicate data" and removes two unbounded LLM guesses.
 *
 * Pure module — no I/O, importable by vitest.
 */

export const CHUNK_PASS_DIMENSIONS = [
  // structural
  'pages',
  'headings',
  'subtopics',
  // conceptual
  'learning_objectives',
  'definitions',
  'formulae',
  'prerequisites',
  'common_mistakes',
  'difficulty_mapping',
  // worked material
  'examples',
  'solved_examples',
  'exercises',
  'activities',
  'real_world_applications',
  // visual
  'tables',
  'diagrams',
  'image_explanations',
  'captions',
  // revision (in-book)
  'summary',
  'keywords',
] as const;

/**
 * v2 split of the 22 chunk-pass dimensions (engine redesign after the Wave 1
 * pilot-gate failure — 33% accuracy, 0/4 contamination detections):
 *
 * - STRUCTURAL_DIMENSIONS (12): counted EXACTLY by the deterministic
 *   cross-chunk scanner (structural-scan.ts) — NCERT numbered-series markers
 *   (Fig./Table/Activity/Example N.M), exercise question numbering, N.M
 *   headings, summary/keyword blocks. No LLM involvement; overlap-safe by
 *   identifier dedupe.
 * - SEMANTIC_DIMENSIONS (8): require semantic judgement — enumerated by the
 *   batched LLM pass (≤15 chunks/call) which returns ITEMS (short labels),
 *   deduped code-side across batches (prompt.ts + parse-semantic.ts).
 *   (`topics` and `concepts` were REMOVED from this lane on 2026-07-04 — they
 *   are now deterministic SSoT counts in GENERATED_CONTENT_SCAN, not LLM
 *   enumerations.)
 *
 * Both lanes still upsert with audit_method='chunk_pass'.
 */
export const STRUCTURAL_DIMENSIONS = [
  'pages',
  'headings',
  'subtopics',
  'examples',
  'solved_examples',
  'exercises',
  'activities',
  'tables',
  'diagrams',
  'captions',
  'summary',
  'keywords',
] as const;

export const SEMANTIC_DIMENSIONS = [
  'learning_objectives',
  'definitions',
  'formulae',
  'prerequisites',
  'common_mistakes',
  'difficulty_mapping',
  'real_world_applications',
  'image_explanations',
] as const;

export type StructuralDimension = (typeof STRUCTURAL_DIMENSIONS)[number];
export type SemanticDimension = (typeof SEMANTIC_DIMENSIONS)[number];

export const QUESTION_BANK_SCAN_DIMENSIONS = [
  'hots_questions',
  'case_based_questions',
  'assertion_reason_questions',
  'competency_questions',
  'pyqs',
] as const;

export const GENERATED_CONTENT_SCAN_DIMENSIONS = [
  'revision_notes',
  'mind_maps',
  'flashcards',
  'concept_graph_links',
  // Deterministic SSoT counts (assessment adjudication 2026-07-04): moved off
  // the semantic LLM lane. topics = COUNT(curriculum_topics, subject-scoped);
  // concepts = COUNT(chapter_concepts, subject-scoped).
  'topics',
  'concepts',
] as const;

export const ALL_DIMENSIONS = [
  ...CHUNK_PASS_DIMENSIONS,
  ...QUESTION_BANK_SCAN_DIMENSIONS,
  ...GENERATED_CONTENT_SCAN_DIMENSIONS,
] as const;

export type ChunkPassDimension = (typeof CHUNK_PASS_DIMENSIONS)[number];
export type QuestionBankScanDimension = (typeof QUESTION_BANK_SCAN_DIMENSIONS)[number];
export type GeneratedContentScanDimension = (typeof GENERATED_CONTENT_SCAN_DIMENSIONS)[number];
export type Dimension = (typeof ALL_DIMENSIONS)[number];

export type AuditMethod =
  | 'chunk_pass'
  | 'pdf_verified'
  | 'manual'
  | 'question_bank_scan'
  | 'generated_content_scan';

/** One chunk of NCERT source text as fed to the audit (id + text + type). */
export interface AuditChunk {
  chunk_id: string;
  chunk_text: string;
  content_type: string | null;
}

/** Per-dimension finding as parsed from the model response. */
export interface DimensionFinding {
  found_count: number;
  /** IDs ONLY — never chunk text (P13). Max 5, subset of input chunk ids. */
  evidence_chunk_ids: string[];
  notes: string;
}

/** A chapter_asset_inventory row ready for upsert (P13: ids/labels only). */
export interface InventoryRow {
  syllabus_id: string;
  dimension: Dimension;
  expected_count: number | null;
  found_count: number;
  coverage_pct: number | null;
  evidence: string[];
  audit_method: AuditMethod;
  suspected_missing: string[];
}
