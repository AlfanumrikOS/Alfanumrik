// Pure helpers for the Notifications screen — time formatting + day
// grouping. Split out from the widget (mirroring the `today_copy.dart`
// pattern) so this logic is unit-testable without pumping a widget tree.

import '../../../data/models/notification_item.dart';

/// Bilingual "time ago" formatter. Pure port of the web's `timeAgo()` in
/// `apps/host/src/app/notifications/page.tsx`. [now] is injectable for tests;
/// defaults to the wall clock.
String notificationTimeAgo(DateTime date, bool isHi, {DateTime? now}) {
  final reference = now ?? DateTime.now();
  final diffMs = reference.difference(date).inMilliseconds;
  final mins = (diffMs / 60000).floor();
  if (mins < 1) return isHi ? 'अभी' : 'Just now';
  if (mins < 60) return isHi ? '$mins मिनट पहले' : '${mins}m ago';
  final hrs = (mins / 60).floor();
  if (hrs < 24) return isHi ? '$hrs घंटे पहले' : '${hrs}h ago';
  final days = (hrs / 24).floor();
  if (days == 1) return isHi ? 'कल' : 'Yesterday';
  if (days < 7) return isHi ? '$days दिन पहले' : '${days}d ago';
  return _shortDate(date);
}

const _kMonths = <String>[
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/// Mirrors `toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })`.
String _shortDate(DateTime dt) => '${_kMonths[dt.month - 1]} ${dt.day}';

/// One day-bucket of notifications — mirrors the web's `groupNotifications()`.
class NotificationGroup {
  final String label;
  final String labelHi;
  final List<NotificationItem> items;

  const NotificationGroup({
    required this.label,
    required this.labelHi,
    required this.items,
  });
}

bool _isSameDay(DateTime a, DateTime b) =>
    a.year == b.year && a.month == b.month && a.day == b.day;

/// Buckets [items] into Today / Yesterday / Earlier (in that order), dropping
/// empty buckets — pure port of the web's grouping logic. [now] is injectable
/// for tests.
List<NotificationGroup> groupNotificationsByDay(
  List<NotificationItem> items, {
  DateTime? now,
}) {
  final reference = now ?? DateTime.now();
  final yesterday = reference.subtract(const Duration(days: 1));

  final todayItems = <NotificationItem>[];
  final yesterdayItems = <NotificationItem>[];
  final earlierItems = <NotificationItem>[];

  for (final n in items) {
    if (_isSameDay(n.createdAt, reference)) {
      todayItems.add(n);
    } else if (_isSameDay(n.createdAt, yesterday)) {
      yesterdayItems.add(n);
    } else {
      earlierItems.add(n);
    }
  }

  final groups = <NotificationGroup>[
    NotificationGroup(label: 'Today', labelHi: 'आज', items: todayItems),
    NotificationGroup(label: 'Yesterday', labelHi: 'कल', items: yesterdayItems),
    NotificationGroup(label: 'Earlier', labelHi: 'पहले', items: earlierItems),
  ];
  return groups.where((g) => g.items.isNotEmpty).toList(growable: false);
}
