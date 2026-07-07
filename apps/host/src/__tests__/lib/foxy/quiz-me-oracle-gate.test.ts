// src/__tests__/lib/foxy/quiz-me-oracle-gate.test.ts
//
// Locks the BINDING CONTRACT for the Foxy "Quiz me on this" inline MCQ:
// the mcq MUST pass the P6 oracle AND the REG-54 generator oracle BEFORE it is
// shown; a failing/missing/duplicate mcq must NOT pass the gate (the route then
// serves a graceful fallback instead). See src/lib/foxy/quiz-me-oracle-gate.ts.

import { describe, it, expect } from 'vitest';
import {
  gateQuizMeMcq,
  findSingleMcqBlock,
  mcqBlockToCandidate,
} from '@alfanumrik/lib/foxy/quiz-me-oracle-gate';
import type { FoxyResponse } from '@alfanumrik/lib/foxy/schema';
import type { LlmGrader } from '@alfanumrik/lib/ai/validation/quiz-oracle';

const consistentGrader: LlmGrader = async () => ({
  verdict: 'consistent',
  reasoning: 'ok',
});
const mismatchGrader: LlmGrader = async () => ({
  verdict: 'mismatch',
  reasoning: 'explanation points elsewhere',
  suggested_correct_index: 1,
});
const throwingGrader: LlmGrader = async () => {
  throw new Error('claude down');
};

function responseWithMcq(overrides: Record<string, unknown> = {}): FoxyResponse {
  return {
    title: 'Quiz me',
    subject: 'science',
    blocks: [
      {
        type: 'mcq',
        stem: 'Which organelle is the powerhouse of the cell?',
        options: ['Nucleus', 'Mitochondria', 'Ribosome', 'Golgi body'],
        correct_answer_index: 1,
        explanation: 'Mitochondria produce ATP, so it is called the powerhouse of the cell.',
        bloom_level: 'Understand',
        difficulty: 'easy',
        ...overrides,
      },
    ],
  } as FoxyResponse;
}

describe('quiz-me oracle gate — binding contract', () => {
  it('accepts a clean mcq when the LLM grader says consistent', async () => {
    const res = await gateQuizMeMcq(responseWithMcq(), {
      grade: '10',
      subject: 'science',
      enableLlmGrader: true,
      llmGrade: consistentGrader,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.mcq.correct_answer_index).toBe(1);
  });

  it('rejects when the LLM grader says mismatch (REG-54 second pass)', async () => {
    const res = await gateQuizMeMcq(responseWithMcq(), {
      grade: '10',
      subject: 'science',
      enableLlmGrader: true,
      llmGrade: mismatchGrader,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('llm_mismatch');
  });

  it('fails CLOSED when the grader throws (P12 — never show unaudited mcq)', async () => {
    const res = await gateQuizMeMcq(responseWithMcq(), {
      grade: '10',
      subject: 'science',
      enableLlmGrader: true,
      llmGrade: throwingGrader,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('llm_grader_unavailable');
  });

  it('rejects a P6-violating mcq on deterministic checks (no grader call)', async () => {
    // duplicate options → P6 distinctness failure, caught before any LLM call
    const res = await gateQuizMeMcq(
      responseWithMcq({ options: ['A', 'A', 'B', 'C'] }),
      { grade: '10', subject: 'science', enableLlmGrader: true, llmGrade: consistentGrader },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('p6_options_not_distinct');
      expect(res.llm_calls).toBe(0);
    }
  });

  it('rejects when there is no mcq block', async () => {
    const res = await gateQuizMeMcq(
      { title: 'X', subject: 'general', blocks: [{ type: 'paragraph', text: 'hi there' }] } as FoxyResponse,
      { enableLlmGrader: true, llmGrade: consistentGrader },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('no_mcq_block');
  });

  it('rejects when there are multiple mcq blocks (directive demands exactly one)', async () => {
    const r = responseWithMcq();
    const two: FoxyResponse = { ...r, blocks: [...r.blocks, ...responseWithMcq().blocks] };
    const res = await gateQuizMeMcq(two, { enableLlmGrader: true, llmGrade: consistentGrader });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('multiple_mcq_blocks');
  });
});

describe('quiz-me oracle gate — helpers', () => {
  it('findSingleMcqBlock returns the lone mcq', () => {
    const found = findSingleMcqBlock(responseWithMcq());
    expect(found.ok).toBe(true);
  });

  it('mcqBlockToCandidate maps the four P6 fields + normalizes difficulty/bloom', () => {
    const found = findSingleMcqBlock(responseWithMcq());
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    const c = mcqBlockToCandidate(found.mcq, { grade: '10' });
    expect(c.options).toHaveLength(4);
    expect(c.correct_answer_index).toBe(1);
    expect(c.difficulty).toBe('easy');
    expect(c.bloom_level).toBe('understand');
    expect(c.grade).toBe('10');
    // subject is intentionally NOT forwarded to the oracle candidate (free-form
    // route subject codes are not in the oracle's CBSE allowlist).
    expect(c.subject).toBeUndefined();
  });
});
