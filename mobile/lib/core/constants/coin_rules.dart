/// Foxy Coins economy for the Alfanumrik mobile app.
///
/// Secondary currency that replaces XP as the "spendable" reward.
/// Performance Score (0-100) measures learning; Foxy Coins reward engagement.
///
/// This file MUST stay in sync with web `src/lib/coin-rules.ts`.
///
/// Design principles:
/// - Coins are earned through meaningful actions, not grinding
/// - One-time milestone rewards (scoreCrosses80/90) prevent inflation
/// - Shop items are temporary boosts, not permanent plan upgrades
/// - Daily/streak bonuses encourage consistent study habits
/// - Prices set so a moderately active student earns ~1 shop item/week
library;

// ─── Coin Earning Values ─────────────────────────────────

/// Foxy Coins awarded for each qualifying action.
///
/// - [quizComplete]:         Any quiz finished regardless of score
/// - [firstQuizOfDay]:       Bonus for the first quiz each calendar day
/// - [streak3Day]:           3-day consecutive activity streak milestone
/// - [streak7Day]:           7-day consecutive activity streak milestone
/// - [streak30Day]:          30-day consecutive activity streak milestone
/// - [reviseDecayingTopic]:  Revisiting a topic whose retention has dropped
/// - [studyTaskComplete]:    Completing a study plan task
/// - [studyPlanWeek]:        Completing a full week of the study plan
/// - [scoreCrosses80]:       Performance Score crosses 80 in a subject (one-time per subject)
/// - [scoreCrosses90]:       Performance Score crosses 90 in a subject (one-time per subject)
class CoinRewards {
  CoinRewards._();

  static const int quizComplete = 10;
  static const int firstQuizOfDay = 5;
  static const int streak3Day = 15;
  static const int streak7Day = 40;
  static const int streak30Day = 150;
  static const int reviseDecayingTopic = 8;
  static const int studyTaskComplete = 5;
  static const int studyPlanWeek = 30;

  /// One-time per subject.
  static const int scoreCrosses80 = 100;

  /// One-time per subject.
  static const int scoreCrosses90 = 200;

  // Daily Challenge rewards
  static const int challengeSolve = 15;
  static const int challengeStreak7 = 25;
  static const int challengeStreak30 = 100;
  static const int challengeStreak100 = 500;
}

// ─── Foxy Coin Shop ──────────────────────────────────────
//
// Items purchasable with Foxy Coins.
// Business model: coins unlock temporary perks, NOT permanent plan access.
// This drives engagement + creates upgrade desire without destroying revenue.

/// A single item in the Foxy Coin shop.
class CoinShopItem {
  final String id;
  final String name;
  final String nameHi;
  final String description;
  final String descriptionHi;
  final int cost;
  final String icon;
  final String category;

  const CoinShopItem({
    required this.id,
    required this.name,
    required this.nameHi,
    required this.description,
    required this.descriptionHi,
    required this.cost,
    required this.icon,
    required this.category,
  });
}

/// Available items in the Foxy Coin shop.
///
/// Prices and items MUST match web `src/lib/coin-rules.ts` COIN_SHOP.
const List<CoinShopItem> coinShop = [
  CoinShopItem(
    id: 'streak_freeze',
    name: 'Streak Freeze',
    nameHi: '\u0938\u094D\u091F\u094D\u0930\u0940\u0915 \u092B\u094D\u0930\u0940\u091C\u093C',
    description: 'Protect your streak for 1 missed day',
    descriptionHi: '\u090F\u0915 \u0926\u093F\u0928 \u0915\u0940 \u091B\u0941\u091F\u094D\u091F\u0940 \u0938\u0947 \u0938\u094D\u091F\u094D\u0930\u0940\u0915 \u092C\u091A\u093E\u090F\u0902',
    cost: 80,
    icon: '\u{1F9CA}',
    category: 'protection',
  ),
  CoinShopItem(
    id: 'extra_chats_5',
    name: '+5 Bonus Chats',
    nameHi: '+5 \u092C\u094B\u0928\u0938 \u091A\u0948\u091F',
    description: '5 extra Foxy chats today',
    descriptionHi: '\u0906\u091C 5 \u0905\u0924\u093F\u0930\u093F\u0915\u094D\u0924 \u092B\u0949\u0915\u094D\u0938\u0940 \u091A\u0948\u091F',
    cost: 40,
    icon: '\u{1F4AC}',
    category: 'boost',
  ),
  CoinShopItem(
    id: 'mock_test_unlock',
    name: 'Mock Test Pass',
    nameHi: '\u092E\u0949\u0915 \u091F\u0947\u0938\u094D\u091F \u092A\u093E\u0938',
    description: 'Unlock 1 premium mock test',
    descriptionHi: '1 \u092A\u094D\u0930\u0940\u092E\u093F\u092F\u092E \u092E\u0949\u0915 \u091F\u0947\u0938\u094D\u091F \u0905\u0928\u0932\u0949\u0915',
    cost: 150,
    icon: '\u{1F4DD}',
    category: 'premium',
  ),
  CoinShopItem(
    id: 'revision_sprint',
    name: 'Revision Sprint',
    nameHi: '\u0930\u093F\u0935\u0940\u091C\u093C\u0928 \u0938\u094D\u092A\u094D\u0930\u093F\u0902\u091F',
    description: 'AI-powered revision for any chapter',
    descriptionHi: '\u0915\u093F\u0938\u0940 \u092D\u0940 \u0905\u0927\u094D\u092F\u093E\u092F \u0915\u093E AI \u0930\u093F\u0935\u0940\u091C\u093C\u0928',
    cost: 120,
    icon: '\u{1F680}',
    category: 'boost',
  ),
  CoinShopItem(
    id: 'certificate',
    name: 'Achievement Certificate',
    nameHi: '\u0909\u092A\u0932\u092C\u094D\u0927\u093F \u092A\u094D\u0930\u092E\u093E\u0923\u092A\u0924\u094D\u0930',
    description: 'Downloadable certificate for parents',
    descriptionHi: '\u092E\u093E\u0924\u093E-\u092A\u093F\u0924\u093E \u0915\u0947 \u0932\u093F\u090F \u092A\u094D\u0930\u092E\u093E\u0923\u092A\u0924\u094D\u0930',
    cost: 250,
    icon: '\u{1F3C6}',
    category: 'reward',
  ),
];
