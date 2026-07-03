/**
 * scripts/knowledge-audit/coverage.ts
 *
 * Pure coverage math + expected-count heuristics + scan filter-spec builders
 * for the chunk-pass knowledge audit.
 *
 * - computeCoverage(found, expected): pct to 2dp, null when expected is null
 *   (or non-positive — no denominator), clamped to [0, 100] to satisfy the
 *   chapter_asset_inventory coverage_pct CHECK.
 * - deriveExpectedCounts(chunks, dimension): heuristics ONLY where reliably
 *   enumerable from NCERT text conventions — numbered-series continuity
 *   (Activity/Fig./Table/Example N.M: a gap like Fig 4.1 → 4.3 implies the
 *   book has ≥ 3 figures, so expected = max minor index observed) and
 *   exercise question-number continuity. All other dimensions → null.
 * - buildQuestionBankFilterSpec / buildGeneratedContentFilterSpec: PURE query
 *   builders returning a declarative filter spec (no I/O) that run-audit.ts
 *   executes against PostgREST. Keeping them pure makes the routing unit-testable.
 * - buildChunkPassRows: assembles the 22 chunk_pass InventoryRows from a
 *   parsed model response (evidence ids only — P13). Garbled/contaminated
 *   chapters keep their counts but carry taint labels; contamination also
 *   NULLs coverage_pct on the series-numbered dimensions.
 *
 * No I/O, no network. Unit-tested in
 * src/__tests__/scripts/knowledge-audit/coverage.test.ts.
 */

import {
  CHUNK_PASS_DIMENSIONS,
  type AuditChunk,
  type Dimension,
  type GeneratedContentScanDimension,
  type InventoryRow,
  type QuestionBankScanDimension,
} from './dimensions';
import type { ParsedAudit } from './parse-response';

// ─── Coverage math ────────────────────────────────────────────────────────────

/**
 * Coverage percent to 2dp. null when expected is null or non-positive (no
 * meaningful denominator). Clamped to 100 (found > expected means the audit
 * found MORE than the heuristic floor — full coverage, not >100%).
 */
export function computeCoverage(found: number, expected: number | null): number | null {
  if (expected === null || !Number.isFinite(expected) || expected <= 0) return null;
  const pct = Math.min((Math.max(found, 0) / expected) * 100, 100);
  return Math.round(pct * 100) / 100;
}

// ─── Expected-count heuristics (NCERT numbering conventions) ─────────────────

/** Sanity ceilings so OCR junk ("Fig 4.2019") never inflates expectations. */
const MAX_MINOR_INDEX = 99;
const MAX_EXERCISE_QUESTION = 80;

/**
 * Scan text for a numbered series like "Activity 4.1" / "Fig. 4.3" and return
 * the implied series size: group matches by MAJOR number (chapter), take the
 * major with the most matches (references to other chapters are minority
 * noise), and return the MAX minor index — numbering continuity means a gap
 * (4.1 → 4.3) still implies the book has at least 3 items.
 * Returns null when no dotted matches exist.
 */
export function maxSeriesIndex(text: string, label: RegExp): number | null {
  const byMajor = new Map<number, number[]>();
  for (const m of text.matchAll(label)) {
    const major = parseInt(m[1], 10);
    const minor = parseInt(m[2], 10);
    if (!Number.isFinite(major) || !Number.isFinite(minor)) continue;
    if (minor < 1 || minor > MAX_MINOR_INDEX) continue;
    const arr = byMajor.get(major) ?? [];
    arr.push(minor);
    byMajor.set(major, arr);
  }
  if (byMajor.size === 0) return null;
  let bestMajor: number[] | null = null;
  for (const arr of byMajor.values()) {
    if (!bestMajor || arr.length > bestMajor.length) bestMajor = arr;
  }
  return bestMajor ? Math.max(...bestMajor) : null;
}

/** Series regexes: capture group 1 = major (chapter), group 2 = minor. */
const SERIES_PATTERNS: Partial<Record<Dimension, RegExp>> = {
  activities: /\bActivity\s+(\d{1,2})\.(\d{1,3})\b/gi,
  diagrams: /\bFig(?:ure)?\.?\s*(\d{1,2})\.(\d{1,3})\b/gi,
  tables: /\bTable\s+(\d{1,2})\.(\d{1,3})\b/gi,
  examples: /\bExample\s+(\d{1,2})\.(\d{1,3})\b/gi,
};

/** Is this chunk plausibly part of an exercise / question-set block? */
function isExerciseChunk(c: AuditChunk): boolean {
  if (c.content_type && /exercise|question/i.test(c.content_type)) return true;
  return (
    /\bEXERCISES?\b/i.test(c.chunk_text.slice(0, 400)) ||
    /\bExercises\b/.test(c.chunk_text) ||
    /\bIntext\s+Questions?\b/i.test(c.chunk_text) ||
    /\bLet us enhance our learning\b/i.test(c.chunk_text)
  );
}

/**
 * Question-set header line: mid-chapter "Exercise N.M", end-of-chapter
 * "Exercises" / "Let us enhance our learning", or NCERT "Intext Questions".
 */
const SET_HEADER_RE = /\bEXERCISES?\b(?:\s+(\d{1,2}\.\d{1,3}))?|\bIntext\s+Questions?\b|\bLet us enhance our learning\b/i;

function setKeyForHeader(m: RegExpMatchArray): string {
  if (m[1]) return `exercise ${m[1]}`; // e.g. "exercise 6.1" / "exercise 6.2"
  const label = m[0].toLowerCase();
  if (label.includes('intext')) return 'intext questions';
  if (label.includes('enhance')) return 'let us enhance our learning';
  return 'exercises';
}

/**
 * Expected chapter question count via per-set numbering continuity.
 *
 * NCERT chapters carry MULTIPLE question sets (mid-chapter Exercise N.M sets,
 * the end-of-chapter Exercises, Intext Questions) and EACH SET restarts its
 * numbering at 1 — so the chapter expectation is the SUM of per-set maxima
 * (Exercise 6.1 with 6 Qs + Exercise 6.2 with 6 Qs → 12, not max 6).
 *
 * Sets are keyed by their header label so overlap-duplicated chunks (the same
 * "EXERCISE 6.1" block stored 2-3x by sliding-window chunking) MERGE into one
 * set instead of double-counting. Within a set the old safety rules hold: the
 * series must start near 1 (min ≤ 2 — a stray "42." can't fabricate
 * 42 questions) and minors above MAX_EXERCISE_QUESTION are OCR junk.
 */
export function deriveExpectedExercises(chunks: AuditChunk[]): number | null {
  const exerciseText = chunks.filter(isExerciseChunk).map((c) => c.chunk_text).join('\n');
  if (!exerciseText) return null;

  const setNums = new Map<string, number[]>();
  let currentKey = 'default';
  for (const line of exerciseText.split('\n')) {
    const header = line.match(SET_HEADER_RE);
    if (header) {
      currentKey = setKeyForHeader(header);
      if (!setNums.has(currentKey)) setNums.set(currentKey, []);
      continue;
    }
    const q = line.match(/^\s{0,4}(\d{1,2})[.)]\s+/);
    if (!q) continue;
    const n = parseInt(q[1], 10);
    if (n < 1 || n > MAX_EXERCISE_QUESTION) continue;
    const arr = setNums.get(currentKey) ?? [];
    arr.push(n);
    setNums.set(currentKey, arr);
  }

  let total = 0;
  let anyReliable = false;
  for (const nums of setNums.values()) {
    if (nums.length === 0) continue;
    if (Math.min(...nums) > 2) continue; // set doesn't start at the top — unreliable
    total += Math.max(...nums);
    anyReliable = true;
  }
  return anyReliable ? total : null;
}

/**
 * Expected count for a dimension, or null when no reliable text heuristic
 * exists. ONLY dimensions enumerable from NCERT numbering conventions get a
 * non-null expectation; everything else is measured found-only.
 */
export function deriveExpectedCounts(chunks: AuditChunk[], dimension: Dimension): number | null {
  if (dimension === 'exercises') return deriveExpectedExercises(chunks);
  const pattern = SERIES_PATTERNS[dimension];
  if (!pattern) return null;
  const fullText = chunks.map((c) => c.chunk_text).join('\n');
  // fresh regex per call — the stored ones are /g and matchAll requires it,
  // but re-derive to avoid shared lastIndex surprises across callers
  return maxSeriesIndex(fullText, new RegExp(pattern.source, pattern.flags));
}

// ─── Scan filter specs (pure query builders — executed by run-audit.ts) ──────

export interface ColumnFilter {
  column: string;
  op: 'eq' | 'in' | 'ilike' | 'either_in';
  /** literal value, or null when the value is captured from a prior step */
  value: string | number | boolean | string[] | null;
  /** name of a prior step's captured id list (for op 'in' / 'either_in') */
  valueFrom?: string;
  /** for op 'either_in': the two columns either of which may match */
  columns?: [string, string];
}

export interface ScanStep {
  table: string;
  select: string;
  filters: ColumnFilter[];
  /** capture this step's ids under this name for later steps */
  captureIdsAs?: string;
}

export interface ScanSpec {
  dimension: Dimension;
  auditMethod: 'question_bank_scan' | 'generated_content_scan';
  /** steps executed in order; the LAST step's row count = found_count */
  steps: ScanStep[];
  /** operator-facing caveat recorded nowhere student-visible */
  note?: string;
}

export interface ChapterRef {
  grade: string; // P5: string grade
  subject: string;
  chapterNumber: number;
}

const HOTS_BLOOMS = ['analyze', 'evaluate', 'create'];

/**
 * Honest dead-source caveat for the competency scan (same style as mind_maps):
 * the scan is kept because it is the correct future wiring, but today it can
 * only ever return 0 — the 0 proves nothing.
 */
export const COMPETENCY_DEAD_SOURCE_NOTE =
  'no writer currently populates cbse_question_type with competency values — 0 is unfalsifiable; repoint at cbse_competency_map linkage in a follow-up';

/**
 * question_bank scan specs (audit_method='question_bank_scan'):
 * - hots_questions:            bloom_level ∈ {analyze, evaluate, create}
 * - case_based_questions:      question_type_v2 = 'case_based'
 * - assertion_reason_questions: question_type_v2 = 'assertion_reason'
 * - competency_questions:      cbse_question_type ilike '%competency%'
 *                              (value variants unpinned in schema — ilike is
 *                              robust to 'competency' / 'competency_based').
 *                              DEAD SOURCE today: no writer populates the
 *                              column with competency values, so every row
 *                              ships with COMPETENCY_DEAD_SOURCE_NOTE (the
 *                              scan is kept as the future-proof wiring)
 * - pyqs:                      board_relevance = 'board_appeared'
 *                              (chk_board_relevance: board_appeared = actual
 *                              previous-year board questions)
 */
export function buildQuestionBankFilterSpec(
  dimension: QuestionBankScanDimension,
  ref: ChapterRef,
): ScanSpec {
  const base: ColumnFilter[] = [
    { column: 'grade', op: 'eq', value: ref.grade },
    { column: 'subject', op: 'eq', value: ref.subject },
    { column: 'chapter_number', op: 'eq', value: ref.chapterNumber },
    { column: 'is_active', op: 'eq', value: true },
  ];
  const byDimension: Record<QuestionBankScanDimension, ColumnFilter[]> = {
    hots_questions: [{ column: 'bloom_level', op: 'in', value: HOTS_BLOOMS }],
    case_based_questions: [{ column: 'question_type_v2', op: 'eq', value: 'case_based' }],
    assertion_reason_questions: [{ column: 'question_type_v2', op: 'eq', value: 'assertion_reason' }],
    competency_questions: [{ column: 'cbse_question_type', op: 'ilike', value: '%competency%' }],
    pyqs: [{ column: 'board_relevance', op: 'eq', value: 'board_appeared' }],
  };
  return {
    dimension,
    auditMethod: 'question_bank_scan',
    ...(dimension === 'competency_questions' ? { note: COMPETENCY_DEAD_SOURCE_NOTE } : {}),
    steps: [
      {
        table: 'question_bank',
        select: 'id',
        filters: [...base, ...byDimension[dimension]],
      },
    ],
  };
}

/**
 * Generated-content scan specs (audit_method='generated_content_scan'):
 * - revision_notes:      chapter_concepts deck rows for the chapter (the
 *                        curated concept cards ARE the platform's revision notes)
 * - flashcards:          spaced_repetition_cards for the chapter (note:
 *                        student-scoped instances — counts card instances, not
 *                        unique templates)
 * - concept_graph_links: concept_edges touching the chapter's curriculum_topics
 *                        (two-step: project topic ids, then count edges whose
 *                        from_topic_id OR to_topic_id is in that set)
 * - mind_maps:           NO on-platform source yet — empty spec, found 0 + note
 */
export function buildGeneratedContentFilterSpec(
  dimension: GeneratedContentScanDimension,
  ref: ChapterRef,
): ScanSpec {
  switch (dimension) {
    case 'revision_notes':
      return {
        dimension,
        auditMethod: 'generated_content_scan',
        steps: [
          {
            table: 'chapter_concepts',
            select: 'id',
            filters: [
              { column: 'grade', op: 'eq', value: ref.grade },
              { column: 'subject', op: 'eq', value: ref.subject },
              { column: 'chapter_number', op: 'eq', value: ref.chapterNumber },
              { column: 'is_active', op: 'eq', value: true },
            ],
          },
        ],
      };
    case 'flashcards':
      return {
        dimension,
        auditMethod: 'generated_content_scan',
        note: 'spaced_repetition_cards are student-scoped — counts card instances, not unique templates',
        steps: [
          {
            table: 'spaced_repetition_cards',
            select: 'id',
            filters: [
              { column: 'grade', op: 'eq', value: ref.grade },
              { column: 'subject', op: 'eq', value: ref.subject },
              { column: 'chapter_number', op: 'eq', value: ref.chapterNumber },
              { column: 'is_active', op: 'eq', value: true },
            ],
          },
        ],
      };
    case 'concept_graph_links':
      return {
        dimension,
        auditMethod: 'generated_content_scan',
        steps: [
          {
            table: 'curriculum_topics',
            select: 'id',
            captureIdsAs: 'topicIds',
            filters: [
              { column: 'grade', op: 'eq', value: ref.grade },
              { column: 'chapter_number', op: 'eq', value: ref.chapterNumber },
              { column: 'is_active', op: 'eq', value: true },
            ],
          },
          {
            table: 'concept_edges',
            select: 'id',
            filters: [
              {
                column: 'from_topic_id',
                columns: ['from_topic_id', 'to_topic_id'],
                op: 'either_in',
                value: null,
                valueFrom: 'topicIds',
              },
            ],
          },
        ],
      };
    case 'mind_maps':
      return {
        dimension,
        auditMethod: 'generated_content_scan',
        note: 'no on-platform mind-map source exists yet — recorded as found 0 pending a source',
        steps: [],
      };
  }
}

// ─── suspected_missing routing + chunk-pass row assembly ─────────────────────

/** Keyword → dimension routing for chapter-level suspected_missing labels. */
const SUSPECTED_ROUTES: Array<{ pattern: RegExp; dimension: Dimension }> = [
  { pattern: /activit/i, dimension: 'activities' },
  { pattern: /fig(ure)?\.?\s|\bdiagram/i, dimension: 'diagrams' },
  { pattern: /\btable\b/i, dimension: 'tables' },
  { pattern: /example/i, dimension: 'examples' },
  { pattern: /exercise|question/i, dimension: 'exercises' },
  { pattern: /definition/i, dimension: 'definitions' },
  { pattern: /formula|equation/i, dimension: 'formulae' },
  { pattern: /summary|what you have learnt/i, dimension: 'summary' },
  { pattern: /caption/i, dimension: 'captions' },
  { pattern: /keyword/i, dimension: 'keywords' },
  { pattern: /objective/i, dimension: 'learning_objectives' },
  { pattern: /concept/i, dimension: 'concepts' },
];

/**
 * Route chapter-level suspected_missing labels to their dimension rows by
 * keyword. Unrouted labels land on 'topics' (structural catch-all) so nothing
 * is silently dropped.
 */
export function routeSuspectedMissing(entries: string[]): Map<Dimension, string[]> {
  const out = new Map<Dimension, string[]>();
  for (const entry of entries) {
    const route = SUSPECTED_ROUTES.find((r) => r.pattern.test(entry));
    const dim: Dimension = route ? route.dimension : 'topics';
    const arr = out.get(dim) ?? [];
    arr.push(entry);
    out.set(dim, arr);
  }
  return out;
}

export const GARBLED_LABEL = 'metadata_garbled: chunk source appears OCR-corrupted; counts unreliable';

export const CONTAMINATED_LABEL =
  'CONTAMINATED: chunk source mixes foreign-chapter/book content; counts kept as evidence but series coverage untrusted';

/**
 * Series-numbered dimensions whose expected-count heuristics ride NCERT N.M
 * numbering continuity. Under contamination the numbering namespace is polluted
 * by foreign chapters (e.g. Fig. 13.x inside ch6), so coverage_pct over these
 * denominators is untrustworthy — the counts REMAIN (evidence), the trust drops.
 */
const SERIES_NUMBERED_DIMENSIONS: ReadonlySet<Dimension> = new Set([
  'diagrams',
  'activities',
  'tables',
  'examples',
  'exercises',
]);

/**
 * Assemble the 22 chunk_pass InventoryRows for one chapter from the parsed
 * model response. Evidence = chunk ids only (P13). When metadata_garbled is
 * true, every chunk-pass row carries the GARBLED_LABEL in suspected_missing so
 * gap queries can't mistake corrupt-source zeros for genuine absence. When
 * content_contaminated is true, every row likewise carries CONTAMINATED_LABEL
 * (count-as-is + flag — never abstain) and coverage_pct is NULLed for the
 * series-numbered dimensions whose denominators contamination poisons.
 */
export function buildChunkPassRows(args: {
  syllabusId: string;
  parsed: ParsedAudit;
  chunks: AuditChunk[];
}): InventoryRow[] {
  const { syllabusId, parsed, chunks } = args;
  const routed = routeSuspectedMissing(parsed.suspectedMissing);
  return CHUNK_PASS_DIMENSIONS.map((dimension) => {
    const finding = parsed.dimensions[dimension];
    const expected = deriveExpectedCounts(chunks, dimension);
    const suspected = [...(routed.get(dimension) ?? [])];
    if (parsed.metadataGarbled) suspected.push(GARBLED_LABEL);
    if (parsed.contentContaminated) suspected.push(CONTAMINATED_LABEL);
    const coverageUntrusted = parsed.contentContaminated && SERIES_NUMBERED_DIMENSIONS.has(dimension);
    return {
      syllabus_id: syllabusId,
      dimension,
      expected_count: expected,
      found_count: finding.found_count,
      coverage_pct: coverageUntrusted ? null : computeCoverage(finding.found_count, expected),
      evidence: finding.evidence_chunk_ids,
      audit_method: 'chunk_pass' as const,
      suspected_missing: suspected,
    };
  });
}
