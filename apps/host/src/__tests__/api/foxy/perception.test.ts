import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Foxy Perception (Phase 1C) — perception orchestrator (classifyTurn).
 *
 * Contract:
 *   - valid JSON from the Python service → a validated TurnClassification with
 *     Bloom LOWERCASE, ontology-checked misconception, bounded intent, and a
 *     topicId resolved via the EXISTING chapter_concepts resolver.
 *   - null/garbage from the service → classifyTurn returns null (no publishable
 *     signal).
 *   - the returned object carries CODES/IDS/ENUMS ONLY — never the student's
 *     message text (P13).
 */

// Mock the Python client (the network hop) — classifyTurn is pure orchestration.
const _callPythonMol = vi.fn();
vi.mock('@alfanumrik/lib/ai/clients/python-mol', () => ({
  callPythonMol: (...args: unknown[]) => _callPythonMol(...args),
}));

// Mock the topic resolver so we don't need a live chapter_concepts table. We
// assert classifyTurn REUSES it (rather than duplicating concept resolution).
const _resolveLeadConceptId = vi.fn();
vi.mock('@alfanumrik/lib/foxy/evidential-quiz', () => ({
  resolveLeadConceptId: (...args: unknown[]) => _resolveLeadConceptId(...args),
}));

import { classifyTurn } from '@alfanumrik/lib/foxy/perception';

const fakeSupabase = { from: vi.fn() } as never;

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    studentId: 'stu-1',
    grade: '7',
    subject: 'Science',
    chapter: 'Chapter 3',
    studentMessage: 'I keep getting the sign wrong when I subtract',
    foxyAnswer: 'Let us look at how negative numbers behave...',
    authToken: 'jwt-abc',
    supabase: fakeSupabase,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // A REAL title match by default (match: 'title_match') → perception binds the
  // topicId. A first_concept_fallback would NOT bind — see the resolution tests.
  _resolveLeadConceptId.mockResolvedValue({
    ok: true,
    match: 'title_match',
    concept: { id: '11111111-1111-1111-1111-111111111111', title: 'Negative Numbers' },
  });
});

describe('classifyTurn — valid classification', () => {
  it('parses + validates a good JSON payload into a TurnClassification', async () => {
    _callPythonMol.mockResolvedValue(
      JSON.stringify({
        topic_label: 'Negative Numbers',
        bloom_level: 'APPLY', // uppercase from the model → normalized lowercase
        misconception_code: 'sign_error',
        struggle_signal: 'repeated_wrong',
        intent: 'Check Answer', // spaced/cased → snake_case lowercase
      }),
    );

    const out = await classifyTurn(baseInput());
    expect(out).not.toBeNull();
    expect(out).toEqual({
      topicId: '11111111-1111-1111-1111-111111111111',
      chapterNumber: 3,
      bloomLevel: 'apply',
      misconceptionCode: 'sign_error',
      struggleSignal: 'repeated_wrong',
      intent: 'check_answer',
    });
    // Topic resolution reused the existing resolver with the model's label.
    expect(_resolveLeadConceptId).toHaveBeenCalledTimes(1);
    const [, resolveInput] = _resolveLeadConceptId.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(resolveInput.leadConceptTitle).toBe('Negative Numbers');
    expect(resolveInput.subject).toBe('Science');
  });

  it('drops a hallucinated (non-ontology) misconception code to null', async () => {
    _callPythonMol.mockResolvedValue(
      JSON.stringify({
        topic_label: 'Negative Numbers',
        bloom_level: 'understand',
        misconception_code: 'The student thinks minus minus is minus!!', // free text → invalid
        struggle_signal: 'none',
        intent: 'ask_concept',
      }),
    );
    const out = await classifyTurn(baseInput());
    expect(out!.misconceptionCode).toBeNull();
  });

  it('coerces an unknown bloom / struggle / empty intent to safe defaults', async () => {
    _callPythonMol.mockResolvedValue(
      JSON.stringify({
        topic_label: null,
        bloom_level: 'synthesize', // not a canonical verb → null
        misconception_code: null,
        struggle_signal: 'panicking', // not in enum → 'none'
        intent: '', // empty → 'unknown'
      }),
    );
    const out = await classifyTurn(baseInput({ chapter: null }));
    expect(out).toEqual({
      topicId: null, // no chapter + null label → resolver not consulted
      chapterNumber: null,
      bloomLevel: null,
      misconceptionCode: null,
      struggleSignal: 'none',
      intent: 'unknown',
    });
    expect(_resolveLeadConceptId).not.toHaveBeenCalled();
  });

  it('P13: the returned object contains no student message text', async () => {
    _callPythonMol.mockResolvedValue(
      JSON.stringify({ topic_label: 'X', bloom_level: 'apply', struggle_signal: 'none', intent: 'ask_concept' }),
    );
    const secret = 'I keep getting the sign wrong when I subtract';
    const out = await classifyTurn(baseInput({ studentMessage: secret }));
    expect(JSON.stringify(out)).not.toContain(secret);
    expect(JSON.stringify(out)).not.toContain('subtract');
  });
});

describe('classifyTurn — topicId binds ONLY on a real title match (Phase 1C Condition 1)', () => {
  it('binds the concept id when the resolver reports a real title_match', async () => {
    _callPythonMol.mockResolvedValue(
      JSON.stringify({ topic_label: 'Negative Numbers', bloom_level: 'apply', struggle_signal: 'none', intent: 'ask_concept' }),
    );
    _resolveLeadConceptId.mockResolvedValue({
      ok: true,
      match: 'title_match',
      concept: { id: '22222222-2222-2222-2222-222222222222', title: 'Negative Numbers' },
    });
    const out = await classifyTurn(baseInput());
    expect(out!.topicId).toBe('22222222-2222-2222-2222-222222222222');
  });

  it('degrades to NULL when the resolver only produced a first_concept_fallback (THE FIX)', async () => {
    // classifier proposed a label that does not match any concept in the chapter;
    // the shared resolver falls back to concept #1 for the graded path, but
    // perception must NOT bind it (it would over-represent concept #1 in analytics).
    _callPythonMol.mockResolvedValue(
      JSON.stringify({ topic_label: 'Something Off-Topic', bloom_level: 'apply', struggle_signal: 'none', intent: 'ask_concept' }),
    );
    _resolveLeadConceptId.mockResolvedValue({
      ok: true,
      match: 'first_concept_fallback',
      concept: { id: '33333333-3333-3333-3333-333333333333', title: 'Chapter Concept #1' },
    });
    const out = await classifyTurn(baseInput());
    expect(out!.topicId).toBeNull();
    // ...but the rest of the classification is still emitted (observability intact).
    expect(out!.bloomLevel).toBe('apply');
    expect(out!.intent).toBe('ask_concept');
  });

  it('never consults the resolver when the label is null even if a chapter is known', async () => {
    _callPythonMol.mockResolvedValue(
      JSON.stringify({ topic_label: null, bloom_level: 'understand', struggle_signal: 'none', intent: 'ask_concept' }),
    );
    const out = await classifyTurn(baseInput({ chapter: 'Chapter 3' }));
    expect(out!.topicId).toBeNull();
    expect(_resolveLeadConceptId).not.toHaveBeenCalled();
  });

  it('never consults the resolver when there is no chapter scope even with a label', async () => {
    _callPythonMol.mockResolvedValue(
      JSON.stringify({ topic_label: 'Negative Numbers', bloom_level: 'understand', struggle_signal: 'none', intent: 'ask_concept' }),
    );
    const out = await classifyTurn(baseInput({ chapter: null }));
    expect(out!.topicId).toBeNull();
    expect(_resolveLeadConceptId).not.toHaveBeenCalled();
  });
});

describe('classifyTurn — fail-safe (returns null, never throws)', () => {
  it('returns null when the Python client returns null (service dark/down)', async () => {
    _callPythonMol.mockResolvedValue(null);
    const out = await classifyTurn(baseInput());
    expect(out).toBeNull();
  });

  it('returns null on non-JSON garbage', async () => {
    _callPythonMol.mockResolvedValue('not json at all <<<');
    const out = await classifyTurn(baseInput());
    expect(out).toBeNull();
  });

  it('returns null when the JSON is not an object', async () => {
    _callPythonMol.mockResolvedValue('[1,2,3]');
    const out = await classifyTurn(baseInput());
    expect(out).toBeNull();
  });

  it('still returns a classification when topic resolution throws (best-effort → null topicId)', async () => {
    _callPythonMol.mockResolvedValue(
      JSON.stringify({ topic_label: 'X', bloom_level: 'apply', struggle_signal: 'none', intent: 'ask_concept' }),
    );
    _resolveLeadConceptId.mockRejectedValue(new Error('db down'));
    const out = await classifyTurn(baseInput());
    expect(out).not.toBeNull();
    expect(out!.topicId).toBeNull();
    expect(out!.bloomLevel).toBe('apply');
  });

  it('returns null if the client itself throws', async () => {
    _callPythonMol.mockRejectedValue(new Error('boom'));
    const out = await classifyTurn(baseInput());
    expect(out).toBeNull();
  });
});
