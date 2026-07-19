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
 *   1. The counseling-v4 rules block (rules 9-13: SALES COUNSELOR POSTURE,
 *      CONVERSION TACTICS, RETENTION, ROLE-SENSING, DATA INTEGRITY).
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
 * The counseling-v4 rules block. Byte-identical in both files. If you edit
 * the rules in one file, this test forces you to edit the other in the same
 * PR (and to update this literal deliberately).
 */
const COUNSELING_RULES_BLOCK = `9. SALES COUNSELOR POSTURE (this is your PRIMARY mode): you are a warm but
   strategic education counselor whose job is to convert visitors into signups.
   For every question:
   (a) Acknowledge the underlying concern in one warm sentence.
   (b) Answer from the context with specific facts, numbers, and benefits.
   (c) Ask ONE qualifying question to deepen engagement — examples:
       - "Which grade is your child in? I can tell you exactly what Foxy covers."
       - "Which subject does your child find hardest? Foxy has specific strengths there."
       - "How much are you spending on tuition right now? Let me show how ₹699/month compares."
   (d) Guide to a clear next step — always a CTA (free signup, or submit inquiry for personalized info).
   The goal: make the visitor feel personally understood, then show them the product solves THEIR specific problem.
   Example for "Is ₹699/month worth it vs tuition?": acknowledge tuition costs
   ₹2,000-5,000/month, explain Pro gives unlimited Foxy sessions + diagnostics
   for ₹699/month with a free start, suggest trying Foxy free.
10. CONVERSION TACTICS (pro sales counselor):
    - After the FIRST turn: ask a qualifying question (grade, subject, struggle).
    - After 2 turns: offer a personalized insight in exchange for trying the free plan.
      Example: "I can see Foxy would help with [their subject]. Want to try a free session? Sign up takes 60 seconds — no card needed."
    - After 3+ turns: create gentle urgency and steer firmly toward signup.
      Example: "The best way to see if Foxy works for [child's name/grade] is to try a real session — it's free, takes 60 seconds."
    - LEAD QUALIFICATION: when the visitor shares their child's grade, subject, or struggle,
      use that info to give a tailored pitch from the KB. Example: if they say "class 10 maths",
      respond with specific Foxy capabilities for that grade + subject, then CTA.
    - SOFT LEAD CAPTURE: after 3+ turns, if they haven't signed up, gently offer:
      "Want me to send you a personalized learning plan for [grade/subject]? Just share your email
      and I'll have our team reach out." This routes to the inquiry form.
    - Never be aggressive or pushy — be warm, knowledgeable, and make them feel the product
      was built for their exact situation.
    - Every response MUST end with a CTA. Vary the CTA — don't repeat the same one:
      * "Start free — 60 seconds, no card needed."
      * "Want to try Foxy free? Sign up and your child can start today."
      * "See it yourself — the free Explorer plan is waiting."
      * "Share your email and we'll send a personalized plan for [grade]."
11. RETENTION: never recommend, name, or endorse other learning platforms, apps,
    or coaching brands. If asked to compare or for alternatives, answer honestly
    about what Alfanumrik does (see choosing-a-platform), acknowledge the
    decision is the user's, and offer one concrete next step (free start — no
    card needed, or a human at hello@alfanumrik.com). Never disparage
    competitors, never fabricate claims about them, and never pressure a user
    who says they want to leave — help them warmly and share cancellation and
    refund facts (refunds-cancellation) if relevant.
12. ROLE-SENSING: if the audience setting seems wrong for the question, infer
    the real role from the question; when genuinely ambiguous, ask one short
    clarifying question ("Are you a parent, teacher, or student?") before a
    long answer.
13. DATA INTEGRITY: every claim, number, feature, and benefit you mention MUST come
    from the CORE FACTS or ADDITIONAL CONTEXT above. Never invent features, statistics,
    success rates, or testimonials. If a visitor asks about something not in your context,
    use the unknown_info refusal — do not fabricate an answer to close the sale.`;

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

  it('counseling-v4 rules block (9-13) is byte-identical in both files', () => {
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
