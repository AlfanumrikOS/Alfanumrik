/// Tests for daily_plan.dart (Phase 6 mobile).
import 'package:flutter_test/flutter_test.dart';
import 'package:alfanumrik/data/models/daily_plan.dart';
import 'package:alfanumrik/data/models/goal_profile.dart';

void main() {
  group('DailyPlanItemKind.fromString', () {
    test('resolves all 6 kinds', () {
      expect(DailyPlanItemKind.fromString('pyq'), DailyPlanItemKind.pyq);
      expect(DailyPlanItemKind.fromString('concept'), DailyPlanItemKind.concept);
      expect(DailyPlanItemKind.fromString('practice'), DailyPlanItemKind.practice);
      expect(DailyPlanItemKind.fromString('challenge'), DailyPlanItemKind.challenge);
      expect(DailyPlanItemKind.fromString('review'), DailyPlanItemKind.review);
      expect(DailyPlanItemKind.fromString('reflection'), DailyPlanItemKind.reflection);
    });
    test('returns null for null/unknown', () {
      expect(DailyPlanItemKind.fromString(null), isNull);
      expect(DailyPlanItemKind.fromString('foo'), isNull);
    });
  });

  group('DailyPlanItem.fromJson', () {
    test('parses a complete item', () {
      final item = DailyPlanItem.fromJson({
        'kind': 'pyq',
        'titleEn': 'PYQ daily streak',
        'titleHi': 'PYQ पुराने प्रश्न',
        'estimatedMinutes': 20,
        'rationale': 'goal=board_topper',
      });
      expect(item.kind, DailyPlanItemKind.pyq);
      expect(item.titleEn, 'PYQ daily streak');
      expect(item.estimatedMinutes, 20);
    });

    test('throws on unknown kind', () {
      expect(
        () => DailyPlanItem.fromJson({'kind': 'foo'}),
        throwsArgumentError,
      );
    });
  });

  group('DailyPlan.fromJson', () {
    test('decodes a board_topper plan payload', () {
      final plan = DailyPlan.fromJson({
        'goal': 'board_topper',
        'totalMinutes': 45,
        'generatedAt': '2026-05-04T08:30:00.000Z',
        'items': [
          {'kind': 'pyq', 'titleEn': 'PYQ', 'titleHi': 'पुराने', 'estimatedMinutes': 20, 'rationale': 'x'},
          {'kind': 'practice', 'titleEn': 'HOTS', 'titleHi': 'HOTS', 'estimatedMinutes': 15, 'rationale': 'x'},
          {'kind': 'review', 'titleEn': 'Check', 'titleHi': 'जाँच', 'estimatedMinutes': 5, 'rationale': 'x'},
          {'kind': 'reflection', 'titleEn': 'Note', 'titleHi': 'नोट', 'estimatedMinutes': 5, 'rationale': 'x'},
        ],
      });
      expect(plan.goal, GoalCode.boardTopper);
      expect(plan.totalMinutes, 45);
      expect(plan.items.length, 4);
      expect(plan.items.first.kind, DailyPlanItemKind.pyq);
      expect(plan.isEmpty, false);
    });

    test('decodes empty plan', () {
      final plan = DailyPlan.fromJson({
        'goal': null,
        'totalMinutes': 0,
        'items': [],
        'generatedAt': '2026-05-04T08:30:00.000Z',
      });
      expect(plan.goal, isNull);
      expect(plan.isEmpty, true);
    });

    test('handles missing fields', () {
      final plan = DailyPlan.fromJson({});
      expect(plan.goal, isNull);
      expect(plan.totalMinutes, 0);
      expect(plan.items, isEmpty);
    });

    test('DailyPlan.empty factory', () {
      final p = DailyPlan.empty();
      expect(p.goal, isNull);
      expect(p.items, isEmpty);
    });
  });

  group('DailyPlanResponse.fromJson', () {
    test('decodes full envelope', () {
      final r = DailyPlanResponse.fromJson({
        'success': true,
        'flagEnabled': true,
        'data': {
          'goal': 'olympiad',
          'totalMinutes': 60,
          'items': [
            {'kind': 'challenge', 'titleEn': 'C', 'titleHi': 'चुनौती', 'estimatedMinutes': 30, 'rationale': 'x'},
          ],
          'generatedAt': '2026-05-04T08:30:00.000Z',
        },
      });
      expect(r.success, true);
      expect(r.flagEnabled, true);
      expect(r.data.goal, GoalCode.olympiad);
    });

    test('decodes flag-off envelope', () {
      final r = DailyPlanResponse.fromJson({
        'success': true,
        'flagEnabled': false,
        'data': {'goal': null, 'totalMinutes': 0, 'items': [], 'generatedAt': '2026-05-04T00:00:00.000Z'},
      });
      expect(r.flagEnabled, false);
      expect(r.data.isEmpty, true);
    });
  });
}
