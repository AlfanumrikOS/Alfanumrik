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
 * ── Second parity axis, added 2026-08-11 ────────────────────────────────────
 * ALFABOT_CORE_CONTEXT (Deno-only) was DELIBERATELY excluded from the parity
 * set above, and that exclusion is exactly why it drifted silently: the
 * constant is authored verbatim from `docs/alfabot/knowledge-base.md`
 * section `pricing-plans`, is injected into EVERY turn (not RAG-retrieved,
 * not audience-filtered), and prompt rule 2 orders the model to quote it
 * verbatim — yet nothing pinned it to the KB. It accumulated four false
 * subject claims per language ("all seven subjects", "4 subjects",
 * "all subjects", "2 subjects" and their Hindi twins) while every mirror
 * assertion above kept passing.
 *
 * The `ALFABOT_CORE_CONTEXT ↔ knowledge-base parity` block below closes that
 * hole with three cheap, non-brittle checks:
 *   a. FORBIDDEN claims — no subject-count claim may appear in either the
 *      core context or the KB pricing section, in either language (P12:
 *      under-promise; the product is Mathematics and Science only and every
 *      plan, free Explorer included, grants both).
 *   b. SHARED claims — a small set of load-bearing literals must appear in
 *      BOTH sources, whitespace-normalized (the core context is hard-wrapped
 *      at ~72 cols, the KB is one long paragraph, so raw substring matching
 *      would be meaningless).
 *   c. Price-set + EN/HI symmetry — the multiset of ₹ amounts must be equal
 *      across the two sources, and the EN and HI halves of the core context
 *      must carry the same prices and the same cancellation clause (P7: a
 *      prior pass found Hindi omitting the consumer-friendly half of the
 *      cancellation sentence that English carried).
 * Deliberately NOT pinned: prose wording, sentence order, or the full text.
 * That would make every KB copy-edit a test failure. Only claims are pinned.
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

// ─── ALFABOT_CORE_CONTEXT ↔ knowledge-base parity ───────────────────────────

const KB = 'docs/alfabot/knowledge-base.md';

/** Collapse all whitespace so hard-wrapped prompt text matches flowing KB prose. */
function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Extract the template-literal body of `export const ALFABOT_CORE_CONTEXT`. */
function extractCoreContext(denoSource: string): string {
  const start = denoSource.indexOf('export const ALFABOT_CORE_CONTEXT = `');
  if (start === -1) throw new Error('ALFABOT_CORE_CONTEXT declaration not found');
  const bodyStart = denoSource.indexOf('`', start) + 1;
  const bodyEnd = denoSource.indexOf('`;', bodyStart);
  if (bodyEnd === -1) throw new Error('ALFABOT_CORE_CONTEXT is not terminated');
  return denoSource.slice(bodyStart, bodyEnd);
}

/** Slice a `## <id>` section out of the knowledge base, up to the next H2. */
function extractKbSection(kbSource: string, sectionId: string): string {
  const start = kbSource.indexOf(`## ${sectionId}`);
  if (start === -1) throw new Error(`KB section "${sectionId}" not found`);
  const after = kbSource.slice(start + 3);
  const next = after.search(/\n## [a-z]/);
  return next === -1 ? after : after.slice(0, next);
}

/**
 * Claims the product cannot back (P12). The product teaches Mathematics and
 * Science only, and migration 20260814000018 left `max_subjects` NULL on all
 * four plans with 5 `plan_subject_access` rows each — subject count is not a
 * differentiator and must never be stated as one, in either language.
 */
const FORBIDDEN_SUBJECT_CLAIMS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: 'EN numeric/word subject count', re: /\b(?:all\s+)?(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+subjects?\b/i },
  { label: 'EN "all subjects"', re: /\ball\s+subjects\b/i },
  { label: 'HI "सातों विषय" (all seven subjects)', re: /सातों\s*विषय/ },
  { label: 'HI numeric subject count', re: /\d+\s*विषय/ },
  { label: 'HI "सभी विषय" (all subjects)', re: /सभी\s*विषय/ },
];

/**
 * Load-bearing claims that MUST be present in both the core context and the
 * KB pricing-plans section. Whitespace-normalized on both sides.
 */
const SHARED_EN_CLAIMS: readonly string[] = [
  '₹699 per month',
  '₹299 per month',
  '₹1,099 per month',
  'no credit card required',
  'Cancel anytime, one tap, no questions',
  'Cancellation takes effect at end of current billing month',
  '30 to 3,000 seats',
  'contact for quote',
  'Mathematics and Science are included on every tier, free Explorer included',
  'no subject sits behind a paywall and subjects are never a paid upgrade',
  'Grades 6 to 10 study Maths and Science',
  'Physics, Chemistry and Biology, presented together as one Science group',
];

const SHARED_HI_CLAIMS: readonly string[] = [
  'गणित और विज्ञान हर tier में शामिल हैं, मुफ़्त Explorer में भी',
  'कोई विषय paywall के पीछे नहीं है और विषय कभी paid upgrade नहीं हैं',
  'कक्षा 6 से 10 में गणित और विज्ञान',
  'कक्षा 11 और 12 में गणित के साथ भौतिकी, रसायन और जीवविज्ञान',
];

describe('ALFABOT_CORE_CONTEXT ↔ knowledge-base parity', () => {
  const denoSrc = readSource(DENO_PROMPT);
  const kbSrc = readSource(KB);

  const coreContext = extractCoreContext(denoSrc);
  const kbPricing = extractKbSection(kbSrc, 'pricing-plans');

  // The core context's [PRICING] block, and its EN / HI halves.
  const pricingBlock = coreContext.slice(
    coreContext.indexOf('[PRICING'),
    coreContext.indexOf('[SAFETY/DPDPA'),
  );
  const enHalf = pricingBlock.slice(pricingBlock.indexOf('\nEN:'), pricingBlock.indexOf('\nHI:'));
  const hiHalf = pricingBlock.slice(pricingBlock.indexOf('\nHI:'));

  it('extracts a non-empty core context and a non-empty KB pricing section', () => {
    expect(coreContext.length).toBeGreaterThan(500);
    expect(kbPricing.length).toBeGreaterThan(500);
    expect(enHalf.length).toBeGreaterThan(100);
    expect(hiHalf.length).toBeGreaterThan(100);
  });

  it('core context makes NO subject-count claim in either language (P12)', () => {
    for (const { label, re } of FORBIDDEN_SUBJECT_CLAIMS) {
      const hit = coreContext.match(re);
      expect(
        hit,
        `ALFABOT_CORE_CONTEXT contains a forbidden ${label}: ${JSON.stringify(hit?.[0])}`,
      ).toBeNull();
    }
  });

  it('KB pricing-plans section makes NO subject-count claim either (source parity)', () => {
    for (const { label, re } of FORBIDDEN_SUBJECT_CLAIMS) {
      const hit = kbPricing.match(re);
      expect(
        hit,
        `KB pricing-plans contains a forbidden ${label}: ${JSON.stringify(hit?.[0])}`,
      ).toBeNull();
    }
  });

  it('every load-bearing EN claim appears in BOTH the core context and the KB', () => {
    const core = norm(coreContext);
    const kb = norm(kbPricing);
    for (const claim of SHARED_EN_CLAIMS) {
      expect(core, `core context missing EN claim: ${claim}`).toContain(claim);
      expect(kb, `KB pricing-plans missing EN claim: ${claim}`).toContain(claim);
    }
  });

  it('every load-bearing HI claim appears in BOTH the core context and the KB (P7)', () => {
    const core = norm(coreContext);
    const kb = norm(kbPricing);
    for (const claim of SHARED_HI_CLAIMS) {
      expect(core, `core context missing HI claim: ${claim}`).toContain(claim);
      expect(kb, `KB pricing-plans missing HI claim: ${claim}`).toContain(claim);
    }
  });

  it('core context and KB quote the SAME set of ₹ amounts (REG-65 price drift)', () => {
    const prices = (s: string) =>
      [...new Set([...s.matchAll(/₹\s?([\d,]+)/g)].map((m) => m[1]))].sort();
    expect(prices(coreContext)).toEqual(['1,099', '299', '699']);
    expect(prices(kbPricing)).toEqual(prices(coreContext));
  });

  it('EN and HI halves of the core context carry the same prices (P7)', () => {
    const prices = (s: string) =>
      [...new Set([...s.matchAll(/₹\s?([\d,]+)/g)].map((m) => m[1]))].sort();
    expect(prices(hiHalf)).toEqual(prices(enHalf));
  });

  it('EN and HI halves both carry the cancellation clause — neither may be harsher (P7)', () => {
    // Regression guard: the HI half previously stopped at "Cancel anytime"
    // and omitted "…takes effect at end of current billing month, access
    // until that date", making Hindi read as an immediate cut-off.
    for (const [label, half] of [['EN', enHalf], ['HI', hiHalf]] as const) {
      expect(norm(half), `${label} half missing cancellation clause`).toContain(
        'Cancellation takes effect at end of current billing month',
      );
    }
  });

  it('EN and HI halves both state the Maths+Science-only scope (P7)', () => {
    expect(norm(enHalf)).toContain('We teach Mathematics and Science only');
    expect(norm(hiHalf)).toContain('हम केवल गणित और विज्ञान पढ़ाते हैं');
  });
});
