/**
 * Wave 1 Task 1.2 — knowledge-audit prompt builder (pure, no network).
 * Verifies: dimension model integrity, prompt shape, evidence-grounding
 * instructions, NCERT counting conventions, and P13 (ids-only evidence).
 */
import { describe, it, expect } from 'vitest';

import {
  ALL_DIMENSIONS,
  CHUNK_PASS_DIMENSIONS,
  GENERATED_CONTENT_SCAN_DIMENSIONS,
  QUESTION_BANK_SCAN_DIMENSIONS,
  type AuditChunk,
} from '../../../../scripts/knowledge-audit/dimensions';
import {
  buildAuditSystemPrompt,
  buildAuditUserMessage,
  buildOutputContract,
  estimateTokens,
} from '../../../../scripts/knowledge-audit/prompt';

const CTX = { grade: '6', subject: 'science', chapterNumber: 4, chapterTitle: 'Sorting Materials into Groups' };

const CHUNKS: AuditChunk[] = [
  { chunk_id: 'aaaa-1', chunk_text: 'Activity 4.1 Collect objects around you.', content_type: 'activity' },
  { chunk_id: 'aaaa-2', chunk_text: 'Fig. 4.1 shows objects made of wood.', content_type: 'concept' },
];

describe('dimension model', () => {
  it('has exactly 31 dimensions with no duplicates across the three lanes', () => {
    expect(ALL_DIMENSIONS).toHaveLength(31);
    expect(new Set(ALL_DIMENSIONS).size).toBe(31);
    expect(CHUNK_PASS_DIMENSIONS).toHaveLength(22);
    expect(QUESTION_BANK_SCAN_DIMENSIONS).toHaveLength(5);
    expect(GENERATED_CONTENT_SCAN_DIMENSIONS).toHaveLength(4);
  });

  it('matches the migration CHECK constraint dimension list exactly', () => {
    const migrationDims = [
      'pages', 'headings', 'topics', 'subtopics', 'concepts', 'learning_objectives', 'definitions', 'formulae',
      'examples', 'solved_examples', 'exercises', 'activities', 'hots_questions', 'case_based_questions',
      'assertion_reason_questions', 'competency_questions', 'common_mistakes', 'prerequisites',
      'concept_graph_links', 'real_world_applications', 'tables', 'diagrams', 'image_explanations',
      'captions', 'summary', 'keywords', 'revision_notes', 'mind_maps', 'flashcards', 'pyqs',
      'difficulty_mapping',
    ];
    expect([...ALL_DIMENSIONS].sort()).toEqual([...migrationDims].sort());
  });
});

describe('buildAuditSystemPrompt', () => {
  const prompt = buildAuditSystemPrompt(CTX);

  it('anchors the auditor to the grade/subject/chapter', () => {
    expect(prompt).toContain('Class 6 science');
    expect(prompt).toContain('Chapter 4');
    expect(prompt).toContain('Sorting Materials into Groups');
  });

  it('instructs evidence-grounded counting: only what is present, never infer from titles', () => {
    expect(prompt).toMatch(/Count ONLY what is present/i);
    expect(prompt).toMatch(/NEVER infer counts from the chapter title/i);
  });

  it('spells out NCERT conventions: Activity N.M, distinct Fig counting, solved-example-with-steps, exercise question counting, formal definitions', () => {
    expect(prompt).toContain('Activity N.M');
    expect(prompt).toMatch(/figure referenced multiple times counts ONCE/i);
    expect(prompt).toMatch(/worked solution with steps/i);
    expect(prompt).toMatch(/count INDIVIDUAL questions/i);
    expect(prompt).toMatch(/is defined as/i);
  });

  it('mentions every chunk-pass dimension by name and no scan-lane dimension', () => {
    for (const d of CHUNK_PASS_DIMENSIONS) expect(prompt).toContain(d);
    // scan-lane dims are measured elsewhere — the model must not be asked for them
    for (const d of [...QUESTION_BANK_SCAN_DIMENSIONS, ...GENERATED_CONTENT_SCAN_DIMENSIONS]) {
      expect(prompt).not.toContain(`"${d}"`);
    }
  });

  it('demands ids-only evidence (max 5) and label-only suspected_missing (P13)', () => {
    expect(prompt).toMatch(/UP TO 5 chunk ids/i);
    expect(prompt).toMatch(/never quote chunk text/i);
    expect(prompt).toMatch(/Labels only/i);
  });

  it('embeds a strict JSON output contract containing all 22 chunk-pass dimensions', () => {
    const contract = buildOutputContract();
    expect(prompt).toContain(contract);
    for (const d of CHUNK_PASS_DIMENSIONS) expect(contract).toContain(`"${d}":`);
    expect(contract).toContain('"metadata_garbled"');
    expect(contract).toContain('"suspected_missing"');
    // the contract itself must be valid JSON
    const parsed = JSON.parse(contract);
    expect(Object.keys(parsed.dimensions)).toHaveLength(22);
  });
});

describe('buildAuditUserMessage', () => {
  it('lists chunks in order with id and type, and the known concept list', () => {
    const msg = buildAuditUserMessage(CHUNKS, ['Materials and their properties']);
    expect(msg).toContain('[chunk id=aaaa-1 type=activity]');
    expect(msg).toContain('[chunk id=aaaa-2 type=concept]');
    expect(msg.indexOf('aaaa-1')).toBeLessThan(msg.indexOf('aaaa-2'));
    expect(msg).toContain('- Materials and their properties');
    expect(msg).toContain('CHAPTER CHUNKS (ordered, 2 total)');
  });

  it('marks concepts as cross-check only (never a counting source)', () => {
    const msg = buildAuditUserMessage(CHUNKS, ['X']);
    expect(msg).toMatch(/do NOT count from this list/i);
  });

  it('handles an empty concept list and null content_type', () => {
    const msg = buildAuditUserMessage([{ chunk_id: 'c1', chunk_text: 'text', content_type: null }], []);
    expect(msg).toContain('(none on record)');
    expect(msg).toContain('[chunk id=c1]');
  });

  it('truncates a single megachunk so one chunk cannot blow the budget', () => {
    const mega = { chunk_id: 'big', chunk_text: 'x'.repeat(50_000), content_type: null };
    const msg = buildAuditUserMessage([mega], []);
    expect(msg.length).toBeLessThan(20_000);
  });
});

describe('estimateTokens', () => {
  it('uses the chars/4 heuristic, rounded up', () => {
    expect(estimateTokens('abcd', 'efgh')).toBe(2);
    expect(estimateTokens('abcde', '')).toBe(2);
    expect(estimateTokens('', '')).toBe(0);
  });
});
