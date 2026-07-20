// apps/host/src/__tests__/lib/foxy/math-density-drift-guard.test.ts
//
// DRIFT GUARD — grade-band step-density single source (docs/math-rendering-spec.md §6).
//
// The step-density rule has exactly ONE in-code source: MATH_STEP_DENSITY_RULES
// in packages/lib/src/foxy/math-step-density.ts, composed into the three band
// directives by buildMathFormatDirective and embedded into the NCERT solver
// prompts by buildSharedSolverRules. Static prompt templates (the
// grounded-answer foxy_tutor_v1 template — BOTH the canonical .txt and its
// runtime-preferred inline.ts twin) must DEFER to that source, never restate
// a competing band density rule. This file fails the build if:
//
//   1. foxy_tutor_v1.txt §8 stops deferring to docs/math-rendering-spec.md /
//      the mode_directive injection channel, or loses its conservative
//      no-directive default.
//   2. Any band-specific density text is COPY-PASTED into the .txt (a second
//      independently-tuned density rule — rejectable per spec §6).
//   3. The .txt and inline.ts §8 blocks drift apart (the runtime serves the
//      INLINE copy preferentially — see grounded-answer/prompts/index.ts).
//   4. The .txt loses the spec §4 answer-block vs \boxed{} disambiguation.
//   5. The solver prompts stop deriving their density rule from
//      MATH_STEP_DENSITY_RULES, or regress to the 6-8-absolute
//      "one operation per step" line for senior grades.
//
// String-containment canaries by design (cheap, deterministic, no LLM).
// Owner: ai-engineer. Review: assessment (density definition), testing.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  MATH_STEP_DENSITY_RULES,
  resolveGradeBand,
} from '@alfanumrik/lib/foxy/math-step-density';
import type { GradeBand } from '@alfanumrik/lib/foxy/math-step-density';
import { buildMathFormatDirective } from '@alfanumrik/lib/foxy/prompt-sections';
import { getNcertSystemPrompt, getDefaultMathPrompt } from '@alfanumrik/lib/math/ncert-prompts';

const ALL_BANDS: GradeBand[] = ['6-8', '9-10', '11-12'];

/** cwd-insensitive repo-root resolution (same walker as math-format-directive.test.ts). */
function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'supabase', 'functions'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `math-density-drift-guard: could not locate supabase/functions walking up from ${process.cwd()}`,
  );
}

const REPO_ROOT = findRepoRoot();
const TXT_PATH = join(
  REPO_ROOT,
  'supabase/functions/grounded-answer/prompts/foxy_tutor_v1.txt',
);
const INLINE_PATH = join(
  REPO_ROOT,
  'supabase/functions/grounded-answer/prompts/inline.ts',
);

const txt = readFileSync(TXT_PATH, 'utf8');
const inlineSrc = readFileSync(INLINE_PATH, 'utf8');

/** Extract §8 (Strict Mathematical Formatting Rules) from the .txt template. */
function extractSection8(src: string): string {
  const start = src.indexOf('8. Strict Mathematical Formatting Rules:');
  if (start === -1) throw new Error('foxy_tutor_v1.txt: §8 header not found');
  const end = src.indexOf('Optimize the answer', start);
  if (end <= start) throw new Error('foxy_tutor_v1.txt: §8 terminator not found');
  return src.slice(start, end);
}

/** Extract §4 (Stepwise Solving for Numericals) from the .txt template. */
function extractSection4(src: string): string {
  const start = src.indexOf('4. Stepwise Solving for Numericals');
  if (start === -1) throw new Error('foxy_tutor_v1.txt: §4 header not found');
  const end = src.indexOf('5. Subject-Specific Rules:', start);
  if (end <= start) throw new Error('foxy_tutor_v1.txt: §4 terminator not found');
  return src.slice(start, end);
}

const section8 = extractSection8(txt);
const section4 = extractSection4(txt);

describe('foxy_tutor_v1.txt §8 — density text DEFERS to the single source', () => {
  it('references docs/math-rendering-spec.md as the authoritative band rule', () => {
    expect(section8).toContain('docs/math-rendering-spec.md');
    expect(section8).toContain('buildMathFormatDirective');
  });

  it('names the injection channel (mode directive) for the band-specific text', () => {
    expect(section8).toContain('injected into this prompt through the mode directive');
  });

  it('keeps the conservative no-directive default (6-8 behavior when the flag is OFF)', () => {
    expect(section8).toContain('When no band directive is present');
    expect(section8).toContain('never compress multiple operations into one line');
  });

  it('does NOT copy-paste any band-specific density text (no second tuned rule)', () => {
    for (const band of ALL_BANDS) {
      expect(
        section8.includes(MATH_STEP_DENSITY_RULES[band]),
        `§8 must not restate the ${band} density text`,
      ).toBe(false);
    }
    // Distinctive per-band markers must live ONLY in TS, never in the .txt.
    for (const marker of [
      '2-3 ROUTINE operations',
      'justified equation chains',
      'FOIL',
    ]) {
      expect(section8.includes(marker), `§8 must not contain "${marker}"`).toBe(false);
    }
  });

  it('carries the spec §4 answer-block vs \\boxed{} disambiguation', () => {
    expect(section8).toContain('"answer" block IS the boxed-answer convention');
    expect(section8).toContain('do NOT additionally wrap the value in \\boxed{}');
    expect(section8).toContain('\\boxed{...}');
  });

  it('agrees with the TS directive on the delimiter contract (spec §2 — band-invariant)', () => {
    // Both the static §8 and every band directive mandate \( ... \) and forbid $/$$.
    expect(section8).toContain('\\( ... \\)');
    expect(section8).toMatch(/NEVER use bare "\$" or "\$\$"/);
    for (const band of ALL_BANDS) {
      const d = buildMathFormatDirective(band);
      expect(d).toContain('\\( ... \\)');
      expect(d).toContain('NEVER write LaTeX without delimiters');
    }
  });
});

describe('foxy_tutor_v1.txt §4 — stepwise-numericals text DEFERS to §8 (assessment conditions, 2026-07-20)', () => {
  it('pins the deferential phrasing mirrored from foxy_tutor_exam_v1 §4 (stage completeness, not step density)', () => {
    expect(section4).toContain(
      'never skip a stage (formula -> substitution -> calculation -> final answer)',
    );
    expect(section4).toContain(
      'Step DENSITY within the working (how many operations one line may carry) follows the Mathematical Formatting Rules in section 8',
    );
  });

  it('defers final-answer boxing to §8 (answer-block vs \\boxed{} — spec §4), never restates its own boxing rule', () => {
    expect(section4).toContain(
      "final-answer boxing follows section 8's answer-block vs \\boxed{} rule",
    );
    // The Final Answer scaffold line must stay boxing-neutral (units only).
    expect(section4).toContain('Final Answer: [emphasize with correct units]');
  });

  it('the retired absolute lines cannot return (competing density/boxing rules)', () => {
    expect(section4).not.toContain('never skip intermediate steps');
    expect(section4).not.toContain('box/highlight the final answer');
    expect(section4).not.toContain('Box/emphasize');
  });
});

describe('foxy_tutor_v1 — retired strings are gone from BOTH twins (whole-template canaries)', () => {
  it('"box/highlight the final answer" (pre-spec §4 boxing rule) appears nowhere', () => {
    expect(txt).not.toContain('box/highlight the final answer');
    expect(inlineSrc).not.toContain('box/highlight the final answer');
  });

  it('the "or x²" Unicode-superscript allowance (spec §2 violation) appears nowhere', () => {
    expect(txt).not.toContain('or x²');
    expect(inlineSrc).not.toContain('or x²');
    // No Unicode superscript-two anywhere in any served prompt text.
    expect(txt).not.toContain('²');
    expect(inlineSrc).not.toContain('²');
  });

  it('§8 requires LaTeX ^{...} superscripts inside delimiters and scopes the programming-syntax ban to prose', () => {
    expect(section8).toContain(
      'true superscripts written with LaTeX ^{...} inside math delimiters',
    );
    expect(section8).toContain('never plain Unicode superscript characters');
    expect(section8).toContain('in prose OUTSIDE math delimiters');
  });
});

describe('inline.ts (runtime-preferred copy) — §4/§8 byte-parity with the canonical .txt', () => {
  it('the FOXY_TUTOR_V1 inline template contains the .txt §8 block VERBATIM', () => {
    // loadTemplate prefers INLINE_PROMPTS over the .txt file, so an edit to
    // one without the other silently forks the served prompt.
    expect(inlineSrc).toContain(section8);
  });

  it('the FOXY_TUTOR_V1 inline template contains the .txt §4 block VERBATIM', () => {
    expect(inlineSrc).toContain(section4);
  });
});

describe('NCERT solver prompts — density derives from MATH_STEP_DENSITY_RULES', () => {
  const CASES: Array<[string, string]> = [
    ['6', getNcertSystemPrompt('6', 'fractions')],
    ['8', getDefaultMathPrompt('8')],
    ['9', getNcertSystemPrompt('9', 'motion')],
    ['10', getNcertSystemPrompt('10', 'quadratics')],
    ['11', getDefaultMathPrompt('11')],
    ['12', getDefaultMathPrompt('12')],
  ];

  it.each(CASES)('grade %s prompt embeds ITS band density text and no other band\'s', (grade, prompt) => {
    const band = resolveGradeBand(grade);
    expect(prompt).toContain(`# STEP DENSITY (grade band ${band})`);
    expect(prompt).toContain(MATH_STEP_DENSITY_RULES[band]);
    for (const other of ALL_BANDS.filter((b) => b !== band)) {
      expect(
        prompt.includes(MATH_STEP_DENSITY_RULES[other]),
        `grade ${grade} prompt must not carry the ${other} density text`,
      ).toBe(false);
    }
  });

  it('the retired 6-8-absolute solver line is gone (band rule replaced it)', () => {
    for (const [, prompt] of CASES) {
      expect(prompt).not.toContain(
        'One operation per "step" block — never combine two operations in one step',
      );
    }
  });

  it('solver text is stable WITHIN a band (prompt-cache constraint: one prefix per band)', () => {
    // Same band, different grades → identical shared-rules prefix.
    const p11 = getDefaultMathPrompt('11');
    const p12 = getDefaultMathPrompt('12');
    const cut11 = p11.indexOf('# THIS CHAPTER');
    const cut12 = p12.indexOf('# THIS CHAPTER');
    expect(p11.slice(0, cut11)).toBe(p12.slice(0, cut12));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Delimiter-contract closure (2026-07-20): EVERY content generator template
// carries the spec §2 delimiter contract and DEFERS step density to the single
// source. Five additional grounded-answer templates were aligned:
//   quiz_question_generator_v1  (raw-markdown explanation → §4 \boxed{})
//   quiz_answer_verifier_v1     (delimiters only — its "reason" is prose)
//   ncert_solver_v1             (raw markdown, NO band-directive channel)
//   foxy_tutor_doubt_v1         (structured surface, mode_directive channel)
//   foxy_tutor_exam_v1          (structured surface, mode_directive channel —
//                                note: the Foxy route currently skips the math
//                                directive on practice turns, so the
//                                conservative no-directive default governs)
// ─────────────────────────────────────────────────────────────────────────────

const CLOSURE_TEMPLATE_IDS = [
  'quiz_question_generator_v1',
  'quiz_answer_verifier_v1',
  'ncert_solver_v1',
  'foxy_tutor_doubt_v1',
  'foxy_tutor_exam_v1',
] as const;
type ClosureTemplateId = (typeof CLOSURE_TEMPLATE_IDS)[number];

const closureTemplates: Record<ClosureTemplateId, string> = Object.fromEntries(
  CLOSURE_TEMPLATE_IDS.map((id) => [
    id,
    readFileSync(
      join(REPO_ROOT, `supabase/functions/grounded-answer/prompts/${id}.txt`),
      'utf8',
    ),
  ]),
) as Record<ClosureTemplateId, string>;

/** Templates whose output carries worked steps → density deferral required. */
const DENSITY_IDS: ClosureTemplateId[] = [
  'quiz_question_generator_v1',
  'ncert_solver_v1',
  'foxy_tutor_doubt_v1',
  'foxy_tutor_exam_v1',
];

/** Templates with a {{mode_directive}} slot the band directive injects into. */
const CHANNELED_IDS: ClosureTemplateId[] = ['foxy_tutor_doubt_v1', 'foxy_tutor_exam_v1'];

/** Templates with NO band-directive channel (Deno-side callers, no mode_directive slot). */
const UNCHANNELED_IDS: ClosureTemplateId[] = ['quiz_question_generator_v1', 'ncert_solver_v1'];

/** Raw-markdown surfaces (no structured "answer" block) → \boxed{...} rule. */
const RAW_MARKDOWN_IDS: ClosureTemplateId[] = ['quiz_question_generator_v1', 'ncert_solver_v1'];

/** Structured JSON surfaces → answer-block-IS-the-box disambiguation. */
const STRUCTURED_IDS: ClosureTemplateId[] = ['foxy_tutor_doubt_v1', 'foxy_tutor_exam_v1'];

describe('delimiter-contract closure — .txt/inline twins stay byte-identical', () => {
  it.each(CLOSURE_TEMPLATE_IDS)(
    '%s: the full .txt template appears VERBATIM in inline.ts (runtime serves the inline copy)',
    (id) => {
      // loadTemplate prefers INLINE_PROMPTS over the .txt file, so an edit to
      // one without the other silently forks the served prompt.
      expect(inlineSrc).toContain(closureTemplates[id].trimEnd());
    },
  );
});

describe('delimiter-contract closure — spec §2 delimiter contract present everywhere', () => {
  it.each(CLOSURE_TEMPLATE_IDS)('%s: references the spec and mandates \\( ... \\), forbids $/$$', (id) => {
    const t = closureTemplates[id];
    expect(t).toContain('docs/math-rendering-spec.md');
    expect(t).toContain('\\( ... \\)');
    expect(t).toMatch(/NEVER use bare "\$" or "\$\$"/);
  });

  it.each(CLOSURE_TEMPLATE_IDS)('%s: forbids ASCII math ("x^2", "sqrt(x)", "(a+b)/c")', (id) => {
    const t = closureTemplates[id];
    expect(t).toContain('"x^2"');
    expect(t).toContain('"sqrt(x)"');
    expect(t).toContain('"(a+b)/c"');
  });
});

describe('delimiter-contract closure — density DEFERS to the single source', () => {
  it.each(DENSITY_IDS)('%s: names the spec §3 band rule and buildMathFormatDirective', (id) => {
    const t = closureTemplates[id];
    expect(t).toContain('docs/math-rendering-spec.md section 3');
    expect(t).toContain('buildMathFormatDirective');
    expect(t).toContain('never compress multiple operations into one line');
  });

  it.each(CHANNELED_IDS)('%s: names the mode-directive injection channel + conservative default', (id) => {
    const t = closureTemplates[id];
    expect(t).toContain('injected into this prompt through the mode directive');
    expect(t).toContain('When no band directive is present');
  });

  it.each(UNCHANNELED_IDS)('%s: declares it has NO band-directive channel (deferential default)', (id) => {
    expect(closureTemplates[id]).toContain('NO band-directive injection channel');
  });

  it.each(CLOSURE_TEMPLATE_IDS)('%s: does NOT copy-paste any band density text (spec §6)', (id) => {
    const t = closureTemplates[id];
    for (const band of ALL_BANDS) {
      expect(
        t.includes(MATH_STEP_DENSITY_RULES[band]),
        `${id} must not restate the ${band} density text`,
      ).toBe(false);
    }
    for (const marker of ['2-3 ROUTINE operations', 'justified equation chains', 'FOIL']) {
      expect(t.includes(marker), `${id} must not contain "${marker}"`).toBe(false);
    }
  });
});

describe('delimiter-contract closure — spec §4 boxing rule per surface type', () => {
  it.each(RAW_MARKDOWN_IDS)('%s (raw markdown): mandates \\boxed{...} for the final value', (id) => {
    const t = closureTemplates[id];
    expect(t).toContain('\\boxed{...}');
    expect(t).toContain('NO structured "answer" block');
  });

  it.each(STRUCTURED_IDS)('%s (structured): answer block IS the box, no double-boxing', (id) => {
    const t = closureTemplates[id];
    expect(t).toContain('"answer" block IS the boxed-answer convention');
    expect(t).toContain('do NOT additionally wrap the value in \\boxed{}');
  });
});

describe('delimiter-contract closure — retired absolute lines are gone', () => {
  it('foxy_tutor_doubt_v1: the 6-8-absolute "numericals. Never compress" line is retired', () => {
    expect(closureTemplates.foxy_tutor_doubt_v1).not.toContain(
      'numericals. Never compress multiple operations into one line',
    );
  });

  it('foxy_tutor_exam_v1: "never skip intermediate steps" and the vague final-answer line are retired', () => {
    expect(closureTemplates.foxy_tutor_exam_v1).not.toContain('never skip intermediate steps');
    expect(closureTemplates.foxy_tutor_exam_v1).not.toContain(
      'Final answers should be clearly distinguished',
    );
  });

  it('ncert_solver_v1: the under-specified "Use LaTeX for math" line is retired', () => {
    expect(closureTemplates.ncert_solver_v1).not.toContain('- Use LaTeX for math,');
  });
});
