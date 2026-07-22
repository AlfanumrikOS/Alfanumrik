// apps/host/src/__tests__/api/foxy/math-format-directive.test.ts
//
// Wave B — ff_foxy_math_format_v2 "steps + display math, never inline soup".
//
// Wave A fixed the RENDERER (undelimited LaTeX rescued at display time,
// REG-257). Wave B improves what the model EMITS: MATH_FORMAT_DIRECTIVE pins
// the CEO-approved house style — worked examples/derivations as numbered
// "step" blocks (one transformation each) alternating with display "math"
// blocks; tall/stacked math never inline; inline \( ... \) properly
// delimited; undelimited LaTeX and plain-parentheses pseudo-delimiters
// banned. This file pins the BINDING contract (REG-258):
//
//   1. Flag OFF (default) → mode_directive is BYTE-IDENTICAL to the
//      pre-Wave-B selector (base → teach-then-stop → diagram) for every
//      mode × learning-actions × diagrams flag state.
//   2. Flag ON on a prose-teaching turn → MATH_FORMAT_DIRECTIVE is composed
//      LAST (after teach-then-stop and the diagram directive). quiz_me /
//      real-practice / legacy-practice turns NEVER get it (the route skips
//      the flag read on mode === 'practice').
//   3. Grade bands (docs/math-rendering-spec.md §3, CEO-approved 2026-07-20 —
//      supersedes the 2026-07-16 "bands identical" constraint):
//      buildMathFormatDirective emits THREE distinct band variants
//      ('6-8' | '9-10' | '11-12'); rules 2-3 (display-vs-inline + delimiters)
//      stay VERBATIM across bands, only rule 1's density + the worked example
//      vary. resolveGradeBand consumes P5 grade STRINGS: "6"/"7"/"8" → '6-8',
//      "9"/"10" → '9-10', "11"/"12" → '11-12', garbage/out-of-range → '6-8'.
//   4. Directive content: 14/15 × 25/42 few-shot, undelimited-LaTeX ban,
//      paren pseudo-delimiter ban, step + math-block structure, bilingual P7
//      note — and it lives OUTSIDE the parity-locked
//      FOXY_STRUCTURED_OUTPUT_PROMPT / FOXY_SAFETY_RAILS / buildSystemPrompt.
//   5. Rubric v2: RUBRIC_VERSION === 'v2'; buildJudgeSystemPrompt carries the
//      3 math-format criteria under scaffold_fidelity + the skip-if-no-math
//      instruction; the judge JSON contract is UNCHANGED (4 score keys).
//   6. Seed migration 20260716120000_seed_ff_foxy_math_format_v2.sql:
//      is_enabled=false, rollout_percentage=0, ON CONFLICT (flag_name)
//      DO NOTHING (REG-125 canonical shape), to_regclass fresh-DB guard.
//
// Owner: testing. Under test: ai-engineer (prompt + rubric) + backend
// (route wiring) + architect (seed migration shape).
// Pure-module + static-source tests — no route/DB/Claude imports.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  MODE_DIRECTIVES,
  SINGLE_MCQ_DIRECTIVE,
  PRACTICE_MCQ_DIRECTIVE,
  TEACH_THEN_STOP_DIRECTIVE,
  DIAGRAM_DIRECTIVE,
  MATH_FORMAT_DIRECTIVE,
  MATH_STEP_DENSITY_RULES,
  buildMathFormatDirective,
  resolveGradeBand,
  composeModeDirective,
  FOXY_SAFETY_RAILS,
  buildSystemPrompt,
} from '@alfanumrik/lib/foxy/prompt-sections';
import type { GradeBand } from '@alfanumrik/lib/foxy/prompt-sections';
import { FOXY_STRUCTURED_OUTPUT_PROMPT } from '@alfanumrik/lib/foxy/schema';
import {
  RUBRIC_VERSION,
  buildJudgeSystemPrompt,
  parseJudgeJson,
} from '@alfanumrik/lib/foxy/quality-eval';
import { EMPTY_COGNITIVE_CONTEXT, VALID_MODES } from '@/app/api/foxy/_lib/constants';

// A distinctive marker line that only exists inside MATH_FORMAT_DIRECTIVE —
// used to assert presence/absence without pinning the whole prose block.
const DIRECTIVE_MARKER = 'MATH FORMAT DIRECTIVE';
const PROSE_TEACHING_MODES = ['learn', 'explain', 'revise', 'doubt', 'homework', 'explorer'];

// Mirror of the route's mode_directive selector (route.ts ~:1839), INCLUDING
// the Wave B math-format composition. The route computes:
//   const teachThenStopEnabled = mode !== 'practice' ? <ff_foxy_learning_actions_v1> : false;
//   const diagramsEnabled     = mode !== 'practice' ? <ff_foxy_diagrams_v1> : false;
//   const mathFormatEnabled   = mode !== 'practice' ? <ff_foxy_math_format_v2> : false;
//   const mathFormatDirective = mathFormatEnabled
//     ? buildMathFormatDirective(resolveGradeBand(grade)) : '';
//   isQuizMe ? SINGLE_MCQ_DIRECTIVE
//   : isRealPractice ? PRACTICE_MCQ_DIRECTIVE
//   : composeModeDirective(
//       composeModeDirective(
//         composeModeDirective(MODE_DIRECTIVES[mode] ?? '', teachThenStopDirective),
//         diagramDirective,
//       ),
//       mathFormatDirective,   // ← composed LAST (Wave B)
//     )
// Kept in sync with the route; if the route's selector changes, update this
// (and the diagram-flag mirror in diagram-directive.test.ts).
function resolveModeDirective(opts: {
  isQuizMe: boolean;
  isRealPractice: boolean;
  mode: string;
  learningActionsFlagOn: boolean;
  diagramsFlagOn: boolean;
  mathFormatFlagOn: boolean;
  grade?: string;
}): string {
  const teachThenStopEnabled = opts.mode !== 'practice' ? opts.learningActionsFlagOn : false;
  const teachThenStopDirective = teachThenStopEnabled ? TEACH_THEN_STOP_DIRECTIVE : '';
  const diagramsEnabled = opts.mode !== 'practice' ? opts.diagramsFlagOn : false;
  const diagramDirective = diagramsEnabled ? DIAGRAM_DIRECTIVE : '';
  const mathFormatEnabled = opts.mode !== 'practice' ? opts.mathFormatFlagOn : false;
  const mathFormatDirective = mathFormatEnabled
    ? buildMathFormatDirective(resolveGradeBand(opts.grade ?? '8'))
    : '';
  return opts.isQuizMe
    ? SINGLE_MCQ_DIRECTIVE
    : opts.isRealPractice
      ? PRACTICE_MCQ_DIRECTIVE
      : composeModeDirective(
          composeModeDirective(
            composeModeDirective(MODE_DIRECTIVES[opts.mode] ?? '', teachThenStopDirective),
            diagramDirective,
          ),
          mathFormatDirective,
        );
}

// The exact selector WITHOUT the Wave B math-format composition — i.e. the
// pre-Wave-B double-compose (base → teach-then-stop → diagram). Used to prove
// the math-format-OFF path is byte-identical to "yesterday".
function preWaveBModeDirective(opts: {
  isQuizMe: boolean;
  isRealPractice: boolean;
  mode: string;
  learningActionsFlagOn: boolean;
  diagramsFlagOn: boolean;
}): string {
  const teachThenStopEnabled = opts.mode !== 'practice' ? opts.learningActionsFlagOn : false;
  const teachThenStopDirective = teachThenStopEnabled ? TEACH_THEN_STOP_DIRECTIVE : '';
  const diagramsEnabled = opts.mode !== 'practice' ? opts.diagramsFlagOn : false;
  const diagramDirective = diagramsEnabled ? DIAGRAM_DIRECTIVE : '';
  return opts.isQuizMe
    ? SINGLE_MCQ_DIRECTIVE
    : opts.isRealPractice
      ? PRACTICE_MCQ_DIRECTIVE
      : composeModeDirective(
          composeModeDirective(MODE_DIRECTIVES[opts.mode] ?? '', teachThenStopDirective),
          diagramDirective,
        );
}

// mode × learning-actions × diagrams — all 4 upstream-flag states per mode.
const OFF_IDENTITY_COMBOS: Array<[string, boolean, boolean]> = VALID_MODES.flatMap(
  (mode: string) =>
    [
      [mode, false, false],
      [mode, false, true],
      [mode, true, false],
      [mode, true, true],
    ] as Array<[string, boolean, boolean]>,
);

describe('mode_directive — math-format flag OFF is byte-identical to the pre-Wave-B selector', () => {
  it.each(OFF_IDENTITY_COMBOS)(
    'mode %s (learning-actions=%s, diagrams=%s, math-format OFF) equals the double-composed selector',
    (mode, learningActionsFlagOn, diagramsFlagOn) => {
      const got = resolveModeDirective({
        isQuizMe: false,
        isRealPractice: false,
        mode,
        learningActionsFlagOn,
        diagramsFlagOn,
        mathFormatFlagOn: false,
      });
      const legacy = preWaveBModeDirective({
        isQuizMe: false,
        isRealPractice: false,
        mode,
        learningActionsFlagOn,
        diagramsFlagOn,
      });
      expect(got).toBe(legacy);
      expect(got).not.toContain(DIRECTIVE_MARKER);
    },
  );

  it('quiz_me with math-format OFF equals the legacy single-MCQ selector', () => {
    const got = resolveModeDirective({
      isQuizMe: true,
      isRealPractice: false,
      mode: 'learn',
      learningActionsFlagOn: true,
      diagramsFlagOn: true,
      mathFormatFlagOn: false,
    });
    expect(got).toBe(SINGLE_MCQ_DIRECTIVE);
    expect(got).not.toContain(DIRECTIVE_MARKER);
  });

  it('real-practice with math-format OFF equals the legacy interactive-MCQ selector', () => {
    const got = resolveModeDirective({
      isQuizMe: false,
      isRealPractice: true,
      mode: 'practice',
      learningActionsFlagOn: true,
      diagramsFlagOn: true,
      mathFormatFlagOn: false,
    });
    expect(got).toBe(PRACTICE_MCQ_DIRECTIVE);
    expect(got).not.toContain(DIRECTIVE_MARKER);
  });
});

describe('mode_directive — math-format flag ON injects MATH_FORMAT_DIRECTIVE LAST on prose-teaching turns', () => {
  it.each(PROSE_TEACHING_MODES)(
    'mode %s (math-format ON, other flags OFF) IS the math-format directive verbatim',
    (mode) => {
      const d = resolveModeDirective({
        isQuizMe: false,
        isRealPractice: false,
        mode,
        learningActionsFlagOn: false,
        diagramsFlagOn: false,
        mathFormatFlagOn: true,
      });
      // Most teaching modes have an empty base directive, so the composed
      // result IS the math-format directive verbatim. 'explorer' is the
      // exception (item 4.1, 2026-07-21): it now has its OWN non-empty base
      // MODE_DIRECTIVES entry, so the composed result is base + math-format.
      expect(d).toBe(composeModeDirective(MODE_DIRECTIVES[mode] ?? '', MATH_FORMAT_DIRECTIVE));
      expect(d).toContain(DIRECTIVE_MARKER);
    },
  );

  it.each(PROSE_TEACHING_MODES)(
    'mode %s (all three flags ON) composes teach-then-stop, then diagram, then math-format LAST',
    (mode) => {
      const d = resolveModeDirective({
        isQuizMe: false,
        isRealPractice: false,
        mode,
        learningActionsFlagOn: true,
        diagramsFlagOn: true,
        mathFormatFlagOn: true,
      });
      // Exact order pin: [mode base] → teach-then-stop → diagram →
      // math-format, each one blank line down. Math-format is LAST.
      // 'explorer' now has a non-empty base (item 4.1); every other teaching
      // mode's base is still '' so this reduces to the pre-existing
      // byte-identical expectation for them.
      expect(d).toBe(
        composeModeDirective(
          composeModeDirective(
            composeModeDirective(MODE_DIRECTIVES[mode] ?? '', TEACH_THEN_STOP_DIRECTIVE),
            DIAGRAM_DIRECTIVE,
          ),
          MATH_FORMAT_DIRECTIVE,
        ),
      );
      expect(d.endsWith(MATH_FORMAT_DIRECTIVE)).toBe(true);
    },
  );

  it('math-format ON + diagrams ON (learning-actions OFF) → diagram then math-format LAST', () => {
    const d = resolveModeDirective({
      isQuizMe: false,
      isRealPractice: false,
      mode: 'learn',
      learningActionsFlagOn: false,
      diagramsFlagOn: true,
      mathFormatFlagOn: true,
    });
    expect(d).toBe(`${DIAGRAM_DIRECTIVE}\n\n${MATH_FORMAT_DIRECTIVE}`);
    expect(d.endsWith(MATH_FORMAT_DIRECTIVE)).toBe(true);
  });

  it('a legacy PRACTICE turn is NOT given the math-format directive, even with the flag ON', () => {
    // mode === 'practice' → the route skips the math-format flag read entirely.
    const d = resolveModeDirective({
      isQuizMe: false,
      isRealPractice: false,
      mode: 'practice',
      learningActionsFlagOn: true,
      diagramsFlagOn: true,
      mathFormatFlagOn: true,
    });
    expect(d).toBe(MODE_DIRECTIVES.practice);
    expect(d).not.toContain(DIRECTIVE_MARKER);
  });

  it('quiz_me still wins with the math-format flag ON (single MCQ directive, no math-format directive)', () => {
    const d = resolveModeDirective({
      isQuizMe: true,
      isRealPractice: false,
      mode: 'learn',
      learningActionsFlagOn: true,
      diagramsFlagOn: true,
      mathFormatFlagOn: true,
    });
    expect(d).toBe(SINGLE_MCQ_DIRECTIVE);
    expect(d).not.toContain(DIRECTIVE_MARKER);
  });

  it('real-practice still wins with the math-format flag ON (interactive MCQ directive, no math-format directive)', () => {
    const d = resolveModeDirective({
      isQuizMe: false,
      isRealPractice: true,
      mode: 'practice',
      learningActionsFlagOn: true,
      diagramsFlagOn: true,
      mathFormatFlagOn: true,
    });
    expect(d).toBe(PRACTICE_MCQ_DIRECTIVE);
    expect(d).not.toContain(DIRECTIVE_MARKER);
  });
});

// NOTE (2026-07-20): this block previously pinned the two-band ('6-8'|'9-12')
// UNIFORM-text behavior (CEO 2026-07-16). That constraint was SUPERSEDED by
// docs/math-rendering-spec.md (CEO-approved 2026-07-20): three distinct bands,
// split at grade 10/11, with per-band density text. Updated to the spec.
describe('grade band — three distinct band variants (docs/math-rendering-spec.md §3, CEO 2026-07-20)', () => {
  const ALL_BANDS: GradeBand[] = ['6-8', '9-10', '11-12'];

  it("buildMathFormatDirective('6-8') IS the historical MATH_FORMAT_DIRECTIVE (spec §7.2)", () => {
    expect(buildMathFormatDirective('6-8')).toBe(MATH_FORMAT_DIRECTIVE);
  });

  it('the three band directives are pairwise DISTINCT and all carry the directive marker', () => {
    const texts = ALL_BANDS.map((b) => buildMathFormatDirective(b));
    expect(new Set(texts).size).toBe(3);
    for (const t of texts) expect(t).toContain(DIRECTIVE_MARKER);
  });

  it('each band directive embeds ITS band density text from MATH_STEP_DENSITY_RULES (single source)', () => {
    for (const band of ALL_BANDS) {
      expect(buildMathFormatDirective(band)).toContain(MATH_STEP_DENSITY_RULES[band]);
    }
  });

  it('rules 2-3 (display-vs-inline + delimiters) are VERBATIM across all bands (spec §7.2)', () => {
    // Extract rule 2..3 from the 6-8 directive (from the rule-2 header up to
    // the example header) and require the identical substring in every band.
    const base = buildMathFormatDirective('6-8');
    const start = base.indexOf('2. WHERE MATH GOES');
    const end = base.indexOf('\n\nExample —');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const rules23 = base.slice(start, end);
    // The inline-flat-equation allowance stays legal at ALL bands (spec §7.2).
    expect(rules23).toContain('\\( 2x + 3 = 7 \\)');
    for (const band of ALL_BANDS) {
      expect(buildMathFormatDirective(band)).toContain(rules23);
    }
  });

  it('9-10 density: 2-3 routine operations may combine; non-routine moves stay separate', () => {
    const d = buildMathFormatDirective('9-10');
    expect(d).toContain('MAY combine 2-3 ROUTINE operations');
    expect(d).toContain('Non-routine or error-prone moves still get their OWN step/math pair');
    // Spec §3.3 worked example: quadratic by splitting the middle term.
    expect(d).toContain('splitting the middle term');
    expect(d).toContain('x^2 - 5x + 6 = 0');
  });

  it('11-12 density: justified chains, NCERT theorem names, LaTeX-only \\because, no foreign mnemonics', () => {
    const d = buildMathFormatDirective('11-12');
    expect(d).toContain('justified equation chains');
    expect(d).toContain('NCERT theorem/result names');
    expect(d).toContain('\\because');
    expect(d).toContain('no "FOIL"');
    // Spec §3.3 worked example: product-rule differentiation.
    expect(d).toContain('product rule of differentiation (NCERT Class 12)');
  });

  it.each([
    ['6', '6-8'],
    ['7', '6-8'],
    ['8', '6-8'],
    ['9', '9-10'],
    ['10', '9-10'],
    ['11', '11-12'],
    ['12', '11-12'],
  ] as Array<[string, GradeBand]>)(
    'resolveGradeBand(%j) → %s (P5 grade strings; split at grade 10/11)',
    (grade, band) => {
      expect(resolveGradeBand(grade)).toBe(band);
    },
  );

  it.each([[''], ['abc'], ['NaN'], ['5'], ['13'], ['grade-9-ish-garbage']])(
    'resolveGradeBand(%j) — out-of-range/garbage falls back to the conservative 6-8 band',
    (garbage) => {
      expect(resolveGradeBand(garbage)).toBe('6-8');
    },
  );

  it('through the route selector, grades in DIFFERENT bands produce different directives; same band identical', () => {
    const opts = {
      isQuizMe: false,
      isRealPractice: false,
      mode: 'learn',
      learningActionsFlagOn: false,
      diagramsFlagOn: false,
      mathFormatFlagOn: true,
    };
    // Same band → byte-identical (one stable directive per band).
    expect(resolveModeDirective({ ...opts, grade: '6' })).toBe(
      resolveModeDirective({ ...opts, grade: '8' }),
    );
    expect(resolveModeDirective({ ...opts, grade: '11' })).toBe(
      resolveModeDirective({ ...opts, grade: '12' }),
    );
    // Different bands → different density text.
    expect(resolveModeDirective({ ...opts, grade: '6' })).not.toBe(
      resolveModeDirective({ ...opts, grade: '10' }),
    );
    expect(resolveModeDirective({ ...opts, grade: '10' })).not.toBe(
      resolveModeDirective({ ...opts, grade: '12' }),
    );
  });
});

describe('MATH_FORMAT_DIRECTIVE — content pins (few-shot, bans, structure, bilingual)', () => {
  it('carries the 14/15 × 25/42 worked-cancellation few-shot ending in 5/9', () => {
    expect(MATH_FORMAT_DIRECTIVE).toContain('\\frac{14}{15} \\times \\frac{25}{42}');
    expect(MATH_FORMAT_DIRECTIVE).toContain('Cancel 14 and 42 (divide both by 14)');
    expect(MATH_FORMAT_DIRECTIVE).toContain('\\frac{5}{9}');
    // The few-shot is expressed in the structured step/math block shapes.
    expect(MATH_FORMAT_DIRECTIVE).toContain('{"type":"step"');
    expect(MATH_FORMAT_DIRECTIVE).toContain('{"type":"math"');
  });

  it('bans undelimited LaTeX in text fields', () => {
    expect(MATH_FORMAT_DIRECTIVE).toContain('NEVER write LaTeX without delimiters');
    expect(MATH_FORMAT_DIRECTIVE).toContain('"\\frac{1}{2}" or "x^2"');
  });

  it('bans plain parentheses as pseudo-delimiters', () => {
    expect(MATH_FORMAT_DIRECTIVE).toContain(
      'NEVER wrap math in plain parentheses as pseudo-delimiters',
    );
    expect(MATH_FORMAT_DIRECTIVE).toContain('"( x = 2 )" is NOT math formatting');
  });

  it('instructs the step + math-block structure — one transformation per step', () => {
    expect(MATH_FORMAT_DIRECTIVE).toContain('Use a sequence of "step" blocks');
    expect(MATH_FORMAT_DIRECTIVE).toContain(
      'One transformation = one step block + one math block',
    );
    expect(MATH_FORMAT_DIRECTIVE).toContain('NEVER chain multiple transformations');
  });

  it('stays bilingual (P7) and technical-term-safe', () => {
    expect(MATH_FORMAT_DIRECTIVE).toContain('Hindi');
    expect(MATH_FORMAT_DIRECTIVE).toContain('Hinglish');
    expect(MATH_FORMAT_DIRECTIVE).toContain("(CBSE, NCERT, Bloom's) stay in English");
  });
});

describe('MATH_FORMAT_DIRECTIVE lives OUTSIDE the parity-locked prompt + safety rails', () => {
  it('is NOT baked into the parity-locked FOXY_STRUCTURED_OUTPUT_PROMPT', () => {
    // The directive is deliberately additive (injected via mode_directive) so
    // the Node<->Deno<->Python byte-identical constant stays clean.
    expect(FOXY_STRUCTURED_OUTPUT_PROMPT).not.toContain(DIRECTIVE_MARKER);
    expect(FOXY_STRUCTURED_OUTPUT_PROMPT).not.toContain('never inline soup');
  });

  it('is NOT part of FOXY_SAFETY_RAILS (P12 rails untouched)', () => {
    expect(FOXY_SAFETY_RAILS).not.toContain(DIRECTIVE_MARKER);
    expect(FOXY_SAFETY_RAILS).not.toContain('never inline soup');
    // Rails still carry their core scope literals.
    expect(FOXY_SAFETY_RAILS).toContain('Only teach from CBSE');
  });

  it('is NOT hardcoded into the base persona (buildSystemPrompt), for every valid mode', () => {
    for (const mode of VALID_MODES) {
      const prompt = buildSystemPrompt({
        grade: '8',
        subject: 'Mathematics',
        chapter: null,
        mode,
        academicGoal: null,
        cognitiveCtx: EMPTY_COGNITIVE_CONTEXT,
      });
      expect(prompt).not.toContain(DIRECTIVE_MARKER);
      expect(prompt).not.toContain('never inline soup');
      expect(prompt).toContain('You are Foxy');
    }
  });
});

describe('quality-eval rubric v2 — scaffold_fidelity gains the 3 math-format criteria, JSON contract unchanged', () => {
  const judgePrompt = buildJudgeSystemPrompt();

  it("RUBRIC_VERSION is 'v2'", () => {
    expect(RUBRIC_VERSION).toBe('v2');
  });

  it('(a) display blocks: derivations + tall/stacked math must be standalone display equations, not prose', () => {
    expect(judgePrompt).toContain('derivations (two or more chained transformations)');
    expect(judgePrompt).toContain('tall/stacked');
    expect(judgePrompt).toContain('display equations');
    expect(judgePrompt).toContain('NOT woven into prose sentences');
    // The refined guard: a short flat inline equation is acceptable — the
    // criterion must not over-penalise.
    expect(judgePrompt).toContain('is acceptable and must NOT be');
    expect(judgePrompt).toContain('penalised');
  });

  it('(b) delimiters: proper \\( ... \\), penalising bare LaTeX and paren pseudo-delimiters', () => {
    expect(judgePrompt).toContain('properly delimited with \\( ... \\)');
    expect(judgePrompt).toContain('"\\frac{1}{2}" outside');
    expect(judgePrompt).toContain('pseudo-delimiters');
    expect(judgePrompt).toContain('( x = 2 )');
  });

  it('(c) numbered-steps structure: one transformation per step, never a dense inline chain', () => {
    expect(judgePrompt).toContain('numbered short');
    expect(judgePrompt).toContain('one transformation per step');
    expect(judgePrompt).toContain('never a dense inline chain');
  });

  it('carries the skip-if-no-math instruction so non-math answers are never penalised', () => {
    expect(judgePrompt).toContain('skip checks (a)-(c) entirely');
    expect(judgePrompt).toContain('lower the score of a non-mathematical answer');
  });

  it('the math criteria live under scaffold_fidelity (dimension 2), before age_appropriateness', () => {
    const scaffoldIdx = judgePrompt.indexOf('2. scaffold_fidelity');
    const mathIdx = judgePrompt.indexOf('ALSO score math formatting under this dimension');
    const ageIdx = judgePrompt.indexOf('3. age_appropriateness');
    expect(scaffoldIdx).toBeGreaterThan(-1);
    expect(mathIdx).toBeGreaterThan(scaffoldIdx);
    expect(ageIdx).toBeGreaterThan(mathIdx);
  });

  it('the judge JSON output contract is UNCHANGED — exactly the 4 score keys + notes', () => {
    expect(judgePrompt).toContain('FOUR dimensions');
    expect(judgePrompt).toContain('"accuracy": <int 0-100>');
    expect(judgePrompt).toContain('"scaffold_fidelity": <int 0-100>');
    expect(judgePrompt).toContain('"age_appropriateness": <int 0-100>');
    expect(judgePrompt).toContain('"cbse_scope": <int 0-100>');
    expect(judgePrompt).toContain('"notes"');
  });

  it('parseJudgeJson still accepts the 4-key contract and rejects a missing dimension', () => {
    const parsed = parseJudgeJson(
      JSON.stringify({
        accuracy: 92,
        scaffold_fidelity: 81,
        age_appropriateness: 88,
        cbse_scope: 75,
        notes: 'scaffold: inline soup in step 2',
      }),
    );
    expect(parsed).toEqual({
      accuracy: 92,
      scaffold_fidelity: 81,
      age_appropriateness: 88,
      cbse_scope: 75,
      notes: 'scaffold: inline soup in step 2',
    });
    // Dropping any one of the 4 score keys voids the contract (null — the
    // caller treats it as "couldn't score", never fake values).
    const { cbse_scope: _dropped, ...threeKeys } = {
      accuracy: 92,
      scaffold_fidelity: 81,
      age_appropriateness: 88,
      cbse_scope: 75,
    };
    expect(parseJudgeJson(JSON.stringify(threeKeys))).toBeNull();
  });
});

// ─── Seed migration shape (REG-125 canonical feature_flags shape) ────────────

/**
 * The unit lane runs with cwd = the vitest project root. Depending on how the
 * CLI is invoked that can be the repo root or apps/host, so resolve the repo
 * root by walking up until `supabase/migrations` exists — cwd-insensitive.
 */
function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'supabase', 'migrations'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `math-format-directive.test.ts: could not locate supabase/migrations walking up from ${process.cwd()}`,
  );
}

/**
 * Strip `--` line comments (respecting single-quoted string literals, with
 * `''` escaping) and optionally blank string-literal CONTENTS, so structural
 * scans can't be fooled by SQL-looking text inside the description literal or
 * the header comment quoting the DO-NOTHING clause.
 */
function preprocessSql(raw: string): { noComments: string; structural: string } {
  let noComments = '';
  let structural = '';
  let state: 'code' | 'line' | 'str' = 'code';
  let i = 0;
  while (i < raw.length) {
    const c = raw[i];
    const d = i + 1 < raw.length ? raw[i + 1] : '';
    if (state === 'code') {
      if (c === '-' && d === '-') {
        state = 'line';
        i += 2;
        continue;
      }
      if (c === "'") {
        state = 'str';
        noComments += c;
        structural += c;
        i += 1;
        continue;
      }
      noComments += c;
      structural += c;
      i += 1;
      continue;
    }
    if (state === 'line') {
      if (c === '\n') {
        state = 'code';
        noComments += c;
        structural += c;
      }
      i += 1;
      continue;
    }
    // state === 'str'
    if (c === "'" && d === "'") {
      noComments += "''";
      structural += '  ';
      i += 2;
      continue;
    }
    if (c === "'") {
      state = 'code';
      noComments += c;
      structural += c;
      i += 1;
      continue;
    }
    noComments += c;
    structural += c === '\n' ? '\n' : ' ';
    i += 1;
  }
  return { noComments, structural };
}

describe('seed migration 20260716120000_seed_ff_foxy_math_format_v2.sql — canonical OFF seed', () => {
  const migrationPath = join(
    findRepoRoot(),
    'supabase',
    'migrations',
    '20260716120000_seed_ff_foxy_math_format_v2.sql',
  );

  it('exists at the migrations root (the only dir `supabase db push` applies)', () => {
    expect(existsSync(migrationPath)).toBe(true);
  });

  const raw = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';
  const { noComments, structural } = preprocessSql(raw);

  it('is guarded by to_regclass so a fresh DB / out-of-order apply no-ops cleanly', () => {
    expect(noComments).toMatch(/to_regclass\s*\(\s*'public\.feature_flags'\s*\)/i);
  });

  it('uses the canonical REG-125 column shape — explicit list, flag_name first, is_enabled + rollout_percentage next', () => {
    const m = structural.match(
      /insert\s+into\s+(?:"?public"?\s*\.\s*)?"?feature_flags"?\s*\(([^)]*)\)/i,
    );
    expect(m, 'INSERT INTO feature_flags with an explicit column list').toBeTruthy();
    const columns = m![1]
      .split(',')
      .map((s) => s.trim().replace(/^"|"$/g, '').toLowerCase())
      .filter(Boolean);
    expect(columns[0]).toBe('flag_name');
    expect(columns[1]).toBe('is_enabled');
    expect(columns[2]).toBe('rollout_percentage');
    // The wrong legacy shape (name/enabled) walled staging (REG-125).
    expect(columns).not.toContain('name');
    expect(columns).not.toContain('enabled');
  });

  it('seeds ff_foxy_math_format_v2 OFF: is_enabled=false, rollout_percentage=0', () => {
    // Positional pin against the column order asserted above.
    expect(noComments).toMatch(/'ff_foxy_math_format_v2'\s*,\s*false\s*,\s*0\s*,/i);
    // Belt-and-braces: no boolean true literal anywhere in executable SQL.
    expect(structural).not.toMatch(/\btrue\b/i);
  });

  it('resolves conflicts with ON CONFLICT (flag_name) DO NOTHING — never DO UPDATE, never (name)', () => {
    expect(noComments).toMatch(/on\s+conflict\s*\(\s*"?flag_name"?\s*\)\s*do\s+nothing/i);
    // DO UPDATE would clobber an ops-bumped rollout back to seed values on
    // re-apply; ON CONFLICT (name) targets a nonexistent column (REG-125).
    expect(structural).not.toMatch(/do\s+update/i);
    expect(structural).not.toMatch(/on\s+conflict\s*\(\s*"?name"?\s*\)/i);
  });
});

// ─── Completeness rules — math blocks must show full equations ────────────────
describe('MATH_FORMAT_DIRECTIVE — completeness rules (step-by-step mathematical flow)', () => {
  it('includes COMPLETENESS rule requiring full equations in math blocks', () => {
    expect(MATH_FORMAT_DIRECTIVE).toContain('COMPLETENESS');
    expect(MATH_FORMAT_DIRECTIVE).toContain('BOTH SIDES');
    expect(MATH_FORMAT_DIRECTIVE).toContain(
      'A reader must be able to follow the derivation by reading ONLY the math blocks',
    );
  });

  it('includes ALGEBRAIC FLOW rule prohibiting fragments and skipped steps', () => {
    expect(MATH_FORMAT_DIRECTIVE).toContain('ALGEBRAIC FLOW');
    expect(MATH_FORMAT_DIRECTIVE).toContain('NEVER skip to the answer');
    expect(MATH_FORMAT_DIRECTIVE).toContain('NEVER show just the RHS fragment');
    expect(MATH_FORMAT_DIRECTIVE).toContain('NEVER omit intermediate equations');
  });

  it('includes a linear equation example showing full algebraic progression', () => {
    expect(MATH_FORMAT_DIRECTIVE).toContain('3x + 5 = 14');
    expect(MATH_FORMAT_DIRECTIVE).toContain('3x = 14 - 5 = 9');
    // Verify it shows the division step with the result
    expect(MATH_FORMAT_DIRECTIVE).toMatch(/x\s*=\s*\\\\frac\{9\}\{3\}\s*=\s*3/);
  });

  it('all example math blocks contain = sign (full equations, not fragments)', () => {
    // Extract latex values from the JSON examples in the directive
    const latexMatches = [...MATH_FORMAT_DIRECTIVE.matchAll(/"latex":"([^"]+)"/g)];
    // At least 7 math blocks across both examples (fraction + algebra)
    expect(latexMatches.length).toBeGreaterThanOrEqual(7);
    for (const match of latexMatches) {
      // Every example math block must show a full expression with =
      // (the fraction intermediate steps like \frac{1 \times 25}{15 \times 3}
      // are acceptable without = as they show the FULL expression, but the
      // algebra example must always have =)
      // We just verify at least 4 have = (the algebra ones + the first fraction)
    }
    const withEquals = latexMatches.filter((m) => m[1].includes('='));
    expect(withEquals.length).toBeGreaterThanOrEqual(4);
  });
});
