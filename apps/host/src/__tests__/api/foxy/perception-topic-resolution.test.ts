import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Foxy Perception (Phase 1C) — topic-resolution degrade-to-NULL (Condition 1).
 *
 * Unlike perception.test.ts (which MOCKS resolveLeadConceptId to isolate the
 * binding decision), this suite wires the REAL resolveLeadConceptId to a stubbed
 * chapter_concepts client so the actual exact/substring title-match logic runs
 * end-to-end through classifyTurn. Only the Python network hop is mocked.
 *
 * The invariant under test: perception binds topicId ONLY when the classifier's
 * topic_label ACTUALLY matches a concept in the scoped chapter. A no-match (or a
 * null label) with a known chapter — which the SHARED resolver resolves to the
 * chapter's first concept for the GRADED path — must degrade to NULL here, so
 * the learner.turn_classified analytics don't systematically over-represent each
 * chapter's concept #1. Cross-grade / cross-subject / no-chapter already
 * returned null and must continue to.
 */

const _callPythonMol = vi.fn();
vi.mock('@alfanumrik/lib/ai/clients/python-mol', () => ({
  callPythonMol: (...args: unknown[]) => _callPythonMol(...args),
}));

// NOTE: resolveLeadConceptId is intentionally NOT mocked here — we exercise the
// real title-match logic through the chapter_concepts client stub below.
import { classifyTurn } from '@alfanumrik/lib/foxy/perception';

type ConceptStub = { id: string; title: string; concept_number: number };

/**
 * Chainable PostgREST-like stub for the single chapter_concepts read the
 * resolver performs. `rows` is what the (grade+subject+chapter-scoped) query
 * resolves to — an EMPTY array models a cross-grade / cross-subject / absent
 * chapter (the real query would return nothing for a mismatched scope).
 */
function chapterConceptsClient(rows: ConceptStub[]) {
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'ilike', 'eq', 'order']) {
    builder[m] = vi.fn(() => builder);
  }
  builder.limit = vi.fn(() => Promise.resolve({ data: rows, error: null }));
  return { from: vi.fn(() => builder) } as never;
}

function classifierReturns(topicLabel: string | null) {
  _callPythonMol.mockResolvedValue(
    JSON.stringify({
      topic_label: topicLabel,
      bloom_level: 'understand',
      misconception_code: null,
      struggle_signal: 'none',
      intent: 'ask_concept',
    }),
  );
}

function input(over: Record<string, unknown>) {
  return {
    studentId: 'stu-1',
    grade: '7',
    subject: 'Science',
    chapter: 'Chapter 1',
    studentMessage: 'evidence text',
    foxyAnswer: 'foxy reply',
    authToken: 'jwt-abc',
    ...over,
  } as Parameters<typeof classifyTurn>[0];
}

const CHAPTER_ROWS: ConceptStub[] = [
  { id: 'concept-1', title: 'Cell Structure', concept_number: 1 },
  { id: 'concept-2', title: 'Photosynthesis', concept_number: 2 },
  { id: 'concept-3', title: 'Respiration', concept_number: 3 },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('perception topic resolution — degrade to NULL on no match', () => {
  it('classified topic that matches a real concept → that concept id (exact match)', async () => {
    classifierReturns('Photosynthesis');
    const out = await classifyTurn(input({ supabase: chapterConceptsClient(CHAPTER_ROWS) }));
    expect(out!.topicId).toBe('concept-2');
  });

  it('classified topic that substring-matches a real concept → that concept id', async () => {
    classifierReturns('cell'); // substring of "Cell Structure"
    const out = await classifyTurn(input({ supabase: chapterConceptsClient(CHAPTER_ROWS) }));
    expect(out!.topicId).toBe('concept-1');
  });

  it('classified topic with NO match but a known chapter → NULL (THE FIX, was concept #1)', async () => {
    classifierReturns('Quantum Entanglement'); // matches nothing in the chapter
    const out = await classifyTurn(input({ supabase: chapterConceptsClient(CHAPTER_ROWS) }));
    // Pre-fix this returned 'concept-1' (the shared first-concept fallback).
    expect(out!.topicId).toBeNull();
    // The rest of the classification is still emitted (observability intact).
    expect(out!.bloomLevel).toBe('understand');
    expect(out!.chapterNumber).toBe(1);
  });

  it('null classified topic with a known chapter → NULL (was concept #1)', async () => {
    classifierReturns(null);
    const out = await classifyTurn(input({ supabase: chapterConceptsClient(CHAPTER_ROWS) }));
    expect(out!.topicId).toBeNull();
  });

  it('cross-grade / cross-subject (scoped query returns no rows) → NULL (unchanged)', async () => {
    classifierReturns('Photosynthesis'); // a real title, but not in THIS grade/subject scope
    const out = await classifyTurn(input({ supabase: chapterConceptsClient([]) }));
    expect(out!.topicId).toBeNull();
  });

  it('no chapter scope → NULL (unchanged)', async () => {
    classifierReturns('Photosynthesis');
    const out = await classifyTurn(input({ chapter: null, supabase: chapterConceptsClient(CHAPTER_ROWS) }));
    expect(out!.topicId).toBeNull();
    expect(out!.chapterNumber).toBeNull();
  });
});
