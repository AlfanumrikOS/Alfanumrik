/**
 * ALFANUMRIK — Play framework mission configs (Phase 5 S1.6 / U7).
 *
 * The "smallest honest system": typed data that points at existing
 * mechanics. No new tables, no new engine, no new XP path. Completing a
 * mission awards NOTHING extra beyond what the underlying mechanics
 * already give (challenge coins, existing quiz XP, dive artifact, etc.).
 * Any change to that rule is a P2 violation.
 *
 * Every step references one of four already-shipped systems:
 *   • concept     → daily_challenges / quiz-chapter sequence
 *   • mystery     → phenomena slug + dive_artifacts completion
 *   • experiment  → /simulations deep link + short follow-up quiz
 *   • teach_back  → Foxy `explorer` mode with a `teach_back` preset key
 *                   (ai-engineer wires the preset into route.ts on the
 *                   Phase 4 R3-B wave; this module only DECLARES the key
 *                   so mission-configs can reference it).
 */

import type { BloomLevel } from '../cognitive-engine';

// ─── Types ───────────────────────────────────────────────────

export type MissionKind = 'concept' | 'mystery' | 'experiment' | 'teach_back';

/** CBSE grade band; string per P5 (grades are always strings "6"-"12"). */
export type GradeBand = '6-8' | '9-10' | '11-12' | '6-12';

/**
 * teach_back Foxy preset key. Declared here so mission-configs can
 * reference it before ai-engineer wires it into `apps/host/src/app/api/
 * foxy/route.ts` on the Phase 4 R3-B wave.
 */
export const TEACH_BACK_FOXY_PRESET_KEY = 'teach_back_v1' as const;
export type TeachBackFoxyPresetKey = typeof TEACH_BACK_FOXY_PRESET_KEY;

// ── Step discriminated union ─────────────────────────────────

export interface ConceptStep {
  kind: 'concept';
  /** Subject code — must be a valid CBSE code (validated by callers). */
  subject: string;
  /** NCERT chapter number for the concept-chain sequence. */
  chapterNumber: number;
  /** Target Bloom level for the quiz sequence. */
  bloomTarget: BloomLevel;
  /** How many chain items the student must complete. */
  requiredCount: number;
}

export interface MysteryStep {
  kind: 'mystery';
  /** phenomena.slug (see `20260510000000_pedagogy_v2_wave_2_phenomena_and_dive.sql`). */
  phenomenonSlug: string;
  /**
   * Whether the step requires a dive_artifacts row for this student in
   * the current ISO week (the only completion signal that exists).
   */
  requireDiveArtifact: boolean;
}

export interface ExperimentStep {
  kind: 'experiment';
  /**
   * Deep link into /simulations, e.g. `/simulations/pendulum`.
   * Kept as a string (not a route-typed object) so the config file
   * stays trivially serializable / diff-friendly.
   */
  simulationHref: string;
  /** Subject code for the follow-up quiz. */
  followupQuizSubject: string;
  followupQuizChapter: number;
  followupQuizCount: number;
}

export interface TeachBackStep {
  kind: 'teach_back';
  /** Always `TEACH_BACK_FOXY_PRESET_KEY` — a nominal handshake with route.ts. */
  foxyPresetKey: TeachBackFoxyPresetKey;
  /** Foxy runs in the existing `explorer` mode; declared for clarity. */
  foxyMode: 'explorer';
  /** Minimum student turns Foxy expects before marking the step done. */
  minStudentTurns: number;
}

export type MissionStep = ConceptStep | MysteryStep | ExperimentStep | TeachBackStep;

export interface MissionConfig {
  id: string;
  kind: MissionKind;
  title: string;
  titleHi: string;
  gradeBand: GradeBand;
  steps: MissionStep[];
}

// ─── Configs ─────────────────────────────────────────────────

/**
 * Seed mission configs. Grade 6-8 mix per the tracker guidance; each of
 * the four kinds has at least 2 examples. IDs are stable strings so
 * downstream artefacts (progress derivations, analytics events) can
 * reference them across renders.
 */
export const MISSION_CONFIGS: MissionConfig[] = [
  // ── concept ──────────────────────────────────────────────
  {
    id: 'concept.math.fractions.g6',
    kind: 'concept',
    title: 'Fractions Concept Chain',
    titleHi: 'भिन्न — अवधारणा श्रृंखला',
    gradeBand: '6-8',
    steps: [
      {
        kind: 'concept',
        subject: 'math',
        chapterNumber: 7,
        bloomTarget: 'understand',
        requiredCount: 5,
      },
    ],
  },
  {
    id: 'concept.science.matter.g7',
    kind: 'concept',
    title: 'States of Matter — Concept Chain',
    titleHi: 'द्रव्य की अवस्थाएँ — अवधारणा श्रृंखला',
    gradeBand: '6-8',
    steps: [
      {
        kind: 'concept',
        subject: 'science',
        chapterNumber: 3,
        bloomTarget: 'apply',
        requiredCount: 6,
      },
    ],
  },

  // ── mystery ──────────────────────────────────────────────
  {
    id: 'mystery.rainbow.g6-8',
    kind: 'mystery',
    title: 'Rainbow Mystery',
    titleHi: 'इंद्रधनुष का रहस्य',
    gradeBand: '6-8',
    steps: [
      {
        kind: 'mystery',
        phenomenonSlug: 'rainbow',
        requireDiveArtifact: true,
      },
    ],
  },
  {
    id: 'mystery.tides.g6-8',
    kind: 'mystery',
    title: 'Why Tides Rise and Fall',
    titleHi: 'ज्वार-भाटा क्यों उठता-गिरता है',
    gradeBand: '6-8',
    steps: [
      {
        kind: 'mystery',
        phenomenonSlug: 'tides',
        requireDiveArtifact: true,
      },
    ],
  },

  // ── experiment ───────────────────────────────────────────
  {
    id: 'experiment.pendulum.g7',
    kind: 'experiment',
    title: 'Pendulum Experiment',
    titleHi: 'लोलक प्रयोग',
    gradeBand: '6-8',
    steps: [
      {
        kind: 'experiment',
        simulationHref: '/simulations/pendulum',
        followupQuizSubject: 'science',
        followupQuizChapter: 10,
        followupQuizCount: 4,
      },
    ],
  },
  {
    id: 'experiment.circuit.g8',
    kind: 'experiment',
    title: 'Simple Circuit Experiment',
    titleHi: 'सरल परिपथ प्रयोग',
    gradeBand: '6-8',
    steps: [
      {
        kind: 'experiment',
        simulationHref: '/simulations/circuit-basics',
        followupQuizSubject: 'science',
        followupQuizChapter: 12,
        followupQuizCount: 4,
      },
    ],
  },

  // ── teach_back ───────────────────────────────────────────
  {
    id: 'teach_back.photosynthesis.g7',
    kind: 'teach_back',
    title: 'Teach Foxy: Photosynthesis',
    titleHi: 'फ़ॉक्सी को सिखाओ: प्रकाश-संश्लेषण',
    gradeBand: '6-8',
    steps: [
      {
        kind: 'teach_back',
        foxyPresetKey: TEACH_BACK_FOXY_PRESET_KEY,
        foxyMode: 'explorer',
        minStudentTurns: 3,
      },
    ],
  },
  {
    id: 'teach_back.pythagoras.g8',
    kind: 'teach_back',
    title: 'Teach Foxy: Pythagoras Theorem',
    titleHi: 'फ़ॉक्सी को सिखाओ: पाइथागोरस प्रमेय',
    gradeBand: '6-8',
    steps: [
      {
        kind: 'teach_back',
        foxyPresetKey: TEACH_BACK_FOXY_PRESET_KEY,
        foxyMode: 'explorer',
        minStudentTurns: 4,
      },
    ],
  },
];

/** Convenience finder — pure, no fallback ambiguity. */
export function getMissionConfig(id: string): MissionConfig | null {
  return MISSION_CONFIGS.find((m) => m.id === id) ?? null;
}
