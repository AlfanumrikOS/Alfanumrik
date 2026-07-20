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
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  MATH_STEP_DENSITY_RULES,
  resolveGradeBand,
} from '@alfanumrik/lib/foxy/math-step-density';
import type { GradeBand } from '@alfanumrik/lib/foxy/math-step-density';
import {
  buildMathFormatDirective,
  MATH_FORMAT_DIRECTIVE,
  VERTICAL_MATH_DIRECTIVE,
} from '@alfanumrik/lib/foxy/prompt-sections';
import { getNcertSystemPrompt, getDefaultMathPrompt } from '@alfanumrik/lib/math/ncert-prompts';
import { buildFoxySystemPrompt } from '@alfanumrik/lib/ai/prompts/foxy-system';

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

// ─────────────────────────────────────────────────────────────────────────────
// foxy-system.ts alignment (2026-07-20, CEO-approved ff_foxy_math_format_v2
// 100% ramp prerequisite): buildFoxySystemPrompt is the base prompt of the
// legacy intent-router path under /api/foxy (explain / revision / doubt-solve
// workflows via runLegacyFoxyFlow — the `ff_grounded_ai_foxy` kill-switch and
// grounded-failure fallback). This surface has NO band-directive injection
// channel: the legacy workflows never compose buildMathFormatDirective onto
// it, so the conservative no-directive default governs every turn there, and
// on the flag-ON grounded path the band directive rides `mode_directive` into
// foxy_tutor_v1 — a different prompt — so the two can never stack or
// contradict. These canaries assert on the RUNTIME output (what the model
// actually receives), pinning:
//   - the retired boxing / Unicode-superscript / 6-8-absolute lines cannot
//     return,
//   - the deferential §4/§8 references are present,
//   - no band density text is copy-pasted (spec §6),
//   - the 2026-07-20 template-literal escape fix holds (the served bytes
//     carry real LaTeX backslashes, no control characters, no `( ... )`
//     pseudo-paren delimiter instruction).
// Owner: ai-engineer. Review: assessment (spec conformance), testing.
// ─────────────────────────────────────────────────────────────────────────────

const FOXY_SYSTEM_RUNTIME_CASES: Array<[string, string]> = [
  [
    'grade 7 learn',
    buildFoxySystemPrompt({
      grade: '7', subject: 'math', board: 'CBSE', chapter: null,
      mode: 'learn', ragContext: '', academicGoal: 'board_topper',
    }),
  ],
  [
    'grade 11 doubt',
    buildFoxySystemPrompt({
      grade: '11', subject: 'math', board: 'CBSE', chapter: 'Straight Lines',
      mode: 'doubt', ragContext: '',
    }),
  ],
];

describe('foxy-system.ts (legacy intent-router base prompt) — retired strings cannot return', () => {
  it.each(FOXY_SYSTEM_RUNTIME_CASES)('%s: pre-spec boxing/density lines are gone', (_name, prompt) => {
    expect(prompt).not.toContain('box/highlight the final answer');
    expect(prompt).not.toContain('Box/emphasize');
    expect(prompt).not.toContain('never skip intermediate steps');
    // The retired ABSOLUTE density line ("separated. Never compress …") is
    // gone; the deferential default legitimately keeps the lowercase
    // "never compress multiple operations into one line" clause.
    expect(prompt).not.toContain('separated. Never compress');
  });

  it.each(FOXY_SYSTEM_RUNTIME_CASES)('%s: the "or x²" Unicode-superscript allowance is gone (no ² anywhere)', (_name, prompt) => {
    expect(prompt).not.toContain('or x²');
    expect(prompt).not.toContain('²');
  });
});

describe('foxy-system.ts — deferential §4/§8 house pattern present (mirrors foxy_tutor_v1)', () => {
  it.each(FOXY_SYSTEM_RUNTIME_CASES)('%s: §4 stage completeness + density/boxing deferral to section 8', (_name, prompt) => {
    expect(prompt).toContain(
      'never skip a stage (formula -> substitution -> calculation -> final answer)',
    );
    expect(prompt).toContain(
      'Step DENSITY within the working (how many operations one line may carry) follows the Mathematical Formatting Rules in section 8',
    );
    expect(prompt).toContain(
      "final-answer boxing follows section 8's answer-block vs \\boxed{} rule",
    );
    expect(prompt).toContain('Final Answer: [emphasize with correct units]');
  });

  it.each(FOXY_SYSTEM_RUNTIME_CASES)('%s: §8 density defers to the single source + conservative default', (_name, prompt) => {
    expect(prompt).toContain('docs/math-rendering-spec.md section 3');
    expect(prompt).toContain('buildMathFormatDirective');
    expect(prompt).toContain('When no band directive is present');
    expect(prompt).toContain('never compress multiple operations into one line');
  });

  it.each(FOXY_SYSTEM_RUNTIME_CASES)('%s: §8 boxing disambiguation (spec §4) present', (_name, prompt) => {
    expect(prompt).toContain('"answer" block IS the boxed-answer convention');
    expect(prompt).toContain('do NOT additionally wrap the value in \\boxed{}');
    expect(prompt).toContain('\\boxed{...}');
  });

  it.each(FOXY_SYSTEM_RUNTIME_CASES)('%s: LaTeX ^{...} superscripts + prose-scoped programming-syntax ban', (_name, prompt) => {
    expect(prompt).toContain('true superscripts written with LaTeX ^{...} inside math delimiters');
    expect(prompt).toContain('never plain Unicode superscript characters');
    expect(prompt).toContain('in prose OUTSIDE math delimiters');
  });

  it.each(FOXY_SYSTEM_RUNTIME_CASES)('%s: does NOT copy-paste any band density text (spec §6)', (_name, prompt) => {
    for (const band of ALL_BANDS) {
      expect(
        prompt.includes(MATH_STEP_DENSITY_RULES[band]),
        `foxy-system prompt must not restate the ${band} density text`,
      ).toBe(false);
    }
    for (const marker of ['2-3 ROUTINE operations', 'justified equation chains', 'FOIL']) {
      expect(prompt.includes(marker), `foxy-system prompt must not contain "${marker}"`).toBe(false);
    }
  });
});

describe('foxy-system.ts — 2026-07-20 escape fix: served bytes are real LaTeX', () => {
  it.each(FOXY_SYSTEM_RUNTIME_CASES)('%s: delimiter convention carries real backslashes at runtime', (_name, prompt) => {
    // Before the fix the template literal emitted "( ... )" (spec §2
    // pseudo-paren violation) and "sqrt{x}" / "pi" for these tokens.
    expect(prompt).toContain('\\( ... \\)');
    expect(prompt).toContain('\\[ ... \\]');
    expect(prompt).toContain('\\frac{numerator}{denominator}');
    expect(prompt).toContain('\\sqrt{x}');
    expect(prompt).toContain('\\pi instead of pi');
    expect(prompt).toContain('\\theta instead of theta');
    expect(prompt).not.toContain('delimited by ( ... )');
  });

  it.each(FOXY_SYSTEM_RUNTIME_CASES)('%s: no control characters (the old escape mangling) in the served prompt', (_name, prompt) => {
    // Only \n is a legal control character in the prompt. U+0008 (backspace),
    // U+000C (form feed), and U+0009 (tab) were what "\\boxed", "\\frac", and
    // "\\theta" mangled into before the escape fix.
    expect(prompt).not.toMatch(/[\u0000-\u0009\u000B-\u001F]/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9.1 precedence carve-out (2026-07-20, assessment ruling — spec §9.1.4):
// vertical_math vs the §3 step-density rule. The carve-out text ships in
// VERTICAL_MATH_DIRECTIVE ONLY (ff_foxy_vertical_math_v1, rollout 0 → dark
// text today). Three pins per §9.1.4:
//   1. Flag-OFF byte-identity untouched — the 6-8 math-format directive is
//      still byte-identical to the pre-band-split MATH_FORMAT_DIRECTIVE
//      literal (primary pin: math-format-directive.test.ts "spec §7.2" test;
//      re-asserted here so the §9.1 ruling is self-contained).
//   2. VERTICAL_MATH_DIRECTIVE carries the exemption / no-duplicate /
//      single-labeling-step clauses (plus scope + precedence).
//   3. math-step-density.ts is BYTE-UNCHANGED vs its committed state — the
//      density module is not edited at all; byte-unchanged is part of the
//      ruling (§9.1.4a byte-pin + §9.1.4b flag-leakage rationale).
// Owner: ai-engineer. Review: assessment (ruling), testing.
// ─────────────────────────────────────────────────────────────────────────────

describe('§9.1 vertical_math precedence carve-out (spec §9.1.4 pins)', () => {
  it('pin 1 — flag-OFF byte-identity: the 6-8 band directive IS the historical MATH_FORMAT_DIRECTIVE, untouched by the carve-out', () => {
    // Primary pin lives in math-format-directive.test.ts (spec §7.2).
    // Re-asserted here: the §9.1 carve-out must not leak one byte into the
    // band density directives while ff_foxy_vertical_math_v1 is at rollout 0.
    expect(buildMathFormatDirective('6-8')).toBe(MATH_FORMAT_DIRECTIVE);
    // And the carve-out text must NOT appear in ANY band directive (spec
    // §9.1.4b — mentioning vertical_math there would teach an ungated block
    // type on every math turn).
    for (const band of ALL_BANDS) {
      expect(buildMathFormatDirective(band)).not.toContain('vertical_math');
    }
  });

  it('pin 2 — VERTICAL_MATH_DIRECTIVE carries the five §9.1.1 normative clauses', () => {
    // 1. Exemption / single visual unit / no fragmentation.
    expect(VERTICAL_MATH_DIRECTIVE).toContain('EXEMPT');
    expect(VERTICAL_MATH_DIRECTIVE).toContain('one-transformation-per-math-block split');
    expect(VERTICAL_MATH_DIRECTIVE).toContain('VISUAL UNIT');
    expect(VERTICAL_MATH_DIRECTIVE).toContain('NEVER fragment one computation');
    // 2. No duplication — the block REPLACES the flat math block.
    expect(VERTICAL_MATH_DIRECTIVE).toContain('REPLACES the flat "math" block');
    expect(VERTICAL_MATH_DIRECTIVE).toContain('NEVER emit both');
    // 3. Exactly one labeling step before, in the student's language (P7).
    expect(VERTICAL_MATH_DIRECTIVE).toContain('exactly ONE labeling "step" block comes BEFORE');
    expect(VERTICAL_MATH_DIRECTIVE).toContain("student's language");
    expect(VERTICAL_MATH_DIRECTIVE).toContain('Hinglish');
    // 4. Scope containment — the rest of the turn keeps band density.
    expect(VERTICAL_MATH_DIRECTIVE).toContain('covers ONLY the computation inside the');
    expect(VERTICAL_MATH_DIRECTIVE).toContain("keeps the band's step density");
    // 5. Specific over general.
    expect(VERTICAL_MATH_DIRECTIVE).toContain('SPECIFIC OVER GENERAL');
    expect(VERTICAL_MATH_DIRECTIVE).toContain('THIS directive governs the computations it covers');
    // The ruling's source of truth is named.
    expect(VERTICAL_MATH_DIRECTIVE).toContain('docs/math-rendering-spec.md section 9.1');
  });

  it('pin 3 — math-step-density.ts is byte-unchanged vs its committed state (HEAD)', () => {
    const REL = 'packages/lib/src/foxy/math-step-density.ts';
    // NOTE: findRepoRoot() can resolve to apps/host under the vitest harness
    // (setup.ts remaps supabase/** asset paths, satisfying the walker early),
    // so anchor this pin on the actual git toplevel instead.
    const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    }).trim();
    const committed = execFileSync('git', ['show', `HEAD:${REL}`], {
      cwd: gitRoot,
      encoding: 'utf8',
    });
    const onDisk = readFileSync(join(gitRoot, REL), 'utf8');
    // Normalize line endings only (core.autocrlf checkouts hold CRLF on disk
    // while the git blob stores LF); every other byte must match exactly.
    const lf = (s: string) => s.replace(/\r\n/g, '\n');
    expect(lf(onDisk)).toBe(lf(committed));
  });
});
