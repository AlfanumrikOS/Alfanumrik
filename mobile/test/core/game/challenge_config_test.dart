// Tests for challenge_config.dart — mobile parity for
// `packages/lib/src/challenge-config.ts`. Includes a coin-sync canary that
// pins `kStreakMilestones`/`CoinRewards` to the same values, so a future
// change to one without the other fails loudly (the exact drift risk this
// port was built to eliminate).
library;

import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/core/constants/coin_rules.dart';
import 'package:alfanumrik/core/game/challenge_config.dart';

void main() {
  group('getDifficultyForZPD', () {
    test('low band at the bottom of the range', () {
      final d = getDifficultyForZPD(0.0);
      expect(d.band, 'low');
      expect(d.cardCount, 4);
      expect(d.distractorCount, 0);
    });

    test('boundary values are inclusive of the lower band', () {
      expect(getDifficultyForZPD(0.4).band, 'low');
      expect(getDifficultyForZPD(0.41).band, 'medium');
      expect(getDifficultyForZPD(0.7).band, 'medium');
      expect(getDifficultyForZPD(0.71).band, 'high');
      expect(getDifficultyForZPD(0.9).band, 'high');
      expect(getDifficultyForZPD(0.91).band, 'expert');
    });

    test('expert band at the top of the range', () {
      final d = getDifficultyForZPD(1.0);
      expect(d.band, 'expert');
      expect(d.cardCount, 5);
      expect(d.distractorCount, 2);
    });

    test('clamps out-of-range input', () {
      expect(getDifficultyForZPD(-5).band, 'low');
      expect(getDifficultyForZPD(5).band, 'expert');
    });
  });

  group('getMercyDaysForGrade', () {
    test('grades 6 and 7 get 2 mercy days', () {
      expect(getMercyDaysForGrade('6'), 2);
      expect(getMercyDaysForGrade('7'), 2);
    });

    test('all other grades get 1 mercy day', () {
      for (final g in ['8', '9', '10', '11', '12']) {
        expect(getMercyDaysForGrade(g), 1, reason: 'grade $g should get 1 mercy day');
      }
    });
  });

  group('subject rotation', () {
    test('dartWeekdayToJs converts Dart 1..7 (Mon..Sun) to JS 0..6 (Sun..Sat)', () {
      expect(dartWeekdayToJs(DateTime.monday), 1);
      expect(dartWeekdayToJs(DateTime.tuesday), 2);
      expect(dartWeekdayToJs(DateTime.sunday), 0);
    });

    test('getSubjectForDay returns the fixed subject for weekdays', () {
      expect(getSubjectForDay(1), 'math'); // Monday
      expect(getSubjectForDay(2), 'science'); // Tuesday
      expect(getSubjectForDay(3), 'english'); // Wednesday
      expect(getSubjectForDay(4), 'social_studies'); // Thursday
      expect(getSubjectForDay(5), 'math'); // Friday
    });

    test('Saturday is personalized (returns null)', () {
      expect(getSubjectForDay(6), isNull);
      expect(kSubjectRotation[6]!.personalized, isTrue);
    });

    test('Sunday is the mixed fun day', () {
      expect(getSubjectForDay(0), 'mixed');
      expect(kSubjectRotation[0]!.mixed, isTrue);
    });
  });

  group('kStreakMilestones / CoinRewards sync (P2-adjacent)', () {
    // NOTE: this test compares kStreakMilestones' coins field back to the
    // exact same CoinRewards.* reference it was assigned from in
    // challenge_config.dart, so it can never fail on its own — it only
    // proves internal self-consistency, not sync with web. The real
    // drift-detection guard is the literal-value pin test below.
    test('milestone coin values match CoinRewards exactly', () {
      final byDays = {for (final m in kStreakMilestones) m.days: m.coins};
      expect(byDays[7], CoinRewards.challengeStreak7);
      expect(byDays[30], CoinRewards.challengeStreak30);
      expect(byDays[100], CoinRewards.challengeStreak100);
    });

    test('milestones are declared in ascending day order', () {
      final days = kStreakMilestones.map((m) => m.days).toList();
      expect(days, [7, 30, 100]);
    });

    test('CoinRewards challenge values are pinned to web CHALLENGE_COINS (packages/lib/src/challenge-config.ts)', () {
      // Literal pins, deliberately NOT derived from CoinRewards/kStreakMilestones,
      // so a silent drift in coin_rules.dart's constants is actually caught.
      // Source of truth: packages/lib/src/challenge-config.ts CHALLENGE_COINS
      // { solve: 15, streak_7_bonus: 25, streak_30_bonus: 100, streak_100_bonus: 500 }.
      expect(CoinRewards.challengeSolve, 15);
      expect(CoinRewards.challengeStreak7, 25);
      expect(CoinRewards.challengeStreak30, 100);
      expect(CoinRewards.challengeStreak100, 500);
    });
  });

  test('kGracePeriodDays and kStreakVisibilityThreshold match web constants', () {
    expect(kGracePeriodDays, 3);
    expect(kStreakVisibilityThreshold, 3);
  });
}
