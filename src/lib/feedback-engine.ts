'use client';

/**
 * ALFANUMRIK — Emotional Feedback Engine
 *
 * Provides contextual, adaptive feedback during learning sessions.
 * Combines sound, visual micro-animations, and Foxy voice lines
 * based on student's real-time emotional state.
 *
 * Psychology model:
 * - Success → validation + momentum (escalating with streaks)
 * - Failure → compassion + guidance (never punishment)
 * - Progress → satisfaction + pull-forward
 * - Consistency → identity reinforcement ("you're a learner")
 * - Near-completion → urgency + anticipation
 */

import { playSound } from './sounds';

// ─── Foxy Voice Lines ────────────────────────────────────

interface FoxyLine {
  en: string;
  hi: string;
}

// Correct answer — escalates with streak
const CORRECT_LINES: FoxyLine[][] = [
  // Streak 1 (single correct)
  [
    { en: 'Nice!', hi: 'बढ़िया!' },
    { en: 'Got it!', hi: 'सही!' },
    { en: 'Right on.', hi: 'बिल्कुल सही।' },
  ],
  // Streak 2-3
  [
    { en: 'You\'re rolling!', hi: 'चलते रहो!' },
    { en: 'Keep it going!', hi: 'बस ऐसे ही!' },
    { en: 'Solid.', hi: 'जबरदस्त।' },
  ],
  // Streak 4-5
  [
    { en: 'On fire! 🔥', hi: 'आग लगा दी! 🔥' },
    { en: 'Unstoppable!', hi: 'रोक नहीं सकते!' },
    { en: 'You really know this.', hi: 'तुम्हें ये अच्छे से आता है।' },
  ],
  // Streak 6+
  [
    { en: 'Incredible streak!', hi: 'शानदार सिलसिला!' },
    { en: 'Foxy is impressed.', hi: 'Foxy प्रभावित है।' },
    { en: 'You\'re mastering this.', hi: 'तुम इसमें माहिर हो रहे हो।' },
  ],
];

// Wrong answer — compassionate, never mocking
const WRONG_LINES: FoxyLine[][] = [
  // First wrong
  [
    { en: 'Close! Let\'s see why.', hi: 'करीब! चलो देखते हैं क्यों।' },
    { en: 'Not quite — check this.', hi: 'बिल्कुल नहीं — ये देखो।' },
    { en: 'Tricky one. Let\'s learn from it.', hi: 'मुश्किल था। इससे सीखते हैं।' },
  ],
  // Multiple wrong in a row
  [
    { en: 'This topic is tough. Let\'s slow down.', hi: 'ये कठिन है। धीरे चलते हैं।' },
    { en: 'Everyone struggles here. You\'ll get it.', hi: 'सब यहाँ अटकते हैं। तुम कर लोगे।' },
    { en: 'Take your time with this one.', hi: 'इसमें समय लो।' },
  ],
];

// Session completion
const COMPLETE_LINES: FoxyLine[] = [
  { en: 'Session complete! You showed up — that matters.', hi: 'सेशन पूरा! तुमने मेहनत की — ये मायने रखता है।' },
  { en: 'Done! Every question makes you sharper.', hi: 'हो गया! हर सवाल तुम्हें तेज़ बनाता है।' },
  { en: 'Great session! Come back tomorrow to keep the momentum.', hi: 'शानदार सेशन! कल वापस आना, रफ़्तार बनाए रखो।' },
];

// Near-completion nudge
const ALMOST_DONE_LINES: FoxyLine[] = [
  { en: 'Just 2 more! Finish strong.', hi: 'बस 2 और! मज़बूती से खत्म करो।' },
  { en: 'Almost there — don\'t stop now.', hi: 'बस पहुँचने वाले हो — अभी मत रुको।' },
  { en: 'Last stretch! You\'ve got this.', hi: 'आखिरी पड़ाव! तुमसे हो जाएगा।' },
];

// High score celebration
const HIGH_SCORE_LINES: FoxyLine[] = [
  { en: '80%+ — that\'s serious skill.', hi: '80%+ — ये असली हुनर है।' },
  { en: 'You crushed it! Bonus XP earned.', hi: 'शानदार! बोनस XP मिला।' },
];

const PERFECT_SCORE_LINES: FoxyLine[] = [
  { en: '100%! Flawless. 🏆', hi: '100%! बेमिसाल। 🏆' },
  { en: 'Perfect score! You own this topic.', hi: 'परफेक्ट स्कोर! ये तुम्हारा विषय है।' },
];

// ─── Helper ──────────────────────────────────────────────

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── Feedback State Tracker ──────────────────────────────

export interface FeedbackState {
  correctStreak: number;
  wrongStreak: number;
  totalAnswered: number;
  totalCorrect: number;
  sessionStartTime: number;
}

export function createFeedbackState(): FeedbackState {
  return {
    correctStreak: 0,
    wrongStreak: 0,
    totalAnswered: 0,
    totalCorrect: 0,
    sessionStartTime: Date.now(),
  };
}

// ─── Core Feedback Functions ─────────────────────────────

export interface FeedbackResult {
  foxyLine: FoxyLine;
  sound: 'correct' | 'incorrect' | 'streak' | 'complete' | 'levelUp';
  intensity: 'low' | 'medium' | 'high';
  showCombo: boolean;
  comboCount: number;
}

/**
 * Generate feedback for a correct answer.
 */
export function onCorrectAnswer(state: FeedbackState): FeedbackResult {
  state.correctStreak++;
  state.wrongStreak = 0;
  state.totalAnswered++;
  state.totalCorrect++;

  const streakTier = state.correctStreak <= 1 ? 0
    : state.correctStreak <= 3 ? 1
    : state.correctStreak <= 5 ? 2 : 3;

  const lines = CORRECT_LINES[streakTier];
  const isCombo = state.correctStreak >= 3;

  return {
    foxyLine: pick(lines),
    sound: isCombo ? 'streak' : 'correct',
    intensity: streakTier >= 2 ? 'high' : streakTier >= 1 ? 'medium' : 'low',
    showCombo: isCombo,
    comboCount: state.correctStreak,
  };
}

/**
 * Generate feedback for a wrong answer.
 */
export function onWrongAnswer(state: FeedbackState): FeedbackResult {
  state.correctStreak = 0;
  state.wrongStreak++;
  state.totalAnswered++;

  const tier = state.wrongStreak >= 2 ? 1 : 0;
  const lines = WRONG_LINES[tier];

  return {
    foxyLine: pick(lines),
    sound: 'incorrect',
    intensity: 'low',
    showCombo: false,
    comboCount: 0,
  };
}

/**
 * Generate feedback for session completion.
 */
export function onSessionComplete(state: FeedbackState): {
  foxyLine: FoxyLine;
  sound: 'complete' | 'levelUp';
  scoreLine?: FoxyLine;
} {
  const pct = state.totalAnswered > 0
    ? Math.round((state.totalCorrect / state.totalAnswered) * 100)
    : 0;

  let scoreLine: FoxyLine | undefined;
  if (pct === 100 && state.totalAnswered >= 5) {
    scoreLine = pick(PERFECT_SCORE_LINES);
  } else if (pct >= 80) {
    scoreLine = pick(HIGH_SCORE_LINES);
  }

  return {
    foxyLine: pick(COMPLETE_LINES),
    sound: pct >= 80 ? 'levelUp' : 'complete',
    scoreLine,
  };
}

/**
 * Check if we should show a near-completion nudge.
 */
export function getNearCompletionNudge(
  currentIndex: number,
  totalQuestions: number,
): FoxyLine | null {
  const remaining = totalQuestions - currentIndex - 1;
  if (remaining === 2 || remaining === 1) {
    return pick(ALMOST_DONE_LINES);
  }
  return null;
}

/**
 * Play the appropriate sound for a feedback result.
 */
export function playFeedbackSound(result: FeedbackResult | { sound: string }): void {
  const s = result.sound as Parameters<typeof playSound>[0];
  playSound(s);
}
