/**
 * Foxy conversation-starter intent registry.
 *
 * Why this file exists
 * --------------------
 * Prior to PR #5xx (P0 chip-action fix, 2026-05-04), `ConversationStarters`
 * sent the chip *label* ("Quiz", "Formula sheet", ...) to /api/foxy as a raw
 * user message. The API route then had to keyword-match the label to figure
 * out what the student wanted. Three concrete bugs fell out of this:
 *   1. "Quiz" → keyword-matched as a chat turn, never routed to /quiz, so
 *      P4 (atomic submission) and REG-54 (validation oracle) were bypassed.
 *   2. "Formula sheet" → unconstrained prompt to Foxy → P12 hallucination
 *      risk, since the model invents formulas not in NCERT.
 *   3. "Explain last topic" → shown even on first session with no last topic.
 *
 * The fix is to attach an explicit `intent` to every chip. The client uses
 * the intent to dispatch (router.push for /quiz and /stem-centre, mastery-
 * tagged sendMessage for weak_areas/study_today, constrained prompt for
 * formulas). The server uses the intent to enrich the prompt with student
 * mastery rows when relevant.
 *
 * Telemetry is fired on every chip click via the `foxy_starter_clicked`
 * event so the Founder/CEO can see which chips drive engagement.
 *
 * Bilingual (P7): every chip carries `text` (EN) AND `textHi` (HI). The
 * UI picks the right one off `language === 'hi'`.
 */

export type StarterIntent =
  | 'teach'
  | 'study_today'
  | 'quiz'
  | 'explain_last'
  | 'formulas'
  | 'weak_areas'
  | 'experiment'
  | 'real_world'
  | 'diagram';

export interface StarterConfig {
  /** Visible icon on the chip. Emoji preferred for cross-platform parity. */
  icon: string;
  /** English label. */
  text: string;
  /** Hindi label (P7 — bilingual chip). */
  textHi: string;
  /** Dispatch hint. See StarterIntent for the union. */
  intent: StarterIntent;
}

/**
 * Universal starters — shown on every subject. Order matters: the first
 * 4 land in the visible primary slot when the user enters a fresh chat.
 *
 * NOTE: The `explain_last` chip is filtered out at render time when the
 * chat has no prior topic context (see `hasLastTopic` prop on
 * ConversationStarters). Showing "Explain last topic" on a first-ever
 * session was a cited UX bug.
 */
export const UNIVERSAL_STARTERS: StarterConfig[] = [
  {
    icon: '\u{1F4DA}',
    text: 'What should I study today?',
    textHi: 'आज मुझे क्या पढ़ना चाहिए?',
    intent: 'study_today',
  },
  {
    icon: '\u{1F4DD}',
    text: 'Quiz',
    textHi: 'क्विज़',
    intent: 'quiz',
  },
  {
    icon: '\u{1F4D6}',
    text: 'Explain last topic',
    textHi: 'पिछला टॉपिक समझाओ',
    intent: 'explain_last',
  },
  {
    icon: '\u{1F4CB}',
    text: 'Formula sheet',
    textHi: 'फॉर्मूला शीट',
    intent: 'formulas',
  },
  {
    icon: '\u{1F3AF}',
    text: 'My weak areas',
    textHi: 'मेरे कमज़ोर विषय',
    intent: 'weak_areas',
  },
];

/**
 * Subject-specific starters. Keyed by the subject `code` used everywhere
 * else (math, science, physics, chemistry, biology, english, hindi,
 * social_studies, coding). Each entry gets one of the topical intents
 * (experiment, real_world, diagram). Anything that doesn't map cleanly
 * onto those three falls back to `teach` and is sent through Foxy.
 */
export const SUBJECT_STARTERS: Record<string, StarterConfig[]> = {
  math: [
    { icon: '\u{1F9EE}', text: 'Solve step by step', textHi: 'स्टेप बाय स्टेप हल करो', intent: 'teach' },
    { icon: '\u{1F4CA}', text: 'Visual explanation', textHi: 'चित्र से समझाओ', intent: 'diagram' },
    { icon: '✏️', text: 'Practice problems', textHi: 'अभ्यास प्रश्न दो', intent: 'teach' },
  ],
  science: [
    { icon: '\u{1F52C}', text: 'Explain with an experiment', textHi: 'प्रयोग से समझाओ', intent: 'experiment' },
    { icon: '\u{1F30D}', text: 'Real-world example', textHi: 'असली उदाहरण दो', intent: 'real_world' },
    { icon: '\u{1F5BC}️', text: 'Diagram explanation', textHi: 'चित्र से समझाओ', intent: 'diagram' },
  ],
  physics: [
    { icon: '⚡', text: 'Derive the formula', textHi: 'सूत्र व्युत्पन्न करो', intent: 'teach' },
    { icon: '\u{1F522}', text: 'Numerical problem', textHi: 'संख्यात्मक प्रश्न', intent: 'teach' },
    { icon: '\u{1F4A1}', text: 'Explain with analogy', textHi: 'उदाहरण से समझाओ', intent: 'real_world' },
  ],
  chemistry: [
    { icon: '⚖️', text: 'Balance this equation', textHi: 'समीकरण संतुलित करो', intent: 'teach' },
    { icon: '\u{1F9EA}', text: 'Explain the reaction', textHi: 'अभिक्रिया समझाओ', intent: 'teach' },
    { icon: '\u{1F9E0}', text: 'Memory tricks', textHi: 'याद करने की ट्रिक', intent: 'teach' },
  ],
  biology: [
    { icon: '\u{1F9EC}', text: 'Explain the process', textHi: 'प्रक्रिया समझाओ', intent: 'teach' },
    { icon: '⚖️', text: 'Compare and contrast', textHi: 'तुलना करो', intent: 'teach' },
    { icon: '\u{1F3F7}️', text: 'Diagram labels', textHi: 'चित्र के लेबल', intent: 'diagram' },
  ],
  english: [
    { icon: '✔️', text: 'Grammar check', textHi: 'व्याकरण जाँचो', intent: 'teach' },
    { icon: '\u{1F4DD}', text: 'Essay outline', textHi: 'निबंध की रूपरेखा', intent: 'teach' },
    { icon: '\u{1F4DA}', text: 'Vocabulary builder', textHi: 'शब्दावली बनाओ', intent: 'teach' },
  ],
  hindi: [
    { icon: '✏️', text: 'व्याकरण अभ्यास', textHi: 'व्याकरण अभ्यास', intent: 'teach' },
    { icon: '\u{1F4D6}', text: 'कविता का भावार्थ', textHi: 'कविता का भावार्थ', intent: 'teach' },
    { icon: '✏️', text: 'पत्र लेखन', textHi: 'पत्र लेखन', intent: 'teach' },
  ],
  social_studies: [
    { icon: '\u{1F4C5}', text: 'Timeline of events', textHi: 'घटनाओं की समयरेखा', intent: 'teach' },
    { icon: '\u{1F5FA}️', text: 'Map-based question', textHi: 'मानचित्र प्रश्न', intent: 'teach' },
    { icon: '\u{1F517}', text: 'Cause and effect', textHi: 'कारण और प्रभाव', intent: 'teach' },
  ],
  coding: [
    { icon: '\u{1F41B}', text: 'Debug my code', textHi: 'मेरा कोड ठीक करो', intent: 'teach' },
    { icon: '\u{1F4A1}', text: 'Explain this concept', textHi: 'यह कॉन्सेप्ट समझाओ', intent: 'teach' },
    { icon: '\u{1F4BB}', text: 'Write a program', textHi: 'प्रोग्राम लिखो', intent: 'teach' },
  ],
};

/** All 9 intent codes. Exported for tests. */
export const ALL_STARTER_INTENTS: readonly StarterIntent[] = [
  'teach',
  'study_today',
  'quiz',
  'explain_last',
  'formulas',
  'weak_areas',
  'experiment',
  'real_world',
  'diagram',
] as const;

/**
 * Mastery hints supplied by the IRT-driven `/api/foxy/suggest-prompts`
 * endpoint (RCA-FIX RC-17/RC-18, 2026-06-26). When present, `buildStarters`
 * prepends up to 3 personalised chips before the static universal+subject set.
 *
 * All fields are optional so a partial response (e.g. only `nextAction`) still
 * produces useful chips. When the object is absent or all fields are empty the
 * output is identical to the pre-personalisation behaviour.
 */
export interface MasteryHints {
  /** Topics with mastery_probability < 0.6, ordered weakest-first. */
  weakTopics?: Array<{ title: string; mastery: number }>;
  /** Topics whose next_review_date has passed, ordered most-overdue-first. */
  overdueTopics?: Array<{ title: string; daysOverdue: number }>;
  /** CME recommended next concept (from quiz_sessions.cme_next_action). */
  nextAction?: { conceptName: string } | null;
  /** Bloom's complexity hint derived from avg mastery of the above rows. */
  bloomHint?: 'remember' | 'understand' | 'apply' | 'analyze';
}

/**
 * Private helper — static chip logic extracted from the original buildStarters.
 * Unchanged behaviour: universal starters (filtered by hasLastTopic) followed
 * by subject-specific starters, with an optional "Teach me: <topic>" prepended.
 */
function buildStaticStarters(
  subject: string,
  topicTitle?: string | null,
  hasLastTopic?: boolean,
): StarterConfig[] {
  const subjectSpecific = SUBJECT_STARTERS[subject] ?? [];

  const universals = hasLastTopic
    ? UNIVERSAL_STARTERS
    : UNIVERSAL_STARTERS.filter((s) => s.intent !== 'explain_last');

  const starters: StarterConfig[] = [...universals, ...subjectSpecific];

  if (topicTitle) {
    starters.unshift({
      icon: '\u{1F4D6}',
      text: `Teach me: ${topicTitle}`,
      textHi: `सिखाओ: ${topicTitle}`,
      intent: 'teach',
    });
  }

  return starters;
}

/**
 * Build the visible chip list for a given subject + context.
 *
 * Priority order (so the most-useful chips never get truncated):
 *   1. Personalised chips from IRT mastery data (up to 3, when masteryHints
 *      is provided and has data):
 *      a. CME next action — what the system recommends studying next.
 *      b. Most-overdue revision topic (spaced-repetition due date passed).
 *      c. Weakest topic (lowest mastery_probability).
 *   2. If a topic is selected, prepend a "Teach me: <topic>" chip.
 *   3. Universal starters (filtered to drop `explain_last` if no last topic).
 *   4. Subject-specific starters.
 *
 * When masteryHints is absent or all arrays are empty the output is identical
 * to the pre-personalisation behaviour — zero regression risk for new students
 * or when the suggest-prompts API returns empty data.
 *
 * Soft ceiling: 12 chips. The UI's "More" toggle hides everything past the
 * primary 3 by default for Hick's Law compliance.
 */
export function buildStarters(opts: {
  subject: string;
  topicTitle?: string | null;
  hasLastTopic: boolean;
  /** IRT-driven mastery hints from /api/foxy/suggest-prompts. Optional. */
  masteryHints?: MasteryHints;
}): StarterConfig[] {
  const { subject, topicTitle, hasLastTopic, masteryHints } = opts;

  // ── Personalised chips (prepended when mastery data is available) ───────────
  const personalizedChips: StarterConfig[] = [];

  // Priority 1: CME next action (what the system recommends studying next)
  if (masteryHints?.nextAction?.conceptName) {
    personalizedChips.push({
      icon: '▶️', // ▶️
      text: `Continue: ${masteryHints.nextAction.conceptName}`,
      textHi: `जारी रखें: ${masteryHints.nextAction.conceptName}`,
      intent: 'teach',
    });
  }

  // Priority 2: Overdue revision (spaced repetition due date has passed)
  const firstOverdue = masteryHints?.overdueTopics?.[0];
  if (firstOverdue && personalizedChips.length < 2) {
    const daysText =
      firstOverdue.daysOverdue === 1 ? '1 day' : `${firstOverdue.daysOverdue} days`;
    personalizedChips.push({
      icon: '\u{1F4C5}', // 📅
      text: `Revise: ${firstOverdue.title} (${daysText} overdue)`,
      textHi: `दोबारा पढ़ें: ${firstOverdue.title} (${daysText} बाकी)`,
      intent: 'explain_last',
    });
  }

  // Priority 3: Weakest topic (lowest mastery probability)
  const weakest = masteryHints?.weakTopics?.[0];
  if (weakest && personalizedChips.length < 3) {
    const masteryPct = Math.round(weakest.mastery * 100);
    personalizedChips.push({
      icon: '\u{1F534}', // 🔴
      text: `Practice: ${weakest.title} (${masteryPct}% mastered)`,
      textHi: `अभ्यास: ${weakest.title} (${masteryPct}% माहिर)`,
      intent: 'quiz',
    });
  }

  // ── Static chips (unchanged behaviour) ────────────────────────────────────
  const staticChips = buildStaticStarters(subject, topicTitle, hasLastTopic);

  // Soft ceiling: 12 chips. Personalised chips land first so they are always
  // visible before the "More" toggle truncates the tail.
  return [...personalizedChips, ...staticChips].slice(0, 12);
}
