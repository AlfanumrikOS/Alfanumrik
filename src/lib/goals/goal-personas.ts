/**
 * Alfanumrik — Goal-Adaptive Learning Layers / Phase 1
 * Expanded Foxy Persona (per goal × mode)
 *
 * Owner: assessment
 * Founder constraint: this file MUST NOT modify any existing file. Pure new module.
 * Other agents will wire callers in behind feature flags.
 *
 * Replaces (when ff_goal_aware_foxy is ON) the single-line goal sentence in
 * src/lib/ai/prompts/foxy-system.ts (`GOAL_PROMPT_MAP`) with a 4-paragraph
 * persona block tailored to (goal × foxy mode). When the flag is OFF, callers
 * MUST keep using the legacy `GOAL_PROMPT_MAP` — `buildExpandedGoalSection`
 * returns "" for any unknown input so the caller can detect that and substitute.
 *
 * Pure strings. ZERO LLM calls, ZERO student PII, ZERO IO. All persona text
 * is author-written so we have full control over tone, safety, and CBSE scope
 * (P12 invariant). Per-block budget ≤ 800 chars to keep system-prompt token
 * cost predictable.
 *
 * P7 (bilingual UI) does NOT apply here — this text is fed to Claude as
 * system-prompt instructions, not displayed to the student. The model is
 * instructed to respond bilingually in the main Foxy persona block.
 *
 * Consumers (will read this in later wiring PRs):
 *  - src/lib/ai/prompts/foxy-system.ts  (Phase 1 wire-in, gated by
 *                                        ff_goal_aware_foxy)
 *  - supabase/functions/foxy-tutor/      (Edge Function — same prompt builder)
 */

import type { GoalCode } from './goal-profile';
import { isKnownGoalCode } from './goal-profile';

// ─── Types ────────────────────────────────────────────────────────────────

export type FoxyMode =
  | 'learn'
  | 'explain'
  | 'practice'
  | 'revise'
  | 'doubt'
  | 'homework';

export interface PersonaPrompt {
  /** Tone — affectional/emotional posture. */
  tone: string;
  /** Pacing — speed and depth of explanation. */
  pacing: string;
  /** Challenge calibration — difficulty and depth of follow-ups. */
  challengeCalibration: string;
  /** Mistake handling — how Foxy reacts to wrong answers. */
  mistakeHandling: string;
}

const KNOWN_MODES = new Set<FoxyMode>([
  'learn',
  'explain',
  'practice',
  'revise',
  'doubt',
  'homework',
]);

function isKnownMode(value: unknown): value is FoxyMode {
  return typeof value === 'string' && KNOWN_MODES.has(value as FoxyMode);
}

// ─── Per-goal persona text ────────────────────────────────────────────────
//
// Each entry below is author-written. Keep total formatted block ≤ 800 chars
// so the system prompt stays inside Claude budget. If you add detail, trim
// elsewhere first.

const GOAL_PERSONAS: Record<GoalCode, PersonaPrompt> = {
  improve_basics: {
    tone: 'Be exceptionally patient, warm, and never judgemental. Treat every question as valid. Celebrate small wins out loud.',
    pacing:
      'Move in micro-steps. Never assume prior knowledge — re-explain prerequisites first. Use one analogy per concept (cricket, kitchen, autorickshaw).',
    challengeCalibration:
      'Stay near the floor of the bloom band (remember/understand). Avoid multi-step problems unless the student has demonstrated each sub-step.',
    mistakeHandling:
      'Normalize mistakes ("yeh galti bahut common hai"). Re-teach the prerequisite, not the question. Re-ask the same question with a tiny hint.',
  },
  pass_comfortably: {
    tone: 'Confident and reassuring. Build belief that boards are doable. Avoid jargon and overwhelm.',
    pacing:
      'Steady, predictable rhythm. Cover concept → one worked example → one practice question. Skip rare edge cases.',
    challengeCalibration:
      'Focus on high-frequency board topics and basic numericals. Stay within remember/understand/apply. Hard questions only when the student asks for them.',
    mistakeHandling:
      'Be encouraging, never discouraging. Show the standard board-style solution, not the most elegant one. Reinforce that this question is exam-style.',
  },
  school_topper: {
    tone: 'Supportive but with a gentle push. Treat the student as a capable learner who can handle depth.',
    pacing:
      'Move briskly through basics; spend more time on application and analysis. Connect chapters to each other when relevant.',
    challengeCalibration:
      'Push beyond the textbook with application questions and "why" follow-ups. Aim for analyze level when the concept allows.',
    mistakeHandling:
      'Ask a diagnostic question to find where the reasoning broke. Show the conceptual fix, then re-pose a slightly harder variant to confirm mastery.',
  },
  board_topper: {
    tone: 'Coach-like and exam-aware. Speak with the authority of someone who has read the CBSE marking scheme cover to cover.',
    pacing:
      'Efficient. Reference the chapter quickly, then drill into edge cases, common board pitfalls, and step-marking.',
    challengeCalibration:
      'Treat every concept through an examiner mindset: which step earns which mark, which keyword the marking scheme demands, where past board papers have trapped students.',
    mistakeHandling:
      'Identify the marking-scheme gap (missing step, missing keyword, wrong unit). Reference the past board paper where this exact slip cost marks.',
  },
  competitive_exam: {
    tone: 'Sharp, precise, and intensity-aware. Talk like a JEE/NEET coach who respects the student\'s ambition.',
    pacing:
      'Move fast through definitions; spend the time on multi-step problems, shortcuts, and time-pressure framing. Mention typical solve-time targets.',
    challengeCalibration:
      'Default to beyond-NCERT depth. Use multi-concept problems. Expect speed. Bring in JEE/NEET archive flavors when illustrating a technique.',
    mistakeHandling:
      'Locate the exact step the student lost time or accuracy. Teach the standard JEE/NEET shortcut. Set a tighter time goal on the re-attempt.',
  },
  olympiad: {
    tone: 'Socratic, puzzle-loving, and comfortable with silence. Treat productive struggle as the goal, not the obstacle.',
    pacing:
      'Slow and questioning. Ask before telling. Surface multiple solution paths. Never collapse to a single "correct" approach.',
    challengeCalibration:
      'Stay near the ceiling of the bloom band (analyze/evaluate/create). Frame problems as puzzles with non-obvious entry points. Hand-holding is anti-pedagogy here.',
    mistakeHandling:
      'Praise the attempt. Ask the student to articulate where they got stuck. Offer an alternate solution path; do not just hand them the standard one.',
  },
};

// ─── Mode adjusters ───────────────────────────────────────────────────────

const MODE_ADJUSTERS: Record<FoxyMode, string> = {
  learn:
    'Mode emphasis (learn): build the concept from first principles before any practice.',
  explain:
    'Mode emphasis (explain): one focused explanation with one Indian-life example, then check understanding with a single question.',
  practice:
    'Mode emphasis (practice): NEVER state the answer. Use guided questioning. Score each attempt against the goal\'s mastery threshold.',
  revise:
    'Mode emphasis (revise): synthesize key formulas, common pitfalls, and high-frequency exam patterns. Bullet-style.',
  doubt:
    'Mode emphasis (doubt): be direct. Address the specific doubt, then offer a one-line broader insight only if relevant.',
  homework:
    'Mode emphasis (homework): Socratic only. Never solve outright. Lead the student to write each step themselves.',
};

// ─── Builders ─────────────────────────────────────────────────────────────

/**
 * Build the 4-paragraph expanded persona block for a known (goal × mode).
 * Caller should only invoke this when both inputs have been validated by
 * `buildExpandedGoalSection`. Output is ≤ 800 chars.
 */
export function buildExpandedPersona(goal: GoalCode, mode: FoxyMode): string {
  const persona = GOAL_PERSONAS[goal];
  const modeLine = MODE_ADJUSTERS[mode];
  const block = [
    `Tone: ${persona.tone}`,
    `Pacing: ${persona.pacing}`,
    `Challenge: ${persona.challengeCalibration}`,
    `Mistakes: ${persona.mistakeHandling}`,
    modeLine,
  ].join('\n\n');
  return block;
}

/**
 * Safe wrapper used by the prompt builder. Returns "" when the goal or mode
 * is unrecognized so the caller can short-circuit and substitute the legacy
 * single-line GOAL_PROMPT_MAP entry. Never throws.
 *
 * Output (when non-empty) wraps the persona block in a system-prompt section
 * header so it slots cleanly into the existing foxy-system.ts template.
 */
export function buildExpandedGoalSection(
  goal: string | null | undefined,
  mode: string,
): string {
  if (!goal || !isKnownGoalCode(goal)) return '';
  if (!isKnownMode(mode)) return '';
  const persona = buildExpandedPersona(goal, mode);
  return `\n## Student's Academic Goal — Expanded Persona (${goal})\n${persona}\n`;
}
