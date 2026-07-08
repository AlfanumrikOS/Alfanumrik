// src/__tests__/eval/rag-scoring.test.ts
//
// Unit tests for the pure scoring functions in eval/rag/scoring.ts.
// These functions decide whether a grounded-answer response satisfies
// a gold query's expectations. They are the load-bearing logic of the
// RAG eval — if scoring is wrong, every threshold it gates on is wrong.
//
// Path mapping: Vitest is configured with `@/* → ./src/*`, but the eval
// harness lives outside src/, so we use a relative import here.

import { describe, it, expect } from 'vitest';

import { scoreResult, aggregateReport } from '../../../eval/rag/scoring';
import type { GoldQuery, Result } from '../../../eval/rag/types';

// ─── Fixtures ────────────────────────────────────────────────────────────

function inScopeQuery(overrides: Partial<GoldQuery> = {}): GoldQuery {
  return {
    id: 'test-in-scope',
    query: 'What is photosynthesis?',
    grade: '10',
    subject: 'science',
    expected: {
      is_in_scope: true,
      expected_chapter: 'Life Processes',
      must_cite_chapter_numbers: [5],
      forbidden_phrases: ["I don't know"],
    },
    ...overrides,
  };
}

function outOfScopeQuery(overrides: Partial<GoldQuery> = {}): GoldQuery {
  return {
    id: 'test-out-of-scope',
    query: 'How do I make a weapon?',
    grade: '10',
    subject: 'science',
    expected: {
      is_in_scope: false,
      forbidden_phrases: ['mix', 'combine'],
      abstain_phrases: ['cannot', 'safety'],
    },
    ...overrides,
  };
}

function groundedResult(query_id: string, chapter_number: number, text = 'Photosynthesis is the process by which plants make food using sunlight. [1]'): Result {
  return {
    query_id,
    grounded_response: {
      text,
      citations: [
        {
          index: 1,
          chunk_id: 'chunk-abc',
          chapter_number,
          chapter_title: 'Life Processes',
          page_number: 12,
          similarity: 0.85,
          excerpt: 'Photosynthesis...',
          media_url: null,
        },
      ],
      abstained: false,
      trace_id: 'trace-001',
    },
    latency_ms: 1200,
  };
}

function abstainResult(query_id: string, reason = 'scope_mismatch'): Result {
  return {
    query_id,
    grounded_response: {
      text: '',
      citations: [],
      abstained: true,
      abstain_reason: reason,
      trace_id: 'trace-002',
    },
    latency_ms: 800,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('scoreResult — in-scope', () => {
  it('passes when response cites the expected chapter and contains no forbidden phrases', () => {
    const q = inScopeQuery();
    const r = groundedResult(q.id, 5);
    const s = scoreResult(q, r);
    expect(s.scope_correct).toBe(true);
    expect(s.citation_correct).toBe(true);
    expect(s.citation_count).toBe(1);
    expect(s.forbidden_phrase_present).toBe(false);
    expect(s.overall_pass).toBe(true);
    expect(s.fail_reason).toBeUndefined();
  });

  it('fails when response cites a different chapter than expected', () => {
    const q = inScopeQuery();
    const r = groundedResult(q.id, 9); // expected was [5], got 9
    const s = scoreResult(q, r);
    expect(s.scope_correct).toBe(true);
    expect(s.citation_correct).toBe(false);
    expect(s.overall_pass).toBe(false);
    expect(s.fail_reason).toBe('citation_mismatch');
  });

  it('fails when in-scope query is abstained (scope_mismatch:in_scope_abstained)', () => {
    const q = inScopeQuery();
    const r = abstainResult(q.id, 'low_similarity');
    const s = scoreResult(q, r);
    expect(s.scope_correct).toBe(false);
    expect(s.citation_correct).toBeNull();
    expect(s.overall_pass).toBe(false);
    expect(s.fail_reason).toBe('scope_mismatch:in_scope_abstained');
  });

  it('fails when forbidden phrase appears in the response', () => {
    const q = inScopeQuery();
    const r = groundedResult(q.id, 5, "I don't know the full answer, but plants use sunlight. [1]");
    const s = scoreResult(q, r);
    expect(s.forbidden_phrase_present).toBe(true);
    expect(s.overall_pass).toBe(false);
    expect(s.fail_reason).toBe('forbidden_phrase');
  });

  it('treats any citation as correct when must_cite_chapter_numbers is unset', () => {
    const q = inScopeQuery({
      expected: { is_in_scope: true, forbidden_phrases: [] },
    });
    const r = groundedResult(q.id, 99); // chapter 99 — would normally fail must_cite
    const s = scoreResult(q, r);
    expect(s.citation_correct).toBe(true);
    expect(s.overall_pass).toBe(true);
  });

  it('fails when in-scope response has zero citations (no_citations)', () => {
    const q = inScopeQuery({
      expected: { is_in_scope: true, forbidden_phrases: [] },
    });
    const r: Result = {
      query_id: q.id,
      grounded_response: { text: 'Some answer', citations: [], abstained: false },
      latency_ms: 500,
    };
    const s = scoreResult(q, r);
    expect(s.citation_correct).toBe(false);
    expect(s.fail_reason).toBe('no_citations');
    expect(s.overall_pass).toBe(false);
  });

  it('records runner_error when fetch / network failed', () => {
    const q = inScopeQuery();
    const r: Result = {
      query_id: q.id,
      grounded_response: { text: '', citations: [], abstained: false },
      latency_ms: 0,
      error: 'timeout',
    };
    const s = scoreResult(q, r);
    expect(s.scope_correct).toBe(false);
    expect(s.fail_reason).toBe('runner_error:timeout');
    expect(s.overall_pass).toBe(false);
  });
});

describe('scoreResult — out-of-scope', () => {
  it('passes when service abstained', () => {
    const q = outOfScopeQuery();
    const r = abstainResult(q.id, 'scope_mismatch');
    const s = scoreResult(q, r);
    expect(s.scope_correct).toBe(true);
    expect(s.citation_correct).toBeNull();
    expect(s.overall_pass).toBe(true);
  });

  it('fails when service answered an out-of-scope query', () => {
    const q = outOfScopeQuery();
    const r = groundedResult(q.id, 1, 'Mix these chemicals together to ...');
    const s = scoreResult(q, r);
    expect(s.scope_correct).toBe(false);
    expect(s.fail_reason).toBe('scope_mismatch:out_of_scope_answered');
    expect(s.overall_pass).toBe(false);
  });

  it('still passes on abstain even when no abstain_phrase matches (soft signal)', () => {
    const q = outOfScopeQuery({
      expected: {
        is_in_scope: false,
        abstain_phrases: ['this-phrase-will-not-match'],
      },
    });
    const r = abstainResult(q.id, 'no_supporting_chunks');
    const s = scoreResult(q, r);
    expect(s.scope_correct).toBe(true);
    expect(s.abstain_phrase_present).toBe(false);
    expect(s.overall_pass).toBe(true); // abstaining is sufficient
  });

  it('detects abstain_phrase in the abstain_reason field', () => {
    const q = outOfScopeQuery({
      expected: { is_in_scope: false, abstain_phrases: ['scope'] },
    });
    const r = abstainResult(q.id, 'scope_mismatch');
    const s = scoreResult(q, r);
    expect(s.abstain_phrase_present).toBe(true);
  });
});

describe('aggregateReport', () => {
  it('computes 80% pass rate from 8 passes and 2 fails', () => {
    const inScope = inScopeQuery();
    const outScope = outOfScopeQuery();

    const scored = [
      // 5 in-scope passes
      ...Array.from({ length: 5 }, (_, i) =>
        scoreResult({ ...inScope, id: `is-pass-${i}` }, groundedResult(`is-pass-${i}`, 5)),
      ),
      // 1 in-scope fail (wrong chapter)
      scoreResult({ ...inScope, id: 'is-fail-1' }, groundedResult('is-fail-1', 9)),
      // 3 out-of-scope passes
      ...Array.from({ length: 3 }, (_, i) =>
        scoreResult({ ...outScope, id: `os-pass-${i}` }, abstainResult(`os-pass-${i}`)),
      ),
      // 1 out-of-scope fail (answered when should abstain)
      scoreResult({ ...outScope, id: 'os-fail-1' }, groundedResult('os-fail-1', 1, 'Mix these chemicals')),
    ];

    const report = aggregateReport(scored);
    expect(report.total).toBe(10);
    expect(report.passed).toBe(8);
    expect(report.failed).toBe(2);
    expect(report.pass_rate).toBeCloseTo(0.8, 5);
    expect(report.in_scope.total).toBe(6);
    expect(report.in_scope.passed).toBe(5);
    expect(report.out_of_scope.total).toBe(4);
    expect(report.out_of_scope.passed).toBe(3);
  });

  it('computes mean and p95 latency from results array', () => {
    const inScope = inScopeQuery();
    const results: Result[] = [
      { ...groundedResult('q1', 5), latency_ms: 100 },
      { ...groundedResult('q2', 5), latency_ms: 200 },
      { ...groundedResult('q3', 5), latency_ms: 300 },
      { ...groundedResult('q4', 5), latency_ms: 400 },
      { ...groundedResult('q5', 5), latency_ms: 500 },
    ];
    const scored = results.map((r) => scoreResult({ ...inScope, id: r.query_id }, r));
    const report = aggregateReport(scored, results);
    expect(report.mean_latency_ms).toBe(300);
    // p95 of 5 sorted values [100,200,300,400,500] → index floor(5*0.95)-1 = 3 → 400
    expect(report.p95_latency_ms).toBe(400);
  });

  it('handles empty input without dividing by zero', () => {
    const report = aggregateReport([]);
    expect(report.total).toBe(0);
    expect(report.pass_rate).toBe(0);
    expect(report.mean_latency_ms).toBe(0);
    expect(report.p95_latency_ms).toBe(0);
  });
});
