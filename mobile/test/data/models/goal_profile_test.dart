/// Tests for goal_profile.dart (Phase 6 mobile).
import 'package:flutter_test/flutter_test.dart';
import 'package:alfanumrik/data/models/goal_profile.dart';

void main() {
  group('GoalCode.fromCode', () {
    test('resolves all 6 known codes', () {
      expect(GoalCode.fromCode('improve_basics'), GoalCode.improveBasics);
      expect(GoalCode.fromCode('pass_comfortably'), GoalCode.passComfortably);
      expect(GoalCode.fromCode('school_topper'), GoalCode.schoolTopper);
      expect(GoalCode.fromCode('board_topper'), GoalCode.boardTopper);
      expect(GoalCode.fromCode('competitive_exam'), GoalCode.competitiveExam);
      expect(GoalCode.fromCode('olympiad'), GoalCode.olympiad);
    });

    test('returns null for null/empty/unknown', () {
      expect(GoalCode.fromCode(null), isNull);
      expect(GoalCode.fromCode(''), isNull);
      expect(GoalCode.fromCode('not_a_real_goal'), isNull);
    });

    test('round trip via enum.code', () {
      for (final g in GoalCode.values) {
        expect(GoalCode.fromCode(g.code), g);
      }
    });
  });

  group('goalProfiles map', () {
    test('contains all 6 GoalCode values', () {
      for (final g in GoalCode.values) {
        expect(goalProfiles[g], isNotNull);
      }
    });

    test('improve_basics contract', () {
      final p = goalProfiles[GoalCode.improveBasics]!;
      expect(p.dailyTargetMinutes, 10);
      expect(p.masteryThreshold, 0.60);
      expect(p.pacePolicy, PacePolicy.patient);
      expect(p.scorecardTone, ScorecardTone.encouraging);
      expect(p.bloomBand.min, 1);
      expect(p.bloomBand.max, 3);
    });

    test('board_topper contract', () {
      final p = goalProfiles[GoalCode.boardTopper]!;
      expect(p.dailyTargetMinutes, 45);
      expect(p.masteryThreshold, 0.85);
      expect(p.pacePolicy, PacePolicy.campaign);
      expect(p.scorecardTone, ScorecardTone.examiner);
      expect(p.sourcePriority.first, SourceTag.pyq);
    });

    test('olympiad contract', () {
      final p = goalProfiles[GoalCode.olympiad]!;
      expect(p.dailyTargetMinutes, 60);
      expect(p.masteryThreshold, 0.90);
      expect(p.pacePolicy, PacePolicy.selective);
    });

    test('every difficultyMix sums to 1.0', () {
      for (final p in goalProfiles.values) {
        final s = p.difficultyMix.easy + p.difficultyMix.medium + p.difficultyMix.hard;
        expect(s, closeTo(1.0, 1e-9));
      }
    });

    test('every bloomBand within 1..6 with min<=max', () {
      for (final p in goalProfiles.values) {
        expect(p.bloomBand.min, greaterThanOrEqualTo(1));
        expect(p.bloomBand.max, lessThanOrEqualTo(6));
        expect(p.bloomBand.min, lessThanOrEqualTo(p.bloomBand.max));
      }
    });

    test('every profile has non-empty en + hi labels and callouts', () {
      for (final p in goalProfiles.values) {
        expect(p.labelEn, isNotEmpty);
        expect(p.labelHi, isNotEmpty);
        expect(p.dashboardCalloutEn, isNotEmpty);
        expect(p.dashboardCalloutHi, isNotEmpty);
      }
    });

    test('hi labels and callouts use Devanagari script', () {
      final dev = RegExp(r'[ऀ-ॿ]');
      for (final p in goalProfiles.values) {
        expect(dev.hasMatch(p.labelHi), true);
        expect(dev.hasMatch(p.dashboardCalloutHi), true);
      }
    });
  });

  group('resolveGoalProfile', () {
    test('returns profile for known code', () {
      expect(resolveGoalProfile('board_topper'), isNotNull);
    });
    test('returns null for null/empty/unknown', () {
      expect(resolveGoalProfile(null), isNull);
      expect(resolveGoalProfile(''), isNull);
      expect(resolveGoalProfile('not_real'), isNull);
    });
  });
}
