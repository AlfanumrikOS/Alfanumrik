// Tests for the pure Notifications-feed helpers (Phase 6 mobile):
// `notificationTimeAgo` (bilingual time formatting) and
// `groupNotificationsByDay` (Today/Yesterday/Earlier bucketing). These mirror
// the web's `timeAgo()` / `groupNotifications()` in
// apps/host/src/app/notifications/page.tsx.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:alfanumrik/data/models/notification_item.dart';
import 'package:alfanumrik/ui/screens/notifications/notification_feed_logic.dart';

NotificationItem _item(String id, DateTime createdAt) => NotificationItem(
      id: id,
      type: 'quiz_result',
      title: 'title-$id',
      body: 'body-$id',
      data: const {},
      isRead: false,
      createdAt: createdAt,
    );

void main() {
  final now = DateTime.utc(2026, 7, 20, 12, 0, 0);

  group('notificationTimeAgo', () {
    test('just now for < 1 minute', () {
      final d = now.subtract(const Duration(seconds: 30));
      expect(notificationTimeAgo(d, false, now: now), 'Just now');
      expect(notificationTimeAgo(d, true, now: now), 'अभी');
    });

    test('minutes ago under an hour', () {
      final d = now.subtract(const Duration(minutes: 7));
      expect(notificationTimeAgo(d, false, now: now), '7m ago');
      expect(notificationTimeAgo(d, true, now: now), '7 मिनट पहले');
    });

    test('hours ago under a day', () {
      final d = now.subtract(const Duration(hours: 5));
      expect(notificationTimeAgo(d, false, now: now), '5h ago');
      expect(notificationTimeAgo(d, true, now: now), '5 घंटे पहले');
    });

    test('exactly 1 day is "Yesterday"', () {
      final d = now.subtract(const Duration(hours: 30));
      expect(notificationTimeAgo(d, false, now: now), 'Yesterday');
      expect(notificationTimeAgo(d, true, now: now), 'कल');
    });

    test('2-6 days ago', () {
      final d = now.subtract(const Duration(days: 3));
      expect(notificationTimeAgo(d, false, now: now), '3d ago');
      expect(notificationTimeAgo(d, true, now: now), '3 दिन पहले');
    });

    test('7+ days falls back to a short date', () {
      final d = DateTime.utc(2026, 3, 5, 12, 0, 0);
      expect(notificationTimeAgo(d, false, now: now), 'Mar 5');
    });
  });

  group('groupNotificationsByDay', () {
    test('buckets into Today / Yesterday / Earlier and drops empty buckets', () {
      final items = [
        _item('today1', now),
        _item('yesterday1', now.subtract(const Duration(hours: 26))),
        _item('earlier1', now.subtract(const Duration(days: 10))),
      ];

      final groups = groupNotificationsByDay(items, now: now);

      expect(groups, hasLength(3));
      expect(groups[0].label, 'Today');
      expect(groups[0].items.map((i) => i.id), ['today1']);
      expect(groups[1].label, 'Yesterday');
      expect(groups[1].items.map((i) => i.id), ['yesterday1']);
      expect(groups[2].label, 'Earlier');
      expect(groups[2].items.map((i) => i.id), ['earlier1']);
    });

    test('drops empty buckets entirely (e.g. no items today)', () {
      final items = [_item('earlier1', now.subtract(const Duration(days: 10)))];
      final groups = groupNotificationsByDay(items, now: now);
      expect(groups, hasLength(1));
      expect(groups.single.label, 'Earlier');
    });

    test('empty input yields no groups', () {
      expect(groupNotificationsByDay(const [], now: now), isEmpty);
    });

    test('multiple items in the same bucket preserve input order', () {
      final items = [
        _item('a', now),
        _item('b', now.subtract(const Duration(hours: 1))),
      ];
      final groups = groupNotificationsByDay(items, now: now);
      expect(groups.single.items.map((i) => i.id), ['a', 'b']);
    });
  });
}
