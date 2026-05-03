/**
 * Tests for src/lib/rag/pack-quality-oracle.ts (Phase 4.6 Track A).
 *
 * Pins the deterministic prompt + the JSON parsing contract + the
 * acceptance threshold (>= 7 of 9). Mocks Claude responses to verify
 * accept/reject branching.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  buildGraderPrompt,
  parseGraderResponse,
  gradeWithClaude,
  ACCEPTANCE_THRESHOLD,
  MAX_TOTAL,
} from '@/lib/rag/pack-quality-oracle';
import type { PackEntry } from '@/lib/rag/pack-manifest';

const SAMPLE_ENTRY: PackEntry = {
  chunk_text: 'A '.repeat(40) + 'sample chunk for grading purposes.',
  grade: '10',
  subject: 'math',
  chapter_number: 4,
  chapter_title: 'Quadratic Equations',
  topic: 'Discriminant',
  source: 'curated',
  exam_relevance: ['CBSE'],
  provenance: 'generated',
};

describe('buildGraderPrompt', () => {
  it('is deterministic - same entry yields byte-identical prompt', () => {
    const a = buildGraderPrompt(SAMPLE_ENTRY);
    const b = buildGraderPrompt(SAMPLE_ENTRY);
    expect(a).toEqual(b);
  });

  it('embeds the chunk text + grade + subject + chapter', () => {
    const { user } = buildGraderPrompt(SAMPLE_ENTRY);
    expect(user).toContain('Subject: math');
    expect(user).toContain('Grade: 10');
    expect(user).toContain('Quadratic Equations');
    expect(user).toContain(SAMPLE_ENTRY.chunk_text);
  });

  it('system prompt declares the strict JSON contract', () => {
    const { system } = buildGraderPrompt(SAMPLE_ENTRY);
    expect(system).toMatch(/STRICTLY a single JSON object/);
    expect(system).toMatch(/factual_accuracy/);
    expect(system).toMatch(/cbse_scope/);
    expect(system).toMatch(/age_appropriate/);
  });
});

describe('parseGraderResponse', () => {
  it('parses a clean JSON response', () => {
    const r = parseGraderResponse(JSON.stringify({
      factual_accuracy: 3,
      cbse_scope: 3,
      age_appropriate: 2,
      reasoning: 'Solid alignment.',
    }));
    expect(r.total).toBe(8);
    expect(r.accepted).toBe(true);
    expect(r.reasoning).toBe('Solid alignment.');
  });

  it('strips a single ```json code fence', () => {
    const r = parseGraderResponse('```json\n' + JSON.stringify({
      factual_accuracy: 2,
      cbse_scope: 2,
      age_appropriate: 3,
      reasoning: 'OK',
    }) + '\n```');
    expect(r.total).toBe(7);
    expect(r.accepted).toBe(true);
  });

  it('rejects when total < ACCEPTANCE_THRESHOLD', () => {
    const r = parseGraderResponse(JSON.stringify({
      factual_accuracy: 1,
      cbse_scope: 2,
      age_appropriate: 3,
      reasoning: 'Some factual issues.',
    }));
    expect(r.total).toBe(6);
    expect(r.accepted).toBe(false);
  });

  it('boundary: total === ACCEPTANCE_THRESHOLD is accepted', () => {
    const r = parseGraderResponse(JSON.stringify({
      factual_accuracy: 3,
      cbse_scope: 2,
      age_appropriate: 2,
      reasoning: 'Borderline.',
    }));
    expect(r.total).toBe(ACCEPTANCE_THRESHOLD);
    expect(r.accepted).toBe(true);
  });

  it('boundary: total = MAX_TOTAL is accepted', () => {
    const r = parseGraderResponse(JSON.stringify({
      factual_accuracy: 3,
      cbse_scope: 3,
      age_appropriate: 3,
      reasoning: 'Excellent.',
    }));
    expect(r.total).toBe(MAX_TOTAL);
    expect(r.accepted).toBe(true);
  });

  it('throws on non-JSON input', () => {
    expect(() => parseGraderResponse('not json')).toThrow(/non-JSON/);
  });

  it('throws when scores are out of range', () => {
    const json = JSON.stringify({
      factual_accuracy: 5,
      cbse_scope: 2,
      age_appropriate: 2,
      reasoning: '',
    });
    expect(() => parseGraderResponse(json)).toThrow(/integers 0-3/);
  });

  it('throws when scores are floats', () => {
    const json = JSON.stringify({
      factual_accuracy: 2.5,
      cbse_scope: 2,
      age_appropriate: 2,
      reasoning: '',
    });
    expect(() => parseGraderResponse(json)).toThrow(/integers 0-3/);
  });

  it('throws when a score field is missing', () => {
    const json = JSON.stringify({
      factual_accuracy: 3,
      cbse_scope: 3,
      reasoning: 'missing age',
    });
    expect(() => parseGraderResponse(json)).toThrow(/integers 0-3/);
  });

  it('handles missing reasoning gracefully (empty string)', () => {
    const r = parseGraderResponse(JSON.stringify({
      factual_accuracy: 3,
      cbse_scope: 3,
      age_appropriate: 3,
    }));
    expect(r.reasoning).toBe('');
    expect(r.accepted).toBe(true);
  });
});

describe('gradeWithClaude (mocked transport)', () => {
  function mockOk(text: string) {
    return vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ text }] }),
    } as Response);
  }
  function mockHttpFail(status: number) {
    return vi.fn().mockResolvedValue({ ok: false, status } as Response);
  }

  it('returns parsed score on success', async () => {
    const fetch = mockOk(JSON.stringify({
      factual_accuracy: 3, cbse_scope: 3, age_appropriate: 3, reasoning: 'great',
    }));
    const score = await gradeWithClaude(SAMPLE_ENTRY, { apiKey: 'k', fetch });
    expect(score?.accepted).toBe(true);
    expect(score?.total).toBe(9);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('returns null on HTTP failure (caller treats as rejection)', async () => {
    const fetch = mockHttpFail(500);
    const score = await gradeWithClaude(SAMPLE_ENTRY, { apiKey: 'k', fetch });
    expect(score).toBeNull();
  });

  it('returns null on transport throw', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('network'));
    const score = await gradeWithClaude(SAMPLE_ENTRY, { apiKey: 'k', fetch });
    expect(score).toBeNull();
  });

  it('returns null when Claude returns malformed JSON (no silent pass)', async () => {
    const fetch = mockOk('this is not JSON');
    const score = await gradeWithClaude(SAMPLE_ENTRY, { apiKey: 'k', fetch });
    expect(score).toBeNull();
  });

  it('passes the model name through (allows Haiku/Sonnet override)', async () => {
    const fetch = mockOk(JSON.stringify({
      factual_accuracy: 2, cbse_scope: 2, age_appropriate: 2, reasoning: 'meh',
    }));
    await gradeWithClaude(SAMPLE_ENTRY, { apiKey: 'k', model: 'claude-sonnet-test', fetch });
    const callArgs = fetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.model).toBe('claude-sonnet-test');
  });
});
