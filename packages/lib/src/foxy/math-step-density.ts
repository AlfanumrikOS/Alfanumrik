// ─────────────────────────────────────────────────────────────────────────────
// Grade-band math step-density rule — THE single in-code source.
//
// SOURCE OF TRUTH: docs/math-rendering-spec.md (assessment-authored, CEO-
// approved 2026-07-20), §3 (bands + density rules) and §6 (single source).
// Every prompt that needs the step-density rule derives from this module —
// buildMathFormatDirective in foxy/prompt-sections.ts composes these texts
// into the per-band math-format directive, and buildSharedSolverRules in
// math/ncert-prompts.ts embeds them into the cached NCERT solver prompts.
// A copy-pasted duplicate density rule anywhere else is a rejectable change
// (spec §6): duplicates drift, and drift means two students at the same grade
// get different formatting contracts.
//
// DELIBERATELY ZERO-IMPORT: ncert-prompts.ts is Edge-runtime-safe with a tiny
// import graph and must stay that way; this module keeps the shared density
// source free of the heavier prompt-sections graph (callClaude, quiz-oracle).
//
// P5: grades are STRINGS "6".."12", never integers.
// P7: the density texts constrain structure only — step text/labels follow
//     the student's language per the consuming prompt's bilingual rules.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Grade band for math-format step density (spec §3.2). Derived from the
 * session grade STRING (P5): "6".."8" → '6-8', "9"/"10" → '9-10',
 * "11"/"12" → '11-12'. Anything unparseable or out of range defaults to
 * '6-8' — the pedagogically conservative fallback (spec §3.2).
 */
export type GradeBand = '6-8' | '9-10' | '11-12';

export function resolveGradeBand(grade: string): GradeBand {
  const n = Number.parseInt(grade, 10);
  if (Number.isFinite(n) && n >= 11 && n <= 12) return '11-12';
  if (Number.isFinite(n) && n >= 9 && n <= 10) return '9-10';
  return '6-8';
}

// ── Per-band density rule bodies (spec §3.2) ────────────────────────────────
//
// NOTE: the '6-8' lines are byte-identical to rule 1's body in the original
// (pre-band-split) MATH_FORMAT_DIRECTIVE — spec §7.2 pins that the previous
// directive text IS the 6-8 band text.

const STEP_DENSITY_6_8_LINES = [
  '- Use a sequence of "step" blocks. Each "step" block\'s text is ONE short',
  '  action line stating what you do (e.g. "Cancel 14 and 42 (divide both by',
  '  14)."), optionally followed by ONE short "why" sentence. Nothing else.',
  '- Immediately after each action step, emit the RESULTING expression as its',
  '  own "math" block (display equation; "latex" field, no delimiters).',
  '- NEVER chain multiple transformations inside one paragraph, one step, or one',
  '  math block. One transformation = one step block + one math block.',
] as const;

const STEP_DENSITY_9_10_LINES = [
  '- Use a sequence of "step" blocks. Each "step" block\'s text is ONE short',
  '  plain-language action line stating what you do, optionally followed by ONE',
  '  short "why" sentence. Nothing else.',
  '- Immediately after each action step, emit the RESULTING expression as its',
  '  own "math" block (display equation; "latex" field, no delimiters).',
  '- One step/math pair MAY combine 2-3 ROUTINE operations (e.g. simplify and',
  '  collect like terms, group and take the common factor out of each pair).',
  '  Non-routine or error-prone moves still get their OWN step/math pair.',
  '- NEVER run a derivation through one prose paragraph, and NEVER pack the',
  '  whole working into one math block.',
] as const;

const STEP_DENSITY_11_12_LINES = [
  '- Use a sequence of "step" blocks alternating with display "math" blocks',
  '  ("latex" field, no delimiters). One step/math pair carries ONE logical',
  '  move of the derivation — it may compress several routine symbolic',
  '  manipulations into that single justified move.',
  '- EVERY such line ends with (or is preceded by) a SHORT justification in',
  '  CBSE terminology using NCERT theorem/result names — e.g. "by the product',
  '  rule (NCERT Class 12)", "by the Fundamental Theorem of Arithmetic".',
  '- Use \\because / \\therefore SPARINGLY, in LaTeX only — never the plain',
  '  Unicode characters. Use NCERT naming, never foreign-textbook mnemonics',
  '  (no "FOIL"; say "chain rule" as NCERT does).',
  '- NEVER run a derivation through one prose paragraph, and NEVER pack the',
  '  whole working into one math block.',
] as const;

/**
 * The canonical per-band step-density rule text (docs/math-rendering-spec.md
 * §3.2). Consumers: rule 1 of each band's math-format directive
 * (foxy/prompt-sections.ts) and the solver's numbered-working rule
 * (math/ncert-prompts.ts). Any prompt needing the density rule derives from
 * THIS record — never restates it (spec §6).
 */
export const MATH_STEP_DENSITY_RULES: Readonly<Record<GradeBand, string>> = {
  '6-8': STEP_DENSITY_6_8_LINES.join('\n'),
  '9-10': STEP_DENSITY_9_10_LINES.join('\n'),
  '11-12': STEP_DENSITY_11_12_LINES.join('\n'),
};
