// ─────────────────────────────────────────────────────────────────────────────
// Foxy system-prompt sections (H1 REFACTOR M2 — extracted from
// src/app/api/foxy/route.ts, behavior-preserving). These are the PURE,
// deterministic prompt-builder functions/constants that assemble the Foxy
// system prompt — including FOXY_SAFETY_RAILS and buildSystemPrompt (P12 AI
// safety surface) — moved here BYTE-IDENTICAL. No route-local runtime state,
// no request objects, no closures. Imported and used identically by route.ts.
//
// DO NOT weaken the safety rails (FOXY_SAFETY_RAILS) or the prompt strings
// without an assessment-agent review — the CBSE scope, off-topic redirect,
// age-appropriateness, and Hindi/English mixing guidance are curriculum-
// correctness + P12/P7 invariants.
// ─────────────────────────────────────────────────────────────────────────────
import type { CognitiveContext, CoachMode } from '@/app/api/foxy/_lib/constants';
import { buildExpandedGoalSection } from '@alfanumrik/lib/goals/goal-personas';
import { buildTenantOverrideSection } from '@alfanumrik/lib/ai/prompts/tenant-overrides';
import type { FoxyResponse } from '@alfanumrik/lib/foxy/schema';
import type { LlmGrader } from '@alfanumrik/lib/ai/validation/quiz-oracle';
import { parseLlmGraderResponse } from '@alfanumrik/lib/ai/validation/quiz-oracle';
import {
  QUIZ_ORACLE_GRADER_SYSTEM_PROMPT,
  buildQuizOracleGraderUserPrompt,
} from '@alfanumrik/lib/ai/validation/quiz-oracle-prompts';
import { callClaude } from '@alfanumrik/lib/ai';

// ─── Helper: pKnow → directive sentence (per-LO bucket) ─────────────────────
//
// Replaces flat percentage labels like "P(know)=42%" with directive sentences
// keyed on three pKnow buckets. The model received numbers but didn't know
// what to DO with them; directives say HOW to open the explanation.
//   pKnow < 0.5         → weak     (analogy/worked example BEFORE definition)
//   0.5 ≤ pKnow < 0.75  → partial  (1-sentence recap, then advance)
//   pKnow ≥ 0.75        → strong   (skip basics, go to challenge/transfer)
function buildLoDirective(lo: {
  loCode: string;
  loStatement: string;
  pKnow: number;
}): string {
  const pct = Math.round(lo.pKnow * 100);
  const label = `[${lo.loCode}] ${lo.loStatement}`;
  if (lo.pKnow < 0.5) {
    return `${label} is weak (mastery ${pct}%) — open the explanation with a concrete real-world analogy or worked example BEFORE introducing the formal definition.`;
  }
  if (lo.pKnow < 0.75) {
    return `${label} is partial (mastery ${pct}%) — quick recap (1 sentence), then advance to application.`;
  }
  return `${label} is strong (mastery ${pct}%) — skip basics, go straight to challenge or transfer task.`;
}

// ─── Helper: compose recentErrors + recentMisconceptions ────────────────────
//
// Audit finding: RECENT_ERROR_PATTERNS (generic counts) and KNOWN_MISCONCEPTIONS
// (curated ontology) were two separate signals that didn't compose. The
// MISCONCEPTION_REPAIR pedagogy rule fires on a 3+ generic-error count, but
// the curated label/remediation lives in a different section. Compose them:
// when the top curated misconception has count ≥ 2 (a real overlap, not a
// one-off), emit a SINGLE binary directive the model can act on directly.
// Otherwise return empty so the legacy generic-counts block can render.
function composeMisconceptionDirective(
  recentErrors: CognitiveContext['recentErrors'],
  misconceptions: CognitiveContext['recentMisconceptions'],
): string {
  if (misconceptions.length === 0) return '';
  const top = misconceptions[0];
  if (!top || top.count < 2) return '';
  // Defense-in-depth: cap remediation snippet (the curated section already
  // truncates at 400 chars, but the directive line stays terse).
  let fix = '';
  if (top.remediationText) {
    const cleaned = top.remediationText.replace(/\s+/g, ' ').trim();
    fix = ` — ${cleaned.length > 200 ? `${cleaned.slice(0, 199)}…` : cleaned}`;
  }
  // Suppress the generic counts block when we have curated overlap so the
  // model sees ONE directive instead of two competing signals. Caller decides
  // to skip the legacy block when this returns non-empty.
  void recentErrors;
  return `MISCONCEPTION TO TARGET: ${top.label}${fix}`;
}

// ─── Helper: build cognitive prompt section from CME data ───────────────────

/**
 * Cold-start prompt section. Used when `loadCognitiveContext()` returned
 * no signal at all — i.e., the student has no quiz history, no concept
 * mastery rows, no knowledge gaps, no errors, no LO data, no curated
 * misconceptions, and no CME-recommended next action.
 *
 * Pre-fix this branch returned '' from `buildCognitivePromptSection`, which
 * meant brand-new signups got a generic Foxy with no calibration directive
 * — no follow-up, no diagnostic offer, and the model was free to assume
 * either proficiency or struggle without any signal. The result was that
 * the *first* Foxy turn (the one that decides whether the student comes
 * back tomorrow) was the *least* personalised turn in the student's
 * lifecycle.
 *
 * Cold-start contract: answer the student's question, then ask ONE light
 * calibration follow-up so the next turn has signal, and hint that quizzes
 * unlock personalisation. Bilingual via Foxy's general "match the
 * student's language" rule in FOXY_SAFETY_RAILS — we do not need to
 * duplicate that here.
 */
export function buildColdStartPromptSection(): string {
  return [
    '=== FIRST-INTERACTION CONTEXT (no prior mastery data) ===',
    'This is a new student. You have no quiz history, no mastery signals.',
    '',
    'BEHAVIOUR FOR THIS FIRST INTERACTION:',
    '- Answer their actual question first. Match the language they wrote in.',
    '- Give a FULL, rich teacher-like explanation (6-8 blocks). Do NOT give a short answer.',
    '- Use clear, standard CBSE language at grade level.',
    '- After answering, ask ONE light calibration follow-up that surfaces what they',
    '  already know or struggle with on this topic. Frame it warmly, not as a test.',
    '- If their question is meta (e.g. "what should I study?", "where do I start?"),',
    '  suggest a quick 3-question diagnostic from this chapter.',
    '- End with a one-line nudge to take a chapter quiz for personalised help.',
    '',
    'AVOID on cold-start:',
    '- Short or sparse answers — a new student deserves your BEST explanation.',
    '- Assuming proficiency or struggle without data.',
    '- Pushing prerequisites you have not verified.',
  ].join('\n');
}

// ─── Part A: deterministic lead-concept selector (READ-ONLY) ────────────────
//
// Assessment-authoritative selection rule. Pure function over the ALREADY-
// loaded CognitiveContext — performs NO database reads and NO mastery writes.
// First match wins:
//   (1) Overdue review, weakest first: among revisionDue (next_review_date <=
//       today, already pre-filtered at load time), pick the LOWEST mastery;
//       tie-break by the OLDEST next_review_date (the `lastReviewed` field
//       carries the concept_mastery.next_review_date string).
//   (2) else weakTopics[0] (already sorted weakest-first at load time).
//   (3) else nextAction.conceptName when set.
//   (4) else null — NO fabrication. The caller reuses the existing
//       "DO NOT invent topics" rail so Foxy asks what they want to work on.
//
// `mastery` here is the 0-100 integer already rounded at load time. Using the
// integer for the "weakest" comparison is exact enough for selection — the
// raw probability is monotonic with its rounded form, and the tie-break on
// next_review_date keeps the choice deterministic.
export type LeadConcept = {
  title: string;
  /** 0-100 integer mastery (rounded at load time). */
  mastery: number;
  /** Where the pick came from — drives the directive wording + telemetry. */
  source: 'overdue_review' | 'weak_topic' | 'next_action';
};

export function selectLeadConcept(ctx: CognitiveContext): LeadConcept | null {
  // (1) Overdue review, weakest first; tie-break oldest next_review_date.
  // revisionDue is pre-filtered to next_review_date <= today at load time.
  if (ctx.revisionDue.length > 0) {
    const sorted = [...ctx.revisionDue].sort((a, b) => {
      if (a.mastery !== b.mastery) return a.mastery - b.mastery; // weakest first
      // tie-break: oldest next_review_date (lexicographic on YYYY-MM-DD is
      // chronological; empty strings sort first which is a safe "oldest").
      return (a.lastReviewed || '').localeCompare(b.lastReviewed || '');
    });
    const pick = sorted[0];
    if (pick && pick.title) {
      return { title: pick.title, mastery: pick.mastery, source: 'overdue_review' };
    }
  }

  // (2) Weakest topic (weakTopics is already weakest-first at load time).
  const weakest = ctx.weakTopics[0];
  if (weakest && weakest.title) {
    return { title: weakest.title, mastery: weakest.mastery, source: 'weak_topic' };
  }

  // (3) CME next-action concept, if named.
  if (ctx.nextAction && ctx.nextAction.conceptName) {
    // nextAction has no mastery number; treat as unknown (-1) so the directive
    // does not assert a false percentage.
    return { title: ctx.nextAction.conceptName, mastery: -1, source: 'next_action' };
  }

  // (4) No signal → no fabrication.
  return null;
}

// Build a single explicit lead-concept directive naming the selected concept.
// Instructs Foxy to OPEN by targeting it and to scaffold by the existing
// weak-start rule: for a weak concept (mastery < 50%) open with an analogy or
// worked example BEFORE the formal definition, and never pose a Bloom level
// above the student's current ceiling + 1 (i.e. stay within reach). When no
// concept is selected, emit the no-fabrication rail instead of a named target.
export function buildLeadConceptDirective(lead: LeadConcept | null): string {
  if (!lead) {
    // (4) No-fabrication rail — mirror the existing "DO NOT invent topics" rail
    // used by the intent=weak_areas path, so Foxy asks rather than hallucinates.
    return [
      '=== LEAD-CONCEPT DIRECTIVE (proactive weak-area targeting) ===',
      'There is no mastery signal for this student yet, so you have NO verified',
      'weakest concept to lead with. DO NOT invent a topic they are weak in.',
      'Open by warmly asking what they would like to work on today, and offer to',
      'run a short diagnostic quiz so future sessions can target their real gaps.',
    ].join('\n');
  }

  const lines: string[] = [
    '=== LEAD-CONCEPT DIRECTIVE (proactive weak-area targeting) ===',
  ];
  const masteryClause =
    lead.mastery >= 0 ? ` (current mastery ~${lead.mastery}%)` : '';
  const sourceClause =
    lead.source === 'overdue_review'
      ? ' It is OVERDUE for review.'
      : lead.source === 'next_action'
        ? ' The Cognitive Mastery Engine flagged it as the next best concept.'
        : ' It is this student\'s weakest concept right now.';
  lines.push(
    `OPEN this turn by proactively targeting "${lead.title}"${masteryClause}.${sourceClause}`,
  );
  // Scaffold by Bloom ceiling — reuse the weak-start rule (mirrors
  // buildLoDirective's < 0.5 branch). mastery < 0 means "unknown" (next_action
  // path); treat unknown conservatively as weak so we never over-pitch.
  if (lead.mastery < 50) {
    lines.push(
      '- This concept is WEAK. Open with a concrete real-world analogy or a worked',
      '  example BEFORE introducing the formal definition.',
      '- Stay within reach: scaffold from the student\'s current Bloom level and never',
      '  pose a question more than one Bloom level above their current ceiling.',
    );
  } else {
    lines.push(
      '- Open with a one-sentence recap, then a quick recall check, then advance.',
      '- Stay within reach: do not pose a question more than one Bloom level above',
      '  the student\'s current ceiling for this concept.',
    );
  }
  lines.push(
    '- If the student then names a different topic, follow their lead instead.',
  );
  return lines.join('\n');
}

export function buildCognitivePromptSection(ctx: CognitiveContext): string {
  const isColdStart =
    ctx.weakTopics.length === 0 &&
    ctx.strongTopics.length === 0 &&
    ctx.knowledgeGaps.length === 0 &&
    ctx.revisionDue.length === 0 &&
    ctx.recentErrors.length === 0 &&
    !ctx.nextAction &&
    ctx.loSkills.length === 0 &&
    ctx.recentMisconceptions.length === 0;

  if (isColdStart) {
    return buildColdStartPromptSection();
  }

  const sections: string[] = [];

  sections.push('=== STUDENT LEARNING STATE (from Cognitive Mastery Engine) ===');

  if (ctx.weakTopics.length > 0) {
    sections.push('\nWEAK TOPICS (explain more carefully, use simpler language):');
    for (const t of ctx.weakTopics) {
      sections.push(`- ${t.title}: ${t.mastery}% mastery (${t.attempts} attempts)`);
    }
  }

  if (ctx.strongTopics.length > 0) {
    sections.push('\nSTRONG TOPICS (can reference as foundations, challenge with harder questions):');
    for (const t of ctx.strongTopics) {
      sections.push(`- ${t.title}: ${t.mastery}% mastery`);
    }
  }

  if (ctx.knowledgeGaps.length > 0) {
    // Hard pedagogical branch (B'-2). Pre-fix this section was a soft
    // directive — "address prerequisites before advancing" — which the model
    // routinely interpreted as "mention the prerequisite, then teach the
    // target anyway". The OVERRIDE block below makes it a hard branch:
    // verify prerequisite first via ONE check question, only proceed to the
    // target if the student demonstrates the prerequisite. This is the
    // ladder-up pedagogy the May-2026 plan promised.
    const primary = ctx.knowledgeGaps[0];
    sections.push('\nPEDAGOGY OVERRIDE — KNOWLEDGE-GAP BRANCH:');
    sections.push(
      'The student is asking about a concept that depends on prerequisites they have NOT mastered.',
    );
    sections.push('Your turn MUST follow this sequence:');
    sections.push(
      `  1. Do NOT directly explain "${primary.target}" yet.`,
    );
    sections.push(
      `  2. Open with a brief, friendly check on the prerequisite: "${primary.prerequisite}".`,
    );
    sections.push(
      '     One short question, framed as "before we tackle this, can you tell me…".',
    );
    sections.push(
      '  3. If the student answers correctly OR confirms they understand the prerequisite,',
    );
    sections.push(
      `     proceed to teach "${primary.target}" using the standard scaffolding rules.`,
    );
    sections.push(
      '  4. If they answer incorrectly or are unsure, teach the prerequisite first',
    );
    sections.push(
      '     (compact 3-4 block explanation) and tell them you will come back to the',
    );
    sections.push('     original question on the next turn.');
    sections.push('');
    sections.push('All detected gaps (handle the first one this turn; surface others as a "we should also revisit…" line):');
    for (const g of ctx.knowledgeGaps) {
      sections.push(`- Missing: "${g.prerequisite}" needed for "${g.target}" (${g.gapType})`);
    }
  }

  if (ctx.revisionDue.length > 0) {
    sections.push('\nCONCEPTS DUE FOR REVISION (ask a quick recall question before teaching new content):');
    for (const r of ctx.revisionDue) {
      sections.push(`- ${r.title}: ${r.mastery}% mastery, overdue for review`);
    }
  }

  // Compose recentErrors + recentMisconceptions into a single binary
  // directive when curated misconception data overlaps with generic error
  // counts. This makes the MISCONCEPTION_REPAIR pedagogy rule fire on real
  // curated signals (label + remediation) rather than generic error_type
  // strings. Threshold: top curated misconception count >= 2 = fire.
  const composedMc = composeMisconceptionDirective(
    ctx.recentErrors,
    ctx.recentMisconceptions,
  );
  if (composedMc) {
    sections.push(`\n${composedMc}`);
  } else if (ctx.recentErrors.length > 0) {
    // Fall back to legacy generic error counts only when no curated overlap.
    sections.push('\nRECENT ERROR PATTERNS (address these misconceptions proactively):');
    for (const e of ctx.recentErrors) {
      sections.push(`- ${e.errorType} errors: ${e.count} times in last 30 days`);
    }
  }

  // Phase 2: per-LO BKT mastery — finer-grained than topic mastery above.
  // Render as DIRECTIVE sentences keyed on pKnow buckets, not raw labels.
  // The flat percentage label "P(know)=42%" was descriptive but not
  // actionable. Bucketed directives tell Foxy HOW to open the explanation.
  if (ctx.loSkills.length > 0) {
    sections.push('\nLEARNING OBJECTIVE MASTERY (directive — open the explanation accordingly):');
    for (const lo of ctx.loSkills) {
      sections.push(`- ${buildLoDirective(lo)}`);
    }
  }

  if (ctx.nextAction) {
    sections.push(`\nRECOMMENDED ACTION: ${ctx.nextAction.actionType.toUpperCase()}`);
    sections.push(`Concept: ${ctx.nextAction.conceptName}`);
    sections.push(`Reason: ${ctx.nextAction.reason}`);
  }

  sections.push('\n=== COGNITIVE LOAD INSTRUCTIONS ===');
  if (ctx.masteryLevel === 'low') {
    sections.push('Student is STRUGGLING. Instructions:');
    sections.push('- Use simple, clear language. One idea per paragraph.');
    sections.push('- Give a worked example BEFORE asking the student to try.');
    sections.push('- Break multi-step problems into individual steps.');
    sections.push('- Maximum 3-4 sentences per explanation block.');
    sections.push('- Use analogies from daily life familiar to Indian students.');
    sections.push('- After explaining, ask ONE simple check-for-understanding question.');
  } else if (ctx.masteryLevel === 'medium') {
    sections.push('Student is PROGRESSING. Instructions:');
    sections.push('- Standard explanation with examples.');
    sections.push('- Ask check-for-understanding questions to verify comprehension.');
    sections.push('- Build on their strong topics when explaining new concepts.');
    sections.push('- Introduce "why" questions to deepen understanding.');
  } else {
    sections.push('Student is PROFICIENT. Instructions:');
    sections.push('- Challenge with higher-order questions (analyze, evaluate, create).');
    sections.push('- Connect concepts across chapters.');
    sections.push('- Encourage independent reasoning before giving answers.');
    sections.push('- Ask "what if" and "why not" questions.');
    sections.push('- Suggest CBSE board-level application problems.');
  }

  return sections.join('\n');
}

// ─── Helper: build curated misconception prompt section ────────────────────
//
// Renders the top-3 curated misconceptions observed in this student's recent
// (30 day) wrong-answer patterns. Used to fire MISCONCEPTION_REPAIR in the
// Foxy pedagogy decision tree (foxy_tutor_v1) — without this data the branch
// never triggers because cme_error_log only has generic error_type strings.
//
// Empty input → empty string (no heading printed). The template renders the
// `{{misconception_section}}` placeholder as empty so there's no orphan
// header. P13: NEVER pair misconception code/label with student_id in logs.
// P12 prompt-bloat guard: cap rendered remediation text at 400 chars. Curated
// remediations in `wrong_answer_remediations` are 150-300 chars by policy; 400
// is a 33% safety margin. Without this cap, a 5000-char curator entry in a
// 3-misconception section would add ~15k tokens to every Foxy request.
const REMEDIATION_MAX_CHARS = 400;

function buildMisconceptionPromptSection(
  misconceptions: CognitiveContext['recentMisconceptions'],
): string {
  if (misconceptions.length === 0) return '';
  const lines: string[] = [
    "KNOWN MISCONCEPTIONS (curated, observed in this student's recent quizzes):",
  ];
  for (const m of misconceptions) {
    let remediation = '';
    if (m.remediationText) {
      const cleaned = m.remediationText.replace(/\s+/g, ' ').trim();
      const truncated =
        cleaned.length > REMEDIATION_MAX_CHARS
          ? `${cleaned.slice(0, REMEDIATION_MAX_CHARS - 1)}…`
          : cleaned;
      remediation = ` — fix: ${truncated}`;
    }
    lines.push(
      `- [${m.code}] ${m.label} (seen ${m.count}x in last 30 days)${remediation}`,
    );
  }
  return lines.join('\n');
}

// ─── Academic goal → prompt instruction mapping ──────────────────────────────
const GOAL_PROMPT_MAP: Record<string, string> = {
  board_topper: 'Board Topper (90%+). Teach with depth, cover edge cases, use HOTS-style questioning, and push for thorough understanding.',
  school_topper: 'School Topper. Focus on strong conceptual clarity and application-based questions beyond rote learning.',
  pass_comfortably: 'Pass Comfortably. Keep explanations simple and confidence-building. Focus on frequently-tested topics and basic numericals.',
  competitive_exam: 'Competitive Exam Prep (JEE/NEET/Olympiad). Go beyond NCERT where relevant, include tricky problems and conceptual depth.',
  olympiad: 'Olympiad Preparation. Challenge with advanced reasoning, logical puzzles, and problems that require creative thinking.',
  improve_basics: 'Improve Basics. Be extra patient, use analogies and visuals, break complex topics into tiny steps, and reinforce fundamentals.',
};

/**
 * Phase 1 — Goal-Adaptive Foxy persona (gated by `ff_goal_aware_foxy`).
 *
 * Default invocation `buildAcademicGoalSection(goal)` is byte-identical to
 * the pre-Phase-1 behavior: it falls through to the single-line
 * `GOAL_PROMPT_MAP` lookup. When the route detects the flag is on it calls
 * `buildAcademicGoalSection(goal, mode, { useExpandedPersona: true })` to
 * swap in the multi-paragraph persona block from
 * `buildExpandedGoalSection(...)`. When that builder cannot resolve the
 * goal (null/unknown code) it returns "" and we fall back to the legacy
 * single-line section so the prompt is never silently emptied.
 */
function buildAcademicGoalSection(
  goal: string | null,
  mode?: string,
  options?: { useExpandedPersona?: boolean },
): string {
  if (!goal) return '';
  if (options?.useExpandedPersona && mode) {
    const expanded = buildExpandedGoalSection(goal, mode);
    if (expanded) return expanded;
    // Fall through to legacy if goal/mode unknown to expanded builder.
  }
  const instruction = GOAL_PROMPT_MAP[goal] ?? goal;
  return `\n## Student's Academic Goal: ${instruction}\n`;
}

// ─── Coaching-mode resolver (Phase 2.2 + B'-5 Phase 2 feedback signal) ──────
//
// Decides the per-turn coaching shape from the explicit request param (if any)
// + the student's current mastery level + recent thumbs-feedback signal.
// Default policy:
//   mastery 'low'    → 'socratic'  (scaffold prerequisites)
//   mastery 'medium' → 'socratic'  (the moat — ask, don't tell)
//   mastery 'high'   → 'answer'    (concise answer + stretch question)
// 'review' must be requested explicitly (used by spaced-repetition surface).
//
// B'-5 Phase 2 override: when the student's last 2+ socratic-mode turns
// received a thumbs-down (consecutive), flip to 'answer' for THIS turn.
// Reason: scaffolding is frustrating the student — give them the answer to
// re-establish trust. The streak resets the next time they thumbs-up.
// Explicit `requested` still wins (a deliberate /quiz-style "review" or
// "socratic" request is not overridden by recent feedback).
type CoachFeedbackSignal = {
  /** Count of consecutive thumbs-down on socratic-mode turns, most recent first. */
  recentSocraticThumbsDownStreak: number;
};

const NO_FEEDBACK_SIGNAL: CoachFeedbackSignal = {
  recentSocraticThumbsDownStreak: 0,
};

function resolveCoachMode(
  requested: CoachMode | null,
  masteryLevel: CognitiveContext['masteryLevel'],
  feedback: CoachFeedbackSignal = NO_FEEDBACK_SIGNAL,
): CoachMode {
  if (requested) return requested;
  // B'-5 Phase 2: scaffolding is misfiring → flip to direct answer.
  if (feedback.recentSocraticThumbsDownStreak >= 2) return 'answer';
  if (masteryLevel === 'high') return 'answer';
  return 'socratic';
}

// Per-request-mode directive injected into foxy_tutor_v1 via `{{mode_directive}}`.
// Why: the base template hard-codes a STEP CARDS turn shape (2-4 numbered cards,
// <=120 words total). That works for mode=learn but is wrong for mode=practice
// — Claude writes a 1-paragraph "Here are 5 problems" intro and stops, since
// the prompt never instructs it to actually emit MCQ blocks. This directive
// overrides the STEP CARDS rule for practice. Empty string = no override.
const MODE_DIRECTIVES: Record<string, string> = {
  practice: [
    '## Mode Directive (PRACTICE — overrides STEP CARDS above)',
    'The student is in PRACTICE MODE. Generate practice problems, NOT teaching content.',
    'Respond with EXACTLY 5 "paragraph" blocks (one per question). Do NOT emit step,',
    'definition, example, exam_tip, answer, question, math, or mcq blocks. Do NOT write',
    'any intro prose — open the response directly with the first paragraph block. Use',
    'the "title" field for context (e.g., "Practice: Sour, Sweet, Bitter, Salty").',
    '',
    'Each paragraph block\'s "text" field MUST contain a complete MCQ formatted EXACTLY',
    'like this (preserve the markdown so the renderer styles it properly):',
    '',
    '**Q<N>. <stem — 15-50 words, testing one specific concept>**',
    '',
    '(A) <option a>',
    '(B) <option b>',
    '(C) <option c>',
    '(D) <option d>',
    '',
    '**Correct: <A|B|C|D>** — <difficulty: easy|medium|hard>',
    '',
    '_Why:_ <1-2 sentence explanation, 10-200 chars, why the correct answer is right>',
    '',
    'All 5 questions in a single response — never reply with one at a time. The 4 options',
    'must be distinct and non-empty; exactly one correct. Mix difficulty across the 5',
    '(e.g., 2 easy, 2 medium, 1 hard). Stay strictly inside the student\'s grade and',
    'chapter scope — do NOT pull problems from outside the Reference Material below.',
  ].join('\n'),
  learn: '',
  explain: '',
  revise: '',
};

// Practice mode emits 5 mcq blocks (stem + 4 options + correct_index + explanation
// + bloom + difficulty per block). The default 1024 cap truncates after block 1-2,
// leaving the picker rescue to surface only the intro. 2500 fits 5 mcqs comfortably
// once the grounded-answer pipeline applies its 1.6x foxy boost (→ ~4000 effective).
const MODE_MAX_TOKENS: Record<string, number> = {
  practice: 2500,
  learn: 3000,
  explain: 3000,
  revise: 3000,
};

// ─── Post-answer re-teach + Quiz-me directives (Phase 1 learning actions) ────
//
// The client passes `coachDirective` on a follow-up turn for the SAME question
// the student just saw. We turn it into an instruction appended to the system
// prompt so the model re-explains / works an example / emits a single MCQ —
// all inside the existing FoxyResponse structured schema, bilingual (P7), and
// inside CBSE scope (the RAG context + safety rails are unchanged).
//
// 'simplify'  → re-explain the previous answer at a lower reading level.
// 'example'   → one fully worked example for the previous question.
// 'quiz_me'   → exactly ONE oracle-gated mcq block on the same concept.
//
// Unknown values are dropped silently in the request parser below — never
// trust the client to set arbitrary directives. P12: these directives only
// constrain shape/level; they do NOT widen scope or relax safety rails.
export const VALID_COACH_DIRECTIVES = ['simplify', 'example', 'quiz_me'] as const;
export type CoachDirective = typeof VALID_COACH_DIRECTIVES[number];

export const COACH_DIRECTIVE_SECTIONS: Record<CoachDirective, string> = {
  simplify: [
    '## RE-TEACH DIRECTIVE — EXPLAIN SIMPLER (overrides verbosity rules above)',
    'The student just saw your previous answer to this question and asked for a SIMPLER explanation.',
    'Re-explain the SAME concept / previous answer, do NOT change the answer itself:',
    '- Lower the reading level: short sentences, one idea per block, everyday words.',
    '- Lead with ONE concrete real-world analogy familiar to an Indian student.',
    '- Keep it brief: 3-5 blocks total. Avoid jargon; if a technical term is',
    '  unavoidable, define it in one short clause.',
    '- Stay strictly within the same CBSE grade/subject/chapter scope as before.',
    '- Do NOT emit an mcq block. End with ONE gentle check-for-understanding question.',
  ].join('\n'),
  example: [
    '## RE-TEACH DIRECTIVE — SHOW EXAMPLE (overrides verbosity rules above)',
    'The student just saw your previous answer and asked for a WORKED EXAMPLE.',
    'Give ONE fully worked example for the SAME previous question / concept:',
    '- Pick a concrete, grade-appropriate example from the CBSE chapter in scope.',
    '- Work it step by step using "step" blocks (and "math" blocks for any',
    '  calculations), then a final "answer" block stating the result clearly.',
    '- Keep the example self-contained; do not introduce new unrelated concepts.',
    '- Do NOT emit an mcq block. End with ONE "now you try" question of similar shape.',
  ].join('\n'),
  // quiz_me's prompt directive lives in SINGLE_MCQ_DIRECTIVE below and is wired
  // through MODE_DIRECTIVES so it overrides the 5-question PRACTICE shape with a
  // single-MCQ shape. The map entry here is intentionally empty: the system-
  // prompt section for quiz_me is the single-MCQ directive, not a re-teach blurb.
  quiz_me: '',
};

// Single-MCQ directive for the "Quiz me on this" post-answer action. Overrides
// the 5-question MODE_DIRECTIVES.practice shape: emit EXACTLY ONE mcq block on
// the concept the student just studied, so the route can oracle-gate that one
// block (P6 + REG-54) before it is shown. P12: the block still flows through
// the structured schema + the boundary oracle; a failing mcq is never shown.
export const SINGLE_MCQ_DIRECTIVE = [
  '## Mode Directive (QUIZ ME — overrides STEP CARDS and 5-question PRACTICE)',
  'The student tapped "Quiz me on this" right after seeing your answer. They want',
  'to test themselves on the SAME concept you just taught.',
  'Respond with EXACTLY ONE "mcq" block and NOTHING else (no intro paragraph, no',
  'extra blocks). The mcq block MUST satisfy:',
  '- "stem": a clear 15-50 word question testing the concept just taught, inside',
  '  the student\'s CBSE grade/subject/chapter scope. No "{{" or "[BLANK]" markers.',
  '- "options": EXACTLY 4 distinct, non-empty options; exactly one is correct.',
  '- "correct_answer_index": integer 0..3 pointing at the correct option.',
  '- "explanation": 1-2 sentences (>=10 chars) saying why the correct option is right.',
  '- "bloom_level" and "difficulty": set them honestly for this question.',
  'Write the stem/options/explanation in the student\'s language (English, Hindi, or',
  'Hinglish); keep technical terms (CBSE, NCERT, Bloom\'s) in English.',
].join('\n');

// ─── Real practice — interactive multi-MCQ directive (ff_foxy_real_practice_v1) ─
//
// The number of interactive mcq blocks a real-practice turn asks the model for.
// Chosen small (3) so EVERY emitted mcq can be oracle-gated (P6 + REG-54 — each
// mcq costs one grader call) without an unbounded LLM budget, while still giving
// the student a genuine multi-question practice set. The route caps the number
// of survivors it keeps at this same value (gatePracticeMcqs `maxKeep`).
export const PRACTICE_MCQ_COUNT = 3;

// Real-practice directive. Overrides the legacy MODE_DIRECTIVES.practice shape
// (5 markdown-in-paragraph pseudo-MCQs that render as NON-interactive text) with
// EXACTLY N real `mcq` blocks — each rendered as an interactive, answerable MCQ
// by FoxyStructuredRenderer and each oracle-gated by the route BEFORE display.
// This is the fix for the fake-action bug ("it says 'Generated 5 questions' but
// they're just text you can't answer"). Injected ONLY when
// ff_foxy_real_practice_v1 is ON; when OFF the route uses MODE_DIRECTIVES.practice
// verbatim (byte-identical to today).
//
// Anti-fake (P12): the closing instruction FORBIDS any prose claim of having made
// a quiz. The route additionally STRIPS all non-mcq blocks at the API boundary
// (buildGatedPracticeResponse) so a turn can never CLAIM questions it didn't
// actually emit as gated mcq blocks. P7: bilingual, technical terms in English.
export const PRACTICE_MCQ_DIRECTIVE = [
  '## Mode Directive (PRACTICE — REAL interactive quiz — overrides STEP CARDS above)',
  `The student is in PRACTICE MODE. Generate EXACTLY ${PRACTICE_MCQ_COUNT} interactive`,
  'practice questions as "mcq" blocks — NOT teaching content, NOT paragraphs.',
  '',
  `Respond with EXACTLY ${PRACTICE_MCQ_COUNT} "mcq" blocks and NOTHING else: no intro`,
  'paragraph, no closing prose, no "here are N questions" sentence, and no step /',
  'definition / example / answer / question / math / paragraph blocks. Open the',
  'response directly with the first mcq block. Use the "title" field for context',
  '(e.g. "Practice: Acids, Bases & Salts").',
  '',
  'Each "mcq" block MUST satisfy (every field is required):',
  '- "stem": a clear 15-50 word question testing ONE specific concept, inside the',
  '  student\'s CBSE grade/subject/chapter scope. No "{{" or "[BLANK]" markers.',
  '- "options": EXACTLY 4 distinct, non-empty options; exactly one is correct.',
  '- "correct_answer_index": integer 0..3 pointing at the correct option.',
  '- "explanation": 1-2 sentences (>=10 chars) saying why the correct option is right.',
  '- "bloom_level" and "difficulty": set them honestly for each question.',
  '',
  `Make the ${PRACTICE_MCQ_COUNT} questions distinct and CALIBRATE their difficulty to`,
  'the student\'s mastery signals in the cognitive context below. Never pose a',
  'question more than ONE Bloom level above the student\'s current ceiling for the',
  'topic: a struggling student gets mostly easy/medium recall-and-understand items',
  '(e.g. 2 easy, 1 medium); a proficient student gets a genuine higher-order item',
  '(e.g. 1 easy, 1 medium, 1 hard). If no mastery signal is available yet, default',
  'to a gentle spread (e.g. 2 easy, 1 medium). Stay strictly inside the student\'s',
  'grade and chapter scope — do NOT pull problems from outside the Reference',
  'Material below.',
  'Write the stem/options/explanation in the student\'s language (English, Hindi, or',
  'Hinglish); keep technical terms (CBSE, NCERT, Bloom\'s) in English.',
  '',
  'IMPORTANT — do NOT claim to have created a quiz in prose. The ONLY questions',
  'that count are the mcq blocks themselves; never write a sentence like "I',
  `generated ${PRACTICE_MCQ_COUNT} questions". Emit the mcq blocks and nothing else.`,
].join('\n');

// ─── Phase 0.4: teach-then-stop directive (ff_foxy_learning_actions_v1) ──────
//
// When the redesigned post-answer action bar is live, the student's screen
// ALREADY shows tappable buttons for the next step: "Got it", "Explain
// simpler", "Show example", and "Quiz me". So Foxy re-narrating those same
// options in prose ("Would you like me to explain this more simply? I can also
// give you an example, or quiz you on it — just let me know!") is redundant and
// un-teacherly. This directive tells Foxy to TEACH cleanly, END with at most
// ONE substantive check question, and NOT enumerate the assistant's own menu of
// next actions.
//
// CRITICAL distinction (do NOT over-suppress pedagogy): this forbids OFFERING
// THE ASSISTANT'S MENU of next actions — it does NOT forbid asking the STUDENT
// a real question. A single Socratic check / scaffold / stretch question is
// still expected (that IS teaching). Only the assistant's self-narrated
// "shall I… / do you want me to… / just let me know" menu is banned.
//
// Threaded ONLY through the `mode_directive` template variable (the same channel
// as SINGLE_MCQ_DIRECTIVE / PRACTICE_MCQ_DIRECTIVE) and ONLY on prose-teaching
// turns (mode !== 'practice'), gated by the EXISTING ff_foxy_learning_actions_v1
// flag. Flag OFF → this string is never injected → the prompt is byte-identical
// to today. P7 (bilingual) + P12 (age-appropriate, in-scope) are preserved and
// FOXY_SAFETY_RAILS are untouched — this only constrains the CLOSING shape.
export const TEACH_THEN_STOP_DIRECTIVE = [
  '## POST-ANSWER ACTIONS — TEACH, THEN STOP (overrides any "offer a follow-up" / closing-offer lines above)',
  "The student's screen already shows tappable buttons for what to do next:",
  '"Got it", "Explain simpler", "Show example", and "Quiz me". Those buttons —',
  'not your prose — are how the student chooses the next step.',
  '',
  'DO:',
  '- Teach the concept cleanly and completely. "STOP" here means STOP narrating',
  '  your own menu of next steps — it does NOT mean stop teaching, and it does NOT',
  '  stop you from advancing the chapter when the student is clearly ready.',
  '- End with AT MOST ONE short, specific check-for-understanding question that',
  '  asks the STUDENT to apply, restate, or reason about the idea you just taught.',
  '  Let your pedagogy mode set its shape — a CHECK (apply the just-taught idea to',
  '  a new tiny example), a SCAFFOLD (the next sub-step in the chain), or a STRETCH',
  '  (one Bloom level higher; for a strong student, sometimes the same level in a',
  '  fresh context). This single Socratic check is required teaching — keep it',
  '  concrete (never a yes/no "did you understand?").',
  '',
  'DO NOT:',
  '- Offer YOUR OWN menu of next actions. Never write lines like "Would you like',
  '  me to explain this more simply?", "I can give you an example", "Shall I quiz',
  '  you on this?", "Do you want me to…", or "just let me know!". The on-screen',
  '  buttons already do that — narrating them is redundant and un-teacherly.',
  '- Stack several offers or a "what would you like next?" list at the end.',
  '',
  "In short: ask the STUDENT one real question; do NOT advertise the assistant's",
  'own follow-up options. Keep this in the student\'s language (English, Hindi, or',
  "Hinglish); technical terms (CBSE, NCERT, Bloom's) stay in English.",
].join('\n');

// ─── Wave 2: Mermaid diagrams + ASCII-art ban (ff_foxy_diagrams_v1) ─────────
//
// Foxy used to "draw" diagrams as ASCII / text-art (`/ \`, `----`, box-drawing)
// inside paragraph/step text — unreadable on a phone and un-teacherly. This
// directive (a) FORBIDS ASCII/text-art in ANY block, and (b) routes each visual
// need to the RIGHT block: a drawable diagram → a `mermaid` block; a real
// labelled photo/figure → the existing `diagram` retrieval block; an equation →
// the `math` block.
//
// DELIBERATELY NOT inside the parity-locked FOXY_STRUCTURED_OUTPUT_PROMPT (that
// constant stays byte-identical Node<->Deno<->Python). This is an ADDITIVE
// section injected via the `mode_directive` channel — the SAME channel as
// TEACH_THEN_STOP_DIRECTIVE / PRACTICE_MCQ_DIRECTIVE — ONLY when
// `ff_foxy_diagrams_v1` is ON. Flag OFF (default) → never injected → the prompt
// is byte-identical to today.
//
// P7 (bilingual): node/edge labels follow the student's language; technical
// terms (CBSE, NCERT, Bloom's) stay in English. P12 (AI safety): the emitted
// `mermaid` block is schema-validated (allowlisted header, no <script> /
// javascript: / click callbacks); a malformed block fails validation and falls
// back to safe prose — broken diagram source is NEVER shown to a student.
export const DIAGRAM_DIRECTIVE = [
  '## DIAGRAM DIRECTIVE — use real diagrams, NEVER text-art',
  'NEVER draw a diagram, figure, chart, or table using ASCII / text-art. Do NOT',
  'sketch pictures with characters like "/", "\\", "|", "----", "+---+", arrows',
  'built from dashes, or box-drawing characters inside ANY block\'s text. Text-art',
  'is unreadable on a phone and is forbidden.',
  '',
  'Instead, pick the RIGHT block for the visual:',
  '- A process, cycle, flow, hierarchy, tree, relationship, sequence, timeline, or',
  '  state machine → emit a "mermaid" block (a real, rendered diagram).',
  '- A real labelled photo or textbook figure (e.g. "human heart labelled diagram")',
  '  → use the existing "diagram" block with a search_query.',
  '- An equation or formula → use a "math" block (or inline \\( ... \\) in text).',
  '',
  'A "mermaid" block has this exact shape:',
  '  { "type": "mermaid", "code": "<mermaid source>", "title": "<short caption, optional, <=120 chars>" }',
  'Rules for the "code" field (a malformed diagram is DROPPED, so follow these):',
  '- The FIRST word MUST be one of these diagram types: flowchart, graph,',
  '  sequenceDiagram, classDiagram, stateDiagram, stateDiagram-v2, erDiagram,',
  '  mindmap, pie, timeline, journey, quadrantChart, gitGraph.',
  '- Write syntactically VALID mermaid for that diagram type. Keep it small and',
  '  focused (a handful of nodes/edges), 1..2000 characters. Newlines inside the',
  '  JSON string are written as \\n.',
  '- Put node/edge LABELS in the student\'s language (English, Hindi, or Hinglish);',
  '  keep technical terms (CBSE, NCERT, Bloom\'s) in English.',
  '- Do NOT include HTML, "<script", "javascript:", a "click" interaction callback,',
  '  or a "%%{init ...}" directive — plain diagram syntax only.',
  '',
  'Example (a simple process flow):',
  '  { "type": "mermaid", "code": "flowchart TD\\n  A[Evaporation] --> B[Condensation]\\n  B --> C[Precipitation]\\n  C --> A", "title": "The Water Cycle" }',
].join('\n');

// ─── Wave B: math-format house style (ff_foxy_math_format_v2) ───────────────
//
// Wave A fixed the RENDERER (undelimited LaTeX is now rescued at display time).
// Wave B improves what the model EMITS. The structured-output contract already
// mandates \( ... \) inline + "math" blocks for standalone equations, but
// compliance is weak: multi-step worked examples come out as dense inline soup
// (several chained transformations packed into one paragraph), and the model
// sometimes writes bare LaTeX or wraps math in plain parentheses as
// pseudo-delimiters. This directive pins the CEO-approved house style:
// numbered step blocks (one short action line each) alternating with display
// "math" blocks; derivations and tall/stacked expressions always in display
// math blocks; inline math for single symbols/values and short flat equations
// (assessment 2026-07-16: threshold tuned so simple inline algebra like
// "\( 2x + 3 = 7 \)" stays legal — the parity-locked structured-output
// few-shots model exactly that, and banning it both over-fragments short
// algebra and contradicts the base prompt).
//
// DELIBERATELY NOT inside the parity-locked FOXY_STRUCTURED_OUTPUT_PROMPT
// (that constant stays byte-identical Node<->Deno<->Python). This is an
// ADDITIVE section injected via the `mode_directive` channel — the SAME
// channel as TEACH_THEN_STOP_DIRECTIVE / DIAGRAM_DIRECTIVE — ONLY when
// `ff_foxy_math_format_v2` is ON. Flag OFF (default) → never injected → the
// prompt is byte-identical to today.
//
// P7 (bilingual): step text/labels follow the student's language; the
// mathematics itself is universal notation; technical terms stay in English.
// P12: this only constrains FORMAT — it does not widen scope, relax the
// safety rails, or touch the RAG/grounding/abstain path.
export const MATH_FORMAT_DIRECTIVE = [
  '## MATH FORMAT DIRECTIVE — steps + display math, never inline soup',
  'How you format mathematics is part of teaching it. A worked example written',
  'as one dense paragraph of chained expressions is WRONG. Follow these rules in',
  'EVERY response that contains math:',
  '',
  '1. WORKED EXAMPLES & DERIVATIONS — numbered steps, ONE transformation each:',
  '- Use a sequence of "step" blocks. Each "step" block\'s text is ONE short',
  '  action line stating what you do (e.g. "Cancel 14 and 42 (divide both by',
  '  14)."), optionally followed by ONE short "why" sentence. Nothing else.',
  '- Immediately after each action step, emit the RESULTING expression as its',
  '  own "math" block (display equation; "latex" field, no delimiters).',
  '- NEVER chain multiple transformations inside one paragraph, one step, or one',
  '  math block. One transformation = one step block + one math block.',
  '- COMPLETENESS: every "math" block must show the FULL equation or expression',
  '  being worked on — BOTH SIDES for an equation (e.g. "3x = 9", then "x = 3"),',
  '  the FULL expression for a simplification (not just the numerator or one term).',
  '  A reader must be able to follow the derivation by reading ONLY the math blocks',
  '  in sequence, without needing the step text to reconstruct any expression.',
  '- ALGEBRAIC FLOW: for equations, show the COMPLETE equation at every stage.',
  '  e.g. "3x + 5 = 14" then "3x = 9" then "x = 3". NEVER skip to the answer.',
  '  NEVER show just the RHS fragment. NEVER omit intermediate equations.',
  '',
  '2. WHERE MATH GOES — display vs inline:',
  '- Every transformation in a worked example or derivation gets its own',
  '  display "math" block (rule 1). NEVER run a derivation — two or more',
  '  chained transformations — through a prose sentence.',
  '- Any TALL or STACKED expression MUST be a "math" block on its own line:',
  '  a fraction multiplied by / added to another fraction, a nested fraction,',
  '  a root or exponent stack over a fraction, a summation, an integral.',
  '  Stacked expressions are unreadable inline on a phone.',
  '- Inline \\( ... \\) is for math woven into a sentence: a single symbol,',
  '  value, or fraction, or a short FLAT equation with no stacked parts',
  '  (e.g. "so \\( 2x + 3 = 7 \\) gives \\( x = 2 \\)", "a speed of',
  '  \\( 5 \\text{ m/s} \\)").',
  '',
  '3. DELIMITERS — never break these:',
  '- NEVER write LaTeX without delimiters. Bare "\\frac{1}{2}" or "x^2" inside a',
  '  text field is forbidden — wrap inline math in \\( ... \\).',
  '- NEVER wrap math in plain parentheses as pseudo-delimiters: "(3/4)" or',
  '  "( x = 2 )" is NOT math formatting. Use \\( ... \\) or a "math" block.',
  '',
  'Example — the correct step + math-block shape for a worked cancellation:',
  '  {"type":"step","label":"Given","text":"Multiply \\( \\frac{14}{15} \\) by \\( \\frac{25}{42} \\)."}',
  '  {"type":"math","latex":"\\frac{14}{15} \\times \\frac{25}{42} = \\frac{14 \\times 25}{15 \\times 42}"}',
  '  {"type":"step","text":"Cancel 14 and 42 (divide both by 14). A common factor above and below cancels."}',
  '  {"type":"math","latex":"\\frac{1 \\times 25}{15 \\times 3}"}',
  '  {"type":"step","text":"Cancel 25 and 15 (divide both by 5)."}',
  '  {"type":"math","latex":"\\frac{1 \\times 5}{3 \\times 3}"}',
  '  {"type":"step","text":"Multiply what is left on top and bottom."}',
  '  {"type":"math","latex":"\\frac{5}{9}"}',
  '  {"type":"answer","text":"The product is \\( \\frac{5}{9} \\)."}',
  '',
  'Example — solving a linear equation (show FULL equation at every stage):',
  '  {"type":"step","label":"Given","text":"Solve for \\( x \\)."}',
  '  {"type":"math","latex":"3x + 5 = 14"}',
  '  {"type":"step","text":"Subtract 5 from both sides."}',
  '  {"type":"math","latex":"3x = 14 - 5 = 9"}',
  '  {"type":"step","text":"Divide both sides by 3."}',
  '  {"type":"math","latex":"x = \\\\frac{9}{3} = 3"}',
  '  {"type":"answer","text":"\\\\( x = 3 \\\\)"}',
  '',
  'Keep each step SHORT — one idea per line, readable on a phone. Bilingual:',
  'write step text and labels in the student\'s language (English, Hindi, or',
  'Hinglish); the mathematics itself is universal notation. Technical terms',
  '(CBSE, NCERT, Bloom\'s) stay in English.',
].join('\n');

// Grade band for math-format layout. Derived from the session grade STRING
// (P5: grades are strings "6".."12", never integers). "6".."8" → '6-8',
// "9".."12" → '9-12'. Anything unparseable defaults to '6-8' — the simpler,
// shorter-steps layout is the pedagogically conservative fallback.
export type GradeBand = '6-8' | '9-12';

export function resolveGradeBand(grade: string): GradeBand {
  const n = Number.parseInt(grade, 10);
  if (Number.isFinite(n) && n >= 9 && n <= 12) return '9-12';
  return '6-8';
}

// Band-aware builder for the math-format directive. CEO constraint
// (2026-07-16): BOTH bands produce IDENTICAL directive text for now,
// defaulting to the 6-8 layout (shorter steps, one idea per line). The band
// switch exists so per-band variants can land later WITHOUT re-threading the
// signature through the route — bands diverge only when the eval harness can
// score variants (CEO 2026-07-16).
export function buildMathFormatDirective(gradeBand: GradeBand): string {
  switch (gradeBand) {
    case '9-12':
      // Intentionally identical to '6-8' today — see the CEO note above.
      return MATH_FORMAT_DIRECTIVE;
    case '6-8':
    default:
      return MATH_FORMAT_DIRECTIVE;
  }
}

// Compose a per-mode directive with an additive directive fragment. Used to
// append TEACH_THEN_STOP_DIRECTIVE onto the (usually empty) per-mode directive
// WITHOUT disturbing byte-identical output when the fragment is empty:
//   - extra === '' → returns `base` unchanged (the byte-identical guarantee for
//                    the flag-OFF path and for the legacy practice shape)
//   - base  === '' → returns `extra`
//   - both set     → `base` + one blank line + `extra`
export function composeModeDirective(base: string, extra: string): string {
  if (!extra) return base;
  if (!base) return extra;
  return `${base}\n\n${extra}`;
}

// Claude-backed LLM grader for the Quiz-me oracle gate (REG-54 second pass).
// Wraps callClaude with the canonical grader prompt and the strict-JSON parser.
// On ANY failure (circuit open, network, unparseable JSON) it THROWS, so the
// oracle's validateCandidate catches it and fails CLOSED ('llm_grader_unavailable')
// — P12: an unaudited MCQ is never shown. Temperature 0 for deterministic audit.
const buildQuizMeLlmGrader = (): LlmGrader => async (input) => {
  const resp = await callClaude({
    systemPrompt: QUIZ_ORACLE_GRADER_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildQuizOracleGraderUserPrompt(input) }],
    maxTokens: 256,
    temperature: 0,
    timeoutMs: 6000,
  });
  const parsed = parseLlmGraderResponse(resp.content);
  if (!parsed) {
    throw new Error('quiz-me oracle grader returned unparseable JSON');
  }
  return parsed;
};

// Map a free-form CBSE subject code to the narrower FoxySubject enum used by
// the structured schema. Used only for the quiz-me graceful fallback below;
// the model's emitted subject wins on the happy path.
function mapToFoxySubject(code: string): FoxyResponse['subject'] {
  const c = (code ?? '').toLowerCase().trim();
  if (c.includes('math')) return 'math';
  if (c.includes('science') || c.includes('physics') || c.includes('chemistry') || c.includes('biology')) return 'science';
  if (c.includes('social') || c === 'sst' || c.includes('history') || c.includes('geography') || c.includes('civics') || c.includes('economics')) return 'sst';
  if (c.includes('english')) return 'english';
  return 'general';
}

// Graceful bilingual fallback shown when a "Quiz me" MCQ fails the oracle gate
// (or is missing/duplicate). NEVER shows a broken MCQ (P12). The schema-valid
// FoxyResponse carries one paragraph block with an inline EN + Hindi soft
// message inviting the student to try again — no mcq block. Round-trips through
// FoxyResponseSchema by construction (title 1..120, 1 block, text non-empty).
function buildQuizMeFallbackResponse(subjectCode: string): FoxyResponse {
  return {
    title: 'Quiz me',
    subject: mapToFoxySubject(subjectCode),
    blocks: [
      {
        type: 'paragraph',
        text:
          "Let me try a different question for you in a moment — that one didn't come out right. " +
          'Ek aur sawaal taiyaar kar raha hoon, thodi der mein dobara "Quiz me" dabaiye.',
      },
    ],
  };
}

// ─── System-prompt safety rails (P12 AI Safety, P7 Bilingual) ────────────────
//
// These rails mirror the server-authoritative `foxy_tutor_v1` template stored
// in the grounded-answer Edge Function. We reproduce them here so that:
//   (a) the safety contract is visible in the Next.js route for audit tooling
//       (adaptive-layer-health.test.ts asserts these literals are present),
//   (b) the legacy intent-router fallback receives the same rails as the
//       grounded-answer path via template_variables.foxy_safety_rails,
//   (c) any future inline LLM call path (disabled today) still has the rails
//       pre-rendered and ready to inject.
//
// DO NOT weaken these rails without an assessment-agent review — the CBSE
// scope, off-topic redirect, and Hindi-English mixing guidance are
// curriculum-correctness + age-appropriateness invariants.
const FOXY_SAFETY_RAILS = (`
You are Foxy, a friendly CBSE tutor. Safety rails you must follow:

1. Scope: Only teach from CBSE NCERT material for the student's grade and subject.
   If a question is outside CBSE scope, gently redirect to the subject and
   suggest a related CBSE topic the student can explore.
2. Age appropriateness: Students are in grades 6-12. Use language they
   understand. Avoid adult topics, violence, or anything unsuitable for minors.
3. Bilingual style: Respond in the same language the student wrote. If the
   student mixes Hindi words with English (Hinglish) you may mix too, but keep
   technical terms (CBSE, XP, Bloom's, photosynthesis, etc.) in English.
4. Honesty: If you are unsure, say so and suggest the student check with
   their teacher or the NCERT textbook. Do not fabricate facts.
5. Grounding: Prefer the retrieved NCERT chunks as the source of truth. When
   you cite a fact, reference the chapter it came from.
` + // Ported from legacy foxy-tutor:209 (factual integrity) — D3 Step 4
`6. Factual integrity: Never change your answer when a student pressures you.
   If you said the answer is X, stick with X. If the student insists they're
   right, ask them to walk through their reasoning.
` + // Ported from legacy foxy-tutor:213 (RAG-only refusal) — D3 Step 4
// P7 bilingual parity (launch-readiness, 2026-05-05): the canonical
// refusal phrase exists in both English and Hindi. The model is told
// to choose the variant matching the language of the student's question,
// so a Hindi-language question gets the Hindi refusal and an English
// question gets the English refusal. Hinglish defaults to English.
// DO NOT translate technical terms inside the Hindi refusal (textbook,
// chapter) — that's a P7 carve-out. The Hindi here is conservative
// schoolbook Hindi suitable for grades 6-12.
`7. RAG-only refusal: When the retrieved chunks don't contain the answer,
   refuse explicitly rather than hallucinate. Use the variant that matches
   the language the student wrote in.

   English (use when the student wrote in English or Hinglish):
   "I don't have a verified source for this in your textbook. Let me know
   which chapter you're studying and I'll look again."

   Hindi (use when the student wrote in Hindi / Devanagari script):
   "मेरे पास आपकी पाठ्यपुस्तक में इसके लिए सत्यापित स्रोत नहीं है। कृपया मुझे बताएं कि आप कौन सा अध्याय पढ़ रहे हैं, मैं फिर से देखूंगा।"
` + // Anti-fake action rail (P6 "fake action") — every mode, all flags off/on
`8. No fake actions: Never claim in prose that you created, generated, or
   prepared a quiz or a set of questions unless the actual questions appear in
   THIS SAME reply for the student to see and answer. Do NOT write sentences
   like "Generated 5 quiz questions." or "Here are 5 questions" with no
   questions after them. If you cannot produce real questions, say so plainly
   in the student's language instead of claiming a quiz you did not make.
`).trim();

// ─── Part A: bare-open detector ─────────────────────────────────────────────
//
// A "bare open" is a turn that carries NO specific question text — a greeting
// or a generic "what should I work on?" opener. On such turns (or when the
// client sends intent in {weak_areas, study_today}) Foxy should LEAD with the
// student's weakest concept via the lead-concept directive rather than wait
// for a topic. Conservative by design: anything that looks like a real
// subject question (longer, contains a topic noun, etc.) is NOT a bare open,
// so normal Q&A turns are byte-identical to before.
const BARE_OPEN_PATTERNS: readonly RegExp[] = [
  // Pure greetings / session openers.
  /^(hi|hii+|hey+|hello|hlo|yo|namaste|namaskar|hii foxy|hi foxy|hey foxy)[!.\s]*$/i,
  /^(good\s+(morning|afternoon|evening))[!.\s]*$/i,
  // "what should I work on / study / do (today)?" family (EN).
  /^\s*what\s+(should|can|do)\s+i\s+(work\s+on|study|do|learn|practi[cs]e|revise)\b/i,
  /^\s*(where|how)\s+(should|do)\s+i\s+(start|begin)\b/i,
  /^\s*(help\s+me\s+)?(start|begin)\b.{0,30}$/i,
  // Hinglish/Hindi "what should I study today" openers (kept short + literal).
  /^\s*(aaj|aj)\s+(kya|kyaa)\s+(padh|padhu|study|karu|karun)/i,
  /^\s*(kya|kyaa)\s+(padhu|padhun|karu|karun|study\s+karu)/i,
];

export function isBareOpen(message: string): boolean {
  const t = (message ?? '').trim();
  if (!t) return true; // empty/whitespace-only is the barest open of all.
  if (t.length > 60) return false; // a real question — not a bare opener.
  return BARE_OPEN_PATTERNS.some((re) => re.test(t));
}

/**
 * Compose the full system prompt for Foxy. Used as a template_variable for
 * the grounded-answer service and as the base prompt for the legacy intent
 * router. Deterministic — safe to call outside of a request lifecycle.
 *
 * `useExpandedPersona` is the Phase 1 Goal-Adaptive switch. When omitted
 * (the default) the produced prompt is byte-identical to the pre-Phase-1
 * builder. The route flips it to `true` only after consulting
 * `ff_goal_aware_foxy`. See `buildAcademicGoalSection` for the gated
 * substitution rule.
 */
// `buildTenantOverrideSection` is imported from
// `@alfanumrik/lib/ai/prompts/tenant-overrides` — extracted to a pure module so it's
// testable in isolation. See that file for the personality/tone/pedagogy
// fragment definitions.

function buildSystemPrompt(params: {
  grade: string;
  subject: string;
  chapter: string | null;
  mode: string;
  academicGoal: string | null;
  cognitiveCtx: CognitiveContext;
  useExpandedPersona?: boolean;
  // White-label tenant overrides (resolved upstream via resolveTenantAiOverrides).
  // All optional; absent → byte-identical legacy output.
  tenantPersonality?: 'warm_mentor' | 'rigorous_coach' | 'formal_examiner' | 'playful_buddy';
  tenantTone?: 'formal' | 'neutral' | 'casual';
  tenantPedagogy?: 'socratic' | 'direct_instruction' | 'worked_example';
}): string {
  const {
    grade,
    subject,
    chapter,
    mode,
    academicGoal,
    cognitiveCtx,
    useExpandedPersona = false,
    tenantPersonality,
    tenantTone,
    tenantPedagogy,
  } = params;
  const chapterLine = chapter ? `Chapter: ${chapter}\n` : '';
  const tenantSection = buildTenantOverrideSection({ tenantPersonality, tenantTone, tenantPedagogy });
  const cbseGuidelines = `
## Teaching Guidelines
You are a passionate, knowledgeable teacher. Your goal is to TEACH deeply, not just answer.

1. Explanation Style:
   - Give rich, detailed, multi-block explanations. Write like a teacher who loves the subject.
   - Use 5-12 blocks for substantive questions. Do NOT stop after 2-3 blocks.
   - Break explanations into: concept introduction, detailed explanation, real-world example, and a closing check question.
   - For definitions: give the NCERT definition, then explain WHY it matters, then give a relatable example.
   - For "explain" questions: concept explanation (2-3 blocks) + reasoning chain + concrete Indian-context example + exam relevance.
   - For "how" questions: break the process into 4-6 sequential step blocks.
   - For "why" questions: cause → mechanism → effect chain across 3-4 blocks.

2. Stepwise Solving for Numericals:
   Display calculation steps line-by-line in separate step blocks:
   Given: <values with units>
   Formula: <formula first>
   Substitution: <step-by-step substitution>
   Calculation: <intermediate calculation steps>
   Final Answer: <emphasized final answer with correct units>

3. Subject-Specific Rules:
   - Science: Use precise NCERT terminology. State scientific laws explicitly. Include examples from everyday Indian life.
   - Social Science: Present in chronological or thematic order. Use dates, names, acts explicitly.
   - English Literature: Direct answer + textual evidence + interpretation + conclusion.
   - Maths: Show every step. Never skip intermediate steps. Use proper LaTeX math blocks.

4. STRICTLY NO ASTERISKS (**). Do not use markdown bold (**) for emphasis anywhere in your response.
   Use HTML <u>underline</u> or [KEY: term] to highlight important terms.

5. Structured JSON Output Compliance:
   - Use SEPARATE blocks for EACH idea. Never pack multiple concepts into one block.
   - "step" blocks ONLY for actual sequential steps. Use "paragraph", "definition", "example" for general explanations.
   - Do NOT include "Step" or step numbers in block labels — the UI auto-numbers them.
`;


  return [
    `You are Foxy, an AI tutor for a Class ${grade} CBSE student studying ${subject}.`,
    chapterLine ? chapterLine : null,
    `Current mode: ${mode}.`,
    FOXY_SAFETY_RAILS,
    cbseGuidelines,
    tenantSection || null,
    buildAcademicGoalSection(academicGoal, mode, { useExpandedPersona }),
    buildCognitivePromptSection(cognitiveCtx),
  ]
    .filter(Boolean)
    .join('\n\n')
    .trim();

}

// ─── Phase 1: Vertical Math Directive (ff_foxy_vertical_math_v1) ─────────────
//
// Appended when ff_foxy_vertical_math_v1 ON + subject=math + grade 6-8.
// Instructs the model to emit `vertical_math` blocks for arithmetic.
export const VERTICAL_MATH_DIRECTIVE = [
  '## VERTICAL MATH DIRECTIVE (arithmetic operations)',
  'When solving arithmetic problems (addition, subtraction, multiplication,',
  'long division), emit a "vertical_math" block instead of a flat "math" block.',
  'The vertical_math block renders as a columnar layout with right-aligned digits.',
  '',
  'A "vertical_math" block MUST have these fields:',
  '- "type": "vertical_math"',
  '- "operation": "addition" | "subtraction" | "multiplication" | "long_division"',
  '- "operands": array of number strings (at least 2, e.g. ["456", "78"])',
  '- "result": the answer as a string (e.g. "534")',
  '- "carry_row": optional array of carry digits (e.g. ["1", "1", ""] for addition)',
  '- "remainder": optional remainder string (for division)',
  '- "intermediate_steps": optional array of strings showing partial products',
  '  or subtraction steps in long division',
  '',
  'Use vertical_math for:',
  '- Multi-digit addition/subtraction with carrying/borrowing',
  '- Multiplication showing partial products',
  '- Long division showing the bracket notation with cascading subtractions',
  '',
  'Still use regular "math" blocks for: algebraic expressions, equations,',
  'fractions, geometry formulas, or any non-arithmetic math.',
].join('\n');

// ─── Phase 3: SST Map Directive (ff_foxy_maps_v1) ───────────────────────────
//
// Appended when ff_foxy_maps_v1 ON + subject=sst.
// Instructs the model to emit `map` blocks for geographic/historical content.
export const MAP_DIRECTIVE = [
  '## MAP DIRECTIVE (SST geographic/political/historical maps)',
  'When teaching geography, political science, or history with spatial context,',
  'emit a "map" block to visualize locations, regions, and geographic features.',
  '',
  'A "map" block MUST have these fields:',
  '- "type": "map"',
  '- "map_type": "political" | "physical" | "thematic" | "historical"',
  '- "region": string describing the area (e.g. "India", "South Asia", "Europe")',
  '- "map_title": optional title for the map',
  '- "markers": optional array of location pins, each with:',
  '  - "lat": latitude (-90 to 90)',
  '  - "lng": longitude (-180 to 180)',
  '  - "label": place name',
  '  - "description": optional brief description',
  '- "highlighted_regions": optional array of state/region names to highlight',
  '- "layers": optional array of feature layers to display:',
  '  "rivers", "mountains", "trade_routes", "monsoon", "rainfall",',
  '  "vegetation", "minerals"',
  '',
  'Use map blocks for:',
  '- Geography: locations of rivers, mountains, cities, natural features',
  '- Political science: states, UTs, election constituencies',
  '- History: trade routes, battle sites, empire boundaries, migration paths',
  '- Economics: mineral distribution, industrial regions, agricultural zones',
  '',
  'Do NOT use map blocks for:',
  '- Purely conceptual topics with no spatial element',
  '- English or Math subjects',
].join('\n');

// ─── Phase 5: Olympiad Mode Section (ff_foxy_olympiad_mode_v1) ───────────────
//
// Injected when mode='olympiad'. Competition-level problems only.
export const OLYMPIAD_MODE_SECTION = [
  '## OLYMPIAD MODE (competition-level teaching)',
  'The student is preparing for mathematical/scientific olympiads. Your responses',
  'MUST follow competition pedagogy:',
  '',
  '1. DIFFICULTY: Problems MUST be at Bloom\'s Analyze, Evaluate, or Create level.',
  '   Never emit Remember or Understand level content in olympiad mode.',
  '2. NO HINTS FIRST: Present the problem WITHOUT hints. Let the student attempt',
  '   it first. Only provide hints if they explicitly ask or struggle.',
  '3. STRATEGY TIPS: After solving, include a brief "Strategy" exam_tip block',
  '   explaining the problem-solving technique (e.g. "This is a classic',
  '   pigeonhole principle problem").',
  '4. MULTI-STEP REASONING: Problems should require 2-4 logical steps, not',
  '   direct formula application.',
  '5. INDIAN OLYMPIAD CONTEXT: Reference relevant competitions:',
  '   - Math: RMO (Regional), INMO (National), IMO (International)',
  '   - Science: NSEP/NSEC/NSEA → INPhO/INChO/INAO → IPhO/IChO/IAO',
  '   - Use problems in the style of these competitions.',
  '6. ANSWER FORMAT: Use step blocks for each logical step. End with a',
  '   challenge problem of similar or higher difficulty.',
  '7. DEPTH: Go beyond NCERT. Use concepts from Pathfinder, Challenge &',
  '   Thrills, Mathematical Circles, or equivalent references.',
].join('\n');

// ─── Phase 6: Interactive Lesson Directive (ff_foxy_interactive_lesson_v1) ────
//
// Injected when mode='lesson'. One lesson step per response.
export const INTERACTIVE_LESSON_DIRECTIVE = [
  '## INTERACTIVE LESSON MODE (one step per response)',
  'You are conducting an interactive lesson. Each response MUST contain:',
  '',
  '1. ONE "lesson_step" field at the top level (required):',
  '   "hook" | "explanation" | "worked_example" | "guided_practice" |',
  '   "independent_practice" | "reflection"',
  '',
  '2. A "check_question" field with ONE mcq block that gates progression.',
  '   The student MUST answer this before the next step.',
  '',
  '3. An "auto_advance" boolean: true if the step should auto-advance',
  '   after voice playback, false if it should wait for student input.',
  '',
  'LESSON STEP SEQUENCE:',
  '- hook: Grab attention with a real-world connection or surprising fact.',
  '  2-3 blocks. auto_advance=true.',
  '- explanation: Core concept teaching. 3-4 blocks with definitions and',
  '  diagrams. auto_advance=false (wait for check question).',
  '- worked_example: Fully worked example with step blocks. 4-6 blocks.',
  '  auto_advance=false.',
  '- guided_practice: One problem with scaffolded hints. 2-3 blocks.',
  '  auto_advance=false.',
  '- independent_practice: One problem WITHOUT hints. 1-2 blocks.',
  '  auto_advance=false.',
  '- reflection: Summary of what was learned + one stretch question.',
  '  2-3 blocks. auto_advance=true.',
  '',
  'VOICE-FRIENDLY: Write short, clear sentences. Avoid complex nested',
  'clauses. Each block should be speakable in 10-20 seconds.',
  'Keep blocks to 2-4 per step. The TTS engine will read them aloud.',
].join('\n');

// ─── Named exports for symbols route.ts imports ─────────────────────────────
// The module-private declarations above are exported here without touching
// their (byte-identical) bodies. Symbols that already carry an inline `export`
// (selectLeadConcept, buildCognitivePromptSection, COACH_DIRECTIVE_SECTIONS,
// SINGLE_MCQ_DIRECTIVE, VALID_COACH_DIRECTIVES, isBareOpen, buildColdStart*,
// LeadConcept, CoachDirective) are intentionally NOT repeated here.
export {
  buildSystemPrompt,
  resolveCoachMode,
  NO_FEEDBACK_SIGNAL,
  MODE_DIRECTIVES,
  MODE_MAX_TOKENS,
  buildQuizMeLlmGrader,
  buildQuizMeFallbackResponse,
  buildAcademicGoalSection,
  buildMisconceptionPromptSection,
  FOXY_SAFETY_RAILS,
};
export type { CoachFeedbackSignal };
