/**
 * ALFANUMRIK — XP Economy Rules
 *
 * Centralized XP earning values, caps, and redemption thresholds.
 * All XP awards must reference these constants.
 *
 * Design principles:
 * - Reward meaningful learning, not spam
 * - Daily caps prevent inflation
 * - Streak bonuses encourage consistency
 * - Redemption drives upgrades without replacing paid plans
 */

// ─── XP Earning Values ────────────────────────────────────

export const XP_RULES = {
  // Foxy AI Tutor
  foxy_chat: 5,              // Per meaningful interaction (server-controlled)
  foxy_chat_daily_cap: 50,   // Max 10 chats earn XP per day

  // Quizzes
  quiz_per_correct: 10,      // Per correct answer
  quiz_high_score_bonus: 20, // Bonus if score >= 80%
  quiz_perfect_bonus: 50,    // Bonus if score = 100%
  quiz_daily_cap: 200,       // Max quiz XP per day

  // Streaks
  streak_daily: 10,          // Daily login/activity bonus
  streak_7_day_bonus: 25,    // 7-day streak milestone
  streak_30_day_bonus: 100,  // 30-day streak milestone
  streak_100_day_bonus: 500, // 100-day streak milestone

  // Learning milestones
  chapter_complete: 50,      // Finishing all topics in a chapter
  topic_mastered: 30,        // Reaching mastery on a topic
  first_quiz_of_day: 10,     // Bonus for first quiz each day

  // Study plan
  study_task_complete: 8,    // Completing a study plan task
  study_plan_week: 40,       // Completing a full week of study plan
} as const;

// ─── Level Calculation ────────────────────────────────────

export const XP_PER_LEVEL = 500;

export function calculateLevel(totalXp: number): number {
  return Math.floor(totalXp / XP_PER_LEVEL) + 1;
}

export function xpToNextLevel(totalXp: number): { current: number; needed: number; progress: number } {
  const currentLevelXp = totalXp % XP_PER_LEVEL;
  return {
    current: currentLevelXp,
    needed: XP_PER_LEVEL,
    progress: Math.round((currentLevelXp / XP_PER_LEVEL) * 100),
  };
}

// ─── Level Names ──────────────────────────────────────────

export const LEVEL_NAMES: Record<number, string> = {
  1: 'Curious Cub',
  2: 'Quick Learner',
  3: 'Rising Star',
  4: 'Knowledge Seeker',
  5: 'Smart Fox',
  6: 'Quiz Champion',
  7: 'Study Master',
  8: 'Brain Ninja',
  9: 'Scholar Fox',
  10: 'Grand Master',
};

export function getLevelName(level: number): string {
  if (level >= 10) return LEVEL_NAMES[10];
  return LEVEL_NAMES[level] || `Level ${level}`;
}

// ─── XP Redemption Catalog ───────────────────────────────
// Business model: XP unlocks temporary premium perks, NOT permanent plan changes.
// This drives engagement + creates upgrade desire without destroying revenue.

export const XP_REWARDS = [
  {
    id: 'streak_freeze',
    name: 'Streak Freeze',
    nameHi: 'स्ट्रीक फ्रीज़',
    description: 'Protect your streak for 1 missed day',
    descriptionHi: 'एक दिन की छुट्टी से स्ट्रीक बचाएं',
    cost: 100,
    icon: '🧊',
    category: 'protection',
  },
  {
    id: 'extra_chats_5',
    name: '+5 Bonus Chats',
    nameHi: '+5 बोनस चैट',
    description: '5 extra Foxy chats today',
    descriptionHi: 'आज 5 अतिरिक्त फॉक्सी चैट',
    cost: 50,
    icon: '💬',
    category: 'boost',
  },
  {
    id: 'mock_test_unlock',
    name: 'Mock Test Pass',
    nameHi: 'मॉक टेस्ट पास',
    description: 'Unlock 1 premium mock test',
    descriptionHi: '1 प्रीमियम मॉक टेस्ट अनलॉक',
    cost: 200,
    icon: '📝',
    category: 'premium',
  },
  {
    id: 'revision_sprint',
    name: 'Revision Sprint',
    nameHi: 'रिवीज़न स्प्रिंट',
    description: 'AI-powered revision for any chapter',
    descriptionHi: 'किसी भी अध्याय का AI रिवीज़न',
    cost: 150,
    icon: '🚀',
    category: 'boost',
  },
  {
    id: 'certificate',
    name: 'Achievement Certificate',
    nameHi: 'उपलब्धि प्रमाणपत्र',
    description: 'Downloadable certificate for parents',
    descriptionHi: 'माता-पिता के लिए प्रमाणपत्र',
    cost: 300,
    icon: '🏆',
    category: 'reward',
  },
] as const;

export type XPRewardId = typeof XP_REWARDS[number]['id'];
