// Tests for the pure date helpers in challenge_provider.dart (`todayIST` /
// `todayStartIST`) — these anchor the Daily Challenge's unlock gate and
// streak-day computation to IST regardless of device timezone.
library;

import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/providers/challenge_provider.dart';

void main() {
  group('todayIST', () {
    test('formats an IST date that is still the same UTC calendar day', () {
      // 2026-07-21 10:00 UTC -> 2026-07-21 15:30 IST -> same calendar day.
      final now = DateTime.utc(2026, 7, 21, 10, 0);
      expect(todayIST(now: now), '2026-07-21');
    });

    test('rolls over to the next day when IST is ahead of a late-UTC instant', () {
      // 2026-07-21 19:00 UTC -> 2026-07-22 00:30 IST -> next calendar day.
      final now = DateTime.utc(2026, 7, 21, 19, 0);
      expect(todayIST(now: now), '2026-07-22');
    });

    test('pads single-digit month/day', () {
      final now = DateTime.utc(2026, 1, 5, 0, 0);
      // 2026-01-05 00:00 UTC -> 05:30 IST -> same day.
      expect(todayIST(now: now), '2026-01-05');
    });
  });

  group('todayStartIST', () {
    test('returns the UTC instant for IST midnight of the current IST day', () {
      final now = DateTime.utc(2026, 7, 21, 19, 0); // -> 2026-07-22 IST
      final start = todayStartIST(now: now);

      // IST midnight 2026-07-22 == UTC 2026-07-21 18:30.
      expect(start, DateTime.utc(2026, 7, 21, 18, 30));
    });

    test('is idempotent across the same IST calendar day', () {
      final earlyInDay = todayStartIST(now: DateTime.utc(2026, 7, 21, 3, 0));
      final laterInDay = todayStartIST(now: DateTime.utc(2026, 7, 21, 15, 0));
      expect(earlyInDay, laterInDay);
    });
  });
}
