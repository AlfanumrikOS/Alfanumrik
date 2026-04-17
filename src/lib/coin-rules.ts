/**
 * ALFANUMRIK — Foxy Coins Economy
 *
 * Secondary currency that replaces XP as the "spendable" reward.
 * Performance Score (0-100) measures learning; Foxy Coins reward engagement.
 *
 * Design principles:
 * - Coins are earned through meaningful actions, not grinding
 * - One-time milestone rewards (score_crosses_80/90) prevent inflation
 * - Shop items are temporary boosts, not permanent plan upgrades
 * - Daily/streak bonuses encourage consistent study habits
 * - Prices set so a moderately active student earns ~1 shop item/week
 */

// ─── Coin Earning Values ─────────────────────────────────

/**
 * Foxy Coins awarded for each qualifying action.
 *
 * - quiz_complete:         Any quiz finished regardless of score
 * - first_quiz_of_day:     Bonus for the first quiz each calendar day
 * - streak_3_day:          3-day consecutive activity streak milestone
 * - streak_7_day:          7-day consecutive activity streak milestone
 * - streak_30_day:         30-day consecutive activity streak milestone
 * - revise_decaying_topic: Revisiting a topic whose retention has dropped
 * - study_task_complete:   Completing a study plan task
 * - study_plan_week:       Completing a full week of the study plan
 * - score_crosses_80:      Performance Score crosses 80 in a subject (one-time per subject)
 * - score_crosses_90:      Performance Score crosses 90 in a subject (one-time per subject)
 */
export const COIN_REWARDS = {
  quiz_complete:         10,
  first_quiz_of_day:      5,
  streak_3_day:          15,
  streak_7_day:          40,
  streak_30_day:        150,
  revise_decaying_topic:  8,
  study_task_complete:    5,
  study_plan_week:       30,
  score_crosses_80:     100,  // One-time per subject
  score_crosses_90:     200,  // One-time per subject
} as const;

export type CoinRewardId = keyof typeof COIN_REWARDS;

// ─── Foxy Coin Shop ──────────────────────────────────────
//
// Items purchasable with Foxy Coins.  Same structure as XP_REWARDS
// in xp-rules.ts: id, bilingual name/description, cost, icon, category.
//
// Business model: coins unlock temporary perks, NOT permanent plan access.
// This drives engagement + creates upgrade desire without destroying revenue.

export const COIN_SHOP = [
  {
    id: 'streak_freeze',
    name: 'Streak Freeze',
    nameHi: 'स्ट्रीक फ्रीज़',
    description: 'Protect your streak for 1 missed day',
    descriptionHi: 'एक दिन की छुट्टी से स्ट्रीक बचाएं',
    cost: 80,
    icon: '🧊',
    category: 'protection',
  },
  {
    id: 'extra_chats_5',
    name: '+5 Bonus Chats',
    nameHi: '+5 बोनस चैट',
    description: '5 extra Foxy chats today',
    descriptionHi: 'आज 5 अतिरिक्त फॉक्सी चैट',
    cost: 40,
    icon: '💬',
    category: 'boost',
  },
  {
    id: 'mock_test_unlock',
    name: 'Mock Test Pass',
    nameHi: 'मॉक टेस्ट पास',
    description: 'Unlock 1 premium mock test',
    descriptionHi: '1 प्रीमियम मॉक टेस्ट अनलॉक',
    cost: 150,
    icon: '📝',
    category: 'premium',
  },
  {
    id: 'revision_sprint',
    name: 'Revision Sprint',
    nameHi: 'रिवीज़न स्प्रिंट',
    description: 'AI-powered revision for any chapter',
    descriptionHi: 'किसी भी अध्याय का AI रिवीज़न',
    cost: 120,
    icon: '🚀',
    category: 'boost',
  },
  {
    id: 'certificate',
    name: 'Achievement Certificate',
    nameHi: 'उपलब्धि प्रमाणपत्र',
    description: 'Downloadable certificate for parents',
    descriptionHi: 'माता-पिता के लिए प्रमाणपत्र',
    cost: 250,
    icon: '🏆',
    category: 'reward',
  },
] as const;

export type CoinShopItemId = typeof COIN_SHOP[number]['id'];
