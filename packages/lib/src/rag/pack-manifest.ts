/**
 * RAG Content Pack Manifest (Phase 4.5 of Goal-Adaptive Learning Layers)
 *
 * Pure types + validation for content pack files (JSONL) ingested into
 * rag_content_chunks via scripts/ingest-rag-pack.ts.
 *
 * A pack is a versioned bundle of pre-licensed (or generated) content
 * chunks (PYQ board questions, JEE/NEET archive items, Olympiad problems,
 * curated NCERT supplements) that the operator uploads to expand Foxy
 * retrieval beyond pure NCERT.
 *
 * Owner: ai-engineer (ingestion) + assessment (curriculum correctness)
 * Founder constraint: ships dormant. No code path reads these types until
 * an operator runs the ingestion script. Already-ingested NCERT chunks
 * are not modified.
 *
 * Schema reference (additive in Phase 4.5 migration):
 *   rag_content_chunks.pack_id       text   nullable
 *   rag_content_chunks.pack_version  text   nullable
 *   rag_content_chunks.provenance    text   nullable, CHECK (one of allowed)
 */

export const PACK_PROVENANCE_VALUES = [
  'licensed',
  'public_domain',
  'generated',
  'curated',
] as const;

export type PackProvenance = (typeof PACK_PROVENANCE_VALUES)[number];

export const PACK_SOURCE_TAGS = [
  'ncert',
  'ncert_supplement',
  'pyq',
  'board_paper',
  'jee_archive',
  'neet_archive',
  'olympiad',
  'curated',
] as const;

export type PackSourceTag = (typeof PACK_SOURCE_TAGS)[number];

export const PACK_EXAM_RELEVANCE_VALUES = [
  'CBSE',
  'CBSE_BOARD',
  'JEE',
  'NEET',
  'OLYMPIAD',
] as const;

export type PackExamRelevance = (typeof PACK_EXAM_RELEVANCE_VALUES)[number];

export interface PackEntry {
  chunk_text: string;
  grade: string;
  subject: string;
  chapter_number: number;
  chapter_title?: string;
  topic?: string;
  concept?: string;
  source: PackSourceTag;
  exam_relevance: PackExamRelevance[];
  provenance: PackProvenance;
  board_year?: number;
  difficulty_level?: number;
  language?: 'en' | 'hi';
}

export interface PackHeader {
  pack_id: string;
  pack_version: string;
  pack_source: PackSourceTag;
  default_provenance: PackProvenance;
  notes?: string;
}

export interface PackValidation {
  ok: boolean;
  errors: string[];
}

const GRADES = new Set(['6', '7', '8', '9', '10', '11', '12']);

export function isValidProvenance(v: unknown): v is PackProvenance {
  return typeof v === 'string' && (PACK_PROVENANCE_VALUES as readonly string[]).includes(v);
}

export function isValidSourceTag(v: unknown): v is PackSourceTag {
  return typeof v === 'string' && (PACK_SOURCE_TAGS as readonly string[]).includes(v);
}

export function isValidExamRelevance(v: unknown): v is PackExamRelevance {
  return typeof v === 'string' && (PACK_EXAM_RELEVANCE_VALUES as readonly string[]).includes(v);
}

export function validatePackEntry(entry: unknown): PackValidation {
  const errors: string[] = [];
  if (!entry || typeof entry !== 'object') {
    return { ok: false, errors: ['entry is not an object'] };
  }
  const e = entry as Record<string, unknown>;

  if (typeof e.chunk_text !== 'string' || e.chunk_text.length < 50) {
    errors.push('chunk_text must be a string of at least 50 chars');
  }
  if (typeof e.chunk_text === 'string' && e.chunk_text.length > 4000) {
    errors.push('chunk_text exceeds 4000 chars (split into smaller chunks)');
  }
  if (typeof e.grade !== 'string' || !GRADES.has(e.grade)) {
    errors.push('grade must be a string "6"-"12" (P5)');
  }
  if (typeof e.subject !== 'string' || e.subject.length === 0) {
    errors.push('subject must be a non-empty string');
  }
  if (typeof e.chapter_number !== 'number' || !Number.isInteger(e.chapter_number) || e.chapter_number < 1) {
    errors.push('chapter_number must be a positive integer');
  }
  if (!isValidSourceTag(e.source)) {
    errors.push('source must be one of: ' + PACK_SOURCE_TAGS.join(', '));
  }
  if (!Array.isArray(e.exam_relevance) || e.exam_relevance.length === 0) {
    errors.push('exam_relevance must be a non-empty array');
  } else {
    for (const tag of e.exam_relevance) {
      if (!isValidExamRelevance(tag)) {
        errors.push('exam_relevance contains invalid value: ' + String(tag));
      }
    }
  }
  if (!isValidProvenance(e.provenance)) {
    errors.push('provenance must be one of: ' + PACK_PROVENANCE_VALUES.join(', '));
  }
  if (e.board_year !== undefined) {
    if (typeof e.board_year !== 'number' || !Number.isInteger(e.board_year) || e.board_year < 2000 || e.board_year > 2100) {
      errors.push('board_year must be an integer between 2000 and 2100');
    }
  }
  if (e.difficulty_level !== undefined) {
    if (typeof e.difficulty_level !== 'number' || !Number.isInteger(e.difficulty_level) || e.difficulty_level < 1 || e.difficulty_level > 5) {
      errors.push('difficulty_level must be an integer 1-5');
    }
  }
  if (e.language !== undefined && e.language !== 'en' && e.language !== 'hi') {
    errors.push('language must be "en" or "hi"');
  }
  return { ok: errors.length === 0, errors };
}

export function validatePackHeader(header: unknown): PackValidation {
  const errors: string[] = [];
  if (!header || typeof header !== 'object') {
    return { ok: false, errors: ['header is not an object'] };
  }
  const h = header as Record<string, unknown>;

  if (typeof h.pack_id !== 'string' || !/^[a-z0-9_\-]{4,80}$/i.test(h.pack_id)) {
    errors.push('pack_id must match /^[a-z0-9_-]{4,80}$/i');
  }
  if (typeof h.pack_version !== 'string' || !/^v?\d+(\.\d+){0,2}$/.test(h.pack_version)) {
    errors.push('pack_version must be a semver-style string (e.g. v1, 1.0, v1.2.3)');
  }
  if (!isValidSourceTag(h.pack_source)) {
    errors.push('pack_source must be one of: ' + PACK_SOURCE_TAGS.join(', '));
  }
  if (!isValidProvenance(h.default_provenance)) {
    errors.push('default_provenance must be one of: ' + PACK_PROVENANCE_VALUES.join(', '));
  }
  return { ok: errors.length === 0, errors };
}

export function applyHeaderDefaults(
  entry: PackEntry,
  header: PackHeader,
): PackEntry {
  return {
    ...entry,
    source: entry.source ?? header.pack_source,
    provenance: entry.provenance ?? header.default_provenance,
    language: entry.language ?? 'en',
  };
}
