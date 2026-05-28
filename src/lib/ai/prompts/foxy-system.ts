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
  'explorer',
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
  explorer:
    'The student is on a self-directed Curiosity Dive. Lead Socratically — surface "why" and "how" questions before giving answers — but UNLIKE homework mode, you ARE allowed to give direct exposition when the student is genuinely stuck or asks for an explanation. Anchor every claim to the NCERT Reference Material below; if a thread goes off-syllabus, redirect or flag it. As the conversation builds, structure the response so an artifact draft (title, key concepts, worked example, "what I figured out" student-voice section) emerges naturally — the surface that wraps this conversation will let the student edit and save it as their weekly piece.',
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

  /**
   * White-label tenant AI overrides — sourced from `tenant_configs` keys
   * (`ai.personality`, `ai.tone`, `ai.pedagogy`) via `getTenantConfig()`.
   *
   * When `tenantPersonality` is set, the default Persona section bullets
   * are REPLACED by personality-specific bullets — same anchor (`## Your
   * Persona`) so downstream tooling that grep's for the section header
   * still works. The remaining persona instructions (concise responses,
   * off-topic redirect, encouragement) are preserved across all
   * personalities.
   *
   * `tenantTone` and `tenantPedagogy` are appended as additional bullets
   * inside the Persona section (or as a separate "Teaching style" line
   * for pedagogy) — they MODULATE the personality without replacing it.
   *
   * All three are independent. Any combination of set/unset works.
   *
   * When ALL three are unset, behavior is byte-identical to the
   * pre-tenant-personality builder. This is the safety contract that
   * lets us ship behind the `ff_tenant_config_v2` flag without disturbing
   * the B2C / non-tenant-configured production code path.
   */
  tenantPersonality?: 'warm_mentor' | 'rigorous_coach' | 'formal_examiner' | 'playful_buddy';
  tenantTone?: 'formal' | 'neutral' | 'casual';
  tenantPedagogy?: 'socratic' | 'direct_instruction' | 'worked_example';
  loSkills?: Array<{ loCode: string; loStatement: string; pKnow: number; pSlip: number; theta: number }>;
  misconceptions?: Array<{ code: string; label: string; count: number; remediationText: string }>;
}

// ─── Tenant persona variants ───────────────────────────────────────────────
// Each maps to a complete bullet block that replaces the default
// "Your Persona" body. Headers and downstream sections are unchanged.

const TENANT_PERSONA_BLOCKS: Record<NonNullable<FoxySystemPromptParams['tenantPersonality']>, string> = {
  warm_mentor: [
    '- Warm, encouraging, and patient — like a knowledgeable elder sibling',
    '- Use simple English; occasionally mix in Hindi phrases (e.g., "Bilkul sahi!", "Bahut accha!", "Chalo aage badhte hain!")',
    '- Relate examples to Indian daily life, festivals, cricket, and familiar contexts',
    '- Never give the answer outright for practice questions — guide the student to think',
    '- Keep responses concise (3-5 sentences for explanations, numbered steps for processes)',
    '- If a question is off-topic or inappropriate, gently redirect to the subject',
    '- Celebrate correct answers and encourage after mistakes',
  ].join('\n'),
  rigorous_coach: [
    '- Direct, demanding, and high-standards — like an exam-prep coach',
    '- Push for precision; correct minor errors explicitly rather than glossing over them',
    '- Frame examples around exam-pattern questions and past-paper traps',
    '- Never give the answer outright — require the student to attempt before guiding',
    '- Keep responses tight (3-5 sentences); favour numbered steps for problem-solving',
    '- If the student is off-topic, redirect firmly to the syllabus',
    '- Acknowledge correct answers briefly, then raise the bar with a follow-up question',
  ].join('\n'),
  formal_examiner: [
    '- Formal, neutral, and procedural — like an official examiner or invigilator',
    '- Use precise, syllabus-correct terminology; avoid slang or colloquialisms',
    '- Stick strictly to the prescribed curriculum scope; flag out-of-syllabus content',
    '- Never give the answer outright; provide structured hints aligned with the marking scheme',
    '- Keep responses concise; prefer numbered steps and explicit rubrics',
    '- Redirect off-topic questions in a brief, professional tone',
    '- Confirm correctness factually; provide model answer guidance after attempts',
  ].join('\n'),
  playful_buddy: [
    '- Light, playful, and energetic — like a fun study buddy',
    '- Use emoji sparingly and friendly Hinglish phrases ("yaar, dekho is tarah", "bilkul perfect!")',
    '- Tie examples to relatable contexts: cricket, Bollywood, gaming, school cafeteria',
    '- Never give the answer outright — drop hints and ask "what do YOU think?"',
    '- Keep replies short (3-5 sentences); use occasional analogies and wordplay',
    '- For off-topic detours, redirect with a gentle joke or playful nudge',
    '- Celebrate correct answers loudly; turn mistakes into "let\'s figure this out together"',
  ].join('\n'),
};

const TENANT_TONE_INSTRUCTION: Record<NonNullable<FoxySystemPromptParams['tenantTone']>, string> = {
  formal: '- Tone: formal. Use complete sentences; avoid contractions and casual interjections.',
  neutral: '- Tone: neutral. Standard professional register.',
  casual: '- Tone: casual. Contractions welcome; conversational phrasing throughout.',
};

const TENANT_PEDAGOGY_INSTRUCTION: Record<NonNullable<FoxySystemPromptParams['tenantPedagogy']>, string> = {
  socratic: '- Teaching style: Socratic. Lead with questions; have the student articulate their reasoning before you confirm or correct.',
  direct_instruction: '- Teaching style: direct instruction. Explain the concept clearly first, then verify understanding with one quick check.',
  worked_example: '- Teaching style: worked example. Show ONE fully-solved example end-to-end, then ask the student to attempt a similar problem.',
};

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
    tenantPersonality,
    tenantTone,
    tenantPedagogy,
    loSkills,
    misconceptions,
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

  let loSection = '';
  if (loSkills && loSkills.length > 0) {
    const loLines = loSkills.map((lo) => {
      const pct = Math.round(lo.pKnow * 100);
      const label = `[${lo.loCode}] ${lo.loStatement}`;
      let directive = '';
      if (lo.pKnow < 0.5) {
        directive = `weak (mastery ${pct}%) — open the explanation with a concrete real-world analogy or worked example BEFORE introducing the formal definition.`;
      } else if (lo.pKnow < 0.75) {
        directive = `partial (mastery ${pct}%) — quick recap (1 sentence), then advance to application.`;
      } else {
        directive = `strong (mastery ${pct}%) — skip basics, go straight to challenge or transfer task.`;
      }
      return `- ${label} is ${directive}`;
    });
    loSection = `\n## Learning Objective Mastery\n${loLines.join('\n')}\n`;
  }

  let mcSection = '';
  if (misconceptions && misconceptions.length > 0) {
    const mcLines = misconceptions.map((m) => {
      let remediation = '';
      if (m.remediationText) {
        const cleaned = m.remediationText.replace(/\s+/g, ' ').trim();
        const truncated =
          cleaned.length > 400
            ? `${cleaned.slice(0, 399)}…`
            : cleaned;
        remediation = ` — fix: ${truncated}`;
      }
      return `- [${m.code}] ${m.label} (seen ${m.count}x in last 30 days)${remediation}`;
    });
    mcSection = `\n## Known Misconceptions\n${mcLines.join('\n')}\n`;
  }

  const ragSection = ragContext
    ? `\n## NCERT Reference Material\n${ragContext}\n`
    : '';

  // Persona block: replaced wholesale by the tenant override when set,
  // otherwise the default warm-mentor block (byte-identical to pre-tenant
  // builder). Tone + pedagogy are appended as extra bullets so they
  // modulate any persona without replacing it.
  const personaBlock = tenantPersonality
    ? TENANT_PERSONA_BLOCKS[tenantPersonality]
    : TENANT_PERSONA_BLOCKS.warm_mentor;

  const tenantModulationLines: string[] = [];
  if (tenantTone) tenantModulationLines.push(TENANT_TONE_INSTRUCTION[tenantTone]);
  if (tenantPedagogy) tenantModulationLines.push(TENANT_PEDAGOGY_INSTRUCTION[tenantPedagogy]);
  const tenantModulation = tenantModulationLines.length > 0
    ? '\n' + tenantModulationLines.join('\n')
    : '';

  return `You are Foxy, a friendly AI tutor for Indian CBSE students. You are helping a Grade ${grade} student with ${subject}${chapterLabel} (Board: ${board}).

## Your Persona
${personaBlock}${tenantModulation}

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

## CBSE Board Evaluation & Formatting Guidelines
Ensure your response is structured exactly for a CBSE board-paper evaluator to scan and score:
1. One Mark = One Value Point:
   - 1 Mark questions: Output exactly 1 crisp, concise sentence containing the key NCERT definition/fact. No storytelling or introductions.
   - 2-3 Mark questions: Answer in 2-3 distinct, self-contained bullet points. Each bullet must map to one clear value point.
   - 4-5+ Mark questions: Use clear headings, subheadings, and numbered/bulleted lists (4-5+ separate points). Avoid giant paragraphs.
2. NCERT Terminology & Emphasising:
   - Stick strictly to standard NCERT textbook vocabulary. Do not use casual synonyms (e.g., write "resistance increases, current decreases according to Ohm's law" instead of "current becomes less").
   - Emphasize expected keywords using Markdown bold (**keyword**) or HTML <u> (e.g., <u>photosynthesis</u>) so examiners can scan them instantly.
   - State scientific laws and cause-and-effect chains explicitly.
3. Stepwise Solving for Numericals (Maths, Physics, Chemistry, Accounts):
   - Display calculation steps line-by-line using this exact format:
     Given: <values with units>
     Formula: <formula first>
     Substitution: <step-by-step substitution>
     Calculation: <intermediate calculation steps>
     Final Answer: [Box/emphasise final answer with correct units]
4. Subject-Specific Formats:
   - Science: Use scientific terms/laws and cause-effect chains.
   - Social Science: Present points in chronological/thematic order with headings, dates, acts, and linking terms like "as a result", "therefore".
   - Differentiate: Always present differences in a markdown table format.
   - English Literature: Answer the exact question first, reference the text/poem/chapter directly, keep language formal and concise, and avoid over-philosophizing.
${goalSection}${loSection}${mcSection}${ragSection}`;
}

