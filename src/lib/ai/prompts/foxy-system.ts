/**
 * Foxy AI Tutor — System Prompt Template
 *
 * Builds the system prompt for Foxy, the conversational CBSE tutor.
 * Includes persona definition, mode-specific instructions, academic goal
 * calibration, RAG context injection, and safety rails.
 *
 * Used by: src/app/api/foxy/route.ts (Next.js route)
 *          supabase/functions/foxy-tutor/ (Edge Function)
 *
 * Owner: ai-engineer
 * Review: assessment (curriculum scope, age-appropriateness)
 */

import { buildExpandedPersona, type FoxyMode } from '@/lib/goals/goal-personas';
import { isKnownGoalCode, type GoalCode } from '@/lib/goals/goal-profile';

// Modes that the expanded persona builder recognizes. Any other mode value
// (legacy template variations, future additions) falls through to the
// legacy single-line goal section so we don't accidentally emit an
// expanded persona keyed off a stale mode string.
const EXPANDED_PERSONA_MODES = new Set<FoxyMode>([
  'learn',
  'explain',
  'practice',
  'revise',
  'doubt',
  'homework',
]);

function isExpandedPersonaMode(mode: string): mode is FoxyMode {
  return EXPANDED_PERSONA_MODES.has(mode as FoxyMode);
}

// ─── Academic goal mapping ──────────────────────────────────────────────────

const GOAL_PROMPT_MAP: Record<string, string> = {
  board_topper:
    'Board Topper (90%+). Teach with depth, cover edge cases, use HOTS-style questioning, and push for thorough understanding.',
  school_topper:
    'School Topper. Focus on strong conceptual clarity and application-based questions beyond rote learning.',
  pass_comfortably:
    'Pass Comfortably. Keep explanations simple and confidence-building. Focus on frequently-tested topics and basic numericals.',
  competitive_exam:
    'Competitive Exam Prep (JEE/NEET/Olympiad). Go beyond NCERT where relevant, include tricky problems and conceptual depth.',
  olympiad:
    'Olympiad Preparation. Challenge with advanced reasoning, logical puzzles, and problems that require creative thinking.',
  improve_basics:
    'Improve Basics. Be extra patient, use analogies and visuals, break complex topics into tiny steps, and reinforce fundamentals.',
};

// ─── Mode instructions ──────────────────────────────────────────────────────

const MODE_INSTRUCTIONS: Record<string, string> = {
  learn:
    'Explain concepts clearly and build understanding step by step. Use examples from everyday Indian life.',
  explain:
    'Give a detailed explanation with examples from everyday Indian life. Break complex ideas into digestible parts.',
  practice:
    'Ask follow-up questions to test understanding. If the student answers, evaluate and give feedback. Never give the answer directly — guide the student to think.',
  revise:
    'Provide a concise revision summary with key points, formulas, and mnemonics. Highlight frequently-tested areas.',
  doubt:
    'Address the specific doubt directly with a clear explanation. Reference NCERT material. If the doubt is vague, ask a clarifying question.',
  homework:
    'Use Socratic questioning to guide the student toward the answer. Never solve homework outright — ask leading questions and provide hints.',
};

// ─── Parameters ─────────────────────────────────────────────────────────────

export interface FoxySystemPromptParams {
  grade: string;          // P5: string "6"-"12"
  subject: string;
  board: string;          // e.g. "CBSE"
  chapter: string | null;
  mode: string;           // learn | explain | practice | revise | doubt | homework
  ragContext: string;     // Pre-formatted RAG context string (or empty)
  academicGoal?: string | null;
  /**
   * Phase 1 — Goal-Adaptive Foxy persona.
   *
   * When `true` AND `academicGoal` is a known {@link GoalCode}, the legacy
   * single-line `GOAL_PROMPT_MAP` entry is replaced by the multi-paragraph
   * persona block from `buildExpandedPersona(academicGoal, mode)`. The
   * `## Student's Academic Goal` section header is preserved so downstream
   * template rendering and audit tooling still see the same anchor.
   *
   * When `false` (the default) OR when `academicGoal` is null/unknown,
   * behavior is BYTE-IDENTICAL to the pre-Phase-1 builder. This is the
   * safety contract that lets us ship the expanded persona behind the
   * `ff_goal_aware_foxy` feature flag without disturbing the production
   * code path until rollout.
   *
   * Defaults to `false`. The Next.js route at `src/app/api/foxy/route.ts`
   * is the only caller that flips this to `true`, gated by
   * `isFeatureEnabled('ff_goal_aware_foxy', ...)`.
   */
  useExpandedPersona?: boolean;
}

// ─── Builder ────────────────────────────────────────────────────────────────

/**
 * Builds the complete system prompt for a Foxy tutoring session.
 *
 * Safety: includes CBSE scope restriction, factual integrity rails,
 * and age-appropriate language constraints (P12).
 */
export function buildFoxySystemPrompt(params: FoxySystemPromptParams): string {
  const {
    grade,
    subject,
    board,
    chapter,
    mode,
    ragContext,
    academicGoal,
    useExpandedPersona = false,
  } = params;

  const chapterLabel = chapter ? `, Chapter: ${chapter}` : '';
  const modeInstruction = MODE_INSTRUCTIONS[mode] ?? MODE_INSTRUCTIONS.learn;

  // Goal-section composition (Phase 1, founder-approved).
  //
  // Two code paths:
  //   1. Default (`useExpandedPersona === false`): byte-identical to the
  //      pre-Phase-1 builder. Renders the legacy single-line section for
  //      ANY truthy `academicGoal` (with raw goal string as fallback when
  //      the goal is not in `GOAL_PROMPT_MAP`). The snapshot test in
  //      `foxy-system-goal-persona.test.ts` pins this exact output.
  //   2. Expanded (`useExpandedPersona === true`): when the goal is a
  //      known `GoalCode`, swap in the multi-paragraph persona block from
  //      `buildExpandedPersona(...)`. Header `## Student's Academic Goal`
  //      is preserved as the anchor. When the goal is null/unknown, emit
  //      no goal section at all — we'd rather show no persona than an
  //      "expanded" persona that fell back to the raw goal string.
  let goalSection = '';
  if (useExpandedPersona) {
    if (
      academicGoal &&
      isKnownGoalCode(academicGoal) &&
      isExpandedPersonaMode(mode)
    ) {
      const goalCode: GoalCode = academicGoal;
      const expanded = buildExpandedPersona(goalCode, mode);
      goalSection = `\n## Student's Academic Goal\n${expanded}\nAdjust depth, pacing, and challenge level to match this goal.\n`;
    }
    // else: null/unknown goal or unknown mode → no header. Conservative
    // fallback so we never emit a degraded "expanded" persona.
  } else if (academicGoal) {
    // Legacy path — DO NOT modify without re-pinning the snapshot test.
    goalSection = `\n## Student's Academic Goal\n${GOAL_PROMPT_MAP[academicGoal] ?? academicGoal}\nAdjust depth, pacing, and challenge level to match this goal.\n`;
  }

  const ragSection = ragContext
    ? `\n## NCERT Reference Material\n${ragContext}\n`
    : '';

  return `You are Foxy, a friendly AI tutor for Indian CBSE students. You are helping a Grade ${grade} student with ${subject}${chapterLabel} (Board: ${board}).

## Your Persona
- Warm, encouraging, and patient — like a knowledgeable elder sibling
- Use simple English; occasionally mix in Hindi phrases (e.g., "Bilkul sahi!", "Bahut accha!", "Chalo aage badhte hain!")
- Relate examples to Indian daily life, festivals, cricket, and familiar contexts
- Never give the answer outright for practice questions — guide the student to think
- Keep responses concise (3-5 sentences for explanations, numbered steps for processes)
- If a question is off-topic or inappropriate, gently redirect to the subject
- Celebrate correct answers and encourage after mistakes

## Mode: ${mode.toUpperCase()}
${modeInstruction}

## Safety Rules
- Only teach from ${board} Grade ${grade} ${subject} syllabus
- If you cite information, it MUST come from the Reference Material below
- Never invent facts, formulas, dates, or definitions
- If the answer is not in the reference material, say: "I don't have this in my notes — please check with your teacher or textbook."
- If the student seems frustrated, be extra encouraging
- Keep all language age-appropriate for grades 6-12
- Do not discuss topics outside academics
${goalSection}${ragSection}`;
}
