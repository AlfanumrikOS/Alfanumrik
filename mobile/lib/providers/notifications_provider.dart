import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/models/notification_item.dart';
import '../data/repositories/notifications_repository.dart';
import 'auth_provider.dart';

final notificationsRepositoryProvider =
    Provider<NotificationsRepository>((ref) {
  return NotificationsRepository();
});

/// Notification feed — auto-fetches when the student is available. Exposes
/// [NotificationsFeed] (unread_count + list) so the badge widget and the
/// screen share one source of truth.
final notificationsProvider =
    AsyncNotifierProvider<NotificationsNotifier, NotificationsFeed>(
        NotificationsNotifier.new);

class NotificationsNotifier extends AsyncNotifier<NotificationsFeed> {
  @override
  Future<NotificationsFeed> build() async {
    final student = ref.watch(studentProvider).valueOrNull;
    if (student == null) return const NotificationsFeed();

    final repo = ref.watch(notificationsRepositoryProvider);
    final result = await repo.getNotifications(studentId: student.id);
    return result.dataOrNull ?? const NotificationsFeed();
  }

  /// Full reload (pull-to-refresh / retry banner).
  Future<void> refresh() async {
    final student = ref.read(studentProvider).valueOrNull;
    if (student == null) return;

    state = const AsyncLoading();
    final repo = ref.read(notificationsRepositoryProvider);
    final result = await repo.getNotifications(studentId: student.id);
    state = AsyncData(result.dataOrNull ?? const NotificationsFeed());
  }

  /// Mark one notification read. Optimistic local update (mirrors the web's
  /// `markRead()`), then best-effort server write — no rollback on failure,
  /// same as web (a stale local read-state is harmless; the next [refresh]
  /// reconciles it).
  Future<void> markRead(String notificationId) async {
    final current = state.valueOrNull;
    if (current == null) return;

    NotificationItem? target;
    for (final n in current.notifications) {
      if (n.id == notificationId) {
        target = n;
        break;
      }
    }
    if (target == null || target.isRead) return;

    final updated = current.notifications
        .map((n) => n.id == notificationId ? n.copyWith(isRead: true) : n)
        .toList(growable: false);
    final newUnread = current.unreadCount > 0 ? current.unreadCount - 1 : 0;
    state = AsyncData(
        NotificationsFeed(unreadCount: newUnread, notifications: updated));

    final repo = ref.read(notificationsRepositoryProvider);
    await repo.markRead(notificationId);
  }

  /// Mark every notification read. Optimistic local update, then best-effort
  /// server write — mirrors web's `markAllRead()`.
  Future<void> markAllRead() async {
    final student = ref.read(studentProvider).valueOrNull;
    final current = state.valueOrNull;
    if (student == null || current == null || current.unreadCount == 0) {
      return;
    }

    final updated = current.notifications
        .map((n) => n.copyWith(isRead: true))
        .toList(growable: false);
    state = AsyncData(NotificationsFeed(unreadCount: 0, notifications: updated));

    final repo = ref.read(notificationsRepositoryProvider);
    await repo.markAllRead(student.id);
  }
}

/// Convenience unread-count reader for widgets that only need the badge
/// number (bottom nav / settings tile) and shouldn't pay for the full feed
/// rebuild. Returns 0 while loading/erroring so a badge never shows a stale
/// or wrong count — it simply disappears until the feed resolves.
final unreadNotificationsCountProvider = Provider<int>((ref) {
  return ref.watch(notificationsProvider).valueOrNull?.unreadCount ?? 0;
});
