/**
 * Knowledge-audit v2 — semantic batch prompt builder (pure, no network).
 *
 * ADAPTED from the v1 single-pass prompt tests: the model no longer receives
 * the 22-dimension counting contract. Structural dimensions moved to the
 * deterministic scanner (structural-scan.test.ts), contamination moved to code
 * (contamination.test.ts); the prompt now covers ONLY the 10 semantic
 * dimensions, batched, returning ITEMS (labels) instead of counts. The
 * dimension-model integrity tests carry over unchanged.
 */
import { describe, it, expect } from 'vitest';

import {
  ALL_DIMENSIONS,
  CHUNK_PASS_DIMENSIONS,
  GENERATED_CONTENT_SCAN_DIMENSIONS,
  QUESTION_BANK_SCAN_DIMENSIONS,
  SEMANTIC_DIMENSIONS,
  STRUCTURAL_DIMENSIONS,
  type AuditChunk,
} from '../../../../scripts/knowledge-audit/dimensions';
import {
  batchChunks,
  buildSemanticOutputContract,
  buildSemanticSystemPrompt,
  buildSemanticUserMessage,
  estimateTokens,
  MAX_CHUNKS_PER_BATCH,
} from '../../../../scripts/knowledge-audit/prompt';

const CTX = { grade: '6', subject: 'science', chapterNumber: 4, chapterTitle: 'Sorting Materials into Groups' };

const CHUNKS: AuditChunk[] = [
  { chunk_id: 'aaaa-1', chunk_text: 'Activity 4.1 Collect objects around you.', content_type: 'activity' },
  { chunk_id: 'aaaa-2', chunk_text: 'Fig. 4.1 shows objects made of wood.', content_type: 'concept' },
];

describe('dimension model (carried over from v1 unchanged)', () => {
  it('has exactly 31 dimensions with no duplicates across the three lanes', () => {
    expect(ALL_DIMENSIONS).toHaveLength(31);
    expect(new Set(ALL_DIMENSIONS).size).toBe(31);
    // Lane partition changed 2026-07-04: `topics` + `concepts` moved OFF the
    // chunk_pass/semantic lane onto the deterministic generated_content_scan
    // SSoT lane. chunk_pass 22→20, generated_content_scan 4→6.
    expect(CHUNK_PASS_DIMENSIONS).toHaveLength(20);
    expect(QUESTION_BANK_SCAN_DIMENSIONS).toHaveLength(5);
    expect(GENERATED_CONTENT_SCAN_DIMENSIONS).toHaveLength(6);
  });

  it('topics + concepts are deterministic SSoT scan dims, NOT semantic/chunk-pass (2026-07-04 adjudication)', () => {
    for (const d of ['topics', 'concepts'] as const) {
      expect(GENERATED_CONTENT_SCAN_DIMENSIONS).toContain(d);
      expect(SEMANTIC_DIMENSIONS).not.toContain(d);
      expect(CHUNK_PASS_DIMENSIONS).not.toContain(d);
      expect(STRUCTURAL_DIMENSIONS).not.toContain(d);
    }
    // the semantic lane is now 7 dims (was 10): topics + concepts left first,
    // then definitions moved to the deterministic structural lane 2026-07-04.
    expect(SEMANTIC_DIMENSIONS).toHaveLength(7);
    expect(STRUCTURAL_DIMENSIONS).toHaveLength(13);
    expect(SEMANTIC_DIMENSIONS).not.toContain('definitions');
    expect(STRUCTURAL_DIMENSIONS).toContain('definitions');
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

describe('batchChunks', () => {
  it(`splits into ordered batches of at most ${MAX_CHUNKS_PER_BATCH} by default`, () => {
    const items = Array.from({ length: 38 }, (_, i) => i);
    const batches = batchChunks(items);
    expect(batches.map((b) => b.length)).toEqual([15, 15, 8]);
    expect(batches.flat()).toEqual(items); // order preserved, nothing lost
  });

  it('an exact multiple produces full batches only', () => {
    expect(batchChunks(Array.from({ length: 30 }, (_, i) => i)).map((b) => b.length)).toEqual([15, 15]);
  });

  it('fewer chunks than the cap → a single batch; empty input → no batches', () => {
    expect(batchChunks([1, 2, 3])).toEqual([[1, 2, 3]]);
    expect(batchChunks([])).toEqual([]);
  });

  it('rejects invalid batch sizes', () => {
    expect(() => batchChunks([1], 0)).toThrow(/invalid batch size/);
    expect(() => batchChunks([1], 1.5)).toThrow(/invalid batch size/);
  });
});

describe('buildSemanticSystemPrompt', () => {
  const prompt = buildSemanticSystemPrompt(CTX);

  it('anchors the auditor to the grade/subject/chapter', () => {
    expect(prompt).toContain('Class 6 science');
    expect(prompt).toContain('Chapter 4');
    expect(prompt).toContain('Sorting Materials into Groups');
  });

  it('covers every SEMANTIC dimension by name and requests NO structural dimension in the contract', () => {
    for (const d of SEMANTIC_DIMENSIONS) expect(prompt).toContain(d);
    const contract = buildSemanticOutputContract();
    for (const d of STRUCTURAL_DIMENSIONS) expect(contract).not.toContain(`"${d}":`);
    for (const d of [...QUESTION_BANK_SCAN_DIMENSIONS, ...GENERATED_CONTENT_SCAN_DIMENSIONS]) {
      expect(contract).not.toContain(`"${d}":`);
    }
  });

  it('demands ITEMS (short labels), never counts — the model is told counts are derived code-side', () => {
    expect(prompt).toMatch(/ENUMERATE the distinct instances/i);
    expect(prompt).toMatch(/You never return counts/);
    expect(prompt).toMatch(/deduplicated across batches/i);
    expect(prompt).toMatch(/at most 40 characters/);
    expect(prompt).toMatch(/STABLE and CANONICAL/);
  });

  it('carries the OCR-flattening notice (markers may appear mid-line; no own-line requirement)', () => {
    expect(prompt).toMatch(/OCR-FLATTENED TEXT/);
    expect(prompt).toMatch(/lost its original line breaks/i);
    expect(prompt).toMatch(/MID-LINE/);
    expect(prompt).toMatch(/Never require an item to sit on its own line/i);
  });

  it('instructs evidence-grounded enumeration: only what is present, never infer from titles', () => {
    expect(prompt).toMatch(/Enumerate ONLY what is present/i);
    expect(prompt).toMatch(/NEVER infer items from the chapter title/i);
  });

  it('instructs overlap-dedup within the batch', () => {
    expect(prompt).toMatch(/Chunks OVERLAP/i);
    expect(prompt).toMatch(/ONE item, never two/i);
  });

  it('demands ids-only evidence (max 5) and label-only outputs (P13)', () => {
    expect(prompt).toMatch(/UP TO 5 chunk ids/i);
    expect(prompt).toMatch(/IDs ONLY/);
    expect(prompt).toMatch(/never copy passage sentences into a label/i);
    expect(prompt).toMatch(/Labels only — never passage text/i);
  });

  it('keeps the honest-empty rule (empty list is correct; padding is a failure)', () => {
    expect(prompt).toMatch(/honest empty list is correct/i);
  });

  it('formulae rule: numbered equations labelled "eq N.M", unnumbered as compact symbolic form', () => {
    expect(prompt).toMatch(/eq N\.M/);
    expect(prompt).toMatch(/compact symbolic form/i);
    expect(prompt).toMatch(/same formula restated is the SAME item/i);
  });

  it('embeds a strict JSON output contract that is valid JSON with exactly the 7 semantic dims', () => {
    const contract = buildSemanticOutputContract();
    expect(prompt).toContain(contract);
    const parsed = JSON.parse(contract);
    expect(Object.keys(parsed.dimensions)).toHaveLength(7);
    // topics/concepts are SSoT scan dims now, and definitions is deterministic
    // structural — none may appear in the LLM contract
    expect(parsed.dimensions.topics).toBeUndefined();
    expect(parsed.dimensions.concepts).toBeUndefined();
    expect(parsed.dimensions.definitions).toBeUndefined();
    for (const d of SEMANTIC_DIMENSIONS) {
      expect(parsed.dimensions[d]).toEqual({ items: [], evidence_chunk_ids: [] });
    }
    expect(parsed.metadata_garbled).toBe(false);
    expect(parsed.suspected_missing).toEqual([]);
  });
});

describe('buildSemanticUserMessage', () => {
  it('carries the batch header: position, one-chapter framing, count-only-within-this-batch', () => {
    const msg = buildSemanticUserMessage(CHUNKS, 1, 5, []);
    expect(msg).toContain('BATCH 2 of 5');
    expect(msg).toMatch(/batches of ONE chapter/);
    expect(msg).toMatch(/ONLY in this batch/);
    expect(msg).toMatch(/merged and deduplicated code-side/);
  });

  it('lists chunks in order with id and type, and the known concept list', () => {
    const msg = buildSemanticUserMessage(CHUNKS, 0, 1, ['Materials and their properties']);
    expect(msg).toContain('[chunk id=aaaa-1 type=activity]');
    expect(msg).toContain('[chunk id=aaaa-2 type=concept]');
    expect(msg.indexOf('aaaa-1')).toBeLessThan(msg.indexOf('aaaa-2'));
    expect(msg).toContain('- Materials and their properties');
    expect(msg).toContain('BATCH CHUNKS (ordered, 2 in this batch)');
  });

  it('marks concepts as cross-check only (never an enumeration source)', () => {
    const msg = buildSemanticUserMessage(CHUNKS, 0, 1, ['X']);
    expect(msg).toMatch(/do NOT list from this alone/i);
  });

  it('handles an empty concept list and null content_type', () => {
    const msg = buildSemanticUserMessage([{ chunk_id: 'c1', chunk_text: 'text', content_type: null }], 0, 1, []);
    expect(msg).toContain('(none on record)');
    expect(msg).toContain('[chunk id=c1]');
  });

  it('truncates a single megachunk so one chunk cannot blow the budget', () => {
    const mega = { chunk_id: 'big', chunk_text: 'x'.repeat(50_000), content_type: null };
    const msg = buildSemanticUserMessage([mega], 0, 1, []);
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
