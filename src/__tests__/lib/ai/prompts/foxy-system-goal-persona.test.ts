/**
 * Phase 1 — Goal-Adaptive Foxy persona safety net.
 *
 * These tests pin the contract of `buildFoxySystemPrompt`:
 *
 *   1. Byte-identical default behavior
 *      When `useExpandedPersona` is omitted or set to `false`, the prompt
 *      string is byte-identical to the pre-Phase-1 builder. This is the
 *      safety contract that makes shipping Phase 1 behind
 *      `ff_goal_aware_foxy` a no-op for all current sessions.
 *
 *   2. Expanded persona swap (flag on + known goal)
 *      When `useExpandedPersona: true` and the goal is a known `GoalCode`,
 *      the legacy single-line goal sentence is replaced by the
 *      multi-paragraph block from `buildExpandedPersona(goal, mode)`.
 *      We assert this by checking for an expected substring from the
 *      authored persona text in `goal-personas.ts`.
 *
 *   3. Conservative fallback (flag on + null/unknown goal)
 *      When `useExpandedPersona: true` but the goal cannot be resolved,
 *      no `## Student's Academic Goal` section is emitted. We'd rather
 *      omit the section than render a degraded "expanded" persona that
 *      fell back to a raw goal string.
 *
 * Owner: ai-engineer (per goal-aware integration brief)
 * Review: assessment (curriculum scope, persona accuracy)
 */

import { describe, it, expect } from 'vitest';
import { buildFoxySystemPrompt } from '@/lib/ai/prompts/foxy-system';

// ─── Shared defaults ───────────────────────────────────────────────────────
//
// These mirror the most common Foxy invocation: a Class 7 CBSE math student
// in `learn` mode with no chapter scope and empty RAG context. They are
// intentionally minimal so the goal-section diff is the only signal in
// each assertion.

const BASE_PARAMS = {
  grade: '7',
  subject: 'math',
  board: 'CBSE',
  chapter: null,
  mode: 'learn',
  ragContext: '',
} as const;

// ─── Legacy reference output ───────────────────────────────────────────────
//
// PINNED. If you find yourself changing this constant to make a test pass,
// STOP — you are about to break the byte-identical contract that
// `useExpandedPersona === false` is supposed to honor. Talk to the
// ai-engineer agent and re-validate the rollout plan first.
//
// Re-derive only after assessment + ai-engineer agree the legacy path is
// formally retired (i.e. when `ff_goal_aware_foxy` ships at 100% and the
// legacy GOAL_PROMPT_MAP is being deleted).

const LEGACY_BOARD_TOPPER_PROMPT = `You are Foxy, a friendly AI tutor for Indian CBSE students. You are helping a Grade 7 student with math (Board: CBSE).

## Your Persona
- Warm, encouraging, and patient — like a knowledgeable elder sibling
- Use simple English; occasionally mix in Hindi phrases (e.g., "Bilkul sahi!", "Bahut accha!", "Chalo aage badhte hain!")
- Relate examples to Indian daily life, festivals, cricket, and familiar contexts
- Never give the answer outright for practice questions — guide the student to think
- Keep responses concise (3-5 sentences for explanations, numbered steps for processes)
- If a question is off-topic or inappropriate, gently redirect to the subject
- Celebrate correct answers and encourage after mistakes

## Mode: LEARN
Explain concepts clearly and build understanding step by step. Use examples from everyday Indian life.

## Safety Rules
- Only teach from CBSE Grade 7 math syllabus
- If you cite information, it MUST come from the Reference Material below
- Never invent facts, formulas, dates, or definitions
- If the answer is not in the reference material, say: "I don't have this in my notes — please check with your teacher or textbook."
- If the student seems frustrated, be extra encouraging
- Keep all language age-appropriate for grades 6-12
- Do not discuss topics outside academics

## Student's Academic Goal
Board Topper (90%+). Teach with depth, cover edge cases, use HOTS-style questioning, and push for thorough understanding.
Adjust depth, pacing, and challenge level to match this goal.
`;

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('buildFoxySystemPrompt — Phase 1 goal-aware persona', () => {
  describe('byte-identical default behavior (flag off)', () => {
    it('matches the pinned legacy output when useExpandedPersona is false', () => {
      const prompt = buildFoxySystemPrompt({
        ...BASE_PARAMS,
        academicGoal: 'board_topper',
        useExpandedPersona: false,
      });
      // Strict equality — any drift breaks the safety net.
      expect(prompt).toBe(LEGACY_BOARD_TOPPER_PROMPT);
    });

    it('matches the pinned legacy output when useExpandedPersona is omitted', () => {
      // Default value of `useExpandedPersona` MUST be `false` so that any
      // caller that hasn't been wired through to the Phase 1 flag continues
      // to render the legacy goal sentence.
      const prompt = buildFoxySystemPrompt({
        ...BASE_PARAMS,
        academicGoal: 'board_topper',
      });
      expect(prompt).toBe(LEGACY_BOARD_TOPPER_PROMPT);
    });

    it('legacy output preserves the legacy single-line goal sentence', () => {
      const prompt = buildFoxySystemPrompt({
        ...BASE_PARAMS,
        academicGoal: 'olympiad',
      });
      // Defense in depth — the snapshot above only covers board_topper.
      expect(prompt).toContain(
        "## Student's Academic Goal\nOlympiad Preparation. Challenge with advanced reasoning, logical puzzles, and problems that require creative thinking.",
      );
      // Make sure the expanded markers are NOT present on the default path.
      expect(prompt).not.toContain('Tone:');
      expect(prompt).not.toContain('Mode emphasis');
    });
  });

  describe('expanded persona (flag on + known goal)', () => {
    it('swaps in the board_topper expanded persona when flag is on', () => {
      const prompt = buildFoxySystemPrompt({
        ...BASE_PARAMS,
        academicGoal: 'board_topper',
        useExpandedPersona: true,
      });
      // Header preserved as anchor for downstream rendering / audit tooling.
      expect(prompt).toContain("## Student's Academic Goal");
      // Substring authored in goal-personas.ts → board_topper.tone /
      // .challengeCalibration.
      expect(prompt).toContain('marking scheme');
      expect(prompt).toContain('examiner mindset');
      // Mode emphasis line for `learn` is appended by buildExpandedPersona.
      expect(prompt).toContain('Mode emphasis (learn)');
      // Legacy single-line text MUST be absent — we replaced it.
      expect(prompt).not.toContain('Teach with depth, cover edge cases');
    });

    it('uses the olympiad expanded persona for goal=olympiad', () => {
      const prompt = buildFoxySystemPrompt({
        ...BASE_PARAMS,
        mode: 'practice',
        academicGoal: 'olympiad',
        useExpandedPersona: true,
      });
      expect(prompt).toContain("## Student's Academic Goal");
      // Substring authored in goal-personas.ts → olympiad.{tone,
      // mistakeHandling}.
      expect(prompt).toContain('alternate solution');
      expect(prompt).toContain('puzzle');
      // Mode emphasis switches with mode.
      expect(prompt).toContain('Mode emphasis (practice)');
      // Legacy olympiad line MUST be absent.
      expect(prompt).not.toContain(
        'Olympiad Preparation. Challenge with advanced reasoning',
      );
    });
  });

  describe('conservative fallback (flag on + null/unknown goal)', () => {
    it('omits the goal section entirely when academicGoal is null', () => {
      const prompt = buildFoxySystemPrompt({
        ...BASE_PARAMS,
        academicGoal: null,
        useExpandedPersona: true,
      });
      expect(prompt).not.toContain("## Student's Academic Goal");
    });

    it('omits the goal section entirely when academicGoal is undefined', () => {
      const prompt = buildFoxySystemPrompt({
        ...BASE_PARAMS,
        useExpandedPersona: true,
      });
      expect(prompt).not.toContain("## Student's Academic Goal");
    });

    it('omits the goal section entirely when academicGoal is unknown', () => {
      const prompt = buildFoxySystemPrompt({
        ...BASE_PARAMS,
        academicGoal: 'nonexistent_goal_code',
        useExpandedPersona: true,
      });
      // Per brief: when expanded persona is requested but the goal cannot
      // be resolved, render NO header — better silent omission than a
      // degraded prompt that fell back to a raw goal string.
      expect(prompt).not.toContain("## Student's Academic Goal");
    });
  });
});
