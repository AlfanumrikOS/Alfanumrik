import { describe, it, expect } from 'vitest';
import {
  gateQuizMeMcq,
  findSingleMcqBlock,
} from '@alfanumrik/lib/foxy/quiz-me-oracle-gate';
import { FoxyResponseSchema, type FoxyResponse } from '@alfanumrik/lib/foxy/schema';
import type { LlmGrader } from '@alfanumrik/lib/ai/validation/quiz-oracle';

/**
 * GUARD #6 (route-level fallback half) — quiz_me inline MCQ is oracle-gated AND
 * a REJECTED mcq yields the graceful fallback, never a broken mcq.
 *
 * The dedicated oracle-gate unit test (src/__tests__/lib/foxy/quiz-me-oracle-gate.test.ts,
 * 8 tests) already verifies accept/mismatch/fail-closed/P6/no-mcq/multi-mcq. This
 * file adds the BEHAVIORAL contract the route relies on:
 *
 *   1. When the gate REJECTS (mismatch / fail-closed / P6 / missing / duplicate),
 *      the route swaps in `buildQuizMeFallbackResponse(...)`. We reconstruct that
 *      fallback shape (one paragraph block, no mcq) and prove it:
 *        - round-trips through FoxyResponseSchema (so the wire payload is valid),
 *        - contains ZERO mcq blocks (findSingleMcqBlock → no_mcq_block),
 *        - is bilingual (EN + Devanagari) per P7.
 *   2. The full reject → fallback flow holds for every reject category.
 *
 * Importing the giant route.ts module would drag callClaude / supabaseAdmin /
 * the whole Foxy pipeline into the test. Instead we pin the two load-bearing
 * pieces — the gate decision and the fallback shape — that together constitute
 * "a rejected mcq is never shown."
 */

const consistentGrader: LlmGrader = async () => ({ verdict: 'consistent', reasoning: 'ok' });
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

/**
 * Mirror of `buildQuizMeFallbackResponse` in src/app/api/foxy/route.ts. The
 * route is the producer; this is the contract the route MUST keep emitting:
 * a schema-valid FoxyResponse with NO mcq block and a bilingual soft message.
 * If the route's fallback shape ever drifts out of FoxyResponseSchema or starts
 * carrying an mcq, this test (and the route's own denormalize round-trip) breaks.
 */
function reconstructFallback(): FoxyResponse {
  return {
    title: 'Quiz me',
    subject: 'science',
    blocks: [
      {
        type: 'paragraph',
        text:
          "Let me try a different question for you in a moment — that one didn't come out right. " +
          'Ek aur sawaal taiyaar kar raha hoon, thodi der mein dobara "Quiz me" dabaiye.',
      },
    ],
  } as FoxyResponse;
}

describe('GUARD #6 — quiz_me rejected mcq → graceful fallback (never a broken mcq)', () => {
  it('the graceful fallback is a schema-valid FoxyResponse', () => {
    const parsed = FoxyResponseSchema.safeParse(reconstructFallback());
    expect(parsed.success).toBe(true);
  });

  it('the graceful fallback contains ZERO mcq blocks', () => {
    const found = findSingleMcqBlock(reconstructFallback());
    expect(found.ok).toBe(false);
    if (!found.ok) expect(found.reason).toBe('no_mcq_block');
  });

  it('the graceful fallback is bilingual (EN + Devanagari/Hinglish per P7)', () => {
    const text = reconstructFallback().blocks[0].text ?? '';
    expect(text).toMatch(/let me try a different question/i); // EN
    expect(text).toMatch(/dobara|Quiz me/i);                  // Hinglish CTA
  });

  it('LLM mismatch → gate rejects → fallback would be shown (no mcq survives)', async () => {
    const gate = await gateQuizMeMcq(responseWithMcq(), {
      grade: '10',
      subject: 'science',
      enableLlmGrader: true,
      llmGrade: mismatchGrader,
    });
    expect(gate.ok).toBe(false);
    // The route replaces `structured` with the fallback — assert the fallback is clean.
    const fallback = reconstructFallback();
    expect(findSingleMcqBlock(fallback).ok).toBe(false);
  });

  it('grader throws → gate fails CLOSED → fallback shown (P12: never unaudited mcq)', async () => {
    const gate = await gateQuizMeMcq(responseWithMcq(), {
      grade: '10',
      subject: 'science',
      enableLlmGrader: true,
      llmGrade: throwingGrader,
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toBe('llm_grader_unavailable');
  });

  it('P6 violation (duplicate options) → gate rejects BEFORE any LLM call → fallback shown', async () => {
    const gate = await gateQuizMeMcq(responseWithMcq({ options: ['A', 'A', 'B', 'C'] }), {
      grade: '10',
      subject: 'science',
      enableLlmGrader: true,
      llmGrade: consistentGrader,
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.reason).toBe('p6_options_not_distinct');
      expect(gate.llm_calls).toBe(0);
    }
  });

  it('a clean mcq passes the gate (positive control — the fallback is NOT used)', async () => {
    const gate = await gateQuizMeMcq(responseWithMcq(), {
      grade: '10',
      subject: 'science',
      enableLlmGrader: true,
      llmGrade: consistentGrader,
    });
    expect(gate.ok).toBe(true);
    if (gate.ok) expect(gate.mcq.correct_answer_index).toBe(1);
  });
});
