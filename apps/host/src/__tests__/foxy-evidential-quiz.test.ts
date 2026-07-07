// Tests for the PART B1 evidential-quiz pure helpers (src/lib/foxy/evidential-quiz.ts).
//
// Covers concept resolution precedence, the mcq→payload mapping, and the
// served-item serve contract — including the one-evidential-per-(session,
// concept) UNIQUE guard (acceptance B1.6) and the unresolvable-concept
// non-evidential path (acceptance B1.5 precursor: no served row → cannot grade).

import { describe, it, expect, vi } from 'vitest';
import {
  parseChapterNumber,
  resolveLeadConceptId,
  payloadFromMcqBlock,
  serveEvidentialItem,
  type ChapterConceptRow,
} from '@alfanumrik/lib/foxy/evidential-quiz';
import type { FoxyMcqBlock } from '@alfanumrik/lib/foxy/schema';

function conceptRow(over: Partial<ChapterConceptRow> = {}): ChapterConceptRow {
  return {
    id: 'c-1',
    title: 'Photosynthesis',
    concept_number: 1,
    difficulty: 2,
    practice_question: null,
    practice_options: null,
    practice_correct_index: null,
    practice_explanation: null,
    ...over,
  };
}

// Minimal chainable PostgREST-like stub for the chapter_concepts read.
function chapterConceptsClient(rows: ChapterConceptRow[], error: unknown = null) {
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'ilike', 'eq', 'order']) {
    builder[m] = vi.fn(() => builder);
  }
  builder.limit = vi.fn(() => Promise.resolve({ data: rows, error }));
  return { from: vi.fn(() => builder) } as never;
}

const MCQ: FoxyMcqBlock = {
  type: 'mcq',
  stem: 'Where does photosynthesis occur in a plant cell?',
  options: ['Mitochondria', 'Chloroplast', 'Nucleus', 'Ribosome'],
  correct_answer_index: 1,
  explanation: 'Photosynthesis occurs in the chloroplast, which contains chlorophyll.',
  bloom_level: 'Understand',
  difficulty: 'easy',
};

describe('parseChapterNumber', () => {
  it('parses bare numbers, "Chapter N", and titles with embedded numbers', () => {
    expect(parseChapterNumber('6')).toBe(6);
    expect(parseChapterNumber('Chapter 12')).toBe(12);
    expect(parseChapterNumber('Chapter 2: Acids')).toBe(2);
    expect(parseChapterNumber('Ch. 5: Light')).toBe(5);
  });
  it('returns null when no positive number is present', () => {
    expect(parseChapterNumber(null)).toBeNull();
    expect(parseChapterNumber('Acids and Bases')).toBeNull();
  });
});

describe('resolveLeadConceptId', () => {
  it('returns no_chapter_scope when no chapter number resolvable (B1.5 path)', async () => {
    const client = chapterConceptsClient([]);
    const res = await resolveLeadConceptId(client, {
      subject: 'science',
      grade: '7',
      chapter: null,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('no_chapter_scope');
  });

  it('prefers the concept whose title matches the lead title', async () => {
    const rows = [conceptRow({ id: 'a', title: 'Cell Structure', concept_number: 1 }), conceptRow({ id: 'b', title: 'Photosynthesis', concept_number: 2 })];
    const res = await resolveLeadConceptId(chapterConceptsClient(rows), {
      subject: 'science',
      grade: '7',
      chapter: 'Chapter 1',
      leadConceptTitle: 'photosynthesis',
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.concept.id).toBe('b');
  });

  it('falls back to the first concept when no title match', async () => {
    const rows = [conceptRow({ id: 'a', concept_number: 1 }), conceptRow({ id: 'b', concept_number: 2 })];
    const res = await resolveLeadConceptId(chapterConceptsClient(rows), {
      subject: 'science',
      grade: '7',
      chapter: '1',
      leadConceptTitle: 'Unrelated Topic',
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.concept.id).toBe('a');
  });

  it('returns no_concept_match when the chapter has no concepts', async () => {
    const res = await resolveLeadConceptId(chapterConceptsClient([]), {
      subject: 'science',
      grade: '7',
      chapter: '1',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('no_concept_match');
  });
});

describe('payloadFromMcqBlock', () => {
  it('snapshots stem/options and uses the block correct index as the server key', () => {
    const { payload, correctIndex } = payloadFromMcqBlock(MCQ);
    expect(correctIndex).toBe(1);
    expect(payload.source).toBe('mcq_block');
    expect(payload.options).toEqual(MCQ.options);
    expect(payload.stem).toBe(MCQ.stem);
  });
});

describe('serveEvidentialItem', () => {
  function insertClient(result: { data?: unknown; error?: unknown }) {
    const single = vi.fn(() => Promise.resolve(result));
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    return { client: { from: vi.fn(() => ({ insert })) } as never, insert };
  }

  it('returns evidential:true with the served-item id on a clean insert', async () => {
    const { client } = insertClient({ data: { id: 'srv-1' }, error: null });
    const res = await serveEvidentialItem(client, {
      sessionId: 's-1',
      studentId: 'st-1',
      conceptId: 'c-1',
      payload: payloadFromMcqBlock(MCQ).payload,
      correctIndex: 1,
    });
    expect(res).toEqual({ evidential: true, servedItemId: 'srv-1', questionId: 'c-1:evidential:v1' });
  });

  it('treats a 23505 UNIQUE violation as a NON-evidential second serve (B1.6)', async () => {
    const { client } = insertClient({ data: null, error: { code: '23505' } });
    const res = await serveEvidentialItem(client, {
      sessionId: 's-1',
      studentId: 'st-1',
      conceptId: 'c-1',
      payload: payloadFromMcqBlock(MCQ).payload,
      correctIndex: 1,
    });
    expect(res).toEqual({ evidential: false, reason: 'duplicate_in_session' });
  });

  it('returns insert_failed on a non-23505 error', async () => {
    const { client } = insertClient({ data: null, error: { code: '500' } });
    const res = await serveEvidentialItem(client, {
      sessionId: 's-1',
      studentId: 'st-1',
      conceptId: 'c-1',
      payload: payloadFromMcqBlock(MCQ).payload,
      correctIndex: 1,
    });
    expect(res).toEqual({ evidential: false, reason: 'insert_failed' });
  });
});
