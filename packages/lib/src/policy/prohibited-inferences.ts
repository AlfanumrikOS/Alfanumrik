/**
 * Prohibited Inferences policy module (Foxy North-Star Phase 1 — PR1..PR5).
 *
 * SINGLE SOURCE OF TRUTH for the "describe evidence, never judge identity"
 * denylist (spec §1.4, docs/superpowers/specs/
 * 2026-08-05-foxy-north-star-alignment-design.md). Consumed by:
 *   - Foxy system prompts (rail 9 in FOXY_SAFETY_RAILS, via
 *     PROHIBITED_INFERENCES_PROMPT_SECTION),
 *   - the safeguarding Tier-2 classifier (NO_DIAGNOSIS_BOUNDARY_NOTE),
 *   - the alignment analyzer's check 8e banned-phrase lint, which SOURCE-PARSES
 *     the `bannedPhrases: [...]` arrays out of THIS file
 *     (scripts/foxy-alignment/analyze.mjs — REG-48 SQL/TS-parity pattern).
 *
 * ⚠️ FORMAT CONTRACT for the analyzer parser (pinned by
 * packages/lib/src/__tests__/policy/prohibited-inferences.test.ts):
 *   - every banned phrase lives in a `bannedPhrases: [ ... ]` array literal in
 *     this file, one single-quoted string per phrase, NO computed entries;
 *   - phrases are lowercase; matching is case-insensitive substring.
 * If you restructure this file, run the parity test AND
 * `node scripts/foxy-alignment/analyze.mjs` in the same change.
 *
 * P13: pure data + pure string scan; nothing here logs or transmits text.
 * Owner: ai-engineer. Content changes reviewed by assessment (curriculum/
 * age-appropriateness) — this is student-facing-copy policy.
 */

/**
 * Category ids from the North-Star spec §1.4 "Prohibited data and inferences".
 * NOTE: these are the spec's PR-namespace ids, NOT product invariants.
 */
export type ProhibitedInferenceCategory = 'PR1' | 'PR2' | 'PR3' | 'PR4' | 'PR5';

export interface ProhibitedInference {
  /** Human title of the prohibition (spec §1.4 row). */
  title: string;
  /**
   * The rule as injected into system prompts — imperative, model-directed,
   * age-appropriate (grades 6-12), evidence-language-only.
   */
  promptRule: string;
  /**
   * Literal phrases that must NEVER appear in student-facing copy or model
   * output about a student. Lowercase; matched case-insensitively as
   * substrings. Empty where the prohibition is behavioral, not phrasal
   * (PR3/PR4/PR5 are enforced by code guards + prompt rules, not a lint list).
   */
  bannedPhrases: string[];
}

export const PROHIBITED_INFERENCES: Record<ProhibitedInferenceCategory, ProhibitedInference> = {
  // PR1 — identity/intelligence labels. The lint list bans judgment-of-identity
  // phrasings; evidence language ("3 errors on this concept this week",
  // "low current mastery on this topic") is the required replacement.
  PR1: {
    title: 'No intelligence or personality labels',
    promptRule:
      'Never label a student\'s intelligence, ability, or personality. ' +
      'Describe observable evidence ("you missed 3 questions on this concept ' +
      'this week", "your mastery of this topic is still growing") — never ' +
      'judge identity ("weak student", "slow learner"). Progress language ' +
      'only: every gap is a topic-level, temporary state, not a trait.',
    bannedPhrases: [
      'weak student',
      'slow learner',
      'low intelligence',
      'you are weak',
      'struggling student',
      'dull student',
      'lazy student',
      'not smart enough',
      'below average student',
      'you are not intelligent',
      // Hindi/Hinglish identity labels (assessment-mandated 2026-08-05, P7).
      // Devanagari has no case; toLowerCase() is identity, so the lowercase
      // format contract holds. Matching stays case-insensitive substring.
      'kamzor student',
      'कमज़ोर छात्र',
      'कमज़ोर बच्चा',
      'मंदबुद्धि',
      'तुम कमज़ोर हो',
    ],
  },
  // PR2 — mental-health diagnoses. Foxy is a tutor, not a clinician: it may
  // acknowledge feelings and route to safeguarding, but must never name a
  // condition the student "has". Second-person diagnosis phrasings only —
  // academic mentions of these conditions in curriculum content are NOT
  // banned (hence no bare 'adhd' / 'depression' entries).
  PR2: {
    title: 'No mental-health diagnoses',
    promptRule:
      'Never diagnose, name, or speculate about a mental-health or ' +
      'neurodevelopmental condition the student might have (e.g. ADHD, ' +
      'depression, anxiety disorder, dyslexia). You may acknowledge feelings ' +
      'in plain words ("this sounds really stressful") and encourage the ' +
      'student to talk to a trusted adult, teacher, or counsellor.',
    bannedPhrases: [
      'you have adhd',
      'you have dyslexia',
      'you have depression',
      'you are depressed',
      'you have anxiety',
      'depression diagnosis',
      'mentally ill',
      // Hindi/Hinglish second-person diagnosis phrasings (assessment-mandated
      // 2026-08-05, P7). Still NO bare condition names — curriculum content
      // mentions them in the third person.
      'tumhe depression hai',
      'तुम्हें डिप्रेशन है',
      'आपको डिप्रेशन है',
      'tumhe adhd hai',
    ],
  },
  // PR3 — behavioral prohibition (no passive camera/mic observation). Enforced
  // in code by analyzer check 8d (the browser media-capture API is allowed only
  // under explicit voice/scan routes — the API name is deliberately not spelled
  // out here, check 8d greps for it); the prompt rule bans the model from
  // CLAIMING observation.
  PR3: {
    title: 'No passive camera or microphone observation',
    promptRule:
      'Never claim to see, hear, or watch the student. You only receive what ' +
      'the student explicitly types, taps, or submits. Camera and microphone ' +
      'are used only when the student deliberately starts a voice or scan ' +
      'action.',
    bannedPhrases: [],
  },
  // PR4 — private emotions unrelated to learning. Mood check-ins are
  // student-initiated and learning-scoped; the model must not probe further.
  PR4: {
    title: 'No probing of irrelevant private emotions',
    promptRule:
      'Do not probe the student\'s private feelings, family life, or ' +
      'relationships beyond what the student volunteers and what is needed to ' +
      'support their learning. A mood check-in is context, never an ' +
      'interrogation topic.',
    bannedPhrases: [],
  },
  // PR5 — sensitive conversations only with safeguarding purpose. The
  // safeguarding flow (S5.6/U6) is the ONLY sanctioned lane for sensitive
  // disclosures; the model must route there, not free-chat about them.
  PR5: {
    title: 'Sensitive conversations only with a safeguarding purpose',
    promptRule:
      'If a student discloses harm, danger, or acute distress, respond with ' +
      'care, encourage them to talk to a trusted adult, and follow the ' +
      'safeguarding guidance you are given. Never carry on an extended ' +
      'sensitive conversation for any other purpose, and never promise ' +
      'secrecy about safety concerns.',
    bannedPhrases: [],
  },
};

/**
 * Deterministic category order for prompt rendering + list flattening.
 * (Object key order would already be insertion order, but the join is a prompt
 * artifact pinned by tests — keep it explicit.)
 */
const CATEGORY_ORDER: readonly ProhibitedInferenceCategory[] = ['PR1', 'PR2', 'PR3', 'PR4', 'PR5'];

/** Flattened, de-duplicated denylist across all categories (lowercase). */
export const ALL_BANNED_PHRASES: readonly string[] = Object.freeze([
  ...new Set(CATEGORY_ORDER.flatMap((c) => PROHIBITED_INFERENCES[c].bannedPhrases)),
]);

/**
 * The prompt-injectable section (deterministic join of every promptRule plus
 * the phrase denylist). Consumed as rail 9 of FOXY_SAFETY_RAILS — DO NOT
 * weaken without an assessment review (P12).
 */
export const PROHIBITED_INFERENCES_PROMPT_SECTION: string = [
  ...CATEGORY_ORDER.map(
    (c) => `- ${PROHIBITED_INFERENCES[c].title}: ${PROHIBITED_INFERENCES[c].promptRule}`,
  ),
  `   Never use these phrases (or close variants) about a student: ${ALL_BANNED_PHRASES.map((p) => `"${p}"`).join(', ')}.`,
].join('\n');

/**
 * Diagnosis boundary for the safeguarding Tier-2 classifier (PR2): the
 * classifier triages risk categories, it does NOT diagnose. Imported by
 * packages/lib/src/ai/validation/safeguarding-classify.ts.
 */
export const NO_DIAGNOSIS_BOUNDARY_NOTE: string =
  'BOUNDARY (PR2 — no diagnoses): you are a safety TRIAGE step, not a ' +
  'clinician. Never produce diagnosis language, condition names the student ' +
  '"has", or clinical assessments. Classify the message into the given risk ' +
  'categories only.';

/**
 * Pure banned-phrase scan. Returns every banned phrase present in `text`
 * (case-insensitive substring match), in denylist order; empty array for
 * clean/empty/non-string input. Never throws — this runs inside response
 * post-processing where a scanner crash must not break the student's turn
 * (same fail-open rationale as input-guard.ts: downstream rails remain).
 *
 * P13: pure transform — callers log counts/booleans only, never the text.
 */
export function findProhibitedPhrases(text: string): string[] {
  try {
    if (typeof text !== 'string' || text.length === 0) return [];
    const lower = text.toLowerCase();
    return ALL_BANNED_PHRASES.filter((phrase) => lower.includes(phrase));
  } catch {
    return [];
  }
}
