// apps/host/src/__tests__/api/foxy/foxy-practice-flag-off-anti-fake.test.ts
//
// REG-251 (route flag-OFF practice half) — when ff_foxy_real_practice_v1 is OFF,
// a practice turn does NOT run the oracle gate, but the route STILL runs the
// deterministic anti-fake backstop: a claim-only turn is replaced by the graceful
// `buildQuizMeFallbackResponse(subject)`, while a real turn with actual
// (A)/(B)/(C)/(D) content passes through untouched.
//
// Following the established Foxy-route testing pattern (see real-practice-gate.test.ts,
// quiz-me-formative-and-fallback.test.ts): importing the giant route.ts would drag
// callClaude / supabaseAdmin / the whole pipeline into the test, so we PIN the
// load-bearing decision expression from the route's `else if (isPracticeTurn)`
// branch (route.ts ~:2380-2402) using the SAME real helpers the route calls —
// denormalizeFoxyResponse, stripFakeQuizClaim, buildQuizMeFallbackResponse.
//
// Owner: ai-engineer. Reviewers: assessment (fallback shape), testing. Pure-module
// test — no route/DB/Claude imports.

import { describe, it, expect } from 'vitest';
import { denormalizeFoxyResponse } from '@alfanumrik/lib/foxy/denormalize';
import { stripFakeQuizClaim } from '@alfanumrik/lib/foxy/anti-fake-quiz-claim';
import { buildQuizMeFallbackResponse } from '@alfanumrik/lib/foxy/prompt-sections';
import { FoxyResponseSchema, isFoxyMcqBlock, type FoxyResponse } from '@alfanumrik/lib/foxy/schema';

/**
 * Faithful mirror of the route's flag-OFF practice backstop (route.ts):
 *   const candidateText = structured ? denormalizeFoxyResponse(structured) : grounded.answer;
 *   const antiFake = stripFakeQuizClaim(candidateText);
 *   if (antiFake.claimOnly) { structured = buildQuizMeFallbackResponse(subject);
 *                             quizMeWireText = denormalizeFoxyResponse(structured); }
 */
function applyFlagOffPracticeBackstop(input: {
  structured: FoxyResponse | null;
  groundedAnswer: string;
  subject: string;
}): { structured: FoxyResponse | null; wireText: string | null; replaced: boolean } {
  const candidateText = input.structured
    ? denormalizeFoxyResponse(input.structured)
    : input.groundedAnswer;
  const antiFake = stripFakeQuizClaim(candidateText);
  if (antiFake.claimOnly) {
    const fallback = buildQuizMeFallbackResponse(input.subject);
    return { structured: fallback, wireText: denormalizeFoxyResponse(fallback), replaced: true };
  }
  return { structured: input.structured, wireText: null, replaced: false };
}

function mcqBlock(n: number) {
  return {
    type: 'mcq' as const,
    stem: `Question ${n}: which organelle is the powerhouse of the cell?`,
    options: [`Nucleus ${n}`, `Mitochondria ${n}`, `Ribosome ${n}`, `Golgi ${n}`],
    correct_answer_index: 1,
    explanation: 'Mitochondria produce ATP, so it is called the powerhouse of the cell.',
    bloom_level: 'Understand',
    difficulty: 'easy',
  };
}

// A structured turn that DENORMALIZES to a claim with no question content.
const CLAIM_ONLY_STRUCTURED: FoxyResponse = {
  title: 'Practice: The Cell',
  subject: 'science',
  blocks: [{ type: 'paragraph', text: 'Generated 5 quiz questions.' }],
} as FoxyResponse;

// A real practice turn: a claim paragraph BACKED by 3 real (A)/(B)/(C)/(D) mcqs.
const REAL_PRACTICE_STRUCTURED: FoxyResponse = {
  title: 'Practice: The Cell',
  subject: 'science',
  blocks: [
    { type: 'paragraph', text: 'Here are 3 practice questions for you:' },
    mcqBlock(1),
    mcqBlock(2),
    mcqBlock(3),
  ],
} as FoxyResponse;

describe('flag-OFF practice backstop — claim-only turn is replaced by the graceful fallback', () => {
  it('a claim-only STRUCTURED turn is swapped for buildQuizMeFallbackResponse', () => {
    const out = applyFlagOffPracticeBackstop({
      structured: CLAIM_ONLY_STRUCTURED,
      groundedAnswer: '',
      subject: 'science',
    });
    expect(out.replaced).toBe(true);
    // The swapped-in structured payload is the graceful fallback: mcq-free,
    // schema-valid, bilingual, and NOT itself a quiz claim.
    expect(out.structured).not.toBeNull();
    expect(out.structured!.blocks.some(isFoxyMcqBlock)).toBe(false);
    expect(FoxyResponseSchema.safeParse(out.structured).success).toBe(true);
    const fbText = out.structured!.blocks[0].text ?? '';
    expect(fbText).toMatch(/let me try a different question/i); // EN
    expect(fbText).toMatch(/dobara|Quiz me/i); // Hinglish CTA (P7)
    // The fallback wire text is not a claim → no strip loop.
    expect(out.wireText).not.toBeNull();
    expect(stripFakeQuizClaim(out.wireText!).claimOnly).toBe(false);
    // The original claim never reaches the wire text.
    expect(out.wireText).not.toContain('Generated 5');
  });

  it('a claim-only GROUNDED answer (structured null) is also swapped for the fallback', () => {
    const out = applyFlagOffPracticeBackstop({
      structured: null,
      groundedAnswer: 'Generated 5 quiz questions.',
      subject: 'science',
    });
    expect(out.replaced).toBe(true);
    expect(out.structured!.blocks.some(isFoxyMcqBlock)).toBe(false);
  });
});

describe('flag-OFF practice backstop — a real (A)/(B)/(C)/(D) turn passes through UNTOUCHED', () => {
  it('a real practice structured turn is NOT swapped (same payload flows on)', () => {
    const out = applyFlagOffPracticeBackstop({
      structured: REAL_PRACTICE_STRUCTURED,
      groundedAnswer: '',
      subject: 'science',
    });
    expect(out.replaced).toBe(false);
    // Untouched — the exact original structured payload flows on to persistence.
    expect(out.structured).toBe(REAL_PRACTICE_STRUCTURED);
    // Sanity: the denormalized real turn genuinely carries lettered options and
    // is therefore not treated as a claim by the backstop.
    const denorm = denormalizeFoxyResponse(REAL_PRACTICE_STRUCTURED);
    expect(denorm).toContain('A)');
    expect(denorm).toContain('D)');
    expect(stripFakeQuizClaim(denorm).claimOnly).toBe(false);
  });
});
