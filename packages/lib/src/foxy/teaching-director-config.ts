// packages/lib/src/foxy/teaching-director-config.ts
//
// L4 Teaching-Director CONFIG (Foxy North-Star Phase 4, 2026-08-05).
//
// The 5-mode pedagogy tree that today lives verbatim inside the grounded-
// answer inline prompt (`supabase/functions/grounded-answer/prompts/
// inline.ts` sections at lines 61-110 and 296-345) — PREREQUISITE_CHECK,
// MISCONCEPTION_REPAIR, STRETCH, SOCRATIC, NEW_TOPIC — encoded here as
// DATA rather than natural-language prompt text. The Foxy route (this
// phase: ai-engineer wires it, we OWN the shape) consumes this config to
// (a) resolve the SINGLE branch that applies this turn and (b) emit the
// pre-resolved directive via `buildDirectorPedagogySection` in
// `prompt-sections.ts` so the LLM no longer re-decides the tree per turn.
//
// ─── HARD INVARIANTS ─────────────────────────────────────────────────────
//   • PURE + DETERMINISTIC. No I/O. No Date.now. No randomness.
//   • BILINGUAL (P7): every student-facing string is authored EN + HI.
//   • Numeric thresholds NEVER duplicated — imported from
//     `@alfanumrik/lib/learner-model` (single source; SQL lockstep pinned
//     via thresholds-lockstep.test.ts).
//   • Vertical / lateral Bloom ratio (70/30) mirrors the "STRETCH default"
//     rule pinned in the grounded-answer inline prompt (line 100 / 330).
//
// Owner: assessment (values); backend (module boundary).
// Reviewers (P14): ai-engineer (wires into route), testing, quality.

import {
  FOXY_MASTERY_LOW,
  FOXY_MASTERY_HIGH,
  RETEACH_CONCEPTUAL_ERROR_MIN,
} from '@alfanumrik/lib/learner-model';

// ─── Mode vocabulary (mirrors the inline-prompt tree) ────────────────────

/** The five pedagogy modes the director can resolve to. */
export type TeachingDirectorMode =
  | 'PREREQUISITE_CHECK'
  | 'MISCONCEPTION_REPAIR'
  | 'STRETCH'
  | 'SOCRATIC'
  | 'NEW_TOPIC';

/** The three closing-question kinds the inline prompt distinguishes. */
export type ClosingQuestionKind = 'CHECK' | 'SCAFFOLD' | 'STRETCH';

// ─── Public config shape ─────────────────────────────────────────────────

export interface TeachingDirectorThresholds {
  /** mastery < masteryLow → PREREQUISITE_CHECK. Sourced from FOXY_MASTERY_LOW. */
  masteryLow: number;
  /** mastery >= masteryHigh → STRETCH. Sourced from FOXY_MASTERY_HIGH. */
  masteryHigh: number;
  /** >=N conceptual errors → MISCONCEPTION_REPAIR. Sourced from RETEACH_CONCEPTUAL_ERROR_MIN. */
  reteachConceptualErrorMin: number;
}

export interface ClosingQuestionRule {
  kind: ClosingQuestionKind;
  /** Bilingual rubric describing the required shape of the closing question (P7). */
  rubric: { en: string; hi: string };
}

/** Which closing-question kind applies in each of the 5 modes. */
export type ClosingQuestionByMode = Record<TeachingDirectorMode, ClosingQuestionKind>;

/**
 * The STRETCH mode has a Vygotsky-style vertical (one Bloom up) vs. lateral
 * (same Bloom, different domain) mix — the grounded-answer inline prompt
 * pins 70% vertical / 30% lateral at Apply and Analyze levels.
 */
export interface VerticalLateralBloomRatio {
  verticalPct: number; // 0..100
  lateralPct: number; // 0..100
  /** Only applies at these Bloom levels; other levels are always vertical. */
  appliesAt: ReadonlyArray<'apply' | 'analyze'>;
}

/**
 * Bilingual code-switching policy — Hinglish OK for warmth, technical terms
 * stay in English (P7 rule mirrored from the inline prompt persona block).
 */
export interface CodeSwitchPolicy {
  /** en/hi/hinglish — respond in the language the student wrote in. */
  matchStudentLanguage: true;
  /** Terms that must NEVER be translated (CBSE, Bloom, formula names, etc.). */
  preserveEnglishTerms: ReadonlyArray<string>;
  /** Warmth phrases the model may sprinkle (bilingual, both directions). */
  warmthPhrases: ReadonlyArray<{ en: string; hi: string }>;
}

export interface TeachingDirectorConfig {
  thresholds: TeachingDirectorThresholds;
  closingQuestionTaxonomy: Record<ClosingQuestionKind, ClosingQuestionRule>;
  /** Which of CHECK/SCAFFOLD/STRETCH the closing question follows per mode. */
  closingQuestionByMode: ClosingQuestionByMode;
  verticalLateralBloomRatio: VerticalLateralBloomRatio;
  codeSwitchPolicy: CodeSwitchPolicy;
}

// ─── The exported config ─────────────────────────────────────────────────

/**
 * The teaching-director config — single source for the 5-mode tree.
 *
 * MIRROR of grounded-answer/prompts/inline.ts sections at lines 61-110
 * (FOXY_TUTOR_V1 pedagogy rules) and 296-345 (FOXY_TUTOR_TEACH_V1). Change
 * a value here → the mirror-drift snapshot in
 * `__tests__/foxy/teaching-director-config-drift.test.ts` fires and points
 * you at the inline-prompt lines that need parallel edits.
 */
export const TEACHING_DIRECTOR_CONFIG: TeachingDirectorConfig = {
  thresholds: {
    masteryLow: FOXY_MASTERY_LOW,
    masteryHigh: FOXY_MASTERY_HIGH,
    reteachConceptualErrorMin: RETEACH_CONCEPTUAL_ERROR_MIN,
  },
  closingQuestionTaxonomy: {
    CHECK: {
      kind: 'CHECK',
      rubric: {
        en: 'Apply the just-taught idea to a new tiny example. NEVER ask "did you understand?"',
        hi: 'अभी सिखाए विचार को एक नए छोटे उदाहरण पर लागू करने को कहें। "समझ आया?" कभी न पूछें।',
      },
    },
    SCAFFOLD: {
      kind: 'SCAFFOLD',
      rubric: {
        en: 'Ask about the NEXT sub-step in the chain. Concrete, not abstract.',
        hi: 'श्रृंखला के अगले उप-चरण के बारे में पूछें। ठोस, अमूर्त नहीं।',
      },
    },
    STRETCH: {
      kind: 'STRETCH',
      rubric: {
        en: 'One Bloom level higher than the original. Specific, with stakes ("how would this change if...").',
        hi: 'मूल से एक Bloom स्तर ऊँचा। ठोस, दांव के साथ ("यदि... तो यह कैसे बदलेगा?").',
      },
    },
  },
  // Modal scoping mirrors inline.ts line 103: CHECK/SCAFFOLD/STRETCH apply
  // to MISCONCEPTION_REPAIR, STRETCH, SOCRATIC, NEW_TOPIC. In
  // PREREQUISITE_CHECK, the prerequisite question IS the closing question.
  closingQuestionByMode: {
    PREREQUISITE_CHECK: 'SCAFFOLD', // the prereq check itself satisfies the closing-Q rule
    MISCONCEPTION_REPAIR: 'CHECK',
    STRETCH: 'STRETCH',
    SOCRATIC: 'SCAFFOLD',
    NEW_TOPIC: 'CHECK',
  },
  verticalLateralBloomRatio: {
    verticalPct: 70,
    lateralPct: 30,
    appliesAt: ['apply', 'analyze'],
  },
  codeSwitchPolicy: {
    matchStudentLanguage: true,
    preserveEnglishTerms: [
      'CBSE',
      'NCERT',
      'XP',
      'Bloom',
      'photosynthesis',
      'integers',
    ],
    warmthPhrases: [
      { en: "Let's go!", hi: 'Bilkul!' },
      { en: "Let's see", hi: 'Chalo dekhte hain' },
    ],
  },
};

// ─── Depth-ceiling ordering (mirrors teaching-director.ts) ───────────────
//
// The Bloom-depth ceiling stays owned by teaching-director.ts (persona
// depthCeiling → max Bloom). Re-exporting the mode/kind unions here so the
// prompt-sections renderer can pattern-match without importing the whole
// director module (which pulls the cognitive-engine graph).

export const TEACHING_DIRECTOR_MODES: ReadonlyArray<TeachingDirectorMode> = [
  'PREREQUISITE_CHECK',
  'MISCONCEPTION_REPAIR',
  'STRETCH',
  'SOCRATIC',
  'NEW_TOPIC',
];
