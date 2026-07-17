/**
 * Contract test — AlfaBot prompt Node↔Deno mirror parity.
 *
 * `packages/lib/src/ai/prompts/alfabot-system.ts` is the canonical prompt
 * module; `supabase/functions/alfabot-answer/prompt.ts` is its deliberate
 * cross-runtime mirror (the Deno Edge Function cannot import Node code).
 * The mirror's own header says "when you change either side, update BOTH.
 * There is no CI parity check yet (TODO(quality): add one in PR 3)" — this
 * file is that parity check, added with the counseling-v2 prompt upgrade
 * (2026-07-17) so the new rules cannot drift apart silently.
 *
 * What is pinned byte-identical across BOTH files:
 *   1. The counseling-v2 rules block (rules 8-10: COUNSELING POSTURE,
 *      RETENTION / no-competitor-recommendation, ROLE-SENSING).
 *   2. The four canned refusal strings, EN + HI (REG-66).
 *   3. The model pin `gpt-4o-mini` (REG-67) and temperature 0.3.
 *   4. The ≤100-words reply rule and the future-promise FORBIDDEN rule.
 *
 * The files are NOT asserted byte-identical as a whole — they have different
 * headers, the Deno side additionally exports ALFABOT_CORE_CONTEXT, and one
 * pre-existing hyphen/em-dash variance exists in rule 3. The shared semantic
 * surface above is what must never fork.
 *
 * Owner: ai-engineer. Reviewers: assessment (scope), testing.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Real repo root (5 levels above src/__tests__/contract inside apps/host).
// `supabase/...` would also resolve via the setup.ts monorepo shim, but
// `packages/...` is not in the shim's remap set, so we go absolute for both.
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');

function readSource(rel: string): string {
  // Normalize CRLF → LF: the working tree checks out with CRLF on Windows;
  // parity is asserted on content bytes modulo line-ending convention.
  return readFileSync(resolve(REPO_ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

const NODE_PROMPT = 'packages/lib/src/ai/prompts/alfabot-system.ts';
const DENO_PROMPT = 'supabase/functions/alfabot-answer/prompt.ts';

/**
 * The counseling-v2 rules block. Byte-identical in both files. If you edit
 * the rules in one file, this test forces you to edit the other in the same
 * PR (and to update this literal deliberately).
 */
const COUNSELING_RULES_BLOCK = `8. COUNSELING POSTURE: you are a counselor for the family's education decision,
   not just an FAQ bot. Understand the underlying concern behind a question
   (cost worry, trust in AI, a child's struggles), acknowledge it in one warm
   sentence, answer from the context above, then guide to the next step.
9. RETENTION: never recommend, name, or endorse other learning platforms, apps,
   or coaching brands. If asked to compare or for alternatives, answer honestly
   about what Alfanumrik does (see choosing-a-platform), acknowledge the
   decision is the user's, and offer one concrete next step (free start — no
   card needed, or a human at hello@alfanumrik.com). Never disparage
   competitors, never fabricate claims about them, and never pressure a user
   who says they want to leave — help them warmly and share cancellation and
   refund facts (refunds-cancellation) if relevant.
10. ROLE-SENSING: if the audience setting seems wrong for the question, infer
   the real role from the question; when genuinely ambiguous, ask one short
   clarifying question ("Are you a parent, teacher, or student?") before a
   long answer.`;

/** REG-66 refusal strings — verbatim, both runtimes. */
const REFUSAL_LITERALS = [
  "I help with questions about Alfanumrik. I'm not a tutor — Foxy is, but you need to sign up first.",
  "I don't have that info — would you like to talk to our team? hello@alfanumrik.com",
  'I only answer questions about Alfanumrik — not medical, legal, news, or politics.',
  'मैं Alfanumrik के बारे में सवालों में मदद करता हूँ। मैं tutor नहीं हूँ — Foxy है, पर पहले sign-up करना होगा।',
  'मेरे पास यह जानकारी नहीं है — क्या हमारी टीम से बात करना चाहेंगे? hello@alfanumrik.com',
  'मैं केवल Alfanumrik के बारे में जवाब देता हूँ — चिकित्सा, कानून, समाचार या राजनीति के नहीं।',
  'मैं कभी किसी और छात्र का data साझा नहीं करता।',
];

describe('AlfaBot prompt Node↔Deno mirror parity', () => {
  const nodeSrc = readSource(NODE_PROMPT);
  const denoSrc = readSource(DENO_PROMPT);

  it('counseling-v2 rules block (8-10) is byte-identical in both files', () => {
    expect(nodeSrc).toContain(COUNSELING_RULES_BLOCK);
    expect(denoSrc).toContain(COUNSELING_RULES_BLOCK);
  });

  it('all seven refusal literals appear verbatim in both files (REG-66)', () => {
    for (const literal of REFUSAL_LITERALS) {
      expect(nodeSrc).toContain(literal);
      expect(denoSrc).toContain(literal);
    }
    // The 4th EN refusal contains an escaped apostrophe in source
    // ("I never share other students\' data.") — assert its escaped form
    // in both files rather than the rendered string.
    expect(nodeSrc).toContain("I never share other students\\' data.");
    expect(denoSrc).toContain("I never share other students\\' data.");
  });

  it('model + temperature pins match in both files (REG-67)', () => {
    for (const src of [nodeSrc, denoSrc]) {
      expect(src).toContain("model: 'gpt-4o-mini'");
      expect(src).toContain("fallback_model: 'gpt-4o'");
      expect(src).toContain('temperature: 0.3');
      expect(src).toContain('max_tokens: 350');
    }
  });

  it('reply-length rule and future-promise FORBIDDEN rule survive in both files', () => {
    for (const src of [nodeSrc, denoSrc]) {
      expect(src).toContain('Keep replies under 100 words');
      expect(src).toContain('FORBIDDEN in your output');
    }
  });

  it('both files keep exactly 4 hard-refusal pattern entries', () => {
    for (const src of [nodeSrc, denoSrc]) {
      // Each pattern entry is declared as `id: '<refusal key>',` inside
      // ALFABOT_HARD_REFUSAL_PATTERNS.
      const matches = src.match(/id:\s*'(not_a_tutor|off_topic|other_student_data|unknown_info)'/g) ?? [];
      expect(matches).toHaveLength(4);
    }
  });
});
