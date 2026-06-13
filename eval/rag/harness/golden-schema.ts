// eval/rag/harness/golden-schema.ts
//
// B1 retrieval-quality eval harness — Task 1: golden-set fixture TYPES +
// a PURE runtime validator. No I/O, no DB, no LLM, no network. This module
// is offline tooling and is NEVER imported by production / client code
// (enforced by the Task 8 import-boundary test).
//
// It is the contract that every downstream B1 task (metrics, runner,
// baseline, seeding) consumes. The on-disk fixture is a single versioned
// JSON document (`eval/rag/golden/ncert-golden-v1.json`, seeded in Task 9);
// `validateGoldenSet()` is the gate that file passes through.
//
// Scoping note — two SEPARATE concerns:
//   - `CANONICAL_SUBJECT_CODES` = the platform's canonical `subject_code` set
//     (the validator's allowlist scope). It is the EXACT set seeded by the
//     subject-governance migration (`subjects.code`): the validator ACCEPTS any
//     real platform subject_code and REJECTS fakes / legacy aliases. It is the
//     authority on "is this a real subject", NOT on "is this seeded in the
//     golden set".
//   - The v1 SEED golden set (Task 9) covers only a SUBSET of those codes — the
//     core subjects per grade-band that have sufficient indexed corpus. Allowlist
//     completeness (every real code accepted) and seed coverage (which codes the
//     v1 fixture actually exercises) are independent concerns; do not conflate.
//
// Shape rules enforced (spec §B1.3):
//   - P5: every `grade` is a STRING "6".."12" (never an integer).
//   - Subject allowlist uses the canonical snake_case `subject_code` set,
//     incl. `social_studies` (A6 — NOT "social science" / "social_science").
//   - per-chunk `relevance ∈ {0,1,2}`.
//   - `query_type ∈ {factual, conceptual, definition, multi_hop}`.
//   - optional `off_grade_scope: boolean` (A2) — present or absent both valid;
//     when present it must be a boolean.
//   - every `relevant_chunk_id` a valid UUID.
//   - `corpus_ref` present with `source === 'ncert_2025'` (the live UUID-resolve
//     against rag_content_chunks belongs to the live-DB runner, Task 5 — here
//     we only enforce the field SHAPE).
//   - NO PII-shaped key (`student_id`/`user_id`/`session_id`/`email`/`phone`)
//     anywhere in the document, at ANY nesting depth (recursive).
//
// Aligns with the live `retrieve()` contract
// (`supabase/functions/_shared/rag/retrieve.ts`): `grade` is the `Grade`
// string union; `subject` is a snake_case subject code; `chapter_number`
// maps to `RetrieveOptions.chapterNumber` (integer | null). The golden item's
// `chunk_id`s are `rag_content_chunks.id` UUIDs — the join key the harness
// scores `RetrievalResult.chunks[].chunk_id` against.

// ─── Canonical enums (single source of truth, re-exported for tests) ─────────

/** P5 grade strings "6".."12". Mirrors `retrieve.ts` `Grade`. */
export const GRADES = ['6', '7', '8', '9', '10', '11', '12'] as const;
export type Grade = (typeof GRADES)[number];

/**
 * Canonical snake_case `subject_code` allowlist (A6).
 *
 * This is the EXACT set of `subjects.code` values seeded by the
 * subject-governance migration
 * (`supabase/migrations/_legacy/timestamped/20260415000004_subject_governance_seed.sql`)
 * — 17 codes, the single authoritative platform subject_code set. Keep this
 * list byte-aligned with that seed; add/remove ONLY when the seed changes.
 *
 * Pinned details:
 *   - The social-science code is `social_studies` — NEVER "social science" /
 *     "social_science".
 *   - `history_sr` is the canonical senior-secondary History code. The legacy
 *     alias `history` resolves to ZERO chunks in the live corpus and is
 *     deliberately EXCLUDED so the validator rejects it.
 *   - `civics` is NOT a real platform subject_code (the humanities split is
 *     `political_science`) and is deliberately EXCLUDED.
 *   - `hindi` is a core CBSE subject (grades 6-10 core, 11-12 elective) with
 *     live indexed corpus, so a Hindi golden item MUST validate.
 *   - Senior-secondary disciplines (physics/chemistry/biology and the
 *     humanities splits history_sr/geography/political_science) plus the
 *     commerce stream (economics/accountancy/business_studies) and the
 *     electives (computer_science/sanskrit/coding) are all included because
 *     grades 11-12 substitute them for the combined `science` /
 *     `social_studies` codes (spec Q2).
 *
 * NOTE: allowlist completeness (every real code accepted) is a SEPARATE concern
 * from v1 SEED golden-set coverage (Task 9) — see the header scoping note.
 */
export const CANONICAL_SUBJECT_CODES = [
  // cbse_core — grades 6-10 + the science-stream split (11-12)
  'math',
  'science',
  'english',
  'hindi',
  'social_studies',
  'physics',
  'chemistry',
  'biology',
  // cbse_core — commerce stream (11-12)
  'economics',
  'accountancy',
  'business_studies',
  // cbse_core — humanities stream (11-12)
  'history_sr',
  'geography',
  'political_science',
  // electives
  'computer_science',
  'sanskrit',
  'coding',
] as const;
export type SubjectCode = (typeof CANONICAL_SUBJECT_CODES)[number];

/** Query-type taxonomy (spec §B1.3 Tier 1). */
export const QUERY_TYPES = ['factual', 'conceptual', 'definition', 'multi_hop'] as const;
export type QueryType = (typeof QUERY_TYPES)[number];

/** Graded relevance scale for nDCG (2 = primary, 1 = partial, 0 = not relevant). */
export const RELEVANCE_VALUES = [0, 1, 2] as const;
export type Relevance = (typeof RELEVANCE_VALUES)[number];

/** Sourcing tier of a golden item. */
export const ITEM_TIERS = ['seed', 'trace_mined'] as const;
export type ItemTier = (typeof ITEM_TIERS)[number];

/** Provenance of a per-chunk relevance label. */
export const LABEL_SOURCES = ['assessment', 'judge'] as const;
export type LabelSource = (typeof LABEL_SOURCES)[number];

/**
 * PII-shaped keys that must NEVER appear anywhere in the committed fixture
 * (P13). The check is recursive — any nesting depth, including array elements.
 */
export const PII_FORBIDDEN_KEYS = [
  'student_id',
  'user_id',
  'session_id',
  'email',
  'phone',
] as const;

/** The corpus the golden chunk-ids resolve against. */
export const CORPUS_SOURCE = 'ncert_2025' as const;

// ─── Fixture TS types ────────────────────────────────────────────────────────

/**
 * One labeled relevant chunk for a golden item. `chunk_id` is a
 * `rag_content_chunks.id` UUID; `relevance` is the graded label that feeds
 * nDCG; `off_grade_scope` (A2) records grade-band misalignment INDEPENDENTLY
 * of `relevance` (a chunk can be relevance=2 yet off_grade_scope=true).
 */
export interface GoldenRelevantChunk {
  chunk_id: string;
  relevance: Relevance;
  /** A2 — optional; absent is treated as `false` by consumers. */
  off_grade_scope?: boolean;
  label_source: LabelSource;
  /** Present on judge-sourced labels. */
  judge_reason?: string;
  /** True when assessment spot-checked the judge label. */
  spot_checked?: boolean;
}

/**
 * Trace-mined provenance (B3). Carries `query_sha256` by default and NEVER any
 * student identifier (P13 — enforced by the recursive PII-key check). `null`
 * for assessment-authored seed items.
 */
export interface GoldenProvenance {
  trace_table: 'grounded_ai_traces' | 'retrieval_traces';
  /** Default identity for mined query text (B3) — 64-hex sha256. */
  query_sha256: string;
  mined_at: string;
}

/** One golden query item. */
export interface GoldenItem {
  /** Stable id, e.g. "g8-sci-light-refraction-001". */
  id: string;
  tier: ItemTier;
  /**
   * The natural-language query. Optional on trace-mined items where only
   * `provenance.query_sha256` is stored (B3 — sha256-only is the default for
   * mined text that cannot be proven PII-free).
   */
  query?: string;
  query_type: QueryType;
  /** P5 grade string "6".."12". */
  grade: Grade;
  /** Canonical snake_case subject code (A6). */
  subject: SubjectCode;
  /** Maps to `RetrieveOptions.chapterNumber` (integer | null). */
  chapter_number: number | null;
  /** ≥1 labeled chunk; the relevant set the harness scores against. */
  relevant_chunks: GoldenRelevantChunk[];
  /** Trace-mined provenance; `null` for seed items. */
  provenance: GoldenProvenance | null;
}

/** The judge config recorded in the fixture header (offline, build-time). */
export interface GoldenJudgeMeta {
  model: string;
  rubric_version: string;
  temperature: number;
}

/**
 * `corpus_ref` pins the corpus the chunk-ids resolve against. The live
 * UUID-resolve check is the Task 5 runner's job; this module enforces only the
 * field shape + `source === 'ncert_2025'`.
 */
export interface GoldenCorpusRef {
  source: typeof CORPUS_SOURCE;
  snapshot_note: string;
}

/** The full versioned golden-set document. */
export interface GoldenSet {
  version: string;
  created_at: string;
  corpus_ref: GoldenCorpusRef;
  judge: GoldenJudgeMeta;
  items: GoldenItem[];
}

// ─── Validation result ───────────────────────────────────────────────────────

export type ValidationResult =
  | { ok: true; value: GoldenSet }
  | { ok: false; errors: string[] };

// ─── Pure helpers ────────────────────────────────────────────────────────────

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PII_KEY_SET: ReadonlySet<string> = new Set<string>(PII_FORBIDDEN_KEYS);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isUuid(v: unknown): boolean {
  return typeof v === 'string' && UUID_RE.test(v);
}

/**
 * Recursively scan `node` for any forbidden PII-shaped key (P13). Pushes a
 * dotted path for each hit into `errors`. Walks objects AND array elements so a
 * forbidden key cannot hide inside an array.
 */
function scanForPiiKeys(node: unknown, path: string, errors: string[]): void {
  if (Array.isArray(node)) {
    node.forEach((el, i) => scanForPiiKeys(el, `${path}[${i}]`, errors));
    return;
  }
  if (isPlainObject(node)) {
    for (const key of Object.keys(node)) {
      const childPath = path ? `${path}.${key}` : key;
      if (PII_KEY_SET.has(key)) {
        errors.push(`PII-shaped key "${key}" found at ${childPath}`);
      }
      scanForPiiKeys(node[key], childPath, errors);
    }
  }
}

function validateRelevantChunk(
  chunk: unknown,
  itemPath: string,
  idx: number,
  errors: string[],
): void {
  const path = `${itemPath}.relevant_chunks[${idx}]`;
  if (!isPlainObject(chunk)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (!isUuid(chunk.chunk_id)) {
    errors.push(`${path}.chunk_id must be a valid UUID (got ${JSON.stringify(chunk.chunk_id)})`);
  }
  if (
    typeof chunk.relevance !== 'number' ||
    !(RELEVANCE_VALUES as readonly number[]).includes(chunk.relevance)
  ) {
    errors.push(`${path}.relevance must be one of {0,1,2} (got ${JSON.stringify(chunk.relevance)})`);
  }
  if (chunk.off_grade_scope !== undefined && typeof chunk.off_grade_scope !== 'boolean') {
    errors.push(`${path}.off_grade_scope, when present, must be a boolean`);
  }
  if (!(LABEL_SOURCES as readonly string[]).includes(chunk.label_source as string)) {
    errors.push(
      `${path}.label_source must be one of {${LABEL_SOURCES.join(', ')}} (got ${JSON.stringify(chunk.label_source)})`,
    );
  }
}

function validateProvenance(prov: unknown, itemPath: string, errors: string[]): void {
  if (prov === null || prov === undefined) return; // seed items carry null
  const path = `${itemPath}.provenance`;
  if (!isPlainObject(prov)) {
    errors.push(`${path} must be an object or null`);
    return;
  }
  if (prov.trace_table !== 'grounded_ai_traces' && prov.trace_table !== 'retrieval_traces') {
    errors.push(`${path}.trace_table must be 'grounded_ai_traces' or 'retrieval_traces'`);
  }
  if (typeof prov.query_sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(prov.query_sha256)) {
    errors.push(`${path}.query_sha256 must be a 64-char hex sha256`);
  }
  if (typeof prov.mined_at !== 'string') {
    errors.push(`${path}.mined_at must be a string date`);
  }
}

function validateItem(item: unknown, idx: number, errors: string[]): void {
  const path = `items[${idx}]`;
  if (!isPlainObject(item)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (typeof item.id !== 'string' || item.id.length === 0) {
    errors.push(`${path}.id must be a non-empty string`);
  }
  if (!(ITEM_TIERS as readonly string[]).includes(item.tier as string)) {
    errors.push(`${path}.tier must be one of {${ITEM_TIERS.join(', ')}}`);
  }
  // query is optional (B3 sha256-only default), but if present must be a string.
  if (item.query !== undefined && typeof item.query !== 'string') {
    errors.push(`${path}.query, when present, must be a string`);
  }
  if (!(QUERY_TYPES as readonly string[]).includes(item.query_type as string)) {
    errors.push(
      `${path}.query_type must be one of {${QUERY_TYPES.join(', ')}} (got ${JSON.stringify(item.query_type)})`,
    );
  }
  // P5: grade is a STRING "6".."12". An integer 8 fails the typeof check.
  if (typeof item.grade !== 'string' || !(GRADES as readonly string[]).includes(item.grade)) {
    errors.push(
      `${path}.grade must be a P5 string in {${GRADES.join(', ')}} (got ${JSON.stringify(item.grade)})`,
    );
  }
  // A6: subject allowlist; rejects "social science" / "social_science".
  if (!(CANONICAL_SUBJECT_CODES as readonly string[]).includes(item.subject as string)) {
    errors.push(
      `${path}.subject must be a canonical snake_case subject_code (got ${JSON.stringify(item.subject)})`,
    );
  }
  if (item.chapter_number !== null && typeof item.chapter_number !== 'number') {
    errors.push(`${path}.chapter_number must be an integer or null`);
  } else if (typeof item.chapter_number === 'number' && !Number.isInteger(item.chapter_number)) {
    errors.push(`${path}.chapter_number must be an integer or null`);
  }
  if (!Array.isArray(item.relevant_chunks) || item.relevant_chunks.length === 0) {
    errors.push(`${path}.relevant_chunks must be a non-empty array`);
  } else {
    item.relevant_chunks.forEach((c, i) => validateRelevantChunk(c, path, i, errors));
  }
  validateProvenance(item.provenance, path, errors);
}

// ─── Public validator ─────────────────────────────────────────────────────────

/**
 * Pure runtime validator for a golden-set document. Returns a discriminated
 * union: `{ ok: true, value }` (narrowed to `GoldenSet`) or
 * `{ ok: false, errors }`. Never throws.
 */
export function validateGoldenSet(doc: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isPlainObject(doc)) {
    return { ok: false, errors: ['document root must be an object'] };
  }

  // Recursive PII-key scan over the WHOLE document first (P13).
  scanForPiiKeys(doc, '', errors);

  if (typeof doc.version !== 'string' || doc.version.length === 0) {
    errors.push('version must be a non-empty string');
  }
  if (typeof doc.created_at !== 'string') {
    errors.push('created_at must be a string date');
  }

  // corpus_ref shape (structural; the live UUID-resolve is the Task 5 runner).
  if (!isPlainObject(doc.corpus_ref)) {
    errors.push('corpus_ref must be present and an object');
  } else {
    if (doc.corpus_ref.source !== CORPUS_SOURCE) {
      errors.push(`corpus_ref.source must be '${CORPUS_SOURCE}' (got ${JSON.stringify(doc.corpus_ref.source)})`);
    }
    if (typeof doc.corpus_ref.snapshot_note !== 'string') {
      errors.push('corpus_ref.snapshot_note must be a string');
    }
  }

  if (!isPlainObject(doc.judge)) {
    errors.push('judge must be present and an object');
  } else {
    if (typeof doc.judge.model !== 'string') errors.push('judge.model must be a string');
    if (typeof doc.judge.rubric_version !== 'string') errors.push('judge.rubric_version must be a string');
    if (typeof doc.judge.temperature !== 'number') errors.push('judge.temperature must be a number');
  }

  if (!Array.isArray(doc.items)) {
    errors.push('items must be an array');
  } else {
    if (doc.items.length === 0) errors.push('items must be a non-empty array');
    doc.items.forEach((item, i) => validateItem(item, i, errors));

    // HARD REJECT duplicate item ids. A repeated `item.id` would be silently
    // double-counted by the scorer (Task 2 aggregates per item), inflating or
    // skewing the metrics. Uniqueness is a correctness invariant, not a warning.
    const seenIds = new Set<string>();
    doc.items.forEach((item, i) => {
      if (isPlainObject(item) && typeof item.id === 'string') {
        if (seenIds.has(item.id)) {
          errors.push(`items[${i}].id "${item.id}" is a duplicate — item ids must be unique`);
        } else {
          seenIds.add(item.id);
        }
      }
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value: doc as unknown as GoldenSet };
}
