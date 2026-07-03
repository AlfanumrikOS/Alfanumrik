/**
 * scripts/knowledge-audit/dimensions.ts
 *
 * The 31-dimension educational-completeness model — SINGLE SOURCE OF TRUTH for
 * the knowledge-audit engine. Mirrors (and must stay byte-identical to) the
 * `chapter_asset_inventory_dimension_check` CHECK constraint in
 * supabase/migrations/20260703000300_chapter_asset_inventory.sql.
 *
 * The 31 dimensions split into three measurement lanes:
 *   - CHUNK_PASS (22): counted by the Claude chunk pass over rag_content_chunks
 *     (audit_method='chunk_pass').
 *   - QUESTION_BANK_SCAN (5): counted from question_bank rows for the chapter
 *     (audit_method='question_bank_scan').
 *   - GENERATED_CONTENT_SCAN (4): counted from platform-generated content
 *     tables — chapter_concepts, concept_edges (via curriculum_topics
 *     projection), spaced_repetition_cards (audit_method='generated_content_scan').
 *
 * Pure module — no I/O, importable by vitest.
 */

export const CHUNK_PASS_DIMENSIONS = [
  // structural
  'pages',
  'headings',
  'topics',
  'subtopics',
  // conceptual
  'concepts',
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
