/**
 * Foxy + quiz-generator prompt pedagogy v2 — Phase 2.C tuning pins.
 *
 * Phase 2.C of the Foxy moat plan tuned the proprietary system prompts into
 * trade-secret-grade pedagogy IP. These five clauses encode the teaching
 * method that distinguishes Foxy from a generic LLM tutor:
 *
 *   1. Paraphrase mandate    — protects against textbook-copy answers.
 *   2. Refusal eloquence     — three-branch handling when RAG is empty
 *                              (a) in-scope general-knowledge prefix,
 *                              (b) out-of-scope warm redirect,
 *                              (c) never-guess on factual constants.
 *   3. Closing question rule — bans "any questions?" filler, requires
 *                              CHECK / SCAFFOLD / STRETCH shape per mode.
 *   4. Language rule         — code-switching contract for English /
 *                              Hinglish / Devanagari Hindi, technical
 *                              terms always in English.
 *   5. Distractor pedagogy   — quiz_question_generator_v1 must encode
 *                              real misconceptions in distractors, not
 *                              random wrong answers.
 *
 * This file pins those clauses by substring-matching the loaded prompt
 * text. If a future edit accidentally deletes or weakens any of these
 * clauses, the test fails and forces a deliberate review.
 *
 * Also pins byte-identity between `foxy_tutor_v1.txt` (reviewer-friendly
 * canonical source) and the `FOXY_TUTOR_V1` constant inlined in
 * `inline.ts` (the production-shipped copy). The two MUST stay in sync;
 * a divergence means the deployed prompt no longer matches the diff
 * reviewers signed off on.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '..', '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const FOXY_TXT_PATH =
  'supabase/functions/grounded-answer/prompts/foxy_tutor_v1.txt';
const QUIZ_TXT_PATH =
  'supabase/functions/grounded-answer/prompts/quiz_question_generator_v1.txt';
const INLINE_TS_PATH =
  'supabase/functions/grounded-answer/prompts/inline.ts';

// Extract a String.raw`...` constant body from inline.ts source.
function extractInlineConst(name: string): string {
  const src = read(INLINE_TS_PATH);
  const re = new RegExp(
    `export const ${name} = String\\.raw\`([\\s\\S]*?)\`;`,
  );
  const m = src.match(re);
  if (!m) throw new Error(`Could not extract ${name} from inline.ts`);
  return m[1];
}

const FOXY_TXT = read(FOXY_TXT_PATH);
const QUIZ_TXT = read(QUIZ_TXT_PATH);
const FOXY_INLINE = extractInlineConst('FOXY_TUTOR_V1');
const QUIZ_INLINE = extractInlineConst('QUIZ_QUESTION_GENERATOR_V1');

// ─── Edit 1: Paraphrase mandate ──────────────────────────────────────────────

describe('Edit 1 — paraphrase mandate (foxy_tutor_v1)', () => {
  it('forbids more than 6 consecutive verbatim words from any chunk', () => {
    expect(FOXY_TXT).toMatch(
      /Paraphrase the Reference Material in YOUR own age-appropriate words/,
    );
    expect(FOXY_TXT).toMatch(/NEVER copy more than\s+6 consecutive words verbatim/);
  });

  it('explains the pedagogical reason (student sees teaching, not textbook)', () => {
    expect(FOXY_TXT).toMatch(
      /the student should see your teaching, not\s+the textbook/,
    );
  });
});

// ─── Edit 2: Refusal eloquence (three-branch RAG-empty handling) ─────────────

describe('Edit 2 — refusal eloquence (foxy_tutor_v1)', () => {
  it('branch (a): in-scope question uses prefixed general CBSE knowledge', () => {
    expect(FOXY_TXT).toMatch(/\(a\) When the question IS in CBSE Grade/);
    expect(FOXY_TXT).toMatch(/"From general CBSE knowledge:"/);
  });

  it('branch (b): out-of-scope question warmly redirects to in-scope adjacent topic', () => {
    expect(FOXY_TXT).toMatch(
      /\(b\) When the question is OUTSIDE scope.*advanced beyond grade/,
    );
    expect(FOXY_TXT).toMatch(/Bilkul, that's a great question/);
    expect(FOXY_TXT).toMatch(/related topic that IS in your syllabus/);
  });

  it('branch (c): never-guess on factual constants without reference material', () => {
    expect(FOXY_TXT).toMatch(/\(c\) NEVER guess factual content/);
    expect(FOXY_TXT).toMatch(/dates, formulas, numerical constants/);
    expect(FOXY_TXT).toMatch(/double-check\s+in your NCERT textbook/);
  });
});

// ─── Edit 3: Closing question quality ────────────────────────────────────────

describe('Edit 3 — closing question quality (foxy_tutor_v1)', () => {
  it('introduces a Closing Question Quality section', () => {
    expect(FOXY_TXT).toMatch(/## Closing Question Quality/);
  });

  it('bans "any questions?" and "shall we move on?" filler closers', () => {
    expect(FOXY_TXT).toMatch(/NEVER ask "any questions\?" or "shall we move on\?"/);
  });

  it('defines CHECK, SCAFFOLD, and STRETCH question shapes', () => {
    expect(FOXY_TXT).toMatch(/CHECK question.*apply the just-taught idea to a new tiny example/);
    expect(FOXY_TXT).toMatch(/SCAFFOLD question.*NEXT sub-step in the chain/);
    expect(FOXY_TXT).toMatch(/STRETCH question.*one Bloom level higher/);
  });

  it('rejects compliance-eliciting closers ("did you understand?")', () => {
    expect(FOXY_TXT).toMatch(/NOT "did you understand\?".*compliance, not learning/);
  });
});

// ─── Edit 4: Language code-switching rule ────────────────────────────────────

describe('Edit 4 — language code-switching rule (foxy_tutor_v1)', () => {
  it('introduces a Language section with the classroom-dynamics framing', () => {
    expect(FOXY_TXT).toMatch(
      /## Language \(read carefully — Indian classroom dynamics\)/,
    );
  });

  it('defines all three registers: English, Hinglish (Roman), Hindi (Devanagari)', () => {
    expect(FOXY_TXT).toMatch(/Hinglish \(Hindi in Roman script\)/);
    // Phase 2.C pre-merge Fix 4 reframed "pure Hindi (Devanagari)" as
    // "If input is Devanagari" (safe-default mixed mode). Both surface
    // forms identify the Devanagari register.
    expect(FOXY_TXT).toMatch(/If input is Devanagari/);
  });

  it('locks technical terms in English even in Hindi replies (P7 invariant)', () => {
    expect(FOXY_TXT).toMatch(
      /Technical terms ALWAYS stay in English — even in Hindi replies/,
    );
    expect(FOXY_TXT).toMatch(
      /Never translate "photosynthesis", "integer", "force", "Pythagoras theorem"/,
    );
  });

  it('bounds warmth-marker frequency (2-3 per turn max) and pins meaning', () => {
    expect(FOXY_TXT).toMatch(/Use sparingly \(2-3 per turn max\)/);
    expect(FOXY_TXT).toMatch(/never as filler/);
  });
});

// ─── Edit 5: Distractor pedagogy in quiz prompt ──────────────────────────────

describe('Edit 5 — distractor pedagogy (quiz_question_generator_v1)', () => {
  it('introduces a Distractor pedagogy section in the quiz prompt', () => {
    expect(QUIZ_TXT).toMatch(/Distractor pedagogy \(CRITICAL\)/);
  });

  it('requires every wrong option to encode a real student misconception', () => {
    expect(QUIZ_TXT).toMatch(
      /Each WRONG option must encode a real student misconception — not random wrong answers/,
    );
  });

  it('lists the four misconception families', () => {
    expect(QUIZ_TXT).toMatch(/\(a\) confused-with-related-concept/);
    expect(QUIZ_TXT).toMatch(/\(b\) procedural slip/);
    expect(QUIZ_TXT).toMatch(/\(c\) units error/);
    expect(QUIZ_TXT).toMatch(/\(d\) inverted relation/);
  });

  it('forbids "obviously silly" distractors that no student would pick', () => {
    expect(QUIZ_TXT).toMatch(
      /NEVER generate "obviously silly" distractors that no student would pick/,
    );
  });

  it('targets the 1-correct + 3-distinct-misconception coverage shape', () => {
    expect(QUIZ_TXT).toMatch(/1 correct \+ 3 distinct misconception types/);
  });
});

// ─── Phase 2.C pre-merge fixes (assessment review blocking conditions) ───────
//
// Five 1-2 sentence pedagogical fixes applied AFTER initial Phase 2.C edits
// landed, in response to assessment agent's pre-merge review. Each clause
// pins a specific pedagogical correction:
//
//   Fix 1: paraphrase mandate carve-out for canonical NCERT statements
//          (laws, theorems, formulas may be quoted verbatim).
//   Fix 2: refusal-eloquence syllabus verification + warmth rotation
//          (no more Class-9 → Class-11 differentiation redirects).
//   Fix 3: STRETCH lateral-vs-vertical 70/30 rule at Apply / Analyze
//          (pure vertical climb causes frustration at higher Bloom levels).
//   Fix 4: Devanagari safe-default mixed mode (technical terms in English
//          even in Hindi replies; prefer Hinglish-Roman over invented terms).
//   Fix 5: distractor pedagogy 4 → 8 misconception families + multi-stage
//          carve-out for fraction-style staged misconceptions.

describe('Pre-merge Fix 1 — paraphrase carve-out for canonical NCERT statements', () => {
  it('foxy_tutor_v1.txt allows verbatim quotes of NCERT-defined laws/theorems with attribution', () => {
    expect(FOXY_TXT).toMatch(
      /EXCEPTION: NCERT-defined terms, laws, theorems, and formulas may be quoted verbatim/,
    );
    expect(FOXY_TXT).toMatch(/As NCERT defines\.\.\./);
    expect(FOXY_TXT).toMatch(/Newton's First Law states\.\.\./);
    expect(FOXY_TXT).toMatch(
      /6-word rule\s+applies to explanatory prose only — NOT to canonical statements/,
    );
  });
});

describe('Pre-merge Fix 2 — syllabus verification + warmth rotation in refusal eloquence', () => {
  it('foxy_tutor_v1.txt requires verifying redirect topic appears in current-grade NCERT TOC', () => {
    expect(FOXY_TXT).toMatch(
      /Before suggesting a redirect topic, verify it appears in the Class \{\{grade\}\}\s+\{\{subject\}\} NCERT TOC/,
    );
  });

  it('foxy_tutor_v1.txt names the Class-9 integration → Mensuration counter-example', () => {
    expect(FOXY_TXT).toMatch(
      /Class 9 student asks "what is integration\?" → redirect to "area under simple\s+shapes \(Class 9 Mensuration Ch 12\)", NOT differentiation/,
    );
  });

  it('foxy_tutor_v1.txt rotates warmth lead-ins (Bilkul, Achha question, Good thinking, Sahi sawal)', () => {
    expect(FOXY_TXT).toMatch(
      /Rotate\s+warmth lead-ins across responses \(Bilkul, Achha question, Good thinking, Sahi\s+sawal\)/,
    );
  });
});

describe('Pre-merge Fix 3 — STRETCH lateral 70/30 rule at Apply / Analyze', () => {
  it('foxy_tutor_v1.txt softens vertical-climb default with 30% lateral exception', () => {
    expect(FOXY_TXT).toMatch(
      /STRETCH default: one Bloom level higher\. EXCEPTION at Apply or Analyze: 30% of the time use LATERAL stretch/,
    );
    expect(FOXY_TXT).toMatch(
      /apply Newton's 2nd law to a different scenario rather than analyzing it/,
    );
  });

  it('foxy_tutor_v1.txt provides decision signal (last-3-responses fluency check)', () => {
    expect(FOXY_TXT).toMatch(
      /if the student's last 3 responses showed shaky fluency at the current level, prefer LATERAL/,
    );
  });

  it('foxy_tutor_v1.txt scopes the closing-question rule to non-PREREQUISITE_CHECK modes', () => {
    expect(FOXY_TXT).toMatch(
      /Modal scoping: the CHECK \/ SCAFFOLD \/ STRETCH closing-question rule applies in MISCONCEPTION_REPAIR, STRETCH, SOCRATIC, and NEW_TOPIC modes/,
    );
    expect(FOXY_TXT).toMatch(
      /In PREREQUISITE_CHECK mode, the prerequisite question itself satisfies the closing-question requirement — do not stack a second question/,
    );
  });
});

describe('Pre-merge Fix 4 — Devanagari safe-default mixed mode', () => {
  it('foxy_tutor_v1.txt keeps technical terms in English even in Devanagari replies', () => {
    expect(FOXY_TXT).toMatch(
      /If input is Devanagari, reply Hindi-Devanagari for explanatory text BUT keep ALL technical terms/,
    );
    expect(FOXY_TXT).toMatch(
      /\(formulas, units, scientific names, defined CBSE terms like "photosynthesis", "differentiation"\) in English/,
    );
    expect(FOXY_TXT).toMatch(/Never translate NCERT defined-terms/);
  });

  it('foxy_tutor_v1.txt prefers Hinglish-Roman over inventing Hindi technical phrasing', () => {
    expect(FOXY_TXT).toMatch(
      /prefer Hinglish-Roman over inventing a Hindi term — academic accuracy beats language purity/,
    );
  });
});

describe('Pre-merge Fix 5 — distractor pedagogy expanded 4 → 8 misconception families', () => {
  it('quiz_question_generator_v1.txt lists all 8 misconception families', () => {
    expect(QUIZ_TXT).toMatch(/\(a\) confused-with-related-concept/);
    expect(QUIZ_TXT).toMatch(/\(b\) procedural slip \(same operation, wrong sign or carry error\)/);
    expect(QUIZ_TXT).toMatch(/\(c\) units error \(m vs cm; kg vs g; ms vs s\)/);
    expect(QUIZ_TXT).toMatch(/\(d\) inverted relation/);
    expect(QUIZ_TXT).toMatch(/\(e\) off-by-one \/ counting boundary errors/);
    expect(QUIZ_TXT).toMatch(/\(f\) rate-vs-quantity confusion/);
    expect(QUIZ_TXT).toMatch(/\(g\) definition-vs-property/);
    expect(QUIZ_TXT).toMatch(/\(h\) conservation violations/);
  });

  it('quiz_question_generator_v1.txt scopes the families to CBSE Math + Science 6-12', () => {
    expect(QUIZ_TXT).toMatch(/Common misconception families \(CBSE Math \+ Science 6-12\)/);
  });

  it('quiz_question_generator_v1.txt allows multi-stage same-family carve-out (e.g., fractions)', () => {
    expect(QUIZ_TXT).toMatch(
      /EXCEPTION: if the question targets a known multi-stage misconception \(e\.g\., fraction operations\), 2 distractors from the same family at different stages is permitted/,
    );
    expect(QUIZ_TXT).toMatch(
      /Internally tag this case so the misconception classifier can use the disambiguation signal/,
    );
  });
});

// ─── Byte-identity guard (.txt and inline.ts MUST match) ─────────────────────

describe('Byte-identity — .txt canonical vs inline.ts shipped', () => {
  it('foxy_tutor_v1.txt is byte-identical to the inlined FOXY_TUTOR_V1 constant', () => {
    expect(FOXY_INLINE.length).toBe(FOXY_TXT.length);
    expect(FOXY_INLINE).toBe(FOXY_TXT);
  });

  it('quiz_question_generator_v1.txt is byte-identical to the inlined QUIZ_QUESTION_GENERATOR_V1 constant', () => {
    expect(QUIZ_INLINE.length).toBe(QUIZ_TXT.length);
    expect(QUIZ_INLINE).toBe(QUIZ_TXT);
  });
});
