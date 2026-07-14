// apps/host/src/__tests__/lib/foxy/real-practice-gate.test.ts
//
// Phase 0.3 — ff_foxy_real_practice_v1. Locks the BINDING CONTRACT for the
// real, interactive practice-mode MCQs:
//   1. EVERY emitted mcq is oracle-gated (P6 + REG-54, deterministic + LLM
//      grader, fails CLOSED per mcq); a failing mcq is DROPPED, never shown.
//   2. ANTI-FAKE guardrail: the turn is rebuilt to contain ONLY oracle-passed
//      mcq blocks — any prose the model emitted ("I generated 5 questions!") is
//      stripped, so a turn can never claim questions it did not actually emit.
//   3. If NO mcq survives → buildGatedPracticeResponse returns null and the route
//      serves the graceful bilingual fallback (never a garbage/ungated mcq).
//   4. Served-items invariant: the evidential anchor binds to the FIRST surviving
//      mcq (kept[0]) — the same block the renderer wires the quizMe contract to.
//   5. Flag OFF = byte-identical: MODE_DIRECTIVES.practice (the legacy shape) is
//      unchanged and is what the directive selector returns when the flag is OFF.
//
// Owner: ai-engineer. Reviewers: assessment (oracle/curriculum correctness),
// testing (this file). Pure-module tests — no route/DB/Claude imports.

import { describe, it, expect } from 'vitest';
import {
  gatePracticeMcqs,
  buildGatedPracticeResponse,
  PRACTICE_MCQ_MAX_KEEP,
} from '@alfanumrik/lib/foxy/quiz-me-oracle-gate';
import {
  MODE_DIRECTIVES,
  PRACTICE_MCQ_DIRECTIVE,
  PRACTICE_MCQ_COUNT,
  SINGLE_MCQ_DIRECTIVE,
} from '@alfanumrik/lib/foxy/prompt-sections';
import { payloadFromMcqBlock } from '@alfanumrik/lib/foxy/evidential-quiz';
import {
  FoxyResponseSchema,
  isFoxyMcqBlock,
  type FoxyResponse,
  type FoxyMcqBlock,
} from '@alfanumrik/lib/foxy/schema';
import type { LlmGrader } from '@alfanumrik/lib/ai/validation/quiz-oracle';

const consistentGrader: LlmGrader = async () => ({ verdict: 'consistent', reasoning: 'ok' });
const mismatchGrader: LlmGrader = async () => ({
  verdict: 'mismatch',
  reasoning: 'explanation points elsewhere',
  suggested_correct_index: 1,
});
const throwingGrader: LlmGrader = async () => {
  throw new Error('claude down');
};

/** A clean, oracle-passable mcq block (index-varied so options stay distinct). */
function cleanMcq(n: number): FoxyMcqBlock {
  return {
    type: 'mcq',
    stem: `Question ${n}: which organelle is the powerhouse of the cell?`,
    options: [`Nucleus ${n}`, `Mitochondria ${n}`, `Ribosome ${n}`, `Golgi ${n}`],
    correct_answer_index: 1,
    explanation: 'Mitochondria produce ATP, so it is called the powerhouse of the cell.',
    bloom_level: 'Understand',
    difficulty: 'easy',
  };
}

function practiceResponse(blocks: FoxyResponse['blocks']): FoxyResponse {
  return { title: 'Practice: The Cell', subject: 'science', blocks } as FoxyResponse;
}

describe('gatePracticeMcqs — every mcq oracle-gated (P6 + REG-54)', () => {
  it('keeps only oracle-passed mcqs; drops LLM-mismatch mcqs', async () => {
    const res = practiceResponse([cleanMcq(1), cleanMcq(2), cleanMcq(3)]);
    const passed = await gatePracticeMcqs(res, {
      grade: '10',
      subject: 'science',
      enableLlmGrader: true,
      llmGrade: consistentGrader,
    });
    expect(passed.kept).toHaveLength(3);
    expect(passed.rejections).toHaveLength(0);
    expect(passed.llm_calls).toBe(3); // one grader call per mcq

    const dropped = await gatePracticeMcqs(res, {
      grade: '10',
      subject: 'science',
      enableLlmGrader: true,
      llmGrade: mismatchGrader,
    });
    expect(dropped.kept).toHaveLength(0);
    expect(dropped.rejections.length).toBeGreaterThan(0);
    expect(dropped.rejections.every((r) => r.reason === 'llm_mismatch')).toBe(true);
  });

  it('drops a P6-violating mcq on deterministic checks (no LLM call) but keeps the clean ones', async () => {
    const bad: FoxyMcqBlock = { ...cleanMcq(9), options: ['A', 'A', 'B', 'C'] as [string, string, string, string] };
    const res = practiceResponse([cleanMcq(1), bad, cleanMcq(2)]);
    const gated = await gatePracticeMcqs(res, {
      grade: '10',
      subject: 'science',
      enableLlmGrader: true,
      llmGrade: consistentGrader,
    });
    expect(gated.kept).toHaveLength(2);
    expect(gated.rejections).toHaveLength(1);
    expect(gated.rejections[0].reason).toBe('p6_options_not_distinct');
    // 3 gated: 2 clean (LLM call each) + 1 deterministic-drop (no LLM call) = 2 calls.
    expect(gated.llm_calls).toBe(2);
  });

  it('fails CLOSED per mcq when the grader throws (P12 — never keeps an unaudited mcq)', async () => {
    const res = practiceResponse([cleanMcq(1), cleanMcq(2)]);
    const gated = await gatePracticeMcqs(res, {
      grade: '10',
      subject: 'science',
      enableLlmGrader: true,
      llmGrade: throwingGrader,
    });
    expect(gated.kept).toHaveLength(0);
    expect(gated.rejections.every((r) => r.reason === 'llm_grader_unavailable')).toBe(true);
  });

  it('caps kept survivors at maxKeep and bounds the oracle attempts (LLM budget ceiling)', async () => {
    const res = practiceResponse([cleanMcq(1), cleanMcq(2), cleanMcq(3), cleanMcq(4), cleanMcq(5)]);
    const gated = await gatePracticeMcqs(res, {
      grade: '10',
      subject: 'science',
      enableLlmGrader: true,
      llmGrade: consistentGrader,
      maxKeep: 3,
    });
    expect(gated.kept).toHaveLength(3);
    // Stops gating once 3 survivors are found → never grades all 5.
    expect(gated.gated).toBeLessThanOrEqual(3);
    expect(gated.llm_calls).toBeLessThanOrEqual(3);
  });

  it('default maxKeep matches PRACTICE_MCQ_MAX_KEEP', async () => {
    const res = practiceResponse(Array.from({ length: 6 }, (_, i) => cleanMcq(i + 1)));
    const gated = await gatePracticeMcqs(res, {
      enableLlmGrader: true,
      llmGrade: consistentGrader,
    });
    expect(gated.kept.length).toBeLessThanOrEqual(PRACTICE_MCQ_MAX_KEEP);
  });
});

describe('buildGatedPracticeResponse — anti-fake guardrail', () => {
  it('strips ALL prose so a turn cannot CLAIM questions it did not emit', async () => {
    // Model emitted a fake "I generated 5 questions!" paragraph + 1 clean mcq + 1 bad mcq.
    const bad: FoxyMcqBlock = { ...cleanMcq(9), options: ['A', 'A', 'B', 'C'] as [string, string, string, string] };
    const res = practiceResponse([
      { type: 'paragraph', text: 'I generated 5 practice questions for you! Here they are:' },
      cleanMcq(1),
      bad,
    ]);
    const gated = await gatePracticeMcqs(res, {
      grade: '10',
      subject: 'science',
      enableLlmGrader: true,
      llmGrade: consistentGrader,
    });
    const rebuilt = buildGatedPracticeResponse(res, gated.kept);
    expect(rebuilt).not.toBeNull();
    // Only the ONE oracle-passed mcq survives; the prose claim is gone.
    expect(rebuilt!.blocks).toHaveLength(1);
    expect(rebuilt!.blocks.every((b) => b.type === 'mcq')).toBe(true);
    expect(rebuilt!.blocks.some((b) => b.type === 'paragraph')).toBe(false);
    // The surviving turn round-trips the wire schema.
    expect(FoxyResponseSchema.safeParse(rebuilt).success).toBe(true);
  });

  it('returns null when NO mcq survives (caller must serve the graceful fallback)', async () => {
    const res = practiceResponse([cleanMcq(1), cleanMcq(2)]);
    const gated = await gatePracticeMcqs(res, {
      grade: '10',
      subject: 'science',
      enableLlmGrader: true,
      llmGrade: mismatchGrader, // all rejected
    });
    expect(gated.kept).toHaveLength(0);
    expect(buildGatedPracticeResponse(res, gated.kept)).toBeNull();
  });

  it('preserves title + subject and keeps only mcq blocks in order', async () => {
    const res = practiceResponse([cleanMcq(1), cleanMcq(2), cleanMcq(3)]);
    const gated = await gatePracticeMcqs(res, {
      enableLlmGrader: true,
      llmGrade: consistentGrader,
    });
    const rebuilt = buildGatedPracticeResponse(res, gated.kept)!;
    expect(rebuilt.title).toBe('Practice: The Cell');
    expect(rebuilt.subject).toBe('science');
    expect(rebuilt.blocks.map((b) => b.type)).toEqual(['mcq', 'mcq', 'mcq']);
  });
});

describe('served-items invariant — one evidential anchor bound to the FIRST mcq', () => {
  it('the evidential server-held key is derived from kept[0], which is the FIRST rendered mcq', async () => {
    const res = practiceResponse([cleanMcq(1), cleanMcq(2), cleanMcq(3)]);
    const gated = await gatePracticeMcqs(res, {
      enableLlmGrader: true,
      llmGrade: consistentGrader,
    });
    const rebuilt = buildGatedPracticeResponse(res, gated.kept)!;

    // The route serves ONE evidential item from kept[0]; the renderer wires the
    // quizMe contract to the FIRST mcq block. These MUST be the same block, else
    // the server-held answer key would grade a different question than shown.
    const firstRendered = rebuilt.blocks.find(isFoxyMcqBlock)!;
    const { payload, correctIndex } = payloadFromMcqBlock(gated.kept[0]);
    expect(firstRendered.stem).toBe(payload.stem);
    expect(correctIndex).toBe(firstRendered.correct_answer_index);
    expect(payload.source).toBe('mcq_block');
    // Only ONE evidential serve happens per turn regardless of survivor count —
    // the remaining survivors are non-evidential self-check (no double-count).
    expect(gated.kept.length).toBeGreaterThan(1);
  });
});

describe('directive selection — flag OFF is byte-identical, flag ON emits mcqs', () => {
  // Mirror of the route's mode_directive selector (route.ts):
  //   isQuizMe ? SINGLE_MCQ_DIRECTIVE
  //   : isRealPractice ? PRACTICE_MCQ_DIRECTIVE
  //   : (MODE_DIRECTIVES[mode] ?? '')
  function selectDirective(opts: { isQuizMe: boolean; isRealPractice: boolean; mode: string }): string {
    return opts.isQuizMe
      ? SINGLE_MCQ_DIRECTIVE
      : opts.isRealPractice
        ? PRACTICE_MCQ_DIRECTIVE
        : (MODE_DIRECTIVES[opts.mode] ?? '');
  }

  it('flag OFF → practice uses the LEGACY MODE_DIRECTIVES.practice (byte-identical)', () => {
    const d = selectDirective({ isQuizMe: false, isRealPractice: false, mode: 'practice' });
    expect(d).toBe(MODE_DIRECTIVES.practice);
    // Legacy shape is preserved verbatim (5 markdown pseudo-MCQ paragraphs).
    expect(MODE_DIRECTIVES.practice).toContain('EXACTLY 5 "paragraph" blocks');
  });

  it('flag ON → practice uses the interactive PRACTICE_MCQ_DIRECTIVE (mcq blocks)', () => {
    const d = selectDirective({ isQuizMe: false, isRealPractice: true, mode: 'practice' });
    expect(d).toBe(PRACTICE_MCQ_DIRECTIVE);
    expect(d).toContain('"mcq" blocks');
    expect(d).toContain(`EXACTLY ${PRACTICE_MCQ_COUNT}`);
  });

  it('quiz_me still wins over real practice (single mcq directive)', () => {
    const d = selectDirective({ isQuizMe: true, isRealPractice: false, mode: 'practice' });
    expect(d).toBe(SINGLE_MCQ_DIRECTIVE);
  });

  it('PRACTICE_MCQ_DIRECTIVE carries the anti-fake instruction (no prose quiz claims)', () => {
    expect(PRACTICE_MCQ_DIRECTIVE.toLowerCase()).toContain('do not claim to have created a quiz');
    expect(PRACTICE_MCQ_DIRECTIVE).toContain('Emit the mcq blocks and nothing else.');
  });

  it('PRACTICE_MCQ_COUNT is a small bounded number (oracle-cost ceiling)', () => {
    expect(PRACTICE_MCQ_COUNT).toBeGreaterThanOrEqual(1);
    expect(PRACTICE_MCQ_COUNT).toBeLessThanOrEqual(5);
  });
});
