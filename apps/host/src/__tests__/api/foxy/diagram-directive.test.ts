// apps/host/src/__tests__/api/foxy/diagram-directive.test.ts
//
// Wave 2 — ff_foxy_diagrams_v1 "real diagrams, never text-art".
//
// Foxy used to "draw" diagrams as ASCII / text-art inside paragraph/step text
// (unreadable on a phone). DIAGRAM_DIRECTIVE (a) BANS ASCII/text-art in any
// block, and (b) routes each visual need to the right block — a drawable diagram
// → a `mermaid` block, a real labelled figure → the existing `diagram` retrieval
// block, an equation → a `math` block. This pins the BINDING contract for the
// prompt side:
//
//   1. Flag OFF (or a non-prose-teaching turn) → mode_directive is BYTE-IDENTICAL
//      to the pre-Wave-2 selector (the diagram directive is never injected).
//   2. Flag ON on a prose-teaching turn → DIAGRAM_DIRECTIVE is injected via
//      mode_directive (composed AFTER the teach-then-stop directive).
//   3. quiz_me / real-practice / legacy-practice still win — the diagram
//      directive never displaces the MCQ-emitting shapes and is never added on a
//      `mode === 'practice'` turn (the route skips the flag read there).
//   4. DIAGRAM_DIRECTIVE lives OUTSIDE the parity-locked FOXY_STRUCTURED_OUTPUT_PROMPT
//      and outside FOXY_SAFETY_RAILS / the base persona — it is threaded only via
//      the mode_directive channel.
//
// Owner: testing. Under test: ai-engineer (prompt) + backend (route wiring).
// Pure-module tests — no route/DB/Claude imports.

import { describe, it, expect } from 'vitest';
import {
  MODE_DIRECTIVES,
  SINGLE_MCQ_DIRECTIVE,
  PRACTICE_MCQ_DIRECTIVE,
  TEACH_THEN_STOP_DIRECTIVE,
  DIAGRAM_DIRECTIVE,
  composeModeDirective,
  FOXY_SAFETY_RAILS,
  buildSystemPrompt,
} from '@alfanumrik/lib/foxy/prompt-sections';
import { FOXY_STRUCTURED_OUTPUT_PROMPT } from '@alfanumrik/lib/foxy/schema';
import { EMPTY_COGNITIVE_CONTEXT, VALID_MODES } from '@/app/api/foxy/_lib/constants';

// A distinctive marker line that only exists inside DIAGRAM_DIRECTIVE — used to
// assert presence/absence without pinning the whole prose block.
const DIRECTIVE_MARKER = 'DIAGRAM DIRECTIVE';
const PROSE_TEACHING_MODES = ['learn', 'explain', 'revise', 'doubt', 'homework', 'explorer'];

// Mirror of the route's mode_directive selector (route.ts ~:1839), INCLUDING the
// Wave 2 diagram composition. The route computes:
//   const diagramsEnabled = mode !== 'practice' ? <ff_foxy_diagrams_v1> : false;
//   const diagramDirective = diagramsEnabled ? DIAGRAM_DIRECTIVE : '';
//   isQuizMe ? SINGLE_MCQ_DIRECTIVE
//   : isRealPractice ? PRACTICE_MCQ_DIRECTIVE
//   : composeModeDirective(
//       composeModeDirective(MODE_DIRECTIVES[mode] ?? '', teachThenStopDirective),
//       diagramDirective,
//     )
// Wave B (ff_foxy_math_format_v2) added a THIRD compose around this one —
// composeModeDirective(<the above>, mathFormatDirective). This mirror models
// the route with the math-format flag OFF (mathFormatDirective = '', and
// composeModeDirective with '' is the identity), which is byte-accurate for
// every case this file tests. The full triple-compose mirror lives in
// math-format-directive.test.ts (REG-258).
// Kept in sync with the route; if the route's selector changes, update this
// AND the math-format mirror.
function resolveModeDirective(opts: {
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

// The exact selector WITHOUT the Wave 2 diagram composition (teach-then-stop
// only). Used to prove the diagrams-OFF path is byte-identical to "today".
function preDiagramModeDirective(opts: {
  isQuizMe: boolean;
  isRealPractice: boolean;
  mode: string;
  learningActionsFlagOn: boolean;
}): string {
  const teachThenStopEnabled = opts.mode !== 'practice' ? opts.learningActionsFlagOn : false;
  const teachThenStopDirective = teachThenStopEnabled ? TEACH_THEN_STOP_DIRECTIVE : '';
  return opts.isQuizMe
    ? SINGLE_MCQ_DIRECTIVE
    : opts.isRealPractice
      ? PRACTICE_MCQ_DIRECTIVE
      : composeModeDirective(MODE_DIRECTIVES[opts.mode] ?? '', teachThenStopDirective);
}

describe('mode_directive — diagrams flag OFF is byte-identical to today', () => {
  it.each([...VALID_MODES])('mode %s (diagrams OFF, learning-actions OFF) equals the pre-Wave-2 selector', (mode) => {
    const got = resolveModeDirective({
      isQuizMe: false,
      isRealPractice: false,
      mode,
      learningActionsFlagOn: false,
      diagramsFlagOn: false,
    });
    const legacy = preDiagramModeDirective({
      isQuizMe: false,
      isRealPractice: false,
      mode,
      learningActionsFlagOn: false,
    });
    expect(got).toBe(legacy);
    expect(got).not.toContain(DIRECTIVE_MARKER);
  });

  it.each([...VALID_MODES])('mode %s (diagrams OFF, learning-actions ON) equals the teach-then-stop-only selector', (mode) => {
    // Diagrams OFF must not perturb the teach-then-stop composition on any mode.
    const got = resolveModeDirective({
      isQuizMe: false,
      isRealPractice: false,
      mode,
      learningActionsFlagOn: true,
      diagramsFlagOn: false,
    });
    const legacy = preDiagramModeDirective({
      isQuizMe: false,
      isRealPractice: false,
      mode,
      learningActionsFlagOn: true,
    });
    expect(got).toBe(legacy);
    expect(got).not.toContain(DIRECTIVE_MARKER);
  });
});

describe('mode_directive — diagrams flag ON injects DIAGRAM_DIRECTIVE on prose-teaching turns', () => {
  it.each(PROSE_TEACHING_MODES)('mode %s (diagrams ON, learning-actions OFF) IS the diagram directive verbatim', (mode) => {
    const d = resolveModeDirective({
      isQuizMe: false,
      isRealPractice: false,
      mode,
      learningActionsFlagOn: false,
      diagramsFlagOn: true,
    });
    // Teaching modes have an empty base directive, so the composed result IS the
    // diagram directive verbatim.
    expect(d).toBe(DIAGRAM_DIRECTIVE);
    expect(d).toContain(DIRECTIVE_MARKER);
  });

  it.each(PROSE_TEACHING_MODES)('mode %s (both flags ON) composes teach-then-stop THEN the diagram directive', (mode) => {
    const d = resolveModeDirective({
      isQuizMe: false,
      isRealPractice: false,
      mode,
      learningActionsFlagOn: true,
      diagramsFlagOn: true,
    });
    // Order: teach-then-stop first, diagram directive appended one blank line down.
    expect(d).toBe(`${TEACH_THEN_STOP_DIRECTIVE}\n\n${DIAGRAM_DIRECTIVE}`);
    expect(d).toContain('TEACH, THEN STOP');
    expect(d).toContain(DIRECTIVE_MARKER);
  });

  it('a legacy PRACTICE turn is NOT given the diagram directive, even with the flag ON', () => {
    // mode === 'practice' → the route skips the diagram flag read entirely.
    const d = resolveModeDirective({
      isQuizMe: false,
      isRealPractice: false,
      mode: 'practice',
      learningActionsFlagOn: true,
      diagramsFlagOn: true,
    });
    expect(d).toBe(MODE_DIRECTIVES.practice);
    expect(d).not.toContain(DIRECTIVE_MARKER);
  });

  it('quiz_me still wins with the diagrams flag ON (single MCQ directive, no diagram directive)', () => {
    const d = resolveModeDirective({
      isQuizMe: true,
      isRealPractice: false,
      mode: 'learn',
      learningActionsFlagOn: true,
      diagramsFlagOn: true,
    });
    expect(d).toBe(SINGLE_MCQ_DIRECTIVE);
    expect(d).not.toContain(DIRECTIVE_MARKER);
  });

  it('real-practice still wins with the diagrams flag ON (interactive MCQ directive, no diagram directive)', () => {
    const d = resolveModeDirective({
      isQuizMe: false,
      isRealPractice: true,
      mode: 'practice',
      learningActionsFlagOn: true,
      diagramsFlagOn: true,
    });
    expect(d).toBe(PRACTICE_MCQ_DIRECTIVE);
    expect(d).not.toContain(DIRECTIVE_MARKER);
  });
});

describe('DIAGRAM_DIRECTIVE — bans text-art, routes to the right block, sanitised grammar', () => {
  it('forbids ASCII / text-art drawing', () => {
    expect(DIAGRAM_DIRECTIVE).toContain('NEVER draw a diagram');
    expect(DIAGRAM_DIRECTIVE.toLowerCase()).toContain('text-art');
    expect(DIAGRAM_DIRECTIVE).toContain('unreadable on a phone');
  });

  it('routes each visual need to the correct block (mermaid / diagram / math)', () => {
    expect(DIAGRAM_DIRECTIVE).toContain('"mermaid" block');
    expect(DIAGRAM_DIRECTIVE).toContain('"diagram" block');
    expect(DIAGRAM_DIRECTIVE).toContain('"math" block');
    // The mermaid block shape is spelled out for the model.
    expect(DIAGRAM_DIRECTIVE).toContain('"type": "mermaid"');
  });

  it('lists the allowlisted diagram headers so the model only emits valid types', () => {
    for (const header of [
      'flowchart',
      'graph',
      'sequenceDiagram',
      'classDiagram',
      'stateDiagram',
      'stateDiagram-v2',
      'erDiagram',
      'mindmap',
      'pie',
      'timeline',
      'journey',
      'quadrantChart',
      'gitGraph',
    ]) {
      expect(DIAGRAM_DIRECTIVE).toContain(header);
    }
  });

  it('tells the model to keep code within the 1..2000 char bound', () => {
    expect(DIAGRAM_DIRECTIVE).toContain('1..2000');
  });

  it('forbids the exact XSS/interaction constructs the schema rejects', () => {
    expect(DIAGRAM_DIRECTIVE).toContain('<script');
    expect(DIAGRAM_DIRECTIVE).toContain('javascript:');
    expect(DIAGRAM_DIRECTIVE).toContain('click');
    expect(DIAGRAM_DIRECTIVE).toContain('%%{init');
  });

  it('stays bilingual (P7) and technical-term-safe', () => {
    expect(DIAGRAM_DIRECTIVE).toContain('Hindi');
    expect(DIAGRAM_DIRECTIVE).toContain('Hinglish');
    expect(DIAGRAM_DIRECTIVE).toContain('CBSE');
  });
});

describe('DIAGRAM_DIRECTIVE lives OUTSIDE the parity-locked prompt + safety rails', () => {
  it('is NOT baked into the parity-locked FOXY_STRUCTURED_OUTPUT_PROMPT', () => {
    // The directive is deliberately additive (injected via mode_directive) so the
    // Node<->Deno<->Python byte-identical constant stays clean.
    expect(FOXY_STRUCTURED_OUTPUT_PROMPT).not.toContain(DIRECTIVE_MARKER);
    expect(FOXY_STRUCTURED_OUTPUT_PROMPT).not.toContain('NEVER draw a diagram');
  });

  it('is NOT part of FOXY_SAFETY_RAILS (P12 rails untouched)', () => {
    expect(FOXY_SAFETY_RAILS).not.toContain(DIRECTIVE_MARKER);
    // Rails still carry their core scope literals.
    expect(FOXY_SAFETY_RAILS).toContain('Only teach from CBSE');
  });

  it('is NOT hardcoded into the base persona (buildSystemPrompt), for every valid mode', () => {
    for (const mode of VALID_MODES) {
      const prompt = buildSystemPrompt({
        grade: '8',
        subject: 'Science',
        chapter: null,
        mode,
        academicGoal: null,
        cognitiveCtx: EMPTY_COGNITIVE_CONTEXT,
      });
      expect(prompt).not.toContain(DIRECTIVE_MARKER);
      expect(prompt).toContain('You are Foxy');
    }
  });
});
