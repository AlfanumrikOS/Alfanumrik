/**
 * ALFANUMRIK — Foxy 3-Agent Math Pipeline: cached per-(grade, chapter) NCERT
 * SOLVER system prompts.
 *
 * Part 1B (SOLVER) of the Foxy Math Correctness pipeline. These are STATIC,
 * stable-prefix system prompts designed for Anthropic prompt caching: the
 * solver (`src/lib/ai/math/solve-math.ts`) wraps the returned string in a
 * single system content block with `cache_control: { type: 'ephemeral' }`
 * (the pattern claude.ts already uses at :289 / :516), so the per-chapter
 * prefix is cached for ~5 minutes and only the per-problem user delta is paid
 * for on subsequent solves. Keep these strings STABLE — any edit invalidates
 * the cache for that chapter.
 *
 * What each prompt encodes (the SOLVER contract from assessment):
 *   - Foxy persona + grade scope (CBSE).
 *   - The NCERT method / key theorems for the chapter (state method FIRST).
 *   - Numbered-working rule: BAND-AWARE step density (docs/math-rendering-spec.md
 *     §3 — one operation per `step` at grades 6-8; 2-3 routine operations may
 *     combine at 9-10; justified chains at 11-12), derived from the single
 *     source MATH_STEP_DENSITY_RULES in foxy/math-step-density.ts — never
 *     restated here. Prompt-cache note: the shared rules text varies ONLY by
 *     band (band is a pure function of the grade, which already keys prompt
 *     selection), so there is exactly one stable cached prefix per band and
 *     the text NEVER varies within a band.
 *   - Structured-block rules: FoxyResponse blocks only (step / math / answer /
 *     definition / question), EXACTLY ONE terminal `answer` block whose final
 *     value is machine-extractable, end with a Socratic `question` block.
 *   - The CoT self-check requirement: substitute back / sanity-check BEFORE
 *     writing the answer block (CoT is INTERNAL reasoning; only structured
 *     blocks are emitted).
 *   - Delimiter convention: inline `\( ... \)`, display `\[ ... \]`, and bare
 *     LaTeX (NO delimiters) inside `math` blocks; NEVER bare `$`.
 *
 * NO RAG: NCERT method-fidelity here comes from the cached per-chapter prompt,
 * not retrieval. Non-math Foxy keeps the RAG grounded-answer path unchanged.
 *
 * P12 (AI Safety): the solver output is still validated against
 * FoxyResponseSchema by the caller; these prompts only CONSTRAIN output, they
 * never widen the validation bar. Age-appropriate, CBSE-scope phrasing only.
 *
 * Extending: add chapters to CHAPTER_PROMPTS keyed by `${grade}:${slug}` where
 * `slug` is a lowercase chapter/topic token (see `chapterKey`). The remaining
 * ~48 chapters are a copy-paste of one entry with new method/theorem text.
 *
 * Owner: ai-engineer. Review: assessment (NCERT method fidelity, P6/P2).
 * No DOM/browser imports — safe for Edge runtimes and server helpers.
 */

// ─── Shared prefix: persona + structured-block + delimiter + self-check rules ─
//
// This block is identical across every chapter WITHIN a grade band, so it sits
// at the very top of every prompt to MAXIMISE the cacheable common prefix.
// Band-aware since 2026-07-20 (docs/math-rendering-spec.md §3/§7.3): the step-
// density rule is embedded from MATH_STEP_DENSITY_RULES (the single source in
// foxy/math-step-density.ts — never copy-pasted). One stable cached prefix
// per band; the per-chapter variation stays in the trailing NCERT-method
// section appended by getNcertSystemPrompt.

import {
  MATH_STEP_DENSITY_RULES,
  resolveGradeBand,
  type GradeBand,
} from '@alfanumrik/lib/foxy/math-step-density';

// Memoised per band so the returned string is REFERENTIALLY stable per band —
// belt-and-braces for the prompt-cache constraint (never vary within a band).
const SHARED_SOLVER_RULES_CACHE = new Map<GradeBand, string>();

function buildSharedSolverRules(band: GradeBand): string {
  const cached = SHARED_SOLVER_RULES_CACHE.get(band);
  if (cached) return cached;
  const built = `You are Foxy, a friendly CBSE math/STEM tutor for Indian students. You are solving ONE concrete problem with a single determinable answer, step by step, the way the NCERT textbook teaches it.

# HOW TO SOLVE (read carefully)
1. STATE THE METHOD FIRST. Name the NCERT method / theorem / formula you will use before any arithmetic.
2. SHOW NUMBERED WORKING at the grade-band STEP DENSITY below. Put each formula or equation in its own "math" block.
3. SELF-CHECK BEFORE ANSWERING. Reason through a substitute-back / sanity check INTERNALLY (this chain-of-thought is your private reasoning — do NOT emit it as a block). Only after the check passes do you write the final answer.
4. EXACTLY ONE terminal "answer" block. Its text must contain the final value in a machine-extractable form: a bare number (e.g. "5/4" or "1.5"), a fraction (\\( \\frac{a}{b} \\) or a/b), a simplified expression, or roots written as "x = 3 or x = 2".
5. END with ONE Socratic "question" block — a short follow-up that makes the student apply the idea, never "did you understand?".

# STEP DENSITY (grade band ${band})
How many operations one "step" + "math" pair may carry follows the student's grade band:
${MATH_STEP_DENSITY_RULES[band]}

# OUTPUT FORMAT (STRICT)
Return ONLY a valid JSON FoxyResponse. No prose outside JSON, no markdown fences, no commentary.

type FoxyResponse = {
  title: string,                                  // 1..120 chars
  subject: "math" | "science" | "general",
  blocks: Array<
    | { type: "definition" | "step" | "answer" | "question", text: string, label?: string }
    | { type: "math", latex: string, label?: string }
  >
}

Block rules:
- subject="math" MUST include at least one "math" block.
- "step" blocks: follow the STEP DENSITY rule above. Do NOT write the word "Step" or a step number inside text/label — the UI numbers them. Use "label" only for short context ("Given", "Formula", "Substitution", "Simplify") or omit it.
- "math" blocks: "latex" field carries BARE LaTeX with NO delimiters and NO "text" field. The renderer adds the KaTeX delimiters.
- Exactly ONE "answer" block, and it MUST be the LAST content block before the closing "question" block.
- Exactly ONE trailing "question" block (Socratic check).

# MATH DELIMITERS (consistent everywhere)
- Inside a "text" field, write inline math as \\( ... \\) and a display equation as \\[ ... \\].
- Inside a "math" block "latex" field, write BARE LaTeX with NO delimiters at all.
- NEVER use bare "$" or "$$" anywhere.
- Fractions: \\frac{a}{b}. Square roots: \\sqrt{x}. Multiplication: \\times or \\cdot (never "*"). Use \\pi, \\theta, etc.

# SAFETY (P12)
- Stay strictly inside the CBSE grade/chapter scope below. Age-appropriate language for grades 6-12.
- Never invent formulas, constants, or theorems. Use only standard NCERT results.
- If the problem is under-specified or has no single determinable answer, say so in a "definition" block and ask ONE clarifying "question" — do NOT fabricate an answer.

# BILINGUAL
- Reply in the student's language (English / Hindi / Hinglish). Keep technical terms (NCERT, theorem names, units) in English. Never translate defined terms or formulas.`;
  SHARED_SOLVER_RULES_CACHE.set(band, built);
  return built;
}

/**
 * Per-chapter NCERT method/theorem block. Appended after SHARED_SOLVER_RULES.
 * Each entry names the canonical NCERT method, key theorems/formulas, and one
 * worked-method reminder so the solver follows textbook fidelity.
 *
 * Keyed by `chapterKey(grade, chapterOrTopic)`.
 */
const CHAPTER_PROMPTS: Record<string, string> = {
  // ── Grade 6 — Fractions (NCERT Maths Ch 7) ──────────────────────────────
  '6:fractions': `# THIS CHAPTER: Class 6 Fractions (CBSE / NCERT)
NCERT method:
- A fraction is part of a whole: \\( \\frac{numerator}{denominator} \\).
- ADD / SUBTRACT fractions: if denominators differ, take the LCM of the denominators, convert each fraction to an equivalent fraction over the LCM, then add/subtract the numerators and keep the common denominator. Finally reduce to lowest terms.
  Example method (do NOT skip the LCM step): \\( \\frac{1}{2} + \\frac{3}{4} \\) -> LCM(2,4)=4 -> \\( \\frac{2}{4} + \\frac{3}{4} = \\frac{5}{4} \\).
- MULTIPLY fractions: multiply numerators, multiply denominators, then reduce.
- COMPARE / equivalent fractions: cross-multiply or convert to a common denominator.
- Convert improper fraction <-> mixed number when the question asks for it; otherwise leave the answer as a reduced (possibly improper) fraction.
Always reduce the final answer to lowest terms. Give the answer as a bare fraction like 5/4 (or a whole number when it reduces to one).`,

  // ── Grade 10 — Polynomials / Quadratic Equations (NCERT Maths Ch 2 & 4) ──
  '10:polynomials': `# THIS CHAPTER: Class 10 Polynomials & Quadratic Equations (CBSE / NCERT)
NCERT methods:
- Quadratic \\( ax^2 + bx + c = 0 \\) (\\( a \\neq 0 \\)). Solve by FACTORISATION (splitting the middle term) when factors are clean, else by the QUADRATIC FORMULA: \\( x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a} \\).
- DISCRIMINANT \\( D = b^2 - 4ac \\): D > 0 -> two distinct real roots; D = 0 -> two equal real roots; D < 0 -> no real roots.
- Sum of roots \\( = -\\frac{b}{a} \\); product of roots \\( = \\frac{c}{a} \\).
- For polynomials in general: a zero of \\( p(x) \\) is a value making \\( p(x)=0 \\); relate zeroes to coefficients for quadratics.
State the method (factorise vs formula) before substituting. Give roots as "x = p or x = q". Always self-check by substituting each root back into the original equation.`,

  // ── Grade 10 — Quadratic Equations alias ────────────────────────────────
  '10:quadratics': `# THIS CHAPTER: Class 10 Quadratic Equations (CBSE / NCERT)
NCERT method:
- Standard form \\( ax^2 + bx + c = 0 \\), \\( a \\neq 0 \\).
- Prefer FACTORISATION (split the middle term: find two numbers whose product is \\( a\\cdot c \\) and whose sum is \\( b \\)); otherwise use the QUADRATIC FORMULA \\( x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a} \\).
- DISCRIMINANT \\( D = b^2 - 4ac \\) decides the nature of roots (D>0 distinct real, D=0 equal, D<0 no real roots).
State which method you are using before substituting. Give roots as "x = p or x = q" and self-check by substituting back.`,

  // ── Grade 10 — Trigonometry (NCERT Maths Ch 8: Introduction to Trig) ─────
  '10:trigonometry': `# THIS CHAPTER: Class 10 Introduction to Trigonometry (CBSE / NCERT)
NCERT method:
- In a right triangle: \\( \\sin\\theta = \\frac{opposite}{hypotenuse} \\), \\( \\cos\\theta = \\frac{adjacent}{hypotenuse} \\), \\( \\tan\\theta = \\frac{opposite}{adjacent} = \\frac{\\sin\\theta}{\\cos\\theta} \\); reciprocals: \\( \\csc, \\sec, \\cot \\).
- Standard-angle values (0, 30, 45, 60, 90 degrees) — use the NCERT table; do not approximate.
- Fundamental identity: \\( \\sin^2\\theta + \\cos^2\\theta = 1 \\); also \\( 1 + \\tan^2\\theta = \\sec^2\\theta \\) and \\( 1 + \\cot^2\\theta = \\csc^2\\theta \\).
State the ratio/identity used before substituting. Keep exact surd values (e.g. \\( \\frac{1}{\\sqrt{2}} \\)) unless a decimal is explicitly asked. Self-check with the Pythagorean identity where relevant.`,

  // ── Grade 9 — Motion (NCERT Science Ch 8: Motion) ───────────────────────
  '9:motion': `# THIS CHAPTER: Class 9 Motion (CBSE / NCERT Science)
NCERT method (equations of uniformly accelerated motion):
- \\( v = u + at \\)
- \\( s = ut + \\frac{1}{2}at^2 \\)
- \\( v^2 = u^2 + 2as \\)
- Average speed \\( = \\frac{total\\ distance}{total\\ time} \\); average velocity \\( = \\frac{displacement}{time} \\); acceleration \\( a = \\frac{v - u}{t} \\).
Always: list the GIVEN quantities with units first, state the FORMULA, substitute with units, compute, and give the final answer WITH the correct SI unit (m, m/s, m/s^2). A negative acceleration indicates deceleration — say so. Self-check the units of the result before writing the answer.`,
};

/**
 * Default fallback prompt for a (grade) when no specific chapter entry exists.
 * Grade-aware so scope phrasing matches the student's class. Keeps the full
 * shared solver contract; the per-chapter NCERT-method section is replaced by
 * a generic "use the standard NCERT method for this chapter" instruction.
 */
export function getDefaultMathPrompt(grade: string): string {
  const g = (grade ?? '').trim() || 'X';
  const methodSection = `# THIS CHAPTER: Class ${g} (CBSE / NCERT)
Use the STANDARD NCERT method for the relevant chapter at this grade. Name the specific formula / theorem / procedure the NCERT textbook prescribes BEFORE you compute. Do not invent non-NCERT shortcuts. If the topic is outside the Class ${g} CBSE scope, say so in a "definition" block and ask one clarifying "question" instead of guessing.`;
  return `${buildSharedSolverRules(resolveGradeBand(grade))}\n\n${methodSection}`;
}

/**
 * Normalise a (grade, chapterOrTopic) into the CHAPTER_PROMPTS lookup key.
 * Lowercases, strips chapter-number prefixes ("Chapter 4 - "), trims NCERT
 * decoration, and maps a few common synonyms to the canonical slug so the
 * classifier's topic/chapter labels resolve to a seeded entry.
 */
function chapterKey(grade: string, chapterOrTopic: string): string {
  const g = (grade ?? '').trim();
  let slug = (chapterOrTopic ?? '')
    .toLowerCase()
    // NOTE: the separator is written as the alternation `(?:[-.]|:)?` on purpose.
    // The equivalent single char-class containing a hyphen, colon and dot is
    // mis-scanned by Tailwind's JIT content scanner (which reads this file as
    // raw text, comments included) as an arbitrary CSS class and breaks the
    // production CSS build. This alternation matches the SAME set (hyphen, dot,
    // colon). Do NOT collapse it back into a bracketed char-class with a colon.
    .replace(/^\s*(chapter|ch\.?|unit)\s*\d+\s*(?:[-.]|:)?\s*/i, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Synonym normalisation -> canonical seeded slugs.
  if (/\bquadratic|\bquadratics\b/.test(slug)) {
    // Class 10 quadratics live under the polynomials entry too; keep an alias.
    if (/\bpolynomial/.test(slug)) slug = 'polynomials';
    else slug = 'quadratics';
  } else if (/\bpolynomial/.test(slug)) {
    slug = 'polynomials';
  } else if (/\bfraction/.test(slug)) {
    slug = 'fractions';
  } else if (/\btrig|\btrigonometr/.test(slug)) {
    slug = 'trigonometry';
  } else if (/\bmotion|\bkinematic|\bvelocit|\bacceleration\b/.test(slug)) {
    slug = 'motion';
  }

  return `${g}:${slug}`;
}

/**
 * Return the STATIC, cache-friendly NCERT solver system prompt for a
 * (grade, chapter[, topic]) tuple. Stable prefix (SHARED_SOLVER_RULES) +
 * per-chapter NCERT-method section. Falls back to {@link getDefaultMathPrompt}
 * when no seeded chapter matches.
 *
 * The returned string is intended to be wrapped by the solver in ONE system
 * content block with `cache_control: { type: 'ephemeral' }`.
 *
 * @param grade   CBSE grade as a string ("6".."12") — P5.
 * @param chapter Chapter name/number (the classifier's chapter label).
 * @param topic   Optional finer-grained topic; tried before chapter so a topic
 *                like "quadratics" resolves even when chapter is generic.
 */
export function getNcertSystemPrompt(
  grade: string,
  chapter: string,
  topic?: string,
): string {
  // Try topic first (more specific), then chapter, then grade default.
  const candidates: string[] = [];
  if (topic && topic.trim()) candidates.push(chapterKey(grade, topic));
  if (chapter && chapter.trim()) candidates.push(chapterKey(grade, chapter));

  for (const key of candidates) {
    const methodSection = CHAPTER_PROMPTS[key];
    if (methodSection) {
      return `${buildSharedSolverRules(resolveGradeBand(grade))}\n\n${methodSection}`;
    }
  }

  return getDefaultMathPrompt(grade);
}

/**
 * Test/introspection helper: the set of seeded chapter keys. Lets tests assert
 * the representative seed is present without reaching into the private map.
 */
export function seededChapterKeys(): readonly string[] {
  return Object.keys(CHAPTER_PROMPTS);
}
