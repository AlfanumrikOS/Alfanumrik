/**
 * Wave 1 Task 1.2 — coverage math, expected-count heuristics on synthetic
 * NCERT-style text, scan filter-spec builders, and chunk-pass row assembly.
 * Pure — no network, no DB.
 */
import { describe, it, expect } from 'vitest';

import type { AuditChunk } from '../../../../scripts/knowledge-audit/dimensions';
import {
  buildChunkPassRows,
  buildGeneratedContentFilterSpec,
  buildQuestionBankFilterSpec,
  computeCoverage,
  deriveExpectedCounts,
  deriveExpectedExercises,
  GARBLED_LABEL,
  maxSeriesIndex,
  routeSuspectedMissing,
} from '../../../../scripts/knowledge-audit/coverage';
import { parseAuditResponse } from '../../../../scripts/knowledge-audit/parse-response';

const REF = { grade: '6', subject: 'science', chapterNumber: 4 };

function chunk(id: string, text: string, type: string | null = null): AuditChunk {
  return { chunk_id: id, chunk_text: text, content_type: type };
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

describe('buildChunkPassRows (row assembly, P13)', () => {
  const chunks = [
    chunk('c-1', 'Activity 4.1 do this. Activity 4.2 do that.'),
    chunk('c-2', 'Fig. 4.1 and Fig. 4.3 are shown.'),
  ];
  const parsed = parseAuditResponse(
    JSON.stringify({
      dimensions: {
        activities: { found_count: 2, evidence_chunk_ids: ['c-1'], notes: '' },
        diagrams: { found_count: 2, evidence_chunk_ids: ['c-2'], notes: '' },
      },
      metadata_garbled: false,
      suspected_missing: ['Fig. 4.2 missing (numbering gap)'],
    }),
    ['c-1', 'c-2'],
  );
  if (!parsed.ok) throw new Error('fixture parse failed');

  it('emits exactly the 22 chunk_pass rows with method chunk_pass', () => {
    const rows = buildChunkPassRows({ syllabusId: 'syl-1', parsed, chunks });
    expect(rows).toHaveLength(22);
    expect(rows.every((r) => r.audit_method === 'chunk_pass')).toBe(true);
    expect(rows.every((r) => r.syllabus_id === 'syl-1')).toBe(true);
  });

  it('wires found/expected/coverage together (diagram gap 4.1->4.3 => expected 3, found 2 => 66.67%)', () => {
    const rows = buildChunkPassRows({ syllabusId: 'syl-1', parsed, chunks });
    const diagrams = rows.find((r) => r.dimension === 'diagrams')!;
    expect(diagrams.found_count).toBe(2);
    expect(diagrams.expected_count).toBe(3);
    expect(diagrams.coverage_pct).toBe(66.67);
    const activities = rows.find((r) => r.dimension === 'activities')!;
    expect(activities.expected_count).toBe(2);
    expect(activities.coverage_pct).toBe(100);
  });

  it('evidence carries chunk IDs only and suspected_missing routes to the right row (P13: labels/ids only)', () => {
    const rows = buildChunkPassRows({ syllabusId: 'syl-1', parsed, chunks });
    const diagrams = rows.find((r) => r.dimension === 'diagrams')!;
    expect(diagrams.evidence).toEqual(['c-2']);
    expect(diagrams.suspected_missing).toEqual(['Fig. 4.2 missing (numbering gap)']);
    // no row may ever carry chunk text
    for (const r of rows) {
      for (const ev of r.evidence) expect(ev.length).toBeLessThan(64);
    }
  });

  it('metadata_garbled taints every chunk-pass row with the garbled label', () => {
    const garbled = parseAuditResponse(
      JSON.stringify({ dimensions: {}, metadata_garbled: true, suspected_missing: [] }),
      ['c-1'],
    );
    if (!garbled.ok) throw new Error('fixture parse failed');
    const rows = buildChunkPassRows({ syllabusId: 'syl-1', parsed: garbled, chunks });
    expect(rows.every((r) => r.suspected_missing.includes(GARBLED_LABEL))).toBe(true);
  });
});
