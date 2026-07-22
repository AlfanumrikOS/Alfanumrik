// Tests for notifications_provider.dart's AsyncNotifier logic — build(),
// markRead() (optimistic single-item update) and markAllRead() (optimistic
// bulk update). Follows the same fake-repository + ProviderContainer pattern
// as test/services/subjects_provider_test.dart.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/core/network/api_result.dart';
import 'package:alfanumrik/data/models/notification_item.dart';
import 'package:alfanumrik/data/models/student.dart';
import 'package:alfanumrik/data/repositories/notifications_repository.dart';
import 'package:alfanumrik/providers/auth_provider.dart';
import 'package:alfanumrik/providers/notifications_provider.dart';

class _FixedStudentNotifier extends StudentNotifier {
  @override
  Future<Student?> build() async => const Student(
        id: 'student-1',
        authUserId: 'auth-1',
        name: 'Test Student',
        grade: '8',
      );
}

class _EmptyStudentNotifier extends StudentNotifier {
  @override
  Future<Student?> build() async => null;
}

class _FakeNotificationsRepository implements NotificationsRepository {
  NotificationsFeed feed;
  int getCalls = 0;
  int markReadCalls = 0;
  int markAllReadCalls = 0;
  String? lastMarkedReadId;
  String? lastMarkAllStudentId;

  _FakeNotificationsRepository(this.feed);

  @override
  Future<ApiResult<NotificationsFeed>> getNotifications({
    required String studentId,
    int limit = 50,
  }) async {
    getCalls++;
    return ApiSuccess(feed);
  }

  @override
  Future<ApiResult<void>> markRead(String notificationId) async {
    markReadCalls++;
    lastMarkedReadId = notificationId;
    return const ApiSuccess(null);
  }

  @override
  Future<ApiResult<void>> markAllRead(String studentId) async {
    markAllReadCalls++;
    lastMarkAllStudentId = studentId;
    return const ApiSuccess(null);
  }
}

NotificationItem _item(String id, {bool isRead = false}) => NotificationItem(
      id: id,
      type: 'quiz_result',
      title: 'title-$id',
      body: 'body-$id',
      data: const {},
      isRead: isRead,
      createdAt: DateTime.utc(2026, 7, 20),
    );

void main() {
  group('NotificationsNotifier.build', () {
    test('returns an empty feed when there is no student', () async {
      final fake = _FakeNotificationsRepository(const NotificationsFeed());
      final container = ProviderContainer(overrides: [
        studentProvider.overrideWith(_EmptyStudentNotifier.new),
        notificationsRepositoryProvider.overrideWithValue(fake),
      ]);
      addTearDown(container.dispose);
      // Resolve studentProvider's own async build FIRST. NotificationsNotifier
      // reads `studentProvider` synchronously (via `.valueOrNull`) inside its
      // own build() — without this, the not-yet-resolved studentProvider reads
      // as `null` on the first pass and the dependent build is rebuilt out from
      // under the awaited `.future`, which then never completes (30s timeout).
      await container.read(studentProvider.future);

      final feed = await container.read(notificationsProvider.future);
      expect(feed.unreadCount, 0);
      expect(feed.notifications, isEmpty);
      expect(fake.getCalls, 0);
    });

    test('fetches the feed for the current student', () async {
      final fake = _FakeNotificationsRepository(
        NotificationsFeed(unreadCount: 2, notifications: [_item('n1'), _item('n2')]),
      );
      final container = ProviderContainer(overrides: [
        studentProvider.overrideWith(_FixedStudentNotifier.new),
        notificationsRepositoryProvider.overrideWithValue(fake),
      ]);
      addTearDown(container.dispose);
      // Resolve studentProvider's own async build FIRST. NotificationsNotifier
      // reads `studentProvider` synchronously (via `.valueOrNull`) inside its
      // own build() — without this, the not-yet-resolved studentProvider reads
      // as `null` on the first pass and the dependent build is rebuilt out from
      // under the awaited `.future`, which then never completes (30s timeout).
      await container.read(studentProvider.future);

      final feed = await container.read(notificationsProvider.future);
      expect(feed.unreadCount, 2);
      expect(feed.notifications, hasLength(2));
      expect(fake.getCalls, 1);
    });
  });

  group('NotificationsNotifier.markRead', () {
    test('optimistically marks one notification read and decrements unread_count', () async {
      final fake = _FakeNotificationsRepository(
        NotificationsFeed(unreadCount: 2, notifications: [_item('n1'), _item('n2')]),
      );
      final container = ProviderContainer(overrides: [
        studentProvider.overrideWith(_FixedStudentNotifier.new),
        notificationsRepositoryProvider.overrideWithValue(fake),
      ]);
      addTearDown(container.dispose);
      // Resolve studentProvider's own async build FIRST. NotificationsNotifier
      // reads `studentProvider` synchronously (via `.valueOrNull`) inside its
      // own build() — without this, the not-yet-resolved studentProvider reads
      // as `null` on the first pass and the dependent build is rebuilt out from
      // under the awaited `.future`, which then never completes (30s timeout).
      await container.read(studentProvider.future);

      await container.read(notificationsProvider.future);
      await container.read(notificationsProvider.notifier).markRead('n1');

      final updated = container.read(notificationsProvider).valueOrNull!;
      expect(updated.unreadCount, 1);
      expect(updated.notifications.firstWhere((n) => n.id == 'n1').isRead, isTrue);
      expect(updated.notifications.firstWhere((n) => n.id == 'n2').isRead, isFalse);
      expect(fake.markReadCalls, 1);
      expect(fake.lastMarkedReadId, 'n1');
    });

    test('marking an already-read notification is a no-op', () async {
      final fake = _FakeNotificationsRepository(
        NotificationsFeed(unreadCount: 0, notifications: [_item('n1', isRead: true)]),
      );
      final container = ProviderContainer(overrides: [
        studentProvider.overrideWith(_FixedStudentNotifier.new),
        notificationsRepositoryProvider.overrideWithValue(fake),
      ]);
      addTearDown(container.dispose);
      // Resolve studentProvider's own async build FIRST. NotificationsNotifier
      // reads `studentProvider` synchronously (via `.valueOrNull`) inside its
      // own build() — without this, the not-yet-resolved studentProvider reads
      // as `null` on the first pass and the dependent build is rebuilt out from
      // under the awaited `.future`, which then never completes (30s timeout).
      await container.read(studentProvider.future);

      await container.read(notificationsProvider.future);
      await container.read(notificationsProvider.notifier).markRead('n1');

      expect(fake.markReadCalls, 0);
    });

    test('unread_count never goes negative', () async {
      final fake = _FakeNotificationsRepository(
        NotificationsFeed(unreadCount: 0, notifications: [_item('n1')]),
      );
      final container = ProviderContainer(overrides: [
        studentProvider.overrideWith(_FixedStudentNotifier.new),
        notificationsRepositoryProvider.overrideWithValue(fake),
      ]);
      addTearDown(container.dispose);
      // Resolve studentProvider's own async build FIRST. NotificationsNotifier
      // reads `studentProvider` synchronously (via `.valueOrNull`) inside its
      // own build() — without this, the not-yet-resolved studentProvider reads
      // as `null` on the first pass and the dependent build is rebuilt out from
      // under the awaited `.future`, which then never completes (30s timeout).
      await container.read(studentProvider.future);

      await container.read(notificationsProvider.future);
      await container.read(notificationsProvider.notifier).markRead('n1');

      final updated = container.read(notificationsProvider).valueOrNull!;
      expect(updated.unreadCount, 0);
    });
  });

  group('NotificationsNotifier.markAllRead', () {
    test('optimistically marks every notification read and zeroes unread_count', () async {
      final fake = _FakeNotificationsRepository(
        NotificationsFeed(
          unreadCount: 2,
          notifications: [_item('n1'), _item('n2')],
        ),
      );
      final container = ProviderContainer(overrides: [
        studentProvider.overrideWith(_FixedStudentNotifier.new),
        notificationsRepositoryProvider.overrideWithValue(fake),
      ]);
      addTearDown(container.dispose);
      // Resolve studentProvider's own async build FIRST. NotificationsNotifier
      // reads `studentProvider` synchronously (via `.valueOrNull`) inside its
      // own build() — without this, the not-yet-resolved studentProvider reads
      // as `null` on the first pass and the dependent build is rebuilt out from
      // under the awaited `.future`, which then never completes (30s timeout).
      await container.read(studentProvider.future);

      await container.read(notificationsProvider.future);
      await container.read(notificationsProvider.notifier).markAllRead();

      final updated = container.read(notificationsProvider).valueOrNull!;
      expect(updated.unreadCount, 0);
      expect(updated.notifications.every((n) => n.isRead), isTrue);
      expect(fake.markAllReadCalls, 1);
      expect(fake.lastMarkAllStudentId, 'student-1');
    });

    test('is a no-op when unread_count is already 0', () async {
      final fake = _FakeNotificationsRepository(
        NotificationsFeed(unreadCount: 0, notifications: [_item('n1', isRead: true)]),
      );
      final container = ProviderContainer(overrides: [
        studentProvider.overrideWith(_FixedStudentNotifier.new),
        notificationsRepositoryProvider.overrideWithValue(fake),
      ]);
      addTearDown(container.dispose);
      // Resolve studentProvider's own async build FIRST. NotificationsNotifier
      // reads `studentProvider` synchronously (via `.valueOrNull`) inside its
      // own build() — without this, the not-yet-resolved studentProvider reads
      // as `null` on the first pass and the dependent build is rebuilt out from
      // under the awaited `.future`, which then never completes (30s timeout).
      await container.read(studentProvider.future);

      await container.read(notificationsProvider.future);
      await container.read(notificationsProvider.notifier).markAllRead();

      expect(fake.markAllReadCalls, 0);
    });
  });
}
