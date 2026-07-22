// apps/host/src/__tests__/api/foxy/teach-then-stop-directive.test.ts
//
// Phase 0.4 — ff_foxy_learning_actions_v1 "teach, then stop".
//
// When the redesigned post-answer action bar is live (Got it / Explain simpler /
// Show example / Quiz me), Foxy must TEACH the concept then STOP re-narrating
// that menu in prose ("Would you like me to explain this more simply? … just let
// me know!"). This pins the BINDING contract for the prompt side:
//
//   1. Flag OFF (or a practice turn) → mode_directive is BYTE-IDENTICAL to today
//      (the teach-then-stop string is never injected).
//   2. Flag ON on a prose-teaching turn (learn/explain/revise/doubt/homework/
//      explorer) → the teach-then-stop directive is injected via mode_directive.
//   3. quiz_me / real-practice still win (single / interactive MCQ directives) —
//      the teach-then-stop directive never displaces the MCQ-emitting shapes.
//   4. The directive forbids the ASSISTANT'S menu of next actions but KEEPS a
//      single substantive Socratic check question (that is teaching, not a
//      meta-offer).
//   5. FOXY_SAFETY_RAILS (P12) and the base persona are UNCHANGED — the directive
//      is threaded separately, never baked into the rails or persona.
//
// Owner: ai-engineer. Reviewers: assessment (age-appropriateness / curriculum
// scope), testing (this file). Pure-module tests — no route/DB/Claude imports.

import { describe, it, expect } from 'vitest';
import {
  MODE_DIRECTIVES,
  SINGLE_MCQ_DIRECTIVE,
  PRACTICE_MCQ_DIRECTIVE,
  TEACH_THEN_STOP_DIRECTIVE,
  composeModeDirective,
  FOXY_SAFETY_RAILS,
  buildSystemPrompt,
} from '@alfanumrik/lib/foxy/prompt-sections';
import { EMPTY_COGNITIVE_CONTEXT, VALID_MODES } from '@/app/api/foxy/_lib/constants';

// A distinctive marker line that only exists inside TEACH_THEN_STOP_DIRECTIVE —
// used to assert presence/absence without pinning the whole prose block.
const DIRECTIVE_MARKER = 'TEACH, THEN STOP';

// Mirror of the route's mode_directive selector (route.ts), INCLUDING the
// Phase 0.4 teach-then-stop composition:
//   const teachThenStopEnabled = mode !== 'practice' ? <flag> : false;
//   const teachThenStopDirective = teachThenStopEnabled ? TEACH_THEN_STOP_DIRECTIVE : '';
//   isQuizMe ? SINGLE_MCQ_DIRECTIVE
//   : isRealPractice ? PRACTICE_MCQ_DIRECTIVE
//   : composeModeDirective(MODE_DIRECTIVES[mode] ?? '', teachThenStopDirective)
// Kept in sync with the route; if the route's selector changes, update this.
function resolveModeDirective(opts: {
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

// The exact pre-Phase-0.4 selector (no teach-then-stop). Used to prove
// byte-identical output on the flag-OFF path for every mode/branch.
function legacyModeDirective(opts: {
  isQuizMe: boolean;
  isRealPractice: boolean;
  mode: string;
}): string {
  return opts.isQuizMe
    ? SINGLE_MCQ_DIRECTIVE
    : opts.isRealPractice
      ? PRACTICE_MCQ_DIRECTIVE
      : (MODE_DIRECTIVES[opts.mode] ?? '');
}

const PROSE_TEACHING_MODES = ['learn', 'explain', 'revise', 'doubt', 'homework', 'explorer'];

describe('composeModeDirective — byte-identical when the fragment is empty', () => {
  it('returns the base verbatim when extra is empty', () => {
    expect(composeModeDirective('', '')).toBe('');
    expect(composeModeDirective(MODE_DIRECTIVES.practice, '')).toBe(MODE_DIRECTIVES.practice);
    expect(composeModeDirective('base only', '')).toBe('base only');
  });

  it('returns the extra when base is empty (teaching modes have empty base)', () => {
    expect(composeModeDirective('', TEACH_THEN_STOP_DIRECTIVE)).toBe(TEACH_THEN_STOP_DIRECTIVE);
  });

  it('joins both with a single blank line when both are set', () => {
    expect(composeModeDirective('A', 'B')).toBe('A\n\nB');
  });
});

describe('mode_directive — flag OFF is byte-identical to today', () => {
  it.each([...VALID_MODES])('mode %s (flag OFF) equals the legacy selector', (mode) => {
    const on = resolveModeDirective({ isQuizMe: false, isRealPractice: false, mode, learningActionsFlagOn: false });
    const legacy = legacyModeDirective({ isQuizMe: false, isRealPractice: false, mode });
    expect(on).toBe(legacy);
    // Concretely: no teach-then-stop text leaks onto any flag-OFF turn.
    expect(on).not.toContain(DIRECTIVE_MARKER);
  });

  it('teaching modes resolve to empty string when the flag is OFF (unchanged)', () => {
    for (const mode of PROSE_TEACHING_MODES) {
      expect(
        resolveModeDirective({ isQuizMe: false, isRealPractice: false, mode, learningActionsFlagOn: false }),
      ).toBe(MODE_DIRECTIVES[mode] ?? '');
    }
  });
});

describe('mode_directive — flag ON injects teach-then-stop on prose-teaching turns', () => {
  it.each(PROSE_TEACHING_MODES)('mode %s (flag ON) injects TEACH_THEN_STOP_DIRECTIVE', (mode) => {
    const d = resolveModeDirective({ isQuizMe: false, isRealPractice: false, mode, learningActionsFlagOn: true });
    // Most teaching modes have an empty base directive, so the composed
    // result IS the teach-then-stop directive verbatim. 'explorer' is the
    // exception (item 4.1, 2026-07-21): it now has its OWN non-empty base
    // MODE_DIRECTIVES entry, so the composed result is base + teach-then-stop.
    expect(d).toBe(composeModeDirective(MODE_DIRECTIVES[mode] ?? '', TEACH_THEN_STOP_DIRECTIVE));
    expect(d).toContain(DIRECTIVE_MARKER);
  });

  it('a legacy practice turn is NOT given the teach-then-stop directive, even with the flag ON', () => {
    // Practice emits MCQs, not prose meta-offers — teach-then-stop is scoped out.
    const d = resolveModeDirective({ isQuizMe: false, isRealPractice: false, mode: 'practice', learningActionsFlagOn: true });
    expect(d).toBe(MODE_DIRECTIVES.practice);
    expect(d).not.toContain(DIRECTIVE_MARKER);
  });

  it('quiz_me still wins with the flag ON (single MCQ directive, no teach-then-stop)', () => {
    const d = resolveModeDirective({ isQuizMe: true, isRealPractice: false, mode: 'practice', learningActionsFlagOn: true });
    expect(d).toBe(SINGLE_MCQ_DIRECTIVE);
    expect(d).not.toContain(DIRECTIVE_MARKER);
  });

  it('real-practice still wins with the flag ON (interactive MCQ directive, no teach-then-stop)', () => {
    const d = resolveModeDirective({ isQuizMe: false, isRealPractice: true, mode: 'practice', learningActionsFlagOn: true });
    expect(d).toBe(PRACTICE_MCQ_DIRECTIVE);
    expect(d).not.toContain(DIRECTIVE_MARKER);
  });
});

describe('TEACH_THEN_STOP_DIRECTIVE — forbids the meta-offer, keeps the Socratic check', () => {
  it('bans the assistant\'s own menu of next actions (the redundant meta-narration)', () => {
    // The exact anti-patterns the redesign removes (the buttons already do these).
    expect(TEACH_THEN_STOP_DIRECTIVE).toContain('Would you like');
    expect(TEACH_THEN_STOP_DIRECTIVE).toContain('give you an example');
    expect(TEACH_THEN_STOP_DIRECTIVE).toContain('Shall I quiz');
    expect(TEACH_THEN_STOP_DIRECTIVE).toContain('just let me know');
    expect(TEACH_THEN_STOP_DIRECTIVE).toContain('DO NOT');
    expect(TEACH_THEN_STOP_DIRECTIVE.toLowerCase()).toContain('menu of next actions');
  });

  it('KEEPS a single substantive Socratic check question (does not over-suppress pedagogy)', () => {
    // The distinction: forbid the assistant menu, but still ask the STUDENT a
    // real, concrete question.
    expect(TEACH_THEN_STOP_DIRECTIVE).toContain('check-for-understanding question');
    expect(TEACH_THEN_STOP_DIRECTIVE).toContain('ask the STUDENT');
    expect(TEACH_THEN_STOP_DIRECTIVE).toContain('AT MOST ONE');
    // Not a yes/no compliance prompt.
    expect(TEACH_THEN_STOP_DIRECTIVE).toContain('did you understand?');
  });

  it('stays bilingual (P7) and technical-term-safe', () => {
    expect(TEACH_THEN_STOP_DIRECTIVE).toContain('Hindi');
    expect(TEACH_THEN_STOP_DIRECTIVE).toContain('Hinglish');
    expect(TEACH_THEN_STOP_DIRECTIVE).toContain('CBSE');
  });
});

describe('FOXY_SAFETY_RAILS + base persona are UNCHANGED (P12)', () => {
  it('the teach-then-stop directive is NOT part of FOXY_SAFETY_RAILS', () => {
    expect(FOXY_SAFETY_RAILS).not.toContain(DIRECTIVE_MARKER);
    expect(FOXY_SAFETY_RAILS).not.toContain('just let me know');
  });

  it('FOXY_SAFETY_RAILS still carries the core P12 scope + safety literals', () => {
    // Sentinel content that the adaptive-layer-health guard also relies on.
    expect(FOXY_SAFETY_RAILS).toContain('Only teach from CBSE');
    expect(FOXY_SAFETY_RAILS).toContain('gently redirect to the subject');
    expect(FOXY_SAFETY_RAILS.toLowerCase()).toContain('age appropriateness');
  });

  it('buildSystemPrompt (base persona) does NOT hardcode the teach-then-stop directive', () => {
    // Proves the directive is threaded separately (via mode_directive), not baked
    // into the persona. Built for every valid mode to be thorough.
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
      expect(prompt).not.toContain('just let me know');
      // Sanity: the persona itself is still the real Foxy persona with rails.
      expect(prompt).toContain('You are Foxy');
      expect(prompt).toContain('Only teach from CBSE');
    }
  });
});
