/**
 * ALFANUMRIK -- Daily Challenge (Concept Chain) Configuration
 *
 * Centralized constants for the daily challenge system:
 * - Subject rotation schedule (7-day cycle)
 * - Challenge coin economy (aligned with coin-rules.ts)
 * - Streak milestones and badges
 * - ZPD-based difficulty bands for chain card count
 * - Grace period and mercy day rules per grade
 *
 * All coin values must reference CHALLENGE_COINS constants.
 * Grades are always strings ("6" through "12") per P5.
 * All user-facing labels are bilingual (en + hi) per P7.
 */

// ---- Types ----

/** Configuration for a single day in the weekly rotation. */
export interface DayConfig {
  /** Subject code (valid CBSE subject or 'mixed'/'personalized'). */
  subject: string;
  /** True if Saturday -- use student's weakest subject. */
  personalized?: boolean;
  /** True if Sunday -- fun cross-subject mix. */
  mixed?: boolean;
  /** English label for the day. */
  labelEn: string;
  /** Hindi label for the day. */
  labelHi: string;
}

/** Difficulty configuration for a ZPD range. */
export interface ChallengeDifficulty {
  /** Number of base chain cards to show. */
  cardCount: number;
  /** Number of distractor cards to add. */
  distractorCount: number;
  /** Human-readable band name. */
  band: 'low' | 'medium' | 'high' | 'expert';
}

/** Internal type for ZPD difficulty mapping (includes threshold). */
export interface ZPDDifficultyEntry extends ChallengeDifficulty {
  /** Maximum ZPD value (inclusive) for this band. */
  maxZpd: number;
}

/** Streak milestone badge definition. */
export interface StreakMilestone {
  /** Number of consecutive days required. */
  days: number;
  /** Unique badge identifier. */
  badgeId: string;
  /** English badge label. */
  badgeLabel: string;
  /** Hindi badge label. */
  badgeLabelHi: string;
  /** Badge icon (emoji). */
  badgeIcon: string;
  /** Coins awarded when milestone is reached. */
  coins: number;
}

// ---- Subject Rotation (7-day cycle) ----

/**
 * Weekly subject rotation for daily challenges.
 * Key: day of week (0 = Sunday, 6 = Saturday).
 */
export const SUBJECT_ROTATION: Record<number, DayConfig> = {
  0: { subject: 'mixed', mixed: true, labelEn: 'Fun Mix Sunday', labelHi: 'मज़ेदार मिक्स रविवार' },
  1: { subject: 'math', labelEn: 'Math Monday', labelHi: 'गणित सोमवार' },
  2: { subject: 'science', labelEn: 'Science Tuesday', labelHi: 'विज्ञान मंगलवार' },
  3: { subject: 'english', labelEn: 'English Wednesday', labelHi: 'अंग्रेज़ी बुधवार' },
  4: { subject: 'social_studies', labelEn: 'Social Studies Thursday', labelHi: 'सामाजिक विज्ञान गुरुवार' },
  5: { subject: 'math', labelEn: 'Math Friday', labelHi: 'गणित शुक्रवार' },
  6: { subject: 'personalized', personalized: true, labelEn: 'Your Weakest Subject', labelHi: 'तुम्हारा सबसे कमज़ोर विषय' },
} as const;

/**
 * Returns the subject code for a given day of the week.
 * @param dayOfWeek 0 (Sunday) through 6 (Saturday)
 * @returns Subject code string, null for Saturday (personalized), 'mixed' for Sunday
 */
export function getSubjectForDay(dayOfWeek: number): string | null {
  const config = SUBJECT_ROTATION[dayOfWeek];
  if (!config) return null;
  if (config.personalized) return null;
  return config.subject;
}

// ---- Challenge Coin Economy ----

/**
 * Coin rewards for daily challenge activities.
 * These values are the source of truth for challenge coins.
 */
export const CHALLENGE_COINS = {
  /** Coins earned for solving the daily challenge. */
  solve: 15,
  /** Bonus coins for a 7-day streak. */
  streak_7_bonus: 25,
  /** Bonus coins for a 30-day streak. */
  streak_30_bonus: 100,
  /** Bonus coins for a 100-day streak. */
  streak_100_bonus: 500,
} as const;

// ---- Streak Milestones ----

/**
 * Badge milestones awarded at streak thresholds.
 * Coins match CHALLENGE_COINS streak bonuses.
 */
export const STREAK_MILESTONES: StreakMilestone[] = [
  {
    days: 7,
    badgeId: 'bronze_7',
    badgeLabel: '7-Day Streak',
    badgeLabelHi: '7 दिन की स्ट्रीक',
    badgeIcon: '\u{1F949}',
    coins: CHALLENGE_COINS.streak_7_bonus,
  },
  {
    days: 30,
    badgeId: 'silver_30',
    badgeLabel: '30-Day Streak',
    badgeLabelHi: '30 दिन की स्ट्रीक',
    badgeIcon: '\u{1F948}',
    coins: CHALLENGE_COINS.streak_30_bonus,
  },
  {
    days: 100,
    badgeId: 'gold_100',
    badgeLabel: '100-Day Streak',
    badgeLabelHi: '100 दिन की स्ट्रीक',
    badgeIcon: '\u{1F947}',
    coins: CHALLENGE_COINS.streak_100_bonus,
  },
] as const;

// ---- Grace Period ----

/**
 * Maximum number of days a streak can survive without activity
 * before being reset (using mercy days).
 */
export const GRACE_PERIOD_DAYS = 3 as const;

// ---- ZPD Difficulty Bands ----

/**
 * Maps ZPD score ranges to challenge difficulty settings.
 * Each entry defines the max ZPD for that band (inclusive),
 * the number of base cards, and distractor cards.
 */
export const ZPD_DIFFICULTY: readonly ZPDDifficultyEntry[] = [
  { maxZpd: 0.4, cardCount: 4, distractorCount: 0, band: 'low' },
  { maxZpd: 0.7, cardCount: 5, distractorCount: 0, band: 'medium' },
  { maxZpd: 0.9, cardCount: 5, distractorCount: 1, band: 'high' },
  { maxZpd: 1.0, cardCount: 5, distractorCount: 2, band: 'expert' },
] as const;

/**
 * Returns the difficulty configuration for a given ZPD score.
 * Clamps the input to [0, 1].
 * @param zpd ZPD score (0 to 1)
 * @returns ChallengeDifficulty with cardCount, distractorCount, and band
 */
export function getDifficultyForZPD(zpd: number): ChallengeDifficulty {
  const clamped = Math.max(0, Math.min(1, zpd));
  for (const entry of ZPD_DIFFICULTY) {
    if (clamped <= entry.maxZpd) {
      return { cardCount: entry.cardCount, distractorCount: entry.distractorCount, band: entry.band };
    }
  }
  // Fallback to expert (should not reach here with clamped values)
  const last = ZPD_DIFFICULTY[ZPD_DIFFICULTY.length - 1];
  return { cardCount: last.cardCount, distractorCount: last.distractorCount, band: last.band };
}

// ---- Mercy Days Per Grade ----

/**
 * Returns the number of mercy days allowed per week for a given grade.
 * Younger students (grades 6-7) get 2 mercy days; all others get 1.
 * @param grade Grade as a string ("6" through "12") per P5
 * @returns Number of mercy days per week
 */
export function getMercyDaysForGrade(grade: string): number {
  if (grade === '6' || grade === '7') return 2;
  return 1;
}

// ---- Streak Visibility Threshold ----

/**
 * Minimum streak length before it is displayed to the student.
 * Avoids showing "1-day streak" which is not motivating.
 */
export const STREAK_VISIBILITY_THRESHOLD = 3 as const;
