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
 *   parsed model response (evidence ids only — P13).
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

/** Is this chunk plausibly part of an end-of-chapter exercise block? */
function isExerciseChunk(c: AuditChunk): boolean {
  if (c.content_type && /exercise|question/i.test(c.content_type)) return true;
  return /\bEXERCISES?\b/i.test(c.chunk_text.slice(0, 400)) || /\bExercises\b/.test(c.chunk_text);
}

/**
 * Exercise question count via numbering continuity: within exercise-flagged
 * chunks, find line-start question numbers ("7." / "7)") and return the max
 * plausible question number. Requires the series to start near 1 (Q1 or Q2
 * observed) so a stray "42." in prose can't fabricate 42 questions.
 */
export function deriveExpectedExercises(chunks: AuditChunk[]): number | null {
  const exerciseText = chunks.filter(isExerciseChunk).map((c) => c.chunk_text).join('\n');
  if (!exerciseText) return null;
  const nums: number[] = [];
  for (const m of exerciseText.matchAll(/^\s{0,4}(\d{1,2})[.)]\s+/gm)) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= MAX_EXERCISE_QUESTION) nums.push(n);
  }
  if (nums.length === 0) return null;
  const min = Math.min(...nums);
  if (min > 2) return null; // series doesn't start at the top — unreliable
  return Math.max(...nums);
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
 * question_bank scan specs (audit_method='question_bank_scan'):
 * - hots_questions:            bloom_level ∈ {analyze, evaluate, create}
 * - case_based_questions:      question_type_v2 = 'case_based'
 * - assertion_reason_questions: question_type_v2 = 'assertion_reason'
 * - competency_questions:      cbse_question_type ilike '%competency%'
 *                              (value variants unpinned in schema — ilike is
 *                              robust to 'competency' / 'competency_based')
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

/**
 * Assemble the 22 chunk_pass InventoryRows for one chapter from the parsed
 * model response. Evidence = chunk ids only (P13). When metadata_garbled is
 * true, every chunk-pass row carries the GARBLED_LABEL in suspected_missing so
 * gap queries can't mistake corrupt-source zeros for genuine absence.
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
    return {
      syllabus_id: syllabusId,
      dimension,
      expected_count: expected,
      found_count: finding.found_count,
      coverage_pct: computeCoverage(finding.found_count, expected),
      evidence: finding.evidence_chunk_ids,
      audit_method: 'chunk_pass' as const,
      suspected_missing: suspected,
    };
  });
}
