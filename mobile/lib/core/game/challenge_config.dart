// Daily Challenge (Concept Chain) configuration — pure Dart port of
// `packages/lib/src/challenge-config.ts`. Keep in sync with that file.
//
// Coin values are NOT redefined here — they read straight off
// `CoinRewards` in `core/constants/coin_rules.dart` (`challengeSolve` /
// `challengeStreak7/30/100`), which already mirrors web's `CHALLENGE_COINS`
// exactly. This avoids a second hardcoded copy of the same numbers drifting
// out of sync with web (see the class doc on `CoinRewards`).
//
// Grades are always strings ("6" through "12") per P5.
// All user-facing labels are bilingual (en + hi) per P7.
library;

import '../constants/coin_rules.dart';
import '../../data/models/challenge_models.dart';

// ---- Subject Rotation (7-day cycle) ----

/// Configuration for a single day in the weekly rotation.
class DayConfig {
  final String subject;
  final bool personalized;
  final bool mixed;
  final String labelEn;
  final String labelHi;

  const DayConfig({
    required this.subject,
    this.personalized = false,
    this.mixed = false,
    required this.labelEn,
    required this.labelHi,
  });
}

/// Weekly subject rotation for daily challenges.
/// Key: day of week (0 = Sunday, 6 = Saturday) — matches `DateTime.weekday`
/// mod 7 via [dartWeekdayToJs].
const Map<int, DayConfig> kSubjectRotation = <int, DayConfig>{
  0: DayConfig(subject: 'mixed', mixed: true, labelEn: 'Fun Mix Sunday', labelHi: 'मज़ेदार मिक्स रविवार'),
  1: DayConfig(subject: 'math', labelEn: 'Math Monday', labelHi: 'गणित सोमवार'),
  2: DayConfig(subject: 'science', labelEn: 'Science Tuesday', labelHi: 'विज्ञान मंगलवार'),
  3: DayConfig(subject: 'english', labelEn: 'English Wednesday', labelHi: 'अंग्रेज़ी बुधवार'),
  4: DayConfig(subject: 'social_studies', labelEn: 'Social Studies Thursday', labelHi: 'सामाजिक विज्ञान गुरुवार'),
  5: DayConfig(subject: 'math', labelEn: 'Math Friday', labelHi: 'गणित शुक्रवार'),
  6: DayConfig(subject: 'personalized', personalized: true, labelEn: 'Your Weakest Subject', labelHi: 'तुम्हारा सबसे कमज़ोर विषय'),
};

/// Dart's `DateTime.weekday` is 1 (Monday) .. 7 (Sunday). JS/web's
/// `getDay()` is 0 (Sunday) .. 6 (Saturday). Convert so [kSubjectRotation]
/// (keyed the JS way, matching `challenge-config.ts` verbatim) can be
/// looked up from a Dart `DateTime`.
int dartWeekdayToJs(int dartWeekday) => dartWeekday % 7;

/// Returns the subject code for a given day of the week (JS convention: 0
/// Sunday .. 6 Saturday). `null` for Saturday (personalized).
String? getSubjectForDay(int dayOfWeekJs) {
  final config = kSubjectRotation[dayOfWeekJs];
  if (config == null) return null;
  if (config.personalized) return null;
  return config.subject;
}

// ---- Grace Period ----

/// Maximum number of days a streak can survive without activity before
/// being reset (using mercy days). Also used for the "new student always
/// unlocked" grace window on the challenge unlock check.
const int kGracePeriodDays = 3;

// ---- ZPD Difficulty Bands ----

/// Internal type for ZPD difficulty mapping (includes the threshold). Not
/// prefixed with `_` (kept public, mirroring the web's exported
/// `ZPDDifficultyEntry`) purely to avoid the
/// `library_private_types_in_public_api` lint on the public [kZpdDifficulty]
/// constant below.
class ZpdDifficultyEntry extends ChallengeDifficulty {
  final double maxZpd;
  const ZpdDifficultyEntry({
    required this.maxZpd,
    required super.cardCount,
    required super.distractorCount,
    required super.band,
  });
}

const List<ZpdDifficultyEntry> kZpdDifficulty = <ZpdDifficultyEntry>[
  ZpdDifficultyEntry(maxZpd: 0.4, cardCount: 4, distractorCount: 0, band: 'low'),
  ZpdDifficultyEntry(maxZpd: 0.7, cardCount: 5, distractorCount: 0, band: 'medium'),
  ZpdDifficultyEntry(maxZpd: 0.9, cardCount: 5, distractorCount: 1, band: 'high'),
  ZpdDifficultyEntry(maxZpd: 1.0, cardCount: 5, distractorCount: 2, band: 'expert'),
];

/// Returns the difficulty configuration for a given ZPD score. Clamps the
/// input to [0, 1].
ChallengeDifficulty getDifficultyForZPD(double zpd) {
  final clamped = zpd.clamp(0.0, 1.0);
  for (final entry in kZpdDifficulty) {
    if (clamped <= entry.maxZpd) {
      return ChallengeDifficulty(
        cardCount: entry.cardCount,
        distractorCount: entry.distractorCount,
        band: entry.band,
      );
    }
  }
  final last = kZpdDifficulty.last;
  return ChallengeDifficulty(
    cardCount: last.cardCount,
    distractorCount: last.distractorCount,
    band: last.band,
  );
}

// ---- Streak Milestones ----

/// Badge milestones awarded at streak thresholds. Coins are read from
/// [CoinRewards] (see file doc) rather than a second hardcoded literal.
final List<StreakMilestone> kStreakMilestones = <StreakMilestone>[
  const StreakMilestone(
    days: 7,
    badgeId: 'bronze_7',
    badgeLabel: '7-Day Streak',
    badgeLabelHi: '7 दिन की स्ट्रीक',
    badgeIcon: '\u{1F949}',
    coins: CoinRewards.challengeStreak7,
  ),
  const StreakMilestone(
    days: 30,
    badgeId: 'silver_30',
    badgeLabel: '30-Day Streak',
    badgeLabelHi: '30 दिन की स्ट्रीक',
    badgeIcon: '\u{1F948}',
    coins: CoinRewards.challengeStreak30,
  ),
  const StreakMilestone(
    days: 100,
    badgeId: 'gold_100',
    badgeLabel: '100-Day Streak',
    badgeLabelHi: '100 दिन की स्ट्रीक',
    badgeIcon: '\u{1F947}',
    coins: CoinRewards.challengeStreak100,
  ),
];

// ---- Mercy Days Per Grade ----

/// Returns the number of mercy days allowed per week for a given grade.
/// Younger students (grades 6-7) get 2 mercy days; all others get 1.
/// [grade] is a string ("6" through "12") per P5.
int getMercyDaysForGrade(String grade) {
  if (grade == '6' || grade == '7') return 2;
  return 1;
}

// ---- Streak Visibility Threshold ----

/// Minimum streak length before it is displayed to the student.
const int kStreakVisibilityThreshold = 3;
