/**
 * Coverage math, expected-count heuristics on synthetic NCERT-style text, scan
 * filter-spec builders, v2 finding composition, and chunk-pass row assembly.
 * Pure — no network, no DB.
 *
 * v2 ADAPTATIONS (engine redesign, 2026-07-03): buildChunkPassRows now consumes
 * a code-composed ChapterFindings (structural scan + semantic batch merge +
 * code contamination) instead of the retired v1 single-pass LLM response —
 * test fixtures are built directly via makeFindings() rather than through
 * parseAuditResponse. deriveExpectedExercises/maxSeriesIndex/isExerciseChunk
 * MOVED to structural-scan.ts; coverage.ts re-exports them, and these tests
 * keep importing from coverage.ts to pin that compatibility surface.
 */
import { describe, it, expect } from 'vitest';

import {
  ALL_DIMENSIONS,
  type AuditChunk,
  type Dimension,
  type DimensionFinding,
} from '../../../../scripts/knowledge-audit/dimensions';
import {
  buildChunkPassRows,
  buildGeneratedContentFilterSpec,
  buildQuestionBankFilterSpec,
  COMPETENCY_DEAD_SOURCE_NOTE,
  composeChapterFindings,
  computeCoverage,
  CONTAMINATED_LABEL,
  deriveExpectedCounts,
  deriveExpectedExercises,
  GARBLED_LABEL,
  maxSeriesIndex,
  routeSuspectedMissing,
  type ChapterFindings,
} from '../../../../scripts/knowledge-audit/coverage';
import { runStructuralScan } from '../../../../scripts/knowledge-audit/structural-scan';
import { mergeSemanticBatches, parseSemanticBatchResponse } from '../../../../scripts/knowledge-audit/parse-semantic';

const REF = { grade: '6', subject: 'science', chapterNumber: 4 };

function chunk(id: string, text: string, type: string | null = null): AuditChunk {
  return { chunk_id: id, chunk_text: text, content_type: type };
}

/** Build a ChapterFindings fixture directly (v1 built these via parseAuditResponse). */
function makeFindings(
  dims: Partial<Record<Dimension, Partial<DimensionFinding>>> = {},
  flags: Partial<Omit<ChapterFindings, 'dimensions'>> = {},
): ChapterFindings {
  const dimensions = {} as Record<Dimension, DimensionFinding>;
  for (const d of ALL_DIMENSIONS) {
    dimensions[d] = { found_count: 0, evidence_chunk_ids: [], notes: '', ...(dims[d] ?? {}) };
  }
  return {
    dimensions,
    metadataGarbled: false,
    contentContaminated: false,
    contaminationEvidence: [],
    suspectedMissing: [],
    ...flags,
  };
}

describe('computeCoverage', () => {
  it('is null when expected is null (no denominator)', () => {
    expect(computeCoverage(5, null)).toBeNull();
  });

  it('is null when expected is zero or negative', () => {
    expect(computeCoverage(5, 0)).toBeNull();
    expect(computeCoverage(5, -2)).toBeNull();
  });

  it('computes pct to 2dp', () => {
    expect(computeCoverage(1, 3)).toBe(33.33);
    expect(computeCoverage(2, 3)).toBe(66.67);
    expect(computeCoverage(3, 3)).toBe(100);
    expect(computeCoverage(0, 7)).toBe(0);
  });

  it('clamps to 100 when found exceeds the heuristic floor (DB CHECK is 0..100)', () => {
    expect(computeCoverage(9, 6)).toBe(100);
  });

  it('treats negative found as 0', () => {
    expect(computeCoverage(-3, 6)).toBe(0);
  });

  // Strengthened 2026-07-03 (testing review): the exact 0/0 pair and
  // non-finite denominators were previously untested — pin the
  // division-by-zero guard directly.
  it('0/0 is null (no denominator), never NaN', () => {
    expect(computeCoverage(0, 0)).toBeNull();
  });

  it('non-finite expected (NaN / Infinity) is null', () => {
    expect(computeCoverage(5, NaN)).toBeNull();
    expect(computeCoverage(5, Infinity)).toBeNull();
  });
});

describe('maxSeriesIndex / numbering-gap heuristics', () => {
  it('a numbering gap implies expected >= max minor (Fig 4.1 -> 4.3 means >= 3)', () => {
    const text = 'See Fig. 4.1 for wood. Later, Fig. 4.3 shows metals.';
    expect(maxSeriesIndex(text, /\bFig(?:ure)?\.?\s*(\d{1,2})\.(\d{1,3})\b/gi)).toBe(3);
  });

  it('picks the dominant major (chapter) and ignores minority cross-chapter references', () => {
    const text = 'Activity 4.1 ... Activity 4.2 ... Activity 4.5 ... recall Activity 2.9 from Chapter 2.';
    expect(maxSeriesIndex(text, /\bActivity\s+(\d{1,2})\.(\d{1,3})\b/gi)).toBe(5);
  });

  it('returns null when no dotted series exists', () => {
    expect(maxSeriesIndex('No numbered items here.', /\bActivity\s+(\d{1,2})\.(\d{1,3})\b/gi)).toBeNull();
  });

  it('ignores OCR junk minor indices above the sanity ceiling', () => {
    const text = 'Fig. 4.2019 is OCR junk. Fig. 4.2 is real.';
    expect(maxSeriesIndex(text, /\bFig(?:ure)?\.?\s*(\d{1,2})\.(\d{1,3})\b/gi)).toBe(2);
  });

  // Strengthened 2026-07-03 (testing review): "4.2019" is rejected by the
  // regex word-boundary (backtracking can never satisfy \b), NOT by the
  // MAX_MINOR_INDEX ceiling — verified empirically. The two tests below hit
  // the ceiling / floor branches themselves, which were previously untested.
  it('MAX_MINOR_INDEX ceiling: a 3-digit minor like "4.150" matches the regex but is rejected by the ceiling', () => {
    const junkOnly = 'Fig. 4.150 is OCR junk with no real figures.';
    expect(maxSeriesIndex(junkOnly, /\bFig(?:ure)?\.?\s*(\d{1,2})\.(\d{1,3})\b/gi)).toBeNull();
    const mixed = 'Fig. 4.150 is OCR junk. Fig. 4.3 is real.';
    expect(maxSeriesIndex(mixed, /\bFig(?:ure)?\.?\s*(\d{1,2})\.(\d{1,3})\b/gi)).toBe(3);
  });

  it('minor index 0 ("Activity 4.0") is rejected (series indices start at 1)', () => {
    const text = 'Activity 4.0 is a numbering artifact. Activity 4.2 is real.';
    expect(maxSeriesIndex(text, /\bActivity\s+(\d{1,2})\.(\d{1,3})\b/gi)).toBe(2);
    expect(maxSeriesIndex('Activity 4.0 alone', /\bActivity\s+(\d{1,2})\.(\d{1,3})\b/gi)).toBeNull();
  });
});

describe('deriveExpectedCounts (synthetic NCERT-style text)', () => {
  const chunks = [
    chunk('c1', 'Activity 4.1: Collect objects. Activity 4.2: Group them. We will revisit Activity 4.2 later.'),
    chunk('c2', 'Fig. 4.1 shows wood objects. Figure 4.4 shows metals. Table 4.1 lists materials.'),
    chunk('c3', 'Example 4.1: classify a spoon. Example 4.2: classify a book.'),
  ];

  it('activities: distinct-number continuity', () => {
    expect(deriveExpectedCounts(chunks, 'activities')).toBe(2);
  });

  it('diagrams: Fig numbering gap 4.1 -> 4.4 implies expected >= 4', () => {
    expect(deriveExpectedCounts(chunks, 'diagrams')).toBe(4);
  });

  it('tables and examples: series max', () => {
    expect(deriveExpectedCounts(chunks, 'tables')).toBe(1);
    expect(deriveExpectedCounts(chunks, 'examples')).toBe(2);
  });

  it('dimensions with no reliable heuristic return null (measured found-only)', () => {
    expect(deriveExpectedCounts(chunks, 'definitions')).toBeNull();
    expect(deriveExpectedCounts(chunks, 'summary')).toBeNull();
    expect(deriveExpectedCounts(chunks, 'concepts')).toBeNull();
    expect(deriveExpectedCounts(chunks, 'pages')).toBeNull();
  });
});

describe('deriveExpectedExercises (question-number continuity)', () => {
  it('counts to the max question number in exercise-flagged chunks', () => {
    const chunks = [
      chunk('c1', 'Some concept prose. 42. is a number in prose that must not count.'),
      chunk('ex', 'EXERCISES\n1. What is matter?\n2. Name three materials.\n3. Why do we group?\n7. Last question.', 'exercise'),
    ];
    expect(deriveExpectedExercises(chunks)).toBe(7);
  });

  it('detects exercise blocks by content_type OR an Exercises header in text', () => {
    const byHeader = [chunk('c1', 'Exercises\n1. Q one.\n2. Q two.')];
    expect(deriveExpectedExercises(byHeader)).toBe(2);
  });

  it('returns null when the numbering series does not start near 1 (unreliable)', () => {
    const chunks = [chunk('ex', 'EXERCISES\n9. stray item\n12. another', 'exercise')];
    expect(deriveExpectedExercises(chunks)).toBeNull();
  });

  it('returns null when no exercise chunks exist', () => {
    expect(deriveExpectedExercises([chunk('c1', 'pure prose, no questions')])).toBeNull();
  });

  // Strengthened 2026-07-03 (testing review): the MAX_EXERCISE_QUESTION
  // ceiling (80) was previously untested — the existing "42." case is caught
  // by chunk filtering, not by the ceiling.
  it('MAX_EXERCISE_QUESTION ceiling: a line-start "99." inside an exercise chunk cannot inflate the count', () => {
    const chunks = [
      chunk('ex', 'EXERCISES\n1. What is matter?\n2. Name materials.\n99. OCR page-number junk.', 'exercise'),
    ];
    expect(deriveExpectedExercises(chunks)).toBe(2);
  });

  // Assessment condition 4c (2026-07-03): question SETS restart numbering at 1,
  // so the chapter expectation SUMS across distinct sets — not max of one pool.
  it('SUMS across distinct Exercise N.M sets (6.1 with 6 Qs + 6.2 with 6 Qs -> 12, not 6)', () => {
    const chunks = [
      chunk('ex1', 'EXERCISE 6.1\n1. Q\n2. Q\n3. Q\n4. Q\n5. Q\n6. Q', 'exercise'),
      chunk('ex2', 'EXERCISE 6.2\n1. Q\n2. Q\n3. Q\n4. Q\n5. Q\n6. Q', 'exercise'),
    ];
    expect(deriveExpectedExercises(chunks)).toBe(12);
  });

  it('Intext Questions count as their own set and are summed with end-of-chapter Exercises', () => {
    const chunks = [
      chunk('it', 'Intext Questions\n1. Define molarity.\n2. State Henry law.', null),
      chunk('ex', 'EXERCISES\n1. Q\n2. Q\n3. Q\n4. Q\n5. Q', 'exercise'),
    ];
    expect(deriveExpectedExercises(chunks)).toBe(7);
  });

  it('"Let us enhance our learning" (new-NCERT exercises name) is recognised as a question set', () => {
    const chunks = [chunk('c1', 'Let us enhance our learning\n1. Q one.\n2. Q two.\n3. Q three.', null)];
    expect(deriveExpectedExercises(chunks)).toBe(3);
  });

  it('overlap-duplicated set headers MERGE by label instead of double-counting (same EXERCISE 6.1 stored twice)', () => {
    const chunks = [
      chunk('a', 'EXERCISE 6.1\n1. Q\n2. Q\n3. Q', 'exercise'),
      chunk('b', 'EXERCISE 6.1\n2. Q\n3. Q\n4. Q', 'exercise'), // sliding-window overlap
    ];
    expect(deriveExpectedExercises(chunks)).toBe(4);
  });

  it('an unreliable set (numbering not starting near 1) is skipped without poisoning reliable sets', () => {
    const chunks = [
      chunk('ex1', 'EXERCISE 6.1\n1. Q\n2. Q\n3. Q', 'exercise'),
      chunk('ex2', 'EXERCISE 6.2\n9. stray\n12. stray', 'exercise'),
    ];
    expect(deriveExpectedExercises(chunks)).toBe(3);
  });
});

describe('buildQuestionBankFilterSpec (pure query builder)', () => {
  it('always scopes by grade (string, P5) + subject + chapter + is_active', () => {
    const spec = buildQuestionBankFilterSpec('hots_questions', REF);
    expect(spec.auditMethod).toBe('question_bank_scan');
    expect(spec.steps).toHaveLength(1);
    const filters = spec.steps[0].filters;
    expect(filters).toContainEqual({ column: 'grade', op: 'eq', value: '6' });
    expect(filters).toContainEqual({ column: 'subject', op: 'eq', value: 'science' });
    expect(filters).toContainEqual({ column: 'chapter_number', op: 'eq', value: 4 });
    expect(filters).toContainEqual({ column: 'is_active', op: 'eq', value: true });
    expect(spec.steps[0].table).toBe('question_bank');
  });

  it('hots -> higher-order blooms; case/AR -> question_type_v2; pyqs -> board_appeared; competency -> ilike', () => {
    expect(buildQuestionBankFilterSpec('hots_questions', REF).steps[0].filters).toContainEqual({
      column: 'bloom_level', op: 'in', value: ['analyze', 'evaluate', 'create'],
    });
    expect(buildQuestionBankFilterSpec('case_based_questions', REF).steps[0].filters).toContainEqual({
      column: 'question_type_v2', op: 'eq', value: 'case_based',
    });
    expect(buildQuestionBankFilterSpec('assertion_reason_questions', REF).steps[0].filters).toContainEqual({
      column: 'question_type_v2', op: 'eq', value: 'assertion_reason',
    });
    expect(buildQuestionBankFilterSpec('pyqs', REF).steps[0].filters).toContainEqual({
      column: 'board_relevance', op: 'eq', value: 'board_appeared',
    });
    expect(buildQuestionBankFilterSpec('competency_questions', REF).steps[0].filters).toContainEqual({
      column: 'cbse_question_type', op: 'ilike', value: '%competency%',
    });
  });

  // Assessment condition 3 (2026-07-03): the competency scan is a DEAD SOURCE
  // today — the honest caveat must ship with every row (mind_maps style).
  it('competency_questions carries the dead-source note on every spec (0 is unfalsifiable)', () => {
    const spec = buildQuestionBankFilterSpec('competency_questions', REF);
    expect(spec.note).toBe(COMPETENCY_DEAD_SOURCE_NOTE);
    expect(spec.note).toMatch(/no writer currently populates cbse_question_type/);
    expect(spec.note).toMatch(/0 is unfalsifiable/);
    expect(spec.note).toMatch(/cbse_competency_map/);
    // the scan itself is kept (future-proof wiring)
    expect(spec.steps).toHaveLength(1);
    // no other question-bank dimension gets the note
    for (const dim of ['hots_questions', 'case_based_questions', 'assertion_reason_questions', 'pyqs'] as const) {
      expect(buildQuestionBankFilterSpec(dim, REF).note).toBeUndefined();
    }
  });
});

describe('buildGeneratedContentFilterSpec (pure query builder)', () => {
  it('revision_notes -> chapter_concepts; flashcards -> spaced_repetition_cards', () => {
    expect(buildGeneratedContentFilterSpec('revision_notes', REF).steps[0].table).toBe('chapter_concepts');
    expect(buildGeneratedContentFilterSpec('flashcards', REF).steps[0].table).toBe('spaced_repetition_cards');
  });

  it('concept_graph_links -> two-step curriculum_topics projection into concept_edges either-endpoint match', () => {
    const spec = buildGeneratedContentFilterSpec('concept_graph_links', REF);
    expect(spec.steps).toHaveLength(2);
    expect(spec.steps[0].table).toBe('curriculum_topics');
    expect(spec.steps[0].captureIdsAs).toBe('topicIds');
    expect(spec.steps[1].table).toBe('concept_edges');
    const edgeFilter = spec.steps[1].filters[0];
    expect(edgeFilter.op).toBe('either_in');
    expect(edgeFilter.columns).toEqual(['from_topic_id', 'to_topic_id']);
    expect(edgeFilter.valueFrom).toBe('topicIds');
  });

  it('mind_maps has no on-platform source: empty steps + explanatory note', () => {
    const spec = buildGeneratedContentFilterSpec('mind_maps', REF);
    expect(spec.steps).toHaveLength(0);
    expect(spec.note).toMatch(/no on-platform mind-map source/);
  });
});

describe('routeSuspectedMissing', () => {
  it('routes labels to their dimension by keyword; unrouted labels land on topics', () => {
    const routed = routeSuspectedMissing([
      'Activity 4.5 referenced but not present',
      'Fig. 4.2 missing (numbering gap)',
      'Exercise section truncated after Q7',
      'something completely unclassifiable',
    ]);
    expect(routed.get('activities')).toEqual(['Activity 4.5 referenced but not present']);
    expect(routed.get('diagrams')).toEqual(['Fig. 4.2 missing (numbering gap)']);
    expect(routed.get('exercises')).toEqual(['Exercise section truncated after Q7']);
    expect(routed.get('topics')).toEqual(['something completely unclassifiable']);
  });
});

describe('composeChapterFindings (v2 three-lane composition)', () => {
  const chunks = [
    chunk('c-1', '4.1 Sorting Materials We group materials. Activity 4.1 Collect objects. Fig. 4.1: Objects made of wood. Fig. 4.3: Metal objects.'),
    chunk('c-2', 'A material with lustre is called lustrous.'),
  ];
  const structural = runStructuralScan(chunks, 4);
  const semanticBatch = parseSemanticBatchResponse(
    JSON.stringify({
      dimensions: { definitions: { items: ['lustrous'], evidence_chunk_ids: ['c-2'] } },
      metadata_garbled: false,
      suspected_missing: ['Fig. 4.2 referenced but not present'],
    }),
    ['c-1', 'c-2'],
  );
  if (!semanticBatch.ok) throw new Error('semantic fixture parse failed');
  const semantic = mergeSemanticBatches([semanticBatch]);

  it('merges structural (deterministic) + semantic (LLM) + contamination (code) into all 31 dims', () => {
    const findings = composeChapterFindings({
      structural,
      semantic,
      contamination: { contaminated: false, evidence: [] },
    });
    expect(Object.keys(findings.dimensions)).toHaveLength(31);
    // structural lane: exact deterministic counts with the deterministic note
    expect(findings.dimensions.diagrams.found_count).toBe(2);
    expect(findings.dimensions.diagrams.notes).toMatch(/deterministic structural scan/);
    expect(findings.dimensions.activities.found_count).toBe(1);
    expect(findings.dimensions.headings.found_count).toBe(1);
    // semantic lane: label-deduped items
    expect(findings.dimensions.definitions.found_count).toBe(1);
    expect(findings.dimensions.definitions.notes).toMatch(/semantic batch pass/);
    // scan lane: 0-filled placeholders (overwritten later by DB scans)
    expect(findings.dimensions.hots_questions.found_count).toBe(0);
    expect(findings.dimensions.hots_questions.notes).toBe('measured by scan lane');
  });

  it('unions deterministic gap labels with LLM suspected_missing, deduped', () => {
    const findings = composeChapterFindings({
      structural,
      semantic,
      contamination: { contaminated: false, evidence: [] },
    });
    // structural gap (Fig 4.1 → 4.3) AND the LLM label both survive
    expect(findings.suspectedMissing).toContain('Fig. 4.2 absent (numbering gap)');
    expect(findings.suspectedMissing).toContain('Fig. 4.2 referenced but not present');
  });

  it('contamination comes from code, not the model', () => {
    const findings = composeChapterFindings({
      structural,
      semantic,
      contamination: { contaminated: true, evidence: ['multiple summary blocks (2)'] },
    });
    expect(findings.contentContaminated).toBe(true);
    expect(findings.contaminationEvidence).toEqual(['multiple summary blocks (2)']);
  });

  it('metadata_garbled propagates from the semantic pass (OR across batches)', () => {
    const findings = composeChapterFindings({
      structural,
      semantic: { ...semantic, metadataGarbled: true },
      contamination: { contaminated: false, evidence: [] },
    });
    expect(findings.metadataGarbled).toBe(true);
  });
});

describe('buildChunkPassRows (row assembly, P13)', () => {
  const chunks = [
    chunk('c-1', 'Activity 4.1 do this. Activity 4.2 do that.'),
    chunk('c-2', 'Fig. 4.1 and Fig. 4.3 are shown.'),
  ];
  const findings = makeFindings(
    {
      activities: { found_count: 2, evidence_chunk_ids: ['c-1'] },
      diagrams: { found_count: 2, evidence_chunk_ids: ['c-2'] },
    },
    { suspectedMissing: ['Fig. 4.2 missing (numbering gap)'] },
  );

  it('emits exactly the 22 chunk_pass rows with method chunk_pass', () => {
    const rows = buildChunkPassRows({ syllabusId: 'syl-1', findings, chunks });
    expect(rows).toHaveLength(22);
    expect(rows.every((r) => r.audit_method === 'chunk_pass')).toBe(true);
    expect(rows.every((r) => r.syllabus_id === 'syl-1')).toBe(true);
  });

  it('wires found/expected/coverage together (diagram gap 4.1->4.3 => expected 3, found 2 => 66.67%)', () => {
    const rows = buildChunkPassRows({ syllabusId: 'syl-1', findings, chunks });
    const diagrams = rows.find((r) => r.dimension === 'diagrams')!;
    expect(diagrams.found_count).toBe(2);
    expect(diagrams.expected_count).toBe(3);
    expect(diagrams.coverage_pct).toBe(66.67);
    const activities = rows.find((r) => r.dimension === 'activities')!;
    expect(activities.expected_count).toBe(2);
    expect(activities.coverage_pct).toBe(100);
  });

  it('evidence carries chunk IDs only and suspected_missing routes to the right row (P13: labels/ids only)', () => {
    const rows = buildChunkPassRows({ syllabusId: 'syl-1', findings, chunks });
    const diagrams = rows.find((r) => r.dimension === 'diagrams')!;
    expect(diagrams.evidence).toEqual(['c-2']);
    expect(diagrams.suspected_missing).toEqual(['Fig. 4.2 missing (numbering gap)']);
    // no row may ever carry chunk text
    for (const r of rows) {
      for (const ev of r.evidence) expect(ev.length).toBeLessThan(64);
    }
  });

  it('metadata_garbled taints every chunk-pass row with the garbled label', () => {
    const garbled = makeFindings({}, { metadataGarbled: true });
    const rows = buildChunkPassRows({ syllabusId: 'syl-1', findings: garbled, chunks });
    expect(rows.every((r) => r.suspected_missing.includes(GARBLED_LABEL))).toBe(true);
  });

  // Assessment condition 1 (2026-07-03): contamination = count-as-is + flag.
  // Counts stay as evidence; every row is tainted with CONTAMINATED_LABEL; and
  // coverage_pct is NULLed for the series-numbered dimensions whose N.M
  // denominators a foreign chapter pollutes. (v2: the flag now originates from
  // contamination.ts — code-computed — instead of the model, so this path is
  // actually reachable.)
  describe('content_contaminated handling', () => {
    const contaminated = makeFindings(
      {
        activities: { found_count: 2, evidence_chunk_ids: ['c-1'] },
        diagrams: { found_count: 2, evidence_chunk_ids: ['c-2'] },
        definitions: { found_count: 5, evidence_chunk_ids: ['c-1'] },
      },
      {
        contentContaminated: true,
        contaminationEvidence: ['second SUMMARY block', 'foreign major-number series 13.x'],
      },
    );

    it('taints every chunk-pass row with CONTAMINATED_LABEL while counts remain', () => {
      const rows = buildChunkPassRows({ syllabusId: 'syl-1', findings: contaminated, chunks });
      expect(rows.every((r) => r.suspected_missing.includes(CONTAMINATED_LABEL))).toBe(true);
      expect(rows.find((r) => r.dimension === 'activities')!.found_count).toBe(2);
      expect(rows.find((r) => r.dimension === 'diagrams')!.found_count).toBe(2);
      expect(rows.find((r) => r.dimension === 'definitions')!.found_count).toBe(5);
    });

    it('NULLs coverage_pct for series-numbered dimensions but keeps expected_count as evidence', () => {
      const rows = buildChunkPassRows({ syllabusId: 'syl-1', findings: contaminated, chunks });
      for (const dim of ['diagrams', 'activities', 'tables', 'examples', 'exercises'] as const) {
        expect(rows.find((r) => r.dimension === dim)!.coverage_pct).toBeNull();
      }
      // the denominators themselves stay recorded (trust drops, evidence remains)
      const diagrams = rows.find((r) => r.dimension === 'diagrams')!;
      expect(diagrams.expected_count).toBe(3); // Fig 4.1 -> 4.3 gap in the fixture chunks
      expect(diagrams.found_count).toBe(2);
    });

    it('uncontaminated chapters keep series coverage (regression guard on the clean path)', () => {
      const rows = buildChunkPassRows({ syllabusId: 'syl-1', findings, chunks });
      expect(rows.find((r) => r.dimension === 'diagrams')!.coverage_pct).toBe(66.67);
      expect(rows.every((r) => !r.suspected_missing.includes(CONTAMINATED_LABEL))).toBe(true);
    });

    it('garbled + contaminated stack both labels', () => {
      const both = makeFindings({}, { metadataGarbled: true, contentContaminated: true });
      const rows = buildChunkPassRows({ syllabusId: 'syl-1', findings: both, chunks });
      expect(rows.every((r) => r.suspected_missing.includes(GARBLED_LABEL))).toBe(true);
      expect(rows.every((r) => r.suspected_missing.includes(CONTAMINATED_LABEL))).toBe(true);
    });
  });
});
