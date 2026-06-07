// Wire-shape test for the leaderboard period selector (Wave 2.3b). The three
// LeaderboardPeriod values must serialise to EXACTLY the strings the
// /v2/student/leaderboard `period` query param accepts (weekly | monthly |
// all) — a drift here would silently send an unsupported period.

import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/providers/leaderboard_provider.dart';

void main() {
  group('LeaderboardPeriod.wire', () {
    test('maps to the contract query values', () {
      expect(LeaderboardPeriod.weekly.wire, 'weekly');
      expect(LeaderboardPeriod.monthly.wire, 'monthly');
      expect(LeaderboardPeriod.all.wire, 'all');
    });

    test('covers exactly the three contract periods', () {
      expect(
        LeaderboardPeriod.values.map((p) => p.wire).toSet(),
        {'weekly', 'monthly', 'all'},
      );
    });
  });
}
