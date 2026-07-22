// Tests for the pure Daily Challenge streak logic (challenge_streak.dart) —
// mobile parity for `packages/lib/src/challenge-streak.ts`.
library;

import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/core/game/challenge_streak.dart';
import 'package:alfanumrik/data/models/challenge_models.dart';

void main() {
  group('processStreakDay', () {
    test('first ever challenge sets streak to 1', () {
      const state = StreakState();
      final result = processStreakDay(state, '2026-07-21', '9');

      expect(result.currentStreak, 1);
      expect(result.bestStreak, 1);
      expect(result.lastChallengeDate, '2026-07-21');
      expect(result.mercyWeekStart, '2026-07-20'); // Monday of that week
    });

    test('same day is a no-op', () {
      const state = StreakState(currentStreak: 3, bestStreak: 5, lastChallengeDate: '2026-07-21');
      final result = processStreakDay(state, '2026-07-21', '9');

      expect(result.currentStreak, 3);
      expect(result.lastChallengeDate, '2026-07-21');
    });

    test('consecutive day increments the streak', () {
      const state = StreakState(
        currentStreak: 3,
        bestStreak: 3,
        lastChallengeDate: '2026-07-20',
        mercyWeekStart: '2026-07-20',
      );
      final result = processStreakDay(state, '2026-07-21', '9');

      expect(result.currentStreak, 4);
      expect(result.bestStreak, 4);
    });

    test('missing exactly 1 day uses mercy when available (grade 9 -> 1 mercy/week)', () {
      const state = StreakState(
        currentStreak: 5,
        bestStreak: 5,
        lastChallengeDate: '2026-07-20',
        mercyDaysUsedThisWeek: 0,
        mercyWeekStart: '2026-07-20',
      );
      // Missed 2026-07-21, resumes on 2026-07-22 (diff = 2).
      final result = processStreakDay(state, '2026-07-22', '9');

      expect(result.currentStreak, 6, reason: 'mercy day preserves the streak');
      expect(result.mercyDaysUsedThisWeek, 1);
    });

    test('missing 1 day breaks the streak once mercy is exhausted', () {
      const state = StreakState(
        currentStreak: 5,
        bestStreak: 5,
        lastChallengeDate: '2026-07-20',
        mercyDaysUsedThisWeek: 1, // grade 9 gets only 1 mercy day/week
        mercyWeekStart: '2026-07-20',
      );
      final result = processStreakDay(state, '2026-07-22', '9');

      expect(result.currentStreak, 1);
    });

    test('grade 6 gets 2 mercy days/week', () {
      const state = StreakState(
        currentStreak: 5,
        bestStreak: 5,
        lastChallengeDate: '2026-07-20',
        mercyDaysUsedThisWeek: 1,
        mercyWeekStart: '2026-07-20',
      );
      final result = processStreakDay(state, '2026-07-22', '6');

      expect(result.currentStreak, 6, reason: 'grade 6 has a second mercy day available');
      expect(result.mercyDaysUsedThisWeek, 2);
    });

    test('missing 2+ days breaks the streak back to 1', () {
      const state = StreakState(
        currentStreak: 10,
        bestStreak: 10,
        lastChallengeDate: '2026-07-15',
        mercyWeekStart: '2026-07-13',
      );
      final result = processStreakDay(state, '2026-07-21', '9');

      expect(result.currentStreak, 1);
      expect(result.bestStreak, 10, reason: 'best streak is never lowered');
    });

    test('mercy counter resets on a new week (Monday-based)', () {
      const state = StreakState(
        currentStreak: 5,
        bestStreak: 5,
        lastChallengeDate: '2026-07-13', // Monday
        mercyDaysUsedThisWeek: 1,
        mercyWeekStart: '2026-07-13',
      );
      // Missed 2026-07-14, resumes 2026-07-15 (diff=2) but now in a NEW week
      // (Monday 2026-07-13 is still the start of THIS week actually — use a
      // date that crosses into the next ISO week to exercise the reset).
      final result = processStreakDay(state, '2026-07-20', '9');

      // diff = 7 (>= 3) so this breaks the streak regardless of mercy, but
      // the mercy week should still have rolled over to the new Monday.
      expect(result.currentStreak, 1);
      expect(result.mercyWeekStart, '2026-07-20');
      expect(result.mercyDaysUsedThisWeek, 0);
    });
  });

  group('checkMercyEligibility', () {
    test('false when more than 1 day was missed', () {
      expect(checkMercyEligibility(0, 2, '9'), isFalse);
    });

    test('true when under the per-grade allowance', () {
      expect(checkMercyEligibility(0, 1, '9'), isTrue);
      expect(checkMercyEligibility(1, 1, '6'), isTrue);
    });

    test('false once the per-grade allowance is exhausted', () {
      expect(checkMercyEligibility(1, 1, '9'), isFalse);
      expect(checkMercyEligibility(2, 1, '6'), isFalse);
    });
  });

  group('detectMilestones', () {
    test('detects a newly crossed 7-day milestone', () {
      final milestones = detectMilestones(6, 7, const []);
      expect(milestones, hasLength(1));
      expect(milestones.single.badgeId, 'bronze_7');
    });

    test('does not re-detect an already-earned badge', () {
      final milestones = detectMilestones(6, 7, const ['bronze_7']);
      expect(milestones, isEmpty);
    });

    test('detects multiple milestones crossed in one jump', () {
      final milestones = detectMilestones(5, 30, const []);
      expect(milestones.map((m) => m.badgeId), containsAll(['bronze_7', 'silver_30']));
    });

    test('does not detect a milestone that was already passed previously', () {
      final milestones = detectMilestones(10, 12, const []);
      expect(milestones, isEmpty);
    });
  });

  group('shouldShowStreak', () {
    test('false below the visibility threshold', () {
      expect(shouldShowStreak(0), isFalse);
      expect(shouldShowStreak(2), isFalse);
    });

    test('true at and above the threshold', () {
      expect(shouldShowStreak(3), isTrue);
      expect(shouldShowStreak(10), isTrue);
    });
  });
}
